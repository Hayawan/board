# Story 1.5: Server collection API (collection-scoped endpoints + `/api/collections`)

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Epic 1 — Multiple Collections.** Named *collections*, each a **type** with its own capture/schema/view, persisted in its own JSON file. No migration.
>
> **This is story 5 of 7.** Build order: (1) storage foundation → (2) processor registry / dispatch → (3) Library capture pipeline → (4) end-to-end CLI proof → **(5) server collection API ◄ this story** → (6) sidebar collection switcher → (7) Library list view. The switcher (1.6) and list view (1.7) need the server to be collection-aware: today every endpoint is hard-wired to the Inspiration file and there is no way to list collections or read Library items over HTTP. This story adds `/api/collections` and collection-scoped item endpoints **while keeping the existing `/api/bookmarks*` routes working** so the current UI is not broken mid-epic.

## Story

As the Board frontend (and any client),
I want HTTP endpoints to list collections and to read/add/update/delete items within a named collection,
so that the UI can switch collections and operate on Library items without the server assuming everything is an Inspiration bookmark.

## Acceptance Criteria

1. **`GET /api/collections` lists the manifest.**
   - Returns `listCollections()` from `storage.ts` — each `{ id, name, type, view, dataFile }` (story 1.1). Used by the switcher (1.6) to know which collections exist and each one's default `view`.

2. **Collection-scoped item endpoints exist under `/api/collections/:cid`.**
   - `GET    /api/collections/:cid/items` → `loadCollection(cid)`.
   - `POST   /api/collections/:cid/items` → add: spawns `add.ts <url> --collection <cid>` (passing `BOARD_RESULT_FILE`, optional `analysisAgent`); returns the created item (read from the result file), mirroring `POST /api/add` (`server.ts:55-101`).
   - `PATCH  /api/collections/:cid/items/:id` → `mutateCollection` shallow-merge of an **allowlisted** field set (see AC 4).
   - `DELETE /api/collections/:cid/items/:id` → `mutateCollection` splice; 204 on success; cleans up a `screenshot` file only if the removed item has one.
   - `POST   /api/collections/:cid/items/:id/refetch` → spawns `add.ts <url> --collection <cid>` with `BOARD_UPDATE_ID=:id` (+ optional `instructions`, `analysisAgent`), mirroring `POST /api/refetch/:id` (`server.ts:133-184`).
   - Unknown `:cid` → `400`/`404` with a clear error (lean on `getCollection` throwing).

3. **Existing routes keep working unchanged (no UI breakage).**
   - `GET /api/bookmarks`, `GET /api/taxonomy`, `POST /api/add`, `PATCH/DELETE /api/bookmarks/:id`, `POST /api/refetch/:id`, `POST /api/bookmarks/:id/screenshot` all behave exactly as today, now as **thin aliases** over the `inspiration` collection. `index.html` continues to function until story 1.6 migrates it.

4. **PATCH is generic but allowlisted (no per-type branching that couples server to processors).**
   - The PATCH handler applies only present, allowlisted keys: `reflection` (object merge), `favorite` (bool), `favorite_reason` (string) — Inspiration; `notes` (string) — Library. Absent keys are ignored. This serves both types without the server importing processor/capture code.

