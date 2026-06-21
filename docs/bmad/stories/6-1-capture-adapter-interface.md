# Story 6.1: CaptureAdapter interface + ingest dispatch

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Epic 6 — Capture & ingest.** Generalize capture into a `CaptureAdapter` keyed by ingest mode; ship the URL screenshot + readable-text adapters and manual upload, with concurrency-1 safety. *(FR-4, FR-5, FR-6, AD4, C1, C2.)*
>
> **Story 1 of 5 in Epic 6.** Build order: **(1) CaptureAdapter interface + ingest dispatch ◄ this story** → (2) url-screenshot adapter → (3) url-readable adapter → (4) manual upload → (5) concurrency & timeout safety. This story defines the `CaptureAdapter.fetch(source) → {fields, assets[]}` contract keyed by `ingest_mode`, so the item model is source-agnostic and new adapters slot in. *(FR-6.)*

## Story

As the board-oss maintainer,
I want `CaptureAdapter.fetch(source) → {fields, assets[]}` keyed by `ingest_mode`,
so that the item model is source-agnostic and new adapters slot in later.

## Acceptance Criteria

1. **The `CaptureAdapter` contract exists and is keyed by `ingest_mode`.**
   **Given** a board's `ingest_mode` (from its descriptor, Story 1.2), **When** an item is captured, **Then** a dispatcher resolves the matching adapter and calls `fetch(source, ctx) → { fields, assets[] }`.

2. **The item model does not assume a URL.**
   **Given** the adapter contract, **When** an item is captured, **Then** the item carries `{ fields, assets }` from the adapter — it does not hardcode "every item is a URL" (manual-upload has no URL source).

3. **Re-capture is idempotent (testable, v1).**
   **Given** a capture for an existing item id, **When** the same source is captured again (Story 7.3 refetch, or a retried job), **Then** it replaces/updates rather than appending — no duplicate `asset` row, no duplicate item. *(Keyed to the item id, tying to Story 1.5's preserved-id dedupe.)*

4. **The token-authed sidecar contract is a DESIGN artifact, not v1-implemented.**
   **Given** that capture runs in-process as a worker job (a plain function call via the registry — there is no network surface to authenticate in v1), **When** this story is built, **Then** it produces a *documented* design of the would-be sidecar contract (endpoint shape + payload schema + token mechanism) with a named in-process attach point — **explicitly NOT wired in v1**. *(That is what "designed, not extracted" / AD4 / C2 means — do not "implement token-auth" on an in-process call; that is theater.)*

5. **A unit test covers dispatch + idempotency + a fake adapter.**
   **Given** a registered fake adapter for a test `ingest_mode`, **When** the dispatcher captures, **Then** the test asserts: the right adapter ran and returned `{fields, assets}`; an unknown `ingest_mode` → clear error; a non-URL (manual) fake adapter works; **and re-capturing the same source for the same item id does not duplicate the asset (AC 3)**.

## Tasks / Subtasks

- [ ] **Task 1 — Write the failing dispatch tests first (TDD)** (AC: 1, 2, 4)
  - [ ] Create `capture/adapter.test.ts`: register a fake adapter for `ingest_mode="test"`; dispatch a capture; assert it ran + returned `{fields, assets}`; assert unknown `ingest_mode` → clear error; assert a manual-upload-style adapter works with no URL source.
  - [ ] Run; confirm red.
- [ ] **Task 2 — Define the `CaptureAdapter` interface + `AssetSpec`** (AC: 1, 2)
  - [ ] Create `capture/adapter.ts`: `interface CaptureAdapter { fetch(source: string | UploadSource, ctx): Promise<{ fields: Record<string, unknown>; assets: AssetSpec[] }> }` and `AssetSpec` (`{ kind, path|buffer, width?, height?, hash? }`). Model `source` so non-URL adapters (manual upload) fit — a union or an adapter-specific source type, documented.
  - [ ] Generalize from the prototype's `Processor.capture` (`processors.ts:3-18`, the de-facto adapter) — the new `CaptureAdapter` is the capture half, decoupled from analysis (which is now the `LLMProvider`/enrichment seam).
- [ ] **Task 3 — Implement the ingest dispatcher** (AC: 1, 3)
  - [ ] A registry/dispatch keyed by `ingest_mode` (`url-screenshot`, `url-readable`, `manual-upload`) → the matching `CaptureAdapter`. Resolve the board's `ingest_mode` from its descriptor (Story 1.2). Unknown mode → clear error. Mirror the prototype's `getProcessor` dispatch (`processors.ts:26-30`) but keyed by ingest_mode, not collection type.
- [ ] **Task 4 — Implement idempotency (v1) + DOCUMENT the sidecar token contract (design-only)** (AC: 3, 4)
  - [ ] **Idempotency (real v1 code, tested):** re-capture for an existing item id replaces/updates the asset rather than appending a duplicate — key on item id (ties to Story 1.5 dedupe + Story 7.3 refetch). This is the testable half (AC 3/AC 5).
  - [ ] **Token-authed sidecar contract (design artifact ONLY):** write the would-be sidecar's endpoint shape + payload schema + token mechanism into the Dev Notes / a design doc, with a named in-process attach point — but do NOT wire token-auth into the in-process call (there's no network surface to guard in v1; AD4/C2 is "designed, not extracted"). Do not claim to "implement" token-auth on a function call.
