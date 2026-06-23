# Story 12.1: Static bearer-token auth for the API surface

Status: review

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

- [x] **Task 1 — Write the failing auth tests first (TDD)** (AC: 2, 3, 5)
  - [x] In a new `api/v1.test.ts`: build `buildServer({ apiToken: "test-token", db: <temp seeded db> })`. Mounted a trivial `GET /api/v1/ping` probe route under the v1 plugin so there is a `/api/v1/*` target before 12.2's CRUD lands.
  - [x] `inject()` a `/api/v1/*` GET with `Authorization: Bearer test-token` → asserts it reaches the handler (200, `{ok:true}`).
  - [x] `inject()` the same route with NO header → `401`; with `Authorization: Bearer wrong-token` and a malformed (no-scheme) header → `401`.
  - [x] `inject()` `GET /api/bookmarks` (legacy) + `GET /api/collections` with NO header → assert they serve unchanged (NFR-BC regression). (AC: 3)
  - [x] Ran; confirmed red.
- [x] **Task 2 — Add the token to config (hashed) (TDD)** (AC: 1)
  - [x] In `config.test.ts`: asserts `loadConfig({ BOARD_API_TOKEN })` holds a 64-char SHA-256 hash and that `JSON.stringify`/`inspect`/`String(config)` never contain the plaintext; unset → null. Plus a `BOARD_API_CORS_ORIGINS` parse test. Confirmed red first.
  - [x] In `config.ts` (`loadConfig`) added `BOARD_API_TOKEN` (cleaned) → store only its SHA-256 hash (`node:crypto`); added `BOARD_API_CORS_ORIGINS` (comma-split, trimmed, blanks dropped). **Design note:** the stored value is a non-reversible hash (the plaintext is hashed and discarded immediately), so it is kept as a normal `apiTokenHash` field rather than the non-enumerable `apiKey` pattern — the no-plaintext property holds because plaintext is never stored. AC1/AC5 tests assert this.
- [x] **Task 3 — Add the bearer guard inside an encapsulated v1 plugin** (AC: 2)
  - [x] New module `api/v1.ts` exporting `registerV1Api(app, opts)` which registers a child plugin with `prefix: "/api/v1"`. The plugin holds an `onRequest` hook that hashes the incoming bearer token and compares with `crypto.timingSafeEqual` over equal-length hex digests; on mismatch/missing → `reply.code(401).send(...)` + `return reply` (handler never runs). Fail-closed when no token is configured.
  - [x] The hook reads the hash from the injected `opts.apiTokenHash`, NOT the global `config` (hermetic tests).
- [x] **Task 4 — Wire the injectable token into `buildServer`** (AC: 5)
  - [x] Added `apiToken?: string | null` + `corsOrigins?: string[]` to `BuildServerOptions`, defaulting to `config.apiTokenHash`/`config.corsOrigins` (same injection seam as `db`/`queue`/`llm`). `apiToken === null` forces fail-closed. Registered the v1 plugin in `buildServer` passing the resolved hash. This is the seam that makes AC5 testable without mutating `process.env`.
- [x] **Task 5 — Add `@fastify/cors` scoped to the v1 plugin** (AC: 4)
  - [x] **Dependency-policy precondition (DONE):** ran `socket package score npm @fastify/cors@11.2.0 --json` — supplyChain 99 (transitive 80), quality 100 (86), vulnerability 100 (82), maintenance 86 (75); all ≥ policy floors. Installed pinned `@fastify/cors@11.2.0`.
  - [x] Registered `@fastify/cors` INSIDE the v1 plugin with `origin` = the configured allowlist (empty → `false` = no cross-origin), so only v1 emits CORS headers. Tests assert a configured origin is allowed, an unconfigured one omits the header, and legacy routes emit no CORS header.
- [x] **Task 6 — Verify green + no regression** (AC: 3, 5)
  - [x] Added `api/v1.test.ts` to the `test` script; `npm test` → **350 pass / 0 fail** (every existing suite — legacy + collections + skills — unaffected).

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

claude-opus-4-8[1m] (BMAD dev-story workflow)

### Debug Log References

- New-tests RED run: `node --import tsx --test api/v1.test.ts config.test.ts` → failed on missing `apiTokenHash`/`corsOrigins` + absent v1 routes (expected).
- GREEN run (same command): 19 pass / 0 fail (9 v1 + 10 config).
- Full regression: `npm test` → **350 pass / 0 fail**, 55 suites. No pollution (temp DB + temp dir per test).
- Dependency gate: `socket package score npm @fastify/cors@11.2.0 --json` → supplyChain 99/80, quality 100/86, vulnerability 100/82, maintenance 86/75 (self/transitive) — all ≥ floors. Installed `--save-exact`.

### Completion Notes List

