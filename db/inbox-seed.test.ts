import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { eq } from 'drizzle-orm';

import { initDb } from './index.js';
import { boards, items, assets } from './schema.js';
import {
  seed,
  insertBoard,
  INSPIRATION_BOARD_ID,
  LIBRARY_BOARD_ID,
  INBOX_BOARD_ID,
  INSPIRATION_DESCRIPTOR,
  LIBRARY_DESCRIPTOR,
} from './seed.js';
import { createCaptureRegistry } from '../capture/adapter.js';
import { runCaptureEnrichJob } from '../enrichment/pipeline.js';
import type { TimeoutFn } from './queue.js';
import type { LLMProvider } from '../skills/types.js';
import { buildServer } from '../server.js';

const neverFires: TimeoutFn = () => () => {};

// Story 13.1 — the Inbox is the linchpin: seeded idempotently, capture is cheap-only,
// and NO existing board/item/asset is disturbed (NFR-BC).

// Build a PRE-WAVE shaped DB: Inspiration + Library + a couple items + an asset,
// and NO inbox row (as an existing user's board.db would look before this wave).
function preWaveDb() {
  const dir = mkdtempSync(join(tmpdir(), 'board-oss-inbox-'));
  const handle = initDb(join(dir, 'b.db'));
  insertBoard(handle.db, { id: INSPIRATION_BOARD_ID, name: 'Inspiration', descriptor: INSPIRATION_DESCRIPTOR });
  insertBoard(handle.db, { id: LIBRARY_BOARD_ID, name: 'Library', descriptor: LIBRARY_DESCRIPTOR });
  handle.db.insert(items).values({ id: 'insp-1', boardId: INSPIRATION_BOARD_ID, source: 'https://a', title: 'A', favorite: 1, notes: 'keep me', fields: { 'meta.form': 'saas' } }).run();
  handle.db.insert(items).values({ id: 'lib-1', boardId: LIBRARY_BOARD_ID, source: 'https://b', title: 'B', fields: { summary: 'S' } }).run();
  handle.db.insert(assets).values({ id: 'as-1', itemId: 'insp-1', kind: 'screenshot', path: 'screenshots/insp-1.png' }).run();
  return { dir, handle };
}

describe('Story 13.1 — Inbox seeded idempotently, existing data untouched', () => {
  let dir: string;
  let handle: ReturnType<typeof initDb>;
  before(() => { ({ dir, handle } = preWaveDb()); });
  after(() => { handle.sqlite.close(); rmSync(dir, { recursive: true, force: true }); });

  it('seeds the Inbox exactly once, idempotently, with existing rows untouched', () => {
    // pre-condition: no inbox
    assert.equal(handle.db.select().from(boards).where(eq(boards.id, INBOX_BOARD_ID)).get(), undefined);
    const inspBefore = handle.db.select().from(items).where(eq(items.id, 'insp-1')).get();
    const inspBoardBefore = handle.db.select().from(boards).where(eq(boards.id, INSPIRATION_BOARD_ID)).get();

    seed(handle.db);
    const inbox = handle.db.select().from(boards).where(eq(boards.id, INBOX_BOARD_ID)).all();
    assert.equal(inbox.length, 1, 'Inbox seeded exactly once');

    // re-seed → still exactly one inbox (idempotent)
    seed(handle.db);
    assert.equal(handle.db.select().from(boards).where(eq(boards.id, INBOX_BOARD_ID)).all().length, 1);

    // existing boards still present; existing item byte-for-byte
    assert.ok(handle.db.select().from(boards).where(eq(boards.id, INSPIRATION_BOARD_ID)).get());
    assert.ok(handle.db.select().from(boards).where(eq(boards.id, LIBRARY_BOARD_ID)).get());
    const inspAfter = handle.db.select().from(items).where(eq(items.id, 'insp-1')).get();
    assert.deepEqual(inspAfter, inspBefore, 'existing item (notes/favorite/fields) unchanged');
    assert.equal(handle.db.select().from(assets).where(eq(assets.itemId, 'insp-1')).all().length, 1, 'asset row preserved');
    assert.equal(handle.db.select().from(items).all().length, 2, 'no phantom items created');
    // existing board descriptor row unchanged across the (re-)seed
    assert.deepEqual(
      handle.db.select().from(boards).where(eq(boards.id, INSPIRATION_BOARD_ID)).get(),
      inspBoardBefore,
      'existing board descriptor untouched by seeding the Inbox',
    );
  });
});

