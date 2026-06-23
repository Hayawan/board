# Story 13.3: PWA + Web Share Target (mobile capture)

Status: draft

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Epic 13 — Capture funnel.** Story 3 of 4. Build order: (1) Inbox + cheap capture → (2) bookmarklet → **(3) PWA + Web Share Target ◄ this story** → (4) extension review lane (fast-follow). Mobile is where the firehose lives: make board-oss installable and register it as a native share target so any app can save a URL to the Inbox in one tap. *(D4; depends on Epics 12 + 13.1; NFR-BC.)*

## Story

As a mobile user,
I want board-oss in my native share sheet,
so that I can save inspiration from any app with one tap.

## Acceptance Criteria

1. **Installable PWA.**
   **Given** the app, **When** visited on a supported mobile browser, **Then** it offers install — a valid Web App **manifest** (name, icons, `start_url`, `display`) linked from `index.html`, plus a registered **service worker** (minimal: at least registers cleanly and serves the app shell).

2. **Registers as a share target.**
   **Given** the installed PWA, **When** I share a URL from another app, **Then** board-oss appears in the OS share sheet and receives the shared URL — the manifest declares a `share_target` (method/enctype + `params` mapping `url`/`text`/`title`) pointing at an in-app share-handler route.

3. **Share → Inbox, one tap, return.**
   **Given** a shared URL arrives at the share-handler route, **When** I tap save, **Then** it `POST`s to the authed `POST /api/v1/items` (Story 12.2) with **no** target board, so it lands in the **Inbox** with **cheap** enrichment (Story 13.1) sub-second; then it returns me to where I was (the handler does not trap me in a full app session).

4. **No-regression on desktop.**
   **Given** the manifest + service-worker additions, **When** the app is loaded on desktop, **Then** existing SPA behavior, collection routes, item routes, and the SSE live-fill are **unchanged** — the SW registration is additive and must not intercept/break existing routes or the dev flow. *(NFR-BC)*

