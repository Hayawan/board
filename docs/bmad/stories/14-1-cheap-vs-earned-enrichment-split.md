# Story 14.1: Cheap-vs-earned enrichment split

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Epic 14 — Inbox triage & the one-verb assignment.** Story 1 of 3. Build order: **(1) cheap-vs-earned enrichment split ◄ this story** → (2) move/assign endpoint (the one verb) → (3) scannable Inbox + suggested-board chip. This story tiers enrichment so AI compute is spent on links that earned a purpose (assignment), not on bucket churn (Inbox capture). *(D6, D7; NFR-BC.)*

## Story

As the maintainer,
I want enrichment tiered (cheap on capture, expensive on assignment),
so that AI compute is spent on links that earned a purpose, not on bucket churn.

## Acceptance Criteria

1. **Two tiers defined.**
   **Given** the enrichment worker (Epic 7), **When** invoked, **Then** it supports a *cheap* tier (capture-only metadata: title/favicon/screenshot, fetched description — **no LLM call**) and an *earned* tier (the existing descriptor-driven AI takeaway, `runEnrichmentForItem`). The tier is a parameter of the pipeline, not a new worker.

2. **Inbox capture → cheap only.**
   **Given** an Inbox capture, **When** processed, **Then** capture runs but the expensive `runEnrichmentForItem` is **NOT** invoked — the item lands at a terminal status with cheap metadata only. (The end-to-end Inbox-default assertion is owned by 13.1; this story owns the worker-level tier seam and its unit test.)

3. **Assignment → earned tier.**
   **Given** an item assigned to a typed board, **When** the assign path runs (14.2), **Then** the earned tier fires `runEnrichmentForItem` against the **target board's** descriptor schema (derived from `item.board_id`, `enrichment/worker.ts:94`). 14.1 exposes the earned-tier call; 14.2 wires it after the FK move.

4. **Existing items untouched (NFR-BC).**
   **Given** already-enriched pre-wave items (status `done`, populated `fields`), **When** the split ships, **Then** they are **not** re-enriched, downgraded, status-reset, or altered — because the split only changes which tier the *new* capture/assign paths request; nothing in this story iterates existing rows. A regression test opens a pre-wave DB with an enriched item and asserts it is byte-for-byte unchanged after the split is in place.

5. **Graceful with no LLM.**
   **Given** the earned tier requested when no provider is configured (`disabledLlm`), **When** it runs, **Then** `EnrichmentDisabledError` is classified as `done` (not `error`) by `runItemJob` (`db/queue.ts:278`) — a dignified un-enriched terminal state, no error wall (Epic 4).

6. **Tests assert tier selection per path and the no-regression on existing items.**
   **Given** the test suite, **When** it `inject()`s/exercises a cheap-tier job and an earned-tier job, **Then** it asserts the cheap path never calls the LLM (spy/fake provider records zero `complete` calls) and the earned path calls it once against the target descriptor; plus the AC4 pre-wave regression.

## Tasks / Subtasks

> **Implementation note (read first):** Story **13.1 already delivered the production seam** this story specifies — `runCaptureEnrichJob` already accepts `tier: 'cheap' | 'earned'` (default `'earned'`), `cheap` already skips `runEnrichmentForItem`, and existing callers are unchanged. So 14.1 added **no new production code**; its deliverable is the formal **tier-contract test suite** (`enrichment/tier.test.ts`) that locks the contract 14.2 (assign→earned) depends on, plus the AC3/AC4/AC5 coverage 13.1 didn't have. Tasks 2's seam is therefore marked done-by-13.1.

- [x] **Task 1 — Tier-selection test (cheap → 0 LLM, terminal)** (AC: 1, 2, 6)
  - [x] `enrichment/tier.test.ts`: runs the pipeline in **cheap** mode against **Inspiration** (a board WITH enrichable fields) with a fake provider counting `complete`; asserts `0` calls AND terminal `done`. Load-bearing — uses a fields-bearing board so the 0-call result is driven by the tier flag, not the `fields:[]` early-return (the confound from 13.1's first cut).
- [x] **Task 2 — Tier seam on the pipeline** (AC: 1, 2) — **delivered in 13.1.**
  - [x] `runCaptureEnrichJob` accepts `tier: 'cheap' | 'earned'` (default `'earned'`); `cheap` runs capture then skips `runEnrichmentForItem`; `earned` = today's behavior. One pipeline, one parameter (no second worker). Verified by Task 1/3 tests.
- [x] **Task 3 — Earned-tier test (1 call, against the TARGET descriptor)** (AC: 3, 6)
  - [x] Earned mode → asserts `complete` called once AND the prompt reflects the item's board (`/design inspiration/i` — Inspiration's descriptor signature, which a wrong-board descriptor would not match). Plus a default-tier test (omitted `tier` → earned) proving NFR-BC for existing callers.
