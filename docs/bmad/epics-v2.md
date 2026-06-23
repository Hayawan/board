---
stepsCompleted: [1, 2, 3]
inputDocuments:
  - docs/workshop-linkding-features.md
  - docs/competitive-linkding.md
  - docs/bmad/epics.md
  - docs/bmad/architecture.md
  - docs/prd.md
  - db/schema.ts
title: board-oss — Epic Breakdown (v2: Capture → Curate → Archive)
created: 2026-06-23
---

# board-oss — Epic Breakdown (v2)

## Overview

This is the **second wave** of board-oss work, decomposing the decisions reached in the linkding competitive workshop (`docs/workshop-linkding-features.md`) into implementable, single-dev-sized stories with testable (Given/When/Then) acceptance criteria. It **extends** the v1 backlog (`docs/bmad/epics.md`, Epics 1–11) — epics here are numbered **12–17** and story files continue the `NN-M-slug.md` convention in `docs/bmad/stories/` so there are **no ID collisions** with v1.

The wave delivers the workshop thesis as a pipeline:

> **Capture the firehose → cheap-enrich into an Inbox → the AI proposes a home → one-tap confirm promotes the link into a typed board (firing the real takeaway). That same "assign" verb, run in bulk by the AI, _is_ the composer. Composed boards are views, not copies — so the enriched meaning never forks.**

### 🔒 Wave-wide hard constraint — NO REGRESSION (NFR-BC)

**Every story in this wave is additive and must not break or regress existing saved boards or entries.** Concretely, this is a first-class acceptance criterion on every story:

- **No destructive migration.** `item.board_id` stays a `NOT NULL` single FK (`db/schema.ts:30`). No story rips items out of their boards or rewrites existing rows. New capability arrives via **new tables/columns/asset-kinds/routes**, never by reshaping what exists.
- **Existing seed + data untouched.** The Inbox board is seeded **idempotently** (same pattern as `db/seed.ts`); existing Inspiration/Library boards, their descriptors, items, fields, notes, favorites, and screenshot assets are byte-for-byte preserved.
- **Existing UI keeps working.** The current SPA + reverse-proxy model continues to function; the new token-authed API is a **separate surface**, not a replacement of existing routes.
- **Existing enrichment unaffected.** The cheap/earned enrichment split (Epic 14) applies to the *new* Inbox capture path; already-enriched items are not re-touched or downgraded.
- **A boot/regression test proves it.** Each schema-touching story includes a test asserting an existing pre-wave DB opens, seeds idempotently, and serves existing boards/items unchanged.

## Decisions Inventory (source: workshop)

| ID | Decision | Epic.Story |
|---|---|---|
| D1 | Keystone: full CRUD API + a single **static bearer token** (CRUD + auth ship as one unit) | 12.1, 12.2 |
| D2 | Capture is **one tap, sub-second, zero decisions**; lands in Inbox | 13.1 |
| D3 | **Bookmarklet** save client | 13.2 |
| D4 | **PWA + Web Share Target** (mobile is where the firehose lives) | 13.3 |
| D5 | **Browser extension** = the "recent additions" ambient review lane (later, fast-follow) | 13.4 |
| D6 | **Inbox board** = typeless default destination; **cheap** enrichment on capture | 13.1, 14.1 |
| D7 | **Enrichment is earned** — expensive AI takeaway fires on assignment to a typed board | 14.1, 14.2 |
| D8 | **One verb / one endpoint**: move/assign (manual *and* composer share it) | 14.2, 15.2 |
| D9 | **Scannable Inbox** + AI **suggested-board chip** (one-tap confirm; override = signal) | 14.3 |
| D10 | Composer output = saved **VIEW (lens)**, not copies; enrichment stays canonical | 15.1, 15.2 |
| D11 | **Copy-on-write** "materialize view to board" escape hatch | 15.3 |
| D12 | **Reject** the many-to-many / global-pool refactor; keep single-FK home board | (constraint — all) |
| D13 | **Archival preserves meaning** (snapshot + takeaway), opt-in, curated-tier, footprint caps | 16.1, 16.2, 16.3 |
| D14 | **Export** (JSON + Netscape HTML) — the trust handshake | 17.1 |

