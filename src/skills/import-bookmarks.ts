import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { importRecords } from '../db/importer.js';
import { boards } from '../db/schema.js';
import { defineSkill } from './types.js';

// Story 3.3 — import-bookmarks as a first-class Skill (FR-20 part 2). A THIN wrapper
// over Story 1.5's board-agnostic per-record mapper (`importRecords`): it does NOT
// reimplement record→item mapping (two copies would drift). It adds the Skill
// contract + target-board validation; the core writes through the typed item-write
// helper, so items land at status=pending with search_blob/FTS maintained and
// dedupe by the preserved `item.id`.
//
// Records are descriptor-shaped/freeform → `z.record(z.unknown())`, NOT `z.any()`
// (FR-19 forbids any-typed skill I/O).
export const importBookmarksSkill = defineSkill(
  'import-bookmarks',
  z.object({
    boardId: z.string().min(1),
    bookmarks: z.array(z.record(z.unknown())),
  }),
  z.object({
    created: z.number(),
    skipped: z.number(),
    itemIds: z.array(z.string()),
  }),
  async (input, ctx) => {
    const board = ctx.db.db.select().from(boards).where(eq(boards.id, input.boardId)).get();
    if (!board) {
      throw new Error(`Cannot import: unknown target board "${input.boardId}"`);
    }
    return importRecords({ handle: ctx.db, boardId: input.boardId, records: input.bookmarks });
  },
);
