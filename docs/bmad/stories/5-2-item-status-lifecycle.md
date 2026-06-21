# Story 5.2: Item status lifecycle with persisted error reason

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Epic 5 — Async job model & live status.** Story 2 of 3. Build order: (1) worker queue → **(2) item status lifecycle + persisted error reason ◄ this story** → (3) SSE status endpoint. This story makes each item carry a `status` that moves `pending→processing→done`, and on failure becomes `error` with a persisted `error_reason` — never stuck `processing`. This is what the UI shows and lets the user retry. *(FR-17, C4.)*

## Story

As a user,
I want each item to carry a status and a persisted error reason,
so that I can see and retry failures.

## Acceptance Criteria

1. **Status moves pending → processing → done on success.**
   **Given** a job for an item, **When** it progresses, **Then** `item.status` transitions `pending → processing → done`.

2. **On throw/timeout/non-zero → error + persisted, clean reason.**
   **Given** a job that fails (throws, times out via Story 5.1, or non-zero), **When** it fails, **Then** `item.status` becomes `error` and `item.error_reason` is persisted with a **clean, user-safe** reason (a mapped short string like "capture timed out" — NOT a raw stack trace or secret-bearing string). The `try/catch/finally` handles these in-process cases. *(Note: `finally` does NOT cover a hard process crash / OOM-kill — that's AC 5's boot reconciliation, not this AC. Do not claim `finally` survives a crash.)*

3. **`EnrichmentDisabledError` does NOT become `error`.**
   **Given** the `disabledLlm` throws `EnrichmentDisabledError` (Story 4.4), **When** the enrichment step "fails" with it, **Then** the item resolves to `done` with empty enrichable fields — NOT `error` (a no-AI install must not show error cards). *(5.2 OWNS this status-classification rule — Story 4.4 defers the catch here, not to 7.1.)*

