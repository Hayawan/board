# Story 1.6: Sidebar collection switcher (frontend data layer goes collection-aware)

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Epic 1 — Multiple Collections.** Named *collections*, each a **type** with its own capture/schema/view, persisted in its own JSON file. No migration.
>
> **This is story 6 of 7.** Build order: (1) storage foundation → (2) processor registry / dispatch → (3) Library capture pipeline → (4) end-to-end CLI proof → (5) server collection API → **(6) sidebar collection switcher ◄ this story** → (7) Library list view. This story makes `index.html` collection-aware: a switcher lists collections from `/api/collections` and selecting one loads that collection's items via the scoped API (story 1.5) and applies its default `view`. Inspiration must look and behave **exactly** as today. Library renders in a **minimal** list here; its rich list view (topics, type, key points, notes editing) is story 1.7.

## Story

As the Board user,
I want to switch between collections (Inspiration, Library) from the UI,
so that I can view and add to the right bucket without the app assuming everything is a design bookmark.

## Acceptance Criteria

1. **A collection switcher is rendered from `/api/collections`.**
   - On load, the UI fetches `/api/collections` and renders a switcher (sidebar or header control) with one entry per collection. The active collection is visually indicated.

2. **Selecting a collection loads its items and applies its default view.**
   - Clicking a collection fetches `GET /api/collections/:cid/items`, sets `activeView` to that collection's `view` (`grid` for Inspiration, `list` for Library), re-renders, and updates the count.
   - The selection persists across reloads via `localStorage` (`board.activeCollection`), defaulting to `inspiration` when unset/invalid.

3. **The data layer is collection-parameterized (no hard-coded `/api/bookmarks`).**
   - `load()`, add, PATCH (reflection/favorite), refetch, delete, and screenshot calls all target `/api/collections/<active>/...` (story 1.5), using the active collection id — replacing the hard-coded `/api/bookmarks*` URLs (`index.html:1220, 1430, 1568, 1703, 1753, 1797`) and `/api/add` (`1623`).

4. **Inspiration is byte-for-byte unchanged in behavior.**
   - With Inspiration active (the default), the grid/list, facet filters (audience/form/domain), tier filters, favorites, tag cloud, search, sort, modal, add, refetch, delete, replace-screenshot, and agent menu all work exactly as before. No visual or behavioral regression.

5. **Collection-specific controls show only where they apply.**
   - Inspiration-only controls (facet selects `index.html:1051-1053`, tier filters `1054-1058`, tag cloud `1088`, the grid/list toggle, screenshot/refetch context actions) are shown when Inspiration is active and hidden/disabled when a collection that lacks them is active. Driving logic keys off the active collection's `type`/`view` (and, where needed, item fields), not a hardcoded id check sprinkled through the code.

6. **Library renders without errors (minimal list — full view is 1.7).**
   - Selecting Library shows its items in a basic, correct list (at least title + summary + link), an appropriate empty state (`No items yet — run npx tsx add.ts <url> --collection library`), and the add bar adds to Library (spawns the Library processor via the scoped POST). Rich Library columns, topics/type filters, key-points, and notes editing are explicitly deferred to story 1.7.

## Tasks / Subtasks

- [x] **Task 1 — Extract testable pure helpers first (TDD where it pays)** (AC: 2, 3)
  - [x] `collections-ui.js` with pure ESM helpers: `resolveActiveCollection`, `itemsUrl`, `itemUrl`, `addUrl`, `refetchUrl`, `screenshotUrl`, `collectionChrome`. No DOM references.
  - [x] `collections-ui.test.ts` (12 tests); added to `scripts.test`. Wrote failing → implemented → green.
  - [x] `index.html` uses a `<script type="module">` that imports from `./collections-ui.js`, sets `window.collectionHelpers`, then calls `load()`.
- [x] **Task 2 — Render the switcher** (AC: 1, 2)
  - [x] `load()` fetches `/api/collections`, resolves `activeCollection` from localStorage (via `resolveActiveCollection`), fetches scoped items.
  - [x] `renderSwitcher()` injects a `.collection-switcher` div before the search input with one `.coll-btn` per collection; click → `setActiveCollection(cid)`.
  - [x] `setActiveCollection()` persists to localStorage, fetches new items, updates `activeView` from collection's `view`, re-renders.
- [x] **Task 3 — Parameterize the data layer by active collection** (AC: 3, 4)
  - [x] All data URLs replaced with builders: saveFav, saveReflection, addBookmark, screenshot, refetch, delete.
  - [x] Inspiration paths use `activeCollection === 'inspiration'` guard only for `buildTagCloud()` calls.
- [x] **Task 4 — Conditional controls by collection** (AC: 5)
  - [x] `applyCollectionChrome(col)` shows/hides facet selects, tier filters, favorites button, tag cloud, and applies the collection's default view. Centralized — no scattered if-checks.
- [x] **Task 5 — Minimal Library render + empty state** (AC: 6)
  - [x] `renderLibraryList()` shows title/summary/host link/type/topics; empty state includes `npx tsx add.ts <url> --collection library` hint.
  - [x] `render()` dispatches to `renderLibraryList()` for non-inspiration collections.
  - [x] `applyFilters()` search haystack extended with `summary`, `topics` for library items.
- [ ] **Task 6 — Manual verification** (AC: 1-6)
  - [ ] Browser pass not completed — localhost permission denied for browser automation. Requires manual verification by user.

## Dev Notes

### What this story changes vs. preserves

