# Story 13.4: Browser extension — recent-additions review lane (fast-follow)

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Epic 13 — Capture funnel.** Story 4 of 4. Build order: (1) Inbox + cheap capture → (2) bookmarklet → (3) PWA share-target → **(4) extension review lane ◄ this story**. **This is the deferred fast-follow, NOT the first cut.** It **depends on Epics 12 + 14**: it lists/saves via the token-authed API (Epic 12) *and* shows the AI suggested-board chip with one-tap confirm (Epic 14.3) that calls the assign endpoint (Epic 14.2). Build it only after the capture→triage spine (12 → 13.1 → 14.1–14.3) is proven. *(D5; NFR-BC.)*

## Story

As a desktop user,
I want a popover/sidebar showing my recent captures with their AI-suggested home,
so that I can triage the firehose without opening the app.

## Acceptance Criteria

1. **Save + list via the API.**
   **Given** the extension, **When** opened, **Then** it can save the current tab (`POST /api/v1/items`, no board → Inbox, Story 13.1) and list the last N captures (`GET /api/v1/items?limit=&since=` newest-first, Story 12.2) — all token-authed (Story 12.1) against the configured instance.

2. **Suggestion chips, one-tap confirm.**
   **Given** recent Inbox items, **When** shown in the popover, **Then** each displays its **AI suggested-board chip** (Story 14.3); tapping it **promotes** the item by calling the assign endpoint (`POST /api/v1/items/assign`, Story 14.2) — which fires the earned-tier enrichment against the target board. *(If AI is unavailable, the chip degrades to a manual board picker — dignified, per UJ-2 / Story 14.3 AC 2.)*

3. **Not a linkding clone (the differentiator).**
   **Given** the popover, **When** evaluated, **Then** its distinguishing feature is **compose review** (suggested home + one-tap confirm), not merely a save button — the review lane is the point.

4. **No-regression.**
   **Given** the extension is a pure API client, **When** it is added, **Then** it introduces **no** server changes beyond what Epics 12 + 14 already shipped; existing boards/items are never auto-moved (only an explicit confirm calls assign, Story 14.2 AC 5). *(NFR-BC)*

5. **Tests.**
   **Given** the extension's API calls, **When** tested (unit/contract level — a full browser-extension E2E is out of scope for v1), **Then** they assert: the save call hits authed `/api/v1/items` (→ Inbox), the list call hits `GET /api/v1/items` and renders newest-first, and a chip tap calls the assign endpoint (14.2) with the chosen `boardId`; **And** a manual-fallback path when no suggestion is available.

## Tasks / Subtasks

- [x] **Task 1 — Confirm dependencies are landed (gate)** (AC: 1, 2)
  - [x] Verify Epic 12 (12.1 auth + 12.2 CRUD/list) and Epic 14 (14.2 assign endpoint + 14.3 suggestion chip) are implemented before starting — this story is a client of all four. **All landed** (merged to `main`): `/api/v1/items` (GET/POST), `/api/v1/items/assign`, `/api/v1/items/:id/suggestion`, `/api/v1/boards`. Gate passes.
- [x] **Task 2 — Write the failing API-client contract tests first (TDD)** (AC: 1, 2, 5)
  - [x] Added tests for the pure client: `save(currentTab)` → POST authed `/api/v1/items` (no board); `listRecent(n, since)` → GET `/api/v1/items?board=inbox&limit&since`; `assign(itemId, boardId)` → POST `/api/v1/items/assign`. Assert each call's URL, `Bearer` header, body. Manual-fallback via `reviewAction`. Plus `getSuggestion`/`listBoards` contract tests and an **inject-backed round-trip** against a real `buildServer`.
  - [x] Ran save() test; confirmed red (module missing).
- [x] **Task 3 — Implement the extension API client** (AC: 1, 2)
  - [x] `extension/api-client.js` — pure ESM (no DOM, no `chrome.*`), token-authed against the configured instance. Reuses the `/api/v1/*` contracts only — no bespoke endpoints.
- [x] **Task 4 — Build the popover review-lane UI** (AC: 2, 3)
  - [x] `popup.html`/`popup.js`: lists recent Inbox captures + per-item suggested-board chip (one-tap confirm → `assign`); manual board picker when there's no suggestion *or* the suggestion call fails (always promotable). Compose-review framing is the differentiator, not a bare save button.
  - [x] MV3 `manifest.json` + `options.html`/`options.js` for instance-URL/token settings (stored in `chrome.storage.local`, `type=password`, sent only as a Bearer header; remote instance must be https).
