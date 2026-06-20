# Story 1.7: Library list view (rich rendering, topics/type filters, notes editing)

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Epic 1 — Multiple Collections.** Named *collections*, each a **type** with its own capture/schema/view, persisted in its own JSON file. No migration.
>
> **This is story 7 of 7.** Build order: (1) storage foundation → (2) processor registry / dispatch → (3) Library capture pipeline → (4) end-to-end CLI proof → (5) server collection API → (6) sidebar collection switcher → **(7) Library list view ◄ this story**. The final story turns the minimal Library list from 1.6 into a proper reading/reference view: rich rows, topic + type filters, a detail modal with key points, and editable notes saved back through the scoped API. This completes the epic — Library is fully usable end to end.

## Story

As the Board user,
I want the Library to render its items richly — summary, topics, type, key points, and editable notes — with filters that fit reference material,
so that the Library is as usable for reading/reference as the grid is for design inspiration.

## Acceptance Criteria

1. **Rich Library list rows.**
   - Each Library item renders: title (links to `url`), source host, `summary`, `topics` as chips, `author` (if present), and a `type` badge (`article|doc|paper|repo|video`). No screenshot, no tier badge, no design fields. Reuses the existing list-card visual language (`index.html:745-805`) minus the thumbnail.

2. **A detail modal for Library items.**
   - Opening a Library item shows `title`, `url`, `added`, `summary`, `key_points` (as a list), `topics`, and an **editable `notes`** textarea. It does NOT show the Inspiration design-analysis/reflection tabs. Reuses the modal shell (`index.html:1136-1141`).

3. **Editable notes persist.**
   - Editing notes and saving issues `PATCH /api/collections/library/items/:id` with `{ notes }` (story 1.5 allowlist), updates local state, and shows a save confirmation — mirroring the Inspiration reflection save (`index.html:1556-1585`).

4. **Library-appropriate filters + search.**
   - A topics filter (chip cloud, parallel to the tag cloud `index.html:1247-1262`) and a `type` filter, plus search over `title`/`summary`/`topics`/`author` (parallel to `applyFilters` `index.html:1281-1298`). Inspiration facet/tier filters do not appear for Library (continued from story 1.6). Clearing filters works.

5. **Inspiration remains unchanged.**
   - Switching back to Inspiration shows the unchanged grid/list/modal/filters from before the epic. No regression.

6. **Empty + loading states.**
   - Library with zero items shows the empty state from story 1.6; filtered-to-zero shows a "no matches" state consistent with the Inspiration empty pattern (`index.html:1462-1467`).

## Tasks / Subtasks

- [x] **Task 1 — Extract + test pure Library view logic first (TDD)** (AC: 4)
  - [x] Add to the served helper module (`collections-ui.js` from story 1.6) pure functions: `libraryHaystack(item)` (search string), `matchesLibraryFilters(item, { q, topic, type })`, and `topicCounts(items)`.
  - [x] Cover them in `collections-ui.test.ts`; add cases. Watch fail, then implement.
- [x] **Task 2 — Rich row renderer** (AC: 1, 6)
  - [x] Implement `renderLibraryList()` (replacing the minimal one from story 1.6): rows per AC 1, reusing `.list-card`/`.list-tags`/`.tag` styles; `type` badge styled like a neutral chip (not the tier colors).
  - [x] Wire row click → `openLibraryModal(id)`; keep the `more`/delete affordance consistent with the existing list (`index.html:1381, 1390-1392`).
- [x] **Task 3 — Library detail modal** (AC: 2, 3)
  - [x] Implement `openLibraryModal(id)` rendering the AC-2 content into `#modal-content` (`index.html:1139`); `key_points` as a `<ul>`; `notes` as a `textarea`.
  - [x] Save handler → `PATCH itemUrl('library', id) { notes }`; update local item + `currentItem`; show save status (reuse `.save-status` pattern `index.html:1013-1021, 1578-1580`).
- [x] **Task 4 — Library filters + search** (AC: 4, 6)
  - [x] Render a topics chip cloud + a `type` `<select>` shown only for Library; route search through `matchesLibraryFilters`. Reuse `clear-filters` wiring (`index.html:1834-1846`) extended for the Library controls.
  - [x] Filtered-to-zero → "no matches" state.
- [ ] **Task 5 — Manual verification** (AC: 1-6)
  - [ ] Browser pass: add 2-3 real Library links; verify rows, modal, key points, notes save + reload-persist, topics/type filters, search, empty + no-match states; switch to Inspiration and confirm it's untouched.
  - [ ] Note: localhost browser automation blocked — requires manual verification by user.

## Dev Notes

### What this story changes vs. preserves

- **`index.html` (UPDATE)** — builds on the collection-aware data layer + switcher from story 1.6. This story adds the Library *renderers/modal/filters*; it does not touch the data-fetch layer (already scoped in 1.6) beyond the notes PATCH.
  - **Preserve exactly:** all Inspiration rendering, modal, and filters. Keep Library rendering in its own functions (`renderLibraryList`, `openLibraryModal`, `matchesLibraryFilters`) rather than overloading the Inspiration ones — parallel renderers, selected by active collection (the chrome gating from story 1.6 decides which filters/controls show).
  - **Change:** replace the minimal Library list (1.6) with the rich one; add the Library modal + filters + notes save.
