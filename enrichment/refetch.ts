import { eq } from 'drizzle-orm';

import { boards, items } from '../db/schema.js';
import { runCaptureEnrichJob } from './pipeline.js';
import type { CaptureRegistry } from '../capture/adapter.js';
import type { BoardDescriptor } from '../descriptor/types.js';
import type { LLMProvider } from '../skills/types.js';
import type { JobResult, TimeoutFn } from '../db/queue.js';
import type { DbHandle } from '../db/index.js';

// Story 7.3 — refetch: re-run capture + enrichment for an EXISTING item to refresh
// analysis, WITHOUT losing user-authored fields. Preservation is by construction —
// the capture+enrich pipeline merges captured fields and writes only enrichable
// schema keys, so notes/favorite (columns) and enrichable:false fields survive; the
// item id is unchanged and the asset is replaced (idempotent capture, Story 6.1).
// This is also the "Retry analysis" path for a status=error item (Story 8.5).
export async function refetchItem(
  handle: DbHandle,
  args: { itemId: string; registry: CaptureRegistry; llm: LLMProvider; screenshotsDir?: string; timeoutFn?: TimeoutFn },
): Promise<JobResult> {
  const item = handle.db.select().from(items).where(eq(items.id, args.itemId)).get();
  if (!item) throw new Error(`Cannot refetch: unknown item "${args.itemId}"`);
  const board = handle.db.select().from(boards).where(eq(boards.id, item.boardId)).get();
  const ingestMode = (board?.descriptor as BoardDescriptor | undefined)?.ingest_mode;

  return runCaptureEnrichJob(handle, {
    itemId: item.id,
    boardId: item.boardId,
    source: item.source ?? undefined,
    ingestMode,
    llm: args.llm,
    registry: args.registry,
    screenshotsDir: args.screenshotsDir,
    timeoutFn: args.timeoutFn,
  });
}
