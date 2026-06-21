import { z } from 'zod';

import { searchItems } from '../db/search.js';
import { defineSkill } from './types.js';

// Story 9.1 — full-text search exposed as a skill (AD11 default: every capability is
// a registered skill on POST /skills/:name). Board-scoped, ranked over FTS5.
export const searchSkill = defineSkill(
  'search',
  z.object({ boardId: z.string().min(1), q: z.string(), limit: z.number().int().positive().max(200).optional() }),
  z.object({ items: z.array(z.any()) }),
  async (input, ctx) => {
    const results = searchItems(ctx.db, { boardId: input.boardId, query: input.q, limit: input.limit });
    return { items: results };
  },
);
