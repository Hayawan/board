import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initDb } from './index.js';
import { boards } from './schema.js';
import { writeItem, deleteItem } from './queue.js';
import { buildSearchBlob } from './search-blob.js';
import type { BoardDescriptor } from '../descriptor/types.js';

const descriptor: BoardDescriptor = {
  view: 'list',
  ingest_mode: 'url-readable',
  enrichment_prompt: 'x',
  fields: [
    { key: 'body', label: 'Body', type: 'text', enrichable: true },
    { key: 'tagz', label: 'Tags', type: 'tags', enrichable: true },
    { key: 'kind', label: 'Kind', type: 'enum', values: ['a', 'b'], enrichable: true },
    { key: 'rank', label: 'Rank', type: 'number' }, // non-searchable
    { key: 'shot', label: 'Shot', type: 'image' }, // non-searchable
  ],
};

describe('buildSearchBlob (Story 1.4, pure)', () => {
  it('includes title, notes, and text/tags/enum field values; excludes number/image', () => {
    const blob = buildSearchBlob(
      {
        title: 'mytitle',
        notes: 'mynote',
        fields: { body: 'zqxwv hello', tagz: ['wibble', 'frob'], kind: 'a', rank: 42, shot: '/secretzzz.png' },
      },
      descriptor,
    );
    for (const term of ['mytitle', 'mynote', 'zqxwv', 'hello', 'wibble', 'frob', 'a']) {
      assert.match(blob, new RegExp(term), `blob should contain ${term}`);
    }
    // AC 1 — non-searchable fields must NOT leak into the blob
    assert.doesNotMatch(blob, /42/, 'number field must not appear');
    assert.doesNotMatch(blob, /secretzzz/, 'image path must not appear');
  });

  it('falls back to all string/array values when no descriptor is given', () => {
    const blob = buildSearchBlob({ title: 't', fields: { a: 'alpha', b: ['beta'], n: 99 } });
    assert.match(blob, /alpha/);
    assert.match(blob, /beta/);
    assert.doesNotMatch(blob, /99/);
  });
});

describe('FTS5 integration (Story 1.4)', () => {
  let dir: string;
  let handle: ReturnType<typeof initDb>;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'board-oss-fts-'));
    handle = initDb(join(dir, 'fts.db'));
    handle.db.insert(boards).values({ id: 'b', name: 'B', view: 'list', descriptor }).run();
  });
  after(() => {
    handle.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const match = (term: string): string[] =>
    (handle.sqlite.prepare('SELECT item_id FROM item_fts WHERE item_fts MATCH ?').all(term) as Array<{
      item_id: string;
    }>).map((r) => r.item_id);

  // AC 1, 2, 3, 4 — write -> search_blob -> FTS query
  it('assembles search_blob on write and indexes it for query', async () => {
    await writeItem(handle, {
      id: 'i1',
      boardId: 'b',
      title: 'mytitle',
      notes: 'mynote',
      fields: { body: 'zqxwv hello', tagz: ['wibble'], kind: 'a', rank: 42, shot: '/secretzzz.png' },
    });
    const row = handle.sqlite.prepare('SELECT search_blob FROM item WHERE id = ?').get('i1') as {
      search_blob: string;
    };
    assert.match(row.search_blob, /zqxwv/);
    assert.doesNotMatch(row.search_blob, /secretzzz/);

    assert.deepEqual(match('zqxwv'), ['i1']); // hit
    assert.deepEqual(match('wibble'), ['i1']); // tags indexed
    assert.deepEqual(match('nonexistentqqq'), []); // miss
    assert.deepEqual(match('secretzzz'), []); // non-searchable not indexed
  });

  // AC 2 — update reindexes
  it('reindexes on update (old term gone, new term present)', async () => {
    await writeItem(handle, { id: 'i1', boardId: 'b', title: 'mytitle', fields: { body: 'plonk' } });
    assert.deepEqual(match('zqxwv'), [], 'stale term must be removed from index');
    assert.deepEqual(match('plonk'), ['i1'], 'new term must be indexed');
  });

  // AC 2 — delete removes from index
  it('removes from the index on delete', async () => {
    await writeItem(handle, { id: 'i2', boardId: 'b', title: 'gribble', fields: {} });
    assert.deepEqual(match('gribble'), ['i2']);
    await deleteItem(handle, 'i2');
    assert.deepEqual(match('gribble'), []);
    const cnt = handle.sqlite.prepare('SELECT COUNT(*) c FROM item WHERE id=?').get('i2') as { c: number };
    assert.equal(cnt.c, 0, 'item row must be deleted too');
  });
});
