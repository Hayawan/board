# Story 1.4: FTS5 over a synthetic search_blob

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Epic 1 — Storage foundation (schema-as-data).** Story 4 of 5. Build order: (1) schema → (2) descriptor + seeded boards → (3) single-writer queue → **(4) FTS5 over a synthetic search_blob ◄ this story** → (5) importer. This story adds full-text search infrastructure: an FTS5 virtual table over a single `search_blob` column that is (re)built on every write from the item's text/enrichable fields. This is the storage foundation the search UX (Story 9.1) sits on. *(NFR-2; foundation for FR-16.)*

## Story

As the board-oss maintainer,
I want an FTS5 table over a single `search_blob` column maintained on write,
so that full-text search works across an item's dynamic fields without per-field FTS columns.

## Acceptance Criteria

1. **`search_blob` is assembled on write from the item's searchable fields — and only those.**
   **Given** an item written with a mix of searchable fields (title, text/enum/tags fields, notes) and non-searchable fields (e.g. an `image` asset path, a `number`), **When** the write completes, **Then** `item.search_blob` contains the searchable fields' text content **and the test asserts a non-searchable field's value does NOT appear in the blob** (this is what proves descriptor-driven selection rather than a dumb concat-everything).

2. **The FTS5 table is updated on write.**
   **Given** a write that sets/changes `search_blob`, **When** it completes, **Then** the FTS5 virtual table reflects the new content (insert on create, update on change, remove on delete).

3. **A query term in an item's fields returns that item.**
   **Given** an item whose fields contain a term, **When** the FTS5 table is queried for that term, **Then** the item is returned.

4. **A test proves write → search_blob → FTS query.**
   **Given** a temp DB, **When** the test writes items with arbitrary fields and queries the FTS5 table, **Then** it asserts `search_blob` was populated correctly and the matching rows come back (and a non-matching term returns nothing). Runs against `os.tmpdir()`, never the real `DATA_DIR`.

## Tasks / Subtasks

- [x] **Task 1 — Write the failing FTS test first (TDD)** (AC: 1, 2, 3, 4)
  - [x] Create `db/fts.test.ts`: temp DB; write items (via the Story 1.3 writer) whose `fields` contain known terms; assert `search_blob` is the expected concatenation; query the FTS5 table for a present term → item returned; query an absent term → empty.
  - [x] Add cases for **update** (changing a field updates the index) and **delete** (removing an item removes it from the index).
  - [x] Run; confirm red (no FTS table / no blob assembly yet).
- [x] **Task 2 — Add the FTS5 virtual table to the schema (raw SQL)** (AC: 2)
  - [x] Create the FTS5 virtual table over `search_blob` with **raw SQL** — `CREATE VIRTUAL TABLE … USING fts5(...)`. Drizzle cannot model FTS5 virtual tables or their sync triggers declaratively; do not hunt for a Drizzle-native FTS5 API. Link it to `item` via `item.id` as the external rowid/key (or content-table linkage) — pick and document the approach.
  - [x] Confirm the SQLite build (`better-sqlite3`) has FTS5 compiled in; assert availability at init with a clear, actionable error if not (Epic 11 packaging on Debian/LXC must ship an FTS5-enabled build).
- [x] **Task 3 — Implement search_blob assembly** (AC: 1)
  - [x] Create `db/search-blob.ts`: a pure function `buildSearchBlob(item, descriptor)` that concatenates the item's text-bearing fields. Use the descriptor (Story 1.2) to know which fields are text/tags/enum (searchable) vs binary/numeric — concatenate `title` + text/enum/tags fields + `notes`. Keep it descriptor-driven so new boards get search for free.
  - [x] Decide what is searchable: title, notes, and `enrichable`/text/tags/enum field values. Document the rule. (Architecture: "synthetic concat of enrichable/text fields".)
