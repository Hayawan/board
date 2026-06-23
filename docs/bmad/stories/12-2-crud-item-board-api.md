# Story 12.2: CRUD item + board API (versioned, reuses the async queue)

Status: review

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

- [x] **Task 1 — Write the failing CRUD lifecycle tests first (TDD)** (AC: 1, 2, 3, 6)
  - [x] In `api/v1.test.ts`: build `buildServer({ apiToken: "test-token", db: <temp seeded db>, screenshotsDir: <temp dir> })`. All requests carry `Authorization: Bearer test-token` (auth is 12.1's concern, not re-tested here).
  - [x] `POST /api/v1/items {url, boardId: "library"}` → asserts `201` + `pending` item with id.
  - [x] Seeded items with known `created_at`; `GET /api/v1/items?limit=&offset=&board=&status=&since=` → asserts newest-first + each filter narrows.
  - [x] `PATCH /api/v1/items/:id {notes, favorite, status: "done"}` → notes/favorite applied, `status` (disallowed) unchanged.
  - [x] Seeded an item WITH an asset file on disk in the temp `screenshotsDir`; `DELETE /api/v1/items/:id` → `204` AND the asset file is gone (no orphan).
  - [x] Ran; confirmed red (9 failing 12.2 tests).
- [x] **Task 2 — Implement `POST /api/v1/items` (create-from-URL, optimistic)** (AC: 1)
  - [x] Added the route in `api/v1.ts` (the 12.1 plugin, behind the guard). Validates `url` (trim; `400` before the DB). Builds ctx lazily (`buildCtx`), calls `addItemSkill.run({ boardId, source: url }, ctx)`, returns `getItemForUi` with `201`. Unknown board → `400`. Does NOT default `boardId` (13.1 owns the Inbox default). **Note:** the unknown-board `400` comes from `addItemSkill`'s explicit board-existence check (`add-item.ts:29-32`) thrown *before* any insert — not from an FK violation as the AC text speculated; the outcome (client 400) is the same and the cause is cleaner.
- [x] **Task 3 — Implement `GET /api/v1/items` (filter + recency + pagination)** (AC: 2)
  - [x] New `listItemsForApi` (`db/hydrate.ts`): optional `eq(boardId)`, `eq(status)`, `gte(createdAt, since)`; `orderBy(desc(createdAt))` (idx_item_created_at); bounded `limit` (default 50, max 200) + `offset`. Assets loaded only for the returned page (`inArray`), avoiding the whole-table N+1. NaN-safe (junk params fall back, never a degenerate query).
- [x] **Task 4 — Implement `PATCH` + `DELETE /api/v1/items/:id` (reuse 8.3)** (AC: 3)
  - [x] `PATCH`: `patchItemFields` → `404` if undefined, else returns the hydrated row (`getItemForUi`). `DELETE`: `deleteItemWithAssets(handle, id, screenshotsDir)` → `404` if `!deleted`, else `204`. The EXACT helpers the `/api/collections/.../items/:id` routes use (`server.ts:524,534`) — no new delete/cleanup logic.
- [x] **Task 5 — Implement `GET /api/v1/boards` (targeting list)** (AC: 4)
  - [x] Drizzle `select({ id, name, view })` from `boards`. Lean — no descriptor; test asserts the shape excludes `descriptor`.
- [x] **Task 6 — No-regression test (shared store)** (AC: 5)
  - [x] Create via the legacy `/api/collections/library/items` route (no auth header), then `GET`/`PATCH` via `/api/v1` and assert it's visible + mutable — proves one store + one set of helpers, no parallel write path.
- [x] **Task 7 — Wire tests + verify green** (AC: 6)
  - [x] `api/v1.test.ts` already in the `test` script (12.1). `npm test` → **366 pass / 0 fail**, existing suites unaffected.

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

claude-opus-4-8[1m] (BMAD dev-story workflow)

### Debug Log References

- RED: 9 failing 12.2 tests (no v1 CRUD routes). GREEN: 22 → after review hardening 25 v1 tests pass.
- Full regression: `npm test` → **366 pass / 0 fail**, 55 suites.
- Fixed a self-inflicted test issue: a bodyless `DELETE` carrying `content-type: application/json` triggered Fastify's empty-JSON-body 400. Resolved properly by adding a tolerant JSON parser scoped to the v1 plugin (empty body → undefined), so real fetch-based clients that set the header reflexively work.

### Completion Notes List

- ✅ All 6 ACs satisfied on the live SQLite store via hermetic `inject()` tests; every request carries a valid bearer token (auth coverage stays in 12.1).
- **Reuse, not reinvention (NFR-BC).** PATCH/DELETE call `patchItemFields`/`deleteItemWithAssets` verbatim — the same helpers as the collections routes, so the orphaned-asset-file bug 8.3 fixed cannot reappear (proven: the DELETE test creates a real file and asserts it's unlinked). Create reuses `addItemSkill.run` + `buildCtx` + `getItemForUi`. No schema change, no parallel write path. The NFR-BC test creates via the legacy collections route and reads/mutates via v1 to prove one shared store.
- **Only `listItemsForApi` is new** (`db/hydrate.ts`): cross-board, newest-first (idx_item_created_at), bounded limit (default 50 / max 200), offset, `since`. Distinct from the board-scoped `listBoardItemsForUi`.
- **Optimistic create.** `POST` returns `201` + the `pending` item immediately; capture/enrich runs fire-and-forget (no blocking on Chrome/LLM), mirroring the collections-POST contract.
- **No Inbox default** (`boardId` required → `400` if absent/unknown); 13.1 adds the default once the Inbox is seeded. Honors "no story depends on a later story."

**Party-mode review (Winston/Amelia/Quinn) — findings addressed before commit:**
- ✅ [Med] **NaN coercion bug** (Winston+Amelia): `?limit=abc` → `Number("abc")=NaN` → degenerate `LIMIT NaN` → unhandled 500; `?since=abc` → silently-empty result. Fixed with a `Number.isFinite` guard at both the HTTP boundary (`num()`) and in `listItemsForApi` (defensive for any caller). Added a junk-param + offset-beyond-end test (200, fallback, no 500).
- ✅ [Med] **POST reuse not pinned** (Quinn): replaced a status-only assertion with a shared-store persistence check + tightened the unknown-board test to assert the `/board/i` error — together pinning that `addItemSkill`'s board-existence path runs (a parallel hand-rolled insert wouldn't 400 on an unknown board).
- ✅ [Info→fixed] **DELETE empty-body content-type footgun** (Amelia): added a tolerant JSON parser scoped to v1 + a test (DELETE with json content-type + empty body → 204).
- ⏸️ [Low, accepted] **Broad `catch → 400` on create** (Amelia/Winston): a genuine infra failure is also mapped to 400. Left consistent with the existing collections-POST route (`server.ts:513-516`), which has the same broad catch — narrowing only here would diverge from the established convention. Noted for a future wave-wide error-mapping pass.

### File List

- `api/v1.ts` (modified) — added `POST/GET/PATCH/DELETE /items` + `GET /boards` inside the encapsulated v1 plugin; extended `V1Options` with CRUD deps (`resolveDb`, `queue`, `logger`, `llm`, `screenshotsDir`); added a tolerant v1-scoped JSON parser.
- `db/hydrate.ts` (modified) — new `listItemsForApi` + `ListItemsQuery` (filtered/paginated/recency list; NaN-safe; page-scoped asset load via `inArray`).
- `server.ts` (modified) — pass the CRUD deps (lazy `resolveDb`, shared queue/logger/llm/screenshotsDir) into `registerV1Api`.
- `api/v1.test.ts` (modified) — +13 tests (create/blank-url/unknown-board/persistence, list+filters, junk-param fallback, patch+allowlist+404, delete+orphan+404+empty-body-content-type, board list, NFR-BC shared store).

### Change Log

- 2026-06-23 — Story 12.2 implemented: token-authed CRUD (`POST/GET/PATCH/DELETE /api/v1/items`, `GET /api/v1/boards`) inside the 12.1 plugin, reusing add-item/patchItemFields/deleteItemWithAssets and the shared store (no parallel write path); only the filtered/paginated `listItemsForApi` is new. 366 pass / 0 fail. Status → review.
- 2026-06-23 — Addressed party-mode review: NaN-param guard (no 500 / no silent-empty), pinned POST shared-store reuse + unknown-board cause, tolerant empty-body DELETE parser. 25 v1 tests, 366 total pass.
