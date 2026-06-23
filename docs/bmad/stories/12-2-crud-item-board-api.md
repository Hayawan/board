# Story 12.2: CRUD item + board API (versioned, reuses the async queue)

Status: draft

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Epic 12 — Public API & auth keystone.** Story 2 of 2. Build order: (1) bearer-token auth → **(2) CRUD item + board API ◄ this story**. This story exposes token-authed CRUD over items (plus the board list to target them) under the versioned `/api/v1` prefix established in 12.1 — the stable contract every capture client (bookmarklet, PWA, extension) speaks. It REUSES the existing single-writer queue and the Story 8.3 item helpers; it adds no new delete/cleanup logic. *(D1, NFR-BC; reuses Epic 5 queue.)*

## Story

As a 3rd-party client (bookmarklet/PWA/extension),
I want full CRUD over items plus the board list,
so that I can save a URL, list recent additions, edit, and delete via a stable contract.

## Acceptance Criteria

1. **Create-from-URL returns optimistic pending.**
   **Given** `POST /api/v1/items {url, boardId}` naming an **existing** target board, **When** handled, **Then** it creates a `pending` item on that board by calling `addItemSkill.run({ boardId, source: url }, ctx)` (the same path as the existing `POST /api/collections/:cid/items`, `server.ts:491-508`), which enqueues capture/enrich on the existing single-writer queue (`enqueueWrite`, `db/queue.ts:34`), and returns the item **immediately** via `getItemForUi` (no blocking on capture). A missing/blank `url` → `400` before the DB is opened. An unknown `boardId` → `400` (the FK insert fails; surfaced as a client error). *(12.2 requires an existing `boardId` and does NOT default to Inbox — that default is added in 13.1 once the Inbox exists, honoring "no story depends on a later story.")* *(reuses Epic 5 queue)*

2. **List with filters + recency + pagination.**
   **Given** `GET /api/v1/items?board=&status=&limit=&offset=&since=`, **When** handled, **Then** it returns items ordered **newest-first** (by `created_at`, using `idx_item_created_at`, `schema.ts:52`), filtered by the supplied `board`/`status`, windowed by `limit`/`offset`, and restricted to `created_at >= since` when `since` is given. Defaults: a bounded `limit` (e.g. 50), `offset` 0, no filters → all boards. This powers the popover/PWA "recent additions".

3. **Patch + delete reuse v1 semantics.**
   **Given** `PATCH /api/v1/items/:id` and `DELETE /api/v1/items/:id`, **When** handled, **Then** they call the Story 8.3 `patchItemFields(handle, id, patch)` (user-field allowlist; disallowed keys silently ignored) and `deleteItemWithAssets(handle, id, screenshotsDir)` (row cascade via `deleteItem` + asset-FILE unlink) respectively — **no new delete/cleanup logic, no orphaned files**. Unknown id → `404`; delete → `204`. (`item-actions.ts:25,#63`.)

4. **Board list for targeting.**
   **Given** `GET /api/v1/boards`, **When** handled, **Then** it returns each board's `{ id, name, view }` (selected from the `board` table, `schema.ts:17`) so a client can offer assignment targets. (Lean shape — descriptor JSON is not required for targeting.)

5. **No regression.**
   **Given** the existing item/board data in `board.db`, **When** the v1 API is exercised, **Then** existing boards/items are served and mutated **identically** to the legacy/collections routes, because the v1 routes call the **same** underlying helpers (`addItemSkill`, `patchItemFields`, `deleteItemWithAssets`, the same Drizzle `items`/`boards` tables) — no parallel write path, no schema change. An existing pre-wave DB opens and serves its boards/items unchanged through `/api/v1`. *(NFR-BC)*

6. **Tests inject the full lifecycle.**
   **Given** `buildServer({ apiToken, db: <temp seeded db> })`, **When** the tests `inject()` create → list → patch → delete (each with a valid bearer token), **Then** they assert: create returns a `pending` item immediately; list returns newest-first and honors `board`/`status`/`limit`/`offset`/`since`; patch applies the allowlist (a disallowed field is unchanged); delete returns `204` and the item's asset FILE is removed from the temp `screenshotsDir` (the orphan check). A no-regression test asserts an item created via the legacy/collections path is visible and mutable via `/api/v1` (shared store).

## Tasks / Subtasks

