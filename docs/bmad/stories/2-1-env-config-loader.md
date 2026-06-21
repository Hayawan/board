# Story 2.1: Env-driven config loader

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Epic 2 — Configuration, data & portability.** Make every deployment knob env-driven, root data under a persistent dir, autodetect Chrome on Linux, and bind localhost by default. *(FR-21, FR-22, NFR-3.)*
>
> **Story 1 of 4 in Epic 2.** Build order: **(1) env-driven config loader ◄ this story** → (2) DATA_DIR-rooted persistent paths → (3) CHROME_PATH resolution + Linux autodetect → (4) localhost bind default + reverse-proxy posture. This story creates the single `config.ts` that every other knob reads from. It is the seam Stories 2.2/2.3/2.4 plug into, and the `// Story 2.1` markers left in Epic 1 (DB path) resolve here.

## Story

As a self-hoster,
I want all settings to come from environment variables with sane defaults,
so that I configure board-oss without editing source.

## Acceptance Criteria

1. **Unset OR empty env yields safe defaults.**
   **Given** env vars unset **or set to empty/whitespace** (`HOST=""`), **When** config resolves, **Then** defaults apply: `PORT` (e.g. 3141), `HOST=127.0.0.1`, a `DATA_DIR` default, **provider unset = no-AI** (enrichment disabled, see Epic 4). *(Critical: `env.HOST ?? "127.0.0.1"` is wrong — `HOST=""` is non-nullish and Fastify treats `""` as bind-all-interfaces, silently defeating the localhost default of Story 2.4. Treat empty/whitespace as unset.)*

2. **Env overrides win.**
   **Given** non-empty env vars (`PORT`, `HOST`, `DATA_DIR`, `CHROME_PATH`, and the provider knobs — base-URL/key/model/agent), **When** config resolves, **Then** the resolved config reflects the overrides, not the defaults.

3. **`config.ts` is the sole loader module and `loadConfig(env)` is pure/injectable.**
   **Given** the config module, **When** tested, **Then** `loadConfig(env)` resolves entirely from its injected `env` argument (no internal global `process.env` read) and is the one place deployment config is parsed. *(Scope: this is about the loader, not a tree-wide retrofit — Stories 2.2/2.3/2.4 migrate their specific consumers. The **subprocess-IPC run-flags** `BOARD_COLLECTION`, `BOARD_UPDATE_ID`, `BOARD_INSTRUCTIONS`, `BOARD_RESULT_FILE`, `BOARD_ALLOW_EMPTY_CAPTURE` are server→child IPC, NOT deployment knobs, and are explicitly OUT of config.ts — see Dev Notes.)*

4. **Malformed values fail fast with a clear error.**
   **Given** a malformed value (e.g. `PORT=abc`), **When** `loadConfig` runs, **Then** it throws a clear, named error identifying the bad key — it does not silently fall back or produce `NaN`.

5. **The provider key never leaks into logs or serialized config.**
   **Given** a configured provider API key, **When** the config object is logged/serialized (or passed toward a subprocess), **Then** the key is not echoed in plaintext (redacted in any `toString`/log surface). *(NFR-3: no secrets in logs or subprocess argv.)*

6. **A test asserts default + override resolution for each key, plus the edge cases.**
   **Given** a loader that accepts an injected env object (never the global `process.env`), **When** the test passes: empty env, populated env, `HOST=""`, and `PORT=abc`, **Then** it asserts each key's default, each override, the empty-string→default behavior (AC 1), and the malformed-throws behavior (AC 4). No real `process.env` mutation in tests.

## Tasks / Subtasks

- [ ] **Task 1 — Write the failing config test first (TDD)** (AC: 1, 2, 3, 4, 5, 6)
  - [ ] Create `config.test.ts`: `loadConfig({})` → assert every default; `loadConfig({ PORT: "8080", HOST: "0.0.0.0", DATA_DIR: "/tmp/x", ... })` → assert overrides; `loadConfig({ HOST: "" })` → assert HOST falls back to `127.0.0.1` (AC 1, security); `loadConfig({ PORT: "abc" })` → assert it throws a named error (AC 4); assert the resolved config's log/serialized form redacts the provider key (AC 5). Cover provider unset → no-AI.
  - [ ] Run; confirm red (no `config.ts`).
