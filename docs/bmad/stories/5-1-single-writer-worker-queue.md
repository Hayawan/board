# Story 5.1: Single-writer worker queue (capture concurrency 1)

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Epic 5 — Async job model & live status.** Saves return fast; capture+enrichment run on a single-writer worker queue with a status lifecycle streamed over SSE. *(FR-17, FR-18, AD6, C1, C4.)*
>
> **Story 1 of 3 in Epic 5.** Build order: **(1) single-writer worker queue (capture concurrency 1) ◄ this story** → (2) item status lifecycle + persisted error reason → (3) SSE status endpoint. This story extends Story 1.3's write-serialization core into a **job worker** that drains capture/enrichment jobs serially (concurrency 1) with a per-job wall-clock timeout that kills a hung job. *(NFR-1, C1; extends AD6.)*

## Story

As the board-oss maintainer,
I want one async worker draining jobs serially with a per-job timeout,
so that capture concurrency is 1 (never OOMs a 512MB box) and writes stay single-writer.

## Acceptance Criteria

1. **Jobs run serially — at most one at a time (concurrency 1).**
   **Given** multiple queued jobs (e.g. capture jobs), **When** they run, **Then** at most one executes at a time; a second job does not start until the first finishes/fails/times out. *(Worker-occupancy rule — document it: a job holds the **job slot** for its full duration (Chrome launch + LLM round-trip), so jobs serialize against each other at concurrency 1; its **write transactions** serialize on the 1.3 writer separately. For a single-user v1 this is the accepted tradeoff — a long capture does occupy the one job slot; interactive writes (notes/favorite, Story 8.3) go through `enqueueWrite` and are not blocked by a job's non-write work. State this so the stall behavior is a known design choice, not a surprise.)*

2. **Each job has a wall-clock timeout that fires a cancellation signal, abandons, and marks failed.**
   **Given** a job that hangs, **When** its timeout fires, **Then** the worker fires a cancellation signal (`AbortController`), abandons the job promise, marks it failed, and proceeds — it does not block the queue forever. *(5.1 cannot itself kill a Chrome process — capture doesn't exist until Epic 6; the actual force-close is Story 6.5, which honors this signal. AC2 is the signal+abandon+mark-failed, not the kill.)*

3. **A timed-out memory-heavy successor must not start before teardown releases memory.**
   **Given** a capture job times out, **When** the worker proceeds, **Then** it must NOT launch the next memory-heavy capture until the timed-out job's teardown (Story 6.5 force-close) has released the browser — otherwise two Chromiums coexist and OOM the box (the exact NFR-1/C1 failure). Name this ordering constraint as the 5.1↔6.5 seam (5.1 owns "don't proceed until teardown confirms release"; 6.5 owns the force-close).

4. **The worker reuses Story 1.3's serialized write path (one serializer, not two).**
   **Given** a job that writes, **When** it runs, **Then** its writes go through the same single-writer path from Story 1.3 (the queue IS the SQLite single-writer guard) — there are not two competing write serializers.

5. **A test asserts serial execution, no-double-serializer, and timeout via an injected clock.**
   **Given** a temp DB + an **injected timer/clock** (not real `setTimeout` — name the seam: a constructor-injected `timeoutFn`/clock, or `node:test` `mock.timers`), **When** the test runs, **Then**:
   - **Serial (non-tautological):** the instrumented job **`await`s an injected deferred while holding the active slot** before decrementing the active-count, so a truly-parallel implementation would push active-count to 2 and fail. (A synchronous job body can never be observed overlapping — that test proves nothing.)
   - **No double serializer:** interleave a raw `enqueueWrite` (1.3) and a job-that-writes; assert they serialize against EACH OTHER (combined active-count never > 1).
   - **Timeout:** a hung job (injected timer) → signal fired + marked failed + queue proceeds to the next job. Runs against `os.tmpdir()`.

## Tasks / Subtasks

- [x] **Task 1 — Write the failing worker tests first (TDD)** (AC: 1, 4, 5)
  - [x] Create `db/worker.test.ts`: instrumented jobs that **`await` a controllable deferred while holding the active slot** (so a parallel impl would be caught with active-count 2 — not a synchronous job that can never overlap); assert active-count never exceeds 1. Interleave an `enqueueWrite` with a job-write; assert combined active-count never > 1 (no second serializer). Enqueue a hung job with an **injected timer** (name the seam — `timeoutFn`/clock or `mock.timers`); assert the cancellation signal fired + marked failed + queue proceeds.
  - [x] Run; confirm red for the right reason.
- [x] **Task 2 — Extend the Story 1.3 worker into a job queue** (AC: 1, 3)
  - [x] In `db/queue.ts` (Story 1.3's single-writer worker), add a typed job API: `enqueueJob(job)` where a job is `{ type, run(ctx), timeoutMs }` (capture/enrichment job types come from Epics 6/7). The worker drains jobs serially — concurrency 1 — reusing the SAME serialized path as writes (the queue is the single-writer guard). Do NOT spin up a second worker/pool.
  - [x] Keep the generic `enqueueWrite` (1.3) and the typed item-write helper (1.3/1.4) working — jobs are a layer on the same worker, not a replacement.
- [x] **Task 3 — Add per-job timeout + cancellation signal (not a kill — that's 6.5)** (AC: 2, 3)
  - [x] Wrap each job run in a wall-clock timeout (injectable timer). On timeout: fire an `AbortController` signal passed into the job, abandon the job promise, mark it failed, proceed. The signal is the seam Epic 6's capture honors to force-close the browser (Story 6.5). 5.1 does not itself kill a process.
  - [x] **Name the proceed-ordering constraint (AC 3):** the worker must not start the next memory-heavy capture until the prior job's teardown has released its browser. The reconciliation with AC 2's "abandon the job promise": the JOB promise is abandoned for *status* purposes (mark failed immediately), but a SEPARATE `teardownComplete` handle (Story 6.5 exposes it, resolving on the browser process `exit`) gates launching the next *capture* specifically. Document this as the 5.1↔6.5 contract so two Chromiums never coexist.
- [x] **Task 4 — Replace the prototype's blocking spawn model (seam, not full migration)** (AC: 3)
  - [x] The prototype runs capture by **spawning `npx tsx add.ts` as a child and blocking on `close`** (recon: `spawnAddItem` `server.ts:60-92`, resolves on `proc.on("close")` `server.ts:76`). The v1 model is in-process jobs on this worker, not child-process spawning. This story establishes the in-process job worker; Epic 6 moves capture onto it. Do NOT rip out `spawnAddItem` here (it still serves the prototype path) — establish the worker + document the seam Epic 6 migrates to.
- [x] **Task 5 — Wire tests + verify green** (AC: 4)
  - [x] Add the test to the `test` script; run `npm test`; confirm green + existing suites unaffected.

## Dev Notes

### What this story changes vs preserves (read before coding)

- **`db/queue.ts` (UPDATE from Story 1.3)** — 1.3 built the write-serialization core (`enqueueWrite`, the typed item-write helper, transactions). This story adds the **job** layer on the SAME worker: `enqueueJob` + concurrency-1 draining + per-job timeout. Architecture §4.5/AD6: "the JobQueue is a single async worker draining jobs serially; capture + enrichment jobs run here (this is also the SQLite single-writer)."
- **The prototype's async model is child-process spawning (recon).** `spawnAddItem` (`server.ts:60-92`) spawns `npx tsx add.ts` and resolves only on `proc.on("close")` (`server.ts:76`) — fully blocking from the client's view, no concurrency control, no streaming. v1 replaces this with in-process jobs on the single worker. This story builds the worker; Epic 6 (capture) and Epic 7 (enrichment) put their jobs on it; Story 8.4 (optimistic save) makes saves return fast.
- **Concurrency 1 is load-bearing (NFR-1/C1).** Capture launches Chromium (~400-520MB resident); on a 512MB-1GB LXC, two concurrent captures OOM the box. The single worker enforces capture concurrency 1 structurally. [Source: docs/bmad/architecture.md#1, #4.3]

### Why this design (anti-pattern prevention)

- **One worker for writes AND jobs (AD6).** The queue is the SQLite single-writer guard (Story 1.3) AND the capture/enrichment job runner. Two separate mechanisms (a write-mutex + a job-pool) would let a job's writes race the write serializer. Keep it one worker. [Source: docs/bmad/architecture.md#3-AD6, #4.5]
- **In-process, no external broker.** No Redis/BullMQ (explicitly rejected, architecture §2). The worker is an in-process async drain. Don't reach for a job library. [Source: docs/bmad/architecture.md#2 Rejected]
- **Timeout MUST kill, not just abandon.** A hung capture holds Chromium memory. The timeout has to actually terminate the work (kill the browser) — abandoning the promise while Chrome lives still OOMs the box. Pass a cancellation signal the job honors; Epic 6's capture kills the browser on it. [Source: docs/bmad/PRD.md#NFR-1, #FR-6, docs/bmad/epics.md#Story-6.5]
- **Don't build status transitions or SSE here.** Status lifecycle is Story 5.2; SSE is 5.3. This story is the worker + concurrency + timeout. Keep it focused. [Source: docs/bmad/epics.md#Story-5.2, #Story-5.3]

### Project Structure Notes

- `db/queue.ts` (extended), `db/worker.test.ts` (new). Architecture §6 names `db/queue.ts` the single-writer worker queue.
- ESM `.js` specifiers; `node:test`; injectable timer/clock for deterministic timeout tests; add the test to the `test` script.

### Testing standards

- Temp DB; injected timer (never a real `setTimeout` wait in tests — fake the clock so the timeout test is instant + deterministic).
- Assert serial execution via an instrumented job (active-count never >1), not by timing.
- Assert timeout → killed + marked-failed + queue proceeds.
- Existing suites green.

### References

- [Source: docs/bmad/architecture.md#4.5-job-model-status] — JobQueue: single async worker, serial, = SQLite single-writer.
- [Source: docs/bmad/architecture.md#3-AD6] — async job model, in-process, no broker.
- [Source: docs/bmad/architecture.md#1] — Chromium ~400-520MB → capture concurrency 1 on the small LXC.
- [Source: docs/bmad/PRD.md#NFR-1] — footprint; capture is the only heavy op, bounded (concurrency 1).
- [Source: docs/bmad/PRD.md#FR-6] — capture concurrency cap + per-capture timeout + guaranteed teardown.
- [Source: server.ts#60-92] — prototype `spawnAddItem` (blocking child-process model) the in-process worker replaces.
- [Source: docs/bmad/stories/1-3-single-writer-queue.md] — the write-serialization core this story extends with jobs.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (BMAD dev-story workflow)

### Debug Log References

- `npm test` → 210 pass / 0 fail (206 prior + 4 new worker tests).

### Completion Notes List

- ✅ All 5 ACs satisfied.
- **`enqueueJob(job, { timeoutFn? })`** added to `db/queue.ts` — the job layer on the SAME `enqueueWrite` chain, so jobs run serially (concurrency 1) AND serialize against raw writes (one serializer, not two — AC1/AC4). A job holds the single slot for its full duration. Documented worker-occupancy tradeoff (a long capture occupies the slot; interactive `enqueueWrite` notes/favorite still serialize on the same worker).
- **Per-job timeout (AC2):** an injectable `timeoutFn` (default `setTimeout`, unref'd; tests inject a manual-fire fn — no real clock) fires an `AbortController` signal the job honors, resolves the status as failed immediately, and proceeds. 5.1 fires the signal + abandons + marks-failed; the actual Chrome force-close is Story 6.5 (which honors the signal).
- **Teardown ordering (AC3, the 5.1↔6.5 seam):** status is marked failed immediately, but the worker SLOT is held until the job's optional `teardown(signal)` resolves — so the next memory-heavy capture can't start until the timed-out one's browser is released (two Chromiums never coexist). Tested: next job doesn't start until the teardown deferred resolves.
- **Reuses the 1.3 write path (AC4):** jobs that write go through `writeItem`/`enqueueWrite` on the same worker. `enqueueWrite`/`enqueueTransaction`/`writeItem` unchanged.
- **Scope:** no status lifecycle (5.2) or SSE (5.3) here. The prototype's `spawnAddItem` child-process model left intact (Epic 6 migrates capture onto this worker) — documented seam, not ripped out.
- **Tests (AC5):** serial proof uses an instrumented job that awaits a deferred while holding the slot (a parallel impl would hit active-count 2); no-double-serializer interleaves `enqueueWrite` + a job (combined active ≤ 1); timeout via injected fire → abort + failed + proceeds; teardown gates the next job.

### File List

- `db/queue.ts` (modified) — `Job`/`JobResult`/`TimeoutFn` types + `enqueueJob` (concurrency-1, timeout+abort, teardown-gated slot release).
- `db/worker.test.ts` (new) — 4 tests (serial, no-double-serializer, timeout, teardown ordering).
- `package.json` (modified) — appended `db/worker.test.ts` to the `test` script.

### Change Log

- 2026-06-20 — Story 5.1 implemented: in-process job worker (enqueueJob) on the single-writer chain — concurrency 1, per-job abort-timeout, teardown-gated slot release (5.1↔6.5 seam). Status → review.
