import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { eq } from 'drizzle-orm';
import type { ZodType } from 'zod';

import { initDb } from '../db/index.js';
import { items } from '../db/schema.js';
import { seed, INSPIRATION_BOARD_ID, LIBRARY_BOARD_ID, INBOX_BOARD_ID } from '../db/seed.js';
import { createCaptureRegistry } from '../capture/adapter.js';
import { disabledLlm, type LLMProvider } from '../skills/types.js';
import type { TimeoutFn } from '../db/queue.js';
import { assignItems } from './assign.js';

// Story 14.2 — the ONE assign verb: assignItems moves item.board_id (single-FK,
// never m2m) THEN fires earned-tier enrich-only against the TARGET board descriptor.

const neverFires: TimeoutFn = () => () => {};

function spyProvider(returns: Record<string, unknown> = {}) {
  const prompts: string[] = [];
  const llm: LLMProvider = {
    complete: async <T>(prompt: string, _schema: ZodType<T>) => {
      prompts.push(prompt);
      return returns as T;
    },
  };
  return { llm, calls: () => prompts.length, prompts };
}

function fakeRegistry() {
  const reg = createCaptureRegistry();
  reg.register({ ingestMode: 'url-screenshot', fetch: async () => ({ fields: {}, assets: [] }) });
  return reg;
}

function db() {
  const dir = mkdtempSync(join(tmpdir(), 'board-oss-assign-'));
  const handle = initDb(join(dir, 'a.db'));
  seed(handle.db);
  return { dir, handle };
}

