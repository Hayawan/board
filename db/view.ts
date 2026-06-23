import { eq, inArray } from 'drizzle-orm';

import { items, views, type Item, type NewView, type View } from './schema.js';
import { enqueueWrite } from './queue.js';
import { toFtsPhrase } from './search.js';
import type { DbHandle } from './index.js';

// Story 15.1 — read-only resolution of a saved cross-board view (lens). A view is a
// `filter` (live query) + an optional `order` overlay (pinned ids). Resolution is
// SELECT-only: it never creates/updates/deletes an item, asset, or any row — that is
// what guarantees NFR-BC and "canonical meaning" (edits at the item's home flow into
// every view because a view holds no copy of item content).

export interface ViewFilter {
  /** Free-text FTS query (matched across boards). */
  query?: string;
  /** Restrict to these home boards (omit = all boards — the lens is cross-board). */
  boardIds?: string[];
  /** Restrict to a status (e.g. 'done'). */
  status?: string;
  /** Only favorites when true. */
  favorite?: boolean;
}

export interface ViewLike {
  filter: ViewFilter | Record<string, unknown> | null | undefined;
  /** Optional pin/reorder overlay (item-ids). */
  order?: string[] | null;
}

/**
 * Resolve a view to its ordered item list. Two paths:
 *  - `filter.query` present → FTS5 MATCH (board scope RELAXED vs searchItems), structured
 *    predicates AND-ed on `item`, ordered by FTS rank.
 *  - `filter.query` absent/blank → plain SELECT with the structured predicates, ordered
 *    `created_at DESC` (deterministic). Routing a no-query view through FTS would match
 *    nothing (`MATCH '""'`), so the blank case MUST take this path.
 * Then the `order` overlay pins listed-and-matching ids first; a pinned id that no longer
 * matches/exists is skipped (no error). All values are bound as `?` params.
 */
export function resolveView(handle: DbHandle, view: ViewLike): Item[] {
  const filter = (view.filter ?? {}) as ViewFilter;
  const query = typeof filter.query === 'string' ? filter.query.trim() : '';

  const preds: string[] = [];
  const params: unknown[] = [];
  if (Array.isArray(filter.boardIds) && filter.boardIds.length > 0) {
    preds.push(`i.board_id IN (${filter.boardIds.map(() => '?').join(',')})`);
    params.push(...filter.boardIds);
  }
  if (typeof filter.status === 'string' && filter.status) {
    preds.push('i.status = ?');
    params.push(filter.status);
  }
  if (filter.favorite === true) {
    preds.push('i.favorite = 1');
  }

  let ids: string[];
  if (query) {
    const where = ['f.item_fts MATCH ?', ...preds].join(' AND ');
    const rows = handle.sqlite
      .prepare(
        `SELECT f.item_id AS id
           FROM item_fts f
           JOIN item i ON i.id = f.item_id
          WHERE ${where}
          ORDER BY f.rank`,
      )
      .all(toFtsPhrase(query), ...params) as Array<{ id: string }>;
    ids = rows.map((r) => r.id);
  } else {
    const where = preds.length ? `WHERE ${preds.join(' AND ')}` : '';
    const rows = handle.sqlite
      .prepare(`SELECT i.id AS id FROM item i ${where} ORDER BY i.created_at DESC, i.id`)
      .all(...params) as Array<{ id: string }>;
    ids = rows.map((r) => r.id);
  }

  // Apply the order overlay: pinned-and-matching ids first (in pin order), rest after.
  const matched = new Set(ids);
  const pinned = (Array.isArray(view.order) ? view.order : []).filter((id) => matched.has(id));
  const pinnedSet = new Set(pinned);
  const finalIds = [...pinned, ...ids.filter((id) => !pinnedSet.has(id))];
  if (finalIds.length === 0) return [];

  // No LIMIT (unlike searchItems' 50): a saved lens shows its WHOLE membership, not a
  // page. At personal scale the id count stays well under SQLite's bound-param cap.
  // Hydrate through Drizzle (so `fields` is parsed JSON), preserving finalIds order.
  const rows = handle.db.select().from(items).where(inArray(items.id, finalIds)).all();
  const pos = new Map(finalIds.map((id, idx) => [id, idx]));
  return rows.sort((a, b) => (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0));
}

/**
 * Story 15.1/15.2 — the additive view INSERT primitive (used by the composer's accept
 * path). Serialized through the single writer. Additive: it creates one `view` row and
 * touches no `item`/`board`/`asset` row.
 */
export async function createView(handle: DbHandle, view: NewView): Promise<View> {
  return enqueueWrite(() => {
    handle.db.insert(views).values(view).run();
    return handle.db.select().from(views).where(eq(views.id, view.id)).get()!;
  });
}
