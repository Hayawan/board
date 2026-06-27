import { eq } from 'drizzle-orm';

import { config } from '../config.js';
import { archivesOnPromote, type BoardDescriptor } from '../descriptor/types.js';
import { runSnapshotJob } from '../capture/url-snapshot.js';
import type { DbHandle } from './index.js';
import { assets, boards, items } from './schema.js';

// Story 16.3 — serial, resumable, idempotent-by-item-id backfill. Snapshots existing
// items on archive-on-promote boards (Story 16.2 eligibility) that have NO snapshot yet.
//
// NEVER parallel Chromium (NFR-1): each item is enqueued onto the SAME concurrency-1
// worker (16.1's enqueueJob via runSnapshotJob), so they drain serially — slow-but-safe
// is the accepted trade. Idempotency is BY ITEM ID: an item that already has a
// kind='snapshot' asset is skipped, so a re-run (or a crash-resume) creates no
// duplicates. Read-then-skip is additive only — it never alters existing assets/items.

export interface BackfillDeps {
  /** Injectable enqueue (tests spy so no Chrome runs). Default: fire the 16.1 job serially. */
  enqueueSnapshot?: (args: { itemId: string; url: string | null }) => void;
  /** Snapshots dir for the default enqueue (defaults to config). */
  snapshotsDir?: string;
}

export interface BackfillResult {
  /** item ids a snapshot job was enqueued for (eligible, had a source, lacked a snapshot). */
  enqueued: string[];
  /** eligible items skipped because they ALREADY have a snapshot (idempotency). */
  skippedSnapshotted: string[];
  /** eligible items skipped because they have no source URL to snapshot. */
  skippedNoSource: string[];
  /** count of items skipped because their board is not archive-on-promote. */
  skippedIneligible: number;
}

export function backfillSnapshots(handle: DbHandle, deps: BackfillDeps = {}): BackfillResult {
  const snapshotsDir = deps.snapshotsDir ?? config.snapshotsDir;
  // Default enqueue is FIRE-AND-FORGET (the jobs serialize on the one worker but their
  // promises are dropped). A caller that needs to AWAIT the drain before exiting/closing
  // the DB must inject its own promise-collecting enqueue (the CLI does exactly this).
  const enqueueSnapshot =
    deps.enqueueSnapshot ??
    ((a: { itemId: string; url: string | null }) => {
      if (a.url) void runSnapshotJob(handle, { itemId: a.itemId, url: a.url, snapshotsDir });
    });

  // Eligible boards (archive-on-promote, Story 16.2).
  const eligibleBoardIds = new Set(
    handle.db
      .select()
      .from(boards)
      .all()
      .filter((b) => archivesOnPromote(b.descriptor as BoardDescriptor | undefined))
      .map((b) => b.id),
  );
  // Item ids that already have a snapshot asset (idempotency predicate — same property
  // that makes 16.1's `${itemId}-snapshot` upsert non-duplicating).
  const alreadySnapshotted = new Set(
    handle.db.select().from(assets).where(eq(assets.kind, 'snapshot')).all().map((a) => a.itemId),
  );

  const enqueued: string[] = [];
  const skippedSnapshotted: string[] = [];
  const skippedNoSource: string[] = [];
  let skippedIneligible = 0;

  // Serial loop — each enqueue lands on the single worker; they drain one at a time.
  for (const it of handle.db.select().from(items).all()) {
    if (!eligibleBoardIds.has(it.boardId)) { skippedIneligible += 1; continue; }
    if (alreadySnapshotted.has(it.id)) { skippedSnapshotted.push(it.id); continue; }
    if (!it.source) { skippedNoSource.push(it.id); continue; }
    enqueueSnapshot({ itemId: it.id, url: it.source });
    enqueued.push(it.id);
  }

  return { enqueued, skippedSnapshotted, skippedNoSource, skippedIneligible };
}
