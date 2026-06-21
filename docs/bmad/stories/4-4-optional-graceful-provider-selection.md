# Story 4.4: Optional & graceful provider selection (zero-coding-CLI default)

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Epic 4 — LLM provider seam.** Story 4 of 4. Build order: (1) interface + conformance → (2) HttpProvider → (3) CliProvider → **(4) optional & graceful provider selection ◄ this story**. This story makes enrichment OPTIONAL with a no-AI default: the app boots and serves with no provider; enrichment is a no-op that leaves items capturable/manual. The default install never requires a coding CLI or key. *(FR-9, C10, NFR-4.)*

## Story

As a stranger installing board-oss,
I want enrichment to be optional with a no-AI default,
so that nothing requires a coding CLI or an API key to start.

## Acceptance Criteria

1. **No provider configured → boots, serves; `selectProvider` returns `disabledLlm`.**
   **Given** no provider config, **When** the app boots, **Then** it starts and serves, and `selectProvider(config)` returns `disabledLlm` (the throwing sentinel from Story 3.1). *(The "items stay captured / status ≠ error" behavior is the WORKER's catch of `EnrichmentDisabledError` — owned by Story 7.1, rendered by 8.5 — NOT asserted here; see AC 5.)*

2. **Provider config selects the matching transport.**
   **Given** provider config, **When** set, **Then**: HTTP config (base-URL/key/model) → `HttpProvider`; CLI config (agent ∈ **{claude, codex}** — cursor is out of scope, see Story 4.3) → `CliProvider`.

3. **The default install path never requires `CliProvider`.**
   **Given** the default (zero-config) install, **When** it runs, **Then** it never requires a coding CLI — no-AI is the default, HTTP/CLI are opt-in. *(C10 = "zero-coding-CLI default", i.e. the coding CLI is opt-in, NOT that CLI is the default. The default is `disabledLlm`.)*

4. **Both-configured precedence is decided AND tested.**
   **Given** BOTH HTTP and CLI config set, **When** `selectProvider` runs, **Then** it returns the documented winner (recommend: explicit HTTP wins, or surface a clear config error — decide and document) — this branch must be asserted, not just documented.

5. **`disabledLlm.complete` THROWS `EnrichmentDisabledError` (the degrade lives in Story 5.2).**
   **Given** `disabledLlm`, **When** `complete(...)` is called, **Then** it **throws `EnrichmentDisabledError`** (assert the typed throw — NOT "no throw"). The catch-and-degrade (the worker's status-classification handler catches it → item resolves to `status=done` with empty AI fields, never `status=error`) is **Story 5.2's** rule, tested there; this story references it, it does not assert it. *(There is no "captured-not-error" status value — §4.5's enum is `pending→processing→done→error`; a disabled-enrichment item is `done` with empty enrichable fields.)*

6. **Tests cover each selection branch.**
   **Given** the selection logic, **When** tested with empty / HTTP / CLI / both-set config, **Then** it returns `disabledLlm` / `HttpProvider` / `CliProvider` / the documented winner respectively.

## Tasks / Subtasks

- [x] **Task 1 — Write the failing selection tests first (TDD)** (AC: 1, 2, 4, 5, 6)
  - [x] Create `llm/select-provider.test.ts`: `selectProvider(config)` → `disabledLlm` (empty) / `HttpProvider` (HTTP) / `CliProvider` (CLI) / documented winner (both-set, AC 4); assert `disabledLlm.complete(...)` **throws `EnrichmentDisabledError`** (AC 5 — the typed throw, not "no throw"). Do NOT assert the captured-not-error degrade here (that's Story 7.1's catch).
  - [x] Run; confirm red.
- [x] **Task 2 — Implement `selectProvider(config)`** (AC: 1, 2, 3)
  - [x] Create `llm/select-provider.ts`: read the provider config (Story 2.1). Precedence: explicit HTTP config (base-URL+key OR base-URL for open model) → `HttpProvider`; explicit CLI config (`BOARD_ANALYSIS_AGENT`) → `CliProvider`; nothing → `disabledLlm`. Document the precedence (what wins if both are set — recommend: explicit HTTP key wins, or surface a config error; decide and document).
  - [x] **Default = `disabledLlm`** (no-AI). The CLI path is opt-in only — never the default (C10).
- [x] **Task 3 — Wire the selected provider into `ctx`/server boot** (AC: 1, 2)
  - [x] At server boot (Story 3.2's ctx builder), set `ctx.llm = selectProvider(config)`. So every skill/worker gets the right provider (or `disabledLlm`) without knowing which transport.
- [x] **Task 4 — Pin the `disabledLlm` throw contract + document the degrade hand-off** (AC: 5)
  - [x] `disabledLlm.complete` **throws `EnrichmentDisabledError`** (declared in Story 3.1). This story confirms/uses that — it does NOT add a sentinel-return alternative.
  - [x] **Document the hand-off (do not implement the catch here):** **Story 5.2's** worker status-classification handler catches `EnrichmentDisabledError` → resolves the item to **`status=done` with empty enrichable fields** (NOT `status=error`/`error_reason`), so a no-AI board is full of dignified un-enriched cards (UJ-2, rendered by Story 8.5), not error cards. There is no new "captured-not-error" status — it's `done` per the §4.5 enum. State this contract so 5.2/8.5 rely on it; the catch + status logic is built in Story 5.2, not here.
- [x] **Task 5 — Wire tests + verify green** (AC: 4)
  - [x] Add the test to the `test` script; run `npm test`; confirm green + existing suites unaffected.

## Dev Notes

### What this story changes vs preserves (read before coding)

- **NEW `llm/select-provider.ts`** — the selection logic. `disabledLlm` (the null-object) was created in Story 3.1; HttpProvider/CliProvider in 4.2/4.3. This story wires *which one* based on config + pins the graceful-no-op semantics.
- **The prototype defaults to claude CLI (recon) — v1 reverses this to no-AI default.** `resolveAnalysisAgent` defaults `BOARD_ANALYSIS_AGENT` to `"claude"` (`add.ts:175-188`). v1's default must be **no provider** (no-AI), per C10 — the coding CLI is opt-in. This is a deliberate behavior change from the prototype: don't carry over the claude-default.
- **Depends on 4.1/4.2/4.3 (the providers) + 2.1 (config) + 3.1 (`disabledLlm`).** Correctly last in the epic.

### Why this design (anti-pattern prevention)

- **No-AI is the DEFAULT, not a fallback (C10/FR-9/NFR-4).** The zero-config first-run (UJ-3) and the "robot asleep" state (UJ-2) require that boot + first value never need an LLM. The default install path must not even *try* to find a coding CLI. Making AI opt-in (not opt-out) is the product-defining choice here. [Source: docs/bmad/PRD.md#FR-9, #NFR-4, docs/bmad/architecture.md#3-AD5]
- **Graceful no-op = captured-not-error, never an error card.** When enrichment is disabled, items must land as dignified un-enriched cards (UJ-2), not `status=error`. The `disabledLlm` semantics (Task 4) are what Story 8.5 renders as "No analysis — enrichment disabled." If disabled-enrichment threw an error that set `status=error`, every card on a no-AI install would look broken. [Source: docs/bmad/PRD.md#FR-9, docs/bmad/epics.md#Story-8.5]
- **`disabledLlm` is a null-object, not `null` (Story 3.1).** Skills/workers never branch on `llm == null`; they call `complete` and the disabled provider handles it. This keeps every consumer transport-agnostic. [Source: docs/bmad/stories/3-1-skill-interface-registry.md]
- **Don't carry the prototype's claude default.** The prototype assumes a coding subscription; the OSS default cannot. Flip it. [Source: add.ts#175-188]

### Project Structure Notes

- `llm/select-provider.ts` + `.test.ts`. Wired into ctx at boot (Story 3.2).
- ESM `.js` specifiers; `node:test`; add the test to the `test` script.

### Testing standards

- Cover all three selection outcomes (disabled/HTTP/CLI) + the graceful-no-op behavior.
- Assert the default (empty config) is `disabledLlm` — the C10 guarantee.
- Existing suites green.

### References

- [Source: docs/bmad/PRD.md#FR-9] — optional & graceful; no provider → capture+manual usable; disabled/empty state; retry.
- [Source: docs/bmad/PRD.md#NFR-4] — no blocking first-run; starts with zero LLM config.
- [Source: docs/bmad/architecture.md#3-AD5] — two transports; zero-coding-CLI default.
- [Source: docs/bmad/epics.md#Story-8.5] — the degraded/disabled-LLM dignified state that relies on the graceful no-op.
- [Source: add.ts#175-188] — prototype's claude-default to REVERSE to no-AI default.
- [Source: docs/bmad/stories/3-1-skill-interface-registry.md] — `disabledLlm` null-object.
- [Source: docs/bmad/stories/4-2-http-provider.md], [Source: docs/bmad/stories/4-3-cli-provider.md] — the transports selected.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (BMAD dev-story workflow)

### Debug Log References

- `npm test` → 206 pass / 0 fail (199 prior + 7 new selection tests). **Epic 4 complete.**

### Completion Notes List

- ✅ All 6 ACs satisfied.
- **`selectProvider(config)`** with a NO-AI default (C10): no provider config → `disabledLlm` (the throwing sentinel). HTTP (base-URL + model) → `HttpProvider`; CLI (`agent ∈ {claude, codex}`) → `CliProvider`; anything else → `disabledLlm`.
- **Precedence decided + tested (AC4):** an explicit HTTP base-URL+model **wins** over a CLI agent when both are set — documented in the module and asserted.
- **Graceful, never blocks boot (NFR-4):** an unknown agent (e.g. `cursor`, out of scope) or a base-URL with no model degrades to `disabledLlm` rather than throwing at boot.
- **Default reversed from the prototype:** the prototype defaulted to the claude CLI; v1's default is no-AI (the coding CLI is opt-in).
- **Wired into ctx (Task 3):** `buildServer` sets `ctx.llm = opts.llm ?? selectProvider(config)`, so every skill/worker gets the right transport (or `disabledLlm`) transport-agnostically.
- **`disabledLlm.complete` throws `EnrichmentDisabledError` (AC5)** — asserted as the typed throw. The catch-and-degrade (disabled enrichment → `status=done` with empty fields, never `status=error`) is **Story 5.2's** rule (referenced, not implemented here; rendered by 8.5).

### File List

- `llm/select-provider.ts` (new) — `selectProvider(config)` with no-AI default + HTTP-wins precedence.
- `llm/select-provider.test.ts` (new) — 7 tests (empty/HTTP/CLI/both/unknown-agent/base-url-no-model/disabled-throw).
- `server.ts` (modified) — ctx `llm` now `selectProvider(config)`.
- `package.json` (modified) — appended the test to the `test` script.

### Change Log

- 2026-06-20 — Story 4.4 implemented: selectProvider with no-AI default (C10), HTTP-wins precedence, graceful degrade for misconfig, wired into server ctx. Epic 4 complete. Status → review.