- ✅ All 5 ACs satisfied on the live SQLite store via hermetic `inject()` tests.
- **Encapsulated plugin, not a URL-prefix global hook.** `registerV1Api` registers a child plugin at `prefix: "/api/v1"`; the bearer `onRequest` hook + `@fastify/cors` live inside that encapsulation context, so they structurally cannot touch root routes (SPA, `/api/bookmarks`, `/api/collections`, `/skills`). NFR-BC AC3 is guaranteed by Fastify's encapsulation, proven by two no-auth-header regression tests on legacy + collections routes.
- **Hash + constant-time compare, no new crypto dep.** `node:crypto` `createHash('sha256')` + `timingSafeEqual` over equal-length (64-char) hex digests. No bcrypt/argon2 (a static deployment secret is not a user password).
- **Fail-closed.** No configured token (`apiTokenHash === null`, or `buildServer({ apiToken: null })`) → the v1 surface returns 401 for everything; you cannot authenticate against an unset secret.
- **No plaintext retained.** `loadConfig` hashes `BOARD_API_TOKEN` and discards the plaintext; `apiTokenHash` is a non-reversible hash, so it's a normal config field (not the non-enumerable `apiKey` pattern). Tests assert the plaintext never appears in `JSON.stringify`/`inspect`/`String(config)` nor in captured server logs.
- **Injectable seam.** `BuildServerOptions.apiToken` (plaintext, hashed in `buildServer`) + `corsOrigins`, defaulting to `config.apiTokenHash`/`config.corsOrigins` — mirrors the existing `db`/`queue`/`llm` injection, makes allow/deny hermetically testable.
- **Probe route.** `GET /api/v1/ping` → `{ok:true}` is the guarded test target; 12.2 registers CRUD inside the same plugin behind the same guard.

**Party-mode review (Winston/Amelia/Quinn) — findings addressed before commit:**
- ✅ [Med] Made `apiTokenHash` **non-enumerable** (Winston): an unsalted SHA-256 of a low-entropy operator token would otherwise leak through `JSON.stringify`/`inspect`/`String(config)` (the `redact()` spread now drops it). Honors AC1's "mirror the `apiKey` model." Added a config test pinning the hash out of all serialization surfaces.
- ✅ [Med] Fixed the `buildServer` three-way so `apiToken: ""` **fails closed** (was `sha256Hex("")`) — `undefined → config`, falsy-but-defined → null, else hash (Amelia). Added an edge test.
- ✅ [Low] Added an **OPTIONS preflight** test asserting CORS runs before the bearer guard (204/no-auth + ACAO) — pins the load-bearing registration order 12.2/PWA depend on (Winston/Amelia).
- ✅ [Low] `Bearer` scheme match is now **case-insensitive** (RFC 7235); added empty-bearer + lowercase-scheme edge tests (Winston/Amelia).
- ✅ [Low] Reworked the previously **vacuous no-plaintext-log test** (Quinn) to actually dump config through a captured logger and assert neither the plaintext nor the hash appears.
- ⏸️ [Low, deferred] Token-less startup warn (Winston) — deferred to avoid test-log noise; the existing `warnIfExposed` covers the exposed-without-auth posture.

### File List

- `api/v1.ts` (new) — encapsulated v1 plugin: `registerV1Api`, `sha256Hex`, bearer `onRequest` guard, scoped `@fastify/cors`, `GET /api/v1/ping` probe.
- `api/v1.test.ts` (new) — 9 tests (valid→200, missing→401, wrong/malformed→401, fail-closed, 2× NFR-BC no-auth legacy/collections, CORS allow/deny, legacy no-CORS, no-plaintext-in-logs).
- `config.ts` (modified) — `loadConfig` reads `BOARD_API_TOKEN` → `apiTokenHash` (SHA-256, plaintext discarded) + `BOARD_API_CORS_ORIGINS` → `corsOrigins`; `Config` interface extended.
- `config.test.ts` (modified) — 2 tests (hash-only/no-plaintext, CORS-origins parse).
- `server.ts` (modified) — `BuildServerOptions.apiToken`/`corsOrigins`; import + `registerV1Api(app, …)` in `buildServer`.
- `package.json` (modified) — added `@fastify/cors@11.2.0` (pinned); appended `api/v1.test.ts` to the `test` script.

### Change Log

- 2026-06-23 — Story 12.1 implemented: encapsulated `/api/v1` surface with a static bearer-token `onRequest` guard (SHA-256 + `timingSafeEqual`, fail-closed) + scoped `@fastify/cors`; config gains `apiTokenHash`/`corsOrigins`; `buildServer` gains injectable `apiToken`/`corsOrigins`. 350 pass / 0 fail, no regression. Status → review.
- 2026-06-23 — Addressed party-mode code-review findings: non-enumerable `apiTokenHash` (no hash leak in serialization), `apiToken: ""` fails closed, case-insensitive Bearer scheme, OPTIONS-preflight + edge tests, reworked the no-plaintext-log test. 353 pass / 0 fail.
