# Story 13.4: Browser extension — recent-additions review lane (fast-follow)

Status: planned

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

- [ ] **Task 1 — Confirm dependencies are landed (gate)** (AC: 1, 2)
  - [ ] Verify Epic 12 (12.1 auth + 12.2 CRUD/list) and Epic 14 (14.2 assign endpoint + 14.3 suggestion chip) are implemented before starting — this story is a client of all four. If any is missing, hold (Status stays `planned`).
- [ ] **Task 2 — Write the failing API-client contract tests first (TDD)** (AC: 1, 2, 5)
  - [ ] Add tests for a pure extension API-client module: `save(currentTab)` → POSTs authed `/api/v1/items` (no board); `listRecent(n)` → GETs `/api/v1/items?limit=n` newest-first; `assign(itemId, boardId)` → POSTs `/api/v1/items/assign`. Assert each call's URL, `Bearer` header, and body. Assert the manual-fallback path when no suggestion is present.
  - [ ] Run; confirm red.
- [ ] **Task 3 — Implement the extension API client** (AC: 1, 2)
  - [ ] Implement the pure client module (no DOM) that the popover UI uses: save / listRecent / assign, all token-authed against the configured instance URL. Reuse the same `/api/v1/*` contracts — no bespoke endpoints.
- [ ] **Task 4 — Build the popover review-lane UI** (AC: 2, 3)
  - [ ] The popover lists recent Inbox captures with metadata + the suggested-board chip (14.3); tapping a chip calls `assign` (14.2). Manual board picker when no suggestion. The compose-review framing is the differentiator (AC 3) — not just a save button.
  - [ ] Package the extension manifest (MV3) + instance-URL/token settings (treat the token like a password).
- [ ] **Task 5 — Wire tests + verify green; confirm no server changes** (AC: 4, 5)
  - [ ] Add the client tests to the `test` script; run; confirm green. Confirm the extension adds **no** server-side routes (it consumes Epics 12 + 14 only) and that no existing behavior changed.

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

### Debug Log References

### Completion Notes List

### File List

### Change Log