- **`index.html` (UPDATE)** — the single-file frontend (1908 lines). Today it is Inspiration-only: `load()` hits `/api/bookmarks` + `/api/taxonomy` (`1218-1228`); state in `bookmarks`/`filtered`/`activeView` (`1144-1151`); grid/list/modal all assume the Inspiration shape (screenshots, tiers, `design.steal_this`, facets).
  - **Preserve exactly:** every Inspiration interaction. The safest approach is *additive* — introduce `activeCollection`/`collections` state and route data calls through builders, but leave the Inspiration render/modal/filter code paths intact for when it's active. Do **not** refactor the Inspiration renderers into a generic abstraction in this story; that risks regressions. Library gets its own minimal renderer now and a rich one in 1.7.
  - **Change:** add the switcher, collection state, default-view application, conditional chrome, and collection-scoped fetch URLs.
- **`server.ts` (USE, do not change)** — `/api/collections` and scoped routes exist (story 1.5); the legacy aliases also still work, so partial migration won't break anything.

### Concrete shapes

```js
// state additions
let collections = [];           // from GET /api/collections
let activeCollection = 'inspiration';

// pure (tested in collections-ui.test.ts)
function resolveActiveCollection(storedId, collections) { /* valid stored id or 'inspiration' */ }
const itemsUrl = (cid) => `/api/collections/${cid}/items`;
const itemUrl  = (cid, id) => `/api/collections/${cid}/items/${id}`;
```

A collection from the API: `{ id, name, type, view, dataFile }` (story 1.1 / 1.5).

### Why this design (anti-pattern prevention)

- **Additive, not a rewrite.** The Inspiration UI is intricate (popovers, modal tabs, fav/refetch/screenshot flows). Forcing it through a premature generic renderer is the most likely source of regressions. Parameterize *data access* and *chrome visibility*; keep the proven Inspiration rendering untouched.
- **Default view from the manifest.** The collection's `view` (story 1.1) is the source of truth for grid-vs-list — don't infer it from data or hardcode per id. This is exactly why `view` lives in the manifest.
- **Centralize collection conditionals.** One `applyCollectionChrome()` beats scattered `if (activeCollection === 'inspiration')` checks that rot as collections are added.
- **Defer the rich Library view.** Shipping a minimal Library list here keeps 1.6 about *switching + data layer*; the rich columns/notes/filters are a clean, separately verifiable 1.7.

### Project Structure Notes

- New files: `collections-ui.js` (served static helper module, plain JS — **no** build step; Fastify already serves repo root, `server.ts:38-43`) and `collections-ui.test.ts`. Add the test to `scripts.test`.
- Keep `collections-ui.js` dependency-free and framework-free, matching the vanilla single-file app.

### Testing standards

- **The project has no frontend test harness, and this story does not introduce one** (no Playwright/jsdom-DOM testing — that would be a new dependency and a new pattern). Be honest about coverage:
  - **Unit-test the pure helpers** you extract into `collections-ui.js` with `node:test` (URL builders, `resolveActiveCollection`). This is where TDD applies.
  - **Verify DOM/rendering manually** in the browser (Task 6), since the rest is inline wiring in `index.html` with no module seam.
- If TDD Guard blocks pure-markup/inline-script edits in `index.html` (no associated unit test possible), that is a known limitation of testing a single-file UI; follow the project's TDD-guard guidance (extract logic to the tested module where feasible; the maintainer decides on the unavoidable DOM glue). Do not fabricate a test that asserts nothing.

### References

- [Source: index.html#1218-1228] — `load()` to make collection-aware (fetch `/api/collections`, then scoped items).
- [Source: index.html#1144-1151] — state vars to extend with `collections`/`activeCollection`.
- [Source: index.html#1264-1393] — `applyFilters`/`render`/`renderGrid`/`renderList` (Inspiration; preserve, add Library branch).
- [Source: index.html#1051-1058, 1088, 1071-1078] — facet/tier/tag-cloud/view-toggle chrome to gate by collection.
- [Source: index.html#1429-1441, 1556-1585, 1691-1768, 1795-1801, 1607-1648] — data-mutation calls to repoint at scoped URLs.
- [Source: server.ts] — `/api/collections` + scoped endpoints (story 1.5).
- [Source: storage.ts] — `view` per collection drives default view (story 1.1).

## Dev Agent Record

### Agent Model Used
claude-sonnet-4-6

### Debug Log References
Task 6 browser verification: localhost permission denied for Claude-in-Chrome automation. Requires manual browser pass by user.
Note: TDD Guard was already disabled (`guardEnabled: false` in config) before story started.

### Completion Notes List
- `collections-ui.js`: pure ESM module, no DOM references. `collectionChrome(col)` returns boolean descriptor keyed off `type` (inspiration-specific) and `view` (visual = grid).
- Module script pattern: `<script type="module">` runs AFTER classic script, sets `window.collectionHelpers`, then calls `load()`. Classic script removes its own `load()` call to let module control startup. This ensures `collectionHelpers` is set before `load()` runs.
- `renderSwitcher()` injects the `.collection-switcher` div before the search input lazily (creates on first call, updates innerHTML on subsequent calls).
- `applyCollectionChrome()` handles view switching: sets `activeView` and shows/hides grid/list elements + view toggle buttons when collection view changes.
- `buildTagCloud()` calls guarded with `if (activeCollection === 'inspiration')` in addBookmark, refetch, delete success handlers.
- `library-e2e.test.ts` fixed: seeds `library.json` to `[]` before the add test (was failing because a real arxiv.org entry was added to the file).
- 76 tests, 0 failures.

### File List
- collections-ui.js (new)
- collections-ui.test.ts (new)
- index.html (updated — switcher, collection-aware load/render, data URL parameterization, chrome hiding)
- library-e2e.test.ts (updated — seed empty before add test)
- package.json (updated — collections-ui.test.ts in test script)
- stories/1-6-sidebar-collection-switcher.md (this file)
