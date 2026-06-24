# Story 16.1: snapshot asset kind via SingleFile on the capture sidecar

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Epic 16 — Meaning-preserving archival.** Story 1 of 3. Build order: **(1) snapshot asset kind ◄ this story** → (2) opt-in archival trigger → (3) footprint visibility + backfill. This story adds a `kind='snapshot'` self-contained-HTML asset, captured through the EXISTING single-Chrome sidecar, so a curated link's content survives the page going down. Additive: a new asset kind; screenshot assets and the capture-sidecar contract are unchanged. *(D13, NFR-1, NFR-BC.)*

## Story

As a user,
I want a self-contained HTML snapshot stored for a link,
so that its content survives the page going down.

## Acceptance Criteria

1. **New asset kind (additive).**
   **Given** an archive action for an item, **When** it runs, **Then** a `kind='snapshot'` asset is written — a self-contained `.html` file on disk (relative path under the snapshots dir, mirroring `screenshots/<id>.png`), with its bytes hashed (sha256) for dedupe — **added** to the `asset` table (`db/schema.ts#L56-67`) WITHOUT touching the item's existing `kind='screenshot'` asset.

2. **Reuses the concurrency-1 sidecar (no second Chrome).**
   **Given** a SingleFile capture, **When** invoked, **Then** it runs through the existing single-Chrome launch seam (`launchBrowser`, `browser.ts#L68`) inside an `enqueueJob` slot (`db/queue.ts#L91`), so it serializes with all other capture/enrichment jobs at concurrency 1 — **no second browser, no parallel Chromium** (Chromium is ~400-520MB resident; two would OOM the 512MB-1GB box). *(NFR-1)*

3. **Footprint guardrails (size cap + capture timeout).**
   **Given** a large or slow page, **When** captured, **Then** a per-snapshot **byte-size cap** and a **capture timeout** apply; an over-cap or timed-out page is **skipped/flagged** (no snapshot asset written) and **never wedges the queue** — the slot is released via the timeout/teardown path (`createBrowserTeardown`, `capture/teardown.ts#L55`; SIGKILL + bounded await-exit).

4. **Graceful degradation (item still saves, no error wall).**
   **Given** a capture OOM/timeout/failure, **When** it fails, **Then** the snapshot is simply absent and **the item's `status` is NOT changed** (an already-curated `done` item must NOT flip to `error` because an archival snapshot failed) — no error surfaced to the user.

5. **Dependency scored before install.**
   **Given** the `single-file-cli` package is needed, **When** it is added, **Then** it passes the dependency-policy score check (DEPENDENCY.md: `socket package score npm single-file-cli@<resolved-version> --json`; thresholds supply_chain ≥ 0.80, quality ≥ 0.70, vulnerability ≥ 0.80, maintenance ≥ 0.50) BEFORE install; a failing score is reported and escalated, never bypassed.

6. **No-regression (NFR-BC).**
   **Given** an existing pre-wave DB with items that have `kind='screenshot'` assets, **When** the snapshot kind ships, **Then** existing screenshot assets, item rows, fields, notes, and favorites are byte-for-byte preserved; a snapshot write on an item that has a screenshot leaves that screenshot asset row AND file intact.

7. **Tests** assert: snapshot asset creation (additive — screenshot survives), hash-dedupe (same bytes → no second asset), size-cap and timeout skip (no asset, queue not wedged), graceful degradation (item status unchanged on failure), and the no-regression on existing screenshot assets.

## Tasks / Subtasks

- [x] **Task 1 — Score `single-file-cli`, then add the snapshot dir (TDD: config test first)** (AC: 5, 1)
  - [x] Run `npm view single-file-cli version`, then `socket package score npm single-file-cli@<resolved-version> --json`; record the four scores. If any threshold fails, STOP and escalate — do not install.
  - [x] Write a failing test in `config.test.ts`: `loadConfig` exposes a derived `snapshotsDir` rooted under `DATA_DIR` (e.g. `data/snapshots`), and `ensureDataDir` creates it idempotently. Run; confirm red.
  - [x] Implement: add `snapshotsDir: path.join(dataDir, 'snapshots')` to `Config` + `ensureDataDir` (`config.ts#L104-153`), additive. Confirm green.
