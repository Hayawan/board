# Story 13.1: Inbox board + cheap-enrichment capture path

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Epic 13 — Capture funnel.** Story 1 of 4. Build order: **(1) Inbox + cheap capture ◄ this story** → (2) bookmarklet → (3) PWA share-target → (4) extension review lane (fast-follow). This story is the **linchpin of the whole wave**: it seeds a typeless **Inbox** board (idempotently, like `db/seed.ts`) and makes Inbox capture run *cheap* enrichment only — the expensive AI takeaway is **earned** on assignment (Epic 14), not spent on bucket churn. *(D2, D6; NFR-BC.)*

## Story

As a user,
I want a default Inbox board and a capture that fills just enough to be scannable,
so that I can save anything instantly without deciding where it goes or waiting on AI.

## Acceptance Criteria

1. **Inbox seeded idempotently.**
   **Given** any DB (fresh, or an existing pre-wave `board.db`), **When** the app boots (`seed(getDb().db)`, `server.ts:649`), **Then** a typeless **Inbox** board exists exactly once (stable id `inbox`); a re-boot does **not** duplicate it; and **existing Inspiration/Library boards, descriptors, items, fields, notes, favorites, and screenshot assets are untouched** (byte-for-byte). *(NFR-BC)*

2. **Capture defaults to Inbox.**
   **Given** a create-item call with **no** target board (omitted `boardId`), **When** the item is created, **Then** `item.board_id` = `inbox` (the create route, Story 12.2, resolves the omitted target to the Inbox now that it exists — honoring "no story depends on a later story": 12.2 ships first; 13.1 adds the default once the Inbox exists).

3. **Cheap enrichment only on Inbox capture.**
   **Given** an Inbox capture, **When** the capture→enrich job runs, **Then** only *cheap* metadata is produced (title, screenshot/favicon, fetched text — the existing capture adapters, Epic 6), and the **expensive AI takeaway does NOT fire**: the LLM provider's `complete` is **not called** on the Inbox path (it is earned on assignment, Epic 14).

4. **Sub-second, non-blocking capture.**
   **Given** a capture request, **When** received, **Then** it returns **immediately** with a `pending` item (the create route returns the optimistic item; the capture/enrich work runs async on the single worker queue, `db/queue.ts`); the response does not block on Chrome launch or any fetch, and degrades gracefully when no LLM is configured (Epic 4 → `done`, never an error wall).

5. **No-regression boot test proves it.**
   **Given** an existing pre-wave `board.db` snapshot (Inspiration + Library + items, **no** `inbox` row), **When** the test opens it, runs `seed`, then runs `seed` again, **Then** it asserts: Inbox appears exactly once, the seed is idempotent on re-run, and the existing boards/items/assets are served unchanged. **And** an Inbox-capture test asserts a **spy LLM** whose `complete` is called **0 times** (AC 3) while a non-Inbox (e.g. Inspiration) capture still calls it once (the earned path is unchanged). *(NFR-BC)*

## Tasks / Subtasks

- [x] **Task 1 — Write the failing seed/idempotency + no-regression test first (TDD)** (AC: 1, 5)
  - [x] New `db/inbox-seed.test.ts`: `preWaveDb()` builds a temp DB with Inspiration + Library + 2 items + 1 asset and **no** `inbox` board. `seed(db)` → exactly one `inbox` row; `seed(db)` again → still one (idempotent). Existing Inspiration item asserted byte-for-byte (`deepEqual`), board descriptor unchanged, asset preserved, item count stable.
  - [x] **Route-level "serves unchanged" proof:** `buildServer({ db })` + `inject()` `GET /api/collections` (asserts Inspiration/Library present + Inbox now appears) and `GET /api/collections/library/items` (existing item served unchanged).
  - [x] Ran; confirmed red (Inbox not seeded).