describe('Story 13.1 — existing boards/items SERVED unchanged after Inbox seed', () => {
  it('GET /api/collections includes the Inbox; existing items still serve', async () => {
    const { dir, handle } = preWaveDb();
    seed(handle.db);
    const app = await buildServer({ db: handle });
    try {
      const cols = await app.inject({ method: 'GET', url: '/api/collections' });
      assert.equal(cols.statusCode, 200);
      const ids = (JSON.parse(cols.body) as any[]).map((c) => c.id);
      assert.ok(ids.includes(INSPIRATION_BOARD_ID) && ids.includes(LIBRARY_BOARD_ID), 'existing boards present');
      assert.ok(ids.includes(INBOX_BOARD_ID), 'Inbox now appears');

      const libItems = await app.inject({ method: 'GET', url: `/api/collections/${LIBRARY_BOARD_ID}/items` });
      assert.equal(libItems.statusCode, 200);
      const body = JSON.parse(libItems.body) as any[];
      assert.ok(body.some((i) => i.id === 'lib-1' && i.summary === 'S'), 'existing item served unchanged');
    } finally {
      handle.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Story 13.1 — cheap on Inbox capture, earned on a typed board', () => {
  // A spy LLM that counts complete() calls.
  function spyLlm() {
    let calls = 0;
    const llm: LLMProvider = { complete: async () => { calls += 1; return {} as any; } };
    return { llm, calls: () => calls };
  }

  it('does NOT call llm.complete on the cheap (Inbox) path, but DOES on the earned path', async () => {
    const { dir, handle } = preWaveDb();
    seed(handle.db); // adds Inbox (ingest_mode url-screenshot)
    try {
      // a pending item on each board
      handle.db.insert(items).values({ id: 'inbox-it', boardId: INBOX_BOARD_ID, source: 'https://inbox.example' }).run();
      handle.db.insert(items).values({ id: 'insp-it', boardId: INSPIRATION_BOARD_ID, source: 'https://insp.example' }).run();

      // fake capture adapter (no Chrome): returns a cheap title
      const reg = createCaptureRegistry();
      reg.register({ ingestMode: 'url-screenshot', fetch: async () => ({ fields: { title: 'Cheap Title' }, assets: [] }) });

      // CHEAP path (Inbox): enrichment hop skipped → complete never called
      const cheap = spyLlm();
      await runCaptureEnrichJob(handle, {
        itemId: 'inbox-it', boardId: INBOX_BOARD_ID, source: 'https://inbox.example',
        ingestMode: 'url-screenshot', registry: reg, llm: cheap.llm, tier: 'cheap', timeoutFn: neverFires,
      });
      assert.equal(cheap.calls(), 0, 'cheap (Inbox) capture must NOT call llm.complete');
      const inboxItem = handle.db.select().from(items).where(eq(items.id, 'inbox-it')).get();
      assert.equal(inboxItem?.status, 'done', 'Inbox item reaches a terminal state');
      assert.equal(inboxItem?.title, 'Cheap Title', 'cheap capture still populates title');

      // EARNED path (Inspiration, default tier): enrichment runs → complete called once
      const earned = spyLlm();
      await runCaptureEnrichJob(handle, {
        itemId: 'insp-it', boardId: INSPIRATION_BOARD_ID, source: 'https://insp.example',
        ingestMode: 'url-screenshot', registry: reg, llm: earned.llm, timeoutFn: neverFires,
      });
      assert.equal(earned.calls(), 1, 'earned (typed-board) capture calls llm.complete exactly once');
    } finally {
      handle.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // The DISCRIMINATING test: tier:'cheap' on a board that HAS enrichable fields
  // (Inspiration) must STILL skip enrichment → 0 complete calls. This isolates the
  // tier flag from the fields:[] early-return — it fails if the pipeline's cheap-skip
  // is removed (the Inbox-only test cannot catch that, since Inbox has no fields).
  it('tier:cheap skips enrichment even on a board WITH enrichable fields', async () => {
    const { dir, handle } = preWaveDb();
    seed(handle.db);
    try {
      handle.db.insert(items).values({ id: 'insp-cheap', boardId: INSPIRATION_BOARD_ID, source: 'https://x.example' }).run();
      const reg = createCaptureRegistry();
      reg.register({ ingestMode: 'url-screenshot', fetch: async () => ({ fields: {}, assets: [] }) });
      const spy = spyLlm();
      await runCaptureEnrichJob(handle, {
        itemId: 'insp-cheap', boardId: INSPIRATION_BOARD_ID, source: 'https://x.example',
        ingestMode: 'url-screenshot', registry: reg, llm: spy.llm, tier: 'cheap', timeoutFn: neverFires,
      });
      assert.equal(spy.calls(), 0, 'cheap tier must skip enrichment even when the board has fields');
      assert.equal(handle.db.select().from(items).where(eq(items.id, 'insp-cheap')).get()?.status, 'done');
    } finally {
      handle.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Story 13.1 — capture tier selection (add-item)', () => {
  it('selects cheap for the Inbox and earned for every other board', async () => {
    const { captureTierForBoard } = await import('../skills/add-item.js');
    assert.equal(captureTierForBoard(INBOX_BOARD_ID), 'cheap');
    assert.equal(captureTierForBoard(INSPIRATION_BOARD_ID), 'earned');
    assert.equal(captureTierForBoard(LIBRARY_BOARD_ID), 'earned');
    assert.equal(captureTierForBoard('any-composed-board'), 'earned');
  });
});
