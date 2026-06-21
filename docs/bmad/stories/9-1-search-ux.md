# Story 9.1: Search UX over search_blob

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Epic 9 — Full-text search.** Expose FTS5 search across captured text, titles, summaries, and notes. *(FR-16.)*
>
> **Story 1 of 1 in Epic 9.** This story exposes a search endpoint + UI that ranks over the `search_blob` FTS5 index (built in Story 1.4) across captured text/title/summary/notes. *(FR-16.)*

## Story

As a user,
I want to full-text search my items,
so that I can re-find things.

## Acceptance Criteria

1. **Ranking is real: of two matches, the stronger ranks higher.**
   **Given** TWO items both matching a term — one with the term in its `title`, one with it only in body text — **When** searched, **Then** the title-match ranks above the body-only match (bm25/`rank` over `search_blob`). *(Assert ordering of two hits — "results came back ranked" with one item is vacuous.)*

2. **A known item is found by a term; a non-matching term returns empty.**
   **Given** an item whose fields contain a distinctive term (use a nonsense token like `zqxwv` to dodge tokenizer stop-words), **When** searched, **Then** the item is in the results; a non-matching term returns empty.

3. **Search is scoped to the active board (decided), with cross-board exclusion.**
   **Given** the UI shows one board, **When** I search, **Then** results are scoped to the **active board** (decided — matches the browse context). A matching item on board B does NOT appear when searching board A.

4. **A malformed FTS5 query does not 500 (syntax safety).**
   **Given** a query with FTS5-special chars (e.g. `foo"bar`, `AND`, `*`), **When** searched, **Then** it returns results or empty — it does NOT 500. *(FTS5 syntax injection is real; see the sanitization in Dev Notes.)*

