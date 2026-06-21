import { runItemJob, type JobResult, type TimeoutFn } from '../db/queue.js';
import { runCaptureForItem, type CaptureRegistry, type CaptureSource } from '../capture/adapter.js';
import { runEnrichmentForItem } from './worker.js';
import type { LLMProvider } from '../skills/types.js';
import type { DbHandle } from '../db/index.js';

// Story 7.1/7.3 — the shared capture→enrich pipeline as ONE worker job, so the item
// holds a single `processing` state until enriched (Story 5.3 contract). Used by
// add-item (hop 1+2 for a new item) and refetch (re-run for an existing item).
// Preservation is by construction: capture merges captured fields + lifts system
// columns; enrichment writes ONLY enrichable schema keys — so notes/favorite and
// enrichable:false fields survive.

const DEFAULT_CAPTURE_TIMEOUT_MS = 60_000;

export interface CaptureEnrichArgs {
  itemId: string;
  boardId: string;
  /** URL/upload source for capture; omit to skip capture (enrich only). */
  source?: CaptureSource | null;
  llm: LLMProvider;
  registry: CaptureRegistry;
  ingestMode?: string;
  screenshotsDir?: string;
  timeoutMs?: number;
  timeoutFn?: TimeoutFn;
}

/**
 * Enqueue a single worker job that runs capture (when a source + a registered adapter
 * exist and the board isn't manual-upload) then enrichment. Returns the job result.
 * Capture's browser teardown is awaited by the worker before the next capture (6.5).
 */
export function runCaptureEnrichJob(handle: DbHandle, args: CaptureEnrichArgs): Promise<JobResult> {
  let captureTeardown: (() => Promise<void>) | undefined;
  const canCapture =
    !!args.source &&
    args.ingestMode !== 'manual-upload' &&
    !!args.ingestMode &&
    args.registry.has(args.ingestMode);

  return runItemJob(handle, {
    itemId: args.itemId,
    type: 'capture',
    timeoutMs: args.timeoutMs ?? DEFAULT_CAPTURE_TIMEOUT_MS,
    timeoutFn: args.timeoutFn,
    work: async (signal) => {
      if (canCapture) {
        await runCaptureForItem(handle, args.registry, {
          itemId: args.itemId,
          boardId: args.boardId,
          source: args.source as CaptureSource,
          signal,
          screenshotsDir: args.screenshotsDir,
          registerTeardown: (fn) => { captureTeardown = fn; },
        });
      }
      await runEnrichmentForItem(handle, { itemId: args.itemId, llm: args.llm, signal });
    },
    teardown: async () => { if (captureTeardown) await captureTeardown(); },
  });
}