- [ ] **Task 2 — Implement `config.ts` with an injectable env** (AC: 1, 2, 3, 4, 5)
  - [ ] `export function loadConfig(env: NodeJS.ProcessEnv): Config` — pure resolution from the injected env (do NOT default the param to the global `process.env` inside the loader; the app-facing singleton passes `process.env` explicitly). Export a resolved singleton `config` for app code, keep `loadConfig(env)` the testable core.
  - [ ] Resolve/type every knob: `PORT` (number, default 3141), `HOST` (default `127.0.0.1`), `DATA_DIR` (default — Story 2.2 roots the paths), `CHROME_PATH` (optional — Story 2.3 autodetects when unset), provider config (agent/base-URL/key/model). **Coerce empty/whitespace string to "unset"** so `HOST=""`/`PORT=""` take the default (AC 1). Validate/parse (zod or hand-rolled); throw a clear named error on a malformed value (AC 4).
  - [ ] Redact the provider key in any `toString`/log/JSON surface of the config object (AC 5).
- [ ] **Task 3 — Document the config surface** (AC: 1, 2)
  - [ ] Add a config table to the README / `.env.example` listing every var, its default, and meaning. (Epic 11 packaging references this.)
- [ ] **Task 4 — Wire tests + verify green** (AC: 4)
  - [ ] Add `config.test.ts` to the `test` script; run `npm test`; confirm green + existing suites unaffected. (Do NOT yet retrofit all `process.env` call sites — Stories 2.2–2.4 migrate their specific knobs; this story establishes the loader + its own tests.)

## Dev Notes

### What this story changes vs preserves (read before coding)

- **NEW `config.ts`** at repo root — architecture §6 names `config.ts` ("env-driven config (PORT, HOST, DATA_DIR, CHROME_PATH, provider…)"). This is the home every later knob reads from.
- **Prototype env knobs to fold in (recon):** the only env vars the prototype reads today are `BOARD_COLLECTION` (target collection, `add.ts`), `BOARD_ANALYSIS_AGENT`/`BOARD_CLAUDE_MODEL`/`BOARD_CODEX_MODEL` (analysis agent + model, `add.ts:175-188`), and a few `BOARD_*` run flags (`BOARD_UPDATE_ID`, `BOARD_INSTRUCTIONS`, `BOARD_RESULT_FILE`, `BOARD_ALLOW_EMPTY_CAPTURE`, `add.ts:582-586`). The server binds **hardcoded** `port:3141, host:"127.0.0.1"` with **no env reads** (`server.ts:331-335`). `CHROME_PATH` is a **hardcoded macOS const** in `browser.ts:4`, not an env var. This story introduces the `PORT`/`HOST`/`DATA_DIR`/`CHROME_PATH` env surface; Stories 2.2/2.3/2.4 wire the consumers.
- **Do NOT retrofit every consumer here.** Establish `config.ts` + its tests. The actual rewiring (DB path → 2.2, Chrome path → 2.3, server bind → 2.4) happens in those stories so each has a focused, testable change. This story must not break the green suite.
- **Deployment config vs subprocess-IPC run-flags — keep them separate.** `config.ts` owns *deployment knobs*: `PORT`, `HOST`, `DATA_DIR`, `CHROME_PATH`, provider settings. It does **NOT** own the prototype's *run-flags* that the server passes to the `add.ts` child process as IPC: `BOARD_COLLECTION`, `BOARD_UPDATE_ID`, `BOARD_INSTRUCTIONS`, `BOARD_RESULT_FILE`, `BOARD_ALLOW_EMPTY_CAPTURE` (`add.ts:582-586`, passed via the child env at `server.ts:68`). Those are per-invocation parameters, not configuration — migrating them into `config.ts` would be wrong. Only `BOARD_ANALYSIS_AGENT`/`BOARD_CLAUDE_MODEL`/`BOARD_CODEX_MODEL` (provider/model selection, `add.ts:175-188`) are genuine config and fold into the provider knobs. The AC3 "sole loader" claim is scoped to deployment config with this exception named explicitly.

