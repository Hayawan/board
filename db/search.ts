import { inArray } from 'drizzle-orm';

import { items, type Item } from './schema.js';
import type { DbHandle } from './index.js';

// Story 9.1 — full-text search over the Story 1.4 FTS5 index (`item_fts`, a single
// synthetic `search_blob` column = title + captured text + enrichable fields + notes).
// Server-side + ranked (bm25 via FTS5's `rank`), scoped to the active board.

/**
 * Quote the whole input as ONE FTS5 phrase and double embedded quotes. A bound
 * `MATCH ?` stops SQL injection but NOT FTS5 *syntax* errors — SQLite still hands the
 * value to the FTS5 query parser, so `foo"bar`/`AND`/`*` would still throw. Treating
 * the input as a literal phrase (no operators) is the right behavior for a search box
 * and is syntax-safe (AC4).
 */
function toFtsPhrase(q: string): string {
  return '"' + q.replace(/"/g, '""') + '"';
}

/**
 * Search items on a board, ranked best-first (bm25; FTS5 `rank` is ascending = best).
 * Returns [] for a blank query. Hydrates through Drizzle so `fields` is parsed JSON,
 * preserving the FTS rank order.
 */
export function searchItems(
  handle: DbHandle,
  args: { boardId: string; query: string; limit?: number },
): Item[] {
  const q = String(args.query ?? '').trim();
  if (!q) return [];
  const limit = args.limit ?? 50;

  const ranked = handle.sqlite
    .prepare(
      `SELECT f.item_id AS id
         FROM item_fts f
         JOIN item i ON i.id = f.item_id
        WHERE f.item_fts MATCH ? AND i.board_id = ?
        ORDER BY f.rank
        LIMIT ?`,
    )
    .all(toFtsPhrase(q), args.boardId, limit) as Array<{ id: string }>;

  const ids = ranked.map((r) => r.id);
  if (ids.length === 0) return [];

  const rows = handle.db.select().from(items).where(inArray(items.id, ids)).all();
  const order = new Map(ids.map((id, idx) => [id, idx]));
  return rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}
