# Story 8.4: Optimistic save (card appears instantly, fields shimmer→fill)

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Epic 8 — Boards experience.** Story 4 of 6. Build order: (1) switcher → (2) filters → (3) actions → **(4) optimistic save ◄ this story** → (5) degraded → (6) first-run. This story makes a saved card appear INSTANTLY and fill in live as capture+enrichment complete — so the app feels fast though the robot is slow. *(FR-18; UJ-1.)*

## Story

As a collector,
I want a saved card to appear instantly and fill in live,
so that the app feels fast though the robot is slow.

## Acceptance Criteria

1. **[MANUAL] Card appears instantly with a smooth shimmer; paste-and-go works.**
   **Given** I save a URL, **When** accepted, **Then** a card appears immediately with a smooth (non-janky) status shimmer (`queued→capturing→enriching` — client labels over `processing`). *(Felt qualities — verify on the MANUAL checklist; not unit-testable.)*

2. **The capture field retains focus and clears after save — paste-and-go cadence.**
   **Given** I save a URL, **When** accepted, **Then** the capture field is cleared AND **retains focus**, so the next paste+Enter works with no mouse (the UJ-1 paste-paste-paste rhythm). *(Testable: assert the input is cleared + `document.activeElement` is the capture field after the save handler — or a pure handler that returns the focus/clear intent.)*

3. **[UJ-1] The optimistic card is mutated IN PLACE as SSE arrives — it never unmounts/re-keys/repositions.**
   **Given** the optimistic card I already own, **When** SSE transitions arrive (Story 5.3) and real data lands, **Then** the SAME card's fields fill in underneath — it does NOT disappear-and-reappear, re-sort, or jump. Final state `done` (populated) or `error` (Story 8.5 retry). *(The "underneath the card she already owns" climax — a card-REPLACEMENT implementation that passes a naive test still kills the feeling; forbid it.)*

4. **The server accepts the save and enqueues (does not block) — asserted by ordering, not timing.**
   **Given** the `add-item` save path, **When** called, **Then** it creates the pending item + enqueues capture (Epic 6) and returns the item id — it does NOT await capture/enrichment. *(Test: assert the capture mock was NOT invoked before the response was returned — an ORDERING assertion, never a `< N ms` wall-clock threshold, which is flaky.)*

5. **A failed SAVE (not a failed enrichment) resolves the optimistic card visibly — never a silent vanish.**
   **Given** the save request itself fails (network down, 500), **When** it errors, **Then** the optimistic card resolves to a visible, non-alarming state ("Couldn't save — retry"), NOT a silent disappearance (which reads as "my paste was eaten"). *(Distinct from enrichment settling `error`, which is Story 8.5.)*

6. **Tests: fast-accept (ordering), pure card-update for BOTH done and error events, focus/clear.**
   **Given** the save path + a pure card-update helper, **When** tested, **Then**: server returns the id before capture runs (AC 4, ordering); the pure helper maps an SSE `done` event → filled card AND an SSE `error` event → retry-card state; the save handler clears + refocuses the input (AC 2). DOM insert/shimmer-smoothness are MANUAL (AC 1, AC 3 in-place behavior).

## Tasks / Subtasks

- [ ] **Task 1 — Write the failing fast-accept tests first (TDD)** (AC: 1, 3, 4)
  - [ ] In `server.test.ts`: `inject()` the save (`POST /skills/add-item` or the items POST) → assert it returns the item id WITHOUT waiting for capture (mock the worker/capture so the test proves non-blocking accept). Plus a pure-helper test: given an SSE event `{itemId, status, fields}`, the card-update function produces the updated card state.
  - [ ] Run; confirm red.
- [ ] **Task 2 — Make save non-blocking (enqueue + return)** (AC: 3)
  - [ ] Replace the prototype's blocking save (recon: `addBookmark` `index.html:1985` awaits a single response; server `spawnAddItem` `server.ts:60-92` blocks on child `close`) with: `add-item` creates the pending item (Story 3.4) + enqueues capture (Story 6.1) on the worker (Story 5.1) and returns the item id immediately. The user can save the next URL right away.
- [ ] **Task 3 — Optimistic card + shimmer + paste-and-go focus (frontend)** (AC: 1, 2)
  - [ ] On save-accept, immediately insert an optimistic card keyed by the returned item id. Shimmer phase labels (`queued→capturing→enriching`) are CLIENT-SIDE over the single persisted `processing` (Story 5.3) — not new statuses. **Clear the capture input AND keep focus in it** (paste-and-go, AC 2). On save-REQUEST failure, resolve the card to a visible "Couldn't save — retry" (AC 5), never remove it silently.