- **`server.ts` (USE, do not change)** — the PATCH allowlist already accepts `notes` (story 1.5).
- **`storage.ts` / `processor-library.ts` (USE, do not change)** — the `notes` field exists on the stored record (`notes: ""` from story 1.3 `buildEntry`).

### Concrete shapes

Library item (from story 1.3): `{ id, url, added, title, summary, topics[], author, type, key_points[], notes, analysis_agent, analysis_model }`.

```js
// pure, tested in collections-ui.test.ts
function libraryHaystack(item) { /* title + summary + topics + author, lowercased */ }
function matchesLibraryFilters(item, { q, topic, type }) { /* all independent; unset = all */ }
function topicCounts(items) { /* { topic: count } for the chip cloud */ }
```

### Why this design (anti-pattern prevention)

- **Parallel renderers, not one overloaded renderer.** Inspiration and Library have genuinely different shapes (screenshots/tiers/design vs summary/topics/key-points). Branching one mega-renderer with optional-everything is harder to keep correct than two small focused renderers chosen by active collection.
- **Reuse styles, not Inspiration semantics.** Reuse `.list-card`/`.tag`/modal CSS for visual consistency, but don't reuse tier colors or design-field labels — Library has no tiers or design analysis. The `type` badge is neutral.
- **Notes mirror reflection.** The notes save reuses the proven PATCH-and-confirm pattern; no new persistence concept.
- **Topics are open vocabulary.** The topics filter is derived from item data (`topicCounts`), like the tag cloud — there is no Library taxonomy endpoint (deferred in story 1.3).

### Project Structure Notes

- No new files expected beyond additions to `collections-ui.js` / `collections-ui.test.ts` (from story 1.6). All UI changes live in `index.html`. Flat layout; no build step.

### Testing standards

- **Same reality as story 1.6:** no frontend test harness is introduced. Unit-test the extracted pure logic (`libraryHaystack`, `matchesLibraryFilters`, `topicCounts`) with `node:test`; verify rendering, modal, notes-save, and filters **manually** in the browser (Task 5).
- Notes-save round trip can also be checked at the API layer via the story 1.5 `server.test.ts` pattern (PATCH `notes` on a temp-seeded Library item) — extend it if you want automated coverage of persistence.
- Follow project TDD-guard guidance for the inline DOM glue (extract logic to the tested module where feasible; manual verification for the rest).

### References

- [Source: index.html#745-805] — list-card CSS to reuse for Library rows (minus thumbnail).
- [Source: index.html#1136-1141, 1469-1554] — modal shell + Inspiration modal to parallel for Library.
- [Source: index.html#1556-1585, 1013-1021] — reflection save + save-status pattern to mirror for notes.
- [Source: index.html#1247-1262, 1281-1298, 1834-1846] — tag cloud, filter haystack, clear-filters to parallel for Library.
- [Source: index.html#1462-1467] — empty-state pattern.
- [Source: server.ts] — PATCH `notes` allowlist (story 1.5); [Source: processor-library.ts] — `notes` field origin (story 1.3).
- [Source: stories/1-6-sidebar-collection-switcher.md] — collection-aware data layer + chrome gating this builds on.

## Dev Agent Record

### Agent Model Used
claude-sonnet-4-6

### Debug Log References
Task 5 browser verification: localhost permission denied for Claude-in-Chrome automation. Requires manual browser pass by user.
TDD Guard was already disabled (`guardEnabled: false`) throughout this story.

### Completion Notes List
- Task 1: `libraryHaystack`, `matchesLibraryFilters`, `topicCounts` added to `collections-ui.js`; covered by 9 new tests in `collections-ui.test.ts` (85 total, 0 failures).
- Task 2: Rich `renderLibraryList()` replaces the minimal 1.6 version. Each row: title (bold link), hostname, type chip (neutral `.tag`), author if present, summary, topics chips, more/delete button aligned right. Row click → `openLibraryModal`. Empty state distinguishes no-items vs filtered-to-zero.
- Task 3: `openLibraryModal(id)` renders into `#modal-content`: title, url+hostname+added+author, type+topics chips, summary, key_points as `<ul>`, editable notes textarea. `saveLibraryNotes()` issues `PATCH itemUrl('library', id) { notes }`, updates local state and `currentLibraryItem`, shows `.save-status` flash. `closeModal()` clears `currentLibraryItem`.
- Task 4: `#library-type-filter` select (article/doc/paper/repo/video) and `#library-topic-cloud` container added to HTML. `applyCollectionChrome()` shows/hides them for library type. `renderLibraryTopicCloud()` builds clickable chips from `topicCounts(bookmarks)`. `applyFilters()` forks — library items go through `window.collectionHelpers.matchesLibraryFilters`. `clear-filters-btn` resets both library filter state vars and rebuilds topic cloud. Type filter has its own `change` event listener. Add and delete handlers call `renderLibraryTopicCloud()` for non-inspiration collections.
- Module script imports extended with `matchesLibraryFilters` and `topicCounts`.
- All 85 tests pass; 0 regressions.

### File List
- index.html (updated — rich Library renderer, modal, topic cloud, type filter, notes save)
- collections-ui.js (updated — libraryHaystack, matchesLibraryFilters, topicCounts)
- collections-ui.test.ts (updated — 9 new Library helper tests)
- stories/1-7-library-list-view.md (this file)
