import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { eq } from 'drizzle-orm';

import { initDb } from './index.js';
import { boards, assets, items } from './schema.js';
import { patchItemFields, deleteItemWithAssets } from './item-actions.js';

const DESCRIPTOR = {
  view: 'list', ingest_mode: 'url-readable', enrichment_prompt: '',
  fields: [
    { key: 'summary', label: 'Summary', type: 'text', enrichable: true }, // enriched — NOT patchable
    { key: 'favorite_reason', label: 'Why', type: 'text', enrichable: false }, // user — patchable
  ],
};

describe('per-item actions (Story 8.3)', () => {
  let dir: string;
  let shotDir: string;
  let handle: ReturnType<typeof initDb>;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'board-oss-actions-'));
    shotDir = join(dir, 'screenshots');
    handle = initDb(join(dir, 'a.db'));
    handle.db.insert(boards).values({ id: 'b', name: 'B', view: 'list', descriptor: DESCRIPTOR }).run();
  });
  after(() => { handle.sqlite.close(); rmSync(dir, { recursive: true, force: true }); });

  const seed = (id: string) => handle.db.insert(items).values({ id, boardId: 'b', source: 'x', fields: { summary: 'enriched', favorite_reason: 'old' } }).run();
  const get = (id: string) => handle.db.select().from(items).where(eq(items.id, id)).get();

  // AC1 — notes persist (+ searchable via FTS refresh)
  it('PATCH notes persists and refreshes search_blob', async () => {
    seed('n1');
    await patchItemFields(handle, 'n1', { notes: 'zqxwvnote' });
    assert.equal(get('n1')?.notes, 'zqxwvnote');
    const hit = handle.sqlite.prepare("SELECT item_id FROM item_fts WHERE item_fts MATCH 'zqxwvnote'").all() as Array<{ item_id: string }>;
    assert.deepEqual(hit.map((r) => r.item_id), ['n1'], 'notes are searchable after patch');
  });

  // AC2 — favorite toggles
  it('PATCH favorite toggles (coerced to 0/1)', async () => {
    seed('f1');
    await patchItemFields(handle, 'f1', { favorite: true });
    assert.equal(get('f1')?.favorite, 1);
    await patchItemFields(handle, 'f1', { favorite: false });
    assert.equal(get('f1')?.favorite, 0);
  });

  // AC1 — an enrichable:false descriptor field is patchable
  it('PATCH a user (enrichable:false) field updates item.fields', async () => {
    seed('uf1');
    await patchItemFields(handle, 'uf1', { favorite_reason: 'new reason' });
    assert.equal((get('uf1')?.fields as Record<string, unknown>).favorite_reason, 'new reason');
  });

  // AC4 — a disallowed field (status / enriched) does NOT take effect
  it('ignores a disallowed PATCH field (status + enriched field unchanged)', async () => {
    seed('d1');
    await patchItemFields(handle, 'd1', { status: 'done', summary: 'HACKED', notes: 'ok' });
    const row = get('d1');
    assert.equal(row?.status, 'pending', 'status not patchable');
    assert.equal((row?.fields as Record<string, unknown>).summary, 'enriched', 'enriched field not overwritten');
    assert.equal(row?.notes, 'ok', 'allowed field still applied');
  });

  // AC3 — delete removes the item, its asset rows, AND its asset files (any board)
  it('DELETE removes the item, asset rows, and unlinks asset files', async () => {
    seed('del1');
    handle.db.insert(assets).values({ id: 'del1-a', itemId: 'del1', kind: 'screenshot', path: 'screenshots/del1.png' }).run();
    mkdirSync(shotDir, { recursive: true });
    writeFileSync(join(shotDir, 'del1.png'), 'PNG');
    assert.ok(existsSync(join(shotDir, 'del1.png')));

    const res = await deleteItemWithAssets(handle, 'del1', shotDir);
    assert.equal(res.deleted, true);
    assert.equal(res.filesRemoved, 1);
    assert.equal(get('del1'), undefined, 'item row removed');
    assert.equal(handle.db.select().from(assets).where(eq(assets.itemId, 'del1')).all().length, 0, 'asset rows removed');
    assert.equal(existsSync(join(shotDir, 'del1.png')), false, 'asset file unlinked');
  });

  // delete an item that has an asset must NOT FK-fail (the latent bug deleteItem now fixes)
  it('deletes an item with assets without an FK error', async () => {
    seed('del2');
    handle.db.insert(assets).values({ id: 'del2-a', itemId: 'del2', kind: 'screenshot', path: 'screenshots/del2.png' }).run();
    await assert.doesNotReject(deleteItemWithAssets(handle, 'del2', shotDir));
    assert.equal(get('del2'), undefined);
  });
});
