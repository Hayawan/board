# Story 14.2: Move/assign endpoint (the one verb)

Status: draft

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

- [ ] **Task 1 — Write the failing assign-helper test first (TDD)** (AC: 1, 3, 4)
  - [ ] In `db/item-actions.test.ts` (extend) or new `db/assign.test.ts`: seed a temp DB with an Inbox-like board + a typed target board + an item on the source; call the assign helper for one item with a fake `LLMProvider` (call counter). Assert `board_id` moved to target AND the LLM was called with the TARGET descriptor's enrichable keys. Run; confirm red.
- [ ] **Task 2 — Implement the shared assign helper (the ONE code path)** (AC: 1, 2, 3)
  - [ ] Add `assignItems(handle, {itemIds, boardId, llm, registry, ...}): Promise<...>` (a new `db/assign.ts` or `enrichment/assign.ts`). For each id: validate the target board exists; update `item.board_id` via the typed write (`writeItem`, `db/queue.ts:160`) so search_blob stays consistent; THEN enqueue the **earned-tier** enrich-only job (`runCaptureEnrichJob` with `source` omitted + `tier:'earned'`, the `reenrichBoardItems` pattern, `enrichment/refetch.ts:51`). One job per item; collect with `Promise.allSettled`. This helper is the single assign path 15.2 will reuse — DO NOT inline assignment logic in the route.
- [ ] **Task 3 — Field-preservation + idempotency tests** (AC: 4, 5)
  - [ ] Test: item with extra/unknown cheap field keys → after assign, those keys are still present in `fields` (merge, never delete). Test: re-assign to the SAME board → no second LLM call (skip when `boardId === item.board_id`). Test: assign BACK to Inbox (typeless) → earned tier early-returns (no LLM), cheap fields preserved, `board_id` = Inbox.
- [ ] **Task 4 — Batch test** (AC: 1, 7)
  - [ ] Test: `assignItems` with 3 item ids → all 3 moved, 3 earned jobs fired (or skipped per AC5 rule), `Promise.allSettled` so one failure doesn't abort the rest.
- [ ] **Task 5 — Write the failing route test, then the route** (AC: 1, 2)
  - [ ] In `server.test.ts`: `inject()` `POST /api/v1/items/assign` (token-authed per Epic 12) with `{itemIds, boardId}`; assert 200 + the FK move. Run red. Then add the thin route in `server.ts` that calls `assignItems` (using `opts.db ?? getDb()` lazily, like the 8.3 routes, `server.ts:362`). 4xx on unknown board / empty itemIds.
- [ ] **Task 6 — Write the failing NFR-BC regression, confirm green** (AC: 6)
  - [ ] Test: seed a pre-wave DB with existing boards/items; boot/wire the assign feature WITHOUT calling it; assert every existing item's `board_id` and `fields` are unchanged (nothing auto-assigns). Then `npm test`; confirm green + existing suites unaffected.

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
