import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { eq } from 'drizzle-orm';

import { initDb } from './index.js';
import { boards, items } from './schema.js';
import { enqueueWrite, enqueueTransaction, writeItem } from './queue.js';

describe('single-writer queue (Story 1.3)', () => {
  let dir: string;
  let handle: ReturnType<typeof initDb>;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'board-oss-queue-'));
    handle = initDb(join(dir, 'queue.db'));
    // a board to satisfy item FK
    handle.db.insert(boards).values({ id: 'b', name: 'B', view: 'grid' }).run();
  });
  after(() => {
    handle.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  // AC 1 — busy_timeout set, non-zero
  it('sets a non-zero busy_timeout on the connection', () => {
    const bt = handle.sqlite.pragma('busy_timeout', { simple: true });
    assert.ok(Number(bt) > 0, `busy_timeout should be > 0, got ${bt}`);
  });

  // AC 3 — async read-modify-write serialization proof (NOT a count==N tautology)
  it('serializes concurrent async read-modify-writes with no lost updates', async () => {
    handle.sqlite.exec('CREATE TABLE counter (id INTEGER PRIMARY KEY, value INTEGER NOT NULL)');
    handle.sqlite.exec('INSERT INTO counter (id, value) VALUES (1, 0)');
    const read = handle.sqlite.prepare('SELECT value FROM counter WHERE id = 1');
    const write = handle.sqlite.prepare('UPDATE counter SET value = ? WHERE id = 1');

    const N = 64;
    const ops = Array.from({ length: N }, () =>
      enqueueWrite(async () => {
        const current = (read.get() as { value: number }).value;
        await new Promise((r) => setImmediate(r)); // yield — the interleaving window
        write.run(current + 1);
      }),
    );
    await Promise.all(ops);

    const final = (read.get() as { value: number }).value;
    assert.equal(final, N, `expected ${N}, got ${final} (lost updates → not serialized)`);
  });

  // AC 4 — a multi-step write that throws partway rolls back
  it('rolls back a transaction that throws partway (atomicity)', async () => {
    await assert.rejects(
      enqueueTransaction(handle, () => {
        handle.db.insert(items).values({ id: 'rollback-1', boardId: 'b', source: 'a' }).run();
        throw new Error('boom before step B');
      }),
      /boom/,
    );
    const row = handle.db.select().from(items).where(eq(items.id, 'rollback-1')).get();
    assert.equal(row, undefined, 'partial row must not persist after rollback');
  });

  // AC 5 — the typed item-write choke-point exists and persists through the writer
  it('writeItem persists an item through the serialized writer', async () => {
    await writeItem(handle, { id: 'wi-1', boardId: 'b', source: 'https://x', title: 'T' });
    const row = handle.db.select().from(items).where(eq(items.id, 'wi-1')).get();
    assert.equal(row?.title, 'T');
  });

  // AC 2 — operations run one at a time (ordering observable)
  it('runs enqueued operations strictly one at a time', async () => {
    const order: string[] = [];
    let active = 0;
    let maxActive = 0;
    const op = (label: string) =>
      enqueueWrite(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setImmediate(r));
        order.push(label);
        active -= 1;
      });
    await Promise.all([op('a'), op('b'), op('c')]);
    assert.equal(maxActive, 1, 'no two operations may run concurrently');
    assert.deepEqual(order, ['a', 'b', 'c'], 'operations preserve enqueue order');
  });
});