- [ ] **Task 5 — Wire `add-item` to enqueue a capture job (the hop-1 seam Story 3.4 deferred to Epic 6)** (AC: 1)
  - [ ] Story 3.4's `add-item` creates a `status=pending` item and explicitly leaves the capture enqueue to Epic 6 — **this story owns wiring it.** After `add-item` creates the pending item, enqueue a capture job (on the Story 5.1 worker) that resolves the board's `ingest_mode` → adapter (this dispatcher) and runs it. On capture completion, Story 7.1 enqueues enrichment (hop 2). Without this task, a pending item never starts capturing — the chain dead-ends. (manual-upload boards skip auto-capture — the item waits for an upload, Story 6.4.)
- [ ] **Task 6 — Wire tests + verify green** (AC: 4)
  - [ ] Add the test to the `test` script; run `npm test`; confirm green + existing suites unaffected.

## Dev Notes

### What this story changes vs preserves (read before coding)

- **NEW `capture/adapter.ts`** — architecture §6 (`capture/adapter.ts`, `url-screenshot.ts`, `url-readable.ts`, `manual-upload.ts`, `browser.ts`). This story defines the interface + dispatch; the concrete adapters are 6.2/6.3/6.4.
- **Generalizes the prototype's `Processor` (recon).** `processors.ts` has `Processor { type, schema, systemPrompt, capture, validate, buildEntry, summarize }` (`processors.ts:3-18`) — capture AND analysis bundled. v1 splits them: `CaptureAdapter` (capture, this epic) + `LLMProvider`/enrichment (Epic 4/7). The prototype's `Captured = { text, screenshotPath? }` (`processors.ts:1`) is the seed for the adapter's return shape, generalized to `{ fields, assets[] }`.
- **Keyed by `ingest_mode`, not collection type.** The prototype keys processors by collection `type` (inspiration/library); v1 keys capture adapters by the descriptor's `ingest_mode` (`url-screenshot`/`url-readable`/`manual-upload`) — so the same adapter serves any board with that mode. [Source: docs/bmad/architecture.md#4.3]
- **Runs on the Story 5.1 worker (concurrency 1).** Capture jobs execute on the single worker; this story defines the adapter, Story 6.5 enforces the concurrency/timeout. Don't build a separate capture runner.

### The capture contract (target — architecture §4.3)

[Source: docs/bmad/architecture.md#4.3-capture-adapter-contract]
```ts
interface CaptureAdapter { fetch(source: string, ctx): Promise<{ fields: Record<string,unknown>; assets: AssetSpec[] }>; }
```
- Keyed by the board's `ingest_mode`. v1: `url-screenshot` (Inspiration), `url-readable` (Library, SPA fallback), `manual-upload`.
- Concurrency 1 (Story 6.5, on the 5.1 worker); per-capture timeout + `browser.close()` in `finally`.
- Designed sidecar contract: token-authed, idempotent-on-retry. [Source: docs/bmad/architecture.md#4.3]

### Why this design (anti-pattern prevention)

- **Item is source-agnostic (FR-6).** The big generalization: an item is `{fields, assets}`, not "a URL + a screenshot." This is what lets manual-upload (no URL) and future non-URL adapters (image board, YouTube) fit without reworking the item model. Don't bake URL assumptions into `item`. [Source: docs/bmad/PRD.md#FR-6]
- **Capture decoupled from analysis.** The prototype's `Processor` fused capture + analysis. Splitting them (CaptureAdapter vs LLMProvider/enrichment) is what lets enrichment be optional (FR-9) — capture works with no LLM. Keep the seam clean. [Source: docs/bmad/architecture.md#4.3, #4.2]
- **Design the sidecar contract now, extract later (AD4/C2).** The capture service stays in-process in v1, but its contract (token-authed, idempotent) is designed now so v2 can lift it out without a rewrite. Token-auth even on localhost is the NFR-3 posture. Don't skip the token "because it's localhost." [Source: docs/bmad/architecture.md#3-AD4, docs/bmad/PRD.md#NFR-3]
- **Idempotent-on-retry.** Re-capture (Story 7.3 refetch, or a retried job) must not duplicate assets/items. Tie idempotency to the item id (Story 1.5's preserved-id dedupe). [Source: docs/bmad/architecture.md#4.3, docs/bmad/stories/7-3-re-enrich-refetch.md]

### Project Structure Notes

- `capture/adapter.ts` + `.test.ts`. Adapters in `capture/url-screenshot.ts` etc. (6.2-6.4). `browser.ts` (Story 2.3's `launchBrowser`) is the shared launch.
- ESM `.js` specifiers; `node:test`; add the test to the `test` script.

### Testing standards

- Fake adapter for dispatch tests; no real capture in this story's tests.
- Cover dispatch (right adapter), unknown-mode error, and the non-URL (manual) shape.
- Existing suites green.

### References

- [Source: docs/bmad/architecture.md#4.3-capture-adapter-contract] — `CaptureAdapter.fetch`, keyed by ingest_mode, concurrency 1, token-authed idempotent contract.
- [Source: docs/bmad/PRD.md#FR-6] — capture adapter seam + concurrency cap; item not URL-bound.
- [Source: docs/bmad/architecture.md#3-AD4] — capture in-process concurrency 1; sidecar contract designed in v1.
- [Source: processors.ts#1-30] — the prototype `Processor`/`Captured`/registry to generalize into `CaptureAdapter` + ingest dispatch.
- [Source: docs/bmad/stories/1-2-board-descriptor-seeded-boards.md] — the descriptor's `ingest_mode` that keys dispatch.
- [Source: docs/bmad/stories/5-1-single-writer-worker-queue.md] — the worker capture jobs run on.

## Dev Agent Record

### Agent Model Used

_(to be filled by dev agent)_

### Debug Log References

### Completion Notes List

### File List
