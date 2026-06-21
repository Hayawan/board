# Story 8.5: Degraded / disabled-LLM dignified state

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Epic 8 — Boards experience.** Story 5 of 6. Build order: (1) switcher → (2) filters → (3) actions → (4) optimistic save → **(5) degraded / disabled-LLM dignified state ◄ this story** → (6) first-run. This story makes a card with no/failed LLM look complete and dignified — never broken, never raw error text. *(UJ-2, FR-9.)*

## Story

As a user with no/failed LLM,
I want a complete card with a dignified empty state,
so that nothing looks broken.

## Acceptance Criteria

1. **"Enrichment disabled" copy keys off the NO-PROVIDER signal (Story 4.4), not field-emptiness.**
   **Given** NO provider is configured (the Story 4.4 signal — the same one 8.6's nudge uses), **When** a card with empty enriched fields renders, **Then** it shows a quiet "enrichment disabled"-style state. **Given** a provider IS configured but enrichment returned empty/partial, **When** rendered, **Then** it shows a NEUTRAL "No analysis" — NOT "disabled". *(Critical: `done`+empty does NOT imply disabled — Story 5.2 only routes `EnrichmentDisabledError`→done-empty; an enabled box can legitimately return empty. Inferring "disabled" from emptiness mislabels enabled installs. Source the disabled state from the provider signal.)*

2. **The card is complete for ITS board's captured fields (descriptor-driven, no screenshot assumption).**
   **Given** a disabled/empty item, **When** rendered, **Then** the card is complete using whatever its descriptor's captured + user fields are (Inspiration: screenshot/title/tags/notes; Library: title/summary-text/notes — **no screenshot**). Don't hardcode a screenshot check — a Library card has none.

3. **Enrichment-failed card shows the already-safe reason + a single QUIET "Retry analysis".**
   **Given** `status=error` (Story 5.2 — `error_reason` is ALREADY a clean, user-safe short string, mapped FOR 8.5 to display), **When** rendered, **Then** the card shows the captured content + the safe `error_reason` + ONE **quiet, low-emphasis** "Retry analysis" (not error-colored, not a big alarm button, not repeated per field). The bar (AC 5) is no RAW/stack/secret text — the safe reason IS displayed. *(5.2 made the reason safe precisely so it's shown; do not hide it behind a generic summary.)*

4. **Retry re-runs CAPTURE + enrichment (reuses Story 7.3 refetch).**
   **Given** a failed item, **When** I click "Retry analysis", **Then** it runs the Story 7.3 refetch (capture + enrichment, preserving user fields) — not a narrower enrichment-only retry.

5. **A test asserts the dignified states via a SENTINEL (no-raw-text is concrete), incl. the done-with-fields boundary.**
   **Given** a no-provider disabled item, a provider-on empty item, an errored item with a **sentinel** `error_reason` (e.g. `"SENTINEL_STACK_xyz"`), and a populated `done` item, **When** rendered (pure helper), **Then** assert: disabled → "disabled"-state + complete card; provider-on-empty → neutral "No analysis" (NOT "disabled"); errored → "Retry analysis" present + the safe reason shown + the **sentinel string ABSENT** from markup; populated → does NOT show "disabled"/"No analysis" (the boundary in the other direction).

## Tasks / Subtasks

- [ ] **Task 1 — Write the failing dignified-state tests first (TDD)** (AC: 1, 2, 3, 5)
  - [ ] Pure render-helper test with FOUR cases: (1) no-provider + empty → "disabled"-state + complete card; (2) provider-on + empty → neutral "No analysis", NOT "disabled"; (3) `status=error` with `error_reason="SENTINEL_STACK_xyz"` → "Retry analysis" present + safe reason shown + **sentinel string ABSENT** from markup; (4) populated `done` → no "disabled"/"No analysis". Pass the provider-configured signal into the helper.
  - [ ] Run; confirm red for the right reason.
- [ ] **Task 2 — Render the disabled vs neutral-empty state (off the provider signal)** (AC: 1, 2)
  - [ ] In the card renderer (Story 7.2): pass in the **provider-configured signal** (Story 4.4). No-provider + empty enriched → quiet "enrichment disabled" state; provider-on + empty → neutral "No analysis". Captured + user fields (descriptor-driven — NOT a hardcoded screenshot) render normally so the card looks complete.
- [ ] **Task 3 — Render the error state: show the safe reason + ONE quiet Retry** (AC: 3, 4)
  - [ ] When `status=error`: show captured content + the **already-safe** `error_reason` (Story 5.2 made it safe FOR display) + ONE quiet, low-emphasis "Retry analysis" (not error-colored, not per-field). The bar is no raw/stack/secret text (AC 5) — display the safe reason; do NOT hide it behind a generic summary. Wire "Retry analysis" to Story 7.3 refetch (capture + enrichment).
- [ ] **Task 4 — Pin the three-way (+boundary) rule** (AC: 1, 2, 5)
  - [ ] Tell apart: (a) `done` + enriched fields → show them (no placeholder); (b) `done` + empty → "disabled" (no provider) OR neutral "No analysis" (provider on); (c) `error` → safe reason + quiet Retry. Drive (b)'s wording off the provider signal, NOT emptiness alone. Document the rule.
- [ ] **Task 5 — Wire tests + verify green** (AC: 4)
  - [ ] Add the test to the `test` script; run `npm test`; confirm green + existing suites unaffected.

## Dev Notes

### What this story changes vs preserves (read before coding)

- **NEW dignified-state rendering** on top of Story 7.2's render-map. The prototype has no disabled/degraded state (it assumes analysis ran). This is net-new UX, realizing UJ-2 ("the robot is asleep and nothing looks broken").
- **Relies on Story 5.2's status classification:** disabled → `done` + empty enrichable fields (NOT `error`); real failures → `error` + clean `error_reason`. This story RENDERS those states; 5.2 produced them. The whole no-AI-is-dignified chain (4.4 → 5.2 → 8.5) culminates here.
- **"Retry analysis" reuses refetch (Story 7.3).** Don't build a separate retry — a failed item's retry IS a refetch (preserving user fields). [Source: docs/bmad/stories/7-3-re-enrich-refetch.md]

### Why this design (anti-pattern prevention)

- **Never raw error text (UJ-2/FR-9).** A raw stack/internal error on a card makes the app look broken. Show a quiet, dignified state — "No analysis" or "Retry analysis", never the `error_reason` internals. This is the product's emotional posture: "a board full of un-enriched cards still feels like a board to be proud of." [Source: docs/bmad/PRD.md#FR-9, UJ-2]
- **Disabled ≠ failed.** The no-provider case (`done`, empty fields) shows "enrichment disabled" (a calm, expected state); the failed case (`error`) shows "Retry analysis". Conflating them (e.g. showing "Retry" on a no-AI install) would nag the user to retry something that's intentionally off. Distinguish via Story 5.2's status. [Source: docs/bmad/stories/5-2-item-status-lifecycle.md]
- **The card is COMPLETE without AI.** Title, screenshot, notes, tags all come from capture + the user — not the LLM. The card must render fully on those alone; the enriched section degrades quietly. [Source: docs/bmad/PRD.md#FR-9, UJ-2]
- **Pure render helper, testable.** The dignified-state logic (item → markup) is a pure function — assert "no raw error text in markup" + "the right affordance". Don't bury it in DOM. [Source: docs/bmad/PRD.md#NFR-5]

### Project Structure Notes

- Extends Story 7.2's render-map / card renderer (`descriptor/render-map.ts` + the card glue). Retry → Story 7.3 refetch.
- ESM `.js` specifiers; `node:test`; add the test to the `test` script.

### Testing standards

- Pure render-helper tests: disabled item → dignified placeholder + complete card + no raw error; errored item → "Retry analysis" + no raw error text.
- The "no raw error text in the markup" assertion is the load-bearing one (it's the UJ-2 guarantee).
- Existing suites green.

### References

- [Source: docs/bmad/PRD.md#2.3 UJ-2] — the robot is asleep and nothing looks broken; dignified disabled state.
- [Source: docs/bmad/PRD.md#FR-9] — optional & graceful; disabled/empty state; "Retry analysis" on failure; never raw error.
- [Source: docs/bmad/stories/5-2-item-status-lifecycle.md] — the `done`-empty (disabled) vs `error` (failed) statuses this renders.
- [Source: docs/bmad/stories/4-4-optional-graceful-provider-selection.md] — the disabled→done degrade origin.
- [Source: docs/bmad/stories/7-2-generic-field-renderer.md] — the render-map this extends.
- [Source: docs/bmad/stories/7-3-re-enrich-refetch.md] — the refetch that "Retry analysis" reuses.

## Dev Agent Record

### Agent Model Used

_(to be filled by dev agent)_

### Debug Log References

### Completion Notes List

### File List
