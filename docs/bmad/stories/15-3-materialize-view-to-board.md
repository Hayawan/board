# Story 15.3: Copy-on-write "materialize view to board"

Status: planned

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Epic 15 — AI board composer (views, not copies).** Story 3 of 3. Build order: (1) view-definition model → (2) composer proposes (assignments and/or a view) → **(3) copy-on-write materialize ◄ this story**. This is the deliberate escape hatch: turn a read-only lens (15.1) into a real, hand-prunable board by **copying** its items (new rows; assets dedupe by hash) — MOVE-free, source untouched. *(Decision D11; NFR-BC.)*
> ⏳ **Pending Hayawan's confirmation of the view-def hinge** (workshop hinge #1): materialize copies *from* the 15.1 lens (filter + optional pin/order in the `view` row). Until confirmed, this story stays `planned`.

## Story

As a user,
I want to turn a composed view into a real board when I want to hand-prune or reorder it,
so that divergence is a deliberate choice I made, not a default the system imposed.

## Acceptance Criteria

1. **Explicit, user-initiated copy.**
   **Given** a saved view (15.1), **When** I choose "materialize," **Then** a **new board** is created and the view's currently-resolved items are **COPIED** into it — each becomes a **new `item` row** (new id, `board_id` = the new board) — and the asset FILES are reused via **hash dedupe** (an existing on-disk file with the same `asset.hash` is not rewritten; a new `asset` row points at it). It is a copy, **not** a move.

2. **Source items and home boards are unchanged (NFR-BC).**
   **Given** materialization completes, **When** I inspect the source, **Then** every source item's `id`, `board_id`, `fields`, `notes`, `favorite`, and asset rows are **byte-for-byte unchanged** — no source item was moved, deleted, or re-pointed. *(NFR-BC, D11)*

3. **Divergence is owned by the copy.**
   **Given** materialization, **When** I later edit a copied item (notes/favorite/fields), **Then** the edit affects **only** the copy — the source item is unaffected (and vice versa). The UI states that the materialized board is now an independent copy that no longer tracks the source view.

4. **Asset hash dedupe (no duplicate bytes, no orphaned files).**
   **Given** copied items whose assets share a file with the source, **When** materialized, **Then** the new `asset` rows reuse the existing file by `hash` (the file is referenced, not re-written / not duplicated on disk) and deleting the materialized board later removes only its own rows (file cleanup respects shared references). *(NFR-1 disk footprint)*

5. **No regression (NFR-BC).**
   **Given** a pre-wave DB, **When** materialize runs, **Then** existing boards/items are untouched and the operation is additive (new board + new item/asset rows only); a boot/regression assertion proves existing data is served unchanged. *(NFR-BC)*

6. **Tests** assert copy (not move) — source count/ids unchanged, new board has its own item rows; hash-dedupe of assets (shared file referenced, not rewritten); source integrity after editing the copy; and the NFR-BC no-regression.

## Tasks / Subtasks

- [ ] **Task 1 — Write the failing materialize tests first (TDD)** (AC: 1, 2, 6)
  - [ ] In a new `db/materialize.test.ts` (or `skills/materialize-view.test.ts`): seed two boards + items + assets; create a view (15.1) spanning them; materialize; assert a NEW board exists with NEW item rows (different ids), and **every source item is unchanged** (snapshot ids/board_id/fields/notes/favorite before, assert equal after).
  - [ ] Run; confirm red.
- [ ] **Task 2 — Implement copy-on-write materialize** (AC: 1, 2, 3)
  - [ ] New `db/materialize.ts` (or a `skills/materialize-view.ts` skill — confirm the v1 skill-list policy before surfacing). `materializeView(handle, viewId, {name}) → {boardId, copied}`:
    - resolve the view's current items via 15.1 `resolveView` (read-only).
    - create the destination board (reuse `insertBoard`, `db/seed.ts:128`; descriptor: a minimal/universal descriptor or a chosen home descriptor — pick one and document it).
    - for each resolved item: write a **new** `item` row (new id, `board_id` = new board, copying `title`/`source`/`fields`/`notes`/`favorite`) via the typed `writeItem` choke-point (`db/queue.ts:160`) so `search_blob`/FTS are built for the copies.
    - **copy is move-free:** never UPDATE a source `item.board_id`; never DELETE a source row.
  - [ ] Test (AC3): edit a copied item's notes → assert the source item's notes are unchanged.
- [ ] **Task 3 — Asset copy with hash dedupe** (AC: 4)
  - [ ] For each copied item's assets: create a **new `asset` row** (new id, `item_id` = the copy) but **reuse the file by `hash`** — if an on-disk file with that `asset.hash` already exists, point the new row's `path` at it rather than re-writing bytes. (`asset.hash` exists at `db/schema.ts:65` and sha256 is computed at `capture/manual-upload.ts:71`; there is **no dedupe helper today** — this story introduces the hash-reuse logic.)
  - [ ] Pass the new assets to `writeItem`'s `itemAssets` arg so they are written atomically with the copied item (`db/queue.ts:160,191-193`).
  - [ ] Test: two items sharing an asset hash → assert the file is referenced (not duplicated on disk); deleting the materialized board (via `deleteItemWithAssets`, `db/item-actions.ts:63`) does not unlink a file still referenced by a source item.
