# Story 4.1: LLMProvider interface + conformance suite

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Epic 4 — LLM provider seam.** A pluggable `LLMProvider.complete(prompt, schema)` with two transports, optional and graceful, defaulting to zero-coding-CLI. *(FR-8, FR-9, AD5, C10.)*
>
> **Story 1 of 4 in Epic 4.** Build order: **(1) LLMProvider interface + conformance suite ◄ this story** → (2) HttpProvider → (3) CliProvider → (4) optional & graceful selection. The `LLMProvider` interface was *declared* in Story 3.1 (so `ctx.llm` had a type); this story owns the **shared conformance suite** every transport must pass, plus a fake backend to prove the suite. *(FR-8.)*

## Story

As the board-oss maintainer,
I want one provider interface and a shared conformance suite,
so that any transport (HTTP, CLI, future) is provider-agnostic to the rest of the system and provably correct.

## Acceptance Criteria

1. **The conformance suite drives BOTH success and failure via a per-case backend seam.**
   **Given** the `LLMProvider` interface (declared in Story 3.1, imported — not redefined — here), **When** the suite runs, **Then** it is parameterized as `runProviderConformance({ makeProviderReturning: (rawBackendOutput) => LLMProvider })` so each transport supplies a seam that makes its backend emit a given raw output (fake `fetch` body for 4.2, fake spawner stdout/result-file for 4.3). *(A no-arg `makeProvider()` factory canNOT drive valid-then-invalid in one run — it returns one fixed thing — which forces per-transport reimplementation of the failure case, the exact fragmentation this story exists to prevent.)*

2. **Valid structured output passes.**
   **Given** the seam set to emit valid structured output for a schema, **When** `complete(prompt, schema)` is called, **Then** it returns the parsed, schema-valid object.

3. **Schema mismatch → a concretely-named typed error (asserted via `instanceof`).**
   **Given** the seam set to emit schema-violating output, **When** `complete` is called, **Then** it throws **`LLMSchemaError`** (a named, exported class) — asserted via `instanceof`, not a string match, not a leaked raw `ZodError`. Transport failures throw **`LLMTransportError`** (distinct, so 4.4/7.1 can tell "model gave bad output" from "backend unreachable").