- [x] **Task 4 — Hook blob + FTS maintenance into the typed item-write helper** (AC: 1, 2)
  - [x] Story 1.3 established the single typed item-write choke-point (`writeItem`/`upsertItem`) and wrapped it in a transaction. **This story adds the body:** inside that helper, on insert/update recompute `search_blob` (via `buildSearchBlob`) and upsert the FTS row; on delete, remove the FTS row. Because it lives inside 1.3's transaction, the blob + FTS are atomic with the `item` row and never drift (a partway throw rolls back all three — covered by 1.3's atomicity AC).
  - [x] Do NOT scatter blob/FTS logic across call sites or put it in the generic `enqueueWrite(fn)` — it belongs in the one typed item-write helper so no future writer can forget it.
- [x] **Task 5 — Wire tests + verify green** (AC: 4)
  - [x] Add `db/fts.test.ts` to the `test` script; run `npm test`; confirm green + existing 7 suites unaffected.

## Dev Notes

### What this story changes vs preserves (read before coding)

- **`db/schema.ts` (UPDATE from Story 1.1)** — `search_blob` already exists as a plain `text` column on `item` (added in 1.1). This story adds the **FTS5 virtual table** + triggers/maintenance. No change to `item`'s own columns.
- **`db/queue.ts` / write path (UPDATE from Story 1.3)** — blob assembly + FTS sync hook into the single-writer write path so they're transactional with the item write.
- **NEW `db/search-blob.ts`** — the pure blob-assembly function (descriptor-driven, unit-testable in isolation).
- **Depends on Story 1.2's descriptor** to know which fields are searchable. If a descriptor isn't available at write time for a given item, fall back to concatenating all string-valued entries in `item.fields` + title + notes (document the fallback).

### The FTS5 design (target — from architecture §5)

