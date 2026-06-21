import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { boards } from '../db/schema.js';
import { writeItem, runItemJob } from '../db/queue.js';
import { captureRegistry, runCaptureForItem } from '../capture/adapter.js';
import { runEnrichmentForItem } from '../enrichment/worker.js';
import { config } from '../config.js';
import type { BoardDescriptor } from '../descriptor/types.js';
import { defineSkill } from './types.js';

// Wall-clock cap for a capture job (Story 6.5 owns the authoritative value/config).
const CAPTURE_TIMEOUT_MS = 60_000;

// Story 3.4 — add-item: create a PENDING item under a board. v1 scope is exactly
// "create the pending item, full stop". It deliberately does NOT enqueue a
// capture/enrichment job — there is no worker draining the queue (Story 5.1) and no
// capture adapter (Epic 6) yet, so an enqueue would dangle. The enqueue is a
// documented seam Epic 6 fills.
export const addItemSkill = defineSkill(
  'add-item',
  z.object({
    boardId: z.string().min(1),
    source: z.string().optional(),
    // freeform, descriptor-shaped — z.record(z.unknown()), NOT z.any() (FR-19).
    fields: z.record(z.unknown()).optional(),
  }),
  z.object({ itemId: z.string(), status: z.string() }),
  async (input, ctx) => {
    const board = ctx.db.db.select().from(boards).where(eq(boards.id, input.boardId)).get();
    if (!board) {
      throw new Error(`Cannot add item: unknown board "${input.boardId}"`);
    }

    const itemId = randomUUID();
    await writeItem(ctx.db, {
      id: itemId,
      boardId: input.boardId,
      source: input.source ?? null,
      fields: input.fields ?? {},
      status: 'pending',
    });

    // Story 6.1: enqueue a capture job (hop 1) on the single worker — but ONLY when
    // an adapter is registered for the board's ingest_mode (so this is a no-op until
    // 6.2–6.4 register adapters, and manual-upload boards wait for an upload, 6.4).
    // Fire-and-forget: add-item returns the pending item fast (optimistic save).
    const ingestMode = (board.descriptor as BoardDescriptor | undefined)?.ingest_mode;
    if (ingestMode && ingestMode !== 'manual-upload' && input.source && captureRegistry.has(ingestMode)) {
      const source = input.source;
      // Story 6.5: the adapter registers its browser teardown here; the job's
      // `teardown` awaits it so the worker won't launch the next capture until this
      // one's browser is confirmed dead (two Chromiums never coexist).
      let captureTeardown: (() => Promise<void>) | undefined;
      void runItemJob(ctx.db, {
        itemId,
        type: 'capture',
        timeoutMs: CAPTURE_TIMEOUT_MS,
        // Hop 1 (capture) THEN hop 2 (enrich) inline in ONE job, so the item holds a
        // single `processing` state until enriched (Story 5.3 contract), not
        // done→processing→done. Disabled/failed enrichment propagates to the 5.2
        // classifier (disabled → done with the captured fields; other errors → error).
        work: async (signal) => {
          await runCaptureForItem(ctx.db, captureRegistry, {
            itemId,
            boardId: input.boardId,
            source,
            signal,
            screenshotsDir: config.screenshotsDir,
            registerTeardown: (fn) => { captureTeardown = fn; },
          });
          await runEnrichmentForItem(ctx.db, { itemId, llm: ctx.llm, signal });
        },
        teardown: async () => { if (captureTeardown) await captureTeardown(); },
      });
    }

    return { itemId, status: 'pending' };
  },
);
