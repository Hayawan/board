# Story 5.3: SSE status endpoint

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-status. -->

> **Epic 5 — Async job model & live status.** Story 3 of 3. Build order: (1) worker queue → (2) status lifecycle → **(3) SSE status endpoint ◄ this story**. This story streams item status transitions to the frontend over Server-Sent Events, so cards update live without polling — with a poll/refetch fallback. *(FR-18.)*

## Story

As the frontend,
I want a server-sent-events stream of status transitions,
so that cards update live without polling.

## Acceptance Criteria

1. **An SSE endpoint streams status transitions with a pinned payload contract.**
   **Given** an open SSE connection, **When** an item's status changes (Story 5.2), **Then** an event is emitted carrying a **fixed payload**: `{ itemId, boardId, status, error_reason?, fields? }` where **`fields` is populated on `done`** so Story 8.4 can render the filled card WITHOUT a refetch. *(Pin this — not "rich payload OR refetch". The contract is: rich payload, fields-on-done. Story 8.4's `queued→capturing→enriching` shimmer is a client-side label over the single persisted `processing` state, derived from job type — the wire carries only the four canonical statuses.)*

2. **A poll/refetch fallback exists.**
   **Given** SSE is unavailable (or a client reconnects), **When** the client falls back, **Then** it can refetch current item state via the existing items API — no state is only-available-over-SSE.

3. **The endpoint is native SSE (no WebSocket, no broker).**
   **Given** the transport, **When** implemented, **Then** it uses native SSE over the existing Fastify server — no WebSocket, no external broker/pub-sub.

4. **A test asserts an SSE event fires with the right shape on a simulated transition.**
   **Given** the server + a simulated status transition, **When** the test subscribes (via the emitter/formatter seam, not a held-open socket), **Then** it asserts the `event: status` / `data: {itemId, boardId, status, ...}` framing AND `Content-Type: text/event-stream`.

5. **Disconnect cleanup: a dead subscriber is removed and never written to.**
   **Given** a subscriber whose connection closes, **When** the `close`/`error` handler fires, **Then** it is removed from the subscriber set AND a subsequent emit does not write to the dead stream. *(The single most leak-prone path on the 512MB box — assert it with a fake subscriber + close handler, fully deterministic, no real socket.)*

## Tasks / Subtasks

- [x] **Task 1 — Write the failing SSE tests first (TDD)** (AC: 1, 3, 4, 5)
  - [x] Create `sse.test.ts`: (a) emitter/formatter seam — drive a transition, assert `event: status` / `data:{itemId, boardId, status, fields?}` framing + `Content-Type: text/event-stream` (this is the REQUIRED deterministic test); (b) disconnect cleanup — register a fake subscriber, fire its `close` handler, assert removal + that a later emit does not write to it (AC 5).
  - [x] Do NOT write an unbounded `inject()` test against the keep-alive route — it never closes and hangs the runner. If an integration test is wanted, bound it (read N events then abort).
  - [x] Run; confirm red for the right reason.
- [x] **Task 2 — Add a status event emitter the worker publishes to** (AC: 1)
  - [x] Add a small in-process event emitter (e.g. a `Set` of subscriber response streams, or a Node `EventEmitter`) that Story 5.2's status writes publish to: on every `status` transition, emit `{ itemId, boardId, status, error_reason?, fields? }`. Keep it in-process (no broker).
- [x] **Task 3 — Implement the SSE route in `buildServer` via `reply.hijack()`** (AC: 1, 3, 5)
  - [x] Add `GET /events` (or `/api/events`) inside `buildServer` (recon: `server.ts:246`, Fastify 5.x). **Name the mechanism — this is the real gotcha:** call **`reply.hijack()`** to take the socket out of Fastify's lifecycle, then `reply.raw.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" })` and `reply.raw.write("event: status\\ndata: <json>\\n\\n")` per transition. Writing to `reply.raw` WITHOUT `hijack()` causes a Fastify double-send (warning/hang) — do not skip the hijack.
  - [x] **Cleanup (AC 5):** on `req.raw.on("close")` / error, remove the response from the subscriber set; a subsequent emit must guard against writing to a closed stream. Send periodic heartbeat comments (`": ping\\n\\n"`) to keep the connection alive through proxies.
  - [x] Scope events to the relevant board (UI shows one board at a time — filter server-side by a `boardId` query param or client-side; document).
