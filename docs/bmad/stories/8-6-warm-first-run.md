# Story 8.6: Warm zero-config first-run

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Epic 8 — Boards experience.** Story 6 of 6. Build order: (1) switcher → (2) filters → (3) actions → (4) optimistic save → (5) degraded → **(6) warm zero-config first-run ◄ this story**. This story makes a stranger's first launch warm and working with zero config — reach first value in one paste. *(UJ-3, NFR-4.)*

## Story

As a stranger on first launch,
I want a warm empty state that works with zero config,
so that I reach first value in one paste.

## Acceptance Criteria

1. **Each board's empty state renders a WARM purpose line (from a sourced artifact), not just "not blank".**
   **Given** a board with 0 items, **When** the empty state renders, **Then** it shows the board's **purpose line** + a capture field. The purpose line is a **named, sourced artifact** — a descriptor field (e.g. `descriptor.purpose`/`description`) or a defined per-board fallback — NOT just `descriptor.name` on a blank page (a capture field + a bare name passes "not blank" but is exactly the cold state to avoid). The test asserts the *purpose line* renders, not merely that a capture affordance exists. *(This REPLACES the prototype's TWO cold CLI empty states: `emptyState()` `index.html:1839` ("No sites yet" + `npx tsx add.ts`) and the inline block in `renderLibraryList` `index.html:1644-1651` ("No items yet" + CLI). Unify both into one warm, descriptor-driven helper.)*

2. **[MANUAL/INTEGRATION] Pasting one URL captures and displays it (zero config).**
   **Given** the warm empty state, **When** I paste one URL, **Then** it captures and displays the item with zero configuration. *(End-to-end — partly manual; the pieces (boot, capture-without-LLM, disabled card) are unit-covered; mark this AC manual/integration.)*

