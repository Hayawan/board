# Story 15.2: Composer proposes (assignments and/or a view)

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Epic 15 — AI board composer (views, not copies).** Story 2 of 3. Build order: (1) view-definition model → **(2) composer proposes (assignments and/or a view) ◄ this story** → (3) copy-on-write materialize. This story is the composer: the AI proposes home-board **assignments** (reusing the one assign verb) and/or a cross-board **view** (15.1), as a reviewable proposal that persists nothing until accept. *(Decisions D8, D10, D12; NFR-BC.)*
> ⏳ **Pending Hayawan's confirmation of the view-def hinge** (workshop hinge #1): the composer's "view" output is the 15.1 lens (filter + optional pin/order in the `view` row) — not a join, not m2m. Until confirmed, this story stays `planned`.

## Story

As a user,
I want to describe (or let the AI infer) a board and have it propose how to build it from my saved items,
so that completeness becomes curated boards I didn't assemble by hand.

## Acceptance Criteria

1. **Two proposal modes, persists nothing.**
   **Given** my Inbox/collection, **When** the composer runs, **Then** it can propose **home-board assignments** for Inbox items (each `{itemId, targetBoardId}`) and/or a **cross-board view** (a 15.1 `{name, filter, order?, captions?}`), surfaced as a single reviewable proposal object — and **nothing is written** to the DB (no `item.board_id` change, no `view` row) until the user accepts. *(propose-only, FR-12/C7 parity with compose-board)*

