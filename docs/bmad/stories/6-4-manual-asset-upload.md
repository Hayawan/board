# Story 6.4: Manual asset upload

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Epic 6 — Capture & ingest.** Story 4 of 5. Build order: (1) adapter interface → (2) url-screenshot → (3) url-readable → **(4) manual asset upload ◄ this story** → (5) concurrency & timeout. This story lets a user upload a screenshot/image for an item — the graceful path when auto-capture fails. *(FR-5.)*

## Story

As a user whose auto-capture failed,
I want to upload a screenshot/image for an item,
so that I always have a graceful path.

## Acceptance Criteria

1. **Per-item manual upload is an item-scoped asset-write op — NOT routed through the ingest_mode dispatcher.**
   **Given** ANY item (typically on a `url-screenshot`/`url-readable` board whose auto-capture failed), **When** the user uploads an image for it, **Then** it is stored as a file under `screenshotsDir` (Story 2.2) and an `asset` row is created + linked to the item — via an **item-scoped upload route/skill, board-mode-agnostic**. *(The CaptureAdapter `ingest_mode=manual-upload` framing applies ONLY to a board whose descriptor literally is `manual-upload`; the fallback path does NOT flow through the dispatcher — a `url-screenshot` board never resolves to the manual adapter. Don't force the fallback through ingest_mode dispatch.)*

2. **The upload is base64 dataURL (matching the prototype) and validated.**
   **Given** an upload, **When** handled, **Then** the body is a base64 dataURL (`{ dataUrl }`, `data:image/...;base64,...` — the prototype's exact shape, `server.ts:203,217,219`); a non-image or oversized (> 20MB) upload is **rejected with no file written**.

3. **A test asserts the stored file + asset row + the rejection path.**
   **Given** an upload request + an injected temp `screenshotsDir`, **When** handled, **Then** the test asserts the file is written under the temp dir (not the app tree) and the `asset` row exists with the right `path`/`kind`/`hash`; **and** a non-image/oversized upload is rejected and writes nothing.

## Tasks / Subtasks

- [ ] **Task 1 — Write the failing upload tests first (TDD)** (AC: 1, 2)
  - [ ] Create/extend a test (`capture/manual-upload.test.ts` or `server.test.ts`): post an image (base64 dataURL or multipart, matching the prototype) for an item → assert the file lands under the temp `screenshotsDir` + the `asset` row is created/linked. Use an injected temp dir (per Story 2.2's seam).
  - [ ] Run; confirm red.
- [ ] **Task 2 — Implement the item-scoped upload handler (asset-write op)** (AC: 1, 2)
  - [ ] Port the prototype's manual-screenshot write (recon: `handleScreenshot` `server.ts:200`; body `{ dataUrl }` `server.ts:203`; regex `^data:image/[^;]+;base64,(.+)$` `server.ts:217`; `Buffer.from(m[1],"base64")` `server.ts:219`; `fs.writeFileSync` `server.ts:230`; stored `screenshot: relPath` `server.ts:233`). v1: decode the **base64 dataURL**, validate it's an image + within 20MB, write under `config.screenshotsDir` (Story 2.2), compute hash/dims, create an **`asset` row** linked to the item via the typed item-write helper. (Net-new vs the prototype, which only overwrote the item's `screenshot` column for an *existing* item — v1 creates a proper asset row.)
  - [ ] Keep the stored `asset.path` relative (`screenshots/<id>.png`, Story 2.2 contract) so it serves via `/screenshots/`. Reject (no write) on non-image/oversized (AC 2).
- [ ] **Task 3 — Expose it as an item-scoped route/skill (board-mode-agnostic)** (AC: 1)
  - [ ] Either repoint the existing `POST /api/collections/:cid/items/:id/screenshot` (`server.ts:293`) at the new asset-write, or expose an item-scoped `upload-asset` skill (`POST /skills/:name` with `{itemId, dataUrl}`). It is item-scoped, NOT resolved by the board's `ingest_mode`. Document the choice. (Body-limit already 20MB, `server.ts:247`.)
- [ ] **Task 4 — Wire tests + verify green** (AC: 2)
  - [ ] Add the test to the `test` script; run `npm test`; confirm green + existing suites unaffected.

## Dev Notes

### What this story changes vs preserves (read before coding)

- **Ports the prototype's manual-screenshot upload (recon).** `handleScreenshot` (`server.ts:200`) decodes an uploaded image and writes it (`fs.writeFileSync(absPath, buf)`, `server.ts:227-230`), stores `screenshot: relPath` (`server.ts:233`). v1 reroutes the write to `screenshotsDir` (Story 2.2 already enumerated this as one of the 5 screenshot sites) and creates a proper `asset` row.
- **`manual-upload` is a `CaptureAdapter` ingest_mode (Story 6.1).** It has no URL source — it takes an uploaded image. This is exactly why the item model is source-agnostic (Story 6.1 AC2). A board could even seed `ingest_mode: manual-upload`, but primarily this is the *fallback* path for any item whose auto-capture failed.
- **Story 2.2 already moved the write target to `screenshotsDir`** — this story builds on that (don't re-introduce a `__dirname` write).

### Why this design (anti-pattern prevention)

- **Manual upload is the graceful escape hatch (FR-5).** Auto-capture fails (paywalls, bot-walls, dead sites). The user must always be able to attach an image so the item isn't stuck imageless. This is part of the "nothing looks broken" posture (UJ-2). [Source: docs/bmad/PRD.md#FR-5]
- **Store as a proper `asset` row, not a bare path on the item.** v1's model is `item` **0..n** `asset` (architecture §5 — Library items capture 0 assets; an uploaded image adds one). A manual upload is an asset like a captured screenshot — same table, same `/screenshots/` serving. Don't special-case it as an item column. [Source: docs/bmad/architecture.md#5]
- **Validate the upload (size/type).** Accept images only; respect the 20MB body limit (`server.ts:247`). Don't write arbitrary uploaded bytes as an "image" without a basic type check. [Source: server.ts#247]
- **Test against a temp dir.** Story 2.2 added the `screenshotsDir` injection seam precisely so uploads in tests don't pollute the real data dir — use it. [Source: docs/bmad/stories/2-2-data-dir-paths.md]

### Project Structure Notes

- `capture/manual-upload.ts` (+ test) and/or the upload route in `server.ts`. Uses `config.screenshotsDir` (2.2), the typed item-write helper (1.3/1.4), the 6.1 dispatcher.
- ESM `.js` specifiers; `node:test`; add the test to the `test` script.

### Testing standards

- Injected temp `screenshotsDir`; assert file + asset row; never the real data dir.
- Existing suites green (esp. the existing screenshot test, already retrofitted in Story 2.2).

### References

- [Source: docs/bmad/PRD.md#FR-5] — manual asset upload (graceful path when auto-capture fails).
- [Source: server.ts#200,#227-230,#233] — prototype `handleScreenshot` upload write to port.
- [Source: server.ts#247] — 20MB body limit.
- [Source: server.ts#293] — existing screenshot endpoint to repoint or replace.
- [Source: docs/bmad/architecture.md#5] — item 1..n asset model.
- [Source: docs/bmad/stories/2-2-data-dir-paths.md] — `screenshotsDir` + the injection seam + relative-path serving.
- [Source: docs/bmad/stories/6-1-capture-adapter-interface.md] — `manual-upload` as an ingest_mode adapter.

## Dev Agent Record

### Agent Model Used

_(to be filled by dev agent)_

### Debug Log References

### Completion Notes List

### File List
