import { eq } from 'drizzle-orm';

import { boards, items, type NewItem } from './schema.js';
import { buildSearchBlob } from './search-blob.js';
import type { BoardDescriptor } from '../descriptor/types.js';
import type { DbHandle } from './index.js';

// Story 1.3 — the single-writer queue (write-safety spine).
//
// All writes serialize through one async worker so two write *operations* never
// interleave — preventing logical write races (lost updates) that `busy_timeout`
// alone cannot. `better-sqlite3` is synchronous per call; the serialization here
// orders *logical* operations that have an `await` between read and write.
//
// READS DO NOT GO THROUGH THE WRITER. WAL allows concurrent readers + one writer;
// routing reads through the queue would serialize everything and kill the browse /
// SSE read path. Only writes serialize.
//
// This is the same serialized path Story 5.1's job worker reuses to drain
// capture/enrichment jobs at concurrency 1 — keep `enqueueWrite` generic so 5.1
// layers jobs on top rather than rewriting it.

// A promise chain is the serializer: each enqueued op waits for the previous to
// settle. Errors are swallowed from the *chain* (so one failure can't wedge the
// queue) but propagated to the *caller* via the returned promise.
let tail: Promise<unknown> = Promise.resolve();

/**
 * Serialize a write operation. Returns a promise resolving with `fn`'s result (or
 * rejecting with its error). Only one `fn` runs at a time, in enqueue order.
 */
export function enqueueWrite<T>(fn: () => T | Promise<T>): Promise<T> {
  const run = tail.then(() => fn());
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Serialize an ATOMIC write: `fn` runs inside a single better-sqlite3 transaction,
 * so a partway throw rolls back every step (NFR-2). `fn` must be synchronous (the
 * transaction boundary is synchronous in better-sqlite3).
 */
export function enqueueTransaction<T>(handle: DbHandle, fn: () => T): Promise<T> {
  return enqueueWrite(() => handle.sqlite.transaction(fn)());
}

/**
 * The single typed item-write choke-point. ALL item inserts/updates flow through
 * here, inside the serialized writer's transaction. `item` is treated as the full
 * desired state of the row (search_blob is recomputed from the fields provided).
 *
 * Inside the transaction it (1) upserts the item row, (2) recomputes `search_blob`
 * from the board's descriptor (descriptor-driven; safe fallback if absent), and
 * (3) re-syncs the FTS5 row. All three are atomic with each other — a partway throw
 * rolls back all of them — so the index can never drift from the row.
 */
export function writeItem(handle: DbHandle, item: NewItem): Promise<void> {
  return enqueueTransaction(handle, () => {
    const board = handle.db.select().from(boards).where(eq(boards.id, item.boardId)).get();
    const descriptor = (board?.descriptor as BoardDescriptor | undefined) ?? undefined;
    const searchBlob = buildSearchBlob(
      { title: item.title ?? null, notes: item.notes ?? null, fields: (item.fields as Record<string, unknown>) ?? null },
      descriptor,
    );

    const row = { ...item, searchBlob };
    const { id: _id, ...updatable } = row;
    handle.db.insert(items).values(row).onConflictDoUpdate({ target: items.id, set: updatable }).run();

    // Re-sync FTS5: delete any existing row for this item, then re-insert if the
    // blob is non-empty. Keyed on item_id (UNINDEXED column on the standalone table).
    handle.sqlite.prepare('DELETE FROM item_fts WHERE item_id = ?').run(item.id);
    if (searchBlob.length > 0) {
      handle.sqlite.prepare('INSERT INTO item_fts (item_id, search_blob) VALUES (?, ?)').run(item.id, searchBlob);
    }
  });
}

/**
 * Delete an item and its FTS row atomically through the single writer.
 */
export function deleteItem(handle: DbHandle, id: string): Promise<void> {
  return enqueueTransaction(handle, () => {
    handle.db.delete(items).where(eq(items.id, id)).run();
    handle.sqlite.prepare('DELETE FROM item_fts WHERE item_id = ?').run(id);
  });
}