4. **Boot reconciliation: no item is stuck `processing` across a crash/OOM.**
   **Given** a hard process crash/OOM-kill left items in `processing` (the `finally` never ran — and OOM is this epic's own threat model: Chromium on a 512MB box), **When** the app boots, **Then** a startup reconciliation sweep moves any `processing` item to `error` with reason "interrupted" (or to `pending` for retry — decide and document). This is the ONLY mechanism that honors C4's "never stuck processing" for the crash case; `finally` cannot.

5. **Tests assert every state transition + the clean reason + boot reconciliation.**
   **Given** a temp DB, **When** the tests run, **Then**:
   - success path → `done`;
   - throwing job → `error` + `error_reason` **equal to the mapped clean string** (assert the exact reason / that it contains no stack/secret substring — non-empty alone is insufficient);
   - timed-out job (inject 5.1 timer) → `error`, not `processing`;
   - **inject a stub job that throws `EnrichmentDisabledError`** → `done` + empty enrichable fields, not `error` (do NOT drive Epic 7's real worker — keep it in-epic with a stub);
   - **seed a `processing` row, run boot reconciliation, assert it lands `error`/`pending`** (the crash case, fully deterministic — no crash simulation needed).

## Tasks / Subtasks

- [ ] **Task 1 — Write the failing status tests first (TDD)** (AC: 1, 2, 3, 4, 5)
  - [ ] Create `db/status.test.ts`: succeeding job → `pending→processing→done`; throwing job → `error` + `error_reason` **equal to the mapped clean string**; timed-out job (inject the 5.1 timer) → `error`, not `processing`; **stub job throwing `EnrichmentDisabledError`** → `done`, not `error`; **seed a `processing` row + run boot reconciliation** → `error`/`pending`.
  - [ ] Run; confirm red for the right reason.
- [ ] **Task 2 — Implement status transitions in the worker** (AC: 1, 2)
  - [ ] In the job worker (Story 5.1): on job start set `status=processing`; on success set `status=done`; on failure (throw/timeout/non-zero) set `status=error` + persist `error_reason`. Do all status writes through the single-writer path (Story 1.3). Use a `try/catch/finally` so a crash/timeout always lands a terminal status — the "never stuck processing" guarantee (C4) requires the failure write to happen even on the unhappy path.
- [ ] **Task 3 — Classify `EnrichmentDisabledError` as not-an-error** (AC: 3)
  - [ ] In the failure handler, catch `EnrichmentDisabledError` (Story 3.1/4.4) specifically: resolve the item to `done` with empty enrichable fields, do NOT set `error`/`error_reason`. All OTHER errors (transport down `LLMTransportError`, schema mismatch `LLMSchemaError`, capture failure) → `error` + reason. Document the classification.
- [ ] **Task 4 — Persist a useful, non-leaky error_reason** (AC: 2)
  - [ ] `error_reason` is a short, user-facing-safe message (e.g. "capture timed out", "model output invalid", "could not reach provider") — NOT a raw stack trace or a secret-bearing string. Map the typed errors (5.1 timeout, `LLMTransportError`, `LLMSchemaError`, capture errors) to clean reasons. (Story 8.5 renders these; never raw error text to the user.)
- [ ] **Task 5 — Implement boot reconciliation (the crash-safety net)** (AC: 4)
  - [ ] On app startup, before serving, run a one-shot reconciliation: `UPDATE item SET status='error', error_reason='interrupted' WHERE status='processing'` (or → `pending` for auto-retry — decide + document). This catches items orphaned in `processing` by a hard crash/OOM where `finally` never ran. Keep it idempotent and fast (indexed on `status`, Story 1.1). This is the ONLY honoring of C4 for the crash case.
- [ ] **Task 6 — Wire tests + verify green** (AC: 5)
  - [ ] Add the test to the `test` script; run `npm test`; confirm green + existing suites unaffected.

## Dev Notes

### What this story changes vs preserves (read before coding)

- **Uses the `status`/`error_reason` columns from Story 1.1** (`item.status` default `pending`, `item.error_reason`). No schema change.
- **Status writes go through the Story 1.3 single-writer + Story 5.1 worker.** The status transition IS part of the job's execution on the worker.
- **The prototype has NO status lifecycle (recon).** Items are written complete (or not) by the blocking `spawnAddItem`; there's no `pending/processing/done/error`. This is net-new. The prototype's only failure signal is captured stderr (`server.ts:75`), never surfaced as item state.

### The status lifecycle (target — architecture §4.5)

[Source: docs/bmad/architecture.md#4.5-job-model-status]
- `item.status`: `pending → processing → done → error` (`error_reason` persisted). There are exactly these four states — do NOT invent new ones (e.g. no "captured-not-enriched"; a disabled-enrichment item is `done`).
- SSE (Story 5.3) streams these transitions; the worker (5.1) drives them.

### Why this design (anti-pattern prevention)

- **Never stuck `processing` (C4).** The single most important rule: every job must reach a terminal state (`done` or `error`) even on crash/timeout. Use `finally`/structured error handling so a thrown or timed-out job always writes a terminal status. A stuck-`processing` item is invisible to retry and looks broken forever. [Source: docs/bmad/PRD.md#FR-17, docs/bmad/architecture.md#4.5]
- **Disabled-enrichment is `done`, not `error` (FR-9/UJ-2).** This is the catch that makes a no-AI install dignified (Story 8.5). Conflating "enrichment disabled" with "enrichment failed" would paint every card on a no-AI box as an error. Classify `EnrichmentDisabledError` separately. [Source: docs/bmad/stories/4-4-optional-graceful-provider-selection.md, docs/bmad/epics.md#Story-8.5]
- **`error_reason` is user-safe, not a stack trace.** It's displayed (8.5) and persisted. Map typed errors → clean short reasons; never persist raw stacks or secret-bearing strings (NFR-3). [Source: docs/bmad/PRD.md#NFR-3]
- **Status persists; it's not just in-memory.** A restart must not lose an item's terminal state. Persist transitions to the DB (the column), not a runtime map. [Source: docs/bmad/architecture.md#4.5]

### Project Structure Notes

- Status logic in the worker (`db/queue.ts`, Story 5.1) + `db/status.test.ts`. Columns from Story 1.1.
- ESM `.js` specifiers; `node:test`; add the test to the `test` script.

### Testing standards

- Temp DB; injected timer for the timeout-→-error case.
- The four assertions: success path (done), failure path (error+reason), timeout (error not processing), disabled-enrichment (done not error). The timeout + disabled cases are the ones naive implementations get wrong.
- Existing suites green.

### References

- [Source: docs/bmad/architecture.md#4.5-job-model-status] — the four-state lifecycle; error_reason persisted.
- [Source: docs/bmad/PRD.md#FR-17] — status lifecycle; error persists the reason for display/retry.
- [Source: docs/bmad/PRD.md#NFR-3] — no secrets in error strings.
- [Source: docs/bmad/epics.md#Story-8.5] — the degraded state that renders error_reason / disabled.
- [Source: server.ts#75] — prototype's only failure signal (captured stderr, never surfaced as item state).
- [Source: docs/bmad/stories/5-1-single-writer-worker-queue.md] — the worker that drives transitions + the timeout.
- [Source: docs/bmad/stories/4-4-optional-graceful-provider-selection.md] — the `EnrichmentDisabledError` → `done` hand-off this story implements.
- [Source: docs/bmad/stories/1-1-sqlite-drizzle-schema.md] — the `status`/`error_reason` columns.

## Dev Agent Record

### Agent Model Used

_(to be filled by dev agent)_

### Debug Log References

### Completion Notes List

### File List
