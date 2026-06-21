import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { boards } from '../db/schema.js';
import { writeItem } from '../db/queue.js';
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

    // Epic 6 seam: enqueue a capture/enrichment job for this pending item here,
    // once the single-writer job worker (5.1) and a CaptureAdapter (Epic 6) exist.

    return { itemId, status: 'pending' };
  },
);
