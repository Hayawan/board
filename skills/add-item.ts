import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { boards } from '../db/schema.js';
import { writeItem } from '../db/queue.js';
import { captureRegistry } from '../capture/adapter.js';
import { runCaptureEnrichJob } from '../enrichment/pipeline.js';
import { config } from '../config.js';
import type { BoardDescriptor } from '../descriptor/types.js';
import { defineSkill } from './types.js';

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
    // Story 6.1/7.1: when an adapter is registered for the board's ingest_mode (and
    // it's not manual-upload), enqueue the shared capture→enrich pipeline as ONE job
    // (single `processing` state). Fire-and-forget — add-item returns the pending
    // item fast (optimistic save). No adapter registered → item stays pending.
    const ingestMode = (board.descriptor as BoardDescriptor | undefined)?.ingest_mode;
    if (ingestMode && ingestMode !== 'manual-upload' && input.source && captureRegistry.has(ingestMode)) {
      void runCaptureEnrichJob(ctx.db, {
        itemId,
        boardId: input.boardId,
        source: input.source,
        ingestMode,
        llm: ctx.llm,
        registry: captureRegistry,
        screenshotsDir: config.screenshotsDir,
      });
    }

    return { itemId, status: 'pending' };
  },
);
