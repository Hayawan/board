import { eq } from 'drizzle-orm';

import { boards, items } from '../db/schema.js';
import { writeItem, type TimeoutFn } from '../db/queue.js';
import { runCaptureEnrichJob } from './pipeline.js';
import type { CaptureRegistry } from '../capture/adapter.js';
import type { LLMProvider } from '../skills/types.js';
import type { DbHandle } from '../db/index.js';

// Story 14.2 — the ONE assign verb. `assignItems` is the single code path that both
// the REST route (POST /api/v1/items/assign) and the composer (15.2) call — there is
// no second assign implementation. For each item it does a single-FK MOVE of
// `item.board_id` (never m2m / no join table, D12) THEN fires the earned-tier
// enrich-only job (14.1) against the TARGET board's descriptor.
//
// Load-bearing ordering: move FIRST, then enrich — `runEnrichmentForItem` derives the
// descriptor from `item.board_id` (enrichment/worker.ts), so the FK must already point
// at the target before enrichment reads it. Field preservation is by construction (the
// move keeps `fields`/assets untouched; the enrich merge `{...existing, ...enriched}`
// never deletes keys). Assigning back to the typeless Inbox early-returns in the worker
// (zero enrichable keys), so it's a safe no-op — no special revert path.

export interface AssignArgs {
  itemIds: string[];
  boardId: string;
  llm: LLMProvider;
  registry: CaptureRegistry;
  timeoutFn?: TimeoutFn;
}

export interface AssignResult {
  /** ids moved to the target (board_id changed) — an earned-enrich job was fired for each. */
  assigned: string[];
  /** ids already on the target — skipped (no move, no LLM churn). */
  skipped: string[];
  /** ids that don't exist. */
  notFound: string[];
  /** ids whose FK move threw — recorded, never aborting the rest of the batch. */
  failed: string[];
  /** resolves when all fired earned-enrich jobs settle (callers may ignore for optimistic UX). */
  settled: Promise<unknown>;
}

export async function assignItems(handle: DbHandle, args: AssignArgs): Promise<AssignResult> {
  // Validate the target board ONCE, before any move (so an unknown board moves nothing).
  const target = handle.db.select().from(boards).where(eq(boards.id, args.boardId)).get();
  if (!target) throw new Error(`Cannot assign: unknown board "${args.boardId}"`);

  const assigned: string[] = [];
  const skipped: string[] = [];
  const notFound: string[] = [];
  const failed: string[] = [];

  // PHASE 1 — all moves first. Fast serial single-FK writes that do NOT interleave
  // with the (slow) earned-enrich jobs, so a batch isn't paced by N LLM round-trips
  // mid-loop. Each move is guarded so one failure (DB constraint, etc.) records the id
  // and continues the batch rather than aborting it. Ids are de-duped so the same id
  // can't land in two result buckets. Same-board ids are skipped (no churn, AC5).
  for (const id of [...new Set(args.itemIds)]) {
    const item = handle.db.select().from(items).where(eq(items.id, id)).get();
    if (!item) {
      notFound.push(id);
      continue;
    }
    if (item.boardId === args.boardId) {
      skipped.push(id);
      continue;
    }
    try {
      // single-FK move via the typed write: search_blob recomputed against the TARGET
      // descriptor; `fields`/assets untouched (no itemAssets arg).
      await writeItem(handle, { ...item, boardId: args.boardId, updatedAt: Math.floor(Date.now() / 1000) });
      assigned.push(id);
    } catch {
      failed.push(id);
    }
  }

  // PHASE 2 — fire the earned-tier enrich-only job for every moved item (source omitted
  // → no re-capture; the cheap capture already ran in the Inbox). Every item's board_id
  // already points at the target, so enrichment reads the TARGET descriptor (AC3). Each
  // job's per-item failure becomes status=error via runItemJob and never aborts the
  // batch (allSettled + .catch). Not awaited here — callers wait on `settled` if they
  // want the enriched result (the manual route does; the bulk composer fire-and-forgets).
  const jobs = assigned.map((id) =>
    runCaptureEnrichJob(handle, {
      itemId: id,
      boardId: args.boardId,
      source: undefined,
      tier: 'earned',
      llm: args.llm,
      registry: args.registry,
      timeoutFn: args.timeoutFn,
    }).catch((e) => e),
  );

  return { assigned, skipped, notFound, failed, settled: Promise.allSettled(jobs) };
}
