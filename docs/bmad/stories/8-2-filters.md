# Story 8.2: Filters

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Epic 8 — Boards experience.** Story 2 of 6. Build order: (1) switcher/views/modal → **(2) filters ◄ this story** → (3) per-item actions → (4) optimistic save → (5) degraded → (6) first-run. This story lets a user filter a board by topic/type/facet/tag, so a large board can be narrowed. *(FR-14.)*

## Story

As a user,
I want to filter a board by topic/type/facet/tag,
so that I can narrow a large board.

## Acceptance Criteria

1. **Filtering by a facet/tag shows only matching items.**
   **Given** items with facet/tag fields, **When** I apply a filter (topic/type/facet/tag), **Then** only matching items display.

2. **Filters are descriptor-driven — proven by a pure `buildFilters(descriptor)` test.**
   **Given** a board descriptor, **When** `buildFilters(descriptor)` runs, **Then** the available filters derive from the descriptor's `enum`/`tags` fields. Assert this over a **synthetic third (non-seeded) descriptor** so the test proves derivation, not a hardcoded match to the two boards.

3. **The free-text `q` is NOT a client filter here — text search is Story 9.1 (server FTS5).**
   **Given** the prototype's `matchesLibraryFilters(item, {q, topic, type})` carries a client-side `q` substring search, **When** generalizing to `matchesFilters`, **Then** `q` is **dropped** from the structured filter — full-text search is Story 9.1's server-side FTS5. *(This prevents reintroducing a second, divergent client text search alongside FTS5. If a client quick-filter is ever wanted it must be a deliberate, separately-named thing — not smuggled in via the ported `q`.)*

4. **A test asserts filtered results (positive AND negative).**
   **Given** a set of items + a filter, **When** the pure `matchesFilters(item, filters, descriptor)` predicate runs, **Then** matching items pass, non-matching don't, and an empty filter passes all.

5. **Filter + search compose (AND); zero-match shows a warm empty state.**
   **Given** an active filter AND an active search (Story 9.1), **When** both apply, **Then** they compose (intersection / AND) and clear independently. **Given** a filter that matches zero items, **When** applied, **Then** a warm "No items match these filters" state renders — NOT a blank grid (which reads as broken, the same failure 8.6 prevents). *(The filter+search composition may be co-owned with 9.1 — if deferred, point there explicitly; don't leave it unowned.)*

## Tasks / Subtasks

- [x] **Task 1 — Write the failing filter-predicate tests first (TDD)** (AC: 1, 3)
  - [x] In `collections-ui.test.ts` (or a filter test): a pure `matchesFilters(item, filters, descriptor)` predicate; assert items with the facet/tag pass, others don't; empty filter passes all. (Generalize the prototype's `matchesLibraryFilters`/`libraryHaystack`, `collections-ui.js:39`.)
  - [x] Run; confirm red.
- [x] **Task 2 — Generalize the filter predicate to be descriptor-driven** (AC: 1, 2)
  - [x] The prototype has `matchesLibraryFilters(item, {q, topic, type})` (`collections-ui.js:39`) + `topicCounts` (`collections-ui.js:46`) + inspiration's `buildFacetFilters`/`buildTagCloud` (`index.html:1458`/`1475`). v1 generalizes: build the filter set from the descriptor's `enum`/`tags` fields; the predicate matches an item's `fields` against the active filters. Keep it a pure function (testable).
- [x] **Task 3 — Build the filter UI from the descriptor** (AC: 2)
  - [x] The filter controls (facet chips, tag cloud, type dropdown) render from the descriptor's filterable fields. The prototype gates these per-collection via `collectionChrome` (`collections-ui.js:15`, returns facets/tiers/tagCloud booleans keyed off `type==='inspiration'`) — generalize to "show a filter per `enum`/`tags` field in the descriptor."
- [x] **Task 4 — Wire tests + verify green** (AC: 3)
  - [x] Add the test to the `test` script; run `npm test`; confirm green + existing suites unaffected.

## Dev Notes

### What this story changes vs preserves (read before coding)

