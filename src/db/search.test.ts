import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initDb } from './index.js';
import { boards } from './schema.js';
import { writeItem } from './queue.js';
import { searchItems } from './search.js';
// Story 8.2 filter predicate — to prove the compose (AC5) intersection.
import { matchesFilters } from '../collections-ui.js';

describe('full-text search (Story 9.1)', () => {
  let dir: string;
  let handle: ReturnType<typeof initDb>;

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'board-oss-search-'));
    handle = initDb(join(dir, 's.db'));
    handle.db.insert(boards).values({ id: 'a', name: 'A', view: 'list', descriptor: { view: 'list', ingest_mode: 'url-readable', enrichment_prompt: '', fields: [{ key: 'type', label: 'Type', type: 'enum', values: ['paper', 'post'] }, { key: 'summary', label: 'Summary', type: 'text', enrichable: true }] } }).run();
    handle.db.insert(boards).values({ id: 'b', name: 'B', view: 'list', descriptor: { view: 'list', ingest_mode: 'url-readable', enrichment_prompt: '', fields: [] } }).run();
    // Seed via the typed item-write so FTS (Story 1.4) is populated.
    // A: term in TITLE, short blob → should rank above B-body match.
    await writeItem(handle, { id: 'a-title', boardId: 'a', source: 'x', title: 'zqxwv', fields: { type: 'paper' } });
    // C: term only in a long BODY → lower bm25 than the title match.
    await writeItem(handle, { id: 'a-body', boardId: 'a', source: 'x', title: 'unrelated heading', fields: { type: 'post', summary: 'lorem ipsum dolor sit amet '.repeat(20) + ' zqxwv ' + 'consectetur adipiscing elit '.repeat(20) } });
    // cross-board item with the same term on board B
    await writeItem(handle, { id: 'b-1', boardId: 'b', source: 'x', title: 'zqxwv on board b' });
  });
  after(() => { handle.sqlite.close(); rmSync(dir, { recursive: true, force: true }); });

  // AC2 — hit + miss
  it('finds an item by a distinctive term; a non-matching term is empty', () => {
    const hits = searchItems(handle, { boardId: 'a', query: 'zqxwv' });
    assert.ok(hits.some((i) => i.id === 'a-title'), 'matching item returned');
    assert.equal(searchItems(handle, { boardId: 'a', query: 'notpresentxyz' }).length, 0, 'non-match empty');
    assert.equal(searchItems(handle, { boardId: 'a', query: '   ' }).length, 0, 'blank query empty');
  });

  // AC1 — ranking: the title match (short, dense blob) ranks above the body-only match
  it('ranks the stronger (title) match above the body-only match', () => {
    const hits = searchItems(handle, { boardId: 'a', query: 'zqxwv' });
    const ids = hits.map((i) => i.id);
    assert.ok(ids.indexOf('a-title') < ids.indexOf('a-body'), `title match should rank first: ${ids.join(',')}`);
  });

  // AC3 — board scope: board B's match does NOT appear when searching board A
  it('scopes results to the active board', () => {
    const hits = searchItems(handle, { boardId: 'a', query: 'zqxwv' });
    assert.ok(!hits.some((i) => i.id === 'b-1'), 'cross-board item excluded');
    assert.ok(searchItems(handle, { boardId: 'b', query: 'zqxwv' }).some((i) => i.id === 'b-1'), 'found on its own board');
  });

  // AC4 — a malformed FTS5 query does not 500 (phrase-quoting sanitization)
  it('does not throw on FTS5-special characters', () => {
    for (const q of ['foo"bar', 'AND', '*', 'a OR b', 'zqxwv"']) {
      assert.doesNotThrow(() => searchItems(handle, { boardId: 'a', query: q }), `query ${JSON.stringify(q)} must not throw`);
    }
  });

  // AC5 — search composes with the Story 8.2 filter predicate (client-side intersection)
  it('composes with the filter predicate (intersection)', () => {
    const descriptor = { view: 'list', fields: [{ key: 'type', label: 'Type', type: 'enum', values: ['paper', 'post'] }] };
    const hits = searchItems(handle, { boardId: 'a', query: 'zqxwv' }); // a-title (paper) + a-body (post)
    const filtered = hits.filter((i) => matchesFilters(i, { type: 'paper' }, descriptor));
    assert.deepEqual(filtered.map((i) => i.id), ['a-title'], 'filter ∩ search → only the paper hit');
  });
});
