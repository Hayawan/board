# Story 6.5: Capture concurrency & timeout safety

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Epic 6 — Capture & ingest.** Story 5 of 5. Build order: (1) adapter interface → (2) url-screenshot → (3) url-readable → (4) manual upload → **(5) capture concurrency & timeout safety ◄ this story**. This story enforces capture hard-capped at one Chrome at a time with a kill-timeout, so capture never OOMs a 512MB box — closing the loop on the Story 5.1 worker + the adapters' teardown. *(FR-6, NFR-1, C1.)*

## Story

As a 512MB-LXC self-hoster,
I want capture hard-capped at one Chrome at a time with a kill-timeout,
so that capture never OOMs my box.

## Acceptance Criteria

1. **The next CAPTURE job does not launch until the prior browser is confirmed dead.**
   **Given** a capture finishes or times out, **When** the worker dequeues the next *capture* job, **Then** it does so only after the prior capture's browser teardown has **completed** (awaited) — so two Chromiums never coexist (the NFR-1/C1 OOM race). *(Disambiguate "proceed": marking the failed job + advancing the queue for non-capture jobs may happen immediately; launching the next memory-heavy capture must await the teardown handle — see AC 3.)*

2. **A hung capture is force-killed and the item marked error.**
   **Given** a hung capture (page never settles — a never-resolving operation), **When** the per-capture timeout (Story 5.1 injected timer) fires, **Then** the adapter races `close()` against the timeout; the timer winning triggers `browser.process()?.kill("SIGKILL")` (a plain `close()` may itself hang on a wedged page), and the item is marked `status=error` (Story 5.2) with reason "capture timed out".

3. **Teardown exposes an awaitable completion handle (not fire-and-forget).**
   **Given** the timeout abort path, **When** it kills the browser, **Then** it returns/exposes a `teardownComplete` promise that resolves on the child process's `exit` (`await once(proc, "exit")`) — because `ChildProcess.kill()` is synchronous fire-and-forget and returns a boolean, NOT a promise. The worker awaits `teardownComplete` before launching the next capture (AC 1). *(This resolves the 5.1 "abandon the job promise" vs 6.5 "await teardown" tension: the JOB promise is abandoned for status purposes, but a SEPARATE `teardownComplete` handle gates the next capture launch.)*

4. **Tests assert single-Chrome + timeout-kill with an ASYNC, deferred-close fake (non-tautological).**
   **Given** an injected **async** launcher whose fake browser increments a live-count on launch and decrements only when a **manually-controllable `close`/`exit` promise** is resolved by the test, **When** capture-1 is launched and capture-2 dispatched while capture-1 is post-launch / pre-close, **Then** the test asserts capture-2's launcher is **NOT called until close-1 resolves**, then IS. A hung capture is a **never-resolving** operation → the injected timer is the only exit → assert `process().kill()` was called (spy) + item `error`. *(A synchronous fake can never overlap, so the live-count assertion would be tautological — the deferred-close async fake is what actually catches the two-Chromium race.)* No real Chrome, no real wall-clock.

## Tasks / Subtasks

- [ ] **Task 1 — Write the failing concurrency + timeout tests first (TDD)** (AC: 1, 2, 3, 4)
  - [ ] Create `capture/concurrency.test.ts` with an **async, deferred-close fake launcher** (live-count up on launch, down only when a test-controlled `close`/`exit` promise resolves): launch capture-1, dispatch capture-2 in capture-1's pre-close window, assert capture-2's launcher is NOT called until close-1 resolves, then IS. A **never-resolving** hung capture + injected timer (Story 5.1) → assert `process().kill()` called (spy) + item `error` + reason "capture timed out". (A synchronous fake makes this tautological — use the deferred-close async fake.)
  - [ ] Run; confirm red for the right reason.
- [ ] **Task 2 — Run capture on the Story 5.1 worker (concurrency 1)** (AC: 1)
  - [ ] Ensure every capture (6.2 screenshot, 6.3 readable render-fallback) runs as a job on the single worker (Story 5.1) — so capture concurrency is structurally 1 (not an ad-hoc semaphore in the adapter). The worker's serial drain IS the concurrency cap.
- [ ] **Task 3 — Implement per-capture timeout → force-kill + awaitable teardown** (AC: 2, 3)
  - [ ] Wire the Story 5.1 cancellation signal (`AbortController`) into the adapters. On abort: race `browser.close()` against the timeout; if the timer wins, `const proc = browser.process(); proc?.kill("SIGKILL")` then **`await once(proc, "exit")`** — expose this as a `teardownComplete` promise. `kill()` is sync fire-and-forget (returns boolean), so awaiting `exit` is the ONLY way AC 3's "await teardown" is real.
  - [ ] The worker awaits `teardownComplete` before launching the next *capture* job (AC 1). Mark the item `error` (Story 5.2) with "capture timed out" — that can happen immediately; the gate is specifically on launching the next memory-heavy capture, not on status-marking.
  - [ ] (The prototype only `close()`s with no kill/timeout, `add.ts:334-336` — the force-kill + awaited-exit is net-new.)
