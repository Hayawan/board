import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';

import { initDb } from './index.js';
import { seed, LIBRARY_BOARD_ID, INSPIRATION_BOARD_ID, LIBRARY_DESCRIPTOR } from './seed.js';
import { boards, items, assets } from './schema.js';
import { backfillSnapshots } from './archive-backfill.js';

// Story 16.3 — serial, resumable, idempotent-by-item-id backfill of snapshots over
// existing items on archive-on-promote boards. Tests inject a fake enqueue (records ids
// AND writes a snapshot asset row, mirroring 16.1) so no Chrome runs and idempotency is
// observable across re-runs.

describe('backfillSnapshots (Story 16.3)', () => {
  function setup() {
    const dir = mkdtempSync(join(tmpdir(), 'board-oss-bf-'));
    const handle = initDb(join(dir, 'c.db'));
    seed(handle.db);
    // flag Library archive-on-promote; Inspiration stays unflagged (ineligible)
    handle.db.update(boards).set({ descriptor: { ...LIBRARY_DESCRIPTOR, archive_on_promote: true } }).where(eq(boards.id, LIBRARY_BOARD_ID)).run();
    return { dir, handle };
  }
  // A fake enqueue that records the id AND simulates 16.1's additive snapshot write, so a
  // re-run sees the item as already-snapshotted (idempotency by item id).
  function recordingEnqueue(handle: any) {
    const ids: string[] = [];
    return {
      ids,
      enqueueSnapshot: (a: { itemId: string; url: string | null }) => {
        ids.push(a.itemId);
        handle.db.insert(assets).values({ id: `${a.itemId}-snapshot`, itemId: a.itemId, kind: 'snapshot', path: `snapshots/${a.itemId}.html`, hash: 'h' }).run();
      },
    };
  }

  // AC 2 — enqueues for exactly the eligible-without-snapshot items; skips already-
  // snapshotted + non-eligible-board items; a second run enqueues nothing (idempotent).
  it('backfills eligible items once, skips snapshotted + ineligible, and is idempotent', () => {
    const { dir, handle } = setup();
    try {
      handle.db.insert(items).values({ id: 'e1', boardId: LIBRARY_BOARD_ID, source: 'https://1' }).run();
      handle.db.insert(items).values({ id: 'e2', boardId: LIBRARY_BOARD_ID, source: 'https://2' }).run();
      handle.db.insert(items).values({ id: 'e3', boardId: LIBRARY_BOARD_ID, source: 'https://3' }).run();
      // e3 ALREADY has a snapshot → must be skipped
      handle.db.insert(assets).values({ id: 'e3-snapshot', itemId: 'e3', kind: 'snapshot', path: 'snapshots/e3.html', hash: 'h' }).run();
      // n1 is on the UNFLAGGED board → ineligible
      handle.db.insert(items).values({ id: 'n1', boardId: INSPIRATION_BOARD_ID, source: 'https://n' }).run();

      const rec = recordingEnqueue(handle);
      const r1 = backfillSnapshots(handle, { enqueueSnapshot: rec.enqueueSnapshot });
      assert.deepEqual(r1.enqueued.sort(), ['e1', 'e2'], 'only eligible-without-snapshot items');
      assert.ok(r1.skippedSnapshotted.includes('e3'), 'already-snapshotted skipped');
      assert.deepEqual(rec.ids.sort(), ['e1', 'e2']);

      // second run: e1/e2 now have snapshots (the fake wrote them) → zero new enqueues
      const r2 = backfillSnapshots(handle, { enqueueSnapshot: rec.enqueueSnapshot });
      assert.deepEqual(r2.enqueued, [], 'idempotent — re-run creates no duplicates');
      assert.equal(rec.ids.length, 2, 'no item ever enqueued twice');

      // n1 (ineligible board) was never enqueued, in either run
      assert.ok(!rec.ids.includes('n1'), 'non-eligible-board item never archived');
    } finally {
      handle.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // AC 3 — backfill never touches existing screenshot assets / item fields.
  it('does not alter existing screenshot assets or item fields (no-regression)', () => {
    const { dir, handle } = setup();
    try {
      handle.db.insert(items).values({ id: 'k1', boardId: LIBRARY_BOARD_ID, source: 'https://k', fields: { summary: 'keep' } }).run();
      handle.db.insert(assets).values({ id: 'k1-shot', itemId: 'k1', kind: 'screenshot', path: 'screenshots/k1.png', hash: 'shot' }).run();

      backfillSnapshots(handle, { enqueueSnapshot: recordingEnqueue(handle).enqueueSnapshot });

      // additive: the backfill DID act on k1 (snapshot added) — so "untouched screenshot"
      // is meaningful coexistence, not vacuously true because k1 was skipped entirely.
      assert.ok(handle.db.select().from(assets).where(eq(assets.id, 'k1-snapshot')).get(), 'snapshot added alongside the screenshot');
      const shot = handle.db.select().from(assets).where(eq(assets.id, 'k1-shot')).get();
      assert.ok(shot && shot.kind === 'screenshot' && shot.hash === 'shot', 'screenshot asset untouched');
      assert.equal((handle.db.select().from(items).where(eq(items.id, 'k1')).get()!.fields as any).summary, 'keep', 'item fields untouched');
    } finally {
      handle.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // an eligible item with no source URL can't be snapshotted → skipped (not enqueued).
  it('skips eligible items that have no source URL', () => {
    const { dir, handle } = setup();
    try {
      handle.db.insert(items).values({ id: 's1', boardId: LIBRARY_BOARD_ID, source: null as any }).run();
      const rec = recordingEnqueue(handle);
      const r = backfillSnapshots(handle, { enqueueSnapshot: rec.enqueueSnapshot });
      assert.deepEqual(r.enqueued, []);
      assert.ok(r.skippedNoSource.includes('s1'));
    } finally {
      handle.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