- [ ] **Task 1 — Write the failing CRUD lifecycle tests first (TDD)** (AC: 1, 2, 3, 6)
  - [ ] In `api/v1.test.ts`: build `buildServer({ apiToken: "test-token", db: <temp seeded db>, screenshotsDir: <temp dir> })`. All requests carry `Authorization: Bearer test-token` (auth itself is 12.1's concern, not re-tested here).
  - [ ] `inject()` `POST /api/v1/items {url, boardId: <seeded board>}` → assert `pending` item returned immediately (status `pending`/`processing`, id present).
  - [ ] Seed several items with known `created_at`; `inject()` `GET /api/v1/items?limit=&offset=&board=&status=&since=` → assert newest-first order + each filter narrows correctly.
  - [ ] `inject()` `PATCH /api/v1/items/:id {notes, favorite, status: "done"}` → assert notes/favorite applied, `status` (disallowed) unchanged.
  - [ ] Seed an item WITH an asset file on disk in the temp `screenshotsDir`; `inject()` `DELETE /api/v1/items/:id` → assert `204` AND the asset file is gone (no orphan).
  - [ ] Run; confirm red.
- [ ] **Task 2 — Implement `POST /api/v1/items` (create-from-URL, optimistic)** (AC: 1)
  - [ ] In `api/v1.ts` (the 12.1 plugin): add the route. Validate `url` (trim; `400` before `getDb`, mirroring `server.ts:495`). Build ctx lazily (`buildCtx({ db: handle, queue, logger, llm, boardId })`), call `addItemSkill.run({ boardId, source: url }, ctx)`, return `getItemForUi(handle, itemId)`. Unknown board → `400`. Do NOT default `boardId` (13.1 owns the Inbox default).
- [ ] **Task 3 — Implement `GET /api/v1/items` (filter + recency + pagination)** (AC: 2)
  - [ ] Write a NEW Drizzle query over `items`: optional `eq(boardId)`, `eq(status)`, `gte(createdAt, since)`; `orderBy(desc(createdAt))`; `limit`/`offset` (bounded default). Return the hydrated shape clients need (reuse the hydration adapter if it fits a flat list, else select the columns directly). This is genuinely new — `listBoardItemsForUi` is board-scoped, not paginated/filtered.
- [ ] **Task 4 — Implement `PATCH` + `DELETE /api/v1/items/:id` (reuse 8.3)** (AC: 3)
  - [ ] `PATCH`: `patchItemFields(handle, id, body)`; `404` if undefined; return the updated row (hydrated). `DELETE`: `deleteItemWithAssets(handle, id, screenshotsDir)`; `404` if `!deleted`; else `204`. No new logic — these are the exact helpers the `/api/items/:id` routes already use (`server.ts:359-374`).
- [ ] **Task 5 — Implement `GET /api/v1/boards` (targeting list)** (AC: 4)
  - [ ] Select `{ id, name, view }` from the `boards` table; return the array. (Lean — no descriptor needed for targeting.)
- [ ] **Task 6 — No-regression test (shared store)** (AC: 5)
  - [ ] Create an item via the legacy/collections path (or seed directly), then `inject()` `GET`/`PATCH /api/v1/...` and assert it's visible + mutable through v1 — proving v1 and the existing routes share one store + one set of helpers.
- [ ] **Task 7 — Wire tests + verify green** (AC: 6)
  - [ ] Add `api/v1.test.ts` to the `test` script; run `npm test`; confirm green AND existing suites unaffected.

## Dev Notes

### What this story changes vs preserves (read before coding)

- **All v1 routes mount in the 12.1 plugin (`api/v1.ts`), behind the bearer guard + CORS.** No new top-level routes in `server.ts`'s root app; the existing routes there are physically untouched (NFR-BC by construction).
- **CRUD is REST, not a skill.** The v1 skill list is FIXED (`registry.ts:52-62`: import-bookmarks, create-board, add-item, tag, upload-asset, refetch, search, compose-board, generate-fields) and does NOT include generic item CRUD. So PATCH/DELETE/list/board-list are REST endpoints (same call as 8.3 Task 4 made for `/api/items/:id`). Create-from-URL is the one that *invokes* a skill (`add-item`) internally, exactly as `POST /api/collections/:cid/items` does.
- **Reused (verified), not reinvented:**
  - Create → `addItemSkill.run({ boardId, source: url }, ctx)` + `buildCtx` + `getItemForUi` + optimistic-pending return (the template is `server.ts:491-508`).
  - Enqueue → the existing single-writer queue via the skill's ctx (`enqueueWrite`, `db/queue.ts:34`); 12.2 adds NO new queue.
  - PATCH → `patchItemFields` (`item-actions.ts:25`); DELETE → `deleteItemWithAssets` (`item-actions.ts:63`). Same helpers as `/api/items/:id` (`server.ts:359-374`).
- **Genuinely NEW:** only the filtered/paginated/recency list query (AC2). No existing helper does this — `listBoardItemsForUi` is single-board hydration, not a cross-board paginated query. Spec it as a new Drizzle `select` over `items` using `idx_item_created_at` (`schema.ts:52`).
- **No schema change, no new write path.** Items/boards are the same tables the rest of the app uses; v1 is a new *read/dispatch* surface over the same store. *(NFR-BC)*

### Why this design (anti-pattern prevention)

- **One store, one set of helpers — no parallel CRUD.** v1 PATCH/DELETE reuse `patchItemFields`/`deleteItemWithAssets` verbatim. A second, hand-rolled delete that forgot the asset-FILE unlink would re-introduce the orphaned-file bug 8.3 fixed. Reuse is the regression guarantee. [Source: item-actions.ts#63, docs/bmad/stories/8-3-per-item-actions.md]
- **Optimistic create, async capture.** Create returns the `pending` item immediately and lets capture/enrich run on the single-writer queue — a browser client (bookmarklet/PWA) must never block on a Chrome launch + LLM round-trip. This is the existing collections-POST contract, reused. [Source: server.ts#491-508, db/queue.ts#34]
- **Newest-first list off the indexed column.** Order by `created_at DESC` (indexed, `idx_item_created_at`) with a bounded `limit` default so a client polling "recent additions" can't request an unbounded scan. [Source: schema.ts#52]
- **Do NOT default `boardId` to Inbox here.** The Inbox board does not exist until 13.1; defaulting now would make 12.2 depend on a later story. Require an explicit existing `boardId`; 13.1 adds the default once the Inbox is seeded. [Source: docs/bmad/epics-v2.md#L94]
- **Lazy ctx / `opts.db ?? getDb()`.** Build the DB handle + ctx per request (the established pattern, `server.ts:362,#497`) so opt-less `buildServer()` callers and tests never open the real DB. [Source: server.ts#359-374]

### Project Structure Notes

- All routes added to `api/v1.ts` (the plugin from 12.1), so they inherit the bearer guard + CORS automatically.
- New list query is a Drizzle `select` over `items` (`db/schema.ts`); consider a small `db/list-items.ts` helper if it grows, but a route-local query is acceptable for v1.
- Reused helpers: `addItemSkill` (`skills/add-item.ts`), `buildCtx` (`skills/types.ts`), `getItemForUi` (`db/hydrate.ts`), `patchItemFields`/`deleteItemWithAssets` (`db/item-actions.ts`).
- ESM `.js` import specifiers; `node:test` + Fastify `inject()`; add `api/v1.test.ts` to the `test` script.

### Testing standards

- Hermetic: `buildServer({ apiToken: "test-token", db: <temp seeded db>, screenshotsDir: <temp dir> })`; every request carries the valid bearer token (auth pass/fail is 12.1's coverage, not re-tested here).
- Cover the full lifecycle: create (optimistic pending) → list (newest-first + each filter) → patch (allowlist; disallowed field unchanged) → delete (`204` + asset-file gone).
- The asset-file-cleanup-on-delete assertion is the one naive impls miss — seed a real file in the temp `screenshotsDir` and assert it's unlinked (the orphan check).
- The NFR-BC test is mandatory: an item created via the legacy/collections path is visible + mutable via `/api/v1` (shared store, shared helpers).

### References

- [Source: docs/bmad/epics-v2.md#L88-L99] — Epic 12 / Story 12.2 ACs (optimistic create, filtered+paginated list, reuse 8.3 patch/delete, board list, no-regression, lifecycle tests).
- [Source: docs/bmad/epics-v2.md#L94] — explicit note: 12.2 does NOT depend on the Inbox; `boardId`-default is added in 13.1.
- [Source: docs/bmad/epics-v2.md#L24-L33] — wave-wide NFR-BC.
- [Source: server.ts#491-508] — `POST /api/collections/:cid/items`: the create-from-URL template (validate → buildCtx → addItemSkill.run → getItemForUi optimistic return).
- [Source: server.ts#359-374] — `PATCH`/`DELETE /api/items/:id`: the reuse pattern (`opts.db ?? getDb()`, `patchItemFields`, `deleteItemWithAssets`, 404/204).
- [Source: item-actions.ts#25] — `patchItemFields(handle, itemId, patch)` (user-field allowlist; disallowed keys silently ignored).
- [Source: item-actions.ts#63] — `deleteItemWithAssets(handle, itemId, screenshotsDir)` (row cascade + asset-file unlink; returns `{deleted, filesRemoved}`).
- [Source: db/queue.ts#34] — `enqueueWrite`: the existing single-writer queue reused via the skill ctx.
- [Source: schema.ts#17] — `boards` table (`GET /api/v1/boards` source: id/name/view).
- [Source: schema.ts#26-54] — `items` table + `idx_item_created_at` (the newest-first list query).
- [Source: registry.ts#52-62] — the fixed v1 skill list (justifies CRUD-as-REST, not a skill).
- [Source: docs/bmad/stories/8-3-per-item-actions.md] — the helpers reused here (patch allowlist + delete-with-file-cleanup).
- [Source: docs/bmad/stories/12-1-api-bearer-token-auth.md] — the v1 plugin + bearer guard these routes mount behind.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

### Change Log