- [x] **Task 2 — Add the Inbox to the seed (mirror `db/seed.ts`'s existence-check idempotency)** (AC: 1)
  - [x] Added `INBOX_BOARD_ID = 'inbox'` + `INBOX_DESCRIPTOR` (typeless: `view:'list'`, `ingest_mode:'url-screenshot'`, `fields:[]`, a never-used-but-required `enrichment_prompt`) + a third `SEED_BOARDS` entry. The existing `seed()` loop (existence check by stable id) makes it idempotent — **not rewritten**.
  - [x] **`/api/collections` type derivation:** with `view:'list'` the Inbox falls through `view==='grid' ? inspiration : library` → renders with the list renderer. No `/api/collections` change required (documented). Existing seed test updated (2 → 3 boards — intentional additive change).
- [x] **Task 3 — Write the failing cheap-only enrichment test (TDD)** (AC: 3, 5)
  - [x] In `db/inbox-seed.test.ts`: spy LLM (counts `complete`) + fake capture adapter (no Chrome). Inbox cheap → `complete` **0**; Inspiration earned → `complete` **1**; both reach `done`; Inbox `title` populated by the cheap capture. **Plus a discriminating test** (`tier:'cheap'` on Inspiration, which HAS fields → still 0 complete) so the test isolates the tier flag from the `fields:[]` early-return (review fix).
  - [x] Ran; confirmed red.
- [x] **Task 4 — Add the cheap-only seam to the capture→enrich pipeline (additive, minimal)** (AC: 3, 4)
  - [x] Added `tier?: 'cheap' | 'earned'` to `runCaptureEnrichJob` (`enrichment/pipeline.ts`), defaulting to `'earned'` (existing behavior). `tier !== 'cheap'` gates `runEnrichmentForItem`, so cheap runs capture only and never reaches `llm.complete`. The item still drives `processing → done` via `runItemJob`.
  - [x] In `add-item`, the tier is selected by a new exported pure helper `captureTierForBoard(boardId)` (`'cheap'` for Inbox, `'earned'` otherwise) — unit-tested independently (review fix; the fire-and-forget capture job made an end-to-end assertion non-deterministic). 14.1 generalizes this.
- [x] **Task 5 — Default an omitted target board to the Inbox** (AC: 2)
  - [x] On `POST /api/v1/items`, an omitted/blank `boardId` defaults to `INBOX_BOARD_ID` (`rawBoardId || INBOX_BOARD_ID`); a *provided* unknown board still errors via add-item's existence check. Test asserts an omitted-board create lands on `item.board_id = 'inbox'`. The legacy cid-scoped collections route is unchanged.
- [x] **Task 6 — Wire tests + verify green; confirm no regression** (AC: 1, 3, 5)
  - [x] Added `db/inbox-seed.test.ts` to the `test` script; full suite → **372 pass / 0 fail**. Existing Inspiration/Library capture + enrichment paths call the LLM exactly as before (earned default).

## Dev Notes

### What this story changes vs preserves (read before coding)

- **Adds (additive only):** a third seeded board (`inbox`) via a new `SEED_BOARDS` entry, a cheap-tier flag on `runCaptureEnrichJob`, an omitted-board→Inbox default on the 12.2 create route, and `inbox`'s `/api/collections` type derivation.
- **Preserves (NFR-BC):** `item.board_id` stays a `NOT NULL` single FK (`db/schema.ts:30`) — the Inbox is just another board, not a global pool. The existing `seed()` loop is reused unchanged (existence check by stable id, `db/seed.ts:114-119`) — Inspiration/Library and all their rows/assets are byte-for-byte preserved. The default capture→enrich behavior for **every existing board is unchanged** (the new flag defaults to the earned path). Already-enriched items are never re-touched.
- **Typeless rendering (decided):** the Inbox uses `view:'list'`, so `/api/collections`'s type derivation (`server.ts:466-469`, `view==='grid' ? inspiration : library`) lands it on the **library/list renderer** — acceptable for a scannable Inbox, and it means **no `/api/collections` change is strictly required**. An explicit `inbox` branch is optional (only if a distinct Inbox chrome is wanted); either way it is additive and preserves the existing Inspiration/Library type mapping.

### Why this design (anti-pattern prevention)

- **Idempotent seed by stable id (no duplicate Inbox, no destructive migration).** Re-seed must be a no-op; the Inbox arrives as a **new board row**, never by reshaping existing rows. This is exactly the `db/seed.ts` existence-check pattern — reuse it, don't invent a migration. [Source: db/seed.ts#L114, docs/bmad/epics-v2.md#L24]
- **Cheap on capture, earned on assignment (don't burn AI on bucket churn).** The expensive descriptor-driven takeaway (`runEnrichmentForItem`, `enrichment/worker.ts:88`) calls `llm.complete` (`enrichment/worker.ts:108`). On Inbox capture it must **not** be reached. Note: a zero-enrichable Inbox descriptor *already* makes `runEnrichmentForItem` early-return before `complete` (`enrichment/worker.ts:102`, `allowedKeys.size === 0`) — but the cleaner, testable seam is to **skip the enrich hop** in the pipeline so 14.1 has a tier to generalize. The behavioral contract the test asserts is robust to both: **`llm.complete` is called 0 times** on the Inbox path. [Source: enrichment/worker.ts#L102, enrichment/pipeline.ts#L34]
- **Sub-second / non-blocking by reusing the existing optimistic-return + single-worker queue.** Capture (Chrome) and enrich (LLM) already run async on the one worker (`db/queue.ts`, concurrency 1); the create route returns the pending item immediately (`server.ts:500-502`). Don't add a new blocking path. [Source: skills/add-item.ts#L43, db/queue.ts#L91]
- **Additive flag, default unchanged (no regression on existing boards).** The cheap seam must default to today's earned behavior so Inspiration/Library captures are byte-for-byte identical. [Source: enrichment/pipeline.ts#L34, docs/bmad/epics-v2.md#L31]

### Project Structure Notes

- Live store is **SQLite at `data/board.db` (WAL) via `getDb()`/Drizzle**; capture clients save through the API (Epic 12). Legacy flat-JSON is **import-source only**.
- Seed change in `db/seed.ts` (new `INBOX_BOARD_ID` + descriptor + `SEED_BOARDS` entry). Boot seeds on every start (`server.ts:649`).
- Cheap-tier flag in `enrichment/pipeline.ts` (`runCaptureEnrichJob`); call-site selection in `skills/add-item.ts`.
- `/api/collections` type derivation in `server.ts:460-472`.
- ESM `.js` specifiers; `node:test` + temp DB (no real Chrome — inject a fake capture adapter + a spy LLM). Add the new test(s) to the `test` script.

### Testing standards

- **Temp DB seeded to the pre-wave shape** (Inspiration + Library + items + assets, NO `inbox`); assert seed → one Inbox → re-seed → still one; existing rows unchanged. This is the wave's mandated boot/regression test (`docs/bmad/epics-v2.md:32`).
- **Spy LLM** asserting `complete` call count = 0 on Inbox capture and = 1 on a typed-board capture — the load-bearing assertion (don't assert "worker not invoked"; assert `complete` not called, which is robust to either implementation of the seam).
- **Fake capture adapter** (no Chrome) so the test is hermetic and fast; assert the Inbox item gets cheap fields (title) and reaches `done`.
- Keep all existing seed + pipeline + server suites green.

### References

- [Source: db/seed.ts#L19-L120] — stable-id seed boards + the idempotent `seed()` existence-check loop to mirror (`SEED_BOARDS`, `INSPIRATION_BOARD_ID`/`LIBRARY_BOARD_ID`).
- [Source: db/schema.ts#L26-L54] — `item.board_id` is a `NOT NULL` single FK (Inbox is a board, not a pool); system columns (title/notes/favorite) live on the row.
- [Source: enrichment/worker.ts#L88-L125] — `runEnrichmentForItem`; `llm.complete` at #L108; the zero-enrichable early-return at #L102.
- [Source: enrichment/pipeline.ts#L34-L62] — `runCaptureEnrichJob` (capture hop then enrich hop in ONE job) — the additive cheap-tier seam.
- [Source: skills/add-item.ts#L43-L62] — where the capture→enrich job is enqueued (fire-and-forget, optimistic return).
- [Source: server.ts#L460-L472] — `/api/collections` type derivation (typeless Inbox branch).
- [Source: server.ts#L491-L508] — the optimistic create route returning a pending item (12.2's `/api/v1/items` adds the omitted-board default here).
- [Source: server.ts#L649-L653] — boot seeds + reconciles + registers capture adapters.
- [Source: docs/bmad/epics-v2.md#L24-L32] — the wave-wide NO-REGRESSION (NFR-BC) constraint + the mandated boot/regression test.
- [Source: docs/bmad/epics-v2.md#L107-L117] — Epic 13 / Story 13.1 ACs (D2, D6).

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (BMAD dev-story workflow)

### Debug Log References

- RED → GREEN → full regression: **372 pass / 0 fail**, 59 suites.
- `db/seed.test.ts` board-count assertion updated 2 → 3 (the Inbox is an intentional additive seed board, not a regression).

### Completion Notes List

- ✅ All 5 ACs satisfied on the live SQLite store. The Inbox is purely additive: a third `SEED_BOARDS` entry via the unchanged idempotent `seed()` loop; `item.board_id` stays a NOT NULL single FK (Inbox is a board, not a global pool); the cheap-tier flag defaults to `'earned'` so every existing board's capture→enrich is byte-for-byte unchanged.
- **Cheap on capture, earned on assignment.** `runCaptureEnrichJob` gains `tier`; `'cheap'` (Inbox) skips the enrich hop so `llm.complete` is never called, while capture still populates a scannable title and the item reaches `done`. The expensive AI takeaway is deferred to assignment (Epic 14).
- **NFR-BC proven, not asserted.** The mandated boot/regression test opens a pre-wave-shaped DB (no inbox), seeds + re-seeds, and proves existing rows (byte-for-byte) AND routes (`/api/collections`, `/items`) serve unchanged with the Inbox added.

**Party-mode review (Winston/Amelia/Quinn) — Quinn flagged CHANGES-REQUESTED; both findings fixed before commit:**
- ✅ [High] **Confounded cheap-tier test** (Quinn/Amelia/Winston): because the Inbox has `fields:[]`, `runEnrichmentForItem` early-returns (`allowedKeys.size===0`) before `complete` regardless of tier — so the Inbox-only test passed even with the skip line removed. Added a **discriminating test**: `tier:'cheap'` on Inspiration (which HAS enrichable fields) → asserts 0 `complete` calls, which fails iff the pipeline's cheap-skip is removed. The flag is now genuinely guarded — exactly the seam 14.1 builds on.
- ✅ [Med] **add-item tier selection untested** (Quinn): extracted the selection to a pure exported `captureTierForBoard(boardId)` and unit-tested it (`inbox→cheap`, others→`earned`) — deterministic, avoids the fire-and-forget capture job. Flipping the branch now fails a test.
- ✅ [Nit] Added a "board descriptor unchanged across re-seed" assertion (Amelia).
- 📝 [Note for Epic 14] `refetch.ts`/`reenrichBoardItems` omit `tier` → default `'earned'`; harmless for 13.1 (Inbox has no fields) but those paths must become tier-aware when 14.1 generalizes. AC4 (sub-second/non-blocking) is inherited from 12.2/Epic-4's optimistic-return + single-worker queue, not first-party asserted here. AC3's "fetched text" wording is aspirational — `url-screenshot` yields title+screenshot; readable text is `url-readable`'s job (the test asserts title, which is what happens).

### File List

- `db/seed.ts` (modified) — `INBOX_BOARD_ID`, `INBOX_DESCRIPTOR` (typeless), third `SEED_BOARDS` entry.
- `enrichment/pipeline.ts` (modified) — additive `tier?: 'cheap' | 'earned'` on `runCaptureEnrichJob`; `'cheap'` skips the enrich hop.
- `skills/add-item.ts` (modified) — exported pure `captureTierForBoard(boardId)`; passes the tier to the capture job.
- `api/v1.ts` (modified) — `POST /items` defaults an omitted/blank `boardId` to the Inbox.
- `db/inbox-seed.test.ts` (new) — seed idempotency + byte-for-byte preservation + route-serves-unchanged; cheap-vs-earned spy LLM + discriminating cheap-on-Inspiration; `captureTierForBoard` unit test.
- `api/v1.test.ts` (modified) — omitted-boardId → Inbox test.
- `db/seed.test.ts` (modified) — board count 2 → 3 (additive Inbox).
- `package.json` (modified) — appended `db/inbox-seed.test.ts` to the `test` script.

### Change Log

- 2026-06-23 — Story 13.1 implemented: additive typeless Inbox seed board (idempotent), cheap-tier capture seam (`runCaptureEnrichJob` `tier`, default earned), `captureTierForBoard` selection (Inbox→cheap), and an omitted-board→Inbox default on `POST /api/v1/items`. NFR-BC proven by a pre-wave boot/regression test. 372 pass / 0 fail. Status → review.
- 2026-06-23 — Addressed party-mode review (Quinn CHANGES-REQUESTED): added a discriminating cheap-on-Inspiration test (isolates the tier flag from the fields:[] early-return) + a `captureTierForBoard` unit test + a board-descriptor-unchanged assertion.
