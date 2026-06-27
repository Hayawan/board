import { z } from 'zod';

// Story 1.2 — the board descriptor schema over the CLOSED field-type set.
//
// "Schema-as-data" (AD9): a board's behavior is a validated `descriptor` JSON, not
// code. Enrichment (7.1), rendering (7.2), and the composer (10) all read it
// generically. The closed field-type set (C11) is the load-bearing constraint that
// keeps those generic — validation rejects off-list types HARD (no `any` escape
// hatch).
//
// Contract decisions fixed by party-mode consensus (see the story Dev Notes):
//  - System columns (title, notes, favorite, …) are NEVER descriptor fields. They
//    live on the `item` table and are owned by importer/capture/UI. `favorite_reason`
//    is NOT a system column, so it IS a descriptor field (text, enrichable:false).
//  - There is no `boolean` type. A future two-state board field uses `enum`.
//  - `item.fields` is a FLAT object keyed by opaque dotted keys ("meta.audience"),
//    max one dot; UI grouping is a render-time prefix split, never JSON nesting.
//  - Enrichment writes ONLY `enrichable:true` field keys → re-enrichment preserves
//    user fields by construction. `enrichableTargets()` is the single source of truth.
//
// Out of scope here (Story 10.2 — composer guardrails): reserved-key rejection,
// field-count cap, duplicate-key rejection, validate-and-repair.

export const FIELD_TYPES = ['text', 'number', 'date', 'url', 'enum', 'tags', 'image'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/** Item system columns — owned by importer/capture/UI, never descriptor fields. */
export const SYSTEM_COLUMNS: ReadonlySet<string> = new Set([
  'id',
  'board_id',
  'source',
  'title',
  'status',
  'error_reason',
  'favorite',
  'notes',
  'fields',
  'search_blob',
  'analysis_provider',
  'analysis_model',
  'created_at',
  'updated_at',
]);

// Opaque key grammar: lowercase alnum/underscore segments, at most one dot
// (group.leaf). Storage is flat; the dot is a display-grouping hint only.
const KEY_GRAMMAR = /^[a-z0-9_]+(\.[a-z0-9_]+)?$/;

const FieldSchema = z
  .object({
    key: z
      .string()
      .min(1, { message: 'field `key` is required' })
      .regex(KEY_GRAMMAR, {
        message: 'field `key` must be lowercase alnum/underscore with at most one dot (group.leaf)',
      }),
    label: z.string().min(1, { message: 'field `label` is required' }),
    type: z.enum(FIELD_TYPES),
    enrichable: z.boolean().optional(),
    // Optional per-field guidance: an AI hint (injected into the enrichment prompt so
    // the LLM knows what this field should contain) that doubles as user-facing help.
    description: z.string().optional(),
    // Required & non-empty only for `enum` (checked below).
    values: z.array(z.string()).optional(),
  })
  .superRefine((f, ctx) => {
    if (f.type === 'enum' && (!f.values || f.values.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['values'],
        message: `enum field "${f.key}" must declare non-empty \`values\``,
      });
    }
  });

export const BoardDescriptorSchema = z.object({
  fields: z.array(FieldSchema),
  enrichment_prompt: z.string(),
  view: z.enum(['grid', 'list']),
  ingest_mode: z.enum(['url-screenshot', 'url-readable', 'manual-upload']),
  // OPTIONAL, backward-compatible (NFR-BC, like archive_on_promote): the composed
  // board's first-run empty-state copy in its own voice — a short stance `head` and an
  // inviting `body`. The seeded boards (inspiration/library/inbox) carry bespoke copy
  // in the UI; a composed board ("Mood board", "Videos") gets its delight from here.
  // Lenient strings: guardrails trim/cap and DROP this whole block if either is empty,
  // so the UI falls back to the generic voice rather than rendering a blank headline.
  empty_state: z.object({ head: z.string(), body: z.string() }).optional(),
  // Story 16.2 — OPTIONAL, default-off: when true, promoting (assigning) an item to this
  // board enqueues a self-contained-HTML snapshot (Story 16.1) for that item. Additive —
  // every pre-wave descriptor (without it) still validates and reads archival OFF (NFR-BC).
  archive_on_promote: z.boolean().optional(),
});

export type Field = z.infer<typeof FieldSchema>;
export type BoardDescriptor = z.infer<typeof BoardDescriptorSchema>;

/** Story 16.2 — does this board archive (snapshot) items on promotion? Default OFF. */
export function archivesOnPromote(descriptor: BoardDescriptor | null | undefined): boolean {
  return descriptor?.archive_on_promote === true;
}

/**
 * Parse + validate a descriptor against the closed field-type set. Returns the
 * parsed descriptor or throws an `Error` whose message names the offending
 * field(s) — clear enough for AC 2 ("a clear, field-identifying error message").
 */
export function validateDescriptor(value: unknown): BoardDescriptor {
  const result = BoardDescriptorSchema.safeParse(value);
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => {
        const path = i.path.join('.');
        // Surface the offending field key when the issue is inside fields[n].
        let where = path;
        if (
          Array.isArray(value) === false &&
          typeof value === 'object' &&
          value !== null &&
          i.path[0] === 'fields' &&
          typeof i.path[1] === 'number'
        ) {
          const fld = (value as { fields?: unknown[] }).fields?.[i.path[1] as number] as
            | { key?: string }
            | undefined;
          if (fld?.key) where = `field "${fld.key}" (${path})`;
        }
        return `${where}: ${i.message}`;
      })
      .join('; ');
    throw new Error(`Invalid board descriptor: ${detail}`);
  }
  return result.data;
}

/** The field keys enrichment is allowed to fill (the single source of truth). */
export function enrichableTargets(descriptor: BoardDescriptor): string[] {
  return descriptor.fields.filter((f) => f.enrichable === true).map((f) => f.key);
}
