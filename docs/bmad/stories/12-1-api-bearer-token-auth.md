# Story 12.1: Static bearer-token auth for the API surface

Status: draft

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Epic 12 — Public API & auth keystone.** Story 1 of 2. Build order: **(1) bearer-token auth ◄ this story** → (2) CRUD item + board API. Auth lands first because 12.2's CRUD routes are registered *behind* this guard, and 12.2's test harness inherits it. CRUD + a single static bearer token ship as one unit (an unauthenticated write API on a self-hosted box is the one hard line). *(D1, NFR-3, NFR-BC.)*

## Story

As a self-hoster,
I want the new API to require a static bearer token,
so that exposing a write endpoint to a browser client doesn't open my box to anonymous writes.

## Acceptance Criteria

1. **Token configured via env, stored hashed.**
   **Given** a `BOARD_API_TOKEN` env var (read through `loadConfig`, `config.ts:73`), **When** the app boots, **Then** only a SHA-256 **hash** of the token is held in memory and used for comparison — the plaintext token is never logged, never serialized (mirroring the `apiKey` non-enumerable + `[REDACTED]` redaction model, `config.ts:97-102,#125-144`), and never written to `board.db`.

2. **Guarded routes reject missing/bad tokens.**
   **Given** an API request to any `/api/v1/*` route **without** a valid `Authorization: Bearer <token>` header (missing, malformed, or wrong token), **When** it hits the v1 surface, **Then** the request returns `401` and the `preHandler` short-circuits so the route handler never runs (no write, no DB mutation). Comparison uses `crypto.timingSafeEqual` over the hashes (constant-time; no early-exit timing leak).

3. **Existing routes unaffected.**
   **Given** the existing SPA routes (`/`, `/index.html`, `/screenshots/*`), the legacy flat-JSON routes (`GET /api/bookmarks` at `server.ts:552`, `/api/add`, `/api/bookmarks/:id`, …), and the existing SQLite routes (`/api/collections/*`, `/api/items/:id`, `/skills/:name`), **When** the v1 guard is added, **Then** every one of them serves **exactly as before** with no `Authorization` header — the guard is structurally scoped to the `/api/v1` plugin only and cannot reach the root app's routes. *(NFR-BC)*

4. **CORS scoped for the extension/PWA origin.**
   **Given** a cross-origin client calling `/api/v1/*`, **When** the request is handled, **Then** CORS allows only the configured origin(s) (a `BOARD_API_CORS_ORIGINS` env list, defaulting to no cross-origin allowed) via `@fastify/cors` registered **inside** the v1 plugin; the legacy/SPA routes get no CORS headers (unchanged behavior).

5. **Tests cover allow/deny + no-plaintext.**
   **Given** a `buildServer({ apiToken })` with an injected known token, **When** the tests `inject()` (a) a `/api/v1/*` request bearing the valid token, (b) one with a missing header, and (c) one with a garbage token, **Then** they assert `200/expected` for (a) and `401` for (b) and (c); and a no-regression test injects an existing route (`GET /api/bookmarks`) with no header and asserts it still serves; and an assertion confirms the plaintext token never appears in the captured logger output nor in any serialization of `config`.

## Tasks / Subtasks

- [ ] **Task 1 — Write the failing auth tests first (TDD)** (AC: 2, 3, 5)
  - [ ] In a new `api/v1.test.ts` (or extend `server.test.ts`): build `buildServer({ apiToken: "test-token", db: <temp seeded db> })`. Mount a trivial probe route under the v1 plugin for the test (or use a 12.2 route once it exists) so there is a `/api/v1/*` target.
  - [ ] `inject()` a `/api/v1/*` GET with `Authorization: Bearer test-token` → assert it reaches the handler (not 401).
  - [ ] `inject()` the same route with NO header → assert `401`; with `Authorization: Bearer wrong` → assert `401`.
  - [ ] `inject()` `GET /api/bookmarks` (legacy) with NO header → assert it serves unchanged (NFR-BC regression). (AC: 3)
  - [ ] Run; confirm red.
