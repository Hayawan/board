import { desc, eq } from 'drizzle-orm';

import { assets, items, type Item, type Asset } from './schema.js';
import type { DbHandle } from './index.js';

// Story 8.x cutover — present a SQLite item in the shape the (polished, prototype)
// frontend renderers consume: system columns lifted to the top level, the flat dotted
// `fields` un-flattened into nested groups (meta.*/design.*/reflection.* → nested
// objects), the screenshot asset attached, and createdAt rendered as a YYYY-MM-DD
// `added`. This lets the running app read/write SQLite WITHOUT rewriting the renderers.
export function hydrateItemForUi(item: Item, itemAssets: Asset[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: item.id,
    url: item.source ?? '',
    title: item.title ?? '',
    notes: item.notes ?? '',
    favorite: !!item.favorite,
    status: item.status,
    added: item.createdAt ? new Date(item.createdAt * 1000).toISOString().slice(0, 10) : '',
  };
  if (item.errorReason) out.error_reason = item.errorReason;

  const shot = itemAssets.find((a) => a.kind === 'screenshot');
  if (shot?.path) out.screenshot = shot.path;

  const fields = (item.fields as Record<string, unknown>) ?? {};
  for (const [key, value] of Object.entries(fields)) {
    const dot = key.indexOf('.');
    if (dot > 0) {
      const group = key.slice(0, dot);
      const leaf = key.slice(dot + 1);
      const nested = (out[group] as Record<string, unknown>) ?? {};
      nested[leaf] = value;
      out[group] = nested;
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** All items on a board, newest first, hydrated for the UI (one asset query, grouped). */
export function listBoardItemsForUi(handle: DbHandle, boardId: string): Record<string, unknown>[] {
  const rows = handle.db
    .select()
    .from(items)
    .where(eq(items.boardId, boardId))
    .orderBy(desc(items.createdAt))
    .all();
  const byItem = new Map<string, Asset[]>();
  for (const a of handle.db.select().from(assets).all()) {
    const list = byItem.get(a.itemId) ?? [];
    list.push(a);
    byItem.set(a.itemId, list);
  }
  return rows.map((it) => hydrateItemForUi(it, byItem.get(it.id) ?? []));
}

/** One item, hydrated for the UI (or undefined). */
export function getItemForUi(handle: DbHandle, id: string): Record<string, unknown> | undefined {
  const item = handle.db.select().from(items).where(eq(items.id, id)).get();
  if (!item) return undefined;
  const itemAssets = handle.db.select().from(assets).where(eq(assets.itemId, id)).all();
  return hydrateItemForUi(item, itemAssets);
}
