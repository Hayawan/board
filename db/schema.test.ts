import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initDb } from './index.js';
import { boards, items, assets } from './schema.js';

// Story 1.1 — schema + connection + WAL. These tests open a throwaway temp DB
// under os.tmpdir() and NEVER touch the real DATA_DIR / prototype data files.

describe('db/schema (Story 1.1)', () => {
  let dir: string;
  let dbPath: string;
  let handle: ReturnType<typeof initDb>;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'board-oss-schema-'));
    dbPath = join(dir, 'test.db');
    handle = initDb(dbPath);
  });

  after(() => {
    handle.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  // AC 1
  it('creates the DB with WAL enabled', () => {
    const mode = handle.sqlite.pragma('journal_mode', { simple: true });
    assert.equal(String(mode).toLowerCase(), 'wal');
  });

  // AC 4 (enforcement flag)
  it('enforces foreign keys on the connection', () => {
    const fk = handle.sqlite.pragma('foreign_keys', { simple: true });
    assert.equal(Number(fk), 1);
  });

  // AC 2 — tables + columns
  it('has board / item / asset tables with the architecture columns', () => {
    const cols = (table: string): Set<string> =>
      new Set(
        (handle.sqlite.pragma(`table_info(${table})`) as Array<{ name: string }>).map((c) => c.name),
      );

    const boardCols = cols('board');
    for (const c of ['id', 'name', 'view', 'descriptor', 'created_at', 'updated_at']) {
      assert.ok(boardCols.has(c), `board missing column ${c}`);
    }

    const itemCols = cols('item');
    for (const c of [
      'id', 'board_id', 'source', 'title', 'status', 'error_reason', 'favorite',
      'notes', 'fields', 'search_blob', 'analysis_provider', 'analysis_model',
      'created_at', 'updated_at',
    ]) {
      assert.ok(itemCols.has(c), `item missing column ${c}`);
    }

    const assetCols = cols('asset');
    for (const c of ['id', 'item_id', 'kind', 'path', 'width', 'height', 'hash', 'captured_at']) {
      assert.ok(assetCols.has(c), `asset missing column ${c}`);
    }
  });

  // AC 2 — defaults
  it('defaults item.status to "pending" and item.favorite to 0', () => {
    handle.db.insert(boards).values({ id: 'b-defaults', name: 'Defaults', view: 'grid' }).run();
    handle.db.insert(items).values({ id: 'i-defaults', boardId: 'b-defaults', source: 'x' }).run();
    const row = handle.db.select().from(items).where(eqId(items.id, 'i-defaults')).get();
    assert.equal(row?.status, 'pending');
    assert.equal(row?.favorite, 0);
  });

  // AC 5 — four system-column indexes
  it('creates the four system-column indexes on item', () => {
    const idxList = handle.sqlite.pragma('index_list(item)') as Array<{ name: string }>;
    const indexedCols = new Set<string>();
    for (const idx of idxList) {
      const info = handle.sqlite.pragma(`index_info(${idx.name})`) as Array<{ name: string }>;
      for (const ci of info) indexedCols.add(ci.name);
    }
    for (const c of ['board_id', 'status', 'favorite', 'created_at']) {
      assert.ok(indexedCols.has(c), `no index covering item.${c}`);
    }
  });

  // AC 3 — caller-supplied id + insertable created_at survive verbatim
  it('persists an explicit id and created_at verbatim', () => {
    const ts = 1700000000;
    handle.db.insert(boards).values({ id: 'b-explicit', name: 'B', view: 'grid', createdAt: ts }).run();
    const row = handle.db.select().from(boards).where(eqId(boards.id, 'b-explicit')).get();
    assert.equal(row?.id, 'b-explicit');
    assert.equal(row?.createdAt, ts);
  });

  // AC 3 — created_at falls back to now() when omitted
  it('falls back to a created_at when omitted', () => {
    handle.db.insert(boards).values({ id: 'b-nofallback', name: 'B', view: 'grid' }).run();
    const row = handle.db.select().from(boards).where(eqId(boards.id, 'b-nofallback')).get();
    assert.ok(typeof row?.createdAt === 'number' && row.createdAt > 0);
  });

  // AC 4 — orphan FK rejected
  it('rejects an item with a nonexistent board_id', () => {
    assert.throws(() => {
      handle.db.insert(items).values({ id: 'i-orphan', boardId: 'does-not-exist', source: 'x' }).run();
    });
  });

  it('rejects an asset with a nonexistent item_id', () => {
    assert.throws(() => {
      handle.db.insert(assets).values({ id: 'a-orphan', itemId: 'does-not-exist', kind: 'screenshot', path: '/x' }).run();
    });
  });

  // AC 4 — full round-trip with JSON columns as structured objects
  it('round-trips board -> item -> asset with JSON columns as objects', () => {
    const descriptor = { fields: [{ key: 'summary', label: 'Summary', type: 'text', enrichable: true }] };
    const fields = { summary: 'hello', topics: ['a', 'b'] };

    handle.db.insert(boards).values({ id: 'b1', name: 'Lib', view: 'list', descriptor }).run();
    handle.db.insert(items).values({
      id: 'it1', boardId: 'b1', source: 'https://x', title: 'T', fields,
    }).run();
    handle.db.insert(assets).values({
      id: 'as1', itemId: 'it1', kind: 'screenshot', path: '/data/x.png', width: 800, height: 600,
    }).run();

    const b = handle.db.select().from(boards).where(eqId(boards.id, 'b1')).get();
    const it = handle.db.select().from(items).where(eqId(items.id, 'it1')).get();
    const as = handle.db.select().from(assets).where(eqId(assets.id, 'as1')).get();

    assert.deepEqual(b?.descriptor, descriptor);
    assert.deepEqual(it?.fields, fields);
    assert.equal(it?.boardId, 'b1');
    assert.equal(as?.itemId, 'it1');
    assert.equal(as?.width, 800);
  });
});

// tiny local helper to avoid importing drizzle's eq at top before deps exist
import { eq } from 'drizzle-orm';
function eqId(col: any, val: string) {
  return eq(col, val);
}
