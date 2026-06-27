import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { eq } from 'drizzle-orm';

import { buildServer } from '../server.js';
import { createRegistry, registerAllSkills } from './registry.js';
import { initDb } from '../db/index.js';
import { boards, items } from '../db/schema.js';

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

const TEST_DESCRIPTOR = {
  view: 'grid',
  ingest_mode: 'manual-upload',
  enrichment_prompt: 'x',
  fields: [
    { key: 'tags', label: 'Tags', type: 'tags', enrichable: false },
    { key: 'body', label: 'Body', type: 'text', enrichable: true },
  ],
};

describe('core skills: create-board / add-item / tag (Story 3.4)', () => {
  let dir: string;
  let handle: ReturnType<typeof initDb>;
  let app: Awaited<ReturnType<typeof buildServer>>;

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'board-oss-core-'));
    handle = initDb(join(dir, 'core.db'));
    const registry = createRegistry();
    registerAllSkills(registry);
    app = await buildServer({ registry, db: handle, logger: silentLogger });
  });
  after(() => {
    handle.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const post = (name: string, body: unknown) =>
    app.inject({ method: 'POST', url: `/skills/${name}`, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  // AC 1 — all three registered + reachable
  it('registers add-item, create-board, tag (reachable via the generic route)', () => {
    const reg = createRegistry();
    registerAllSkills(reg);
    for (const n of ['add-item', 'create-board', 'tag']) assert.ok(reg.get(n), `${n} not registered`);
  });

  // AC 3/4 — create-board inserts a board row from a validated descriptor
  it('create-board inserts a board row', async () => {
    const res = await post('create-board', { id: 'tb', name: 'Test Board', descriptor: TEST_DESCRIPTOR });
    assert.equal(res.statusCode, 200);
    const row = handle.db.select().from(boards).where(eq(boards.id, 'tb')).get();
    assert.equal(row?.name, 'Test Board');
    assert.equal(row?.view, 'grid');
  });

  it('create-board rejects an invalid descriptor (off-set field type)', async () => {
    const res = await post('create-board', {
      id: 'bad',
      name: 'Bad',
      descriptor: { ...TEST_DESCRIPTOR, fields: [{ key: 'x', label: 'X', type: 'datetime' }] },
    });
    assert.equal(res.statusCode, 400); // zod input validation at the route
  });

  // AC 3/4 — add-item creates a pending item (no enqueue)
  let createdItemId = '';
  it('add-item creates a status=pending item', async () => {
    const res = await post('add-item', { boardId: 'tb', source: 'https://x.example', fields: { body: 'hello' } });
    assert.equal(res.statusCode, 200);
    const out = JSON.parse(res.body) as { itemId: string; status: string };
    assert.equal(out.status, 'pending');
    createdItemId = out.itemId;
    const row = handle.db.select().from(items).where(eq(items.id, out.itemId)).get();
    assert.equal(row?.status, 'pending');
    assert.equal(row?.boardId, 'tb');
  });

  // AC 2 — tag updates the tags field AND the item becomes findable via FTS
  it('tag updates tags and the item is found by FTS for the new tag', async () => {
    const res = await post('tag', { itemId: createdItemId, tags: ['zqxwvtag', 'frobnicate'] });
    assert.equal(res.statusCode, 200);

    // load-bearing: FTS query for the new tag returns the item (index refreshed)
    const hits = (handle.sqlite.prepare('SELECT item_id FROM item_fts WHERE item_fts MATCH ?').all('zqxwvtag') as Array<{ item_id: string }>).map((r) => r.item_id);
    assert.deepEqual(hits, [createdItemId], 'FTS must return the item for the new tag');

    // secondary: the field changed
    const row = handle.db.select().from(items).where(eq(items.id, createdItemId)).get();
    assert.deepEqual((row?.fields as { tags: string[] }).tags, ['zqxwvtag', 'frobnicate']);
  });
});