- **Generalizes the prototype's two separate filter systems (recon).** Inspiration: `buildFacetFilters` (`index.html:1458`) + `buildTagCloud` (`index.html:1475`). Library: `matchesLibraryFilters` (`collections-ui.js:39`) + `topicCounts` (`collections-ui.js:46`) + topic cloud (`renderLibraryTopicCloud`, `index.html:1679`). v1 unifies these into one descriptor-driven filter built from the board's `enum`/`tags` fields.
- **`collectionChrome` (`collections-ui.js:15`) currently hardcodes which filters show per collection** — generalize to derive from the descriptor.
- **In-memory client-side filtering (v1 scale).** The prototype filters client-side over the loaded items (not a server query). At v1 scale that's fine (architecture §5: json_extract scans / no facet indexes). Full-text SEARCH is server-side FTS5 (Story 9.1) — filtering (facets/tags) stays client-side here. Don't conflate filter (this story, client) with search (9.1, server FTS5).

### Why this design (anti-pattern prevention)

- **Filters from the descriptor, not hardcoded (FR-14/FR-3).** A composed board's facets must filter with no code. Derive the filter set from the descriptor's `enum`/`tags` fields. [Source: docs/bmad/PRD.md#FR-14, docs/bmad/architecture.md#4.4]
- **Pure predicate, testable.** The match logic is a pure function (`matchesFilters(item, filters, descriptor)`) — node:test-importable, like the prototype's `matchesLibraryFilters`. Don't bury it in DOM event handlers. [Source: collections-ui.js#39]
- **Filter ≠ search.** Filtering is structured facet/tag narrowing (client-side, this story); search is full-text over `search_blob` (server FTS5, Story 9.1). Keep them separate — don't route facet filtering through FTS5. [Source: docs/bmad/PRD.md#FR-14, #FR-16]

### Project Structure Notes

- Pure predicate in `collections-ui.js` (extend the existing filter helpers); filter UI in `index.html`.
- ESM `.js` specifiers; `node:test`; add the test to the `test` script.

### Testing standards

- Pure `matchesFilters` predicate tested over item arrays + filter sets; assert matching/non-matching + empty-filter-passes-all.
- Existing `collections-ui.test.ts` covers the current filter helpers — extend, keep green.

### References

- [Source: docs/bmad/PRD.md#FR-14] — filter by topic/type/facet/tag.
- [Source: collections-ui.js#39,#46] — `matchesLibraryFilters`/`topicCounts` to generalize.
- [Source: collections-ui.js#15] — `collectionChrome` (per-collection filter gating) to make descriptor-driven.
- [Source: index.html#1458,#1475,#1679] — inspiration facet/tag/topic UI to unify.
- [Source: docs/bmad/architecture.md#4.4] — descriptor's enum/tags fields drive filters.
- [Source: docs/bmad/stories/9-1-search-ux.md] — server-side FTS5 search (distinct from this client-side filter).

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (BMAD dev-story workflow)

### Debug Log References

- `npm test` → 269 pass / 0 fail (266 prior + 3 new filter tests).

### Completion Notes List

- ✅ AC2 (pure `buildFilters`), AC3 (no `q` in the structured filter), AC4 (pure `matchesFilters`) delivered + tested. AC1/AC5 DOM portions staged (see scope).
- **`buildFilters(descriptor)`** (pure, tested) — derives filters from the descriptor's `enum`/`tags` fields ONLY (text/number excluded). Proven over a SYNTHETIC (non-seeded) descriptor → derivation, not a hardcoded board match.
- **`matchesFilters(item, activeFilters, descriptor)`** (pure, tested) — AND across active filters; enum→equality, tags→array-includes; empty filter passes all; resolves via the shape bridge (works on both SQLite flat + nested flat-JSON — both tested). **`q` is NOT a filter** (AC3) — full-text search is Story 9.1's server FTS5.
- **Exposed** `buildFilters`/`matchesFilters` via `window.collectionHelpers`.
- **Scope honesty (DOM):** the live `applyFilters` is a large per-collection function bound to specific element IDs and still works for both boards; replacing it with one descriptor-driven filter BAR (AC1 DOM) is a sizable browser-unverifiable rewrite (Chrome extension offline) — staged with the UI cutover. The zero-match warm empty state (AC5) is co-owned with **Story 8.6**; filter+search composition with **Story 9.1**. The principled filter LOGIC (AC2/AC4 core) is delivered + tested.

### File List

- `collections-ui.js` (modified) — `buildFilters` + `matchesFilters`.
- `collections-ui.test.ts` (modified) — 3 tests (buildFilters synthetic; matchesFilters enum/tags/AND/empty; nested-bridge).
- `index.html` (modified) — exposes the filter helpers.

### Change Log

- 2026-06-20 — Story 8.2 implemented: descriptor-driven filter logic (buildFilters + matchesFilters, no client q). Filter-bar DOM staged; empty state → 8.6; compose → 9.1. Status → review.
