# Story 1.3: Single-writer queue + atomic writes + busy_timeout

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Epic 1 — Storage foundation (schema-as-data).** Story 3 of 5. Build order: (1) schema → (2) descriptor + seeded boards → **(3) single-writer queue + atomic writes + busy_timeout ◄ this story** → (4) FTS5 → (5) importer. This story establishes the **write-safety spine**: all writes serialized through one writer with `busy_timeout`, so concurrent/bursty writes never corrupt the DB or surface `SQLITE_BUSY`. The same serialized path is later reused by the async job worker (Story 5.1) — the queue **is** the SQLite single-writer guard. *(NFR-2; foundation for AD6.)*

## Story

As the board-oss maintainer,
I want all writes serialized through one writer with `busy_timeout` set,
so that concurrent or bursty writes never corrupt the DB and `SQLITE_BUSY` never surfaces to a caller.

## Acceptance Criteria

1. **`busy_timeout` is set on the connection.**
   **Given** the DB connection from Story 1.1, **When** it initializes, **Then** `PRAGMA busy_timeout` returns a non-zero value (the configured timeout).

2. **All writes go through a single serialized path.**
   **Given** the write API, **When** any code performs a write (insert/update/delete), **Then** it does so through one serialized writer such that two write *operations* never interleave; the path is the one the future job worker (5.1) reuses.

3. **Concurrent async read-modify-writes do not lose updates (the serialization proof).**
   **Given** a counter row and N (≥50) concurrent operations each of which *reads* the counter, *awaits a turn of the event loop*, then *writes* `value + 1`, **When** they all run through the serialized writer, **Then** the final counter value is exactly N (no lost updates). *(Note: a naïve "fire N inserts, assert N rows" test is tautological — `better-sqlite3` is synchronous and cannot interleave, so it passes even against a no-op queue. The RMW-with-await is what actually fails without serialization and proves the queue earns its keep.)*

4. **A multi-step write that throws partway rolls back (atomicity — NFR-2).**
   **Given** a write operation that performs step A (e.g. insert item) then throws before step B completes, **When** it runs through the writer, **Then** neither A nor B persists — the operation is atomic (wrapped in a transaction); no partial rows remain.

5. **A typed item-write choke-point exists (the hook 1.4 extends).**
   **Given** the write layer, **When** an item is created/updated, **Then** it flows through a single typed item-write helper (distinct from the generic `enqueueWrite(fn)`), so Story 1.4 has exactly one place to compute `search_blob` + sync FTS, inside the writer's transaction, and no call site can bypass it.

6. **Tests prove serialization, atomicity, and the pragma.**
   **Given** a temp DB, **When** the tests run, **Then** they assert: `busy_timeout` non-zero (AC 1); the async-RMW final value == N (AC 3); a partway-throwing write leaves no partial rows (AC 4). All run against `os.tmpdir()`, never the real `DATA_DIR`.

## Tasks / Subtasks

- [ ] **Task 1 — Write the failing tests first (TDD)** (AC: 1, 3, 4, 6)
  - [ ] Create `db/queue.test.ts`: the **async read-modify-write** test (AC 3) — seed a counter row; fire N (≥50) ops, each `enqueueWrite(async () => { read counter; await tick; write counter+1 })`; `await Promise.all`; assert final counter == N. This is the test that must fail without serialization (lost updates → final < N), so confirm the red is a *concurrency* failure, not just a missing symbol.
  - [ ] Add the **atomicity/rollback** test (AC 4): a write op that inserts a row then throws; assert no row persists afterward.
  - [ ] Add the `PRAGMA busy_timeout` non-zero test (AC 1).
  - [ ] Run; confirm red for the right reasons before implementing.
