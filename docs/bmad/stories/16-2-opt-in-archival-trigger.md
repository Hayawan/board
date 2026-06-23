# Story 16.2: Opt-in archival trigger (curated-tier)

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Epic 16 — Meaning-preserving archival.** Story 2 of 3. Build order: (1) snapshot asset kind → **(2) opt-in archival trigger ◄ this story** → (3) footprint visibility + backfill. This story makes archival OPT-IN and tied to curated-tier promotion (per-board "archive on promote" flag and/or a per-item "archive this" action), so the snapshot (16.1) fires on what the user curated — never on every bucket link — and the AI takeaway is preserved alongside it. *(D13, NFR-1, NFR-BC.)*

## Story

As a user,
I want archival to be opt-in and tied to promotion,
so that my small box archives what I curated, not every bucket link.

## Acceptance Criteria

1. **Off by default.**
   **Given** a fresh install (no archival flags set), **When** items are captured to the Inbox, **Then** NO snapshots are taken — the cheap capture path (Epic 13/14) is unchanged and no 16.1 snapshot job is enqueued.

2. **Per-board and/or per-item opt-in fires the snapshot.**
   **Given** a board flagged "archive on promote" (an additive, default-off descriptor flag) OR a per-item "archive this" action, **When** an item is assigned/promoted to that board (the one assign verb, Story 14.2) or the per-item action is invoked, **Then** the snapshot job (16.1) is **enqueued** for that item (and only that item).

3. **Takeaway preserved with it (the differentiator).**
   **Given** an archived item, **When** snapshotted, **Then** the AI takeaway already lives on the item as its `enrichable:true` fields in `item.fields` (the earned tier, Story 14.1/`enrichment/worker.ts`); the snapshot asset sits ALONGSIDE that takeaway on the same item (coexistence, not a copy) — so what survives link-rot is *why it mattered*, not just the bytes.

4. **No-regression: enabling archival never alters non-opted items (NFR-BC).**
   **Given** existing items in existing boards that were NOT opted in, **When** archival is enabled (a board flag flips, or the feature ships), **Then** those items are NOT snapshotted, NOT re-enriched, and NOT otherwise altered; existing board descriptors WITHOUT the new flag remain valid and default to archival OFF.

