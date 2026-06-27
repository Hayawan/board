import type { BoardDescriptor, FieldType } from '../descriptor/types.js';

// Story 1.4 — pure assembly of the synthetic `search_blob`.
//
// A single `search_blob` per item (not per-field FTS columns) is what lets any
// descriptor-defined board be searchable with zero schema change (AD9). This
// function picks the TEXT-BEARING fields and concatenates their string content;
// the writer (db/queue.ts) stores the result and syncs FTS5, transactionally.

// Searchable field types: those whose values are human-readable text. number/date/
// image carry no useful free-text content and are deliberately excluded (proven by
// the AC-1 "non-searchable value does not appear" test).
const SEARCHABLE_TYPES: ReadonlySet<FieldType> = new Set(['text', 'tags', 'enum', 'url']);

type ItemLike = {
  title?: string | null;
  notes?: string | null;
  fields?: Record<string, unknown> | null;
};

/** Coerce a field value to its searchable string tokens (strings + string arrays). */
function tokens(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  return []; // numbers, booleans, objects, null → not searchable text
}

/**
 * Build the search blob for an item. `title` and `notes` (system text columns) are
 * always included. Field selection is DESCRIPTOR-DRIVEN when a descriptor is given
 * (only text/tags/enum/url fields). Without a descriptor, fall back to every
 * string/string-array value in `item.fields` — search must never block a write.
 */
export function buildSearchBlob(item: ItemLike, descriptor?: BoardDescriptor): string {
  const parts: string[] = [];
  if (item.title) parts.push(item.title);
  if (item.notes) parts.push(item.notes);

  const fields = item.fields ?? {};
  if (descriptor) {
    for (const f of descriptor.fields) {
      if (!SEARCHABLE_TYPES.has(f.type)) continue;
      parts.push(...tokens(fields[f.key]));
    }
  } else {
    for (const value of Object.values(fields)) parts.push(...tokens(value));
  }

  return parts.filter((p) => p.length > 0).join(' ');
}
