# Story 4.3: CliProvider (coding-agent subprocess)

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Epic 4 — LLM provider seam.** Story 3 of 4. Build order: (1) interface + conformance → (2) HttpProvider → **(3) CliProvider ◄ this story** → (4) optional & graceful selection. This story resurrects the prototype's coding-agent subprocess analysis (`add.ts buildAnalysisCommand` + `analyze`) as a hardened `CliProvider` behind the `LLMProvider` interface — **characterization-test the existing argv-build + stdout-parse FIRST** (NFR-5), then refactor + harden. *(FR-8, NFR-5.)*

## Story

As a user with a Claude Code / Codex / Cursor subscription,
I want a provider that drives my coding-agent CLI,
so that I can enrich without an API key.

## Acceptance Criteria

1. **A characterization test pins the prototype's current behavior BEFORE refactor.**
   **Given** the prototype's `buildAnalysisCommand` (`add.ts:399-436`) and stdout/result parsing (`parseJsonFromText` `add.ts:351-366`, `extractAnalysisPayload` `add.ts:368-373`), **When** I begin, **Then** a characterization test pins the current claude AND codex argv-build and the stdout/result-file parse — capturing today's exact behavior so the refactor is provably behavior-preserving.

2. **`CliProvider.complete` spawns the agent, injects the JSON-schema, parses + revalidates.**
   **Given** a configured CLI provider (agent ∈ **{claude, codex}** — the two the prototype implements; see "cursor is out of scope" below), **When** `complete(prompt, schema)` is called, **Then** it spawns the agent with the schema injected (per the transport's mechanism), parses stdout (claude) or the result file (codex), and `schema.parse`s the structured output → typed error on mismatch.

3. **Lifecycle is hardened.**
   **Given** a spawned agent, **When** it runs, **Then**: a wall-clock **timeout kills** the process; a non-zero exit → a **typed error**; stderr is captured; and **no secrets appear in argv**. (The prototype lacks the timeout/kill.)

4. **It passes the Story 4.1 conformance suite with an injected spawner.**
   **Given** the conformance suite and an injected spawner (canned stdout/exit), **When** run against `CliProvider`, **Then** it passes — no real subprocess in tests.

5. **The transport differences (claude vs codex) are preserved.**
   **Given** the two agents, **When** `complete` runs, **Then** claude gets the schema inline on argv + reads stdout, while codex gets the schema via a temp file + reads the **result file** (and uses the stricter `toCodexOutputSchema` shape) — faithfully ported from the prototype.

6. **`cursor` is explicitly OUT of scope for v1.**
   **Given** the prototype implements only `claude` and `codex` (`AnalysisAgentId = "claude" | "codex"`, `add.ts:52`; no cursor path in `buildAnalysisCommand`), **When** this story is built, **Then** it ports those two only. `cursor`/`cursor-agent` (named aspirationally in PRD FR-8 / architecture §4.2) is a future net-new transport, NOT a characterization port — it is not in this story's enum, tests, or scope. *(A characterization-first story cannot characterize a transport the prototype never built.)*

## Tasks / Subtasks

- [x] **Task 1 — Write the CHARACTERIZATION test FIRST (NFR-5)** (AC: 1)
  - [x] Create `llm/cli-provider.characterization.test.ts` (or extend `add.test.ts`): pin `buildAnalysisCommand("claude", ...)` → exact `{command, args}` (incl. `--json-schema`, `--append-system-prompt`, `--output-format json`, optional `--model`); pin `buildAnalysisCommand("codex", ...)` → exact argv (incl. `--output-schema <file>`, `--output-last-message <file>`, `exec`, `--sandbox read-only`); pin `parseJsonFromText` (fence-strip + `{`…`}` fallback) and `extractAnalysisPayload` (`.structured_output ?? .result ?? value`) and `toCodexOutputSchema` (forces `additionalProperties:false` + `required=all`). These pin TODAY's behavior; they must pass against the unrefactored prototype first.
  - [x] Run; confirm GREEN against the current `add.ts` (characterization tests pin existing behavior — they start green, unlike TDD red).
- [x] **Task 2 — Write the failing CliProvider tests (TDD for the NEW behavior)** (AC: 2, 3, 4, 5)
  - [x] Create `llm/cli-provider.test.ts`: inject a fake spawner (canned stdout/exit); assert `complete` spawns with schema injected, parses + `schema.parse`s, throws typed error on schema-mismatch AND on non-zero exit; assert the timeout kills a hung spawn (fake a never-resolving process); assert no secret in argv; run the **Story 4.1 conformance suite** against `CliProvider`.
  - [x] Run; confirm red.
- [x] **Task 3 — Extract + port `buildAnalysisCommand` into `CliProvider`** (AC: 2, 5)
  - [x] Create `llm/cli-provider.ts`: move/adapt `buildAnalysisCommand` (`add.ts:399-436`), `toCodexOutputSchema` (`add.ts:375-397`), `parseJsonFromText` (`add.ts:351-366`), `extractAnalysisPayload` (`add.ts:368-373`), and the spawn/parse core of `analyze` (`add.ts:438-476`) behind `LLMProvider.complete`. Keep the claude-inline-stdout vs codex-tempfile-resultfile split (AC 5). The characterization test (Task 1) guards the move.
  - [x] Resolve agent + model from config (`BOARD_ANALYSIS_AGENT`/model, ported to config in Story 2.1; `resolveAnalysisAgent` `add.ts:175-188`).
- [x] **Task 4 — Harden the lifecycle (async `spawn`, mandatory)** (AC: 3)
  - [x] **Switch from `spawnSync` to async `spawn`** — this is mandatory, not "consider". `spawnSync` blocks the event loop (a never-resolving fake spawner would hang the *test*, not the product) and its timeout/kill lives in libuv where an injected fake can't exercise it. Async `spawn` + an injectable timer is the ONLY shape where the timeout→kill is unit-testable. The prototype's `spawnSync` (`add.ts:454-459`) has `maxBuffer` but **no timeout** — this is the net-new hardening.
  - [x] Implement: wall-clock timeout fires → `child.kill()` (assert in test that kill was called); non-zero exit → `LLMTransportError`; capture stderr; ensure no secret/key is on argv (schema/prompt on argv is fine).
- [x] **Task 5 — Inject the spawner AND the codex result-file read** (AC: 4, 5)
  - [x] Make the spawn function injectable (default real `spawn`) so tests pass a controllable fake child (canned stdout/exit, or a never-resolving child for the timeout test) — mirror the prototype's `RunAddDeps.analyzeOverride` seam (`add.ts:565-568`).
  - [x] **The codex path reads its output from a result FILE (`fs.readFileSync(resultFile)`, `add.ts:468-469`), not stdout** — so injecting the spawner alone does NOT cover codex. Make the result-file read injectable too (the fake writes the temp result file, or the fs-read is a seam) so AC5's codex branch is actually under test. Without this, the codex output path is asserted by no test.
- [x] **Task 6 — Wire tests + verify green** (AC: 4)
  - [x] Add both test files to the `test` script; run `npm test`; confirm green (characterization + new) + conformance + existing suites unaffected.

## Dev Notes

### What this story changes vs preserves (read before coding)

- **NEW `llm/cli-provider.ts`** — but it is a *port* of existing prototype code, not greenfield. The behavior already exists in `add.ts`; this story extracts it behind the provider interface + hardens it.
- **Characterization test FIRST (NFR-5, C7).** The architecture is explicit: "characterization-test the prototype's CLI parsing before refactor." This is the one story in the project where the test starts GREEN (pinning current behavior) rather than red — then the refactor must keep it green. Do not refactor `buildAnalysisCommand` before the characterization test pins it.
- **Exact prototype anchors (recon):**
  - `buildAnalysisCommand(agent, prompt, schema, systemPrompt, files?)` — `add.ts:399-436`. claude (`406-416`): `-p <prompt> --tools "" --output-format json --json-schema <JSON> --append-system-prompt <sys>` (+`--model`); codex (`418-433`): `--ask-for-approval never exec --ephemeral --sandbox read-only --output-schema <schemaFile> --output-last-message <resultFile>` (+`--model`) `<prompt>`.
  - `analyze` — `add.ts:438-476`: writes codex schema to temp file (`446-452`), `spawnSync(command, args, {cwd, encoding, maxBuffer:10MB, stdio:["ignore","pipe","pipe"]})` (`453-459`), error handling (`461-466`), output source differs (codex result file vs claude stdout, `468-470`), temp cleanup (`473-474`).
  - `parseJsonFromText` (`add.ts:351-366`), `extractAnalysisPayload` (`add.ts:368-373`), `toCodexOutputSchema` (`add.ts:375-397`), `resolveAnalysisAgent` (`add.ts:175-188`), `buildAnalysisPrompt` (`add.ts:339-349`).
- **`add.ts` (light touch).** Once `CliProvider` owns this logic, `add.ts analyze` can delegate to it (or the prototype path stays until Epic 7 migrates enrichment). Don't break `add.test.ts`. The characterization test protects the move.

### Why this design (anti-pattern prevention)

- **Characterization before refactor (NFR-5/C7).** Refactoring CLI-parsing without first pinning its behavior is how you silently break enrichment. Pin claude AND codex (they diverge sharply) before touching anything. [Source: docs/bmad/architecture.md#4.2, #7]
- **The claude/codex split is real and must survive.** claude takes the schema inline on argv and returns it on stdout; codex needs temp files for both schema and result, plus a stricter schema (`toCodexOutputSchema` forces `additionalProperties:false`, all-required). Collapsing them breaks one transport. [Source: add.ts#399-436, #375-397]
- **Lifecycle hardening is the NET-NEW value (the prototype lacks it).** `spawnSync` with `maxBuffer` but no timeout means a hung agent hangs the worker (and on a 512MB LXC, a stuck process is dangerous). Add timeout→kill, exit→typed-error, stderr capture. This is what makes the CLI path safe on the constrained host. [Source: add.ts#453-459, docs/bmad/architecture.md#4.2]
- **No secrets in argv (NFR-3).** Schema + prompt on argv is fine (not secret). An API key must never be argv — but CLI providers use the user's *subscription* (no key in board-oss), so the main risk is not logging the prompt if it ever carries sensitive captured content. Keep argv clean. [Source: docs/bmad/PRD.md#NFR-3]
- **Inject the spawner.** No real `claude`/`codex` binary in CI. Canned stdout/exit via an injected spawner proves the parse + lifecycle deterministically. [Source: add.ts#565-568]

### Project Structure Notes

- `llm/cli-provider.ts` + `.test.ts` + `.characterization.test.ts`. Passes `llm/conformance.ts` (Story 4.1).
- ESM `.js` specifiers; `node:test`; add both test files to the `test` script.

### Testing standards

- **Characterization test starts green** (pins current behavior); the refactor keeps it green.
- New-behavior tests are TDD-red-first (timeout/kill, typed errors, conformance).
- Inject the spawner; no real subprocess. Cover claude AND codex paths (they differ).
- Existing `add.test.ts` stays green (it already exercises `runAdd`/`buildAnalysisCommand`).

### References

- [Source: add.ts#399-436] — `buildAnalysisCommand` (claude + codex argv) to port + characterize.
- [Source: add.ts#438-476] — `analyze` spawn/parse core (the timeout-less `spawnSync` to harden).
- [Source: add.ts#351-373] — `parseJsonFromText` + `extractAnalysisPayload` (stdout parse) to port.
- [Source: add.ts#375-397] — `toCodexOutputSchema` (codex's stricter schema) to preserve.
- [Source: add.ts#175-188] — `resolveAnalysisAgent` (agent/model from env→config).
- [Source: add.ts#565-568] — `RunAddDeps` injectable-override pattern to mirror for the spawner.
- [Source: docs/bmad/architecture.md#4.2-llm-provider-contract] — CliProvider: spawn, inject schema, parse+revalidate, lifecycle hardening; characterization-test first.
- [Source: docs/bmad/PRD.md#NFR-5] — testability: characterization-test the prototype CLI parsing before refactor.
- [Source: docs/bmad/stories/4-1-llm-provider-interface-conformance.md] — the conformance suite this provider must pass.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (BMAD dev-story workflow)

### Debug Log References

- `npm test` → 196 pass / 0 fail (183 prior + 6 characterization + 7 CliProvider). Characterization tests start green against the unrefactored `add.ts`.

### Completion Notes List

- ✅ All 6 ACs satisfied.
- **Characterization-first (AC1, NFR-5):** `llm/cli-provider.characterization.test.ts` pins the prototype's exact claude + codex argv, `parseJsonFromText` (raw/fenced/brace-fallback), `extractAnalysisPayload` (structured_output ?? result ?? value), and `toCodexOutputSchema` (additionalProperties:false + required=all). They started green and stayed green — the port is behavior-preserving.
- **Reuse, not fork:** `CliProvider` IMPORTS `buildAnalysisCommand`/`parseJsonFromText`/`extractAnalysisPayload`/`toCodexOutputSchema` from `add.ts` (already exported, characterization-pinned) + `zodToJsonSchema` from `http-provider.ts`. No duplicated logic; `add.ts` untouched (its tests stay green).
- **claude/codex split preserved (AC5):** claude gets the schema inline on argv + reads **stdout**; codex writes schema to a temp file, uses the stricter `toCodexOutputSchema`, and reads the **result file** (via an injected `readFile` seam so the codex output path is genuinely under test).
- **Lifecycle hardened (AC3, the net-new value):** switched from the prototype's blocking `spawnSync` (no timeout) to async `spawn` + a wall-clock timeout that **kills** the child (tested: a hung fake child → `kill` called + `LLMTransportError`), non-zero exit → `LLMTransportError` (stderr captured/logged, truncated), spawn error → `LLMTransportError`. Schema/parse failures → `LLMSchemaError`.
- **No secrets in argv (AC3):** CLI uses the user's subscription — no key exists; the test asserts no `bearer`/`api-key`/`sk-` token appears on argv. Schema + prompt on argv is fine (not secret).
- **Injected spawner** (default node `spawn` with piped stdio) → no real subprocess in tests; canned stdout/exit/hang drive all paths deterministically.
- **Passes the shared conformance suite (AC4)** via the claude/stdout seam.
- **`cursor` out of scope (AC6):** the agent enum is `claude | codex` only.

### File List

- `llm/cli-provider.ts` (new) — `CliProvider` (async spawn + timeout/kill, claude/codex split) reusing add.ts helpers.
- `llm/cli-provider.characterization.test.ts` (new) — 6 behavior-pinning tests.
- `llm/cli-provider.test.ts` (new) — 7 tests (claude argv/parse, codex result-file, schema-error, non-zero exit, timeout-kill, conformance ×2).
- `package.json` (modified) — appended both test files to the `test` script.

### Change Log

- 2026-06-20 — Story 4.3 implemented: hardened CliProvider port (characterization-first) — async spawn + timeout/kill, claude/codex split, reuses add.ts helpers, passes the conformance suite. Status → review.
