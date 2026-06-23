# Story 16.3: Archive footprint visibility + backfill

Status: draft

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Epic 16 — Meaning-preserving archival.** Story 3 of 3. Build order: (1) snapshot asset kind → (2) opt-in archival trigger → **(3) footprint visibility + backfill ◄ this story**. This story surfaces total snapshot disk usage and adds a serial, resumable backfill so existing curated items can be archived on demand — through the single concurrency-1 sidecar, idempotent by item id, so "no storage limit" never becomes a silent surprise. *(D13, NFR-1, NFR-BC.)*

## Story

As a self-hoster,
I want to see how much disk archives use and backfill on demand,
so that "no storage limit" never becomes a silent surprise.

## Acceptance Criteria

1. **Total archive size surfaced.**
   **Given** snapshot assets exist, **When** I view settings/board info, **Then** total snapshot disk usage is shown — computed over `kind='snapshot'` assets only (their `.html` files under the snapshots dir), so screenshots and other assets are excluded from the archive footprint figure.

2. **Serial backfill command (resumable, idempotent by item id).**
   **Given** existing curated items eligible for archival (opted-in boards / per Story 16.2), **When** I run a backfill, **Then** snapshots are created SERIALLY through the single sidecar (`enqueueJob`, concurrency 1 — accepting slow throughput; NEVER parallel Chromium), and the backfill is resumable/idempotent by item id: re-running it skips items that ALREADY have a `kind='snapshot'` asset, so no duplicate snapshots are created.

3. **No-regression (NFR-BC).**
   **Given** existing items and assets, **When** size-reporting reads or the backfill runs, **Then** size-reporting MUTATES nothing, and the backfill only ADDS snapshot assets to eligible items — it never alters existing screenshot assets, item rows, fields, notes, favorites, or non-eligible items.

4. **Tests** assert: size reporting (snapshot-only total; reading mutates nothing) and idempotent backfill (a second run creates zero new snapshots; non-eligible/already-snapshotted items are skipped; no parallel Chromium).

## Tasks / Subtasks

- [ ] **Task 1 — Write the failing size-report test first** (AC: 1, 3)
  - [ ] In a new `db/archive-footprint.test.ts` (temp DB + temp snapshots dir): seed two `kind='snapshot'` assets (write small `.html` files) plus one `kind='screenshot'` asset; assert the size reporter returns the SUM of the two snapshot files' bytes (screenshot excluded), and assert the call performs no writes (row counts + file set unchanged before/after). Run; confirm red.
