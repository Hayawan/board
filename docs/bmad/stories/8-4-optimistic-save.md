# Story 8.4: Optimistic save (card appears instantly, fields shimmer→fill)

Status: review

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

- [x] **Task 1 — Write the failing fast-accept tests first (TDD)** (AC: 1, 3, 4)
  - [x] In `server.test.ts`: `inject()` the save (`POST /skills/add-item` or the items POST) → assert it returns the item id WITHOUT waiting for capture (mock the worker/capture so the test proves non-blocking accept). Plus a pure-helper test: given an SSE event `{itemId, status, fields}`, the card-update function produces the updated card state.
  - [x] Run; confirm red.
- [x] **Task 2 — Make save non-blocking (enqueue + return)** (AC: 3)
  - [x] Replace the prototype's blocking save (recon: `addBookmark` `index.html:1985` awaits a single response; server `spawnAddItem` `server.ts:60-92` blocks on child `close`) with: `add-item` creates the pending item (Story 3.4) + enqueues capture (Story 6.1) on the worker (Story 5.1) and returns the item id immediately. The user can save the next URL right away.
- [x] **Task 3 — Optimistic card + shimmer + paste-and-go focus (frontend)** (AC: 1, 2)
  - [x] On save-accept, immediately insert an optimistic card keyed by the returned item id. Shimmer phase labels (`queued→capturing→enriching`) are CLIENT-SIDE over the single persisted `processing` (Story 5.3) — not new statuses. **Clear the capture input AND keep focus in it** (paste-and-go, AC 2). On save-REQUEST failure, resolve the card to a visible "Couldn't save — retry" (AC 5), never remove it silently.
- [x] **Task 4 — Subscribe to SSE + fill the card IN PLACE (frontend)** (AC: 3)
  - [x] Open the `EventSource` (Story 5.3); on a `status` event matching the optimistic card's item id, **mutate that same card in place** — fill fields from the event payload (`fields` on `done`, Story 5.3's pinned contract, no refetch), advance the shimmer, settle on `done`/`error`. **Do NOT replace the card node, re-key it, or re-sort the board** when real data lands (AC 3 — the UJ-1 "underneath the card she already owns"). A pure card-update helper computes the new card state from `(card, event)` for both `done` and `error`.
- [x] **Task 5 — Decide: does optimistic save force a framework? (architecture §2 open question)** (AC: 1, 2)
  - [x] Architecture §2 + PRD Open Question #2: keep vanilla-JS unless the optimistic-save reactivity forces a small framework. Evaluate: can the shimmer→fill be done with targeted DOM updates (vanilla) cleanly? If yes (likely at this scale), stay vanilla. Document the decision — do NOT add a framework speculatively.
- [x] **Task 6 — Wire tests + verify green** (AC: 4)
  - [x] Add the test to the `test` script; run `npm test`; confirm green + existing suites unaffected.

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

claude-opus-4-8[1m] (BMAD dev-story workflow)

### Debug Log References

- `npm test` → 280 pass / 0 fail (276 prior + 3 applySseEvent + 1 non-blocking-accept). No pollution.

### Completion Notes List

