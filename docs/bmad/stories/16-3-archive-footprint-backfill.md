# Story 16.3: Archive footprint visibility + backfill

Status: review

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

- [x] **Task 1 — Write the failing size-report test first** (AC: 1, 3)
  - [x] In a new `db/archive-footprint.test.ts` (temp DB + temp snapshots dir): seed two `kind='snapshot'` assets (write small `.html` files) plus one `kind='screenshot'` asset; assert the size reporter returns the SUM of the two snapshot files' bytes (screenshot excluded), and assert the call performs no writes (row counts + file set unchanged before/after). Run; confirm red.
- [x] **Task 2 — Implement snapshot footprint reporting** (AC: 1, 3)
  - [x] Add `archiveFootprint(handle, snapshotsDir): { totalBytes, count }` — select `assets` where `kind='snapshot'`, `stat` each file under `snapshotsDir` (resolve by basename, the Story 2.2 relative-path contract, as `deleteItemWithAssets` does in `db/item-actions.ts#L77`), sum sizes; a missing file contributes 0 (don't throw). Read-only. (Rationale: stat-on-disk over adding a size COLUMN — additive without a migration and always reflects truth even if a file is hand-deleted.) Confirm green.
- [x] **Task 3 — Surface the figure in settings/board info** (AC: 1)
  - [x] Expose the footprint via the existing read surface (e.g. a settings/board-info read route or the config/status surface). Inject-test that the response carries `{ totalBytes, count }`.
- [x] **Task 4 — Write the failing idempotent-backfill test first** (AC: 2, 3)
  - [x] In `db/archive-backfill.test.ts` (temp DB; INJECT a fake snapshot-enqueue that records item ids and a fake that "writes" a snapshot asset row): seed three eligible items (one already has a `kind='snapshot'` asset) on an `archive_on_promote` board, plus one item on a non-eligible board. Run backfill; assert it enqueues for exactly the two eligible-without-snapshot items (skips the already-snapshotted + the non-eligible). Run backfill AGAIN; assert ZERO new enqueues (idempotent by item id). Run; confirm red.
- [x] **Task 5 — Implement the serial backfill** (AC: 2, 3)
  - [x] Add `backfillSnapshots(handle, snapshotsDir, deps)`: query eligible items (boards with `archivesOnPromote`, Story 16.2) that have NO `kind='snapshot'` asset; for each, enqueue the 16.1 snapshot job via `enqueueJob` (concurrency 1 — they drain SERIALLY on the one worker; never spawn parallel Chromium). Idempotency is BY ITEM ID: skip any item that already has a snapshot asset (same predicate that makes 16.1's `${itemId}-snapshot` upsert non-duplicating). Confirm green.
- [x] **Task 6 — Expose backfill as a CLI/route (NOT a skill)** (AC: 2)
  - [x] Wire `backfillSnapshots` to an operator-invokable surface: a small CLI entry (mirroring `db/import-cli.ts`) and/or a REST route — NOT a skill (the v1 skill list is fixed, per Story 8.3). Document that throughput is intentionally slow (serial, one Chrome).
- [x] **Task 7 — No-regression + wire + verify green** (AC: 3, 4)
  - [x] Test: backfill does not touch existing screenshot assets / non-eligible items / item fields. Add new tests to the `test` script; run `npm test`; confirm green + Story 16.1 / 16.2 suites unaffected.

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

### Agent Model Used

claude-opus-4-8 (1M context)

### Debug Log References

- Full suite: **465 pass / 0 fail** (+6 over 16.2: 2 footprint, 3 backfill, 1 footprint-route).

### Completion Notes List

- **Footprint by stat-on-disk, read-only (AC1/AC3).** `archiveFootprint(handle, snapshotsDir)` → `{totalBytes, count}` over `kind='snapshot'` rows only (screenshots excluded), stat by basename under `snapshotsDir` (Story 2.2 contract). Missing file → 0 (never throws). No size column (additive, no migration; always reflects truth even after a hand-delete). The test asserts zero mutation (row count + file set unchanged); surfaced at `GET /api/archive/footprint`.
- **Serial, idempotent-by-item-id backfill (AC2).** `backfillSnapshots` enqueues a snapshot for each eligible (archive-on-promote board) item lacking a `kind='snapshot'` asset, onto the single concurrency-1 worker via `runSnapshotJob`. Idempotency keys on `kind='snapshot'` + `itemId` (independent of the `${id}-snapshot` id format), so a re-run / crash-resume creates zero duplicates — proven by a fake enqueue that writes the snapshot asset row (mirroring 16.1) and a second run asserting zero new enqueues.
- **No-parallel-Chromium is INHERITED, not demonstrated here (honest scope).** The backfill suite uses a synchronous fake enqueue, so it proves the *selection/skip/idempotency* logic, NOT Chrome serialization. The concurrency-1 guarantee comes entirely from `enqueueJob`'s single tail-chain and is proven in `capture/concurrency.test.ts` (a second job's `run` doesn't fire until the first's teardown completes). The story's testing-standards line that implies the backfill test asserts single-slot use overstates it — the implementation is correct, but no-parallel rests on the inherited `enqueueJob` proof.
- **⚠ Cross-process caveat (review — Winston).** The concurrency-1 worker is PER-PROCESS. The `archive:backfill` CLI is a *second* process with its own worker + Chrome; running it while the live server is also capturing would put two Chromiums on the box (the OOM NFR-1 prevents in-process). There is no cross-process lock — the CLI header + console banner now instruct the operator to stop the server first. A PID/port lock is the durable fix (deferred; documented).
- **Backfill is a CLI, not a skill (8.3).** `npm run archive:backfill` (mirrors `import:flat`). It injects a promise-collecting enqueue and `await`s `Promise.allSettled` BEFORE closing the DB, so an early close never aborts in-flight captures (the default enqueue is fire-and-forget; a one-line comment now warns future callers).
- **Review fixes applied (party-mode):** (a) the no-regression backfill test now asserts the snapshot WAS added alongside the untouched screenshot (was vacuously satisfiable if backfill skipped the item); (b) the footprint test writes a real file at the basename a screenshot would resolve to, so the byte total — not just count — catches a kind-filter regression; (c) the cross-process warning + fire-and-forget footgun note. NFR-BC confirmed: backfill is insert-only (reads boards/assets/items, inserts snapshot rows) — never alters screenshots/fields/notes/favorites/non-eligible items.
- **Scope honesty:** the CLI itself is untested (operator glue; matches the untested `import-cli.ts` precedent) — its drain-before-close logic is inspection-verified. The real SingleFile capture remains the 16.1 manual-QA item.

### File List

- `db/archive-footprint.ts` (new) — read-only `archiveFootprint` (stat snapshot files).
- `db/archive-footprint.test.ts` (new) — snapshot-only byte total + zero-mutation + missing-file tests.
- `db/archive-backfill.ts` (new) — `backfillSnapshots` (eligible-without-snapshot → serial enqueue; idempotent by item id).
- `db/archive-backfill.test.ts` (new) — idempotent re-run, skip-snapshotted/ineligible/no-source, no-regression tests.
- `db/archive-backfill-cli.ts` (new) — `npm run archive:backfill` operator runner (awaits the serial drain; server-stop warning).
- `server.ts` (modified) — `GET /api/archive/footprint` route + `snapshotsDir` build option.
- `server.test.ts` (modified) — footprint route test.
- `package.json` (modified) — `archive:backfill` script + both new test files in the `test` script.

### Change Log

- 2026-06-23 — Story 16.3 implemented (TDD). Read-only snapshot footprint (`GET /api/archive/footprint`) + a serial, resumable, idempotent-by-item-id backfill CLI over archive-on-promote items. Additive/read-only (NFR-BC); serialization inherited from the concurrency-1 worker (NFR-1, in-process). Party-mode review applied (non-vacuous no-regression + byte-exclusion tests, cross-process server-stop warning). Epic 16 complete. Suite 465 pass / 0 fail.