5. **Screenshot endpoint is scoped to visual collections.**
   - `POST /api/collections/:cid/items/:id/screenshot` works for `inspiration`; for non-visual collections (e.g. `library`, `view: "list"`) it returns `400 { error: "screenshots not supported for this collection" }`. (Decide visual-ness from the collection's `view`/type, not a hardcoded id list where avoidable — see Dev Notes.)

6. **The server is testable without a live port, and `npm test` passes.**
   - `server.ts` exports a `buildServer()` factory returning the configured Fastify instance; the `listen()` call is moved behind an entrypoint guard (like `add.ts:563`). Tests use `app.inject()` (no real socket).
   - New `server.test.ts` covers: `GET /api/collections` shape; `GET /api/collections/inspiration/items` equals `GET /api/bookmarks` (alias parity); `GET/PATCH/DELETE` round trip on a **temp-seeded** `library` item (snapshot/restore `library.json`); unknown `:cid` → error; screenshot on `library` → 400.

## Tasks / Subtasks

- [x] **Task 1 — Extract `buildServer()` + entrypoint guard** (AC: 6)
  - [x] Full server in `export async function buildServer()` returning the Fastify app; `app.listen()` behind entrypoint guard. Runs unchanged via `npm run dev`.
- [x] **Task 2 — Write failing tests first (TDD)** (AC: 1, 2, 3, 4, 6)
  - [x] `server.test.ts` with `buildServer()` + `app.inject()`.
  - [x] `GET /api/collections` returns two entries.
  - [x] Alias parity: `GET /api/collections/inspiration/items` deep-equals `GET /api/bookmarks`.
  - [x] Library GET/PATCH/DELETE round trip (snapshot/restore library.json).
  - [x] Unknown cid → 4xx; library screenshot → 400.
  - [x] PATCH `/api/bookmarks/:id` alias preserves non-patched fields.
  - [x] POST validation (missing url, invalid agent, unknown cid) → 400.
- [x] **Task 3 — Add `/api/collections` + scoped GET/PATCH/DELETE** (AC: 1, 2, 4)
  - [x] Shared handler helpers (`handleGetItems`, `handlePatchItem`, `handleDeleteItem`). PATCH: reflection=object-merge, notes/favorite/favorite_reason=direct set.
- [x] **Task 4 — Add scoped add/refetch (spawn) + screenshot guard** (AC: 2, 5)
  - [x] `spawnAddItem` helper passes `--collection <cid>` to add.ts. Screenshot guard: `view !== "grid"` → 400.
- [x] **Task 5 — Re-implement legacy routes as aliases** (AC: 3)
  - [x] All `POST /api/add`, `PATCH/DELETE /api/bookmarks/:id`, `POST /api/refetch/:id`, `POST /api/bookmarks/:id/screenshot` delegate to shared handlers with cid="inspiration".
- [ ] **Task 6 — Verify green + live smoke** (AC: 3, 6)
  - [x] `npm test` green (64 tests, 0 failures).
  - [ ] Live smoke: start `npm run dev`, confirm existing UI + new `/api/collections` endpoint (requires running server — not executed in this environment).

## Dev Notes

### What this story changes vs. preserves

- **`server.ts` (UPDATE)** — currently: top-level `Fastify` + `register` + routes + `await app.listen` (`server.ts:36-239`); every data op uses `readBookmarks`/`mutateBookmarks` inspiration delegates (`49, 107, 143, 197, 220`).
  - **Preserve exactly:** request/response shapes of all existing routes (the live `index.html` depends on them — see its fetches: `/api/bookmarks` `index.html:1220`, `/api/taxonomy` `1221`, `/api/add` `1623`, `PATCH /api/bookmarks/:id` `1430, 1568`, `/api/refetch/:id` `1753`, `/api/bookmarks/:id/screenshot` `1703`, `DELETE /api/bookmarks/:id` `1797`). The static-file serving (`38-47`, screenshots + `index.html`) is unchanged.
  - **Preserve:** the spawn contract to `add.ts` (env vars `BOARD_RESULT_FILE`, `BOARD_UPDATE_ID`, `BOARD_INSTRUCTIONS`, `BOARD_ANALYSIS_AGENT`) — now plus `--collection <cid>` (the flag added in story 1.2; `add.ts` defaults to inspiration when absent, so aliases can omit it or pass it explicitly).
  - **Change:** introduce `buildServer()`, `/api/collections`, scoped `/api/collections/:cid/...`; make legacy routes aliases.
- **`storage.ts` (USE, do not change)** — `listCollections`, `getCollection`, `loadCollection`, `mutateCollection` already exist (story 1.1).
- **`add.ts` (USE, do not change)** — accepts `--collection` (story 1.2); the Library processor is registered (1.3). The server only spawns it.

### Concrete shapes

Route map after this story (legacy = alias over `inspiration`):

```
GET    /api/collections                                  -> listCollections()
GET    /api/collections/:cid/items                       -> loadCollection(cid)
POST   /api/collections/:cid/items                       -> spawn add --collection cid
PATCH  /api/collections/:cid/items/:id                   -> mutateCollection (allowlist merge)
DELETE /api/collections/:cid/items/:id                   -> mutateCollection (splice) -> 204
POST   /api/collections/:cid/items/:id/refetch           -> spawn add --collection cid (BOARD_UPDATE_ID)
POST   /api/collections/:cid/items/:id/screenshot        -> visual collections only, else 400
GET    /api/bookmarks            (= /api/collections/inspiration/items)
POST   /api/add                  (= POST /api/collections/inspiration/items)
PATCH  /api/bookmarks/:id        (= PATCH /api/collections/inspiration/items/:id)
DELETE /api/bookmarks/:id        (= DELETE /api/collections/inspiration/items/:id)
POST   /api/refetch/:id          (= .../inspiration/items/:id/refetch)
POST   /api/bookmarks/:id/screenshot (= .../inspiration/items/:id/screenshot)
GET    /api/taxonomy             (unchanged; inspiration vocabulary)
```

### Why this design (anti-pattern prevention)

- **Keep legacy routes as aliases, don't delete.** Removing `/api/bookmarks` here would break the still-Inspiration-only `index.html` before 1.6 migrates it. Aliases make 1.5 shippable and independently verifiable.
- **Allowlisted generic PATCH, not processor import.** Importing the processor registry into the server to know "what fields are patchable" couples HTTP to capture/analysis (and risks pulling capture deps into the web process). A small per-collection allowlist is sufficient and decoupled.
- **`buildServer()` factory.** Top-level `await app.listen` makes the server impossible to `inject`-test. Extracting a factory + entrypoint guard mirrors `add.ts` and unlocks fast, port-free tests — the project has no server tests today; this establishes the pattern.
- **Visual-ness from `view`, not an id whitelist.** Screenshot support keys off the collection's `view`/type so a future visual collection works without editing the guard.

### Project Structure Notes

- New root file: `server.test.ts`; add to `scripts.test`.
- No new runtime files; all changes are within `server.ts`. Flat layout, ESM `.js` specifiers.
- `app.inject()` is built into Fastify — no new test dependency.

### Testing standards

- Harness: `node --import tsx --test`. Use `buildServer()` + `app.inject()`; never bind a port in tests.
- Write-path tests use the real `library` collection with snapshot/restore of `library.json` (story 1.1 rule) — never mutate `bookmarks.json`; assert it is untouched.
- The spawn-backed add/refetch routes are validated at the request/validation layer in tests (don't spawn a real agent in CI); full add is proven manually (Task 6) and by story 1.4.

### References

- [Source: server.ts#36-239] — full current server to refactor into `buildServer()` + scoped routes.
- [Source: server.ts#55-101, 133-184] — add/refetch spawn handlers to factor + parameterize with `--collection`.
- [Source: server.ts#103-131, 186-236] — PATCH/screenshot/DELETE logic to generalize by `cid`.
- [Source: index.html#1218-1228, 1430, 1568, 1703, 1753, 1797] — the exact client calls that must keep working (aliases).
- [Source: storage.ts] — `listCollections`/`getCollection`/`loadCollection`/`mutateCollection` (story 1.1).
- [Source: add.ts] — `--collection` flag (story 1.2) the spawn helper passes.

## Dev Agent Record

### Agent Model Used
claude-sonnet-4-6

### Debug Log References
Task 6 live smoke not executed (requires running server + browser).
POST /api/add and POST /api/refetch/:id happy-path tests skipped per story spec — spawn-backed routes are non-deterministic; tested at validation layer only (missing url, invalid agent, unknown cid → correct 4xx).

### Completion Notes List
- `buildServer()` factory exports the configured Fastify app. Entrypoint guard uses `process.argv[1] === fileURLToPath(import.meta.url)` (mirrors add.ts).
- All handler logic extracted to shared helpers (`handleGetItems`, `handleAddItem`, `handlePatchItem`, `handleDeleteItem`, `handleRefetchItem`, `handleScreenshot`). Legacy routes delegate to same helpers with cid="inspiration" — zero duplicated logic.
- `spawnAddItem` helper passes `--collection <cid>` to every add.ts spawn. Legacy POST /api/add now explicitly passes cid=inspiration (behavior identical since inspiration is the default anyway).
- PATCH is allowlisted and per-key aware: `reflection`→object-merge, `favorite`/`favorite_reason`/`notes`→direct set. No processor import in server.
- Screenshot guard: `col.view !== "grid"` → 400. Visual-ness from collection metadata, not a hardcoded id list.
- `getCollection` exceptions caught in `resolveCollection` → 400, not 500.
- `readBookmarks`/`mutateBookmarks` imports removed; all data access via `loadCollection`/`mutateCollection`.
- 64 tests, 0 failures.

### File List
- server.ts (updated — full refactor: buildServer, collection-scoped routes, legacy aliases)
- server.test.ts (new)
- package.json (updated — server.test.ts in test script)
- stories/1-5-server-collection-api.md (this file)
