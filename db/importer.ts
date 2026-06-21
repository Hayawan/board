import { readFileSync, existsSync } from 'node:fs';

import { writeItem } from './queue.js';
import { INSPIRATION_BOARD_ID, LIBRARY_BOARD_ID } from './seed.js';
import type { NewItem, NewAsset } from './schema.js';
import type { DbHandle } from './index.js';

// Story 1.5 — flat-JSON → SQLite importer.
//
// Two layers (the split is non-negotiable — Story 3.3's import-bookmarks skill
// wraps layer (a) with an in-memory payload; the one-shot migration uses (b)):
//   (a) importRecords({ handle, boardId, records }) — board-agnostic per-record
//       mapping + insert through the typed writer (so search_blob + FTS are
//       maintained and writes are idempotent on the preserved record id).
//   (b) importFlatJson({ handle, inspirationPath, libraryPath }) — reads the flat
//       files (gracefully skipping any that are absent) and delegates to (a).
//
// Idempotency: the original record `id` is preserved as `item.id` (the stable dedupe
// key). writeItem upserts by id and replaces the item's assets + FTS row, so a
// second run yields the same item/asset counts and exactly one FTS hit per item.

type Mapped = { item: NewItem; assets: NewAsset[] };
type RawRecord = Record<string, unknown>;

function parseAdded(added: unknown): number | undefined {
  if (typeof added !== 'string' || added.length === 0) return undefined;
  const ms = Date.parse(added);
  return Number.isNaN(ms) ? undefined : Math.floor(ms / 1000);
}

/** Flatten a nested group ({audience,...}) into dotted keys (meta.audience, …). */
function flattenGroup(target: Record<string, unknown>, prefix: string, group: unknown): void {
  if (group && typeof group === 'object' && !Array.isArray(group)) {
    for (const [k, v] of Object.entries(group as Record<string, unknown>)) {
      if (v !== undefined && v !== null) target[`${prefix}.${k}`] = v;
    }
  }
}

/** Inspiration record (bookmarks.json) → item + screenshot asset. */
function mapInspiration(r: RawRecord, boardId: string): Mapped {
  const id = String(r.id);
  const fields: Record<string, unknown> = {};
  flattenGroup(fields, 'meta', r.meta);
  flattenGroup(fields, 'design', r.design);
  flattenGroup(fields, 'reflection', r.reflection);
  if (typeof r.favorite_reason === 'string' && r.favorite_reason.length > 0) {
    fields['favorite_reason'] = r.favorite_reason;
  }

  const item: NewItem = {
    id,
    boardId,
    source: typeof r.url === 'string' ? r.url : null,
    title: typeof r.title === 'string' ? r.title : null,
    favorite: r.favorite ? 1 : 0,
    notes: typeof r.notes === 'string' ? r.notes : null,
    fields,
    createdAt: parseAdded(r.added),
  };

  const itemAssets: NewAsset[] =
    typeof r.screenshot === 'string' && r.screenshot.length > 0
      ? [{ id: `${id}-screenshot`, itemId: id, kind: 'screenshot', path: r.screenshot }]
      : [];

  return { item, assets: itemAssets };
}

/** Library record (library.json) → item (no asset). */
function mapLibrary(r: RawRecord, boardId: string): Mapped {
  const id = String(r.id);
  const fields: Record<string, unknown> = {};
  for (const key of ['summary', 'author', 'topics', 'type', 'key_points']) {
    if (r[key] !== undefined && r[key] !== null) fields[key] = r[key];
  }

  const item: NewItem = {
    id,
    boardId,
    source: typeof r.url === 'string' ? r.url : null,
    title: typeof r.title === 'string' ? r.title : null,
    notes: typeof r.notes === 'string' ? r.notes : null,
    fields,
    analysisProvider: typeof r.analysis_agent === 'string' ? r.analysis_agent : null,
    analysisModel: typeof r.analysis_model === 'string' ? r.analysis_model : null,
    createdAt: parseAdded(r.added),
  };

  return { item, assets: [] };
}

type Mapper = (r: RawRecord, boardId: string) => Mapped;

const MAPPERS: Record<string, Mapper> = {
  [INSPIRATION_BOARD_ID]: mapInspiration,
  [LIBRARY_BOARD_ID]: mapLibrary,
};

export interface ImportRecordsArgs {
  handle: DbHandle;
  boardId: string;
  records: RawRecord[];
}

/**
 * Layer (a): map an in-memory record array onto items under `boardId` and write
 * them through the typed single-writer path. Returns the number of items written.
 */
export async function importRecords({ handle, boardId, records }: ImportRecordsArgs): Promise<number> {
  const mapper = MAPPERS[boardId];
  if (!mapper) throw new Error(`No importer mapping registered for board "${boardId}"`);
  let written = 0;
  for (const r of records) {
    const { item, assets: itemAssets } = mapper(r, boardId);
    await writeItem(handle, item, itemAssets);
    written += 1;
  }
  return written;
}

export interface ImportFlatJsonArgs {
  handle: DbHandle;
  inspirationPath: string;
  libraryPath: string;
  /** Optional logger; defaults to console for the one-shot CLI. */
  logger?: { info: (msg: string) => void };
}

function readRecords(path: string, logger: { info: (msg: string) => void }): RawRecord[] | null {
  if (!existsSync(path)) {
    logger.info(`[import] skipping ${path} — file not found`);
    return null;
  }
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(parsed)) {
    logger.info(`[import] skipping ${path} — not a top-level array`);
    return null;
  }
  return parsed as RawRecord[];
}

/**
 * Layer (b): read the prototype flat files and import them under the two seeded
 * boards. Missing files are skipped with a log line (a fresh self-hoster has none).
 */
export async function importFlatJson({
  handle,
  inspirationPath,
  libraryPath,
  logger = { info: (m: string) => console.log(m) },
}: ImportFlatJsonArgs): Promise<{ inspiration: number; library: number }> {
  const result = { inspiration: 0, library: 0 };

  const insp = readRecords(inspirationPath, logger);
  if (insp) result.inspiration = await importRecords({ handle, boardId: INSPIRATION_BOARD_ID, records: insp });

  const lib = readRecords(libraryPath, logger);
  if (lib) result.library = await importRecords({ handle, boardId: LIBRARY_BOARD_ID, records: lib });

  logger.info(`[import] imported ${result.inspiration} inspiration + ${result.library} library items`);
  return result;
}
