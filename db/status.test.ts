import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { eq } from 'drizzle-orm';

import { initDb } from './index.js';
import { boards, items } from './schema.js';
import { runItemJob, reconcileInterruptedItems, type TimeoutFn } from './queue.js';
import { EnrichmentDisabledError } from '../skills/types.js';
import { LLMTransportError } from '../llm/provider.js';

const neverFires: TimeoutFn = () => () => {};
function manualTimeout(): { fn: TimeoutFn; fire: () => void } {
  let cb: (() => void) | null = null;
  return { fn: (c) => { cb = c; return () => (cb = null); }, fire: () => cb?.() };
}

describe('item status lifecycle (Story 5.2)', () => {
  let dir: string;
  let handle: ReturnType<typeof initDb>;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'board-oss-status-'));
    handle = initDb(join(dir, 's.db'));
    handle.db.insert(boards).values({ id: 'b', name: 'B', view: 'grid' }).run();
  });
  after(() => {
    handle.sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const seedItem = (id: string) => handle.db.insert(items).values({ id, boardId: 'b', source: 'x' }).run();
  const statusOf = (id: string) => handle.db.select().from(items).where(eq(items.id, id)).get();

  // AC 1 — pending → processing → done
  it('moves pending → processing → done on success', async () => {
    seedItem('ok');
    let sawProcessing = false;
    await runItemJob(handle, {
      itemId: 'ok',
      type: 'enrich',
      timeoutMs: 60_000,
      timeoutFn: neverFires,
      work: async () => {
        sawProcessing = statusOf('ok')?.status === 'processing';
      },
    });
    assert.equal(sawProcessing, true, 'status must be processing while work runs');
    assert.equal(statusOf('ok')?.status, 'done');
  });

  // AC 2 — throw → error + clean, mapped reason (no stack/secret)
  it('maps a thrown error to status=error + a clean reason', async () => {
    seedItem('boom');
    await runItemJob(handle, {
      itemId: 'boom',
      type: 'enrich',
      timeoutMs: 60_000,
      timeoutFn: neverFires,
      work: async () => {
        throw new LLMTransportError('ECONNREFUSED secret-host at /Users/x/llm.ts:1');
      },
    });
    const row = statusOf('boom');
    assert.equal(row?.status, 'error');
    assert.equal(row?.errorReason, 'could not reach the AI provider');
    assert.doesNotMatch(row?.errorReason ?? '', /secret-host|llm\.ts:1/, 'no raw error/stack leaked');
  });

  // AC 3 — EnrichmentDisabledError → done (NOT error)
  it('classifies EnrichmentDisabledError as done, not error', async () => {
    seedItem('disabled');
    await runItemJob(handle, {
      itemId: 'disabled',
      type: 'enrich',
      timeoutMs: 60_000,
      timeoutFn: neverFires,
      work: async () => {
        throw new EnrichmentDisabledError();
      },
    });
    const row = statusOf('disabled');
    assert.equal(row?.status, 'done', 'a no-AI install must not show error cards');
    assert.equal(row?.errorReason, null);
  });

  // AC 2 — timeout → error, not stuck processing
  it('marks a timed-out job error (not stuck processing)', async () => {
    seedItem('hang');
    const t = manualTimeout();
    const p = runItemJob(handle, {
      itemId: 'hang',
      type: 'capture',
      timeoutMs: 50,
      timeoutFn: t.fn,
      work: () => new Promise<void>(() => {}), // never resolves
    });
    await new Promise((r) => setImmediate(r));
    t.fire();
    await p;
    const row = statusOf('hang');
    assert.equal(row?.status, 'error');
    assert.equal(row?.errorReason, 'timed out');
  });

  // AC 4 — boot reconciliation: no item stuck processing across a crash
  it('reconciles orphaned processing items to error on boot', () => {
    seedItem('orphan');
    handle.db.update(items).set({ status: 'processing' }).where(eq(items.id, 'orphan')).run();
    const changed = reconcileInterruptedItems(handle);
    assert.ok(changed >= 1);
    const row = statusOf('orphan');
    assert.equal(row?.status, 'error');
    assert.equal(row?.errorReason, 'interrupted');
  });
});
