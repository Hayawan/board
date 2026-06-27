import { z } from 'zod';

import { BoardDescriptorSchema } from './types.js';

// Story 10.1 — the composer's META-SCHEMA: the generator-facing form of a Board
// Descriptor. It is the descriptor's own zod (Story 1.2 — closed field-type set,
// ingest_mode/view enums) PLUS the board `name` the composer proposes. This is a zod
// schema (NOT a raw JSON-schema object) because `ctx.llm.complete(prompt, schema)`
// takes a zod schema (Story 4.1). Reuses 1.2's schema — no second descriptor shape.
export const MetaDescriptorSchema = BoardDescriptorSchema.extend({
  name: z.string().min(1, { message: 'board `name` is required' }),
});

export type ComposedBoard = z.infer<typeof MetaDescriptorSchema>;