3. **A dismissible, PERIPHERAL nudge offers to enable AI (doesn't nag).**
   **Given** no provider configured (Story 4.4 signal), **When** I use the app, **Then** a peripheral, dismissible nudge offers to add a key/provider — NOT a banner blocking the board above the fold, NOT a setup wizard/modal, NOT re-shown after dismissal (localStorage). The board is the hero of first-run (SM-C2), not the nudge.

4. **[MANUAL/INTEGRATION] First-run works on a truly fresh install.**
   **Given** a fresh `DATA_DIR` (no data, no LLM, seeded boards only), **When** the app boots, **Then** it serves, shows the warm state, and the first paste works. *(The boot+seed pieces are unit-testable (fresh temp DATA_DIR → boots + seeded boards present); the full paste-to-card is the manual/integration spine of SM-1.)*

## Tasks / Subtasks

- [ ] **Task 1 — Write the failing first-run tests first (TDD)** (AC: 1, 2, 4)
  - [ ] Test the boot + empty-state path: fresh temp `DATA_DIR` → seeded boards exist (Story 1.2) → `GET /api/collections` returns them → an empty board renders the warm state (pure helper: given 0 items + a descriptor, the empty-state markup includes the board's purpose + capture affordance). Server-side: assert boot succeeds with no LLM config (Story 4.4 disabled path).
  - [ ] Run; confirm red.
- [ ] **Task 2 — Render ONE warm, descriptor-driven empty state (replacing the two cold ones)** (AC: 1)
  - [ ] Replace BOTH prototype cold empty states — `emptyState()` (`index.html:1839`, inspiration CLI string) AND the inline block in `renderLibraryList` (`index.html:1644-1651`, library CLI string) — with one warm helper: the board's **purpose line** (from `descriptor.purpose`/`description` or a defined fallback — decide + source it; if it's a new descriptor field, that's a 1.2/Epic 10 closed-shape touch, so prefer a defined fallback map for v1) + the always-present capture field. Pure-helper-testable (descriptor + 0 items → markup containing the purpose line).
- [ ] **Task 3 — Ensure the zero-config capture path works** (AC: 2, 4)
  - [ ] The first paste must capture with no LLM: capture (Epic 6) runs, the item saves as `done` with empty enriched fields (disabled path, Story 5.2/4.4), and the card displays (Story 8.5 dignified state). This is the integration of the whole no-AI chain — verify it end-to-end on a fresh DATA_DIR.
- [ ] **Task 4 — Add the peripheral, dismissible enable-AI nudge** (AC: 3)
  - [ ] When no provider is configured (Story 4.4 signal), show a quiet, **peripheral** nudge ("Add an API key or coding-agent to enable AI analysis") — NOT a banner blocking the board above the fold, NOT a modal/wizard. Dismissible (localStorage), stays dismissed, non-blocking. The board stays the hero (SM-C2). Don't show it when a provider IS configured.
- [ ] **Task 5 — Wire tests + verify green** (AC: 4)
  - [ ] Add the test to the `test` script; run `npm test`; confirm green + existing suites unaffected.

## Dev Notes

### What this story changes vs preserves (read before coding)

- **NEW warm empty state + enable-AI nudge** — net-new UX realizing UJ-3 ("a stranger reaches first value in one paste"). The prototype has no first-run / empty-state design (it assumes the founder's populated data).
- **This is the capstone of the no-AI / zero-config chain.** It integrates: seeded boards (1.2), env defaults + DATA_DIR auto-create (2.1/2.2), no-AI default (4.4), capture without LLM (Epic 6), disabled→done (5.2), dignified card (8.5). 8.6 is where they all add up to "this is mine and it looks great in one paste."
- **Depends on all of Epic 8's prior stories + the no-AI chain.** Correctly last in the epic.

### Why this design (anti-pattern prevention)

- **Zero-config first value (UJ-3/NFR-4/SM-1).** The success metric SM-1 is "a stranger reaches 'first item captured, looks great' with no docs and no LLM config." Every default must make first-run work: localhost bind, auto-created DATA_DIR, seeded boards, no-AI default, capture-without-LLM. Nothing may require setup before first value. [Source: docs/bmad/PRD.md#7 SM-1, #NFR-4, UJ-3]
- **Warm, not cold.** An empty board must explain itself + invite a paste — not show a blank grid (which reads as broken). The empty state is the onboarding. [Source: docs/bmad/PRD.md#2.3 UJ-3]
- **Nudge, don't block.** The enable-AI prompt is a dismissible nudge, never a blocking modal or a setup wizard. The app must be fully usable with AI off (FR-9). A setup gate would violate zero-config. [Source: docs/bmad/PRD.md#FR-9, UJ-3]
- **Lead with the board, not the terminal (SM-C2).** The first-run surface is the board + a paste field — not an agent/terminal story. The counter-metric SM-C2 says keep the first-run/marketing surface board-first. [Source: docs/bmad/PRD.md#7 SM-C2]

### Project Structure Notes

- Frontend empty-state + nudge in `index.html`; pure empty-state helper testable. Boot/seed from 1.2/2.x; no-AI from 4.4.
- ESM `.js` specifiers; `node:test`; add the test to the `test` script.

### Testing standards

- Pure empty-state helper (descriptor + 0 items → warm markup with purpose + capture field).
- Server: boot on a fresh temp DATA_DIR with no LLM → serves + seeded boards present.
- The end-to-end "first paste works with zero config" is partly integration — cover the pieces (boot, capture-without-LLM, disabled card) via their unit tests + a documented manual check.
- Existing suites green.

### References

- [Source: docs/bmad/PRD.md#2.3 UJ-3] — a stranger reaches first value in one paste; warm empty state; zero config.
- [Source: docs/bmad/PRD.md#7 SM-1] — the primary success metric this realizes.
- [Source: docs/bmad/PRD.md#NFR-4] — no blocking first-run; serves with zero LLM/Chrome config.
- [Source: docs/bmad/PRD.md#FR-9] — fully usable with AI off; the nudge is dismissible.
- [Source: docs/bmad/PRD.md#7 SM-C2] — lead with the board, not the terminal.
- [Source: docs/bmad/stories/1-2-board-descriptor-seeded-boards.md] — seeded boards present on first run.
- [Source: docs/bmad/stories/4-4-optional-graceful-provider-selection.md] — no-AI default.
- [Source: docs/bmad/stories/8-5-degraded-disabled-state.md] — the dignified card the first paste produces.

## Dev Agent Record

### Agent Model Used

_(to be filled by dev agent)_

### Debug Log References

### Completion Notes List

### File List