- [ ] **Task 2 — Implement snapshot footprint reporting** (AC: 1, 3)
  - [ ] Add `archiveFootprint(handle, snapshotsDir): { totalBytes, count }` — select `assets` where `kind='snapshot'`, `stat` each file under `snapshotsDir` (resolve by basename, the Story 2.2 relative-path contract, as `deleteItemWithAssets` does in `db/item-actions.ts#L77`), sum sizes; a missing file contributes 0 (don't throw). Read-only. (Rationale: stat-on-disk over adding a size COLUMN — additive without a migration and always reflects truth even if a file is hand-deleted.) Confirm green.
- [ ] **Task 3 — Surface the figure in settings/board info** (AC: 1)
  - [ ] Expose the footprint via the existing read surface (e.g. a settings/board-info read route or the config/status surface). Inject-test that the response carries `{ totalBytes, count }`.
- [ ] **Task 4 — Write the failing idempotent-backfill test first** (AC: 2, 3)
  - [ ] In `db/archive-backfill.test.ts` (temp DB; INJECT a fake snapshot-enqueue that records item ids and a fake that "writes" a snapshot asset row): seed three eligible items (one already has a `kind='snapshot'` asset) on an `archive_on_promote` board, plus one item on a non-eligible board. Run backfill; assert it enqueues for exactly the two eligible-without-snapshot items (skips the already-snapshotted + the non-eligible). Run backfill AGAIN; assert ZERO new enqueues (idempotent by item id). Run; confirm red.
- [ ] **Task 5 — Implement the serial backfill** (AC: 2, 3)
  - [ ] Add `backfillSnapshots(handle, snapshotsDir, deps)`: query eligible items (boards with `archivesOnPromote`, Story 16.2) that have NO `kind='snapshot'` asset; for each, enqueue the 16.1 snapshot job via `enqueueJob` (concurrency 1 — they drain SERIALLY on the one worker; never spawn parallel Chromium). Idempotency is BY ITEM ID: skip any item that already has a snapshot asset (same predicate that makes 16.1's `${itemId}-snapshot` upsert non-duplicating). Confirm green.
- [ ] **Task 6 — Expose backfill as a CLI/route (NOT a skill)** (AC: 2)
  - [ ] Wire `backfillSnapshots` to an operator-invokable surface: a small CLI entry (mirroring `db/import-cli.ts`) and/or a REST route — NOT a skill (the v1 skill list is fixed, per Story 8.3). Document that throughput is intentionally slow (serial, one Chrome).
- [ ] **Task 7 — No-regression + wire + verify green** (AC: 3, 4)
  - [ ] Test: backfill does not touch existing screenshot assets / non-eligible items / item fields. Add new tests to the `test` script; run `npm test`; confirm green + Story 16.1 / 16.2 suites unaffected.

## Dev Notes

### What this story changes vs preserves (read before coding)

- **Adds READ-ONLY footprint reporting + an additive backfill** — no schema change, no item reshape. Footprint = `stat` over `kind='snapshot'` files; backfill = ADD snapshot assets to eligible items that lack one. Existing screenshot assets, item rows, and non-eligible items are untouched.
- **Backfill reuses the 16.1 snapshot job and the 16.2 eligibility rule.** It is a batch driver, not a new capture path: same `enqueueJob` concurrency-1 worker, same `archivesOnPromote` predicate, same additive `${itemId}-snapshot` write. No parallel Chromium.
- **Idempotency is by item id** — the same property that makes 16.1's snapshot write a single-row upsert. Re-running backfill is safe and resumable: a crash mid-run leaves already-snapshotted items, which the next run skips.

### Why this design (anti-pattern prevention)

- **Footprint by stat-on-disk, not a new size column.** The `asset` table has `hash` but NO byte-size column (`db/schema.ts#L56-67`). `stat`ing the snapshot files is additive (no migration) and always reflects truth even if files are hand-deleted. (A nullable size column is the alternative — also additive — but stat avoids drift.) [Source: db/schema.ts#L56-67]
- **Serial backfill — NEVER parallel Chromium (NFR-1).** The temptation on a big backfill is to parallelize for speed; that OOMs the 512MB-1GB box (two Chromiums coexist). Backfill enqueues every item onto the SAME concurrency-1 worker (`enqueueJob`); slow-but-safe is the explicit accepted trade. [Source: db/queue.ts#L43-51, db/queue.ts#L91, docs/bmad/epics-v2.md#L277]
- **Idempotent by item id (resumable).** Skip items that already have a `kind='snapshot'` asset; re-runs create zero duplicates. This mirrors the importer's idempotent re-import (Story 1.5) and the per-item id keying throughout the queue. A duplicate-snapshot bug would silently double disk on the small box. [Source: docs/bmad/stories/16-1-snapshot-asset-singlefile.md]
- **Read-only reporting mutates nothing (NFR-BC).** Surfacing a number must never write. Assert zero mutation in the test. [Source: docs/bmad/epics-v2.md#L24-32]
- **Backfill is a CLI/route, not a skill.** The v1 skill list is fixed (Story 8.3); operator/maintenance commands are CLI/REST, like `db/import-cli.ts`. [Source: docs/bmad/stories/8-3-per-item-actions.md, db/import-cli.ts]

### Project Structure Notes

- New: `db/archive-footprint.ts` (read-only `archiveFootprint`) + `db/archive-footprint.test.ts`; `db/archive-backfill.ts` (`backfillSnapshots`) + `db/archive-backfill.test.ts`; a small CLI entry (pattern of `db/import-cli.ts`) and/or a REST route + the settings/board-info read surface for the figure.
- Reuses: the 16.1 snapshot job (`enqueueJob`, additive snapshot write), the 16.2 `archivesOnPromote` eligibility reader, the Story 2.2 relative-path / `snapshotsDir` resolution (as `db/item-actions.ts#L63-84` resolves screenshot files).
- ESM `.js` specifiers; `node:test`; inject the snapshot-enqueue + snapshot-writer into the backfill so tests assert enqueue/skip behavior without launching Chrome.

### Testing standards

- Footprint: temp DB + temp snapshots dir; seed snapshot + screenshot assets; assert snapshot-only byte total and zero mutation (row counts + file set unchanged).
- Backfill idempotency is the load-bearing test: run twice, assert the second run enqueues nothing; seed an already-snapshotted item and a non-eligible-board item and assert both are skipped.
- Assert no parallel Chromium: backfill enqueues onto the single worker (the concurrency-1 guarantee is `enqueueJob`'s, proven in `capture/concurrency.test.ts`); the backfill test asserts serial enqueue ordering / single-slot use via the injected fake.

### References

- [Source: docs/bmad/epics-v2.md#L270-278] — Story 16.3 ACs (total size surfaced, serial resumable/idempotent backfill, tests).
- [Source: docs/bmad/epics-v2.md#L50] — D13 (footprint caps, opt-in, curated-tier).
- [Source: docs/bmad/epics-v2.md#L24-32] — NFR-BC no-regression wave constraint (read-only reporting; additive backfill).
- [Source: db/schema.ts#L56-67] — the `asset` table (no size column → footprint via stat-on-disk).
- [Source: db/queue.ts#L43-51,#L91] — the concurrency-1 worker the backfill drains through (no parallel Chromium).
- [Source: db/item-actions.ts#L63-84] — relative-path resolution under the assets dir (the pattern footprint stat reuses; Story 2.2 contract).
- [Source: db/import-cli.ts] — the CLI-entry pattern the backfill command mirrors (operator command, not a skill).
- [Source: docs/bmad/stories/16-1-snapshot-asset-singlefile.md] — the snapshot job + the `${itemId}-snapshot` additive write that makes backfill idempotent by item id.
- [Source: docs/bmad/stories/16-2-opt-in-archival-trigger.md] — the `archivesOnPromote` eligibility rule the backfill applies.

## Dev Agent Record