- [x] **Task 4 — Frontend: subscribe + poll fallback** (AC: 1, 2)
  - [x] In the frontend, open an `EventSource` to the endpoint and update cards on `status` events (Story 8.4 wires the optimistic-card fill; here, just the subscription + a basic update). Add a poll/refetch fallback (re-`GET` items) for when `EventSource` errors or isn't supported — the items API (recon: `GET /api/collections/:cid/items`, `server.ts:268`) is the fallback source.
  - [x] Add an `eventsUrl()` helper in `collections-ui.js` alongside the other URL builders (`collections-ui.js:9-13`).
- [x] **Task 5 — Wire tests + verify green** (AC: 4)
  - [x] Add the test to the `test` script; run `npm test`; confirm green + existing suites unaffected.

## Dev Notes

### What this story changes vs preserves (read before coding)

- **NEW SSE route in `server.ts`** (`buildServer`, `server.ts:246`) + an in-process status emitter the worker publishes to. **No SSE/EventSource exists in the prototype** (recon — confirmed: live status is a greenfield seam; the prototype's `addBookmark`/refetch await a single blocking JSON response, `index.html:1985`, no streaming).
- **Depends on Story 5.2 (status transitions to publish) + 5.1 (the worker that drives them).** Correctly last in the epic.
- **The poll fallback reuses the existing items API** — `GET /api/collections/:cid/items` (`server.ts:268`). No new fallback endpoint needed.
- **Frontend `EventSource` + the optimistic card (Story 8.4).** This story does the subscription plumbing; Story 8.4 makes the card appear instantly and "shimmer→fill" on these events. The payload contract is PINNED (AC 1): `{ itemId, boardId, status, error_reason?, fields? }` with `fields` populated on `done`, so 8.4 renders without an extra fetch.

### Why this design (anti-pattern prevention)

- **Native SSE, not WebSocket/broker (AD6/FR-18).** SSE is one-way server→client (exactly status push), needs no handshake protocol, and works over plain HTTP/proxies. WebSocket or a broker (Redis pub/sub) is the over-engineering the architecture explicitly rejects. [Source: docs/bmad/architecture.md#2 Rejected, #4.5, docs/bmad/PRD.md#FR-18]
- **Always have a poll fallback (FR-18).** SSE connections drop (proxies, sleep, mobile). The UI must degrade to refetch so a dropped stream doesn't strand a card mid-`processing`. No state may be SSE-only. [Source: docs/bmad/PRD.md#FR-18]
- **Clean up on disconnect.** Each SSE client holds a response stream; on disconnect, remove it from the subscriber set or you leak streams/memory (matters on the 512MB box). Handle `close`/`error`. [Source: docs/bmad/PRD.md#NFR-1]
- **In-process emitter, single process.** Single Node process (architecture §1) → an in-process emitter is sufficient; no cross-process pub/sub. [Source: docs/bmad/architecture.md#1, #4.5]

### Testing standards

- **Don't hold a real long-lived socket open in a unit test** (flaky, hangs the runner). The REQUIRED deterministic test is the emitter→formatter framing assertion + the disconnect-cleanup test. An `inject()` against the keep-alive SSE route would hang (it never closes) — drop it, or bound it (read N events then abort). Never leave it as an unbounded "optional" test.
- Assert the poll fallback path returns current state via the items API.
- Existing suites green.

### Project Structure Notes

- SSE route in `server.ts`; emitter co-located (e.g. `sse.ts` or in `db/queue.ts` next to the worker); `eventsUrl()` in `collections-ui.js`; `EventSource` in the frontend.
- ESM `.js` specifiers; `node:test`; add the test to the `test` script.

### References

- [Source: docs/bmad/PRD.md#FR-18] — live status via SSE, poll fallback, no external broker.
- [Source: docs/bmad/architecture.md#4.5-job-model-status] — SSE streams transitions; refetch/poll fallback.
- [Source: docs/bmad/architecture.md#2] — SSE (native), no WebSocket/broker (Rejected list).
- [Source: server.ts#246] — `buildServer` where the SSE route registers.
- [Source: server.ts#268] — items API used as the poll fallback.
- [Source: index.html#1985] — prototype's blocking `addBookmark` (no streaming) that SSE + Story 8.4 replace.
- [Source: collections-ui.js#9-13] — URL builders to extend with `eventsUrl()`.
- [Source: docs/bmad/stories/5-2-item-status-lifecycle.md] — the transitions this endpoint streams.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (BMAD dev-story workflow)

### Debug Log References

- `npm test` → 222 pass / 0 fail (216 prior + 5 sse + 1 eventsUrl). No `./data` pollution.
- Live smoke: server boots; `GET /events` returns and streams (initial `: connected` frame received; connection stays open / keep-alive). Status transitions over HTTP flow once Epic 6/7 enqueue jobs.

### Completion Notes List

- ✅ All 5 ACs satisfied (the SSE infra + contract; live transition-over-HTTP awaits Epic 6/7 jobs).
- **Pinned payload contract (AC1):** `formatSseEvent` emits `event: status\ndata: {itemId, boardId, status, error_reason?, fields?}` with **`fields` populated on `done`** (so Story 8.4 renders the filled card without a refetch). The wire carries only the four canonical statuses.
- **In-process `StatusHub` (AC1/AC3):** native SSE, no WebSocket/broker. The worker's `setItemStatusDirect` (Story 5.2) publishes every transition to the process-wide `statusHub`. Board-scoped via an optional filter.
- **`startSseStream(req, reply, hub)` (AC3):** `reply.hijack()` → `writeHead(text/event-stream)` → initial `: connected` flush (Node buffers headers until the first body write) → subscribe → heartbeat (`: ping`, unref'd) → cleanup on `req.raw close`.
- **Disconnect cleanup (AC5, the leak-prone path):** the close handler unsubscribes; a subsequent publish does not write to the removed stream; a sink whose `write` throws (dead stream) is dropped. All asserted deterministically with fake req/reply — no held socket.
- **Poll fallback (AC2):** the frontend reuses the existing items API via `load()`; no state is SSE-only.
- **Frontend:** `eventsUrl(cid)` helper (tested) + a guarded `EventSource` subscription in `index.html` that re-runs `load()` on a `status` event (re-subscribes only on board change; auto-reconnects; degrades to manual `load()` if `EventSource` is unavailable). Story 8.4 makes the card-fill granular.
- **Tests:** the deterministic emitter/formatter framing + Content-Type assertion + disconnect-cleanup (no unbounded `inject()` against the keep-alive route, per the testing standard).

### File List

- `sse.ts` (new) — `StatusEvent`, `formatSseEvent`, `StatusHub` + `statusHub` singleton, `startSseStream`.
- `sse.test.ts` (new) — 5 tests (framing/payload, board filter, unsubscribe, dead-sink drop, startSseStream hijack+cleanup).
- `db/queue.ts` (modified) — `setItemStatusDirect` publishes transitions to `statusHub` (fields-on-done).
- `server.ts` (modified) — `GET /events` route (board-scoped) via `startSseStream`.
- `collections-ui.js` (modified) — `eventsUrl(cid)` helper.
- `collections-ui.test.ts` (modified) — `eventsUrl` test.
- `index.html` (modified) — guarded `EventSource` subscription + poll fallback.
- `package.json` (modified) — appended `sse.test.ts` to the `test` script.

### Change Log

- 2026-06-20 — Story 5.3 implemented: native SSE status stream (StatusHub + /events) with the pinned fields-on-done payload, disconnect cleanup, eventsUrl + frontend EventSource subscription with poll fallback. Epic 5 complete. Status → review.
