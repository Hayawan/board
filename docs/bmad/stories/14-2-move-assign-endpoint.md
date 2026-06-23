# Story 14.2: Move/assign endpoint (the one verb)

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Epic 14 — Inbox triage & the one-verb assignment.** Story 2 of 3. Build order: (1) cheap-vs-earned enrichment split → **(2) move/assign endpoint (the one verb) ◄ this story** → (3) scannable Inbox + suggested-board chip. This story is the SINGLE assign verb: one batch-capable endpoint + one shared helper that updates `item.board_id` (single-FK move, never m2m) and fires the earned-tier enrichment (14.1) against the target board's schema — the same path the composer (15.2) will call. *(D7, D8; D12 constraint; NFR-BC.)*

## Story

As a user,
I want to assign an Inbox item to a typed board in one action,
so that promoting a link is a single coherent motion (the same one the composer uses in bulk).

## Acceptance Criteria

1. **Single endpoint, batch-capable.**
   **Given** `POST /api/v1/items/assign {itemIds: string[], boardId: string}`, **When** handled, **Then** for each item it updates `item.board_id` to the target (single-FK move — `db/schema.ts:30`, **no m2m, no join table**) and fires the **earned-tier** enrichment (14.1) against the target board's descriptor. A single-id and a multi-id call use the same code.