- [ ] **Task 2 — Add the token to config (hashed, redacted) (TDD)** (AC: 1)
  - [ ] In `config.test.ts`: assert `loadConfig({ BOARD_API_TOKEN: "x" })` exposes a way to verify a token WITHOUT exposing the plaintext, and that `JSON.stringify(config)` / `util.inspect(config)` / `String(config)` never contain the plaintext (extend the existing redaction tests). Run; confirm red.
  - [ ] In `config.ts:73` add `BOARD_API_TOKEN` (cleaned) → store only its SHA-256 hash (`node:crypto`), set NON-ENUMERABLE like `apiKey` (`config.ts:97-102`) so it drops out of every serialization surface; add `BOARD_API_CORS_ORIGINS` (comma-split list). Minimal impl to green.
- [ ] **Task 3 — Add the bearer guard as a `preHandler` inside an encapsulated v1 plugin** (AC: 2)
  - [ ] New module `api/v1.ts` exporting a Fastify plugin registered with `prefix: "/api/v1"`. The plugin holds a `preHandler` (or `onRequest`) hook that hashes the incoming bearer token and compares with `crypto.timingSafeEqual` against the configured hash; on mismatch/missing → `reply.code(401).send(...)` and return (handler never runs).
  - [ ] The hook reads the hash from an injected value, NOT the global `config` (so tests are hermetic — see Task 4).
- [ ] **Task 4 — Wire the injectable token into `buildServer`** (AC: 5)
  - [ ] Add `apiToken?: string` (or `apiTokenHash?: string`) to `BuildServerOptions` (`server.ts:304-313`), defaulting to the configured hash from `config` (exactly like `db`/`queue`/`llm` already default). Register the v1 plugin in `buildServer` passing the resolved hash. This is the seam that makes AC5 testable without mutating `process.env`.
- [ ] **Task 5 — Add `@fastify/cors` scoped to the v1 plugin** (AC: 4)
  - [ ] **Dependency-policy precondition (BLOCKING):** before installing, run `socket package score npm @fastify/cors@11.2.0 --json` (latest resolved at spec time) and confirm `supply_chain ≥ 0.80`, `quality ≥ 0.70`, `vulnerability ≥ 0.80`, `maintenance ≥ 0.50`. If any threshold fails, stop and surface to the user; do not install.
  - [ ] Register `@fastify/cors` INSIDE the v1 plugin with `origin` = the configured allowlist (`BOARD_API_CORS_ORIGINS`), so only v1 emits CORS headers. Add a test asserting a configured origin is allowed and an unconfigured one is not.
- [ ] **Task 6 — Verify green + no regression** (AC: 3, 5)
  - [ ] Add the new test file to the `test` script; run `npm test`; confirm green AND every existing suite (legacy + collections + skills) is unaffected.

## Dev Notes

### What this story changes vs preserves (read before coding)

- **Adds a NEW, separate API surface — does not touch existing routes.** The v1 surface lives in a new encapsulated Fastify plugin mounted at `/api/v1`. Everything currently on the root `app` in `server.ts` (the SPA `/`, `/screenshots/*`, legacy `/api/bookmarks` at `server.ts:552`, `/api/collections/*`, `/api/items/:id`, `/skills/:name`) is registered on the root and is structurally outside the plugin's encapsulation context — the guard and CORS cannot reach them. This is how NFR-BC is *guaranteed*, not merely intended. *(NFR-BC)*
- **Pulls a MINIMAL slice of auth forward from the reverse-proxy model.** The prototype/v1 posture is reverse-proxy-only, no built-in auth (see `warnIfExposed`, `server.ts:64-71`, AD7). This story does NOT replace that posture for the existing surface — it adds one static bearer token guarding ONLY the new write API that browser clients (12.2 → bookmarklet/PWA/extension) will call cross-origin. No multi-user, no sessions.
- **Reuses the existing secret model for the token.** The token hash is stored NON-ENUMERABLE on `config` and redacted in every serialization surface, exactly like `provider.apiKey` (`config.ts:97-102`, `config.ts:125-144`). No new redaction machinery.

### Why this design (anti-pattern prevention)