[Source: docs/bmad/architecture.md#5-data-model]
- **FTS5 virtual table over `search_blob` ONLY** — a synthetic concat of enrichable/text fields, assembled on write. **Not** per-field FTS columns. The architecture flags this as "a non-deferrable storage decision".
- This is **net-new over the prototype** — the flat-JSON prototype has no search index (recon: search today is client-side `libraryHaystack`/`matchesLibraryFilters` in `collections-ui.js`, in-memory). [Source: docs/bmad/PRD.md#FR-16]
- Story 9.1 (Search UX) ranks over this index across captured text/title/summary/notes. This story only builds the index + maintenance; the search route/UX is 9.1.

### Why this design (anti-pattern prevention)

- **One `search_blob`, not per-field FTS columns.** Boards have dynamic, descriptor-defined fields (schema-as-data) — per-field FTS columns would require a schema migration per new board, defeating AD9. A single synthetic blob means any board is searchable with zero schema change. Do NOT add `fts_title`, `fts_summary`, etc. [Source: docs/bmad/architecture.md#5]
- **Maintain the blob inside the writer's transaction.** If `search_blob`/FTS update happens outside the item write, a crash between them leaves the index stale. Centralize blob+FTS maintenance in the single-writer write path (Story 1.3) so it's atomic with the item row. [Source: docs/bmad/PRD.md#NFR-2 — atomic writes]
- **Descriptor-driven searchability, with a safe fallback.** Use the descriptor to pick searchable fields, but never crash a write because a descriptor field is missing — fall back to concatenating string values. Search is a convenience, not a write-blocking dependency.
- **Verify FTS5 is compiled in.** Not all SQLite builds include FTS5. Assert availability at init with a clear, actionable error (Epic 11 packaging on Debian LXC must ensure an FTS5-enabled build). [Source: docs/bmad/architecture.md#2 — FTS5]

### Test design notes

- Use distinctive nonsense terms ("zqxwv") in test fields so matches are unambiguous and don't collide with default tokenizer stop-words.
- Cover insert / update / delete index maintenance — the update/delete cases are where naive implementations drift.
- Assert both a hit (term present → row) and a miss (term absent → empty) so the test can't pass by returning everything.

### Project Structure Notes

- `db/search-blob.ts` (new, pure), `db/fts.test.ts` (new); `db/schema.ts` + write path updated. All under `db/` per architecture §6.
- ESM `.js` specifiers; `node:test`; add the new test to the `test` script.

### Testing standards

- Temp DB under `os.tmpdir()`; never real data.
- The blob-assembly function is pure → test it directly (input fields → expected concatenation) separately from the SQL/FTS integration.
- Existing 7 suites stay green.

### References

- [Source: docs/bmad/architecture.md#5-data-model] — FTS5 virtual table over `search_blob` only; synthetic concat assembled on write; non-deferrable.
- [Source: docs/bmad/architecture.md#2-tech-stack] — SQLite/Drizzle with FTS5.
- [Source: docs/bmad/PRD.md#FR-16] — full-text search across captured text/titles/summaries/notes, backed by `search_blob` maintained on write (net-new over prototype).
- [Source: docs/bmad/PRD.md#NFR-2] — atomic writes; FTS5 over `search_blob`.
- [Source: docs/bmad/epics.md#Story-9.1] — the search UX that ranks over this index.
- [Source: collections-ui.js#30-46] — the prototype's in-memory `libraryHaystack`/`matchesLibraryFilters`/`topicCounts` that FTS5 replaces server-side.
- [Source: docs/bmad/stories/1-2-board-descriptor-seeded-boards.md] — the descriptor that tells the blob builder which fields are searchable.
- [Source: docs/bmad/stories/1-3-single-writer-queue.md] — the write path where blob+FTS maintenance is hooked transactionally.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (BMAD dev-story workflow)

### Debug Log References

- `npm test` → 123 pass / 0 fail (117 prior + 6 new: 2 pure buildSearchBlob + 4 FTS integration).

### Completion Notes List

- ✅ All 4 ACs satisfied.
- **FTS5 table** = `CREATE VIRTUAL TABLE IF NOT EXISTS item_fts USING fts5(item_id UNINDEXED, search_blob)` (raw SQL in `db/index.ts`). **Standalone** (not external-content) table chosen because `item.id` is TEXT (no clean integer-rowid linkage); `item_id` stored UNINDEXED for lookup, maintained by plain INSERT/DELETE keyed on it.
- **FTS5 availability check:** the `CREATE VIRTUAL TABLE … fts5` exec is wrapped in try/catch that rethrows a clear, actionable error ("SQLite was built without FTS5…") — Epic 11 packaging must ship an FTS5-enabled build.
- **`buildSearchBlob(item, descriptor?)`** (pure, `db/search-blob.ts`): always includes `title` + `notes`; descriptor-driven field selection — searchable types = `{text, tags, enum, url}`; `number`/`date`/`image` excluded. AC1 proven by asserting a number (`42`) and image path (`secretzzz`) do NOT appear in the blob/index. **Safe fallback** (no descriptor): concat every string / string-array value in `item.fields` (numbers skipped) — search never blocks a write.
- **Transactional maintenance:** `writeItem` (the 1.3 choke-point) now recomputes `search_blob` from the board's descriptor and re-syncs the FTS row (delete-then-insert) *inside 1.3's transaction*, so item row + blob + FTS are atomic and cannot drift. Added `deleteItem(handle, id)` to remove item + FTS row atomically. The 1.3 NIT (id spread into the UPDATE set) is also fixed — `id` is now excluded from the `onConflictDoUpdate` set.
- **Insert/update/delete index maintenance** all covered (update: stale term gone + new term present; delete: term gone + row gone). Hit + miss both asserted so the test can't pass by returning everything.
- **Scope respected:** search route/UX is Story 9.1; this story builds only the index + maintenance. Per-field FTS columns deliberately NOT created (one synthetic blob = any board searchable with zero schema change).

### File List

- `db/search-blob.ts` (new) — pure `buildSearchBlob` (descriptor-driven, with fallback).
- `db/fts.test.ts` (new) — 2 pure + 4 integration tests (write→blob→FTS, update, delete, hit/miss).
- `db/index.ts` (modified) — FTS5 virtual table DDL + availability check.
- `db/queue.ts` (modified) — `writeItem` now assembles blob + syncs FTS in-transaction; added `deleteItem`; fixed id-in-update-set.
- `package.json` (modified) — appended `db/fts.test.ts` to the `test` script.

### Change Log

- 2026-06-20 — Story 1.4 implemented: FTS5 over a synthetic search_blob, descriptor-driven blob assembly, transactional insert/update/delete index maintenance hooked into the writeItem choke-point. Status → review.