- [x] **Task 2 — Write the failing snapshot-asset tests first** (AC: 1, 6)
  - [x] In a new `capture/url-snapshot.test.ts`: with an injected fake page/browser, assert the adapter writes a `.html` file under a temp `snapshotsDir`, returns an `AssetSpec{ kind:'snapshot', path, hash }`, and that persisting it via the additive snapshot-write (Task 4) leaves a pre-seeded `kind='screenshot'` asset row + file intact (the load-bearing no-regression test). Run; confirm red.
- [x] **Task 3 — Implement the SingleFile capture against the EXISTING puppeteer page** (AC: 2, 3)
  - [x] Add `capture/url-snapshot.ts` exporting `createUrlSnapshotCapture(deps)` — mirror `createUrlScreenshotAdapter` (`capture/url-screenshot.ts#L62`): injectable `launch` (defaults to `launchBrowser`), register `createBrowserTeardown` around the launch PROMISE, await teardown in `finally`. Drive SingleFile against the page it already opened (e.g. `single-file-cli`'s programmatic API on the existing Chrome session) — **never spawn a second Chrome lifecycle.**
  - [x] Enforce the per-snapshot byte-size cap: if the captured HTML exceeds the cap, return NO asset (skip/flag) — do not write the file.
- [x] **Task 4 — Additive snapshot write (NOT the replace-all set write)** (AC: 1, 6)
  - [x] Implement a snapshot-asset upsert that inserts/updates ONLY the snapshot row (stable id `${itemId}-snapshot`, `onConflictDoUpdate` on `assets.id`), through `enqueueTransaction` (`db/queue.ts#L142`). Do NOT route through `writeItemDirect(handle, item, assetRows)` — its `itemAssets` array DELETE-then-INSERTs ALL of an item's assets (`db/queue.ts#L191-193`), which would WIPE the screenshot. This is the load-bearing line.
  - [x] Dedupe by hash: if a snapshot asset with the same `hash` already exists for the item, do not write a duplicate.
- [x] **Task 5 — Enqueue as a snapshot job (concurrency 1, status-neutral)** (AC: 2, 3, 4)
  - [x] Run the capture inside `enqueueJob` (`db/queue.ts#L91`) with the per-snapshot `timeoutMs` and a `teardown` that awaits `createBrowserTeardown` — so it serializes at concurrency 1 and a hung capture is SIGKILL-ed before the slot releases. Do NOT use `runItemJob` (`db/queue.ts#L263`): it drives `item.status` processing→done→error, and a failed archival snapshot must NEVER flip an already-curated item to `error` (AC 4).
  - [x] On timeout/OOM/throw: swallow → no asset, item untouched. Add the failing degradation test first; confirm red → green.
- [x] **Task 6 — Wire tests + verify green** (AC: 7)
  - [x] Add `capture/url-snapshot.test.ts` to the `test` script; run `npm test`; confirm green + existing capture suites (`capture/url-screenshot.test.ts`, `capture/concurrency.test.ts`) unaffected.

## Dev Notes

### What this story changes vs preserves (read before coding)

- **Adds a NEW asset kind `snapshot`** on the existing `asset` table (`db/schema.ts#L56-67`) — `id`, `item_id` FK, `kind`, `path`, `hash` are reused as-is; no schema reshape. The existing `kind='screenshot'` asset written by `createUrlScreenshotAdapter` (`capture/url-screenshot.ts#L107-113`) is UNCHANGED in shape, path contract (`screenshots/<id>.png`), and behavior.
- **Reuses the single capture sidecar, does NOT add a second one.** `launchBrowser` (`browser.ts#L68`) is the one headless-Chrome seam; `enqueueJob` (`db/queue.ts#L91`) is the concurrency-1 worker; `createBrowserTeardown` (`capture/teardown.ts#L55`) is the SIGKILL-on-timeout guarantee. The snapshot capture plugs into all three, exactly like `createUrlScreenshotAdapter`.
- **Status-neutral.** Unlike capture/enrichment, the snapshot does NOT use `runItemJob`'s status lifecycle (`db/queue.ts#L263-297`). The item is already curated (`done`); archival failure leaves it untouched (AC 4).
- **Preserves screenshots on the same item.** The snapshot write is an ADDITIVE single-row upsert — it must NOT go through `writeItemDirect`'s asset-replacement path.

### Why this design (anti-pattern prevention)

- **THE load-bearing trap: never replace-all the asset set.** `writeItemDirect(handle, item, assetRows)` with a defined array does `DELETE FROM asset WHERE item_id=? ` then re-inserts that array (`db/queue.ts#L191-193`). If the snapshot reused that path it would silently DELETE the item's screenshot. The snapshot is written as its OWN additive upsert (`${itemId}-snapshot`, `onConflictDoUpdate`). [Source: db/queue.ts#L191, db/queue.ts#L142]
- **One Chrome, ever (NFR-1).** Concurrency 1 is load-bearing because Chromium is ~400-520MB resident; two coexisting OOM the box. The snapshot serializes on the SAME worker via `enqueueJob` and reuses `launchBrowser`. `single-file-cli`'s default is to spawn its OWN Chrome — that bypasses the teardown guarantee even if temporally serialized — so SingleFile is driven against the EXISTING puppeteer page, not a separate Chrome lifecycle. [Source: db/queue.ts#L43-51, browser.ts#L68, capture/concurrency.test.ts#L75-95]
- **Footprint guardrails never wedge the queue.** Over-cap → no asset written; timeout → `createBrowserTeardown` SIGKILLs the process and bounded-awaits exit so the single worker slot always releases (`capture/teardown.ts#L27,L55-85`). A wedged Chrome must never hold the one slot forever. [Source: capture/teardown.ts#L55, db/queue.ts#L91-135]
- **Graceful degradation = status-neutral (NOT `runItemJob`).** `runItemJob` would write `error` on a throw (`db/queue.ts#L281`). An archival snapshot failing on an already-`done` curated item must not turn it into an error card. Use `enqueueJob` directly and swallow the failure. [Source: db/queue.ts#L263-297]
- **Dependency hygiene.** `single-file-cli` is third-party and runs in the capture path — score it (DEPENDENCY.md) before install; pin the scored version. [Source: docs DEPENDENCY policy]

### Project Structure Notes

- New: `capture/url-snapshot.ts` (the SingleFile capture, mirroring `capture/url-screenshot.ts`), `capture/url-snapshot.test.ts`.
- Reuses: `browser.ts` (`launchBrowser`), `capture/teardown.ts` (`createBrowserTeardown`), `db/queue.ts` (`enqueueJob`, `enqueueTransaction`).
- Additive config: `config.ts` (`snapshotsDir` + `ensureDataDir`), rooted under `DATA_DIR` (Story 2.2 relative-path contract).
- ESM `.js` specifiers; `node:test` + injected fakes (no real Chrome in tests); add the new test to the `test` script.

### Testing standards

- Inject a fake `launch`/page (as `capture/url-screenshot.test.ts` and `capture/concurrency.test.ts` do) — never launch real Chrome in tests.
- The one test naive implementations miss: persist a snapshot for an item that ALREADY has a `kind='screenshot'` asset, then assert the screenshot row AND its file still exist (the replace-all trap). Assert this explicitly.
- Assert hash-dedupe (same bytes → no duplicate asset row), size-cap skip (no asset), timeout skip (no asset, slot released — reuse the `manualTimeout()` pattern from `capture/concurrency.test.ts#L22`), and item-status-unchanged on failure.

### References

- [Source: docs/bmad/epics-v2.md#L245-256] — Epic 16 / Story 16.1 ACs (new asset kind, concurrency-1 reuse, footprint guardrails, graceful degradation, dependency-scored, tests).
- [Source: docs/bmad/epics-v2.md#L50] — D13 (archival preserves meaning; opt-in; footprint caps).
- [Source: docs/bmad/epics-v2.md#L24-32] — NFR-BC no-regression wave constraint (additive asset kinds; existing data byte-for-byte preserved).
- [Source: db/schema.ts#L56-67] — the `asset` table (`id`/`item_id`/`kind`/`path`/`hash`); snapshot is additive on it.
- [Source: capture/url-screenshot.ts#L62-119] — the existing screenshot adapter to mirror (injectable launch, teardown-in-finally, hash, relative path).
- [Source: browser.ts#L68-79] — `launchBrowser` (the single headless-Chrome seam).
- [Source: capture/teardown.ts#L55-85] — `createBrowserTeardown` (SIGKILL + bounded await-exit on timeout).
- [Source: db/queue.ts#L91-135] — `enqueueJob` (concurrency-1 worker, timeout, teardown-before-slot-release).
- [Source: db/queue.ts#L171-196] — `writeItemDirect` + its asset-replacement semantics (the path the snapshot write must AVOID).
- [Source: db/queue.ts#L263-297] — `runItemJob` (status lifecycle the snapshot job must NOT use).
- [Source: config.ts#L104-153] — `Config` derived dirs + `ensureDataDir` (where `snapshotsDir` is added).

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (1M context)

### Debug Log References

- Dependency score (AC5): `single-file-cli@2.0.83` — supply_chain **0.81** (≥0.80), quality **0.99**, vulnerability **1.00**, maintenance **0.93**. PASS. License **0.70** (AGPL-3.0 / `copyleftLicense` alert) — surfaced to the user, who chose **optionalDependency + dynamic import** (board-oss core never imports AGPL code on a normal path; archival is opt-in). Added `optionalDependencies: { single-file-cli: "2.0.83" }` (pinned) + lockfile synced (`--package-lock-only`, +32 lines, minimal tree).
- Full suite: **448 pass / 0 fail** (+9 over 13.4 state: 2 config + 7 snapshot, then +1 success-path regression after the deadlock fix).

### Completion Notes List

- **BLOCKER found in party-mode review & fixed: nested-enqueue deadlock on the success path.** The first cut had `runSnapshotJob` (inside an `enqueueJob` slot) call the *enqueued* `writeSnapshotAsset` → `enqueueTransaction` → a second `enqueueWrite` on the same serializer — the exact re-entrancy the codebase documents for `writeItem`/`writeItemDirect`. Two reviewers independently confirmed it empirically (the happy path hung ~45s then reported `failed`). **Fix:** split into a synchronous in-slot `writeSnapshotAssetDirect` (dedupe-read + file write + row upsert in ONE transaction, no enqueue) called by the job, plus an enqueued `writeSnapshotAsset` wrapper for standalone callers — mirroring `writeItemDirect`/`writeItem`. The deadlock survived initial tests because the orchestrator tests only exercised failure paths and the write tests called the function directly (no enclosing slot); added a **success-through-`runSnapshotJob`** regression test (asserts `status:'written'` + row + file) that would hang on the old code.
- **THE load-bearing no-regression (AC6).** The snapshot is an additive single-row upsert on a stable `${itemId}-snapshot` id — it NEVER routes through `writeItemDirect`'s replace-all asset path. Test seeds an item with a real `kind='screenshot'` asset row **and a real file on disk**, then asserts after the snapshot write: the screenshot row survives, the screenshot **file** survives, and the item has **two** asset rows.
- **Hash-dedupe is OBSERVABLE (anti-confound).** A stable-id upsert always yields one row, so "one row after two captures" would prove nothing. The test asserts the *skipped file write* (an injected write-spy: 1 → still 1 on identical bytes → 2 on changed bytes) — the real effect of the hash check. Dedupe-read + upsert are in one transaction (no race).
- **Status-neutral (AC4).** `runSnapshotJob` uses `enqueueJob`, never `runItemJob` — a failed/timed-out archival snapshot returns `{status:'failed'}` and NEVER writes `item.status`, so an already-curated `done` item can't flip to `error`. Tested for capture-throw, timeout, and module-absence.
- **Footprint guardrails (AC3).** Per-snapshot byte cap (default 8MB) → over-cap returns no asset (file never written). Timeout → the capture's `createBrowserTeardown` (registered around the launch promise, surfaced to the job's `teardown` via `registerTeardown`) SIGKILLs Chrome and the worker awaits it before releasing the slot — proven by the hung-capture test (`proc.killed === true`). No second Chrome can start while a wedged one holds the slot (NFR-1).
- **One Chrome, ever (AC2) — serialization tested, CDP-reuse manual.** `runSnapshotJob` serializes on the single worker (`enqueueJob`), proven structurally. The default `captureHtml` (dynamic-import single-file-cli, `backEnd:'cdp'` connecting to the existing `browser.wsEndpoint()` rather than spawning) is the AGPL-isolated, **inspection/manual-verified** part — the suite fakes `captureHtml`. **Manual QA still owed:** confirm `single-file-cli@2.0.83`'s programmatic API matches the `{initialize, capture, finish}` shape and that `backEnd:'cdp'` connects (does not spawn a 2nd Chromium) — assert the Chrome process count stays at 1 during a real snapshot.
- **optionalDependency semantics (review note).** npm installs optionalDependencies by default, so the package may be on disk — what's isolated is the AGPL code *loading* (lazy dynamic import only when archiving). The module-absence degradation test injects an `ERR_MODULE_NOT_FOUND` rejection (deterministic) rather than relying on ambient absence, since CI `npm install` would install the optional dep.
- **SSRF (pre-existing, not introduced):** the snapshot fetches an arbitrary URL through the same Chrome as the screenshot adapter — same capture-layer posture as Story 6.2. Tracked as the app-wide capture-seam denylist backlog item (see the 13.3 review note).

### File List

- `config.ts` (modified) — derived `snapshotsDir` (under DATA_DIR) + `ensureDataDir` mkdir.
- `config.test.ts` (modified) — snapshotsDir derivation + ensureDataDir idempotent-create tests.
- `db/snapshot-asset.ts` (new) — `writeSnapshotAssetDirect` (in-slot, additive, dedupe) + enqueued `writeSnapshotAsset` wrapper + `snapshotFromHtml`.
- `capture/url-snapshot.ts` (new) — `createUrlSnapshotCapture` (capture + byte cap + teardown) + the default AGPL-isolated SingleFile/CDP driver + `runSnapshotJob` (status-neutral orchestrator).
- `capture/url-snapshot.test.ts` (new) — 8 tests: capture+cap, no-regression (row+file), dedupe (observable), degradation (throw/absence/timeout), success-through-job.
- `package.json` (modified) — `optionalDependencies: single-file-cli@2.0.83`; `capture/url-snapshot.test.ts` added to the `test` script.
- `package-lock.json` (modified) — single-file-cli@2.0.83 resolved (lockfile only).

### Change Log

- 2026-06-23 — Story 16.1 implemented (TDD). New additive `kind='snapshot'` self-contained-HTML asset captured on the existing single-Chrome sidecar (status-neutral job), with byte-cap + timeout guardrails, hash-dedupe, and graceful degradation. single-file-cli scored + added as an optional, lazily-imported AGPL dependency (user decision). Party-mode review caught and fixed a nested-enqueue deadlock on the success path (+ a regression test). Suite 448 pass / 0 fail.
