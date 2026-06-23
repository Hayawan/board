# Story 13.1: Inbox board + cheap-enrichment capture path

Status: draft

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

- [ ] **Task 1 — Write the failing seed/idempotency + no-regression test first (TDD)** (AC: 1, 5)
  - [ ] In a new `db/inbox-seed.test.ts` (`node:test`): build a temp DB seeded with Inspiration + Library + a couple of items/assets (the pre-wave shape), with **no** `inbox` board. Run `seed(db)`; assert exactly one `board` row with id `inbox`. Run `seed(db)` again; assert **still** exactly one `inbox` row (idempotent). Assert the Inspiration/Library boards + their items + assets are unchanged at the **row** level (count + a field spot-check).
  - [ ] **Route-level "serves unchanged" assertion (the mandated NFR-BC proof):** after seeding the Inbox, build the server over the temp DB (`buildServer({ db })`) and `inject()` `GET /api/collections` + a board's `GET /api/collections/:cid/items`; assert the existing Inspiration/Library boards and their items come back **served** unchanged (same ids/fields as before the Inbox was seeded), and that the Inbox now also appears. (AC 5 promises *served* unchanged — exercise the route, not just the rows.)
  - [ ] Run; confirm red (Inbox not seeded yet).
- [ ] **Task 2 — Add the Inbox to the seed (mirror `db/seed.ts`'s existence-check idempotency)** (AC: 1)
  - [ ] Add an `INBOX_BOARD_ID = 'inbox'` constant + an `INBOX_DESCRIPTOR` and a third entry in `SEED_BOARDS` (`db/seed.ts:104`). The Inbox is **typeless**: `view: 'list'` (the scannable list renderer — see the `/api/collections` note below), `ingest_mode: 'url-screenshot'` (so cheap capture yields a thumbnail + title + text for scannability — reuses an Epic-6 adapter, no new adapter), and `fields: []` (no AI-fillable fields → nothing to enrich). The existing `seed()` loop (`db/seed.ts:114`, existence check keyed by stable id) makes it idempotent with no new mechanism — do **not** rewrite `seed()`.
  - [ ] **`/api/collections` type derivation (`server.ts:466-469`):** with `view:'list'` the Inbox falls through to the existing `view==='grid' ? inspiration : library` rule → it renders with the **library (list) renderer**, which is acceptable for a scannable Inbox, so **no `/api/collections` change is strictly required**. If a distinct Inbox identity/chrome is wanted, add a one-line explicit `b.id === INBOX_BOARD_ID ? 'inbox'` branch (additive); otherwise document that it reuses the list renderer.
  - [ ] Confirm Task 1's seed/idempotency test goes green; existing seed tests stay green.
- [ ] **Task 3 — Write the failing cheap-only enrichment test (TDD)** (AC: 3, 5)
  - [ ] In `enrichment/pipeline.test.ts` (or `db/inbox-seed.test.ts`): seed Inbox + Inspiration in a temp DB; create a pending Inbox item + a pending Inspiration item; run the capture→enrich job for each with a **spy LLM** (records `complete` call count) and a **fake capture adapter** (returns title/text/asset, no real Chrome). Assert: Inbox item → `complete` called **0** times; Inspiration item → `complete` called **1** time. Assert both items reach a terminal status (`done`) and the Inbox item has cheap fields (title) populated.
  - [ ] Run; confirm red (the pipeline always enriches today).
- [ ] **Task 4 — Add the cheap-only seam to the capture→enrich pipeline (additive, minimal)** (AC: 3, 4)
  - [ ] Add an **additive** option to `runCaptureEnrichJob` (`enrichment/pipeline.ts:34`) that skips the enrichment hop (a `tier: 'cheap' | 'earned'` or `skipEnrich` flag, defaulting to today's behavior so **existing boards are unchanged**). When skipping, the job runs capture only (`runCaptureForItem`) and does **not** call `runEnrichmentForItem` (so `llm.complete` is never reached). The item still drives its `processing → done` lifecycle via `runItemJob` (`db/queue.ts:263`).
  - [ ] In `add-item` (`skills/add-item.ts:52`), pass the cheap tier when `boardId === INBOX_BOARD_ID`; all other boards keep the earned (default) path. (Do **not** build 14.1's general tier-selection machinery here — 14.1 generalizes this; epic 14.1 AC2 says "Confirmed by 13.1's test.")
- [ ] **Task 5 — Default an omitted target board to the Inbox** (AC: 2)
  - [ ] On the Story 12.2 create route (`POST /api/v1/items`), when `boardId` is omitted, default it to `INBOX_BOARD_ID`. (The legacy collection route `POST /api/collections/:cid/items`, `server.ts:491`, is cid-scoped and unchanged.) Add a test asserting an omitted-board create lands on `item.board_id = 'inbox'`.
- [ ] **Task 6 — Wire tests + verify green; confirm no regression** (AC: 1, 3, 5)
  - [ ] Add the new test file(s) to the `test` script; run the full suite; confirm green and that **all existing suites are unaffected** (Inspiration/Library capture + enrichment paths still call the LLM exactly as before).

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

### Debug Log References

### Completion Notes List

### File List

### Change Log