- [ ] **Task 2 — Set `busy_timeout` on connection init** (AC: 1)
  - [ ] In `db/index.ts` (Story 1.1's connection module), set `PRAGMA busy_timeout = <ms>` alongside the WAL pragma. Make the value config-overridable later (a constant with a `// Story 2.1 env` marker is fine; do not build the env loader here).
- [ ] **Task 3 — Implement the single serialized writer** (AC: 2, 3)
  - [ ] Create the write-serialization primitive in `db/queue.ts` (architecture §6 names this file). Implement a single async worker / promise-chain that serializes write operations: `enqueueWrite(fn)` returns a promise that resolves with `fn`'s result, and the worker guarantees only one `fn` runs at a time.
  - [ ] Expose a write API the rest of the app uses for all mutations (e.g. `withWriter(fn)` / `enqueueWrite(fn)`), so Story 5.1's job worker can drain capture/enrichment jobs through the same single-writer path.
  - [ ] Document explicitly that **reads do not need to go through the writer** (WAL allows concurrent reads); only writes serialize.
- [ ] **Task 4 — Establish the typed item-write choke-point + atomicity** (AC: 2, 4, 5)
  - [ ] Create a single typed item-write helper (e.g. `writeItem(item)` / `upsertItem(item)`) distinct from the generic `enqueueWrite(fn)`. ALL item inserts/updates flow through it. This is the one place Story 1.4 hooks `search_blob` assembly + FTS sync into — so name it here and document that 1.4 owns adding the blob/FTS body, 1.3 owns the helper's existence + transaction wrapper.
  - [ ] Wrap each enqueued write operation in a transaction so a partway failure rolls back (AC 4) — `better-sqlite3`'s synchronous transaction API is fine inside the serialized `fn`.
  - [ ] No consumers exist yet (add.ts/server.ts still use flat-JSON) — this establishes the API + choke-point, not a retrofit of callers.
- [ ] **Task 5 — Wire tests + verify green** (AC: 4)
  - [ ] Add the new test file to the `test` script; run `npm test`; confirm green + existing 7 suites unaffected.

## Dev Notes

### What this story changes vs preserves (read before coding)

- **NEW `db/queue.ts`** — architecture §6 lists `db/queue.ts` as the "single-writer worker queue". This story builds the **write-serialization core**; Story 5.1 extends the *same* worker to drain capture/enrichment **jobs** with concurrency-1 + timeouts. Design the API so 5.1 is an extension, not a rewrite: a generic `enqueue(fn)` serial worker that writes happen to use.
- **`db/index.ts` (UPDATE from Story 1.1)** — add the `busy_timeout` pragma next to WAL. Single line; do not refactor the connection.
- **`storage.ts` flat-JSON locking stays untouched** — the prototype's `withFileLock`/`writeJsonAtomic`/`mutateJsonFile` (`storage.ts:22-63`) is the *old* concurrency story (file locks + temp-then-rename). The DB's transactional single-writer **replaces** that approach for DB writes, but the flat-JSON path keeps its own locking until consumers migrate. Do not delete `storage.ts`'s locking.

### The single-writer model (target — from architecture §4.5/AD6)

[Source: docs/bmad/architecture.md#4.5-job-model-status, docs/bmad/architecture.md#3-AD6]
- `JobQueue` = a single async worker draining jobs serially; **this is also the SQLite single-writer guard**. There is no external broker.
- The queue serves double duty: (a) write-safety (this story), (b) capture/enrichment job execution at concurrency 1 (Story 5.1, NFR-1/C1).
- `better-sqlite3` is synchronous per call; serialization here is about ordering *logical* write operations (transactions, multi-step RMW) so they don't interleave, and ensuring `busy_timeout` covers any WAL checkpoint contention.

### Why this design (anti-pattern prevention)

- **One writer, not a lock per call.** The architecture's deliberate choice (AD6) is a single serialized worker, not ad-hoc mutexes scattered across call sites. Centralizing means Story 5.1 reuses it for jobs and there is exactly one place that owns write ordering. Do not reintroduce per-operation file-style locks. [Source: docs/bmad/architecture.md#3-AD6]
- **`busy_timeout` AND single-writer — both.** `busy_timeout` handles transient lock waits (e.g. a WAL checkpoint); the single-writer prevents logical write races. NFR-2 lists both explicitly; setting one without the other leaves a gap. [Source: docs/bmad/PRD.md#NFR-2]
- **Reads stay concurrent.** WAL's value is concurrent readers + one writer. Routing reads through the writer would serialize everything and kill the SSE/browse read path. Only writes serialize. [Source: docs/bmad/architecture.md#5]
- **Don't build the job lifecycle here.** Status transitions, timeouts/kill, and job types are Story 5.1 (and 5.2). This story is the write-serialization primitive only — the substrate, not the job system. Keep the API generic so 5.1 layers jobs on top.

### Test design notes

- **The count==N test is a trap — do not rely on it.** `better-sqlite3` is synchronous and Node is single-threaded, so N synchronous inserts physically cannot interleave; "fire N inserts, assert N rows" passes against a no-op `enqueueWrite` and proves nothing. The serializer's real value is ordering **async** operations that have an `await` between read and write.
- **The serialization proof (AC 3):** each op does `read counter → await (e.g. `setImmediate`/`Promise.resolve`) → write value+1`. Without the writer, the N reads all see the same start value and final == 1-ish (lost updates); with it, final == N. This fails for the *right* reason.
- **Atomicity (AC 4):** wrap the op in a transaction; a throw after a partial insert must roll back. Test by inserting then throwing, then asserting zero rows.
- **`busy_timeout` (AC 1):** after `initDb`, read back `PRAGMA busy_timeout` and assert it equals the configured value.

### Project Structure Notes

- `db/queue.ts` (new), `db/index.ts` (updated, Story 1.1), `db/queue.test.ts` or `db/writer.test.ts` (new). All under `db/` per architecture §6.
- ESM `.js` specifiers; `node:test` harness; add the new test to the `test` script.

### Testing standards

- Temp DB under `os.tmpdir()`; never the real data dir.
- No flakiness: N should be large enough to expose interleaving bugs (≥50) but the test must be deterministic (await all promises before asserting).
- Existing 7 suites stay green.

### References

- [Source: docs/bmad/architecture.md#4.5-job-model-status] — the JobQueue single async worker = SQLite single-writer.
- [Source: docs/bmad/architecture.md#3-AD6] — async job model: in-process single-writer worker queue, no external broker.
- [Source: docs/bmad/PRD.md#NFR-2] — datastore: SQLite (WAL) + single-writer queue + `busy_timeout`; atomic writes.
- [Source: docs/bmad/epics.md#Story-5.1] — the future job worker reuses this serialized path (concurrency 1 + timeouts).
- [Source: storage.ts#22-63] — the prototype's file-lock/atomic-write concurrency model this DB writer supersedes (left intact this story).
- [Source: docs/bmad/stories/1-1-sqlite-drizzle-schema.md] — the `db/index.ts` connection module to extend with `busy_timeout`.

## Dev Agent Record

### Agent Model Used

_(to be filled by dev agent)_

### Debug Log References

### Completion Notes List

### File List
