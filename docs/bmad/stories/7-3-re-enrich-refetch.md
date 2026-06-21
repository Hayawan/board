# Story 7.3: Re-enrich / refetch (preserve user fields)

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Epic 7 — Dynamic enrichment & rendering.** Story 3 of 3. Build order: (1) enrichment worker → (2) generic renderer → **(3) re-enrich/refetch ◄ this story**. This story lets a user re-run capture + enrichment on an item to refresh analysis, WITHOUT losing their notes/favorite (user-authored fields are preserved). *(FR-10.)*

## Story

As a user,
I want to re-run capture + enrichment on an item,
so that I can refresh analysis without losing my notes/favorite.

## Acceptance Criteria

1. **Refetch re-runs capture + enrichment.**
   **Given** an existing item, **When** I refetch it, **Then** capture (Epic 6) + enrichment (Story 7.1) re-run for it (on the worker, with status going `processing→done`).

2. **User-authored fields are preserved.**
   **Given** an item with notes/favorite (the `enrichable:false` fields, Story 1.2), **When** refetch re-runs, **Then** those user fields are preserved — only the `enrichable` fields and assets are refreshed.

3. **Refetch is idempotent (no duplicate item/assets).**
   **Given** a refetch, **When** it runs, **Then** it updates the existing item in place (idempotent capture, Story 6.1) — it does not create a duplicate item or orphan/duplicate assets.

4. **A test asserts preservation, update, and no-duplicate via concrete counts.**
   **Given** an item with notes + favorite + old enriched fields + one asset, **When** refetch runs (mock capture + mock provider returning **NEW** enriched values), **Then** the test asserts: notes/favorite survive **unchanged**; the enrichable fields took the **new** values; **`item.id` is unchanged**; and **asset count for the item == 1** (the old screenshot was replaced, not orphaned + duplicated — tie to Story 6.1 idempotent capture). *(Concrete counts — "no duplicate" without a count assertion passes vacuously.)*

## Tasks / Subtasks

- [ ] **Task 1 — Write the failing refetch tests first (TDD)** (AC: 1, 2, 3, 4)
  - [ ] Create `enrichment/refetch.test.ts`: seed an item with notes/favorite + old enriched fields; run refetch with mock capture + mock provider returning NEW enriched values; assert notes/favorite unchanged, enrichable fields updated, item id unchanged, no duplicate asset.
  - [ ] Run; confirm red.