- [x] **Task 4 — NFR-BC regression test** (AC: 4)
  - [x] Reframed to be **load-bearing** (review fix): an **earned** enrichment of one Inspiration item (with an overwriting provider) must NOT re-touch a **sibling** already-enriched Inspiration item — proving enrichment is single-item scoped. A naive board-wide re-enrich would overwrite the sibling's fields and fail the `deepEqual`. (The original "cheap job on item X leaves item Y" test was theater — it passed under any impl.)
- [x] **Task 5 — Graceful no-LLM in the earned tier** (AC: 5)
  - [x] Earned tier with `disabledLlm` → asserts terminal `done` (not `error`), exercising the existing `EnrichmentDisabledError → done` classification.
- [x] **Task 6 — Wire tests + verify green** (AC: 6)
  - [x] Added `enrichment/tier.test.ts` to the `test` script; full suite → **382 pass / 0 fail**; existing `pipeline.test.ts` / `worker.test.ts` unaffected (earned is the default).

## Dev Notes

### What this story changes vs preserves (read before coding)

- **Decouples what `pipeline.ts` currently couples.** Today `runCaptureEnrichJob` ALWAYS runs `runCaptureForItem` (when capturable) then ALWAYS `runEnrichmentForItem` (`enrichment/pipeline.ts:47-58`). The split makes the enrichment call conditional on a `tier` parameter. `cheap` = capture, skip the LLM takeaway; `earned` = today's full behavior.
- **Preserves the existing worker unchanged.** `runEnrichmentForItem` (`enrichment/worker.ts:88`) is the earned tier as-is — descriptor-driven, writes only `enrichable:true` keys, refreshes search_blob/FTS. No change to it.
- **Preserves every existing caller.** `add-item` (`skills/add-item.ts:53`), `refetch` (`enrichment/refetch.ts:26`), and `reenrichBoardItems` (`enrichment/refetch.ts:51`) all currently get the full pipeline — keep that by defaulting `tier` to `'earned'`, so existing behavior is byte-for-byte preserved and only the NEW Inbox-capture path (13.1) requests `cheap`.
- **Preserves already-enriched items (NFR-BC).** The split changes nothing about rows already in `data/board.db`. There is NO migration, NO boot-time re-enrichment, NO iteration over existing items. The tier only affects what the new capture/assign paths request going forward (AC4 test proves this).

### Why this design (anti-pattern prevention)