- [x] **Task 5 — Wire tests + verify green; confirm no server changes** (AC: 4, 5)
  - [x] Added `extension/api-client.test.ts` to the `test` script; suite green (438 pass / 0 fail). The diff touches only `extension/*` + the `package.json` test-script line — **no** server route/schema change; assign moves an item only on explicit chip/picker confirm.

## Dev Notes

### What this story changes vs preserves (read before coding)

- **Adds:** a browser-extension package (MV3 popover/sidebar) + a pure API-client module. **No server changes** — it consumes the Epic 12 (`/api/v1/items`, `/api/v1/items/assign`) and Epic 14 (suggestion chip, assign) surfaces.
- **Depends on:** Epic 12 (12.1 token auth, 12.2 CRUD/list) **and** Epic 14 (14.2 assign endpoint, 14.3 suggested-board chip). This is the **deferred fast-follow** — do not attempt it before the spine is proven.
- **Preserves (NFR-BC):** no schema/route change; existing boards/items are **never auto-moved** — only an explicit chip-confirm calls the single assign verb (14.2 AC 5, single-FK move, no m2m). *(docs/bmad/epics-v2.md:156, :181)*

### Why this design (anti-pattern prevention)

- **Pure API client — no second backend.** The extension reuses the same token-authed `/api/v1/*` contracts; adding extension-specific server routes would fork the save/assign paths. One contract, many clients. [Source: docs/bmad/epics-v2.md#L147, docs/bmad/epics-v2.md#L94]
- **Compose review is the differentiator (not a save button).** A plain "save the tab" popover is a linkding clone; the suggested-home chip + one-tap confirm is what makes this a triage lane. [Source: docs/bmad/epics-v2.md#L149]
- **One assign verb (no auto-move).** The chip confirm calls the **same** assign endpoint manual triage + the composer use (D8) — exactly one assign code path; items are never moved without an explicit confirm. [Source: docs/bmad/epics-v2.md#L148, docs/bmad/epics-v2.md#L178]
- **Deferred on purpose.** Sequencing depends on Epics 12 + 14; building it first would couple to unbuilt endpoints. Status starts `planned`. [Source: docs/bmad/epics-v2.md#L150, docs/bmad/epics-v2.md#L306]

### Project Structure Notes

- Live store is **SQLite at `data/board.db` (WAL) via `getDb()`/Drizzle**; the extension saves/lists/assigns **only** through the authed API (Epics 12 + 14). Legacy flat-JSON is import-source only.
- Extension package (MV3 manifest + popover) + a pure API-client module (testable without a real browser). No server-side files added.
- ESM `.js` specifiers; `node:test` for the client-contract tests (full extension E2E is out of v1 scope). Add tests to the `test` script.

### Testing standards

- **Contract tests** on the pure client: each of save/listRecent/assign hits the right `/api/v1/*` URL with the `Bearer` header + correct body; list renders newest-first; manual fallback when no suggestion.
- **No-regression**: assert the extension adds no server routes and existing behavior is unchanged; assign moves only on explicit confirm (14.2 AC 5).
- A full browser-extension E2E is **out of scope** for v1 — keep the testable logic in the pure client.

### References

- [Source: docs/bmad/epics-v2.md#L141-L150] — Story 13.4 ACs + the sequencing note (depends on Epics 12 + 14; `planned`).
- [Source: docs/bmad/epics-v2.md#L76-L99] — Epic 12: token auth (12.1) + CRUD/list (12.2) the extension consumes.
- [Source: docs/bmad/epics-v2.md#L171-L194] — Epic 14: the assign endpoint (14.2) + the scannable Inbox / suggested-board chip (14.3) the popover surfaces.
- [Source: docs/bmad/stories/13-1-inbox-board-cheap-capture.md] — saving with no board lands in the Inbox (cheap).
- [Source: docs/bmad/epics-v2.md#L299-L308] — build sequence: 13.4 is the fast-follow off Epics 12 + 14.
- [Source: docs/bmad/epics-v2.md#L24-L32] — NFR-BC: pure client, no auto-move, no server change.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (1M context)

### Debug Log References

- Full suite: **438 pass / 0 fail** (+7 tests for 13.4 over the 13.3 state).
- The inject-backed round-trip caught a real contract mismatch during dev: the live `/api/v1/items/assign` returns `{ assigned: [<id>], ... }` (an array of moved ids), not a count — a self-authored mock would never have caught it. Fixed the assertion to the live shape.

### Completion Notes List

- **Pure client, one contract, no second backend.** `extension/api-client.js` is plain ESM (no DOM, no `chrome.*` — the `collections-ui.js` precedent), so it's unit-testable. It speaks ONLY the Epic 12 + 14 routes: `save`→POST `/api/v1/items` (no board → Inbox), `listRecent`→GET `/api/v1/items?board=inbox&limit&since`, `getSuggestion`→GET `/api/v1/items/:id/suggestion`, `listBoards`→GET `/api/v1/boards`, `assign`→POST `/api/v1/items/assign` `{itemIds:[id], boardId}`. No server-side files added.
- **Two-layer test design (the 13.3 anti-confound lesson).** Fake-fetch tests pin URL/Bearer/body cheaply; an **inject-backed round-trip** routes the client's `fetch` into a real `buildServer` and asserts `save→Inbox` and `assign→board_id actually moves` against the LIVE contract. The mocks are only trustworthy because the round-trip proves the contract.
- **"newest-first" is honest passthrough.** The client never reorders; the list test asserts only that it returns the server's order unchanged. Real newest-first ordering is the server's job, proven in `api/v1.test.ts` — not re-claimed here.
- **Compose-review is the differentiator (AC3).** The popup shows each Inbox item's AI suggested-board chip with one-tap confirm (→ `assign`), degrading to a dignified manual picker when there's no suggestion. That triage lane — not a bare save button — is the point (vs. a linkding clone).
- **No auto-move (NFR-BC).** `assign` is called only on an explicit chip click or picker change; saving never moves anything. The round-trip asserts `board_id==='inbox'` *before* the assign call as a data point.
- **Token handling ("treat like a password").** Stored in `chrome.storage.local` (per-browser, never synced), `type=password` field, sent ONLY as an `Authorization: Bearer` header — never in a URL/query string, never logged. **Review fix (Winston):** a remote (non-localhost) instance must be `https` — `options.js` rejects cleartext `http` to a non-local host so the token can't leak on the wire.
- **MV3 host permissions.** Static `host_permissions` cover localhost/127.0.0.1 (dev); `optional_host_permissions: ["*://*/*"]` + a runtime request scoped to the *exact* configured origin is the idiomatic least-grant pattern (the user grants only their instance).
- **Review fixes applied (party-mode):** (a) https-only for remote instances (cleartext-token vector); (b) the per-item suggestion `.catch` now renders the manual picker too, so an item is always promotable even if the suggestion endpoint errors; (c) added `getSuggestion`/`listBoards` contract tests (were untested testable code). Confirmed non-issues: no DOM-injection (all item data via `textContent`/`createElement`/`value`; the one `innerHTML` is a static literal), `reviewAction` handles all degraded inputs, deleted/Inbox suggested board falls back to manual.
- **Scope honesty (AC2/AC3/AC5):** a full browser-extension E2E is out of v1 scope (per the story). The tested core is the pure client. The popup *wiring* (getSuggestion→reviewAction→assign(chosenBoardId) on click) is shell code verified by inspection, not an automated test; the round-trip proves the assign *verb* (with the contract), not the click handler. `package.json`'s only change is adding the test file to the `test` script — not a server change.

### File List

- `extension/api-client.js` (new) — pure ESM API client + `reviewAction` decision helper.
- `extension/api-client.test.ts` (new) — 7 tests: save/listRecent/assign/getSuggestion/listBoards contracts, `reviewAction`, inject-backed round-trip.
- `extension/manifest.json` (new) — MV3 (activeTab + storage; localhost host perms; optional `*://*/*`).
- `extension/popup.html`, `extension/popup.js` (new) — the review-lane popup (chip / manual picker / save tab).
- `extension/options.html`, `extension/options.js` (new) — instance-URL + token settings (https-for-remote enforced; host-permission request).
- `package.json` (modified) — added `extension/api-client.test.ts` to the `test` script (test wiring only; no server change).

### Change Log

- 2026-06-23 — Story 13.4 implemented (TDD). A pure, token-authed browser-extension API client + an MV3 review-lane popup that triages the Inbox via the AI suggested-board chip (one-tap confirm → the single assign verb) with a manual-picker fallback. Pure client of Epics 12 + 14 — no server changes. Party-mode review applied (https-only remote, always-promotable fallback, suggestion/boards tests). Suite 438 pass / 0 fail.