4. **The suite is the single contract reused by 4.2 and 4.3.**
   **Given** the exported `runProviderConformance`, **When** HttpProvider (4.2) and CliProvider (4.3) are built, **Then** each invokes the same suite via its own seam — exactly one conformance contract, not three. **`disabledLlm` is excluded** from the suite (it can't return a schema-valid `T`; it throws `EnrichmentDisabledError` by design — running it through the suite would falsely fail it).

## Tasks / Subtasks

- [ ] **Task 1 — Write the conformance suite as a failing parameterized test (TDD)** (AC: 1, 2, 3, 4)
  - [ ] Create `llm/conformance.ts` exporting `runProviderConformance({ makeProviderReturning })` where `makeProviderReturning(rawBackendOutput)` builds a provider whose backend emits that output. The suite seeds VALID output (assert parsed object) then SCHEMA-VIOLATING output (assert `instanceof LLMSchemaError`) — both in one run.
  - [ ] Create `llm/provider.test.ts` that runs the suite against a `FakeProvider` seam. Run; confirm red.
- [ ] **Task 2 — Import the canonical interface; define the typed errors here** (AC: 1, 3)
  - [ ] **Do NOT redefine `LLMProvider`** — import it from `skills/types.ts` (Story 3.1 owns it; that's where `ctx.llm` is typed). `llm/provider.ts` re-exports it for cohesion but adds no second definition. (Note: architecture §6's comment "`llm/provider.ts` # LLMProvider interface + conformance suite" is STALE — 3.1 took the interface; §6 predates that. Don't treat §6 as instruction to define the interface here.)
  - [ ] Define + export the named typed errors `LLMSchemaError` (schema mismatch) and `LLMTransportError` (backend unreachable/non-zero) so all providers throw consistent, `instanceof`-checkable errors. `EnrichmentDisabledError` is declared in Story 3.1 (with `disabledLlm`) — import it; do not redefine.
- [ ] **Task 3 — Implement the `FakeProvider` seam** (AC: 2, 3)
  - [ ] A `FakeProvider` whose backend emits a per-case `rawBackendOutput` (good or schema-violating) so the suite drives both paths without any real backend. This is the reference seam 4.2/4.3 mirror (fake fetch body / fake spawner output).
- [ ] **Task 4 — Wire tests + verify green** (AC: 4)
  - [ ] Add `llm/provider.test.ts` to the `test` script; run `npm test`; confirm green + existing suites unaffected.

## Dev Notes

### What this story changes vs preserves (read before coding)

- **NEW `llm/` directory** — architecture §6 (`llm/provider.ts` + `http-provider.ts` + `cli-provider.ts`). This story builds the conformance suite + fake; the transports are 4.2/4.3.
- **The interface is already declared (Story 3.1).** 3.1 owns the canonical `LLMProvider` interface (`complete<T>(prompt: string, schema: ZodType<T>): Promise<T>`) so `ctx.llm` had a type and a `disabledLlm` null-object existed. This story does NOT redefine it — it builds the conformance contract around it. Keep one definition. [Source: docs/bmad/stories/3-1-skill-interface-registry.md]
- **The prototype has NO HTTP transport and NO provider abstraction (recon).** Analysis today is CLI-only: `analyze` (`add.ts:438-476`) spawns `claude`/`codex` directly. The `LLMProvider` seam is net-new; the conformance suite is what lets 4.2 (HTTP) and 4.3 (CLI, ported from the prototype) be interchangeable.

### The provider contract (target — architecture §4.2)

[Source: docs/bmad/architecture.md#4.2-llm-provider-contract]
```ts
interface LLMProvider { complete<T>(prompt: string, schema: ZodType<T>): Promise<T>; }
```
- `complete` takes a prompt + a zod schema and returns a parsed, schema-valid `T`. Schema validation is the provider's responsibility (each transport parses its raw output and revalidates).
- A shared **provider-conformance suite** runs against both impls with a fake backend. [Source: docs/bmad/architecture.md#4.2]

### Why this design (anti-pattern prevention)

- **One conformance suite, not per-transport tests (FR-8).** The whole point of the seam: HTTP and CLI are interchangeable to the rest of the system. A single parameterized suite both transports run guarantees that. Don't write bespoke "does HttpProvider parse?" and "does CliProvider parse?" tests that drift. [Source: docs/bmad/architecture.md#4.2]
- **Typed errors, not raw throws.** A schema mismatch must surface as a catchable, typed error so the enrichment worker (7.1) and the graceful-degradation path (4.4/8.5) can distinguish "provider failed" from "transport down" from a bug. A leaked zod `ZodError` or a thrown string is untypeable downstream. [Source: docs/bmad/epics.md#Story-4.1]
- **The schema is zod, passed in — providers don't own schemas.** `complete(prompt, schema)` takes the caller's schema (built from the board descriptor in 7.1). Providers translate the zod schema into their native mechanism (JSON-mode for HTTP, prompt-injected JSON-schema for CLI) and revalidate against the zod. The provider never hardcodes a schema. [Source: docs/bmad/architecture.md#4.2, #4.4]

### Project Structure Notes

- `llm/provider.ts` (interface re-export + typed errors), `llm/conformance.ts` (the suite), `llm/provider.test.ts` (+ FakeProvider). Per architecture §6.
- zod is a direct dep by now (Story 1.2). ESM `.js` specifiers; `node:test`; add the test to the `test` script.

### Testing standards

- The suite is the deliverable — it must be a reusable export, not inline test bodies, so 4.2/4.3 call it.
- Cover the two contract behaviors (valid→parsed, mismatch→typed error) against the fake.
- Existing suites green.

### References

- [Source: docs/bmad/architecture.md#4.2-llm-provider-contract] — `complete(prompt, schema)`; shared conformance suite; both transports.
- [Source: docs/bmad/PRD.md#FR-8] — pluggable provider, two transports, one conformance suite.
- [Source: docs/bmad/architecture.md#3-AD5] — LLMProvider seam, two transports, zero-coding-CLI default.
- [Source: docs/bmad/stories/3-1-skill-interface-registry.md] — where the `LLMProvider` interface + `disabledLlm` were declared.
- [Source: add.ts#438-476] — the prototype's CLI-only `analyze` (no provider abstraction) that 4.3 ports behind this interface.

## Dev Agent Record

### Agent Model Used

_(to be filled by dev agent)_

### Debug Log References

### Completion Notes List

### File List