- [ ] **Task 2 — Implement the refetch flow** (AC: 1, 3)
  - [ ] A `refetch` skill / job: for an existing item id, re-run the capture adapter (Epic 6, idempotent per Story 6.1 — replaces asset, doesn't duplicate) then the enrichment job (Story 7.1). Status `processing→done`/`error`. Port the prototype's refetch concept (recon: `runAdd` refetch branch with `BOARD_UPDATE_ID` → `mutateCollection` replacing the entry by id, `add.ts:611-623`; server `handleRefetchItem` `server.ts:181`/`/api/.../refetch` `server.ts:288`) into the v1 worker model.
- [ ] **Task 3 — Preserve user-authored fields (merge BEFORE the write)** (AC: 2)
  - [ ] Merge: keep the existing `enrichable:false` fields (notes, favorite, favorite_reason) from the current item; overwrite only the `enrichable` fields + replace the asset. The descriptor's `enrichable` flag (Story 1.2) is the discriminator. Do the merge **before** the typed item-write (Story 1.4) so `search_blob` rebuilds from the merged fields (preserved notes stay indexed). Do NOT blanket-overwrite `item.fields`.
  - [ ] **This inverts the prototype's preserve-by-DEFAULT to preserve-by-FLAG.** The prototype's `buildEntry({...existing})` (`add.ts:611-623`, Library; `add.ts:518` Inspiration) preserves *anything* not in the new analysis — including a **deep merge** of `reflection` subfields (`add.ts:529`: `reflection: {...existing.reflection, ...analysis.reflection}`). A flat enrichable/non-enrichable split will NOT reproduce that subfield-level merge. Equivalence requires Story 1.2's descriptors to mark every user/system field (`id`, `added`, `favorite`, `favorite_reason`, notes) `enrichable:false` — **verify against both seeded descriptors**, and note the lost reflection deep-merge (acceptable for v1 since reflection fields are LLM-authored, but flag it). (`favorite`/`favorite_reason` are a v1 addition — not in the prototype `buildEntry`.)
- [ ] **Task 4 — Expose refetch in the UI** (AC: 1)
  - [ ] Wire a "refetch" action (the prototype has a context-menu refetch, `index.html:2048`/`2132` → `helpers.refetchUrl`). Repoint at the v1 refetch skill/route. On a failed item, this is also the "Retry analysis" path (Story 8.5).
- [ ] **Task 5 — Wire tests + verify green** (AC: 4)
  - [ ] Add the test to the `test` script; run `npm test`; confirm green + existing suites unaffected.

## Dev Notes

### What this story changes vs preserves (read before coding)

- **Builds on capture (Epic 6, idempotent), enrichment (7.1), the descriptor's `enrichable` flag (1.2), status (5.2).** Correctly last in the epic.
- **Ports the prototype's refetch (recon).** `runAdd` has a refetch branch keyed by `BOARD_UPDATE_ID`: it finds the entry by id and replaces it via `processor.buildEntry({...existing})` (`add.ts:611-623`), preserving existing fields. The server exposes `handleRefetchItem` (`server.ts:181`) at `POST /api/collections/:cid/items/:id/refetch` (`server.ts:288`), spawning `add.ts` with `BOARD_UPDATE_ID`. v1 moves this onto the worker + the enrichable/non-enrichable preservation rule.
- **The `enrichable` flag is THE preservation mechanism.** Story 1.2 marked notes/favorite as `enrichable:false`. Refetch overwrites only `enrichable:true` fields. This is cleaner than the prototype's spread-existing approach because it's principled (the descriptor declares what's user-owned).

### Why this design (anti-pattern prevention)

- **Preserve user fields — the whole point (FR-10).** A refetch that wipes the user's notes/favorite is worse than no refetch. The `enrichable:false` fields are sacrosanct across re-enrichment. This is the AC that matters; test it explicitly. [Source: docs/bmad/PRD.md#FR-10, #FR-15]
- **Idempotent — update in place, no duplicates.** Refetch must update the existing item id (not create a new one) and replace its asset (not orphan the old screenshot + add a new one). Tie to Story 6.1's idempotent-capture + Story 1.5's id dedupe. [Source: docs/bmad/stories/6-1-capture-adapter-interface.md]
- **Enrichable flag, not a hardcoded field list.** Don't hardcode "preserve notes and favorite" — preserve whatever the descriptor marks `enrichable:false`. A composed board (Epic 10) with its own user fields gets preservation for free. [Source: docs/bmad/stories/1-2-board-descriptor-seeded-boards.md]
- **Refetch IS the retry path (UJ-2/Story 8.5).** A `status=error` item's "Retry analysis" is a refetch. Reuse, don't build a separate retry. [Source: docs/bmad/epics.md#Story-8.5]

### Project Structure Notes

- `enrichment/refetch.ts` (or a `refetch` skill) + `.test.ts`. Uses capture (Epic 6), enrichment (7.1), descriptor enrichable flag (1.2). UI action in `index.html`.
- ESM `.js` specifiers; `node:test`; mock capture + provider; add the test to the `test` script.

### Testing standards

- Mock capture + mock provider; seed an item with user fields + old enriched fields; assert preservation + update + no-duplicate.
- The preservation assertion (notes/favorite survive) is the load-bearing one.
- Existing suites green (the prototype's refetch tests, if any, should still pass or be migrated).

### References

- [Source: docs/bmad/PRD.md#FR-10] — re-enrich/refetch preserving user-authored fields.
- [Source: docs/bmad/PRD.md#FR-15] — per-item actions; user fields survive re-enrichment.
- [Source: add.ts#611-623] — prototype refetch branch (`BOARD_UPDATE_ID`, replace-by-id, preserve existing) to port.
- [Source: server.ts#181,#288] — `handleRefetchItem` + the refetch route to repoint at the worker.
- [Source: index.html#2048,#2132] — the UI refetch action to rewire.
- [Source: docs/bmad/stories/1-2-board-descriptor-seeded-boards.md] — the `enrichable:false` flag that drives preservation.
- [Source: docs/bmad/stories/6-1-capture-adapter-interface.md] — idempotent capture (no duplicate asset).
- [Source: docs/bmad/stories/7-1-descriptor-driven-enrichment-worker.md] — the enrichment job refetch re-runs.

## Dev Agent Record

### Agent Model Used

_(to be filled by dev agent)_

### Debug Log References

### Completion Notes List

### File List
