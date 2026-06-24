# Story 15.1: View-definition model (saved cross-board lens)

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Epic 15 — AI board composer (views, not copies).** Story 1 of 3. Build order: **(1) view-definition model ◄ this story** → (2) composer proposes (assignments and/or a view) → (3) copy-on-write materialize. This story adds the `view` table — the additive lens that makes a "composed board" a read-only query over canonical items, never a duplicate pile. *(Decisions D10, D12; NFR-BC.)*
> ⏳ **Pending Hayawan's confirmation of the view-def hinge** (workshop hinge #1): a composed view = filter-defined lens + optional pin/order overlay stored **in the `view` row** — not a join table, not m2m on `item`. Until confirmed, this story stays `planned`.

## Story

As the maintainer,
I want a view defined by a saved query plus optional ordering/captions,
so that a "composed board" is a lens over canonical items, not a duplicate pile.

## Acceptance Criteria

1. **Additive `view` table.**
   **Given** the schema, **When** the bootstrap runs, **Then** a new `view` table stores `{id, name, filter (JSON), order (optional item-id array, JSON), captions (optional map, JSON)}` — **a row with JSON fields, NOT a join table** — and the `item` and `board` schemas are byte-for-byte unchanged (no new column on `item`, no FK from `item` to `view`). *(NFR-BC, workshop hinge #1)*

2. **Filter-defined (dynamic) resolution by default.**
   **Given** a saved view, **When** it is opened, **Then** its `filter` resolves **dynamically** — items that newly match the filter auto-appear without editing the view — by reusing the FTS5 `MATCH` path (`db/search.ts`) generalized to resolve **across boards** (the board scope is relaxed), plus structured predicates (e.g. `status`, `favorite`, `boardIds`, tag/field match). The board-scope relaxation + structured predicates are **new logic this story introduces**; the FTS5 ranking/quoting is reused.

3. **The `order` array is a pin/reorder OVERLAY in the view row.**
   **Given** a view with a non-empty `order` array, **When** resolved, **Then** the listed item-ids appear first in that explicit order and the remaining filter-matched items follow — the overlay is a **soft membership stored in the `view` table**, **NOT** a join column on `item` and **NOT** m2m on a home board. A pinned item-id that no longer matches/exists is skipped (no error).

4. **Resolution is strictly read-only.**
   **Given** a view is resolved (with or without an `order` overlay), **When** it returns items, **Then** **no** `item.board_id`, `item.fields`, `item.notes`, `item.favorite`, asset row, or any source row is created, updated, or deleted. A view read mutates nothing.

5. **Cross-board rendering is honest.**
   **Given** a view spanning boards with different descriptors, **When** rendered, **Then** it shows the **universal** fields (title, thumbnail/asset, source, tags) via the existing render-map (`descriptor/render-map.js`) and degrades per-board-specific descriptor columns gracefully (an item missing a column simply omits it — the renderer already skips empty values).

6. **Canonical meaning (single source of truth).**
   **Given** an item included in one or more views, **When** the item's fields/enrichment/notes are edited at its home, **Then** the change reflects in every view that includes it (a view holds no copy of item content — only the filter/order/captions).

7. **No regression (NFR-BC).**
   **Given** a pre-wave DB (existing Inspiration/Library boards, items, fields, notes, favorites, screenshot assets), **When** the `view` table is added and the app boots, **Then** the DB opens, seeds idempotently, serves every existing board/item unchanged, and **zero existing `item` rows are migrated or rewritten**. *(NFR-BC)*

## Tasks / Subtasks

- [x] **Task 1 — Write the failing schema/boot tests first (TDD)** (AC: 1, 7)
  - [x] In `db/schema.test.ts`: assert a `view` row round-trips `{id, name, filter, order, captions}` with the JSON columns as structured objects (mirror the existing `board → item → asset` round-trip at `db/schema.test.ts:122`).
  - [x] Add the NFR-BC boot/regression assertion: open a DB seeded with the existing boards/items, add the `view` table, re-open, and assert existing boards/items/assets are served unchanged and **no `item` row was touched** (extend the seed idempotency pattern in `db/seed.test.ts`).
  - [x] Run; confirm red.
- [x] **Task 2 — Add the additive `view` table (drizzle + raw bootstrap, in lockstep)** (AC: 1, 7)
  - [x] Add `views` to `db/schema.ts` (`text id` PK, `text name`, `text('filter', {mode:'json'})`, nullable `text('order', {mode:'json'})`, nullable `text('captions', {mode:'json'})`, `created_at`/`updated_at` like `board`). Do **not** add any column to `items`/`boards`.
  - [x] Mirror it as `CREATE TABLE IF NOT EXISTS view (...)` in `BOOTSTRAP_SQL` (`db/index.ts:22`) — both must match, the way `board`/`item`/`asset` already do (`db/index.ts:13-17` explains why both exist; `schema.test.ts` guards drift).
  - [x] Add the `View`/`NewView` `$inferSelect`/`$inferInsert` types.
- [x] **Task 3 — Implement read-only view resolution** (AC: 2, 3, 4, 6)
  - [x] New `db/view.ts` (pure read module, alongside `db/search.ts`). `resolveView(handle, viewRow): Item[]`:
    - filter → SELECT (generalize the FTS5 `MATCH` path from `db/search.ts` to drop/relax `i.board_id = ?` and add structured predicates: `boardIds?`, `status?`, `favorite?`, tag/field match); hydrate through Drizzle so `fields` is parsed JSON (same as `searchItems`).
    - apply the `order` overlay: pinned ids first (in order, skipping missing/non-matching), then the rest.
    - perform **only** SELECTs — no INSERT/UPDATE/DELETE anywhere in this module.
  - [x] Test (AC4): snapshot every source row's `updatedAt`/`board_id` before resolve, assert unchanged after; assert editing a source item's field changes what the view returns (AC6, single source of truth).
- [x] **Task 4 — Cross-board rendering (universal fields, graceful degrade)** (AC: 5)
  - [x] Reuse `renderFields`/`renderAsset` (`descriptor/render-map.js`) per item against its **home board's** descriptor; verify a view spanning two descriptors renders universal fields and omits absent per-board columns (the renderer already skips empty values — assert it).
- [x] **Task 5 — Wire tests + verify green** (AC: 7)
  - [x] Append the new test file(s) to the `test` script; run `npm test`; confirm green + existing suites (schema, seed, search) unaffected.

## Dev Notes

### What this story changes vs preserves (read before coding)

- **Adds one new table (`view`) — nothing else.** `item` and `board` schemas are untouched: no new `item` column, no `item→view` FK, no join table, no m2m. The view is a row of JSON (`filter` + optional `order` + optional `captions`). This is the workshop's D12 line held: **single-FK home board stays; the lens is additive.** [Source: docs/bmad/epics-v2.md#L200, docs/bmad/epics-v2.md#L210, db/schema.ts#L26-54]
- **Resolution reuses the FTS5 path but relaxes board scope.** `searchItems` hard-filters `i.board_id = ?` (`db/search.ts#L39`); a cross-board lens must generalize that. There is **no pre-existing facet layer** to call — the structured predicates + board-scope relaxation are introduced here, on top of the existing FTS5 `MATCH`/bm25/quoting. [Source: db/search.ts#L34-51]
- **A view never mutates a source item.** `resolveView` is SELECT-only. It holds no copy of item content — only the query. Edits/enrichment at the item's home flow into every view automatically (AC6). [Source: docs/bmad/epics-v2.md#L211-213]
- **Rendering reuses the generic render-map.** Cross-board honesty = render the universal fields and let the existing `renderFields` skip empty per-board columns. No new per-board frontend code. [Source: descriptor/render-map.js#L64-79]

### Why this design (anti-pattern prevention)

- **A view is a row, not a join (D10/D12).** The rejected alternative is the m2m/global-pool refactor (workshop hinge #1, D12) — it would fork the enriched meaning across copies. Storing `filter` + an optional pinned-`order` array **in the view row** keeps exactly one canonical item and one home board. [Source: docs/bmad/epics-v2.md#L49, docs/bmad/epics-v2.md#L57-59]
- **Dynamic-by-default, pins are an overlay.** If membership were a frozen id-list, a view would rot (new matches never appear). Filter resolves live; the `order` array only pins/reorders what already matches. [Source: docs/bmad/epics-v2.md#L211]
- **Read-only resolution protects NFR-BC.** Opening a lens must never write — that is what guarantees existing boards/items are untouched. The test asserts zero mutation, not just "looks right." [Source: docs/bmad/epics-v2.md#L24-32]
- **Additive in BOTH schema places.** Drizzle `db/schema.ts` *and* raw `BOOTSTRAP_SQL` in `db/index.ts` must gain the table together — they are kept in lockstep on purpose (the schema round-trip test guards drift). [Source: db/index.ts#L13-17, db/index.ts#L22-64]

### Project Structure Notes

- New `db/view.ts` (read-only resolver), beside `db/search.ts`. Table in `db/schema.ts` + `BOOTSTRAP_SQL` (`db/index.ts:22`).
- **Name-collision caution (raw DDL is hand-written here):** the new table is `view`, but `board.view` is already a column (= `grid`|`list`, `db/schema.ts:20`) and `VIEW` is a SQL keyword. The `order` column is **also** a SQL keyword. Because this codebase hand-writes the raw `BOOTSTRAP_SQL` (`db/index.ts:22`) — not only Drizzle, which auto-escapes — both identifiers must be **quoted in the raw `CREATE TABLE`/INSERT DDL** or they are syntax errors. Keep the names `view` and `order` (per the data-model decision/AC) but quote them where SQLite needs it, and never conflate the table with `board.view`.
- ESM `.js` specifiers; `node:test` + temp-DB injection (no global handle); add new test files to the `test` script.

### Testing standards

- Temp DB per test; assert the `view` row round-trips JSON columns as objects.
- The load-bearing assertions are **read-only resolution** (snapshot source rows, assert byte-identical after resolve) and **NFR-BC boot** (pre-wave DB opens + serves existing boards/items unchanged, zero `item`-row migration).
- Extend `db/schema.test.ts` (round-trip) and `db/seed.test.ts` (idempotent boot) rather than forking new boot logic.

### References

- [Source: docs/bmad/epics-v2.md#L198-214] — Epic 15 goal + Story 15.1 ACs (additive `view` table, dynamic filter + pin overlay, read-only, canonical meaning).
- [Source: docs/bmad/epics-v2.md#L24-32] — NFR-BC wave constraint (no destructive migration; boot/regression test).
- [Source: docs/bmad/epics-v2.md#L49,#L57-59] — D12 (reject m2m/global pool) + the home-board/composed-view reconciliation.
- [Source: db/schema.ts#L17-67] — `board`/`item`/`asset` tables this story must leave unchanged (model the new `view` table on `board`).
- [Source: db/index.ts#L13-17,#L22-71] — why drizzle + raw `BOOTSTRAP_SQL` are kept in lockstep; the FTS5 `item_fts` definition.
- [Source: db/search.ts#L26-51] — `searchItems` (FTS5 `MATCH` + bm25 + hydrate) — the board-scoped path the cross-board resolver generalizes.
- [Source: descriptor/render-map.js#L64-79] — `renderFields`/`renderAsset` for cross-board universal-field rendering (skips empty values).
- [Source: db/seed.test.ts] — the idempotent-boot test pattern to extend for the NFR-BC assertion.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (1M context)

### Debug Log References

- Workshop hinge #1 CONFIRMED by the maintainer (2026-06-23): a composed view = filter-defined lens + optional pin/order overlay stored in the `view` row — not a join table, not m2m. Epic 15 unblocked on this decision.
- Full suite: **475 pass / 0 fail** (+10 over 16.3: 3 schema/boot, 7 resolveView incl. the review-added cross-descriptor span + whitespace-routing tests).

### Completion Notes List

- **Additive `view` table, NOT a join (AC1/D12).** A view is a row of JSON — `filter` (live query) + optional `order` (pinned-id overlay) + optional `captions`. `item`/`board` schemas are byte-for-byte unchanged: no new column, no `item→view` FK, no m2m. Items keep one canonical home board. Drizzle table (`db/schema.ts`) + raw `BOOTSTRAP_SQL` (`db/index.ts`) are in lockstep; the round-trip test inserts via Drizzle into the raw-DDL table, so any column/nullability drift throws.
- **`view`/`order` are SQL keywords — quoted in the raw DDL.** Verified by the boot test opening a FRESH DB through the real `initDb` bootstrap (a quoting error would throw at boot/insert).
- **Two-path resolution (AC2).** `filter.query` present → FTS5 `MATCH` (board scope RELAXED vs `searchItems`) + structured predicates `AND`-ed on `item`, ordered by FTS rank. Blank/whitespace/missing query → plain `SELECT` with predicates, `ORDER BY created_at DESC, id` (deterministic). The blank case MUST skip FTS (`MATCH '""'` matches nothing) — a review-added whitespace-query test locks this. Predicates: `query`, `boardIds`, `status`, `favorite`; all values bound as `?` params (the `IN (?,?,…)` is built from array length only). Tags ride the FTS query (already in `search_blob`); a richer JSON field-query engine is intentionally deferred.
- **Dynamic membership, not a frozen list (AC2).** Proven discriminating: resolve N → insert a newly-matching item (view row untouched) → re-resolve N+1.
- **Order overlay (AC3).** Pinned-AND-matching ids first (in pin order), rest follow; a pinned id that no longer matches/exists is skipped (no error). Proven by pinning an id that is NOT naturally first (asserted to land first), plus a ghost-pin skip.
- **Strictly read-only + canonical meaning (AC4/AC6).** `resolveView` is SELECT-only. Test snapshots a source row and asserts byte-identity after resolve, then edits the item's field and asserts the view reflects it (a view holds no copy).
- **Cross-board rendering (AC5).** Reuses the existing `renderFields` per item against its HOME board's descriptor. **Review fix (Quinn):** the test now spans BOTH seeded descriptors (Library `summary` vs Inspiration `meta.*`), rendering each item against its home descriptor and asserting a foreign-descriptor render omits the absent column (graceful degrade) — not the original single-board synthetic-descriptor check.
- **Review fixes applied (party-mode):** genuine two-descriptor AC5 span; whitespace-query routing test; `toFtsPhrase` exported from `search.ts` and imported (no duplicate, avoids FTS-escaping drift); a one-line note on the deliberate no-LIMIT (a lens returns its whole membership).
- **Scope honesty:** `captions` is stored but not yet read by `resolveView` (forward-looking for the rendering UI; 15.2 writes it, later UI reads it). Mounting views into the SPA is staged DOM for a later Epic 15 story — 15.1 delivers the read-model + resolver.

### File List

- `db/schema.ts` (modified) — additive `views` table + `View`/`NewView` types.
- `db/index.ts` (modified) — `CREATE TABLE IF NOT EXISTS "view"` in BOOTSTRAP_SQL (quoted keywords).
- `db/view.ts` (new) — `resolveView` (two-path, read-only, overlay) + `ViewFilter`/`ViewLike`.
- `db/search.ts` (modified) — export `toFtsPhrase` (shared with the resolver).
- `db/schema.test.ts` (modified) — view round-trip + null-overlay + NFR-BC boot tests.
- `db/view.test.ts` (new) — 7 resolveView tests (dynamic, FTS cross-board, overlay, read-only/canonical, predicates, two-descriptor render, whitespace routing).
- `package.json` (modified) — `db/view.test.ts` added to the `test` script.

### Change Log

- 2026-06-23 — Story 15.1 implemented (TDD), after maintainer confirmation of the view-def hinge. Additive `view` table (saved cross-board lens) + read-only `resolveView` (dynamic filter + pin/order overlay), reusing the FTS path generalized across boards. NFR-BC: additive, no item migration, item/board schemas unchanged. Party-mode review applied (two-descriptor span, whitespace routing, DRY FTS helper). Epic 15 Story 1 of 3. Suite 475 pass / 0 fail.