describe('Story 14.2 — assignItems: single-FK move + earned tier (AC1/AC3)', () => {
  it('moves board_id to the target then enriches against the target descriptor', async () => {
    const { dir, handle } = db();
    try {
      handle.db.insert(items).values({ id: 'i1', boardId: INBOX_BOARD_ID, source: 'https://x', title: 'T' }).run();
      const spy = spyProvider();
      const res = await assignItems(handle, {
        itemIds: ['i1'], boardId: INSPIRATION_BOARD_ID, llm: spy.llm, registry: fakeRegistry(), timeoutFn: neverFires,
      });
      await res.settled;
      assert.deepEqual(res.assigned, ['i1']);
      assert.equal(handle.db.select().from(items).where(eq(items.id, 'i1')).get()?.boardId, INSPIRATION_BOARD_ID);
      assert.equal(spy.calls(), 1, 'earned tier fires once');
      assert.match(spy.prompts[0], /design inspiration/i, 'enriches against the TARGET board descriptor');
    } finally {
      handle.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Story 14.2 — field preservation + idempotency + reversibility (AC4/AC5)', () => {
  it('preserves unmapped cheap fields through assignment (merge, never delete)', async () => {
    const { dir, handle } = db();
    try {
      handle.db.insert(items).values({
        id: 'i2', boardId: INBOX_BOARD_ID, source: 'https://x',
        fields: { title: 'T', 'cheap.note': 'keep me' },
      }).run();
      const spy = spyProvider({ 'meta.form': 'saas' });
      const res = await assignItems(handle, {
        itemIds: ['i2'], boardId: INSPIRATION_BOARD_ID, llm: spy.llm, registry: fakeRegistry(), timeoutFn: neverFires,
      });
      await res.settled;
      const fields = handle.db.select().from(items).where(eq(items.id, 'i2')).get()?.fields as Record<string, unknown>;
      assert.equal(fields['cheap.note'], 'keep me', 'unmapped cheap field preserved');
      assert.equal(fields['meta.form'], 'saas', 'enriched field merged in');
    } finally {
      handle.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('same-board re-assign does NOT re-fire the LLM (no churn)', async () => {
    const { dir, handle } = db();
    try {
      handle.db.insert(items).values({ id: 'i3', boardId: INSPIRATION_BOARD_ID, source: 'https://x' }).run();
      const spy = spyProvider();
      const res = await assignItems(handle, {
        itemIds: ['i3'], boardId: INSPIRATION_BOARD_ID, llm: spy.llm, registry: fakeRegistry(), timeoutFn: neverFires,
      });
      await res.settled;
      assert.deepEqual(res.skipped, ['i3']);
      assert.deepEqual(res.assigned, []);
      assert.equal(spy.calls(), 0, 'same-board re-assign must not re-fire the LLM');
    } finally {
      handle.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('assign BACK to the typeless Inbox is a safe no-op enrichment (fields preserved)', async () => {
    const { dir, handle } = db();
    try {
      handle.db.insert(items).values({
        id: 'i4', boardId: INSPIRATION_BOARD_ID, source: 'https://x',
        fields: { 'meta.form': 'saas', 'cheap.note': 'keep me' },
      }).run();
      const spy = spyProvider();
      const res = await assignItems(handle, {
        itemIds: ['i4'], boardId: INBOX_BOARD_ID, llm: spy.llm, registry: fakeRegistry(), timeoutFn: neverFires,
      });
      await res.settled;
      const row = handle.db.select().from(items).where(eq(items.id, 'i4')).get();
      assert.equal(row?.boardId, INBOX_BOARD_ID, 'moved back to Inbox');
      assert.equal(spy.calls(), 0, 'typeless Inbox → earned tier early-returns, no LLM');
      const fields = row?.fields as Record<string, unknown>;
      assert.equal(fields['cheap.note'], 'keep me', 'cheap fields preserved on the round-trip');
      assert.equal(fields['meta.form'], 'saas');
    } finally {
      handle.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Story 14.2 — batch + error handling (AC1/AC7)', () => {
  it('assigns a batch of items; one unknown id does not abort the rest', async () => {
    const { dir, handle } = db();
    try {
      handle.db.insert(items).values({ id: 'b1', boardId: INBOX_BOARD_ID, source: 'https://1' }).run();
      handle.db.insert(items).values({ id: 'b2', boardId: INBOX_BOARD_ID, source: 'https://2' }).run();
      const res = await assignItems(handle, {
        itemIds: ['b1', 'missing', 'b2'], boardId: LIBRARY_BOARD_ID, llm: disabledLlm, registry: fakeRegistry(), timeoutFn: neverFires,
      });
      await res.settled;
      assert.deepEqual(res.assigned.sort(), ['b1', 'b2']);
      assert.deepEqual(res.notFound, ['missing']);
      assert.equal(handle.db.select().from(items).where(eq(items.id, 'b1')).get()?.boardId, LIBRARY_BOARD_ID);
      assert.equal(handle.db.select().from(items).where(eq(items.id, 'b2')).get()?.boardId, LIBRARY_BOARD_ID);
    } finally {
      handle.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws on an unknown target board (before any move)', async () => {
    const { dir, handle } = db();
    try {
      handle.db.insert(items).values({ id: 'c1', boardId: INBOX_BOARD_ID, source: 'https://x' }).run();
      await assert.rejects(
        assignItems(handle, { itemIds: ['c1'], boardId: 'no-such-board', llm: disabledLlm, registry: fakeRegistry(), timeoutFn: neverFires }),
        /board/i,
      );
      assert.equal(handle.db.select().from(items).where(eq(items.id, 'c1')).get()?.boardId, INBOX_BOARD_ID, 'no move on unknown board');
    } finally {
      handle.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // AC7 (review fix) — a genuinely FAILING enrich job must not abort the batch. A
  // throwing LLM makes each earned enrichment fail; both items must still be MOVED
  // (FK durable) and land at a terminal status — settled resolves, no throw escapes.
  it('a failing enrich job does not abort the batch (moves durable, terminal status)', async () => {
    const { dir, handle } = db();
    try {
      handle.db.insert(items).values({ id: 'f1', boardId: INBOX_BOARD_ID, source: 'https://1' }).run();
      handle.db.insert(items).values({ id: 'f2', boardId: INBOX_BOARD_ID, source: 'https://2' }).run();
      const throwingLlm: LLMProvider = {
        complete: async () => { throw new Error('LLM exploded'); },
      };
      const res = await assignItems(handle, {
        itemIds: ['f1', 'f2'], boardId: INSPIRATION_BOARD_ID, llm: throwingLlm, registry: fakeRegistry(), timeoutFn: neverFires,
      });
      await res.settled; // must not reject despite the failing jobs
      assert.deepEqual(res.assigned.sort(), ['f1', 'f2'], 'both items moved despite enrich failure');
      assert.deepEqual(res.failed, [], 'the FK moves themselves did not fail');
      for (const id of ['f1', 'f2']) {
        const row = handle.db.select().from(items).where(eq(items.id, id)).get();
        assert.equal(row?.boardId, INSPIRATION_BOARD_ID, 'FK move is durable even when enrichment fails');
        assert.equal(row?.status, 'error', 'a failed enrichment lands the item at status=error, not stuck');
      }
    } finally {
      handle.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Story 14.2 — NO item is ever auto-assigned (AC6, NFR-BC)', () => {
  it('seeding + having the assign helper available moves nothing until an explicit call', async () => {
    const { dir, handle } = db();
    try {
      // existing items on existing boards (the pre-wave shape)
      handle.db.insert(items).values({ id: 'keep-1', boardId: INSPIRATION_BOARD_ID, source: 'https://a', fields: { 'meta.form': 'saas' }, status: 'done' }).run();
      handle.db.insert(items).values({ id: 'keep-2', boardId: LIBRARY_BOARD_ID, source: 'https://b', fields: { summary: 'S' }, status: 'done' }).run();
      const before1 = handle.db.select().from(items).where(eq(items.id, 'keep-1')).get();
      const before2 = handle.db.select().from(items).where(eq(items.id, 'keep-2')).get();

      // assign helper is imported/available — but we never call it for these items.
      // (An explicit, unrelated assign of a THIRD item proves only the named item moves.)
      handle.db.insert(items).values({ id: 'mover', boardId: INBOX_BOARD_ID, source: 'https://c' }).run();
      const res = await assignItems(handle, {
        itemIds: ['mover'], boardId: INSPIRATION_BOARD_ID, llm: disabledLlm, registry: fakeRegistry(), timeoutFn: neverFires,
      });
      await res.settled;

      // the pre-existing items are byte-for-byte unchanged — nothing auto-assigned
      assert.deepEqual(handle.db.select().from(items).where(eq(items.id, 'keep-1')).get(), before1);
      assert.deepEqual(handle.db.select().from(items).where(eq(items.id, 'keep-2')).get(), before2);
      assert.equal(handle.db.select().from(items).where(eq(items.id, 'mover')).get()?.boardId, INSPIRATION_BOARD_ID, 'only the named item moved');
    } finally {
      handle.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// Story 16.2 — opt-in archival trigger on the ONE assign verb.
describe('assignItems archival trigger (Story 16.2)', () => {
  it('enqueues a snapshot when the TARGET board archives-on-promote, preserving the takeaway', async () => {
    const { boards } = await import('../db/schema.js');
    const { LIBRARY_DESCRIPTOR } = await import('../db/seed.js');
    const { dir, handle } = db();
    try {
      // flag the Library board archive-on-promote (additive descriptor edit)
      handle.db.update(boards).set({ descriptor: { ...LIBRARY_DESCRIPTOR, archive_on_promote: true } }).where(eq(boards.id, LIBRARY_BOARD_ID)).run();
      // an Inbox item with NO takeaway yet — the earned tier writes it on promotion.
      handle.db.insert(items).values({ id: 'arch1', boardId: INBOX_BOARD_ID, source: 'https://archive.me/x' }).run();

      // Real earned-tier enrichment (spy LLM) writes the takeaway into item.fields; the
      // snapshot trigger must fire ALONGSIDE it — proving the differentiator across the
      // actual enrich+trigger seam (not a hand-seeded field under a disabled LLM).
      const spy = spyProvider({ summary: 'earned takeaway' });
      const snaps: Array<{ itemId: string; url: string | null }> = [];
      const res = await assignItems(handle, {
        itemIds: ['arch1'], boardId: LIBRARY_BOARD_ID, llm: spy.llm, registry: fakeRegistry(),
        timeoutFn: neverFires, enqueueSnapshot: (a) => snaps.push(a),
      });
      await res.settled;

      assert.deepEqual(res.assigned, ['arch1']);
      assert.equal(snaps.length, 1, 'exactly one snapshot enqueued for the promoted item');
      assert.deepEqual(snaps[0], { itemId: 'arch1', url: 'https://archive.me/x' });
      // the enrichment-WRITTEN takeaway coexists with the snapshot trigger (not clobbered)
      const row = handle.db.select().from(items).where(eq(items.id, 'arch1')).get()!;
      assert.equal((row.fields as any).summary, 'earned takeaway', 'the earned takeaway the enricher wrote is intact');
      assert.equal(row.boardId, LIBRARY_BOARD_ID);
    } finally {
      handle.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does NOT enqueue a snapshot when the target board is not flagged (default off)', async () => {
    const { dir, handle } = db();
    try {
      handle.db.insert(items).values({ id: 'noarch1', boardId: INBOX_BOARD_ID, source: 'https://x' }).run();
      const snaps: unknown[] = [];
      const res = await assignItems(handle, {
        itemIds: ['noarch1'], boardId: LIBRARY_BOARD_ID, llm: disabledLlm, registry: fakeRegistry(),
        timeoutFn: neverFires, enqueueSnapshot: (a) => snaps.push(a),
      });
      await res.settled;
      assert.deepEqual(res.assigned, ['noarch1']);
      assert.equal(snaps.length, 0, 'unflagged board → no snapshot (the cheap path is unchanged)');
    } finally {
      handle.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does NOT enqueue snapshots for items already on the flagged board (skipped, no re-archive)', async () => {
    const { boards } = await import('../db/schema.js');
    const { LIBRARY_DESCRIPTOR } = await import('../db/seed.js');
    const { dir, handle } = db();
    try {
      handle.db.update(boards).set({ descriptor: { ...LIBRARY_DESCRIPTOR, archive_on_promote: true } }).where(eq(boards.id, LIBRARY_BOARD_ID)).run();
      handle.db.insert(items).values({ id: 'already', boardId: LIBRARY_BOARD_ID, source: 'https://x' }).run();
      const snaps: unknown[] = [];
      const res = await assignItems(handle, {
        itemIds: ['already'], boardId: LIBRARY_BOARD_ID, llm: disabledLlm, registry: fakeRegistry(),
        timeoutFn: neverFires, enqueueSnapshot: (a) => snaps.push(a),
      });
      await res.settled;
      assert.deepEqual(res.skipped, ['already']);
      assert.equal(snaps.length, 0, 'a same-board no-op assign archives nothing');
    } finally {
      handle.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

  it('enqueues a snapshot for each MOVED item in a batch and nothing for skipped ones', async () => {
    const { boards } = await import('../db/schema.js');
    const { LIBRARY_DESCRIPTOR } = await import('../db/seed.js');
    const { dir, handle } = db();
    try {
      handle.db.update(boards).set({ descriptor: { ...LIBRARY_DESCRIPTOR, archive_on_promote: true } }).where(eq(boards.id, LIBRARY_BOARD_ID)).run();
      handle.db.insert(items).values({ id: 'm1', boardId: INBOX_BOARD_ID, source: 'https://a' }).run();
      handle.db.insert(items).values({ id: 'm2', boardId: INBOX_BOARD_ID, source: 'https://b' }).run();
      handle.db.insert(items).values({ id: 'already', boardId: LIBRARY_BOARD_ID, source: 'https://c' }).run(); // skipped

      const snaps: Array<{ itemId: string; url: string | null }> = [];
      const res = await assignItems(handle, {
        itemIds: ['m1', 'm2', 'already'], boardId: LIBRARY_BOARD_ID, llm: disabledLlm, registry: fakeRegistry(),
        timeoutFn: neverFires, enqueueSnapshot: (a) => snaps.push(a),
      });
      await res.settled;
      assert.deepEqual(res.assigned.sort(), ['m1', 'm2']);
      assert.deepEqual(res.skipped, ['already']);
      assert.deepEqual(snaps.map((s) => s.itemId).sort(), ['m1', 'm2'], 'exactly the moved items archived — not the skipped one');
    } finally {
      handle.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