2. **Manual and composer share exactly one code path.**
   **Given** the assign helper, **When** the composer (15.2) accepts an assignment proposal, **Then** it calls the **same helper** the REST route calls — there is exactly one assign implementation (a dev cannot fork a second). The route is a thin adapter over the helper (mirroring 8.3's `patchItemFields` helper + route split). *(D8)*

3. **Move FIRST, then enrich — earned tier hits the TARGET schema.**
   **Given** an item being assigned, **When** the helper runs, **Then** it (1) updates `board_id` to the target, THEN (2) enqueues the earned-tier enrich-only job — because `runEnrichmentForItem` derives the descriptor from the item's `board_id` (`enrichment/worker.ts:94`), so the FK must already point at the target when enrichment reads it.

4. **Field mapping is safe — no field destroyed.**
   **Given** an item whose cheap fields don't all map to the target descriptor, **When** assigned, **Then** known fields map, unknown keys are **preserved** in the `item.fields` JSON bag, and no field is destroyed — guaranteed by the enrichment merge (`enrichment/worker.ts:122`: `{...existing, ...enriched}`) which never deletes keys.

5. **Idempotent + reversible.**
   **Given** a re-assign, **When** it runs, **Then** the end state is stable (`board_id` at target, fields merged/preserved). **And** assigning an item **back to Inbox** is allowed with no data loss: Inbox is typeless (no `enrichable:true` keys) so the earned tier early-returns (`enrichment/worker.ts:102`) and the field merge preserves the existing cheap fields — a safe no-op enrichment. (Decide + test one rule for same-board re-assign: it does NOT re-fire the LLM when the target equals the current `board_id` — skip, don't churn.)

6. **No-regression (NFR-BC).**
   **Given** items in existing pre-wave boards, **When** the assign feature ships, **Then** no item is **ever auto-assigned** — only explicit `assign` calls move items. A regression test asserts existing boards/items are untouched until an explicit call names them.

7. **Tests** inject single + batch assign and assert: FK move per item, earned-tier fired against the target descriptor, field preservation (AC4), idempotency + assign-back-to-Inbox no-op (AC5), same-board re-assign does not re-fire (AC5), and the no-auto-assign regression (AC6).

## Tasks / Subtasks

- [x] **Task 1 — Failing assign-helper test first (TDD)** (AC: 1, 3, 4)
  - [x] `enrichment/assign.test.ts`: seed Inbox + typed boards + an item on Inbox; call `assignItems` for one item with a spy `LLMProvider`. Asserts `board_id` moved to target AND the earned prompt reflects the TARGET descriptor (`/design inspiration/i`). Confirmed red (helper missing).
- [x] **Task 2 — Shared assign helper (the ONE code path)** (AC: 1, 2, 3)
  - [x] `enrichment/assign.ts` → `assignItems(handle, {itemIds, boardId, llm, registry, timeoutFn})`. Validates the target board once; **Phase 1** moves every item's `board_id` via `writeItem` (single-FK, search_blob recomputed vs target, fields/assets untouched), de-duped, per-item try/catch; **Phase 2** fires the **earned-tier** enrich-only job (`runCaptureEnrichJob`, `source` omitted + `tier:'earned'`) for each moved item, collected via `Promise.allSettled` exposed as `settled`. The single path 15.2 reuses — the route does NOT inline assign logic.
- [x] **Task 3 — Field-preservation + idempotency tests** (AC: 4, 5)
  - [x] Unmapped cheap field preserved through assign (merge, never delete); same-board re-assign → `skipped`, 0 LLM calls; assign BACK to typeless Inbox → earned tier early-returns (0 LLM), cheap fields preserved, `board_id`=Inbox.
- [x] **Task 4 — Batch test** (AC: 1, 7)
  - [x] `assignItems` with 3 ids (incl. one unknown) → valid ids moved, unknown → `notFound`, `Promise.allSettled`. **Plus a genuine enrich-failure-in-batch test** (throwing LLM): both items still move (FK durable) and land at `status=error` — proving a failing job doesn't abort the batch (review fix for the original confound).
- [x] **Task 5 — Failing route test, then the route** (AC: 1, 2)
  - [x] `api/v1.test.ts`: `POST /api/v1/items/assign` (token-authed) → 200 + FK move; empty `itemIds` → 400; unknown board → 400 (no move). Confirmed red, then added the thin route in `api/v1.ts` calling `assignItems` (lazy `resolveDb`). The route awaits `settled` (manual assign returns the enriched result) with a defensive 200-item cap.
- [x] **Task 6 — NFR-BC regression (AC: 6)**
  - [x] `enrichment/assign.test.ts`: existing items on existing boards are byte-for-byte unchanged when an explicit assign names only a DIFFERENT item — nothing auto-assigns. Full suite → **393 pass / 0 fail**.

## Dev Notes

### What this story changes vs preserves (read before coding)

- **Adds the one assign verb (D8).** A new shared helper `assignItems` + a thin `POST /api/v1/items/assign` route. The helper is the single code path; 15.2's composer calls the SAME helper — no second assign implementation anywhere.
- **`board_id` stays a single FK (D12, NFR-BC).** Assign is a single-FK UPDATE on `item.board_id` (`db/schema.ts:30`, NOT NULL). There is NO many-to-many, NO global pool, NO join table. One item, one home board. [Source: db/schema.ts#L30, docs/bmad/epics-v2.md#L156]
- **Reuses the enrich-only pipeline pattern.** The earned tier on assign is `runCaptureEnrichJob` with `source` omitted (enrich-only, no re-capture — the cheap capture already ran in the Inbox) and `tier:'earned'` (14.1). This is exactly `reenrichBoardItems`'s shape (`enrichment/refetch.ts:51`). [Source: enrichment/refetch.ts#L46]
- **Preserves existing items (NFR-BC).** Nothing auto-assigns. Only explicit `assignItems` calls move items. Existing boards/items in `data/board.db` are untouched. [Source: docs/bmad/epics-v2.md#L181]

### Why this design (anti-pattern prevention)

- **Move before enrich (load-bearing ordering).** `runEnrichmentForItem` reads the descriptor from `item.board_id` (`enrichment/worker.ts:94-95`). If you enriched before the FK move, you'd enrich against the SOURCE (Inbox/typeless) schema and the earned takeaway would never fire. Update `board_id` first, then enqueue the earned job. [Source: enrichment/worker.ts#L94]
- **One helper, not two routes' worth of logic.** If the route and the composer each implemented assign, the "earned tier on assign" behavior would drift (one would forget the move-first ordering, or the same-board skip). The route is a thin adapter; the composer reuses the helper. This is the 8.3 discipline (`patchItemFields` helper + `server.ts:359` route). [Source: db/item-actions.ts#L25, server.ts#L359, docs/bmad/epics-v2.md#L178]
- **Reversible by construction (no special-casing Inbox).** Assigning back to Inbox doesn't need a "revert" code path: Inbox is typeless → `buildEnrichmentSchema` yields zero keys → `runEnrichmentForItem` early-returns at `allowedKeys.size === 0` (`enrichment/worker.ts:102`) and the field merge (`worker.ts:122`) preserves the cheap fields. The move is just another single-FK update. Verify this no-op holds and test it. [Source: enrichment/worker.ts#L102, enrichment/worker.ts#L122]
- **Same-board re-assign must not churn the LLM.** Idempotency = stable end-state. Re-firing earned enrichment when the target already equals `board_id` burns compute for no change. Pick the skip rule and test it (the 8.3 "pick one and test it" discipline). [Source: docs/bmad/stories/8-3-per-item-actions.md#L27]
- **Field preservation is free but must be asserted.** The merge `{...existing, ...enriched}` (`worker.ts:122`) never deletes keys, so unmapped cheap fields survive. A naive "replace fields" impl would destroy them — assert preservation explicitly. [Source: enrichment/worker.ts#L122]

### Project Structure Notes

- New `db/assign.ts` (or `enrichment/assign.ts`) — `assignItems` shared helper (the ONE path).
- `server.ts` — thin `POST /api/v1/items/assign` route over the helper, lazy `opts.db ?? getDb()` (mirror the 8.3 routes at `server.ts:359-374`). Lives under the Epic 12 `/api/v1` token-guarded surface.
- Reuses `runCaptureEnrichJob` (`enrichment/pipeline.ts`) with `tier:'earned'` + `source` omitted; `writeItem` (`db/queue.ts:160`) for the FK move.
- ESM `.js` specifiers; `node:test` + `inject()`; add any new test file to the `test` script.

### Testing standards

- Temp DB; a fake `LLMProvider` with a `complete` call counter (to assert earned-tier fired / skipped) + which descriptor it received (target schema check).
- Assert the single-FK move (read back `item.board_id`), earned-tier fired against the TARGET descriptor, field preservation, idempotency, assign-back-to-Inbox no-op, same-board no-refire, batch via `allSettled`, and no-auto-assign regression.
- The assertions naive impls miss: (a) move-before-enrich (else enriches against source schema), (b) unmapped fields preserved, (c) same-board re-assign doesn't re-fire.

### References

- [Source: docs/bmad/epics-v2.md#L171] — Story 14.2 ACs (single batch endpoint, shared with composer, field mapping safe, idempotent/reversible, no auto-assign).
- [Source: docs/bmad/epics-v2.md#L53] — home-board / composed-view reconciliation: promotion = a move (one FK update) + the earned takeaway = the one verb.
- [Source: db/schema.ts#L30] — `item.board_id` NOT NULL single FK (assign = single-FK update; NEVER m2m).
- [Source: enrichment/worker.ts#L94] — `runEnrichmentForItem` derives descriptor from `board_id` (why move-first).
- [Source: enrichment/worker.ts#L102] — `allowedKeys.size === 0` early-return (assign-back-to-Inbox no-op).
- [Source: enrichment/worker.ts#L122] — field merge `{...existing, ...enriched}` (no field destroyed).
- [Source: enrichment/refetch.ts#L46] — `reenrichBoardItems` enrich-only batch pattern (the earned-on-assign shape).
- [Source: enrichment/pipeline.ts#L34] — `runCaptureEnrichJob` (`source` omitted = enrich-only; `tier:'earned'` from 14.1).
- [Source: server.ts#L359] — the 8.3 helper+route split pattern to mirror (lazy `opts.db ?? getDb()`).
- [Source: db/item-actions.ts#L25] — `patchItemFields`: the "shared helper, thin route" precedent.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (BMAD dev-story workflow)

### Debug Log References

- RED → GREEN → full regression: **393 pass / 0 fail**, 64 suites.

### Completion Notes List

- ✅ All 7 ACs satisfied. `assignItems` is the single assign verb both the REST route and the composer (15.2) call — the route is a thin adapter with zero assign logic. Single-FK move (D12, no m2m). Move-first-then-enrich is now structurally guaranteed: **all moves complete (Phase 1) before any earned-enrich job is fired (Phase 2)**, so every job reads the TARGET descriptor.
- **Reversible/idempotent by construction:** same-board re-assign is skipped (no LLM churn); assign-back-to-Inbox is a safe no-op (Inbox is typeless → the worker's `allowedKeys.size===0` early-return; verified the Inbox descriptor is non-null so it hits the early-return, not the null-descriptor throw); the enrich merge preserves all fields.

**Party-mode review (Winston/Amelia/Quinn) — findings addressed before commit:**
- ✅ [High, Quinn] **Missing AC6 no-auto-assign regression** — the wave's core NFR-BC guarantee for this story was argued only structurally. Added a test: existing items on existing boards are byte-for-byte unchanged when an explicit assign names only a different item.
- ✅ [High, Amelia] **AC7 batch-resilience confound** — the original "one unknown id doesn't abort the rest" used a `notFound` id, never exercising a failing enrich job. Added a throwing-LLM batch test: both items still move (FK durable) and land at `status=error`, `settled` resolves — proving the `.catch`/`allSettled` resilience.
- ✅ [Med, Amelia/Winston] **Move/enrich interleaving + asymmetric resilience** — restructured into Phase 1 (all moves, fast serial DB writes, per-item try/catch → a failed move records `failed` and continues) + Phase 2 (fire all enrich jobs). Moves no longer interleave with slow LLM round-trips; a failing move no longer aborts the batch.
- ✅ [Low, Amelia] **Duplicate itemIds** could land an id in two result buckets — now de-duped (`[...new Set(itemIds)]`).
- ✅ [Nit, Winston] **Route latency footgun** — the route awaits `settled` (serial enrichment); added a defensive 200-item cap (the bulk composer calls the helper directly, uncapped + fire-and-forget). Documented the manual-await vs bulk-fire-and-forget split.

### File List

- `enrichment/assign.ts` (new) — the shared `assignItems` helper (the ONE assign path): validate target → Phase 1 single-FK moves (de-duped, guarded) → Phase 2 earned-tier enrich-only jobs; returns `{assigned, skipped, notFound, failed, settled}`.
- `enrichment/assign.test.ts` (new) — 8 tests: move+target-descriptor, field preservation, same-board skip, assign-back-to-Inbox no-op, batch + notFound, unknown-board throw, enrich-failure resilience, AC6 no-auto-assign.
- `api/v1.ts` (modified) — thin `POST /api/v1/items/assign` route over `assignItems` (validation + 200-item cap + awaits `settled`).
- `api/v1.test.ts` (modified) — 3 route tests (move, empty-itemIds 400, unknown-board 400).
- `package.json` (modified) — appended `enrichment/assign.test.ts`.

### Change Log

- 2026-06-23 — Story 14.2 implemented: the one assign verb — `assignItems` (single-FK move-first then earned-tier enrich against the target descriptor; batch-capable; idempotent/reversible) + a thin `POST /api/v1/items/assign` route. The single path the composer (15.2) reuses. 393 pass / 0 fail.
- 2026-06-23 — Addressed party-mode review: added the AC6 no-auto-assign regression + a genuine enrich-failure batch test; restructured to moves-first/enrich-second (no interleaving, resilient to a failed move); de-duped ids; capped the manual route batch.