5. **Tests.**
   **Given** the served manifest, **When** the test fetches it, **Then** it asserts a valid manifest with icons + a `share_target` whose `action` is the in-app handler and whose `params` map the shared URL; **And** a share-handler test injects a shared payload and asserts it creates an **Inbox** item (`board_id='inbox'`) via the authed API, cheap (spy LLM `complete` count = 0, reusing 13.1's fixtures); **And** a regression test asserts existing routes/SSE still serve unchanged with the manifest/SW present.

## Tasks / Subtasks

- [ ] **Task 1 — Write the failing manifest test first (TDD)** (AC: 1, 2, 5)
  - [ ] Add a test that fetches `/manifest.webmanifest` (inject) and asserts: valid JSON, required keys (`name`, `icons`, `start_url`, `display`), and a `share_target` with `method`/`enctype` + `params` mapping `url` (and `text`/`title`) to the share-handler `action`.
  - [ ] Run; confirm red (no manifest served yet).
- [ ] **Task 2 — Serve the manifest + link it from `index.html`** (AC: 1, 2)
  - [ ] Serve `manifest.webmanifest` (static or a small route) with the `share_target` declaration; add `<link rel="manifest" ...>` + theme/icon meta to `index.html` `<head>` (where the theme bootstrap already sits, `index.html:8-14`). Provide PWA icons.
- [ ] **Task 3 — Register a minimal service worker** (AC: 1, 4)
  - [ ] Add a small `sw.js` (cache the app shell / pass-through fetch) and register it from `index.html`. Keep it **scoped** so it does not intercept `/api/*` or `/screenshots/*` in a way that breaks SSE or dev — register additively; assert (Task 6) existing routes unchanged.
- [ ] **Task 4 — Write the failing share-handler test (TDD)** (AC: 3, 5)
  - [ ] Add a test that injects a share payload (the shape the `share_target` posts) to the share-handler route and asserts it results in an authed `POST /api/v1/items` creating an **Inbox** item (`board_id='inbox'`), cheap (spy LLM `complete` count = 0), and that the handler returns/redirects in a way that returns the user (no trap).
  - [ ] Run; confirm red.
- [ ] **Task 5 — Implement the share-handler route** (AC: 3)
  - [ ] Add the in-app route the `share_target` posts to: extract the shared URL (and title/text), forward it to the authed `/api/v1/items` create (no board → Inbox via 13.1), confirm, and return the user. Reuse the 12.2 create path — do **not** add a second capture path.
- [ ] **Task 6 — Desktop no-regression test + wire tests green** (AC: 4, 5)
  - [ ] Add a regression test asserting existing SPA routes, collection/item routes, and SSE still serve unchanged with the manifest/SW present. Add all new tests to the `test` script; run the suite; confirm green and existing suites unaffected.

## Dev Notes

### What this story changes vs preserves (read before coding)

- **Adds:** a Web App manifest (with `share_target`), PWA icons, a minimal service worker, a `<link rel="manifest">` + meta in `index.html` `<head>`, and one in-app **share-handler route** that forwards to the authed create.
- **Depends on:** Story 12.1 (token + `/api/v1/*` guard), Story 12.2 (`POST /api/v1/items`), Story 13.1 (omitted-board → Inbox + cheap tier). The share handler is a **client** of those.
- **Preserves (NFR-BC):** the SW registration is additive and **must not** alter existing SPA behavior on desktop, nor intercept `/api/*`/SSE/`/screenshots/*` in a breaking way; collection + item routes are untouched. *(docs/bmad/epics-v2.md:139)*

### Why this design (anti-pattern prevention)

- **Share handler forwards to the one authed create endpoint.** No bespoke mobile save path — the `share_target` route calls the same `/api/v1/items` (12.2) the bookmarklet/extension use. [Source: docs/bmad/epics-v2.md#L94, docs/bmad/epics-v2.md#L137]
- **No board on share → Inbox by default.** The handler sends no target; the omitted-board→Inbox default (13.1) routes it, keeping the client dumb and capture cheap. [Source: docs/bmad/stories/13-1-inbox-board-cheap-capture.md, docs/bmad/epics-v2.md#L138]
- **SW must be additive — desktop is the regression risk.** A service worker that caches/intercepts wrongly can break the SSE live-fill (`text/event-stream`, `sse.ts:97-104` — a long-lived stream a caching SW must never buffer) or the dev flow. Scope it, pass through `/api/*`, and prove desktop routes/SSE unchanged. [Source: docs/bmad/epics-v2.md#L139, sse.ts#L97]
- **Return the user (one tap, zero trap).** The share flow saves sub-second and returns — never opens a full session the user must dismiss. [Source: docs/bmad/epics-v2.md#L138]

### Project Structure Notes

- Live store is **SQLite at `data/board.db` (WAL) via `getDb()`/Drizzle**; the share handler saves through the authed API (Epic 12). Legacy flat-JSON is import-source only.
- Manifest + `sw.js` + icons served from the existing Fastify static surface (the app already serves `index.html` via `reply.sendFile`, `server.ts:453`, and streams `/screenshots/`, `server.ts:333-338`). Manifest `<link>` + meta attach in `index.html` `<head>` (`index.html:3-14`).
- Share-handler route in `server.ts`. ESM `.js` specifiers; `node:test` + `inject()`. Add tests to the `test` script.

### Testing standards

- **Manifest test**: fetch + assert required keys + `share_target` `action`/`params` mapping the shared URL.
- **Share-handler test**: inject the share payload → assert Inbox item (`board_id='inbox'`) via the authed create, cheap (spy LLM `complete` = 0, 13.1 fixtures), and that it returns the user.
- **Desktop regression test**: existing SPA/collection/item routes + SSE serve unchanged with manifest/SW present (mandated boot/regression discipline, `docs/bmad/epics-v2.md:32`).
- Keep all existing suites green.

### References

- [Source: docs/bmad/epics-v2.md#L130-L139] — Story 13.3 ACs (installable PWA, share target, share→Inbox, desktop no-regression).
- [Source: index.html#L1-L14] — `<head>` where the manifest `<link>`/meta + SW registration attach (theme bootstrap already lives here).
- [Source: server.ts#L453] — `app.get("/")` serves `index.html` via `reply.sendFile` (the static surface the manifest/SW/icons join).
- [Source: server.ts#L333-L338] — the `/screenshots/` static stream (an existing static-serving pattern; SW must not break it).
- [Source: docs/bmad/epics-v2.md#L88-L99] — Story 12.2 `POST /api/v1/items` (the share handler forwards here).
- [Source: docs/bmad/stories/13-1-inbox-board-cheap-capture.md] — omitted-board → Inbox + cheap-tier capture (the share path relies on both).
- [Source: docs/bmad/epics-v2.md#L24-L32] — NFR-BC: manifest/SW additions must not regress desktop.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

### Change Log
