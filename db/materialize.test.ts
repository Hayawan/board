import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';

import { initDb } from './index.js';
import { seed } from './seed.js';
import { items, assets, boards } from './schema.js';
import { writeItem } from './queue.js';
import { createView } from './view.js';
import { deleteItemWithAssets } from './item-actions.js';
import { materializeView } from './materialize.js';

// Story 15.3 — copy-on-write "materialize view to board": COPY a lens's items into a new
// real board (new rows), reusing asset FILES by hash (referenced, not rewritten). The
// source is byte-for-byte untouched (it's a copy, never a move).

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'board-oss-mat-'));
  const handle = initDb(join(dir, 'c.db'));
  seed(handle.db);
  const screenshotsDir = join(dir, 'screenshots');
  mkdirSync(screenshotsDir, { recursive: true });
  return { dir, handle, screenshotsDir };
}

describe('materializeView (Story 15.3)', () => {
  // AC1/AC2/AC4 — copy (not move): new board + new item rows; source byte-unchanged; and
  // NO new files on disk (assets referenced by their existing path/hash).
  it('copies a view into a new board without moving or duplicating anything', async () => {
    const { dir, handle, screenshotsDir } = await setup();
    try {
      // two favorite items across two boards, each with a real screenshot file + asset row
      writeFileSync(join(screenshotsDir, 'i1.png'), 'PNG1');
      writeFileSync(join(screenshotsDir, 'i2.png'), 'PNG2');
      await writeItem(handle, { id: 'i1', boardId: 'library', source: 'https://1', title: 'One', favorite: 1, fields: { summary: 's1' } },
        [{ id: 'i1-shot', itemId: 'i1', kind: 'screenshot', path: 'screenshots/i1.png', hash: 'h1' }]);
      await writeItem(handle, { id: 'i2', boardId: 'inspiration', source: 'https://2', title: 'Two', favorite: 1 },
        [{ id: 'i2-shot', itemId: 'i2', kind: 'screenshot', path: 'screenshots/i2.png', hash: 'h2' }]);

      const view = await createView(handle, { id: 'v1', name: 'Favs', filter: { favorite: true } });
      const srcBefore = handle.db.select().from(items).all().filter((i) => i.id === 'i1' || i.id === 'i2');
      const srcAssetsBefore = handle.db.select().from(assets).all().filter((a) => a.id === 'i1-shot' || a.id === 'i2-shot');
      const filesBefore = readdirSync(screenshotsDir).sort();
      const boardsBefore = handle.db.select().from(boards).all().length;
      const itemsBefore = handle.db.select().from(items).all().length;
      const assetsBefore = handle.db.select().from(assets).all().length;

      const res = await materializeView(handle, view.id, { name: 'My materialized board' });

      // a NEW board with NEW item rows (distinct ids)
      assert.ok(res.boardId);
      assert.equal(res.copied, 2);
      const newItems = handle.db.select().from(items).where(eq(items.boardId, res.boardId)).all();
      assert.equal(newItems.length, 2, 'two copied item rows in the new board');
      assert.ok(!newItems.some((i) => i.id === 'i1' || i.id === 'i2'), 'copies have NEW ids (not the source ids)');
      assert.ok(newItems.some((i) => (i.fields as any)?.summary === 's1'), 'copied fields carried by value');

      // copy NOT move: source items + their asset rows byte-for-byte unchanged
      const srcAfter = handle.db.select().from(items).all().filter((i) => i.id === 'i1' || i.id === 'i2');
      assert.deepEqual(srcAfter, srcBefore, 'source items byte-for-byte unchanged (no move)');
      const srcAssetsAfter = handle.db.select().from(assets).all().filter((a) => a.id === 'i1-shot' || a.id === 'i2-shot');
      assert.deepEqual(srcAssetsAfter, srcAssetsBefore, 'source asset rows byte-for-byte unchanged (AC2)');
      // AC5 — purely additive: exactly +1 board, +2 items, +2 assets; nothing else mutated
      assert.equal(handle.db.select().from(boards).all().length, boardsBefore + 1, 'exactly one new board');
      assert.equal(handle.db.select().from(items).all().length, itemsBefore + 2, 'exactly two new item rows');
      assert.equal(handle.db.select().from(assets).all().length, assetsBefore + 2, 'exactly two new asset rows');

      // hash dedupe: NO new files on disk, and the copy asset reuses the source path
      assert.deepEqual(readdirSync(screenshotsDir).sort(), filesBefore, 'no asset bytes rewritten/duplicated on disk');
      const copyShot = handle.db.select().from(assets).where(eq(assets.itemId, newItems.find((i) => (i.fields as any)?.summary === 's1')!.id)).get()!;
      assert.equal(copyShot.path, 'screenshots/i1.png', 'copy asset references the SAME file by path');
      assert.equal(copyShot.hash, 'h1');
      assert.ok(copyShot.id !== 'i1-shot', 'copy asset row has a new id');
    } finally {
      handle.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('materializeView — divergence + shared-file delete safety (Story 15.3)', () => {
  async function withCopy() {
    const s = await setup();
    writeFileSync(join(s.screenshotsDir, 'i1.png'), 'PNG1');
    await writeItem(s.handle, { id: 'i1', boardId: 'library', source: 'https://1', title: 'One', favorite: 1, notes: 'source note' },
      [{ id: 'i1-shot', itemId: 'i1', kind: 'screenshot', path: 'screenshots/i1.png', hash: 'h1' }]);
    const view = await createView(s.handle, { id: 'v1', name: 'Favs', filter: { favorite: true } });
    const res = await materializeView(s.handle, view.id, { name: 'Mat' });
    const copy = s.handle.db.select().from(items).where(eq(items.boardId, res.boardId)).get()!;
    return { ...s, copy };
  }

  // AC3 — editing the copy does not affect the source (divergence owned by the copy).
  it('editing a copied item leaves the source untouched', async () => {
    const { dir, handle, copy } = await withCopy();
    const { patchItemFields } = await import('./item-actions.js');
    try {
      await patchItemFields(handle, copy.id, { notes: 'edited on the copy' });
      assert.equal(handle.db.select().from(items).where(eq(items.id, copy.id)).get()!.notes, 'edited on the copy');
      assert.equal(handle.db.select().from(items).where(eq(items.id, 'i1')).get()!.notes, 'source note', 'source notes unchanged');
    } finally {
      handle.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // AC4 — deleting the materialized copy must NOT unlink a file the source still references.
  it('deleting the copy keeps the shared asset file (still referenced by the source)', async () => {
    const { dir, handle, screenshotsDir, copy } = await withCopy();
    try {
      const res = await deleteItemWithAssets(handle, copy.id, screenshotsDir);
      assert.equal(res.deleted, true);
      assert.ok(existsSync(join(screenshotsDir, 'i1.png')), 'shared file survives — source i1 still references it');
      // the source asset row + file still resolve
      assert.ok(handle.db.select().from(assets).where(eq(assets.id, 'i1-shot')).get(), 'source asset row intact');
    } finally {
      handle.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // AC4 (the other direction) — normal cleanup intact: an UNSHARED file IS still unlinked.
  it('deleting an item with an unshared file still unlinks that file (no regression)', async () => {
    const { dir, handle, screenshotsDir } = await setup();
    try {
      writeFileSync(join(screenshotsDir, 'solo.png'), 'SOLO');
      await writeItem(handle, { id: 'solo', boardId: 'library', source: 'https://s', title: 'Solo' },
        [{ id: 'solo-shot', itemId: 'solo', kind: 'screenshot', path: 'screenshots/solo.png', hash: 'hs' }]);
      const res = await deleteItemWithAssets(handle, 'solo', screenshotsDir);
      assert.equal(res.filesRemoved, 1);
      assert.ok(!existsSync(join(screenshotsDir, 'solo.png')), 'unshared file is unlinked (cleanup not over-eager)');
    } finally {
      handle.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('materializeView — edges (Story 15.3)', () => {
  it('throws on an unknown view id', async () => {
    const { dir, handle } = await setup();
    try {
      await assert.rejects(materializeView(handle, 'ghost-view', { name: 'X' }), /unknown view/i);
    } finally {
      handle.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('materializes an empty view to a new board with zero copies (no error)', async () => {
    const { dir, handle } = await setup();
    try {
      const view = await createView(handle, { id: 'empty', name: 'Empty', filter: { favorite: true } });
      const res = await materializeView(handle, view.id, { name: 'Empty board' });
      assert.equal(res.copied, 0);
      assert.ok(handle.db.select().from(boards).where(eq(boards.id, res.boardId)).get(), 'new board still created');
    } finally {
      handle.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('copies an item that has no assets', async () => {
    const { dir, handle } = await setup();
    try {
      await writeItem(handle, { id: 'na', boardId: 'library', source: 'https://n', title: 'No assets', favorite: 1 });
      const view = await createView(handle, { id: 'v', name: 'V', filter: { favorite: true } });
      const res = await materializeView(handle, view.id, { name: 'Mat' });
      assert.equal(res.copied, 1);
      const copy = handle.db.select().from(items).where(eq(items.boardId, res.boardId)).get()!;
      assert.equal(copy.title, 'No assets');
      assert.equal(handle.db.select().from(assets).where(eq(assets.itemId, copy.id)).all().length, 0);
    } finally {
      handle.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
