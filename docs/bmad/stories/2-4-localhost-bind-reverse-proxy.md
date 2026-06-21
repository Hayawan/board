# Story 2.4: Localhost bind default + reverse-proxy posture

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Epic 2 — Configuration, data & portability.** Story 4 of 4. Build order: (1) env config → (2) DATA_DIR paths → (3) CHROME_PATH → **(4) localhost bind default + reverse-proxy posture ◄ this story**. This story makes the server bind `127.0.0.1` by default (only an explicit `HOST` override exposes it) and documents the reverse-proxy auth model — so board-oss is never accidentally world-exposed. *(FR-22, NFR-3, C3.)*

## Story

As a security-conscious self-hoster,
I want board-oss bound to `127.0.0.1` by default with documented reverse-proxy guidance,
so that it is never accidentally exposed to the world.

## Acceptance Criteria

1. **Default bind is `127.0.0.1`.**
   **Given** default config (no `HOST` set), **When** the server starts, **Then** it binds `127.0.0.1`.

2. **Exposing requires an explicit, non-empty override.**
   **Given** the operator wants `0.0.0.0`, **When** they set `HOST=0.0.0.0` explicitly, **Then** the server binds it — and there is **no other path** to a non-localhost bind. *(This guarantee depends on Story 2.1 coercing empty/whitespace `HOST` to the localhost default — `HOST=""` must NOT bind-all. Cross-check 2.1 AC 1 ships; otherwise this guarantee is false.)*

3. **README documents the reverse-proxy story.**
   **Given** the docs, **When** a self-hoster reads them, **Then** they find the reverse-proxy auth model (v1 ships no built-in auth; put Caddy/Authelia/Tailscale in front; the internal capture contract is token-authed even on localhost).

4. **A non-tautological test asserts the resolved bind options.**
   **Given** a `getListenOptions(config)` function that returns `{ port, host }` (the exact object `server.ts` passes to `app.listen`), **When** called with default config, **Then** it returns `{ host: "127.0.0.1", port: 3141 }`; with `HOST=0.0.0.0`, `{ host: "0.0.0.0" }`. *(The test asserts THIS function, not `config.HOST` directly — asserting `config.HOST` alone merely re-tests Story 2.1 and cannot go red on a hardcoded literal still sitting in `server.ts`. The seam is what proves `server.ts` binds the configured value. Do NOT open a real `0.0.0.0` socket in CI.)*

5. **A non-localhost bind logs a warning at boot.**
   **Given** `HOST` resolves to a non-localhost address, **When** the server starts, **Then** it logs a one-line warning (e.g. "bound to 0.0.0.0 — ensure a reverse proxy / firewall is in front"). *(Mandatory, not optional — this is the v1 safety net for the operator who exposes the port without reading the README, given there is no built-in auth.)*

## Tasks / Subtasks

- [ ] **Task 1 — Write the failing bind test first (TDD)** (AC: 1, 2, 4, 5)
  - [ ] Add a test for `getListenOptions(config)`: default config → `{ host: "127.0.0.1", port: 3141 }`; `HOST=0.0.0.0` → `{ host: "0.0.0.0" }`. Assert THIS function (the seam), not `config.HOST` directly — so the test can go red on the current hardcoded literal in `server.ts`. Do NOT open a real `0.0.0.0` socket in CI.
  - [ ] Add a test that a non-localhost `HOST` triggers the boot warning (AC 5) — assert against an injected logger / captured log line, not a real bind.
  - [ ] Run; confirm red.
- [ ] **Task 2 — Make the server bind config-driven via `getListenOptions`** (AC: 1, 2, 4)
  - [ ] Add `getListenOptions(config) => ({ port: config.PORT, host: config.HOST })`. In `server.ts`, replace the hardcoded `app.listen({ port: 3141, host: "127.0.0.1" })` (`server.ts:331-335`) with `app.listen(getListenOptions(config))`. Default `HOST` (Story 2.1) is `127.0.0.1`, so the secure default holds with zero config.
  - [ ] Keep the entrypoint guard (`if (process.argv[1] === fileURLToPath(import.meta.url))`) so `buildServer()` stays listen-free for `inject()` tests (recon: `server.ts:331` guard). Do not move `listen` into `buildServer`.