- [ ] **Task 4 — Wire tests + verify green** (AC: 5, 6)
  - [ ] Add the NFR-BC boot/regression assertion (pre-wave DB served unchanged after materialize; extend `db/seed.test.ts`); append the test to the `test` script; run `npm test`; confirm green + existing suites unaffected.

## Dev Notes

### What this story changes vs preserves (read before coding)

- **Materialize COPIES; it never moves.** New `item` rows (new ids, new `board_id`); the source `item.board_id` is never touched. This is the deliberate D11 escape hatch — the ONLY place in Epic 15 that duplicates items, and it does so explicitly on user action. [Source: docs/bmad/epics-v2.md#L228-237]
- **Source integrity is the whole point.** A view is canonical-by-reference; materialize forks a copy *on purpose* so the user can hand-prune without disturbing the source. AC2/AC3 assert the source is byte-unchanged and divergence is one-directional. [Source: docs/bmad/epics-v2.md#L235-236]
- **Asset dedupe by hash is INTRODUCED here.** The `asset.hash` column exists (`db/schema.ts:65`) and sha256 is computed on upload (`capture/manual-upload.ts:71`), but **nothing dedupes on it today** (`writeItemDirect` replaces a single item's assets, `db/queue.ts:191-193`; ids are item-scoped). This story adds the hash-reuse: a copied asset row references the existing file instead of rewriting bytes. [Source: db/schema.ts#L56-67, capture/manual-upload.ts#L71, db/queue.ts#L191-193]
- **Reuse the write choke-point + the board-insert primitive.** Copies go through `writeItem` (`db/queue.ts:160`) so FTS/`search_blob` are built; the destination board is created via the shared `insertBoard` (`db/seed.ts:128`) — no forked write paths. [Source: db/queue.ts#L146-196, db/seed.ts#L122-134]

### Why this design (anti-pattern prevention)

- **Copy, not move (D11/D12).** If materialize MOVED items, it would re-point `item.board_id` and rob the source view (and break the single-home invariant). Materialize is the one sanctioned duplication, and it leaves the source intact. [Source: docs/bmad/epics-v2.md#L48, docs/bmad/epics-v2.md#L228-236]
- **Hash dedupe protects the small box (NFR-1).** Copying screenshot/asset bytes per materialize would balloon disk on a 512MB–1GB LXC. Reuse the file by hash; only the lightweight `asset`/`item` rows are new. [Source: docs/bmad/epics-v2.md#L234, db/queue.ts#L51-52]
- **Shared-file delete safety.** Because a file may now be referenced by both a source asset and a materialized copy, delete-cleanup must not unlink a still-referenced file. The existing `deleteItemWithAssets` unlinks by basename (`db/item-actions.ts:63`) — materialize's dedupe must keep that safe (assert it). [Source: db/item-actions.ts#L57-84]
- **Divergence is owned, and the UI says so.** Post-materialize the copy is independent; surfacing that prevents the "why didn't my edit show up in the source?" confusion. [Source: docs/bmad/epics-v2.md#L236]

### Project Structure Notes

- New `db/materialize.ts` (or `skills/materialize-view.ts` if surfaced as a skill — **confirm the fixed v1 skill-list policy** in Story 8.3 / architecture §4.1 before widening the skill surface).
- Reuses: 15.1 `resolveView` (read-only resolve), `insertBoard` (`db/seed.ts:128`), `writeItem` + `itemAssets` (`db/queue.ts:160,191-193`), `asset.hash` (`db/schema.ts:65`).
- ESM `.js` specifiers; `node:test` + temp DB + temp `screenshotsDir`; add the test to the `test` script.

### Testing standards

- Temp DB + temp `screenshotsDir`. The load-bearing assertions: **copy not move** (source ids/`board_id` unchanged; new board has distinct item rows), **hash dedupe** (shared file referenced, not rewritten — assert the file is not duplicated and the bytes weren't rewritten), **source integrity** (editing the copy leaves the source untouched), and **NFR-BC** boot/regression.
- The asset-file behavior is what naive copies get wrong — assert both no-duplicate-on-disk AND no-unlink-of-a-still-referenced-file.

### References

- [Source: docs/bmad/epics-v2.md#L228-237] — Story 15.3 ACs (explicit copy, source preserved, divergence owned, hash-dedupe).
- [Source: docs/bmad/epics-v2.md#L48] — D11 copy-on-write "materialize view to board" escape hatch.
- [Source: docs/bmad/epics-v2.md#L24-32] — NFR-BC (additive; existing data untouched; boot/regression test).
- [Source: docs/bmad/stories/15-1-view-definition-model.md] — the `view` + `resolveView` this story reads from (read-only) to get the items to copy.
- [Source: db/schema.ts#L56-67] — the `asset` table + `hash` column (the dedupe key).
- [Source: capture/manual-upload.ts#L71] — sha256 hash compute site (the hash format dedupe matches); no dedupe helper exists yet.
- [Source: db/queue.ts#L146-196] — `writeItem`/`writeItemDirect` choke-point (search_blob/FTS + atomic `itemAssets` replace) the copies must flow through.
- [Source: db/seed.ts#L122-134] — `insertBoard` shared board-insert primitive for the destination board.
- [Source: db/item-actions.ts#L57-84] — `deleteItemWithAssets` (basename file unlink) — the shared-file delete-safety constraint.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

### Change Log