2. **Accepting assignments uses the ONE assign path (D8).**
   **Given** accepted assignment proposals, **When** the user accepts, **Then** they are applied via the **single move/assign endpoint** (Story 14.2's `POST /api/v1/items/assign {itemIds[], boardId}`) — there is exactly **one** assign code path shared by manual triage and the composer; the composer does **not** introduce a second FK-move/enrichment path.

3. **Accepting a view uses the 15.1 model.**
   **Given** an accepted view proposal, **When** the user accepts, **Then** a `view` row is created via the 15.1 view-definition model (additive; no item migration, no copy).

4. **Guardrailed + reversible.**
   **Given** a composer proposal, **When** validated, **Then** it is bounded by a **validate-and-repair** loop that reuses the Epic 10 composer guardrails (`descriptor/guardrails.ts` — `validateAndRepair`, ≤ 1 repair) so a malformed proposal can never persist; **accept is reversible** (assignment can be re-assigned/sent back to Inbox; a view can be deleted), and **reject persists nothing**.

5. **Degrades without AI (UJ-2, no error wall).**
   **Given** no LLM provider is configured, **When** the composer runs, **Then** it returns a dignified **manual view/board builder** affordance (an empty/editable proposal the user fills in) — never a 500, never a silent drop — mirroring `compose-board`'s `status:'draft'` provider-unavailable fallback.

6. **No regression (NFR-BC).**
   **Given** existing boards/items, **When** the composer runs and even when a proposal is accepted, **Then** items that are not part of an accepted assignment keep their home board, no existing item is auto-moved or re-enriched, and a view is purely additive. *(NFR-BC, D12)*

7. **Tests** assert propose-only (no persistence before accept), accept → assign (via 14.2) / accept → view (via 15.1), guardrail validate-and-repair bounding, and the no-AI manual fallback.

## Tasks / Subtasks

- [x] **Task 1 — Write the failing composer tests first (TDD)** (AC: 1, 5, 7)
  - [x] In a new `skills/compose-collection.test.ts` (name TBD; sibling of `skills/compose-board.test.ts`): inject a fake `ctx.llm` returning a proposal `{assignments?, view?}`; assert the skill returns the proposal and **the DB is unchanged** (no `item.board_id` moved, no `view` row) — propose-only.
  - [x] Inject the disabled LLM (`EnrichmentDisabledError`/throw) and assert a `status:'draft'` manual-builder proposal is returned (no throw), mirroring `compose-board`'s fallback (`skills/compose-board.ts:88-98`).
  - [x] Run; confirm red.
- [x] **Task 2 — Implement the propose-only composer skill** (AC: 1, 4, 5)
  - [x] New `skills/compose-collection.ts` via `defineSkill` (zod in/out, ctx-injected — same shape as `compose-board`). Input: a natural-language description (+ optional candidate item set). Output: `{status:'ok'|'draft', assignments?: {itemId, targetBoardId}[], view?: {name, filter, order?, captions?}, errors?}`.
  - [x] Build the prompt the way `buildComposePrompt` does (fence the description as untrusted; ask for assignment proposals over existing boards AND/OR a view filter). PERSIST NOTHING in the skill (parity with `compose-board.ts:10-11`).
  - [x] Wrap proposal validation in the **shared** `validateAndRepair` (`descriptor/guardrails.ts:110`) so the bounded ≤1-repair loop is reused, not reinvented; on terminal failure return an editable `draft` (never throw).
- [x] **Task 3 — Accept path: assignments → the one assign endpoint (14.2)** (AC: 2, 6)
  - [x] On accept, route assignment proposals through Story 14.2's `POST /api/v1/items/assign {itemIds[], boardId}` (the single move/assign verb) — do **not** write `item.board_id` directly here and do **not** add a second enrichment trigger. (14.2 is itself planned; this story DEPENDS on it — see References. If 14.2 is unbuilt at dev time, this task blocks on it.)
  - [x] Test: accepting assignments calls the assign endpoint once per batch and produces the FK move + earned-tier enrichment **owned by 14.2** (assert via the endpoint, not a duplicated path).
- [x] **Task 4 — Accept path: view → the 15.1 model** (AC: 3, 6)
  - [x] On accept of a view proposal, create a `view` row via the 15.1 view-definition model (additive; reuse 15.1's insert primitive). No item migration, no copy.
  - [x] Test: accepting a view inserts exactly one `view` row and mutates zero `item` rows.
- [x] **Task 5 — Reversibility + reject** (AC: 4)
  - [x] Assert reject persists nothing; assert an accepted assignment can be re-assigned/sent back to Inbox (14.2 idempotency) and an accepted view can be deleted — divergence/undo is possible.
- [x] **Task 6 — Wire tests + verify green** (AC: 6, 7)
  - [x] Register the skill (if surfaced via the generic `/skills/:name` route — confirm against the fixed v1 skill list policy before adding); append the test to the `test` script; run `npm test`; confirm green + existing suites unaffected. Assert NFR-BC: unrelated items keep their home board.

## Dev Notes

### What this story changes vs preserves (read before coding)

- **Propose-only — the composer persists nothing.** This mirrors `compose-board` exactly: the skill returns a reviewable proposal; **accept is a separate call** (here: the assign endpoint and/or the view insert). [Source: skills/compose-board.ts#L10-11, skills/compose-board.ts#L77-103]
- **Exactly one assign code path (D8).** Assignment acceptance reuses Story 14.2's `POST /api/v1/items/assign` (single-FK move + earned-tier enrichment). The composer is "the same verb, run in bulk by the AI" — it must NOT fork a second move/enrichment path. [Source: docs/bmad/epics-v2.md#L22, docs/bmad/epics-v2.md#L178, docs/bmad/epics-v2.md#L223]
- **Guardrails are reused, not rebuilt.** The bounded validate-and-repair (`validateAndRepair`, ≤1 repair, never persists, returns an editable draft on terminal failure) is the Epic 10 primitive — call it, don't reinvent it. [Source: descriptor/guardrails.ts#L103-125]
- **No-AI degrades to a manual builder.** Same dignified fallback as `compose-board`: provider-unavailable → `status:'draft'` editable proposal, never an error wall (UJ-2). [Source: skills/compose-board.ts#L88-98]
- **Two outputs, one canonical store.** Assignments change a home board (one FK, via 14.2); a view is an additive lens (15.1). Neither copies items; enriched meaning never forks. [Source: docs/bmad/epics-v2.md#L57-59]

### Why this design (anti-pattern prevention)

- **One assign endpoint, no second path (D8).** The whole point of the reconciliation is that "manual triage" and "AI composer" are the *same* verb at different batch sizes. A separate composer-only move path would let the two drift (different enrichment, different field-mapping). Route through 14.2. [Source: docs/bmad/epics-v2.md#L45, docs/bmad/epics-v2.md#L171-182]
- **Persist nothing until accept (FR-12/C7).** A composer that writes as it proposes is destructive and un-reviewable. Like `compose-board`, this returns a proposal and lets accept be the only write. [Source: skills/compose-board.ts#L10-11]
- **Reuse the guardrail loop, not a new one.** A second validate-and-repair implementation would diverge from the proven Epic 10 bounds (≤1 repair, draft-on-failure). [Source: descriptor/guardrails.ts#L110-125]
- **Dignified no-AI mode.** A self-hosted box may have no provider; the composer must offer a manual builder, not a 500. [Source: docs/bmad/epics-v2.md#L225, skills/compose-board.ts#L88-98]

### Project Structure Notes

- New skill `skills/compose-collection.ts` (sibling of `skills/compose-board.ts`), via `defineSkill` with ctx-injected `db`/`llm`/`logger` (`skills/types.ts`). Reuses `descriptor/guardrails.ts#validateAndRepair`.
- Accept side: the assign endpoint (Story 14.2) for assignments; the 15.1 view-insert for views. **Confirm the v1 skill-list policy** (the fixed list note in Story 8.3 / architecture §4.1) before exposing this on `/skills/:name` vs as an internal compose primitive — do not silently widen the skill surface.
- **DEPENDENCY NOTE:** Story 14.2 (`POST /api/v1/items/assign`) is *planned*, not yet built — no `/assign` route exists in `server.ts` today. This story's assignment-accept path blocks on 14.2; cite the epics AC, not a code line, until it exists.
- ESM `.js` specifiers; `node:test` + injected fake `ctx.llm`; add the test to the `test` script.

### Testing standards

- Inject a fake `ctx.llm` (no real provider) returning canned proposals; the disabled-LLM case must return a `draft`, never throw.
- The load-bearing assertions: **propose-only** (DB byte-unchanged before accept), **accept → 14.2 assign** (asserted through the single endpoint, not a duplicated move), **accept → 15.1 view** (one `view` row, zero `item` mutation), and **no-AI fallback**.
- Follow `skills/compose-board.test.ts` for the inject-and-assert-no-persistence pattern.

### References

- [Source: docs/bmad/epics-v2.md#L216-226] — Story 15.2 ACs (two proposal modes, same assign path, guardrailed+reversible, no-AI fallback).
- [Source: docs/bmad/epics-v2.md#L171-182] — Story 14.2 the move/assign endpoint (`POST /api/v1/items/assign`) — the single assign path this story reuses (PLANNED; cite the AC, no code line yet).
- [Source: docs/bmad/epics-v2.md#L45,#L57-59,#L223] — D8 one-verb/one-endpoint; the home-board/composed-view reconciliation (same AI, two outputs).
- [Source: skills/compose-board.ts#L10-11,#L77-103] — the propose-only skill pattern + provider-unavailable `draft` fallback to mirror.
- [Source: descriptor/guardrails.ts#L103-125] — `validateAndRepair` (bounded ≤1 repair, never persists, editable draft on failure) — reuse, don't rebuild.
- [Source: skills/types.ts#L1-35] — `defineSkill` contract + ctx-injected db/llm/logger (mockable in-process).
- [Source: docs/bmad/stories/15-1-view-definition-model.md] — the view-definition model this story's view output targets on accept.
- [Source: docs/bmad/epics-v2.md#L24-32] — NFR-BC (unrelated items keep their home board; no auto-move/re-enrich).

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (1M context)

### Debug Log References

- The story's "14.2 is planned, not built" note is STALE — Epics 12+14 (incl. the assign verb) and 15.1 are all merged, so this story's deps are satisfied.
- Full suite: **485 pass / 0 fail** (+10 composer tests). Source typechecks clean under `strict` (`tsc --noEmit` shows no errors in the touched source files; remaining tsc errors are pre-existing test-file `.get()!` patterns, not CI-gated).

### Completion Notes List

- **Propose-only (AC1).** `composeCollectionSkill` reads boards + Inbox items from `ctx.db`, asks the LLM for `{assignments?, view?}`, and returns a reviewable proposal — it writes NOTHING (no `board_id` move, no `view` row). Tested with a real-DB readback (zero persistence both ways).
- **One assign path (AC2, D8).** Accept is a SEPARATE step: `acceptComposerProposal` is a thin dispatcher — assignments group by target board and go through the existing `assignItems` (14.2 single-FK move + earned enrichment); a view becomes one `view` row via `createView` (15.1). No second move/enrichment path. Tested: accept actually moves `board_id` (not a mock).
- **Guardrail reuse, not rebuild (AC4).** Extracted the Epic-10 ≤1-repair control flow into a generic `boundedRepair<T,V,E>` and rewrote `validateAndRepair` as a thin behavior-preserving wrapper (compose-board/generate-fields suites stay green). The composer calls `boundedRepair` with a board-aware validator (assignment targets exist; view needs name+filter; reject the empty proposal; no item assigned to two boards). Tested: malformed-first → one repair → ok (propose called exactly twice, error fed back); still-malformed → draft, nothing persisted.
- **No-AI degrades (AC5).** Provider error / `disabledLlm` → `status:'draft'` editable proposal, never a 500.
- **Reversible + reject (AC4).** Reject = don't call accept (propose-only). Tested: an accepted assignment re-assigns back to Inbox (same idempotent verb) and an accepted view deletes.
- **NFR-BC (AC6).** Tested with a bystander item left in the Inbox: accepting assignments for other items leaves it on its home board untouched.
- **Review fixes applied (party-mode):** (a) Winston — the composer pushed codes the shared `ProposalError` union forbids (failed `tsc --strict`); fixed by generalizing `boundedRepair`'s error type to `E` and giving the composer its own `ComposerError` type. (b) Amelia/Quinn — `acceptComposerProposal` now fail-fasts on an unknown target board BEFORE any move (atomic on validity, no partial accept) + a cross-board "same item to two boards" guard in the validator. (c) Quinn — added the AC6 bystander assertion. (d) added prompt-fencing + dedup + atomic-accept tests and a repair-feedback assertion.
- **Prompt injection.** `buildComposeCollectionPrompt` fences BOTH the description AND the candidate item titles/text (scraped from arbitrary web pages) as untrusted, with explicit "do not follow embedded instructions." Tested.
- **Skill surface.** `composeCollectionSkill` registered on the generic `/skills/:name` route (the compose-board precedent; Story 17.1 set the convention that a new capability is a registered skill). This does NOT widen the separate `/api/v1` skill surface.
- **Scope honesty:** the HTTP accept route is not wired in this story (accept is exercised at the function level via the real primitives); when a composer-accept route lands it should re-run `validateProposal` before `acceptComposerProposal`. Mounting the composer UI is staged DOM.

### File List

- `descriptor/guardrails.ts` (modified) — generic `boundedRepair<T,V,E>` extracted; `validateAndRepair` rewritten as a thin wrapper (behavior preserved).
- `skills/compose-collection.ts` (new) — `composeCollectionSkill` (propose-only) + `acceptComposerProposal` (thin dispatcher, atomic-on-validity) + `buildComposeCollectionPrompt` (fenced) + `ComposerError`.
- `skills/compose-collection.test.ts` (new) — 10 tests (propose-only, no-AI draft, repair bound + feedback, draft-on-failure, accept→assign + bystander, accept→view, reversibility, fencing, dedup, atomic accept).
- `db/view.ts` (modified) — `createView` write primitive (additive, serialized).
- `skills/registry.ts` (modified) — register `composeCollectionSkill`.
- `package.json` (modified) — test wired into the `test` script.

### Change Log

- 2026-06-23 — Story 15.2 implemented (TDD). Propose-only AI collection composer (home-board assignments and/or a cross-board view); accept reuses the one assign verb (14.2) + the 15.1 view model with no second path. Bounded ≤1-repair via a generalized `boundedRepair`; dignified no-AI draft. Party-mode review applied (typed-error fix, atomic accept, dedup, bystander + fencing tests). Epic 15 Story 2 of 3. Suite 485 pass / 0 fail.