5. **Tests** assert: default-off (capture to Inbox → no snapshot enqueued), the opt-in trigger (board flag + per-item action → snapshot enqueued for exactly that item), takeaway-pairing (the item's enrichable fields are intact and coexist with the snapshot asset), and the no-regression (a flag flip does not touch pre-existing non-opted items / descriptors without the flag validate and read as off).

## Tasks / Subtasks

- [x] **Task 1 — Write the failing descriptor-flag test first (additive, default-off)** (AC: 1, 4)
  - [x] In `descriptor/types.test.ts` (or the descriptor test file): assert an EXISTING descriptor JSON (no archive flag) still validates via `validateDescriptor`, and a helper reads "archive on promote" as `false` when the flag is absent. Then assert a descriptor WITH the optional flag set to `true` validates and reads `true`. Run; confirm red.
- [x] **Task 2 — Add the additive opt-in flag** (AC: 2, 4)
  - [x] Extend `BoardDescriptorSchema` (`descriptor/types.ts#L76-81`) with an OPTIONAL `archive_on_promote: z.boolean().optional()` (default-off when absent) — additive; existing closed descriptors stay valid. Add a tiny reader (e.g. `archivesOnPromote(descriptor): boolean` defaulting to `false`). Confirm green. (Rationale for descriptor-flag over a new column: the descriptor is the board's behavior contract, schema-as-data AD9; archival policy is board behavior.)
- [x] **Task 3 — Write the failing assign-trigger test first** (AC: 2, 3)
  - [x] In the assign-endpoint test (Story 14.2's suite): seed a board with `archive_on_promote:true` and an earned-tier-enriched item; assign the item; assert a snapshot job is ENQUEUED for that item id (inject a fake snapshot-enqueue so no real Chrome runs), and assert the item's `enrichable:true` fields (the takeaway) are still present after assign (coexistence). Add a control: a board WITHOUT the flag → NO snapshot enqueued. Run; confirm red.
- [x] **Task 4 — Trigger the snapshot from the assign verb (post-earned-enrichment)** (AC: 2, 3)
  - [x] In the assign path (Story 14.2, `POST /api/v1/items/assign`), AFTER the earned-tier enrichment fires and the item is `done`, if the target board `archivesOnPromote(descriptor)`, enqueue the 16.1 snapshot job for that item. Inject the snapshot-enqueue fn so the assign path stays unit-testable and the snapshot is concurrency-1-serialized on the worker (16.1). Do NOT block the assign response on the snapshot completing (it degrades gracefully, 16.1 AC4).
- [x] **Task 5 — Per-item "archive this" action** (AC: 2)
  - [x] Write the failing test first: invoking the per-item archive action on a curated item enqueues exactly one snapshot job for that item; on an unknown item → 404 / no-op. Then implement as a REST action (NOT a skill — the v1 skill list is fixed, per Story 8.3): e.g. `POST /api/v1/items/:id/archive`, enqueuing the 16.1 job. Confirm green.
- [x] **Task 6 — Default-off + no-regression tests, wire + verify green** (AC: 1, 4, 5)
  - [x] Test: capturing to the Inbox (no flag) enqueues NO snapshot. Test: flipping a board's flag does NOT retroactively snapshot or alter its existing items. Test: a pre-wave descriptor (no flag) validates and reads archival off.
  - [x] Add new tests to the `test` script; run `npm test`; confirm green + Story 14.2 / descriptor suites unaffected.

## Dev Notes

### What this story changes vs preserves (read before coding)

- **Adds an OPTIONAL `archive_on_promote` flag** to `BoardDescriptorSchema` (`descriptor/types.ts#L76-81`). The schema is a CLOSED zod object (`fields`/`enrichment_prompt`/`view`/`ingest_mode`); the addition is `.optional()` so EVERY existing descriptor still validates and defaults to archival OFF. No column, no migration. *(Chosen over a new `board` column because archival-on-promote is board BEHAVIOR — schema-as-data, AD9.)*
- **Hooks the snapshot into the EXISTING assign verb (Story 14.2), not a new path.** Promotion already fires the earned-tier takeaway (`enrichment/worker.ts`, Story 14.1); archival is an additive post-step on that same one verb. The assign FK-move + earned enrichment are UNCHANGED.
- **The takeaway is NOT copied or moved.** It already lives as `enrichable:true` fields in `item.fields` (Story 14.1). "Preserved alongside" = the snapshot asset coexists with those fields on the same item row. No new takeaway storage.
- **Preserves non-opted items.** A board with no flag, and every pre-existing item, is never snapshotted. Enabling the flag is forward-only (it affects future promotions, not a retroactive sweep — that's Story 16.3's explicit, opt-in backfill).

### Why this design (anti-pattern prevention)

- **Off by default is the whole point (D13, NFR-1).** Archiving every bucket link would blow the small box's disk and waste the one Chrome slot on churn. Archival is gated on curated-tier promotion (the item earned a purpose) or an explicit per-item action. The default-off test is first-class. [Source: docs/bmad/epics-v2.md#L264, docs/bmad/epics-v2.md#L50]
- **Additive, optional flag (NFR-BC).** A required field on the closed descriptor schema would invalidate every existing board. `.optional()` + a defaulting reader keeps pre-wave descriptors valid and archival off. [Source: descriptor/types.ts#L76-81, docs/bmad/epics-v2.md#L24-32]
- **One assign verb (D8).** The composer and manual promote share the same assign endpoint (Story 14.2); hooking archival there means both inherit it with no second code path. [Source: docs/bmad/epics-v2.md#L45, docs/bmad/epics-v2.md#L156]
- **Takeaway is meaning, not bytes — and it already exists.** The differentiator is that the snapshot pairs with the earned takeaway already on the item; don't re-store or fork it. [Source: enrichment/worker.ts#L88-125, docs/bmad/epics-v2.md#L266]
- **Per-item archive is REST, not a skill.** The v1 skill list is fixed (Story 8.3) and excludes archival actions — so "archive this" is a REST action, like notes/favorite/delete. [Source: docs/bmad/stories/8-3-per-item-actions.md]
- **Don't block on the snapshot.** Assign returns immediately; the snapshot is enqueued and degrades gracefully (16.1 AC4) — a slow/failed archival never stalls the promote UX. [Source: docs/bmad/stories/16-1-snapshot-asset-singlefile.md]

### Project Structure Notes

- Modified: `descriptor/types.ts` (additive optional `archive_on_promote` + `archivesOnPromote` reader); the assign path (Story 14.2 server route) to enqueue the snapshot post-enrichment.
- New REST action for the per-item "archive this" (e.g. `POST /api/v1/items/:id/archive`) — sibling to the per-item actions of Story 8.3, NOT a skill.
- Reuses: the 16.1 snapshot job (injected enqueue fn for testability); the earned-tier enrichment already on the item (`enrichment/worker.ts`).
- ESM `.js` specifiers; `node:test` + `inject()` for the routes; inject the snapshot-enqueue so tests never launch real Chrome.

### Testing standards

- Inject the snapshot-enqueue fn into the assign path + the per-item action so tests assert "a job was enqueued for item X" WITHOUT running Chrome.
- Default-off is the first-class test: capture to Inbox → assert zero snapshot enqueues.
- No-regression: assert a pre-wave descriptor (no flag) validates and reads off; assert flipping a board flag does not enqueue snapshots for that board's PRE-EXISTING items.
- Takeaway-pairing: after assign, assert the item's `enrichable:true` field values are unchanged (the snapshot coexists, never overwrites).

### References

- [Source: docs/bmad/epics-v2.md#L258-268] — Story 16.2 ACs (off-by-default, per-board/per-item opt-in, takeaway-paired, no-regression, tests).
- [Source: docs/bmad/epics-v2.md#L50] — D13 (opt-in, curated-tier).
- [Source: docs/bmad/epics-v2.md#L24-32] — NFR-BC no-regression wave constraint.
- [Source: docs/bmad/epics-v2.md#L156-181] — Epic 14 / the one assign verb (Story 14.2) the trigger hooks into; earned-tier enrichment on assignment.
- [Source: descriptor/types.ts#L76-81] — `BoardDescriptorSchema` (closed zod object) the optional flag extends additively.
- [Source: descriptor/types.ts#L24-43] — closed field-type set + SYSTEM_COLUMNS (why archival policy is a board flag, not a field).
- [Source: enrichment/worker.ts#L88-125] — `runEnrichmentForItem` writes the earned `enrichable:true` takeaway into `item.fields` (what the snapshot pairs with).
- [Source: docs/bmad/stories/16-1-snapshot-asset-singlefile.md] — the snapshot job this story triggers (concurrency-1, status-neutral, graceful).
- [Source: docs/bmad/stories/8-3-per-item-actions.md] — per-item actions are REST, not skills (the v1 skill list is fixed).

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (1M context)

### Debug Log References

- Full suite: **459 pass / 0 fail** (+11 over 16.1: 3 descriptor-flag, 3 assign-trigger, 1 batch, 4 v1-route incl. 422).

### Completion Notes List

- **Additive, default-off descriptor flag (AC1/AC4).** `archive_on_promote?: boolean` added to `BoardDescriptorSchema` (`.optional()`) + `archivesOnPromote(d)` reader (`=== true`, so null/undefined/absent → OFF). No column, no migration — the descriptor is a single JSON blob. Pre-wave descriptors validate unchanged and read archival off (tested).
- **Hooked into the ONE assign verb (D8), forward-only.** The trigger lives in `assignItems` (so the future composer 15.2 inherits it with no second path): after the moves + earned-enrich jobs, if `archivesOnPromote(target.descriptor)`, enqueue a snapshot for each MOVED id (never skipped/notFound/failed — only `assigned` is iterated). Enabling a board's flag affects only future promotions — it never retroactively sweeps existing items (that's 16.3). Implication flagged in review: a flagged bulk-promote becomes N snapshot jobs (serialized, graceful) — acceptable, it's per-board opt-in + the composer is an explicit user action.
- **Per-item "archive this" is REST, not a skill (8.3).** `POST /api/v1/items/:id/archive` (inside the bearer-guarded v1 plugin): 404 unknown, 422 no-source (a manual-upload item has no URL to snapshot), 202 `{queued:true}` — never blocks on the capture.
- **Takeaway coexistence is the differentiator (AC3).** The earned takeaway lives in `item.fields`; the snapshot lands in the separate `asset` table — disjoint state. The move preserves fields by construction; the snapshot job is status-neutral and writes only an asset row. **Review fix (Quinn):** the coexistence test now uses a real spy-LLM earned enrichment (writes `summary` into fields) rather than a hand-seeded field under `disabledLlm`, so it proves the *enrichment-written* takeaway survives alongside the snapshot trigger — crossing the actual enrich+trigger seam.
- **Fire-and-forget, serialized, graceful.** `enqueueSnapshot` is injectable (tests pass a spy → no Chrome); the default `void runSnapshotJob(...)` resolves-never-rejects (16.1 swallows all failures), so the un-awaited call leaks no unhandled rejection. The snapshot enqueues synchronously after the enrich jobs, so it serializes behind them on the concurrency-1 worker.
- **Review fixes applied (party-mode):** (a) AC3 test strengthened to the real earned-enrichment path; (b) added a multi-item batch test (exactly the moved items archived, skipped one not); (c) added the 422 no-source route test. Reviewers confirmed no double-fire (ids de-duped), no wrong-board (single resolved target), and forward-only no-regression. The duplicated default `enqueueSnapshot` closure (assign.ts + v1.ts) was left as intentional defense-in-depth so `assignItems` stays usable standalone (the composer path).

### File List

- `descriptor/types.ts` (modified) — optional `archive_on_promote` + `archivesOnPromote` reader.
- `descriptor/descriptor.test.ts` (modified) — flag validate/read tests (absent→off, true, false).
- `enrichment/assign.ts` (modified) — archival trigger after the moves (injectable `enqueueSnapshot`, fires only for moved items on a flagged target).
- `enrichment/assign.test.ts` (modified) — trigger tests: flagged→enqueue+takeaway-coexists, unflagged→none, skipped→none, batch.
- `api/v1.ts` (modified) — `enqueueSnapshot` default + threaded into `assignItems`; new `POST /items/:id/archive` route.
- `api/v1.test.ts` (modified) — per-item archive (202/404/422) + default-off-on-capture tests; `seededV1App` accepts an `enqueueSnapshot` spy.
- `server.ts` (modified) — `BuildServerOptions.enqueueSnapshot` threaded to `V1Options`.

### Change Log

- 2026-06-23 — Story 16.2 implemented (TDD). Opt-in archival: an additive default-off `archive_on_promote` board flag + a per-item REST archive action both enqueue the 16.1 snapshot, hooked into the one assign verb (forward-only, fire-and-forget, graceful). Takeaway coexists with the snapshot. Party-mode review applied (real-enrichment coexistence test, batch + 422 coverage). Suite 459 pass / 0 fail.