### Config knobs (target — from PRD/architecture)

[Source: docs/bmad/PRD.md#FR-21, docs/bmad/architecture.md#6]
- `PORT` (default 3141 — the prototype's port), `HOST` (default `127.0.0.1`), `DATA_DIR` (persistent data root — Story 2.2), `CHROME_PATH` (optional, autodetect when unset — Story 2.3).
- Provider: agent/transport selection + base-URL + key + model (Epic 4 consumes; **unset = no-AI**, the NFR-4 graceful default). Keep secrets (API key) out of logs and out of subprocess argv (NFR-3).

### Why this design (anti-pattern prevention)

- **Injectable env, not global `process.env` in the loader.** A pure `loadConfig(env)` is unit-testable without mutating/restoring the global (which is flaky and leaks across tests). The prototype already favors injectable seams (`RunAddDeps`, injectable `fetchImpl`) — match that. [Source: add.ts#565-568, processor-library.ts#136-137]
- **One config object, injected — no scattered reads.** Scattered `process.env.X` reads are untestable and drift. Centralizing means Stories 2.2–2.4 each change one wiring point, and Epic 11 packaging has one documented surface. [Source: docs/bmad/architecture.md#6]
- **Defaults must make the zero-config path work (NFR-4/UJ-3).** Unset env must boot a working app (localhost, a sane data dir, no-AI). Do not require any var to be set for first-run. [Source: docs/bmad/PRD.md#NFR-4]
- **Keep prototype `BOARD_*` names or alias them deliberately.** The prototype's analysis-agent env is `BOARD_ANALYSIS_AGENT`/`BOARD_CLAUDE_MODEL`/`BOARD_CODEX_MODEL`. Decide whether v1 keeps these or renames; if renaming, alias the old names so the CLI path keeps working. Document the decision. [Source: add.ts#175-188]

### Project Structure Notes

- `config.ts` at repo root (flat layout, beside `server.ts`/`add.ts`). `config.test.ts` beside it.
- If zod is chosen for parsing and not yet installed, it lands in Story 1.2 (descriptor) — reuse it; otherwise add under the dependency policy.
- ESM `.js` specifiers; `node:test`; add the test to the `test` script.

### Testing standards

- Pure loader → inject env objects; never mutate the real `process.env` in tests.
- Assert defaults AND overrides for every key (AC 4) — a test that only checks defaults misses the override path.
- Existing suites stay green.

### References

- [Source: docs/bmad/PRD.md#FR-21] — env-driven config & persistent data; the full knob list.
- [Source: docs/bmad/architecture.md#6-source-tree] — `config.ts` as the env-driven config module.
- [Source: docs/bmad/PRD.md#NFR-4] — no blocking first-run; zero-config defaults must boot a working app.
- [Source: docs/bmad/PRD.md#NFR-3] — secrets handling (no key in logs/argv).
- [Source: server.ts#331-335] — current hardcoded `port:3141, host:"127.0.0.1"` with no env reads (Story 2.4 rewires).
- [Source: browser.ts#4] — hardcoded macOS `CHROME_PATH` const (Story 2.3 rewires).
- [Source: add.ts#175-188] — prototype `BOARD_ANALYSIS_AGENT`/model env to fold into config.
- [Source: docs/bmad/stories/1-1-sqlite-drizzle-schema.md] — the `// Story 2.1/2.2` DB-path marker this story's loader feeds.

## Dev Agent Record

### Agent Model Used

_(to be filled by dev agent)_

### Debug Log References

### Completion Notes List

### File List