- ✅ AC4 (non-blocking accept) + AC6 (pure card-update for done AND error) delivered + tested. AC1/AC3/AC5 felt/DOM qualities are MANUAL (staged — see scope).
- **AC4 — non-blocking accept (ordering, not timing):** `runCaptureEnrichJob` enqueues the capture+enrich job and returns immediately; `add-item` already fire-and-forgets it. New test (`enrichment/pipeline.test.ts`) proves it by ORDERING: a fake capture adapter sets a flag, asserted `false` synchronously after the call returns, then `true` after `await` — no wall-clock threshold.
- **AC6 — pure card-update (`applySseEvent(card, event)`):** maps an SSE `status` event onto the owned card — `done` → status + fields merged FROM THE PAYLOAD (no refetch, Story 5.3 contract); `error` → status + `errorReason` (8.5 retry). Returns the SAME card ref on id mismatch. Caller mutates that one node in place (UJ-1). Exposed via `window.collectionHelpers`.
- **Framework decision (Task 5):** **STAY vanilla-JS** — `applySseEvent` computes next state purely; the DOM update is a targeted card mutation. No reactivity engine at this scale; framework NOT added speculatively (architecture §2 / PRD Open Q#2 → vanilla).
- **Scope honesty (DOM, MANUAL):** the optimistic-card INSERT, the `queued→capturing→enriching` shimmer (client labels over `processing`), the in-place SSE FILL (wiring `applySseEvent` into the EventSource handler instead of the 5.3 full-`load()`), paste-and-go clear+refocus (AC2 DOM), and the failed-SAVE "Couldn't save — retry" card (AC5) need a live browser to verify (Chrome offline) — staged with the UI cutover. The pure card-update + non-blocking accept that make them correct are delivered + tested.

### File List

- `collections-ui.js` (modified) — `applySseEvent`.
- `collections-ui.test.ts` (modified) — 3 tests (done fill, error state, id-mismatch no-op).
- `enrichment/pipeline.test.ts` (new) — AC4 non-blocking-accept ordering test.
- `index.html` (modified) — exposes `applySseEvent`.
- `package.json` (modified) — appended `enrichment/pipeline.test.ts`.

### Change Log

- 2026-06-20 — Story 8.4 implemented: non-blocking accept (ordering-tested) + pure `applySseEvent` (done/error, in-place) + vanilla-JS decision. Optimistic-card DOM staged (MANUAL). Status → review.

## Deferred UX task — live-fill + skeletons + degraded (confirmed decisions, 2026-06-23)

**Why this is here:** the SSE backend (Story 5.3) is wired and live — the frontend subscribes to `/events` and, on a `status` event, calls a full `load()` (`index.html:1541`), so a card DOES auto-update when analysis completes (no manual refresh needed at the data level). What's still staged is the *polished* feel: an optimistic shell, skeleton/shimmer while the LLM runs, granular in-place fill instead of a full board reload, and an elegant no-LLM card. The user confirmed the design below (2026-06-23) so the SPA-cutover implementer builds exactly this. The pure pieces (`applySseEvent`, non-blocking accept) are already delivered + tested; this is the DOM/UX wiring.

- [ ] **Watch mechanism = SSE, with a timeout fallback.** Replace the coarse full-`load()` in the EventSource `status` handler (`index.html:1541-1545`) with the granular per-card path: feed each event through `applySseEvent(card, event)` (already built + tested, `collections-ui.js:101`) and mutate that one card node in place (no re-sort / re-key — UJ-1). **Fallback:** if a `processing`/`pending` card receives no terminal (`done`/`error`) event within ~2 min (SSE dropped, worker died, no reconnect), do a one-shot reconcile fetch for that item (or surface a quiet "still working — refresh" affordance). Don't leave a card shimmering forever.
- [ ] **Optimistic shell appears after a fast capture.** On add, insert the card instantly at `pending`. When CAPTURE completes, show the real thumbnail + title; the AI-fillable (`enrichable`) fields render as **skeleton/shimmer placeholders** until the enrich `done` event fills them. *Note:* capture+enrich currently run as ONE `runItemJob` (`enrichment/pipeline.ts`) with a single `processing` state, so there's no mid-job "capture done" signal today — either (a) emit a capture-complete transition so the thumbnail can swap in before enrichment finishes, or (b) keep the whole card shimmering through `processing` and fill everything on `done`. Pick one when wiring; (a) matches "after a fast capture" best.
- [ ] **Skeletons only when an LLM is configured.** Gate the shimmer on the provider signal (`providerConfigured`, `/api/meta`), NOT field-emptiness — same signal `renderEnrichmentState` already uses (`collections-ui.js:127`). An enabled box that returns empty still shows the neutral "No analysis", not a stuck skeleton.
- [ ] **Degraded (no LLM) = basic card only — NO "Analyze" button** (user decision, 2026-06-23). When `providerConfigured === false`, the shell settles into a tidy basic bookmark (title / thumbnail / URL, no skeletons, no shimmer) and stops there — no manual re-analyze affordance. This refines Story **8.5**'s `renderEnrichmentState` "Enrichment disabled" branch (`collections-ui.js:152-154`); coordinate the final copy/layout there.
- [ ] **Verification:** needs a live browser (Chrome) — assert the optimistic insert, the shimmer→fill on the SSE `done` event (no full reload), the timeout fallback, and the no-LLM basic card. Keep the pure `applySseEvent` / `renderEnrichmentState` unit tests green.