- [ ] **Task 4 — Subscribe to SSE + fill the card IN PLACE (frontend)** (AC: 3)
  - [ ] Open the `EventSource` (Story 5.3); on a `status` event matching the optimistic card's item id, **mutate that same card in place** — fill fields from the event payload (`fields` on `done`, Story 5.3's pinned contract, no refetch), advance the shimmer, settle on `done`/`error`. **Do NOT replace the card node, re-key it, or re-sort the board** when real data lands (AC 3 — the UJ-1 "underneath the card she already owns"). A pure card-update helper computes the new card state from `(card, event)` for both `done` and `error`.
- [ ] **Task 5 — Decide: does optimistic save force a framework? (architecture §2 open question)** (AC: 1, 2)
  - [ ] Architecture §2 + PRD Open Question #2: keep vanilla-JS unless the optimistic-save reactivity forces a small framework. Evaluate: can the shimmer→fill be done with targeted DOM updates (vanilla) cleanly? If yes (likely at this scale), stay vanilla. Document the decision — do NOT add a framework speculatively.
- [ ] **Task 6 — Wire tests + verify green** (AC: 4)
  - [ ] Add the test to the `test` script; run `npm test`; confirm green + existing suites unaffected.

## Dev Notes

### What this story changes vs preserves (read before coding)

- **Replaces the prototype's blocking save (recon).** `addBookmark` (`index.html:1985`) shows "📸 Capturing…" then awaits a single blocking response; `spawnAddItem` (`server.ts:60-92`) blocks on the child's `close`. v1: save returns fast (enqueue), card appears optimistically, SSE fills it. This is the UJ-1 "card is alive before the robot finishes" moment.
- **Depends on: async save (5.1 worker), capture enqueue (6.1), SSE (5.3 — with the pinned `{itemId, boardId, status, fields?}` payload), status (5.2).** Correctly placed after them.
- **The 3-phase shimmer (`queued→capturing→enriching`) is client-side labeling** over the single persisted `processing` state (Story 5.3 pinned this) — don't add new statuses.

### Why this design (anti-pattern prevention)

- **Non-blocking accept is the whole point (FR-18/UJ-1).** If save blocks on capture, the user waits 10-30s per URL and the app feels broken. Enqueue + return fast → the user pastes URL after URL. This is THE feel of the product. [Source: docs/bmad/PRD.md#FR-18, UJ-1]
- **Fill from the SSE payload, not a refetch (Story 5.3 contract).** Story 5.3 pinned `fields` on the `done` event so the card fills without an extra fetch. Use it; don't refetch per card (N fetches for N cards on a slow box). [Source: docs/bmad/stories/5-3-sse-status-endpoint.md]
- **Reconcile optimistic card by item id.** The save-accept returns the id; match SSE events to the optimistic card by id so updates land on the right card (and a failed save removes/marks the optimistic card). [Source: UJ-1]
- **Vanilla-JS unless forced (architecture §2).** Don't add React "to be safe" — targeted DOM updates handle shimmer→fill at this scale. The framework decision is explicit and should be made, not defaulted. [Source: docs/bmad/architecture.md#2, docs/bmad/PRD.md#8 Open Questions]

### Project Structure Notes

- Frontend in `index.html` (optimistic insert + EventSource fill); save path via `add-item` skill / items route; SSE from Story 5.3.
- ESM `.js` specifiers; `node:test` for the server fast-accept + pure card-update helper; add tests to the `test` script.

### Testing standards

- Server: assert fast-accept (returns item id without awaiting capture — mock the worker so capture doesn't run in the test).
- Frontend: test the pure card-update helper (SSE event → new card state) headless; the DOM insert/fill is manual/existing-suite (don't open a real SSE socket in the unit test — Story 5.3's standard).
- Existing suites green.

### References

- [Source: docs/bmad/PRD.md#FR-18] — optimistic save + live status (SSE).
- [Source: docs/bmad/PRD.md#2.3 UJ-1] — Maya saves and the card is alive before the robot finishes.
- [Source: index.html#1985] — prototype's blocking `addBookmark` to replace.
- [Source: server.ts#60-92] — prototype's blocking `spawnAddItem` to replace with enqueue+return.
- [Source: docs/bmad/stories/5-3-sse-status-endpoint.md] — SSE + the pinned `{itemId,boardId,status,fields?}` payload (fields on done).
- [Source: docs/bmad/stories/5-1-single-writer-worker-queue.md] — the worker capture enqueues onto.
- [Source: docs/bmad/architecture.md#2] — vanilla-JS unless optimistic-save forces a framework (the decision this story makes).

## Dev Agent Record

### Agent Model Used

_(to be filled by dev agent)_

### Debug Log References

### Completion Notes List

### File List
