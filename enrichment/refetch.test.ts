import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { eq } from 'drizzle-orm';

import { initDb } from '../db/index.js';
import { boards, assets, items } from '../db/schema.js';
import { createCaptureRegistry } from '../capture/adapter.js';
import type { LLMProvider } from '../skills/types.js';
import type { TimeoutFn } from '../db/queue.js';
import { refetchItem, reenrichBoardItems } from './refetch.js';

const neverFires: TimeoutFn = () => () => {};

const DESCRIPTOR = {
  view: 'grid',
  ingest_mode: 'test',
  enrichment_prompt: 'x',
  fields: [
    { key: 'summary', label: 'Summary', type: 'text', enrichable: true },
    { key: 'favorite_reason', label: 'Why fav', type: 'text', enrichable: false },
  ],
};

describe('refetch (Story 7.3)', () => {
  let dir: string;
  let handle: ReturnType<typeof initDb>;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'board-oss-refetch-'));
    handle = initDb(join(dir, 'r.db'));
    handle.db.insert(boards).values({ id: 'b', name: 'B', view: 'grid', descriptor: DESCRIPTOR }).run();
    // existing item: user fields (notes/favorite/favorite_reason) + OLD enriched summary + 1 asset
    handle.db.insert(items).values({
      id: 'it', boardId: 'b', source: 'https://x.example', title: 'Old Title',
      notes: 'my notes', favorite: 1,
      fields: { summary: 'OLD summary', favorite_reason: 'I like it' },
    }).run();
    handle.db.insert(assets).values({ id: 'it-old', itemId: 'it', kind: 'screenshot', path: 'screenshots/old.png' }).run();
  });
  after(() => { handle.sqlite.close(); rmSync(dir, { recursive: true, force: true }); });

  // AC 1/2/3/4 — re-runs capture+enrich, preserves user fields, idempotent
  it('refreshes enrichable fields + asset while preserving user fields, no duplicates', async () => {
    const registry = createCaptureRegistry();
    registry.register({
      ingestMode: 'test',
      fetch: async () => ({ fields: { text: 'fresh page text' }, assets: [{ kind: 'screenshot', path: 'screenshots/new.png' }] }),
    });
    const llm: LLMProvider = { complete: async () => ({ summary: 'NEW summary' }) as never };

    const result = await refetchItem(handle, { itemId: 'it', registry, llm, screenshotsDir: dir, timeoutFn: neverFires });
    assert.equal(result.ok, true);

    const row = handle.db.select().from(items).where(eq(items.id, 'it')).get();
    const f = row?.fields as Record<string, unknown>;
    // AC2 — user-authored fields preserved
    assert.equal(row?.notes, 'my notes', 'notes preserved');
    assert.equal(row?.favorite, 1, 'favorite preserved');
    assert.equal(f.favorite_reason, 'I like it', 'enrichable:false field preserved');
    // AC1 — enrichable fields refreshed
    assert.equal(f.summary, 'NEW summary', 'enriched field updated');
    assert.equal(f.text, 'fresh page text', 'captured field updated');
    // AC4 — item id unchanged
    assert.equal(row?.id, 'it');
    assert.equal(row?.status, 'done');
    // AC3 — asset replaced, not duplicated
    const assetRows = handle.db.select().from(assets).where(eq(assets.itemId, 'it')).all();
    assert.equal(assetRows.length, 1, 'asset count must stay 1 (replaced, not duplicated)');
    assert.equal(assetRows[0].path, 'screenshots/new.png');
  });

  it('throws on an unknown item', async () => {
    const registry = createCaptureRegistry();
    const llm: LLMProvider = { complete: async () => ({}) as never };
    await assert.rejects(() => refetchItem(handle, { itemId: 'nope', registry, llm, screenshotsDir: dir, timeoutFn: neverFires }), /item/i);
  });
});

describe('reenrichBoardItems (batch re-run)', () => {
  let dir: string;
  let handle: ReturnType<typeof initDb>;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'board-oss-reenrich-'));
    handle = initDb(join(dir, 'r.db'));
    handle.db.insert(boards).values({ id: 'b', name: 'B', view: 'grid', descriptor: DESCRIPTOR }).run();
    handle.db.insert(items).values({ id: 'i1', boardId: 'b', source: 'https://a', title: 'A', notes: 'keep', fields: { text: 'page a', summary: 'old a' } }).run();
    handle.db.insert(items).values({ id: 'i2', boardId: 'b', source: 'https://b', title: 'B', fields: { text: 'page b', summary: 'old b' } }).run();
  });
  after(() => { handle.sqlite.close(); rmSync(dir, { recursive: true, force: true }); });

  it('re-enriches every item on the board WITHOUT re-capture, preserving user fields', async () => {
    const registry = createCaptureRegistry(); // empty → would no-op capture anyway
    const llm: LLMProvider = { complete: async () => ({ summary: 'NEW' }) as never };
    const { queued, settled } = reenrichBoardItems(handle, { boardId: 'b', llm, registry, timeoutFn: neverFires });
    assert.equal(queued, 2);
    await settled;
    const i1 = handle.db.select().from(items).where(eq(items.id, 'i1')).get();
    assert.equal((i1?.fields as any).summary, 'NEW', 'enriched field refreshed');
    assert.equal((i1?.fields as any).text, 'page a', 'captured content NOT re-fetched (preserved)');
    assert.equal(i1?.notes, 'keep', 'user notes preserved');
    assert.equal(i1?.status, 'done');
  });

  it('returns queued:0 for a board with no items', async () => {
    const registry = createCaptureRegistry();
    const llm: LLMProvider = { complete: async () => ({}) as never };
    const { queued } = reenrichBoardItems(handle, { boardId: 'empty', llm, registry, timeoutFn: neverFires });
    assert.equal(queued, 0);
  });
});
