# Story 13.2: Bookmarklet capture client

Status: draft

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Epic 13 — Capture funnel.** Story 2 of 4. Build order: (1) Inbox + cheap capture → **(2) bookmarklet ◄ this story** → (3) PWA share-target → (4) extension review lane (fast-follow). This story is the cheapest desktop unblock: a `javascript:` bookmarklet that saves the current tab to the Inbox in one click via the token-authed API. *(D3; depends on Epics 12 + 13.1; NFR-BC.)*

## Story

As a desktop user,
I want a one-click bookmarklet,
so that I can save the current tab to my Inbox without leaving the page.

## Acceptance Criteria

1. **Bookmarklet served + copyable.**
   **Given** a settings/help surface in the app, **When** I view it, **Then** I get a ready-to-drag `javascript:` bookmarklet (or copyable string) **pre-filled with my instance URL and bearer token** (Story 12.1) so it calls **my** instance's authed capture endpoint.

2. **One click saves + confirms, without navigating away.**
   **Given** I have installed the bookmarklet and click it on any page, **When** it runs, **Then** it `POST`s `{url, title}` (the current tab's `location.href` + `document.title`) to `POST /api/v1/items` (Story 12.2) with `Authorization: Bearer <token>`, shows a small inline confirmation, and does **not** navigate me off the page (no full-page redirect; it returns/auto-dismisses).

3. **Lands in the Inbox with cheap enrichment.**
   **Given** the bookmarklet POSTs with **no** target board, **When** the item is created, **Then** it lands in the **Inbox** (the omitted-board→Inbox default, Story 13.1) with **cheap** enrichment only (no expensive AI takeaway, Story 13.1 AC 3), sub-second and non-blocking.

4. **No-regression.**
   **Given** the new settings/help surface that renders the bookmarklet, **When** it is added, **Then** the existing SPA routes, collections, and item routes are unaffected — the bookmarklet surface only **reads** config (instance URL + token) and adds no behavior to existing routes. *(NFR-BC)*

5. **Tests / manual proof.**
   **Given** the generated bookmarklet payload, **When** the test inspects it, **Then** it asserts the payload targets the authed `/api/v1/items` endpoint with the configured instance URL + a `Bearer` token and posts `{url, title}`; **And** a server-side round-trip test injects an authed `POST /api/v1/items {url, title}` with no board and asserts the created item is on the **Inbox** (`board_id = 'inbox'`) and stays cheap (spy LLM `complete` not called — reuses 13.1's contract).

## Tasks / Subtasks

- [ ] **Task 1 — Write the failing bookmarklet-payload test first (TDD)** (AC: 1, 2, 5)
  - [ ] Add a pure builder `buildBookmarklet({ instanceUrl, token })` returning the `javascript:` string. Test it: the string is a valid `javascript:` URL, embeds the configured `instanceUrl`, posts to `/api/v1/items`, sets `Authorization: Bearer <token>`, and sends `{url: location.href, title: document.title}`. Assert it does **not** include a navigation/redirect to the app.
  - [ ] Run; confirm red (builder does not exist yet).
- [ ] **Task 2 — Implement the bookmarklet builder** (AC: 1, 2)
  - [ ] Implement `buildBookmarklet` (minimal, no new deps): a small inline IIFE that `fetch`es `POST {instanceUrl}/api/v1/items` with the bearer header and `{url, title}`, shows a tiny transient confirmation (e.g. a brief banner), and swallows/reports errors without navigating. URL-encode the body; keep the payload compact.
- [ ] **Task 3 — Write the failing settings/help-surface test (TDD)** (AC: 1, 4)
  - [ ] Add a route/handler test (inject) that the help surface renders the bookmarklet built from `config` (instance URL + the configured token), and that adding it does **not** alter existing routes (existing route smoke still green).
  - [ ] Run; confirm red.
- [ ] **Task 4 — Add the settings/help surface** (AC: 1, 4)
  - [ ] Serve a small settings/help fragment (or extend the existing UI) that shows the draggable bookmarklet built from `config`. Read-only over config — no new write path. Token is the 12.1 static token (display guidance: treat it like a password).
- [ ] **Task 5 — Server-side Inbox round-trip test** (AC: 3, 5)
  - [ ] Inject an authed `POST /api/v1/items {url, title}` (no `boardId`) against a temp DB seeded with the Inbox (13.1); assert the created item is `board_id='inbox'`, returns optimistic `pending`, and the capture path is cheap (spy LLM `complete` count = 0). Reuse 13.1's spy-LLM + fake-adapter fixtures.
- [ ] **Task 6 — Wire tests + verify green** (AC: 4, 5)
  - [ ] Add the new test file(s) to the `test` script; run the suite; confirm green and existing suites unaffected.

## Dev Notes

### What this story changes vs preserves (read before coding)

- **Adds:** a pure `buildBookmarklet({ instanceUrl, token })` builder + a read-only settings/help surface that renders it. No schema change, no new write path.
- **Depends on:** Story 12.1 (static bearer token + the `/api/v1/*` guard) and Story 12.2 (`POST /api/v1/items` optimistic create) and Story 13.1 (omitted-board → Inbox default + cheap tier). The bookmarklet is purely a **client** of those endpoints.
- **Preserves (NFR-BC):** existing SPA + collection + item routes are untouched; the settings surface only **reads** config. No change to capture/enrich behavior beyond what 13.1 already established. *(docs/bmad/epics-v2.md:30, :139)*

### Why this design (anti-pattern prevention)

- **No new save path — reuse the authed CRUD endpoint.** The bookmarklet must POST to the **same** `/api/v1/items` (12.2) every client uses; do not add a bespoke capture route. One save contract, token-authed. [Source: docs/bmad/epics-v2.md#L94, docs/bmad/epics-v2.md#L126]
- **Token-authed even for a one-liner.** An unauthenticated write on a self-hosted box is the hard line (D1). The bookmarklet carries the `Bearer` token (12.1); the builder embeds the configured token. [Source: docs/bmad/epics-v2.md#L82, docs/bmad/epics-v2.md#L74]
- **Don't navigate the user away.** A bookmarklet that redirects to the app breaks "one tap, zero decisions, stay where you are" (D2). Use `fetch` + a transient in-page confirmation; never a full-page nav. [Source: docs/bmad/epics-v2.md#L126]
- **Lands in the Inbox by omission.** The bookmarklet sends no board; the omitted-board→Inbox default (13.1) does the routing — the client stays dumb. [Source: docs/bmad/stories/13-1-inbox-board-cheap-capture.md, docs/bmad/epics-v2.md#L127]

### Project Structure Notes

- Live store is **SQLite at `data/board.db` (WAL) via `getDb()`/Drizzle**; this client saves through the authed API (Epic 12). Legacy flat-JSON is import-source only.
- New pure builder (e.g. `capture-clients/bookmarklet.ts`) — no deps; settings/help surface served from the existing Fastify app (`server.ts`) / SPA.
- ESM `.js` specifiers; `node:test` + `inject()` for the route round-trip. Add tests to the `test` script.

### Testing standards

- **Payload test is pure** (no server): assert endpoint, instance URL, `Bearer` header, `{url, title}` body, and no navigation.
- **Round-trip test** uses inject + a temp DB seeded with the Inbox (13.1) + the spy-LLM/fake-adapter fixtures: assert `board_id='inbox'`, optimistic `pending`, and cheap (`complete` count = 0).
- An unauthenticated `POST /api/v1/items` must 401 (covered by 12.1; assert here too as a guardrail if convenient).
- Keep all existing suites green.

### References

- [Source: docs/bmad/epics-v2.md#L119-L128] — Story 13.2 ACs (bookmarklet served/copyable, one-click save w/o nav, lands in Inbox).
- [Source: docs/bmad/epics-v2.md#L76-L86] — Story 12.1: static bearer token + the `/api/v1/*` guard the bookmarklet authenticates against.
- [Source: docs/bmad/epics-v2.md#L88-L99] — Story 12.2: `POST /api/v1/items` optimistic create (the endpoint the bookmarklet calls).
- [Source: docs/bmad/stories/13-1-inbox-board-cheap-capture.md] — omitted-board → Inbox default + cheap-tier capture (this client relies on both).
- [Source: server.ts#L491-L508] — the existing optimistic create route shape (the v1 route mirrors it).
- [Source: docs/bmad/epics-v2.md#L24-L32] — NFR-BC: the new surface must not regress existing routes.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

### Change Log
