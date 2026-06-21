# Story 8.3: Per-item actions (notes, favorite, delete)

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Epic 8 — Boards experience.** Story 3 of 6. Build order: (1) switcher/views/modal → (2) filters → **(3) per-item actions ◄ this story** → (4) optimistic save → (5) degraded → (6) first-run. This story lets a user annotate (notes), favorite, and delete items — the curation actions. *(FR-15.)*

## Story

As a user,
I want to annotate, favorite, and delete items,
so that I can curate.

## Acceptance Criteria

1. **Edit notes persists.**
   **Given** an item, **When** I edit its notes, **Then** the change persists (PATCH) and survives reload.

2. **Toggle favorite persists.**
   **Given** an item, **When** I toggle favorite, **Then** the change persists.

3. **Delete removes the item AND its assets.**
   **Given** an item, **When** I delete it, **Then** the item is removed AND its asset files (screenshots) are deleted — no orphaned files.

4. **A disallowed PATCH field does not take effect.**
   **Given** a PATCH carrying a non-allowlisted field (e.g. `status` or an enriched field), **When** handled, **Then** that field is **unchanged** (the prototype silently ignores unknown keys, `server.ts:128-143` — keep silent-ignore OR reject, but pick one and test it; don't leave it untested either way).

5. **Tests cover each via the API.**
   **Given** the server, **When** the tests `inject()` a notes PATCH, a favorite toggle, a delete, and a disallowed-field PATCH, **Then** they assert each persists/removes correctly, asset-file cleanup on delete (assert the file is gone from the temp `screenshotsDir` for a NON-grid item — the prototype's grid-only bug), and the disallowed field unchanged (AC 4).

## Tasks / Subtasks

- [ ] **Task 1 — Write the failing action tests first (TDD)** (AC: 1, 2, 3, 4)
  - [ ] In `server.test.ts`: seed an item (temp DB) with an asset; PATCH notes → assert persisted; PATCH favorite → assert toggled; DELETE → assert item gone AND its asset file removed from the temp `screenshotsDir`. (Snapshot/restore or temp DB so the suite stays clean.)
  - [ ] Run; confirm red.
- [ ] **Task 2 — Implement notes/favorite PATCH (allowlisted user fields)** (AC: 1, 2)
  - [ ] Generalize the prototype's `handlePatchItem` (`server.ts:119`, allowlists reflection/favorite/favorite_reason/notes) to the v1 DB: PATCH updates the `enrichable:false` user fields on the item via the typed item-write helper (so `search_blob` refreshes — notes are searchable). Allowlist to user fields only (don't let a PATCH overwrite enriched/system fields).
- [ ] **Task 3 — Implement delete + asset cleanup** (AC: 3)
  - [ ] Generalize `handleDeleteItem` (`server.ts:151`, deletes the screenshot file only for `view:"grid"`). v1: delete the item row + cascade-delete its `asset` rows AND unlink the asset files from `screenshotsDir` (resolve via the relative path, Story 2.2). Do this for any board (not just grid) — any item may have an uploaded asset (Story 6.4). FK cascade (Story 1.1) handles the rows; the file unlink is explicit.
- [ ] **Task 4 — Keep notes/favorite/delete as item REST endpoints** (AC: 1)
  - [ ] Per architecture §4.1, the v1 skill list is FIXED (import-bookmarks, create-board, add-item, generate-fields, tag, compose-board) and does NOT include notes/favorite/delete — so these stay REST: `PATCH /api/collections/:cid/items/:id` (`server.ts:278`) + `DELETE` (`server.ts:283`), repointed at the v1 DB. (Tags go through the `tag` skill from Story 3.4.) Not a coin-flip — REST is correct here.
- [ ] **Task 5 — Wire tests + verify green** (AC: 4)
  - [ ] Add the test to the `test` script; run `npm test`; confirm green + existing suites unaffected.

## Dev Notes

### What this story changes vs preserves (read before coding)

- **Generalizes the prototype's item actions (recon).** `handlePatchItem` (`server.ts:119`, allowlist reflection/favorite/favorite_reason/notes), `handleDeleteItem` (`server.ts:151`, screenshot-unlink only for grid). v1 moves these to the DB + makes them board-agnostic.
- **Notes/favorite are `enrichable:false` user fields (Story 1.2).** They're preserved across re-enrich (Story 7.3). PATCH writes them via the typed item-write helper so `search_blob` refreshes (notes are searchable, Story 1.4).
- **Delete must clean up asset FILES, not just rows.** The FK cascade (Story 1.1) removes `asset` rows; the screenshot files on disk must be explicitly unlinked (resolve relative path under `screenshotsDir`, Story 2.2). The prototype only unlinks for grid boards — v1 unlinks for any board (Library items can have uploaded assets, Story 6.4).

### Why this design (anti-pattern prevention)

- **Allowlist user fields on PATCH (FR-15).** A PATCH must only touch user-owned fields (notes/favorite/favorite_reason) — never let it overwrite enriched or system fields. The prototype allowlists; preserve that. [Source: server.ts#119, docs/bmad/PRD.md#FR-15]
- **Delete cleans up files (no orphans).** Deleting the row but leaving the screenshot file leaks disk on the small box. Cascade rows + unlink files. [Source: server.ts#151, docs/bmad/PRD.md#NFR-1]
- **PATCH through the typed write (search_blob refresh).** Editing notes must refresh `search_blob` so the note is searchable (Story 1.4) — go through the typed item-write, not a raw UPDATE. [Source: docs/bmad/stories/1-4-fts5-search-blob.md]
- **Board-agnostic.** Don't gate delete-cleanup on `view==='grid'` (the prototype's limitation) — any item may have an asset. [Source: server.ts#151, docs/bmad/stories/6-4-manual-asset-upload.md]

### Project Structure Notes

- Server handlers in `server.ts` (generalize PATCH/DELETE); the typed item-write (1.4) for notes; asset cleanup against `screenshotsDir` (2.2).
- ESM `.js` specifiers; `node:test` + `inject()`; add the test to the `test` script.

### Testing standards

- Temp DB + temp `screenshotsDir`; assert PATCH persists, favorite toggles, DELETE removes row + unlinks file.
- The asset-file cleanup on delete is the one naive implementations miss — assert the file is gone.
- Existing `server.test.ts` covers the current PATCH/DELETE — extend, keep green.

### References

- [Source: docs/bmad/PRD.md#FR-15] — per-item actions: notes, favorite, delete; user fields survive re-enrich.
- [Source: server.ts#119,#151] — `handlePatchItem` (allowlist) + `handleDeleteItem` (screenshot unlink) to generalize.
- [Source: server.ts#278,#283] — the PATCH/DELETE routes.
- [Source: docs/bmad/stories/1-4-fts5-search-blob.md] — typed item-write so notes refresh search_blob.
- [Source: docs/bmad/stories/2-2-data-dir-paths.md] — `screenshotsDir` for asset-file cleanup.
- [Source: docs/bmad/stories/6-4-manual-asset-upload.md] — any board can have an uploaded asset (cleanup applies broadly).

## Dev Agent Record

### Agent Model Used

_(to be filled by dev agent)_

### Debug Log References

### Completion Notes List

### File List