- **Encapsulated plugin scoping, NOT a global hook with URL-prefix matching.** A global `onRequest` hook that does `req.url.startsWith('/api/v1')` is fragile: it mishandles trailing slashes, query strings, and case, and can both leak onto unintended routes and miss intended ones. A Fastify plugin registered with `prefix: "/api/v1"` encapsulates its `preHandler` + CORS to exactly that subtree — the guarantee is structural, which is what NFR-BC AC3 requires. [Source: server.ts#552, docs/bmad/epics-v2.md#L74]
- **Hash + constant-time compare, no new crypto dep.** Compare a SHA-256 hash of the incoming token against the stored hash with `crypto.timingSafeEqual` (constant-time, avoids a timing oracle). `node:crypto` is built in — do NOT reach for bcrypt/argon2 (a static deployment secret is not a user password; bcrypt would add a dependency to score for no security gain here). [Source: config.ts#97-102]
- **Never store/log the plaintext token.** Hold only the hash; mark it non-enumerable on `config` so it drops out of `JSON.stringify`/`util.inspect`/spread — the same proven pattern as `apiKey`. A leaked token in a debug log defeats the entire guard. [Source: config.ts#125-144, docs/bmad/epics-v2.md#L82]
- **Inject the token into `buildServer`, don't read the global in the hook.** `config` is resolved once from `process.env` at module load (`config.ts:156`), so a test cannot flip the token by mutating env. Adding `apiToken`/`apiTokenHash` to `BuildServerOptions` (the same injection seam as `db`/`queue`/`llm`, `server.ts:304-313`) makes allow/deny hermetically testable via `inject()`. [Source: server.ts#304-313]

### Project Structure Notes

- New module `api/v1.ts` (the encapsulated v1 plugin: bearer `preHandler` + `@fastify/cors`); registered from `buildServer` in `server.ts`.
- `config.ts:73` (`loadConfig`) gains `BOARD_API_TOKEN` (hashed, non-enumerable) + `BOARD_API_CORS_ORIGINS`.
- `BuildServerOptions` (`server.ts:304-313`) gains `apiToken`/`apiTokenHash` (injectable; defaults to the configured hash).
- ESM `.js` import specifiers; `node:test` + Fastify `inject()`; add the new test file to the `test` script.

### Testing standards

- Hermetic: `buildServer({ apiToken: "test-token", db: <temp seeded db> })` — never mutate `process.env` (the `config` singleton is frozen at load).
- Assert all three auth outcomes (valid → reaches handler; missing → 401; wrong → 401) via `inject()`.
- The NFR-BC test is mandatory: `inject()` an existing legacy route (`GET /api/bookmarks`) with NO `Authorization` header and assert it still serves unchanged.
- Assert no-plaintext: capture an injected logger and assert the token string never appears; assert `JSON.stringify(config)` / `String(config)` / `util.inspect(config)` never contain it (extend `config.test.ts`).
- 12.2's CRUD tests will run *with* a valid token but must not re-test auth — auth coverage lives here.

### References

- [Source: docs/bmad/epics-v2.md#L72-L86] — Epic 12 goal + Story 12.1 ACs (token hashed/never-logged, 401 on guarded routes, existing routes unaffected, CORS scoped, allow/deny + no-plaintext tests).
- [Source: docs/bmad/epics-v2.md#L24-L33] — wave-wide NFR-BC: the new token-authed API is a separate surface, not a replacement of existing routes.
- [Source: config.ts#73] — `loadConfig` (where `BOARD_API_TOKEN` + CORS-origins env are read).
- [Source: config.ts#97-102] — the `apiKey` non-enumerable definition pattern to mirror for the token hash.
- [Source: config.ts#125-144] — `redact`/`attachRedaction`: the toJSON/toString/inspect redaction surfaces the token must also drop out of.
- [Source: config.ts#156] — `config` singleton resolved from `process.env` at load (why the token must be injectable, not env-mutated).
- [Source: server.ts#304-313] — `BuildServerOptions`: the existing `db`/`queue`/`llm` injection seam the `apiToken` follows.
- [Source: server.ts#315] — `buildServer` (where the v1 plugin is registered).
- [Source: server.ts#552] — legacy `GET /api/bookmarks`: the unguarded flat-JSON route that must keep serving (NFR-BC).
- [Source: server.ts#64-71] — `warnIfExposed`: the reverse-proxy-only / no-built-in-auth posture this story minimally augments (AD7).
- [Source: registry.ts#52-62] — the fixed v1 skill list (context: the v1 API is REST, not a skill — carried into 12.2).

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

### Change Log