- [ ] **Task 3 — Boot warning + reverse-proxy docs** (AC: 3, 5)
  - [ ] **Mandatory:** at boot, when `getListenOptions(config).host` is non-localhost, log a one-line warning ("bound to 0.0.0.0 — ensure a reverse proxy / firewall is in front"). (AC 5.)
  - [ ] In the README: v1 has no built-in auth (AD7); bind localhost; put a reverse proxy (Caddy/Authelia/Tailscale) in front for auth/TLS; note the capture contract is token-authed even on localhost (Epic 6). Reference the Epic 11 packaging docs.
- [ ] **Task 4 — Wire tests + verify green** (AC: 4)
  - [ ] Run `npm test`; confirm green + existing suites (esp. `server.test.ts`) unaffected.

## Dev Notes

### What this story changes vs preserves (read before coding)

- **`server.ts` (UPDATE)** — the bind is currently `await app.listen({ port: 3141, host: "127.0.0.1" })` inside the entrypoint guard (`server.ts:331-335`), with **no env reads** (recon: the only `process.env` use in `server.ts` is passing env to the child spawn at `server.ts:68`). The default is *already* localhost — this story preserves that secure default while making port/host configurable. The change is small and surgical: two literals → `config.PORT`/`config.HOST`.
- **`buildServer()` stays listen-free** — it returns the app without listening (`server.ts:246`, `return app` at `server.ts:327`); listening happens only under the entrypoint guard. Preserve this — it's the `inject()` test seam (`server.test.ts` uses `buildServer()` + `app.inject()`, recon). Do not move `listen` into `buildServer`.

### Why this design (anti-pattern prevention)

- **Secure by default, opt-in to expose (C3/NFR-3).** The default must be localhost; exposing must require a deliberate `HOST=0.0.0.0`. Never default to `0.0.0.0`, and never expose via a non-obvious flag. This is the single most important security posture in v1 (no built-in auth). [Source: docs/bmad/PRD.md#FR-22, #NFR-3]
- **No built-in auth is a deliberate v1 decision (AD7), not a gap.** The audience runs its own reverse proxy (PRD §2.2 assumption). Document it loudly so a self-hoster doesn't expose `0.0.0.0` thinking there's app-level auth. [Source: docs/bmad/architecture.md#3-AD7, docs/bmad/PRD.md#9 Assumptions]
- **Don't build auth here.** `oslo`+`argon2` are reserved for v2 (C5). v1's auth story is *the reverse proxy*. Building login now is out of scope and against the architecture. [Source: docs/bmad/architecture.md#2, #7]
- **Capture contract stays token-authed even on localhost.** Independent of bind, the internal capture contract (Epic 6) is token-authed — note it in the docs so the security model is coherent. [Source: docs/bmad/architecture.md#7]

### Project Structure Notes

- One-line wiring change in `server.ts` + README docs. Config from Story 2.1.
- ESM `.js` specifiers; `node:test`; existing `server.test.ts` covers the inject path.

### Testing standards

- Assert `getListenOptions(config)` (the seam) for default + override without opening a non-localhost socket in CI. Do NOT assert `config.HOST` alone — that re-tests Story 2.1 and can't catch a hardcoded literal left in `server.ts`.
- Existing `server.test.ts` must stay green (it relies on `buildServer()` + `inject()`, which this story preserves).

### References

- [Source: server.ts#331-335] — hardcoded `port:3141, host:"127.0.0.1"` bind to make config-driven.
- [Source: server.ts#246, #327] — `buildServer()` returns the app listen-free (the inject seam to preserve).
- [Source: docs/bmad/PRD.md#FR-22] — reverse-proxy auth model; localhost default; token-authed capture contract.
- [Source: docs/bmad/PRD.md#NFR-3] — security: bind 127.0.0.1 by default; documented reverse-proxy guidance.
- [Source: docs/bmad/architecture.md#3-AD7] — reverse-proxy-only auth, localhost bind default.
- [Source: docs/bmad/architecture.md#2] — `oslo`+`argon2` reserved for v2 (not v1).
- [Source: docs/bmad/stories/2-1-env-config-loader.md] — `config.HOST`/`config.PORT` source (HOST default 127.0.0.1).

## Dev Agent Record

### Agent Model Used

_(to be filled by dev agent)_

### Debug Log References

### Completion Notes List

### File List
