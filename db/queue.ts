import { items, type NewItem } from './schema.js';
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
 * here, inside the serialized writer's transaction.
 *
 * Story 1.4 owns adding `search_blob` assembly + FTS sync *inside this transaction*
 * — this is the one place to hook it so no call site can bypass it. 1.3 owns the
 * helper's existence + the transaction wrapper only.
 */
export function writeItem(handle: DbHandle, item: NewItem): Promise<void> {
  return enqueueTransaction(handle, () => {
    // Story 1.4: compute item.search_blob from the descriptor's text/enrichable
    // fields + sync the FTS5 table here, within this transaction.
    handle.db
      .insert(items)
      .values(item)
      .onConflictDoUpdate({ target: items.id, set: { ...item } })
      .run();
  });
}
