# Story 14.1: Cheap-vs-earned enrichment split

Status: draft

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

- [ ] **Task 1 — Write the failing tier-selection test first (TDD)** (AC: 1, 2, 6)
  - [ ] In `enrichment/pipeline.test.ts` (extend) or a new `enrichment/tier.test.ts`: seed a temp DB + board; run the pipeline in **cheap** mode with a fake `LLMProvider` whose `complete` increments a counter; assert the item reaches a terminal status AND the counter is `0` (no LLM). Run; confirm red.
- [ ] **Task 2 — Add a tier seam to the capture→enrich pipeline** (AC: 1, 2)
  - [ ] Generalize `runCaptureEnrichJob` (`enrichment/pipeline.ts:34`) to accept a `tier: 'cheap' | 'earned'` (default `'earned'` to preserve every existing caller's behavior). `cheap` runs `runCaptureForItem` then **skips** the `runEnrichmentForItem` call (`pipeline.ts:58`). `earned` keeps today's behavior exactly. Do NOT add a second worker — one pipeline, one parameter.
- [ ] **Task 3 — Write the failing earned-tier test** (AC: 3, 6)
  - [ ] Test: run the pipeline in **earned** mode with the fake provider; assert `complete` called once and the descriptor passed reflects the item's board (target schema). Run; confirm red, then green via Task 2's `earned` branch (already the default path).
- [ ] **Task 4 — Write the failing NFR-BC regression test** (AC: 4)
  - [ ] Test: seed a pre-wave DB with an `inspiration` board + an item at status `done` with populated `fields`; load the split code; assert that merely importing/wiring the tier seam touches NOTHING — the enriched item's `status`, `fields`, `title`, `updatedAt` are unchanged (no code path iterates existing rows). Run; confirm it passes (proves additivity), and would fail if a naive impl re-enriched on boot.
- [ ] **Task 5 — Confirm graceful no-LLM in the earned tier** (AC: 5)
  - [ ] Test: earned tier with `disabledLlm` → item ends `done` (not `error`), via the existing `runItemJob` `EnrichmentDisabledError` classification (`db/queue.ts:278`). Assert terminal status is `done`.
- [ ] **Task 6 — Wire tests + verify green** (AC: 6)
  - [ ] Add the new test file to the `test` script; run `npm test`; confirm green + existing `pipeline.test.ts` / `worker.test.ts` suites unaffected (no caller broke because `earned` is the default).

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