- **A parameter, not a fork.** Adding a second "cheap worker" alongside the earned worker would create two capture code paths that drift. The cheap tier is the SAME pipeline with the LLM step skipped — one job shape, one `processing` lifecycle. [Source: enrichment/pipeline.ts#L34, enrichment/pipeline.ts#L58]
- **Earned tier reads the descriptor from `board_id`.** `runEnrichmentForItem` derives the descriptor from the item's current `board_id` (`enrichment/worker.ts:94-95`). This is why 14.2 must move the FK *before* firing the earned tier — so it hits the TARGET schema. 14.1 just exposes the earned-tier call; 14.2 sequences it. [Source: enrichment/worker.ts#L94]
- **No re-enrichment of existing rows (NFR-BC).** Spending earned compute on links that "earned a purpose" is the whole thesis (D7). Re-running the LLM over already-enriched pre-wave items would both burn compute and risk downgrading good fields — explicitly forbidden. The split is additive by construction. [Source: docs/bmad/epics-v2.md#L31, docs/bmad/epics-v2.md#L167]
- **No-LLM is already dignified.** The earned tier inherits the existing `EnrichmentDisabledError → done` classification (`db/queue.ts:278`) — a no-AI box shows un-enriched cards, never error cards. Do not add new error handling. [Source: db/queue.ts#L278, skills/types.ts#L52]

### Project Structure Notes

- `enrichment/pipeline.ts` — add the `tier` parameter to `CaptureEnrichArgs` + `runCaptureEnrichJob`; gate the `runEnrichmentForItem` call.
- `enrichment/worker.ts` — unchanged (earned tier as-is).
- Existing callers (`skills/add-item.ts`, `enrichment/refetch.ts`) — unchanged unless they want to opt into `cheap` (they don't here; 13.1 owns the Inbox cheap-capture caller).
- ESM `.js` specifiers; `node:test` + temp DB via `initDb`; add any new test file to the `test` script.

### Testing standards

- Temp DB (`mkdtempSync` + `initDb`), a fake `LLMProvider` with a call counter for `complete` (the cheap-vs-earned discriminator) — model the `worker.test.ts` / `pipeline.test.ts` fixtures.
- The one assertion a naive impl misses: cheap tier makes **zero** LLM calls AND still reaches a terminal status (capture-only is a complete cheap result, not a stuck `pending`).
- NFR-BC regression: a pre-wave enriched item is unchanged after the split lands.

### References

- [Source: docs/bmad/epics-v2.md#L158] — Story 14.1 ACs (two tiers, Inbox→cheap, assignment→earned, existing untouched, graceful no-LLM).
- [Source: docs/bmad/epics-v2.md#L31] — NFR-BC: existing enrichment unaffected; the split applies to the NEW Inbox path only.
- [Source: enrichment/pipeline.ts#L34] — `runCaptureEnrichJob`: where capture + enrichment are coupled (the seam to split).
- [Source: enrichment/pipeline.ts#L58] — the unconditional `runEnrichmentForItem` call to gate behind `tier`.
- [Source: enrichment/worker.ts#L88] — `runEnrichmentForItem` = the earned tier (unchanged); derives descriptor from `board_id` (L94).
- [Source: db/queue.ts#L278] — `EnrichmentDisabledError → done` classification (graceful no-LLM, AC5).
- [Source: skills/add-item.ts#L53] — existing caller of `runCaptureEnrichJob` (defaults to earned; unchanged).
- [Source: enrichment/refetch.ts#L46] — `reenrichBoardItems` (enrich-only batch pattern; unchanged, still earned).

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (BMAD dev-story workflow)

### Debug Log References

- `enrichment/tier.test.ts` → 5 pass; full suite → **382 pass / 0 fail**, 63 suites.

### Completion Notes List

- ✅ All 6 ACs satisfied. **The production seam was delivered in 13.1** (the `tier` parameter is the general pipeline knob AC1 describes, not an Inbox-specific hack) — so 14.1 adds the formal tier-contract test suite, not new code. This is honest: 14.2 (assign→earned) needs a locked contract for "cheap=no LLM, earned=against the target board descriptor, no re-enrichment of existing rows, graceful no-LLM," and 14.1 provides exactly that.
- **Earned-tier entry point for 14.2 already exists by construction:** `runCaptureEnrichJob` with `source` omitted skips capture (`canCapture` gates on `!!args.source`) and runs enrich-only at the earned tier — that's the call 14.2 makes after the FK move. Confirmed, no new code needed.

**Party-mode review (Quinn QA) — APPROVE-WITH-NITS; the substantive nit fixed before commit:**
- ✅ [Nit→fixed] **AC4 test was theater** (Quinn): "a cheap job on item X leaves item Y unchanged" passes under *any* implementation (a cheap job structurally can't touch a different row) — it guarded nothing. Reframed to a load-bearing test: an **earned** enrichment of one item must not re-touch a **sibling** enriched item on the same board (single-item scope), with an overwriting provider so a board-wide re-enrich regression would fail the assertion.
- 📝 [Nit, accepted] Partial overlap with 13.1's `inbox-seed.test.ts` cheap/earned tests. `tier.test.ts` is the canonical tier-contract owner and adds genuinely new coverage (AC3 target-descriptor prompt assertion, default-tier, AC5 `disabledLlm→done`); 13.1's discriminating test stays for 13.1's standalone coverage. Defensive, net-positive overlap.
- 📝 [Note for 14.2] Every earned test here exercises the capture+enrich shape; the enrich-only (source-omitted) earned shape that 14.2's assign path invokes is 14.2's test to own.

### File List

- `enrichment/tier.test.ts` (new) — the tier contract: cheap→0 LLM (on a fields-bearing board, load-bearing), earned→1 against the target descriptor, default-tier=earned, sibling-not-re-enriched (AC4 load-bearing), `disabledLlm`→done.
- `package.json` (modified) — appended `enrichment/tier.test.ts` to the `test` script.
- (No production change — the `tier` seam in `enrichment/pipeline.ts` was delivered in Story 13.1.)

### Change Log

- 2026-06-23 — Story 14.1: formalized the cheap-vs-earned tier contract in `enrichment/tier.test.ts` (the production seam shipped in 13.1). Covers cheap=no-LLM, earned-against-target-descriptor, single-item-scope no-regression, and graceful no-LLM. 382 pass / 0 fail.
- 2026-06-23 — Addressed party-mode review: reframed the AC4 regression from a tautological test to a load-bearing single-item-scope assertion.