### The home-board / composed-view reconciliation (resolves workshop hinges #1 & #3)

The workshop left a hinge between "composer = move/assign" (John) and "composer = a view" (Winston). They serve **two different jobs** and coexist cleanly on the current schema:

- **Home board** — every item has exactly **one** home board (`item.board_id`, single FK). Promotion from Inbox → a typed board is a **move** (one FK update) + the earned takeaway. This is the **one verb** (D8). One item, one home.
- **Composed / smart board** — a read-only **view (lens)** defined by a saved query + optional ordering/captions (D10). It does **not** move items; items keep their home board and may appear in any number of views. Additive (`view` table), zero item migration.
- The **composer** can therefore propose *either*: home-board **assignments** for Inbox items (uses 14.2), *or* a cross-cutting **view** over items that already have homes (15.1). Same AI, two outputs, no m2m, no global pool. **(Open for Hayawan's confirmation — see workshop hinge #1: the view-def stores `filter` + optional ordered item-ids + caption map as a field, not a join table.)**

## Epic List (v2)

12. **Public API & auth keystone** — token-authed CRUD over items/boards; the prerequisite for every capture client. *(D1)*
13. **Capture funnel** — Inbox board, bookmarklet, PWA share-target, extension review lane. *(D2–D6)*
14. **Inbox triage & the one-verb assignment** — earned enrichment, the move/assign endpoint, scannable Inbox + AI suggestion chip. *(D6–D9)*
15. **AI board composer (views, not copies)** — view-definition model, composer proposals, copy-on-write materialize. *(D10, D11)*
16. **Meaning-preserving archival** — opt-in HTML snapshot asset kind + preserved takeaway + footprint guardrails. *(D13)*
17. **Data portability** — in-app export (JSON + Netscape HTML). *(D14)*

---

## Epic 12: Public API & auth keystone

**Goal:** Expose a token-authed CRUD API over items (and the boards needed to target them) so external clients — bookmarklet, PWA, extension — can save and read. CRUD and a single static bearer token ship **as one unit** (an unauthenticated write API on a self-hosted box is the one hard line). This pulls a *minimal* amount of auth forward from the v2 reverse-proxy model (C5) without introducing multi-user. **Backward-compat:** the new API lives under a versioned prefix and a `preHandler` guard; existing SPA routes and the reverse-proxy model are untouched. *(D1, NFR-3, NFR-BC.)*

### Story 12.1: Static bearer-token auth for the API surface
As a self-hoster,
I want the new API to require a static bearer token,
so that exposing a write endpoint to a browser client doesn't open my box to anonymous writes.

**Acceptance Criteria:**
1. **Token configured via env, stored hashed.** **Given** a `BOARD_API_TOKEN` (or generated-on-first-boot token written to `DATA_DIR`), **When** the app boots, **Then** only a **hash** of the token is held/compared (never logged, never stored in plaintext).
2. **Guarded routes reject missing/bad tokens.** **Given** an API request without a valid `Authorization: Bearer <token>`, **When** it hits any `/api/v1/*` route, **Then** it returns `401` and performs no write.
3. **Existing routes unaffected.** **Given** the existing SPA routes and legacy `/api/*` endpoints, **When** the guard is added, **Then** they continue to serve exactly as before (the guard scopes to `/api/v1/*` only). *(NFR-BC)*
4. **CORS scoped for the extension/PWA origin.** **Given** a cross-origin client, **When** it calls `/api/v1/*`, **Then** CORS allows the configured origin(s) only (`@fastify/cors`, dependency-scored before install).
5. **Tests cover allow/deny + no-plaintext.** Inject a valid-token request (allowed), a missing/garbage-token request (401), and assert the token never appears in logs or the DB in plaintext.

### Story 12.2: CRUD item + board API (versioned, reuses the async queue)
As a 3rd-party client (bookmarklet/PWA/extension),
I want full CRUD over items plus the board list,
so that I can save a URL, list recent additions, edit, and delete via a stable contract.

**Acceptance Criteria:**
1. **Create-from-URL returns optimistic pending.** **Given** `POST /api/v1/items {url, boardId}` naming an existing target board, **When** handled, **Then** it creates a `pending` item on that board, enqueues capture/enrich on the existing single-writer queue, and returns the item immediately (no blocking on capture). *(12.2 does NOT depend on the Inbox — the `boardId`-omitted default to Inbox is added in 13.1 once the Inbox exists, honoring "no story depends on a later story.")* *(reuses Epic 5 queue)*
2. **List with filters + recency + pagination.** **Given** `GET /api/v1/items?board=&status=&limit=&offset=&since=`, **When** handled, **Then** it returns items ordered newest-first (powers the popover/PWA "recent additions").
3. **Patch + delete reuse v1 semantics.** **Given** `PATCH /api/v1/items/:id` and `DELETE /api/v1/items/:id`, **When** handled, **Then** they reuse the Story 8.3 `patchItemFields` (user-field allowlist) and `deleteItemWithAssets` (row cascade + file unlink) — no new delete/cleanup logic, no orphaned files.
4. **Board list for targeting.** **Given** `GET /api/v1/boards`, **When** handled, **Then** it returns boards (id, name, view) so a client can offer assignment targets.
5. **No regression.** **Given** the existing item/board data, **When** the v1 API is exercised, **Then** existing boards/items are served and mutated identically to the legacy routes (shared underlying helpers). *(NFR-BC)*
6. **Tests** inject create→list→patch→delete and assert pending-return, recency order, allowlist, and asset-file cleanup.

---

## Epic 13: Capture funnel (the save path)

**Goal:** Give links an on-ramp from the open web — the precondition for the whole pipeline (a board with nothing in it has nothing to enrich or compose). Capture is **one tap, sub-second, zero decisions**, landing in the **Inbox** with *cheap* enrichment only. Clients: bookmarklet (cheapest desktop unblock), PWA share-target (mobile firehose), and later the extension review lane. **Backward-compat:** Inbox is an idempotently-seeded additional board; nothing existing changes. *(D2–D6, NFR-BC.)*

### Story 13.1: Inbox board + cheap-enrichment capture path
As a user,
I want a default Inbox board and a capture that fills just enough to be scannable,
so that I can save anything instantly without deciding where it goes or waiting on AI.

**Acceptance Criteria:**
1. **Inbox seeded idempotently.** **Given** any DB (fresh or existing pre-wave), **When** the app boots, **Then** a typeless **Inbox** board exists exactly once; re-boot does not duplicate it; **existing boards/items are untouched**. *(NFR-BC)*
2. **Capture defaults to Inbox.** **Given** a save with no target board, **When** the item is created, **Then** `item.board_id` = Inbox.
3. **Cheap enrichment only.** **Given** an Inbox capture, **When** processed, **Then** only *cheap* metadata is fetched (title, favicon/screenshot, fetched description) — the **expensive AI takeaway does NOT fire** here (it is earned on assignment, Epic 14).
4. **Sub-second, non-blocking.** **Given** a capture request, **When** received, **Then** it returns immediately with a `pending`/`done-cheap` item; capture/enrich runs async on the queue (degrades gracefully with no LLM, per Epic 4).
5. **Tests** assert idempotent seed (existing-DB regression), Inbox default, and that the expensive enrichment worker is **not** invoked on Inbox capture.

### Story 13.2: Bookmarklet capture client
As a desktop user,
I want a one-click bookmarklet,
so that I can save the current tab to my Inbox without leaving the page.

**Acceptance Criteria:**
1. **Bookmarklet served + copyable.** **Given** a settings/help surface, **When** I view it, **Then** I get a `javascript:` bookmarklet pre-filled with my instance URL and token-bearing capture call.
2. **One click saves + confirms.** **Given** I click the bookmarklet on any page, **When** it runs, **Then** it POSTs `{url, title}` to `/api/v1/items`, shows a tiny confirmation, and does not navigate me away (auto-close/return).
3. **Lands in Inbox.** Saved item appears in the Inbox with cheap enrichment.
4. **Tests/manual proof:** the bookmarklet payload is asserted to call the authed endpoint; a save round-trips to an Inbox item.

### Story 13.3: PWA + Web Share Target (mobile capture)
As a mobile user,
I want board-oss in my native share sheet,
so that I can save inspiration from any app with one tap.

**Acceptance Criteria:**
1. **Installable PWA.** **Given** the app, **When** visited on a supported mobile browser, **Then** it offers install (valid manifest + service worker).
2. **Registers as a share target.** **Given** the installed PWA, **When** I share a URL from another app, **Then** board-oss appears in the share sheet and receives the shared URL.
3. **Share → Inbox, one tap.** **Given** a shared URL, **When** I tap save, **Then** it lands in the Inbox (cheap enrichment), sub-second, then returns me to where I was.
4. **No-regression:** the manifest/service-worker addition does not alter existing SPA behavior on desktop. *(NFR-BC)*

### Story 13.4: Browser extension — recent-additions review lane (fast-follow)
As a desktop user,
I want a popover/sidebar showing my recent captures with their AI-suggested home,
so that I can triage the firehose without opening the app.

**Acceptance Criteria:**
1. **Save + list via the API.** **Given** the extension, **When** opened, **Then** it can save the current tab and list the last N captures via `/api/v1/items` (token-authed).
2. **Suggestion chips, one-tap confirm.** **Given** recent Inbox items, **When** shown, **Then** each displays its AI suggested-board chip (Epic 14.3); tapping it promotes the item (calls the assign endpoint, 14.2).
3. **Not a linkding clone.** The popover's differentiator is *compose review* (suggested home + confirm), not just a save button.
4. *(Sequencing note: depends on Epics 12 + 14; this is the "later" fast-follow, not the first cut. Status starts `planned`.)*

---

## Epic 14: Inbox triage & the one-verb assignment

**Goal:** Promote links from the Inbox into typed boards via a **single assign verb** that fires the *earned* AI takeaway, and make the Inbox scannable with an **AI suggested-board chip** that turns promotion from a decision into a one-tap confirmation. **Backward-compat:** assignment is a single-FK update (no m2m); existing items are never auto-moved or re-enriched. *(D6–D9, D12, NFR-BC.)*

### Story 14.1: Cheap-vs-earned enrichment split
As the maintainer,
I want enrichment tiered (cheap on capture, expensive on assignment),
so that AI compute is spent on links that earned a purpose, not on bucket churn.

**Acceptance Criteria:**
1. **Two tiers defined.** **Given** the enrichment worker (Epic 7), **When** invoked, **Then** it supports a *cheap* tier (metadata: title/favicon/description/screenshot, no LLM) and an *earned* tier (the descriptor-driven AI takeaway).
2. **Inbox capture → cheap only.** Confirmed by 13.1's test (expensive tier not invoked on Inbox).
3. **Assignment → earned tier.** **Given** an item assigned to a typed board, **When** the assign endpoint runs, **Then** the earned tier fires against the **target board's** descriptor schema.
4. **Existing items untouched.** **Given** already-enriched pre-wave items, **When** the split ships, **Then** they are not re-enriched, downgraded, or altered. *(NFR-BC)*
5. **Graceful with no LLM.** Earned tier degrades to `done` (no error) when no provider is configured (Epic 4).
6. **Tests** assert tier selection per path and the no-regression on existing items.

### Story 14.2: Move/assign endpoint (the one verb)
As a user,
I want to assign an Inbox item to a typed board in one action,
so that promoting a link is a single coherent motion (the same one the composer uses in bulk).

**Acceptance Criteria:**
1. **Single endpoint, batch-capable.** **Given** `POST /api/v1/items/assign {itemIds[], boardId}`, **When** handled, **Then** it updates `item.board_id` for each (single-FK move, no m2m) and fires the earned-tier enrichment (14.1) against the target schema.
2. **Manual and composer share it.** The composer (15.2) calls this same endpoint — there is exactly one assign code path. *(D8)*
3. **Field mapping is safe.** **Given** an item whose cheap fields don't all map to the target descriptor, **When** assigned, **Then** known fields map, unknown are preserved in the JSON bag, and no field is destroyed.
4. **Idempotent + reversible.** Re-assigning is idempotent; assigning back to Inbox is allowed (no data loss).
5. **No-regression:** items in existing boards are never auto-assigned; only explicit calls move items. *(NFR-BC)*
6. **Tests** inject single + batch assign, assert FK move, earned-tier fired, field preservation, idempotency.

### Story 14.3: Scannable Inbox + AI suggested-board chip
As a user,
I want each Inbox item to show a suggested home board I can accept with one tap,
so that triage is confirmation, not a filing chore.

**Acceptance Criteria:**
1. **Inbox view is scannable.** **Given** the Inbox, **When** rendered, **Then** cheap metadata (title, thumbnail, source) shows in a fast list/grid.
2. **Suggestion chip present.** **Given** an Inbox item, **When** the AI is available, **Then** a suggested-board chip is shown; tapping it calls the assign endpoint (14.2). *(If AI unavailable, the chip degrades to a manual board picker — dignified, per UJ-2.)*
3. **Override is captured as signal.** **Given** I pick a different board than suggested, **When** I confirm, **Then** the override is recorded (for future suggestion quality).
4. **No guilt-pile fallback.** **Given** the suggestion can't be computed, **Then** the Inbox still shows a clear count + manual promote (never a silent infinite bucket).
5. **Tests** assert chip→assign wiring, manual fallback, and override capture.

---

## Epic 15: AI board composer (views, not copies)

**Goal:** Let the AI compose curated boards from the user's saved items as **saved views (lenses)** — no copying, no item migration, enrichment stays canonical on the one home item. Provide a deliberate **copy-on-write** escape hatch for hand-pruned/reordered boards. **Backward-compat:** views are a new additive table; existing boards/items are unaffected and a view never mutates its source items. *(D10, D11, D12, NFR-BC.)*

> ⏳ **STATUS: pending Hayawan's confirmation of the view-def hinge** (workshop hinge #1). The stories below (15.1–15.3) are written so the spine (Epics 12–14, 17) doesn't depend on them. Confirm: a composed view = filter-defined lens + optional pin/order overlay stored in the `view` row (not a join, not m2m). Stories carry `Status: planned` until confirmed.

### Story 15.1: View-definition model (saved cross-board lens)
As the maintainer,
I want a view defined by a saved query plus optional ordering/captions,
so that a "composed board" is a lens over canonical items, not a duplicate pile.

**Acceptance Criteria:**
1. **Additive `view` table.** **Given** the schema, **When** migrated, **Then** a new `view` table stores `{id, name, filter (JSON), order (optional item-id array), captions (optional map)}` — **a field, NOT a join table**; `item`/`board` schemas are unchanged. *(NFR-BC, workshop hinge #1)*
2. **Filter-defined (dynamic) by default; pins are an overlay.** **Given** a view, **When** opened, **Then** its `filter` resolves **dynamically** (newly-matching items auto-appear), reusing FTS5 + facet logic; the optional `order` array is an explicit pin/reorder **overlay** stored in the `view` row — a soft membership *in the view table*, **NOT** a join column on `item` and **NOT** m2m on the home board. **And** resolution is read-only — no `item.board_id` or fields change.
3. **Cross-board rendering is honest.** **Given** a view spanning boards with different descriptors, **When** rendered, **Then** it shows the universal fields (title/thumbnail/source/tags) and degrades per-board-specific columns gracefully.
4. **Canonical meaning.** Edits/enrichment on a source item reflect in every view that includes it (single source of truth).
5. **Tests** assert read-only resolution, no item mutation, and existing-data regression.

### Story 15.2: Composer proposes (assignments and/or a view)
As a user,
I want to describe (or let the AI infer) a board and have it propose how to build it from my saved items,
so that completeness becomes curated boards I didn't assemble by hand.

**Acceptance Criteria:**
1. **Two proposal modes.** **Given** my Inbox/collection, **When** the composer runs, **Then** it can propose **home-board assignments** for Inbox items (via 14.2) and/or a **cross-board view** (via 15.1) — surfaced as a reviewable proposal, persisting nothing until I accept.
2. **Same assign path.** Accepting assignment proposals calls the single assign endpoint (14.2) — no second code path. *(D8)*
3. **Guardrailed + reversible.** Proposals are bounded (validate-and-repair, reuse Epic 10 composer guardrails); accept is reversible; reject persists nothing.
4. **Degrades without AI.** **Given** no provider, **Then** the composer offers a manual view/board builder (dignified, UJ-2) — never an error wall.
5. **Tests** assert propose-only (no persistence pre-accept), accept→assign/view, and no-AI fallback.

### Story 15.3: Copy-on-write "materialize view to board"
As a user,
I want to turn a composed view into a real board when I want to hand-prune or reorder it,
so that divergence is a deliberate choice I made, not a default the system imposed.

**Acceptance Criteria:**
1. **Explicit, user-initiated.** **Given** a view, **When** I choose "materialize," **Then** a new board is created and the view's items are **copied** into it (new item rows; asset files **dedupe by hash**, Story 1.x asset model).
2. **Source preserved.** **Given** materialization, **When** done, **Then** the source items and their home boards are unchanged (copy, not move). *(NFR-BC)*
3. **Divergence is owned.** Post-materialize edits to the copy do not affect the source (and the UI says so).
4. **Tests** assert copy (not move), hash-dedupe of assets, and source integrity.

---

## Epic 16: Meaning-preserving archival

**Goal:** Let users archive curated links at full fidelity (self-contained HTML snapshot) **plus** the preserved AI takeaway, so what survives link-rot is *why it mattered*, not just the bytes. Opt-in, curated-tier, with footprint guardrails on the small box. **Backward-compat:** a new `asset` kind; existing screenshot assets and the capture sidecar contract are unchanged. *(D13, NFR-1, NFR-BC.)*

### Story 16.1: `snapshot` asset kind via SingleFile on the capture sidecar
As a user,
I want a self-contained HTML snapshot stored for a link,
so that its content survives the page going down.

**Acceptance Criteria:**
1. **New asset kind.** **Given** an archive action, **When** it runs, **Then** a `kind='snapshot'` asset is written (self-contained `.html` on disk, hashed for dedupe) — additive to the `asset` table; screenshot assets unchanged. *(NFR-BC)*
2. **Reuses the concurrency-1 sidecar.** **Given** SingleFile capture, **When** invoked, **Then** it runs through the existing single-Chrome sidecar + queue (no second browser, no parallel Chromium). *(NFR-1)*
3. **Footprint guardrails.** **Given** a large/slow page, **When** captured, **Then** a per-snapshot size cap and capture timeout apply; over-cap pages are skipped/flagged, never wedge the queue.
4. **Graceful degradation.** **Given** capture OOM/timeout, **When** it fails, **Then** the item still saves (snapshot simply absent), no error wall.
5. **Dependency scored.** `single-file-cli` passes the dependency-policy score before install.
6. **Tests** assert snapshot asset creation, hash-dedupe, size/timeout caps, and degradation.

### Story 16.2: Opt-in archival trigger (curated-tier)
As a user,
I want archival to be opt-in and tied to promotion,
so that my small box archives what I curated, not every bucket link.

**Acceptance Criteria:**
1. **Off by default.** **Given** a fresh install, **When** items are captured to Inbox, **Then** no snapshots are taken.
2. **Per-board and/or per-item opt-in.** **Given** a board flagged "archive on promote" (or a per-item "archive this" action), **When** an item is assigned/flagged, **Then** the snapshot (16.1) is enqueued.
3. **Takeaway preserved with it.** **Given** an archived item, **When** snapshotted, **Then** the AI takeaway/enrichment is stored alongside (the differentiator — meaning, not just bytes).
4. **No-regression:** enabling archival never alters existing items that weren't opted in. *(NFR-BC)*
5. **Tests** assert default-off, opt-in trigger, and takeaway-pairing.

### Story 16.3: Archive footprint visibility + backfill
As a self-hoster,
I want to see how much disk archives use and backfill on demand,
so that "no storage limit" never becomes a silent surprise.

**Acceptance Criteria:**
1. **Total archive size surfaced.** **Given** archives exist, **When** I view settings/board info, **Then** total snapshot disk usage is shown.
2. **Serial backfill command.** **Given** existing curated items, **When** I run a backfill, **Then** snapshots are created serially through the sidecar (accepting slow throughput; never parallel Chromium), resumable/idempotent by item id.
3. **Tests** assert size reporting and idempotent backfill (no duplicate snapshots).

---

## Epic 17: Data portability (export)

**Goal:** Give users a one-click way to leave with their data — the trust handshake that makes them willing to pour their taste in. Read-only, no schema change. **Backward-compat:** export only reads. *(D14, NFR-6, NFR-BC.)*

### Story 17.1: Export (JSON + Netscape HTML)
As a user,
I want to export all my boards and items,
so that my data isn't trapped and I can re-import elsewhere.

**Acceptance Criteria:**
1. **Full JSON export.** **Given** `POST /skills/export` (or `GET /api/v1/export`), **When** invoked, **Then** it returns a JSON file with all boards (descriptors), items (fields, notes, favorites, status, source), and asset references (paths/hashes). Round-trippable with the existing flat-JSON importer (Story 1.5 / 3.3) where possible.
2. **Netscape HTML export.** **Given** the export, **When** I choose Netscape format, **Then** it produces a browser/linkding-compatible bookmark HTML (url + title + tags + add-date), the interchange standard.
3. **Read-only + complete.** **Given** export, **When** it runs, **Then** it mutates nothing and covers every board/item (with documented caveats for binary assets — referenced by path, copied separately, mirroring linkding's documented export limits).
4. **Tests** assert JSON completeness, Netscape validity, and zero mutation.

---

## Build sequence (dependency-ordered)

```
12.1 → 12.2            (keystone: auth, then CRUD)
        ├→ 13.1 (Inbox + cheap capture) → 13.2 (bookmarklet) → 13.3 (PWA)
        └→ 14.1 (enrichment split) → 14.2 (assign verb) → 14.3 (Inbox + chip)
                                                ├→ 15.1 (view model) → 15.2 (composer) → 15.3 (materialize)
                                                └→ 13.4 (extension review lane — fast-follow)
16.1 (snapshot kind) → 16.2 (opt-in trigger) → 16.3 (footprint/backfill)   [parallelizable after 14.2]
17.1 (export)                                                              [independent; cheapest trust win, can land early]
```

**Recommended first cuts (highest leverage, lowest drama):** 12.1 → 12.2 → 13.1 → 13.2, then 14.1 → 14.2 → 14.3. 17.1 (export) is independent and cheap — land it early as the trust signal. 15.x and 16.x follow once the capture→triage spine is proven.
