import { z } from 'zod';

import { exportJson, exportNetscape } from '../db/export.js';
import { defineSkill } from './types.js';

// Story 17.1 — the `export` skill: a thin, READ-ONLY wrapper over db/export.ts's
// serializers, invoked through the generic POST /skills/:name route (like
// import-bookmarks). It touches ctx.db only via select() — no ctx.queue, no writes.

const exportBoardSchema = z.object({
  id: z.string(),
  name: z.string(),
  view: z.string(),
  descriptor: z.unknown(),
});

const exportAssetSchema = z.object({
  id: z.string(),
  itemId: z.string(),
  kind: z.string(),
  path: z.string(),
  hash: z.string().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
});

const exportDocumentSchema = z.object({
  version: z.literal(1),
  boards: z.array(exportBoardSchema),
  items: z.record(z.array(z.record(z.unknown()))),
  assets: z.array(exportAssetSchema),
});

// Real zod I/O (FR-19) — a discriminated union over the requested format, not z.any().
const outputSchema = z.discriminatedUnion('format', [
  z.object({ format: z.literal('json'), document: exportDocumentSchema }),
  z.object({ format: z.literal('netscape'), html: z.string() }),
]);

export const exportSkill = defineSkill(
  'export',
  z.object({ format: z.enum(['json', 'netscape']).default('json') }),
  outputSchema,
  async (input, ctx) => {
    if (input.format === 'netscape') {
      return { format: 'netscape' as const, html: exportNetscape(ctx.db) };
    }
    return { format: 'json' as const, document: exportJson(ctx.db) };
  },
);
