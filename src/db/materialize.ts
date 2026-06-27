import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';

import type { BoardDescriptor } from '../descriptor/types.js';
import { insertBoard } from './seed.js';
import { resolveView } from './view.js';
import { writeItem, enqueueWrite } from './queue.js';
import { assets, views, type NewAsset } from './schema.js';
import type { DbHandle } from './index.js';

// Story 15.3 — copy-on-write "materialize view to board" (Decision D11). The deliberate
// escape hatch: turn a read-only lens (15.1) into a real, hand-prunable board by COPYING
// its currently-resolved items into a new board — new `item` rows (new ids), MOVE-free
// (a source `item.board_id` is NEVER touched). Asset FILES are reused by hash: the copy's
// `asset` row references the SAME on-disk file (same path+hash) — no bytes are rewritten
// (NFR-1 disk footprint). The one sanctioned duplication in Epic 15, on explicit action.

// Destination descriptor: minimal/universal. Copied items keep their `fields` DATA, but
// the materialized board declares no field columns (the copies may come from different
// source descriptors) — it renders the UNIVERSAL fields (title/asset) via the render-map.
// A deliberate v1 choice: no descriptor merge across heterogeneous sources.
//
// CONSEQUENCE (AC3): with `fields:[]`, patchItemFields' field allowlist is empty, so a
// materialized item's notes + favorite stay editable (USER_COLUMNS) but its descriptor
// FIELDS are not editable on this board. Divergence (the AC3 guarantee) still holds — the
// copy is fully independent of the source. Field-editability would need a chosen/merged
// descriptor; deferred (a descriptor-merge across heterogeneous sources is its own design).
const MATERIALIZED_DESCRIPTOR: BoardDescriptor = {
  fields: [],
  enrichment_prompt: '',
  view: 'grid',
  ingest_mode: 'url-screenshot',
};

/**
 * Copy a saved view's current items into a new board. Returns the new board id + copy
 * count. Not atomic across N items (each `writeItem` is its own transaction) — a mid-run
 * crash leaves a partial, deletable board; acceptable for a user-initiated copy.
 */
export async function materializeView(
  handle: DbHandle,
  viewId: string,
  opts: { name: string },
): Promise<{ boardId: string; copied: number }> {
  const view = handle.db.select().from(views).where(eq(views.id, viewId)).get();
  if (!view) throw new Error(`Cannot materialize: unknown view "${viewId}"`);

  const sourceItems = resolveView(handle, view);

  const boardId = randomUUID();
  await enqueueWrite(() => insertBoard(handle.db, { id: boardId, name: opts.name, descriptor: MATERIALIZED_DESCRIPTOR }));

  let copied = 0;
  for (const src of sourceItems) {
    const newId = randomUUID();
    // New asset rows for the copy: reference the EXISTING file by its path+hash (the file
    // already exists at the source path) — no bytes rewritten, no new file on disk.
    const srcAssets = handle.db.select().from(assets).where(eq(assets.itemId, src.id)).all();
    const newAssets: NewAsset[] = srcAssets.map((a) => ({
      id: randomUUID(),
      itemId: newId,
      kind: a.kind,
      path: a.path,
      width: a.width,
      height: a.height,
      hash: a.hash,
    }));
    // COPY (never move): a NEW item row on the new board, fields/notes/favorite by value.
    // Through the typed write choke-point so search_blob/FTS are built for the copy.
    await writeItem(
      handle,
      {
        id: newId,
        boardId,
        source: src.source,
        title: src.title,
        status: 'done',
        favorite: src.favorite,
        notes: src.notes,
        fields: src.fields,
      },
      newAssets,
    );
    copied += 1;
  }

  return { boardId, copied };
}