- [ ] **Task 4 — Bound memory: one launch per job, killed immediately** (AC: 1, 2)
  - [ ] Confirm the launch-per-job + immediate-kill model (architecture §1: "launch→screenshot→kill, concurrency 1") — no browser pooling, no keep-alive browser. Each capture launches, captures, kills. This keeps Chromium memory transient. [Source: architecture §1]
- [ ] **Task 5 — Wire tests + verify green** (AC: 4)
  - [ ] Add the test to the `test` script; run `npm test`; confirm green + existing suites unaffected.

## Dev Notes

### What this story changes vs preserves (read before coding)

- **Closes the loop on Story 5.1 (worker) + 6.2/6.3 (adapters that launch Chrome).** 5.1 built the worker + the cancellation signal; 6.2/6.3 launch browsers and close in `finally`. This story adds the **force-kill on timeout** + asserts the single-Chrome guarantee end-to-end.
- **The prototype has concurrency control only by accident (recon).** The blocking `spawnAddItem` (`server.ts:60-92`) serializes captures because the server awaits each child's `close` — but there's no explicit cap and no timeout/kill. The prototype's `screenshot` only `close()`s (`add.ts:334-336`), no kill, no timeout. v1 makes the cap structural (the 5.1 worker) + adds the timeout-kill.
- **This is the NFR-1/C1 payoff.** Chromium is ~400-520MB resident (architecture §1); two at once OOMs a 512MB-1GB box. Concurrency 1 + immediate kill + force-close-on-timeout is the complete memory-safety story.

### Why this design (anti-pattern prevention)

- **Concurrency cap is structural (the worker), not an adapter semaphore (AD4/AD6).** Running capture on the single 5.1 worker means the cap can't be bypassed by a new call site. An ad-hoc mutex in the adapter could be forgotten by a future adapter. The worker is the one true cap. [Source: docs/bmad/architecture.md#3-AD4, #4.5]
- **Force-KILL, not just close, on a hung browser.** A wedged Chrome may not respond to `close()` — you must kill the process (`browser.process().kill("SIGKILL")` after a grace period). The prototype only closes; a truly hung page would leak. This is the net-new safety. [Source: add.ts#334-336, docs/bmad/PRD.md#FR-6]
- **Await release before proceeding (the 5.1↔6.5 contract).** The worker must not launch the next memory-heavy capture until the prior browser is confirmed dead — else, briefly, two Chromiums coexist and OOM. This ordering is the subtle correctness point. [Source: docs/bmad/stories/5-1-single-writer-worker-queue.md]
- **Launch-per-job, no pool.** No browser pooling/keep-alive — each capture launches and kills, keeping memory transient (architecture §1). A pooled browser would hold memory idle, defeating the footprint goal. [Source: docs/bmad/architecture.md#1]

### Project Structure Notes

- Logic spans the 5.1 worker (timeout/signal) + the 6.2/6.3 adapters (force-close on abort). Test in `capture/concurrency.test.ts`.
- ESM `.js` specifiers; `node:test`; injected launcher + injected timer (no real Chrome, no real wall-clock wait); add the test to the `test` script.

### Testing standards

- Injected launcher tracking live-count; injected timer for the timeout.
- Assert: live-count never >1; hung→force-close+error; successor waits for release. All deterministic, no real Chrome.
- Existing suites green.

### References

- [Source: docs/bmad/PRD.md#FR-6] — capture concurrency cap 1 + per-capture timeout + guaranteed teardown.
- [Source: docs/bmad/PRD.md#NFR-1] — footprint; capture bounded (concurrency 1, transient Chromium).
- [Source: docs/bmad/architecture.md#1] — Chromium ~400-520MB; launch→screenshot→kill; concurrency 1.
- [Source: docs/bmad/architecture.md#3-AD4] — capture in-process, concurrency 1.
- [Source: add.ts#334-336] — prototype's `close()`-only teardown (no kill/timeout) this story hardens.
- [Source: server.ts#60-92] — prototype's accidental serialization via blocking child spawn.
- [Source: docs/bmad/stories/5-1-single-writer-worker-queue.md] — the worker + cancellation signal + the proceed-ordering contract.
- [Source: docs/bmad/stories/6-2-url-screenshot-adapter.md], [Source: docs/bmad/stories/6-3-url-readable-adapter.md] — the adapters whose teardown this story force-kills.

## Dev Agent Record

### Agent Model Used

_(to be filled by dev agent)_

### Debug Log References

### Completion Notes List

### File List
