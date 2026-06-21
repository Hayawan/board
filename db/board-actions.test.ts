import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { eq } from 'drizzle-orm';

import { initDb } from './index.js';
import { boards, items, assets } from './schema.js';
import { insertBoard } from './seed.js';
import { writeItem } from './queue.js';
import { renameBoard, deleteBoardCascade } from './board-actions.js';

const DESCRIPTOR = { view: 'grid' as const, ingest_mode: 'url-screenshot' as const, enrichment_prompt: '', fields: [{ key: 'note', label: 'Note', type: 'text' as const, enrichable: false }] };

describe('board actions (New/Edit board)', () => {
  let dir: string;
  let shotDir: string;
  let handle: ReturnType<typeof initDb>;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'board-oss-boardact-'));
    shotDir = join(dir, 'screenshots');
    mkdirSync(shotDir, { recursive: true });
    handle = initDb(join(dir, 'b.db'));
    insertBoard(handle.db, { id: 'wines', name: 'Wines', descriptor: DESCRIPTOR });
  });
  after(() => { handle.sqlite.close(); rmSync(dir, { recursive: true, force: true }); });

  it('renames a board', async () => {
    await renameBoard(handle, 'wines', 'Fine Wines');
    assert.equal(handle.db.select().from(boards).where(eq(boards.id, 'wines')).get()?.name, 'Fine Wines');
  });

  it('rename rejects an unknown board / empty name', async () => {
    await assert.rejects(() => renameBoard(handle, 'nope', 'x'), /unknown board/i);
    await assert.rejects(() => renameBoard(handle, 'wines', '  '), /name is required/i);
  });

  it('deletes a board and cascades its items, asset rows, and asset files', async () => {
    insertBoard(handle.db, { id: 'cars', name: 'Cars', descriptor: DESCRIPTOR });
    await writeItem(handle, { id: 'car-1', boardId: 'cars', source: 'https://x', title: 'A' });
    handle.db.insert(assets).values({ id: 'car-1-a', itemId: 'car-1', kind: 'screenshot', path: 'screenshots/car-1.png' }).run();
    writeFileSync(join(shotDir, 'car-1.png'), 'PNG');

    const res = await deleteBoardCascade(handle, 'cars', shotDir);
    assert.equal(res.deleted, true);
    assert.equal(res.items, 1);
    assert.equal(res.files, 1);
    assert.equal(handle.db.select().from(boards).where(eq(boards.id, 'cars')).get(), undefined, 'board gone');
    assert.equal(handle.db.select().from(items).where(eq(items.boardId, 'cars')).all().length, 0, 'items gone');
    assert.equal(existsSync(join(shotDir, 'car-1.png')), false, 'asset file unlinked');
  });

  it('delete returns deleted:false for an unknown board', async () => {
    const res = await deleteBoardCascade(handle, 'ghost', shotDir);
    assert.equal(res.deleted, false);
  });
});
