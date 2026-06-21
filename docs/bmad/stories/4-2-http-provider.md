# Story 4.2: HttpProvider (API key + open model)

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Epic 4 — LLM provider seam.** Story 2 of 4. Build order: (1) interface + conformance → **(2) HttpProvider ◄ this story** → (3) CliProvider → (4) optional & graceful selection. This story implements the OpenAI-compatible HTTP provider so users can enrich via a cloud API key OR a local open model (Ollama/LM-Studio) through one code path. *(FR-8.)*

## Story

As a user with an API key or a local model,
I want an OpenAI-compatible HTTP provider,
so that I can enrich via cloud or Ollama/LM-Studio with one code path.

## Acceptance Criteria

1. **`complete` uses native JSON-mode/tool-calling and returns a schema-parsed result.**
   **Given** a base-URL + key + model, **When** `complete(prompt, schema)` is called, **Then** it issues an OpenAI-compatible request using native JSON-mode/structured-output (the zod schema → JSON-schema), and `schema.parse`s the response into the typed result.

2. **Open model is config, not a separate class.**
   **Given** a local open model, **When** configured, **Then** it is reached via the same `HttpProvider` with a different base-URL (e.g. `http://localhost:11434/v1`) — there is no separate `OllamaProvider` class.

3. **It passes the Story 4.1 conformance suite.**
   **Given** the conformance suite, **When** run against `HttpProvider` (with an injected fake `fetch`), **Then** it passes (valid output → parsed; schema mismatch → typed error).

4. **A unit test injects `fetch` and asserts request shape + parse.**
   **Given** an injected `fetch`, **When** `complete` is called, **Then** the test asserts the request shape (URL, auth header, JSON body incl. the schema, model) and that a canned valid response parses; a canned schema-violating response yields the typed error. No real network call.

5. **The API key never appears in logs (asserted via a spy logger on the error path).**
   **Given** a configured key and an **injected spy logger**, **When** a transport failure is exercised (so the error path logs), **Then** the test asserts no logged call/error-message argument contains the key substring — the key lives in the `Authorization` header only. *(Concrete assertion, not an aspiration: exercise the failure path and grep the captured log args.)*

## Tasks / Subtasks

- [ ] **Task 1 — Write the failing HttpProvider tests first (TDD)** (AC: 1, 3, 4, 5)
  - [ ] Create `llm/http-provider.test.ts`: inject a fake `fetch`; assert the request URL/headers/body (schema embedded, model, auth header present); canned valid response → parsed object; canned bad response → typed error; run the **Story 4.1 conformance suite** against `HttpProvider` with the fake fetch.
  - [ ] Run; confirm red.
- [ ] **Task 2 — Implement `HttpProvider`** (AC: 1, 2, 5)
  - [ ] Create `llm/http-provider.ts`: `HttpProvider` implementing `LLMProvider`. Construct from `{ baseUrl, apiKey, model }` (from config, Story 2.1). `complete(prompt, schema)`: convert the zod schema to a JSON-schema (use zod's JSON-schema output or a small converter), build the OpenAI-compatible request (chat/completions with `response_format: json_schema` or tool-calling), `await fetch`, parse the body, `schema.parse` the structured output, throw the typed error on mismatch/transport failure.
  - [ ] Inject `fetch` (default `globalThis.fetch`) so tests don't hit the network — mirror the prototype's injectable `fetchImpl` pattern (`processor-library.ts:136-137`).
  - [ ] Keep the key out of logs (AC 5) — only in the `Authorization` header.
- [ ] **Task 3 — Wire the zod→JSON-schema conversion** (AC: 1)
  - [ ] Decide the conversion: zod's built-in JSON-schema (`z.toJSONSchema` in zod 4 / a converter lib in zod 3) — confirm which zod version Story 1.2 pinned and use the matching approach. Document. (The prototype hand-builds JSON-schemas as plain objects, e.g. `SCHEMA` `add.ts:61-130`; here the schema is a zod object from the descriptor in 7.1.)
- [ ] **Task 4 — Wire tests + verify green** (AC: 3, 4)
  - [ ] Add the test to the `test` script; run `npm test`; confirm green + conformance passes + existing suites unaffected.

## Dev Notes

### What this story changes vs preserves (read before coding)

- **NEW `llm/http-provider.ts`** — net-new; the prototype has no HTTP transport (recon: analysis is CLI-only via `add.ts analyze`).
- **Implements the Story 3.1 `LLMProvider` interface** and passes the Story 4.1 conformance suite. The conformance suite is the contract; this story's bespoke tests cover the HTTP-specific request shaping.
- **Config from Story 2.1** — base-URL/key/model are env-driven provider knobs. Unset = no-AI (Story 4.4 handles selection/graceful).

### Why this design (anti-pattern prevention)

- **Open model = base-URL config, NOT a subclass (FR-8).** Ollama/LM-Studio/cloud are the same OpenAI-compatible shape; the only difference is base-URL (and whether a key is needed). One `HttpProvider` configured by base-URL covers all. Do NOT create `OllamaProvider`/`OpenAIProvider` classes — that's the multiplication the architecture explicitly rejects. [Source: docs/bmad/architecture.md#4.2, docs/bmad/PRD.md#FR-8]
- **Native JSON-mode, then revalidate against zod.** Use the provider's structured-output feature to get JSON, but STILL `schema.parse` it — models lie. The conformance suite's "schema mismatch → typed error" case exists exactly because native JSON-mode isn't a guarantee. [Source: docs/bmad/architecture.md#4.2]
- **Inject `fetch`.** Real network calls in tests are flaky and slow; inject `fetch` so the request shape + parse + error paths are deterministic. The prototype already does this for Library capture. [Source: processor-library.ts#136-137]
- **No key in logs/argv (NFR-3).** The HTTP key goes in the `Authorization` header only. (The argv concern is CLI's, Story 4.3, but the log concern applies here.) [Source: docs/bmad/PRD.md#NFR-3]

### Project Structure Notes

- `llm/http-provider.ts` + `.test.ts`. Passes `llm/conformance.ts` (Story 4.1).
- ESM `.js` specifiers; `node:test`; add the test to the `test` script.

### Testing standards

- Inject `fetch`; never hit the network. Assert request shape (URL/headers/body) + parse + typed-error.
- Run the shared conformance suite against `HttpProvider` (the interchangeability proof).
- Existing suites green.

### References

- [Source: docs/bmad/architecture.md#4.2-llm-provider-contract] — HttpProvider: OpenAI-compatible, open-model-via-base-URL, native JSON-mode → schema.parse.
- [Source: docs/bmad/PRD.md#FR-8] — pluggable provider; HTTP transport; open model via base-URL.
- [Source: processor-library.ts#136-137] — injectable `fetchImpl` pattern to mirror.
- [Source: add.ts#61-130] — the prototype's hand-built JSON-schema shape (context for the zod→JSON-schema step).
- [Source: docs/bmad/stories/4-1-llm-provider-interface-conformance.md] — the conformance suite this provider must pass.
- [Source: docs/bmad/stories/2-1-env-config-loader.md] — base-URL/key/model config.

## Dev Agent Record

### Agent Model Used

_(to be filled by dev agent)_

### Debug Log References

### Completion Notes List

### File List