5. **Search composes with filters (Story 8.2) — pinned mechanism.**
   **Given** an active filter (Story 8.2's pure `matchesFilters(item, filters, descriptor)`) AND a search term, **When** both apply, **Then** the filter predicate is applied (client-side) to the server's FTS5 result set → the **intersection**; clearing one preserves the other. *(This pins where the AND happens — 8.2 AC5 deferred composition ownership here.)*

6. **A test asserts hit/miss, ranking, scope, no-500, and compose.**
   **Given** seeded items (temp DB, written via the typed item-write so FTS is populated — a raw INSERT skips 1.4's FTS maintenance and the hit test would falsely fail), **When** the search endpoint is `inject()`ed, **Then** the test asserts: the matching item returned + a non-matching term empty (AC 2); two-hit ordering (AC 1); cross-board exclusion (AC 3); a special-char query → no 500 (AC 4); filter∩search intersection (AC 5).

## Tasks / Subtasks

- [ ] **Task 1 — Write the failing search tests first (TDD)** (AC: 1, 2, 3, 4, 5, 6)
  - [ ] Seed via the typed item-write (FTS populated, Story 1.4); `inject()` the search; assert hit/miss (AC 2), two-hit ordering (AC 1), cross-board exclusion (AC 3), special-char→no-500 (AC 4), filter∩search (AC 5).
  - [ ] Run; confirm red — the expected red is the route being **absent (404)**, not a wrong assertion.
- [ ] **Task 2 — Implement the search query over FTS5 (correct sanitization)** (AC: 1, 2, 3, 4)
  - [ ] Query the FTS5 table (Story 1.4) ranked (bm25/`rank`), joined to `item`, scoped to the active board (AC 3). **Sanitize correctly:** a parameterized `MATCH ?` stops SQL injection but NOT FTS5 *syntax* errors — SQLite still hands the bound value to the FTS5 query parser, so `foo"bar` still throws. Wrap the whole input as a single quoted phrase AND double embedded quotes: `const ftsQuery = '"' + q.replace(/"/g, '""') + '"';` then `MATCH ?` with `ftsQuery`. (AC 4.)
  - [ ] Expose it as a **`search` skill** (`POST /skills/:name`) — the AD11 default (every capability is a skill); a raw REST GET is the exception, not a neutral equal. (If a GET is chosen for UI simplicity, cite AD11 as the exception + justify.)
- [ ] **Task 3 — Build the search UI** (AC: 3, 4)
  - [ ] A search input (the prototype has a client-side `q` in `matchesLibraryFilters` — recon — that Story 8.2 dropped in favor of server FTS5; this is its server-backed replacement). On query, call the search endpoint, render results in the board's view. Compose with active filters (Story 8.2 AC 5) — AND them.
- [ ] **Task 4 — Wire tests + verify green** (AC: 5)
  - [ ] Add the test to the `test` script; run `npm test`; confirm green + existing suites unaffected.

## Dev Notes

### What this story changes vs preserves (read before coding)

- **Exposes the FTS5 index from Story 1.4.** 1.4 built the `search_blob` + FTS5 table + maintenance; this story is the query + UI on top. No schema work here — just SELECT over FTS5.
- **Replaces the prototype's in-memory client search (recon).** The prototype searches client-side via `libraryHaystack`/`matchesLibraryFilters` `q` (`collections-ui.js:30,39`) over the loaded items. v1 moves full-text search SERVER-side over FTS5 (scales beyond the loaded page, ranks properly). Story 8.2 explicitly dropped the client `q` for this.
- **Search (FTS5, this story) ≠ filter (facets/tags, Story 8.2, client-side).** They compose (AC 4) but are distinct mechanisms. Don't route facet filtering through FTS5 or text search through the facet predicate.

### Why this design (anti-pattern prevention)

- **Server-side FTS5, not client substring (FR-16).** Client substring search only sees the loaded page and can't rank. FTS5 over `search_blob` searches all items and ranks (bm25). This is the net-new-over-prototype capability. [Source: docs/bmad/PRD.md#FR-16, docs/bmad/architecture.md#5]
- **Sanitize the FTS5 query CORRECTLY — a bound param is not enough.** A parameterized `MATCH ?` stops SQL injection, but SQLite still passes the bound value to the FTS5 *query parser*, so `foo"bar` (unterminated quote) still 500s. The real fix is to quote the whole input as one phrase AND double embedded quotes: `const ftsQuery = '"' + q.replace(/"/g, '""') + '"';`. This treats the input as a literal phrase (no FTS5 operators), which is the right behavior for a simple search box. [Source: docs/bmad/architecture.md#5]
- **Note the dependency:** this story is gated on Story 1.4 (the FTS5 index) and Story 8.2 (which dropped the client `q` for this) landing first. The current OSS tree is still flat-JSON — no `db/`/FTS5 yet.
- **Compose with filters, don't conflate.** Search + filter AND together (AC 4) but stay separate code paths — search is FTS5 (server), filter is the facet predicate (client, Story 8.2). [Source: docs/bmad/stories/8-2-filters.md]
- **Search across the right fields.** `search_blob` is the synthetic concat of title/text/enrichable/notes (Story 1.4) — so search covers captured text, titles, summaries, AND notes (FR-16 names all four). Since notes refresh `search_blob` on PATCH (Story 8.3), an edited note is immediately searchable. [Source: docs/bmad/PRD.md#FR-16, docs/bmad/stories/1-4-fts5-search-blob.md]

### Project Structure Notes

- Search query over FTS5 (in `db/` or a `search` skill); search UI in `index.html`. FTS5 table from Story 1.4.
- ESM `.js` specifiers; `node:test` + `inject()`; add the test to the `test` script.

### Testing standards

- Temp DB seeded via the typed item-write (so FTS is populated); assert hit + miss + ranking.
- Include a query with FTS5-special chars (e.g. a quote) → assert no 500 (the sanitization).
- Existing suites green.

### References

- [Source: docs/bmad/PRD.md#FR-16] — full-text search across captured text/titles/summaries/notes (FTS5).
- [Source: docs/bmad/architecture.md#5-data-model] — FTS5 over search_blob.
- [Source: collections-ui.js#30,#39] — prototype's in-memory client search this replaces server-side.
- [Source: docs/bmad/stories/1-4-fts5-search-blob.md] — the FTS5 index this queries.
- [Source: docs/bmad/stories/8-2-filters.md] — the filter this composes with (and that dropped client `q` for this).
- [Source: docs/bmad/stories/8-3-per-item-actions.md] — notes PATCH refreshes search_blob (edited notes are searchable).

## Dev Agent Record

### Agent Model Used

_(to be filled by dev agent)_

### Debug Log References

### Completion Notes List

### File List
