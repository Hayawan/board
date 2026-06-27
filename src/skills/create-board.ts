import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { boards } from '../db/schema.js';
import { insertBoard } from '../db/seed.js';
import { BoardDescriptorSchema } from '../descriptor/types.js';
import { defineSkill } from './types.js';

// Story 3.4 — create-board: the board PERSISTENCE PRIMITIVE. Takes a VALIDATED
// descriptor and inserts a board row, REUSING Story 1.2's descriptor schema +
// the shared `insertBoard` helper (no forked board-insert path). NL→descriptor
// generation is Epic 10's composer, which calls this skill on accept.
export const createBoardSkill = defineSkill(
  'create-board',
  z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    descriptor: BoardDescriptorSchema,
  }),
  z.object({ boardId: z.string() }),
  async (input, ctx) => {
    const existing = ctx.db.db.select().from(boards).where(eq(boards.id, input.id)).get();
    if (existing) {
      throw new Error(`Board "${input.id}" already exists`);
    }
    insertBoard(ctx.db.db, { id: input.id, name: input.name, descriptor: input.descriptor });
    return { boardId: input.id };
  },
);
