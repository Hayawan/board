# Story 13.2: Bookmarklet capture client

Status: review

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

- [x] **Task 1 — Write the failing bookmarklet-payload test first (TDD)** (AC: 1, 2, 5)
  - [x] Pure builder `buildBookmarklet({ instanceUrl, token })` → the `javascript:` string. Test asserts: valid `javascript:` URL, embeds the instance URL, posts to `/api/v1/items`, `Authorization: Bearer <token>`, sends `{url: location.href, title: document.title}`, POST, and a real negative assertion that it does NOT navigate (`!location=`/`assign`/`replace`). Trailing-slash normalization pinned.
  - [x] Ran; confirmed red.
- [x] **Task 2 — Implement the bookmarklet builder** (AC: 1, 2)
  - [x] `capture-clients/bookmarklet.ts` (no new deps): a compact IIFE that `fetch`es `POST {instanceUrl}/api/v1/items` with the bearer header + `{url, title}`, shows a transient in-page banner (success/fail), swallows errors, never navigates. Strings interpolated via `JSON.stringify` (safe escaping).
- [x] **Task 3 — Write the failing settings/help-surface test (TDD)** (AC: 1, 4)
  - [x] Inject test: `GET /bookmarklet` serves HTML containing `/api/v1/items` + `TOKEN_PLACEHOLDER`; an existing-route smoke (`GET /api/collections`) stays green. Confirmed red first.
- [x] **Task 4 — Add the settings/help surface** (AC: 1, 4)
  - [x] `GET /bookmarklet` serves a small self-contained help page: instance URL derived from the request (proxy-safe), a token input, and a draggable link whose href is rebuilt client-side by substituting the operator's token into the placeholder. **12.1 reconciliation:** the server holds only the token *hash*, never the plaintext — so the page ships a `TOKEN_PLACEHOLDER` and the operator fills their own token in the browser; the plaintext never touches the server. Read-only over config (only `tokenConfigured` boolean).
- [x] **Task 5 — Server-side Inbox round-trip test** (AC: 3, 5)
  - [x] `POST /api/v1/items {url, title}` (no `boardId`) → asserts `board_id='inbox'` + optimistic `pending`. **Cheap-enrichment is delegated to 13.1's confound-free discriminating test** (not re-asserted here): in the test harness no capture adapter is registered, so a `complete`-count spy on this route would be a *trivial* zero (the no-adapter confound Quinn flagged in 13.1) — a misleading assertion. Documented inline + in Completion Notes.
- [x] **Task 6 — Wire tests + verify green** (AC: 4, 5)
  - [x] Added `capture-clients/bookmarklet.test.ts` to the `test` script; full suite → **377 pass / 0 fail**, existing suites unaffected.

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

claude-opus-4-8[1m] (BMAD dev-story workflow)

### Debug Log References

- RED → GREEN → full regression: **377 pass / 0 fail**, 59 suites.

### Completion Notes List

- ✅ All ACs satisfied. The bookmarklet is a pure client of the authed `/api/v1/items` (12.2) — no bespoke save path. It sends no board, so the omitted-board→Inbox default (13.1) routes it; cheap enrichment is inherited from 13.1.
- **12.1 reconciliation (the key design decision):** 12.1 deliberately discards the plaintext token (holds only the SHA-256 hash), so the server cannot embed a working token. The help page therefore ships a `TOKEN_PLACEHOLDER` and substitutes the operator's own token entirely client-side — the plaintext never touches the server, logs, or `board.db`. This keeps 12.1's security posture intact.

**Party-mode review (Winston security / Quinn QA) — findings addressed before commit:**
- ✅ [High] **Reflected XSS via the `Host` header** (Winston): `req.headers.host` flowed unescaped into both `<code>${instanceUrl}</code>` (HTML context) and the `JSON.stringify`'d template inside `<script>` (where `JSON.stringify` does NOT escape `/`, so `</script>` breaks out). Fixed with an `htmlEscape` for the HTML context and a `<` → `<` escape for every script-embedded string. Added an XSS regression test injecting a malicious `Host` and asserting no `</script>` breakout / no raw attribute-quote escape. (trustProxy is off, so `req.protocol` is socket-derived, not header-tainted.)
- ✅ [Med] **AC5 cheap-assertion delegated, now documented** (Quinn): the cheap guarantee is proven confound-free in `db/inbox-seed.test.ts` (tier:cheap skips enrichment even on a fields-bearing board); a `complete`-count spy on the v1 round-trip would be a trivial zero (no adapter registered in tests). Documented the deliberate delegation inline + here, per Quinn — did NOT add a naive spy.
- ✅ [Low] Clarified the round-trip `title` field with a comment (server re-derives the canonical title during cheap capture; client title is best-effort).
- 📝 [Low, follow-up] **Server title-drop** (Quinn): `POST /api/v1/items` ignores the client's `title`; capture re-derives it. Tracked for a future 12.2/13.1 pass (title quality can regress on auth-walled/SPA pages where `document.title` is better than a re-fetch).

### File List

- `capture-clients/bookmarklet.ts` (new) — pure `buildBookmarklet({instanceUrl, token})` + `TOKEN_PLACEHOLDER`.
- `capture-clients/bookmarklet.test.ts` (new) — payload tests (endpoint/Bearer/url+title/no-nav, slash normalization), `GET /bookmarklet` serve + placeholder + no-regression smoke, and a Host-header XSS regression test.
- `server.ts` (modified) — `GET /bookmarklet` help-surface route (XSS-safe; instance URL from request; placeholder token).
- `api/v1.test.ts` (modified) — bookmarklet Inbox round-trip ({url,title}+no-board → inbox+pending).
- `package.json` (modified) — appended `capture-clients/bookmarklet.test.ts`.

### Change Log

- 2026-06-23 — Story 13.2 implemented: pure `buildBookmarklet` client + `GET /bookmarklet` help surface (placeholder token, client-side fill — 12.1-safe). The bookmarklet POSTs the current tab to the authed `/api/v1/items` with no board → Inbox. 377 pass / 0 fail.
- 2026-06-23 — Addressed party-mode review: fixed a Host-header reflected-XSS (HTML escape + `<` script escape) with a regression test; documented the deliberate cheap-proof delegation to 13.1 and the best-effort title field.
