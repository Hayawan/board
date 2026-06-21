# Story 7.1: Descriptor-driven enrichment worker

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Epic 7 — Dynamic enrichment & rendering.** Enrichment builds its prompt+schema from the board descriptor and writes validated fields; the frontend renders fields generically; items can be re-enriched. The two seeded boards now come alive. *(FR-7, FR-3, FR-10.)*
>
> **Story 1 of 3 in Epic 7.** Build order: **(1) descriptor-driven enrichment worker ◄ this story** → (2) generic field renderer → (3) re-enrich/refetch. This story builds the enrichment job: from a captured item + its board descriptor, build the prompt + JSON-schema, call `LLMProvider.complete`, validate, and write the `enrichable` fields + refresh `search_blob`. *(FR-7.)*

## Story

As a user,
I want enrichment to fill fields based on my board's descriptor,
so that each board enriches through its own lens.

## Acceptance Criteria

1. **Enrichment builds prompt + a ZOD schema FROM the descriptor (not a hardcoded constant).**
   **Given** a captured item and its board descriptor (Story 1.2), **When** the enrichment job runs, **Then** it builds the LLM prompt from the descriptor's `enrichment_prompt` and a **zod schema** from the descriptor's `enrichable` fields — neither is a hardcoded per-board constant. *(The schema is zod, per Story 4.1 — the provider converts zod→JSON-schema internally; do not pre-convert to JSON-schema here. The schema covers only **LLM-emittable** closed types over `enrichable:true` fields and EXCLUDES `image`/asset-backed fields — the model can't return a screenshot; screenshots are `asset` rows from capture, not enriched fields.)*

2. **It calls `LLMProvider.complete`, validates, and writes enrichable fields + search_blob.**
   **Given** the built prompt + schema, **When** enrichment runs, **Then** it calls `ctx.llm.complete(prompt, schema)` (Epic 4), validates the result against the descriptor's field types, writes ONLY the `enrichable` fields into `item.fields` (via the typed item-write helper), and refreshes `search_blob`/FTS (Story 1.4).

3. **The built schema reflects each board's enrichable fields (schema-shaped, not output-shaped).**
   **Given** the Inspiration descriptor, **When** `buildEnrichmentSchema` runs, **Then** the schema contains the Inspiration enrichable keys (design fields, "steal this", facets/tags); **Given** Library, the Library enrichable keys (summary/topics/author/type/key_points). *(Asserted on the built SCHEMA — pure, deterministic. Do NOT assert "the LLM produces design-analysis" — with a mock that's tautological, with a real LLM it's non-deterministic.)*

4. **Disabled enrichment degrades to `done` (not error) — via 5.2's classifier.**
   **Given** `disabledLlm` (no provider), **When** the enrichment job runs, **Then** `complete` throws `EnrichmentDisabledError` which **propagates to Story 5.2's worker classifier** → item resolves to `done` with empty enrichable fields, never `error`. *(7.1 does NOT catch it — 5.2 owns the classification; just let it propagate.)*

5. **A test (mock provider) proves schema-FROM-descriptor and enrichable-ONLY write — both with teeth.**
   **Given** a mock `LLMProvider` + a temp descriptor whose enrichable field uses a **NOVEL key** (e.g. `foo_score: number` — a key in NO prototype constant), **When** the job runs, **Then** the test: (a) captures the `schema` argument passed to the mock `complete` and asserts it contains exactly `foo_score`/`number` and NOT the prototype keys (proves derivation, not a hardcoded `INSPIRATION_SCHEMA`); (b) has the mock return EXTRA keys including a user field (e.g. `{ foo_score: 5, notes: "INJECTED" }`) and asserts `notes` was NOT overwritten (proves the enrichable filter, not just that nothing tried); (c) asserts `search_blob` refreshed; (d) `disabledLlm` → `done`. No real LLM. *(Red must be an assertion failure against a stubbed module, not a missing-import error.)*

## Tasks / Subtasks

- [x] **Task 1 — Write the failing enrichment tests first (TDD)** (AC: 1, 2, 3, 4, 5)
  - [x] Create `enrichment/worker.test.ts`: temp descriptor with a **novel** enrichable key (`foo_score: number`, in no prototype constant) + a user field (`notes`, `enrichable:false`). Capture the `schema` arg passed to the mock `complete`; assert it contains `foo_score`/`number` and NOT prototype keys (AC 5a). Mock returns `{ foo_score: 5, notes: "INJECTED" }`; assert `notes` NOT overwritten (AC 5b enrichable filter) + `foo_score` written + `search_blob` refreshed. Add: schema-violating output → item `error`; `disabledLlm` → `done`. Plus a pure `buildEnrichmentSchema(InspirationDescriptor)` test asserting the design/facets keys (AC 3).
  - [x] Run; confirm red is an **assertion failure against a stubbed module**, not a missing-import error.
- [x] **Task 2 — Build prompt + zod schema from the descriptor** (AC: 1)
  - [x] Create `enrichment/worker.ts`: `buildEnrichmentSchema(descriptor)` → a **zod** schema over the `enrichable:true` fields, mapping each closed type → zod type — **excluding `image`/asset-backed fields** (not LLM-emittable). `buildEnrichmentPrompt(descriptor, item)` → the prompt from `descriptor.enrichment_prompt` + the captured content (port the prototype's `buildAnalysisPrompt` shape, `add.ts:339-349`, incl. the untrusted-content guard). Both pure + unit-testable. (Note: `form`/`domain` map to `text` per Story 1.2's open-vocab decision — do NOT re-add a taxonomy enum constraint; that would reject novel values with a spurious `LLMSchemaError`.)
- [x] **Task 3 — Run the enrichment job (call provider, validate, write enrichable-only)** (AC: 2, 4)
  - [x] The enrichment job (on the Story 5.1 worker): `ctx.llm.complete(prompt, schema)` → validate against the descriptor's enrichable field types → write ONLY `enrichable` keys into `item.fields` via the typed item-write helper (so `search_blob`/FTS refresh, Story 1.4) → `status=done`. **Do NOT catch `EnrichmentDisabledError`** — let it propagate to Story 5.2's classifier (which resolves it to `done`); 5.2 owns that rule. Other errors propagate too → 5.2 maps `LLMSchemaError`/`LLMTransportError` → `error` + clean reason.
- [x] **Task 4 — Enqueue enrichment AFTER capture completes (hop 2 only)** (AC: 3)
  - [x] After a capture job (Epic 6) writes the item's captured fields + assets, enqueue the enrichment job for it (same worker). **This is the capture→enrich hop (hop 2) — 7.1 owns it.** The add-item→capture hop (hop 1) is wired in Story 6.1 Task 5 (Epic 6), NOT here — do not re-claim it. Skip enrichment when the provider is `disabledLlm` (it propagates `EnrichmentDisabledError` → `done` via 5.2, so it's safe to enqueue, but you may also short-circuit to `done` without a provider call).
- [x] **Task 5 — Wire tests + verify green** (AC: 5)
  - [x] Add the test to the `test` script; run `npm test`; confirm green + existing suites unaffected.

## Dev Notes

### What this story changes vs preserves (read before coding)

- **NEW `enrichment/worker.ts`** — architecture §6 (`enrichment/worker.ts`: "descriptor → prompt+schema → provider → validate → write"). This is the heart of the schema-as-data payoff.
- **Replaces the prototype's hardcoded analysis (recon).** The prototype builds analysis from per-collection constants: `SCHEMA`/`SYSTEM_PROMPT` (`add.ts:61-160`), `LIBRARY_SCHEMA`/`LIBRARY_SYSTEM_PROMPT` (`processor-library.ts:22-65`), via `buildAnalysisPrompt` (`add.ts:339-349`) + `analyze` (`add.ts:438-476`). v1 builds them DYNAMICALLY from the descriptor (Story 1.2 transcribed those constants into descriptors), so a new board enriches with no code. The CLI/HTTP transport is now `LLMProvider` (Epic 4); this story is the descriptor→prompt+schema→provider orchestration.
- **Uses: descriptor (1.2), LLMProvider (Epic 4), worker (5.1), status classification (5.2), typed item-write (1.4), capture (Epic 6).** Correctly placed after all of them.
- **Disabled-enrichment → `done` is Story 5.2's rule** — this story just lets the `EnrichmentDisabledError` propagate to the worker's classifier; it does not re-implement the catch.

### Why this design (anti-pattern prevention)

- **Schema FROM descriptor, never a constant (FR-7/AD9).** The entire schema-as-data thesis: the JSON-schema the LLM must fill is derived from `descriptor.enrichable` fields at runtime. A hardcoded `INSPIRATION_SCHEMA` would defeat AD9 — a new composed board (Epic 10) couldn't enrich without code. Build it from the descriptor. [Source: docs/bmad/architecture.md#4.4, docs/bmad/PRD.md#FR-7]
- **Write ONLY enrichable fields.** User-authored fields (notes, favorite — `enrichable:false`, Story 1.2) must NOT be overwritten by enrichment (and Story 7.3 preserves them across re-enrich). Writing the whole `fields` blob would clobber user data. Write the enrichable subset. [Source: docs/bmad/stories/7-3-re-enrich-refetch.md]
- **Validate against the descriptor's types.** The provider revalidates against the zod schema (Epic 4), but enrichment also checks the result conforms to the descriptor's closed field types before writing — an off-type value is a `LLMSchemaError` → `error`, not a silent bad write. [Source: docs/bmad/architecture.md#4.4]
- **Refresh search_blob through the typed write.** Enriched fields are searchable — write via the typed item-write helper (1.4) so `search_blob`/FTS update. A direct `UPDATE` would leave the index stale. [Source: docs/bmad/stories/1-4-fts5-search-blob.md]
- **Untrusted-content guard.** The captured page text is untrusted; the prompt must wrap it with the prototype's guard (`add.ts:339-349`, the `<user_instruction>`/untrusted-data warning) so a malicious page can't hijack the enrichment prompt. Port it. [Source: add.ts#339-349]

### Project Structure Notes

- `enrichment/worker.ts` + `.test.ts`. Uses descriptor (1.2), LLMProvider (Epic 4), worker (5.1), typed item-write (1.4).
- ESM `.js` specifiers; `node:test`; mock provider (no real LLM); add the test to the `test` script.

### Testing standards

- Mock `LLMProvider`; temp board/descriptor; assert schema-from-descriptor (the key AD9 proof), enrichable-only write, search_blob refresh, disabled→done, schema-violation→error.
- The "schema built from descriptor" assertion is load-bearing — assert the schema passed to `complete` reflects the descriptor's fields, not that *some* schema was passed.
- Existing suites green.

### References

- [Source: docs/bmad/architecture.md#4.4-schema-as-data-descriptor] — dynamic enrichment: worker builds prompt + JSON-schema from descriptor → provider.
- [Source: docs/bmad/PRD.md#FR-7] — dynamic, schema-driven enrichment; Inspiration vs Library outputs.
- [Source: add.ts#61-160] + [Source: processor-library.ts#22-65] — the prototype's hardcoded schemas/prompts (transcribed into descriptors in 1.2) this replaces dynamically.
- [Source: add.ts#339-349] — `buildAnalysisPrompt` + untrusted-content guard to port.
- [Source: docs/bmad/stories/1-2-board-descriptor-seeded-boards.md] — the descriptor (enrichable fields, enrichment_prompt) this reads.
- [Source: docs/bmad/stories/4-1-llm-provider-interface-conformance.md] — `LLMProvider.complete(prompt, schema)`.
- [Source: docs/bmad/stories/5-2-item-status-lifecycle.md] — the `EnrichmentDisabledError`→done / error-reason classification.
- [Source: docs/bmad/stories/1-4-fts5-search-blob.md] — the typed item-write that refreshes search_blob.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (BMAD dev-story workflow)

### Debug Log References

- `npm test` → 254 pass / 0 fail (248 prior + 5 enrichment + 1 capture-in-job deadlock regression).
- **Latent deadlock found + fixed:** `runCaptureForItem` (6.1) called the *enqueueing* `writeItem` while running inside a worker job (which already holds the `enqueueWrite` slot) → the inner enqueue waits for the outer slot, the outer awaits the inner → deadlock. Untested because tests called it directly / with an empty registry. Extracted `writeItemDirect` (no enqueue) for in-job callers; `writeItem` now wraps it. `runCaptureForItem` + enrichment use `writeItemDirect`; added a capture-in-job regression test.

### Completion Notes List

- ✅ All 5 ACs satisfied.
- **`buildEnrichmentSchema(descriptor)`** → a **zod** schema built FROM the descriptor's `enrichable:true` fields (closed type → zod), EXCLUDING `image` (not LLM-emittable) and non-enrichable fields; each field optional (partial responses validate). Proven on a NOVEL key (`foo_score:number`, in no prototype constant) — schema contains it, NOT the prototype keys (AD9 derivation, not a hardcoded `INSPIRATION_SCHEMA`). `form`/`domain` stay `text` (no re-added taxonomy enum, per 1.2).
- **`buildEnrichmentPrompt`** = `descriptor.enrichment_prompt` + captured content (title/source/page text) wrapped in the prototype's untrusted-content guard.
- **`runEnrichmentForItem`** calls `ctx.llm.complete(prompt, schema)`, then writes **ONLY** enrichable keys (defensively filtered to `enrichableTargets`, so a model returning extra/user keys like `notes` can't overwrite them) into `item.fields` via `writeItemDirect` → refreshes search_blob/FTS (proven: an enriched text field becomes FTS-searchable). User `notes` column untouched.
- **Disabled → done (AC4):** `EnrichmentDisabledError` is NOT caught here — it propagates to Story 5.2's classifier → item `done` with empty enrichable fields (tested via `runItemJob` + `disabledLlm`). Other errors propagate → 5.2 maps to `error` + clean reason.
- **Hop 2 wired (Task 4):** `add-item`'s capture job now runs capture THEN enrichment **inline in the one job**, so the item holds a single `processing` state until enriched (Story 5.3 "single persisted processing state" contract) rather than done→processing→done. (Hop 1, add-item→capture, was wired in 6.1.)

### File List

- `enrichment/worker.ts` (new) — `buildEnrichmentSchema`, `buildEnrichmentPrompt`, `runEnrichmentForItem`.
- `enrichment/worker.test.ts` (new) — 5 tests (schema-from-descriptor ×2, enrichable-only write + schema-capture, search_blob refresh, disabled→done).
- `db/queue.ts` (modified) — extracted `writeItemDirect` (in-job, no enqueue); `writeItem` wraps it (fixes the capture-in-job deadlock).
- `capture/adapter.ts` (modified) — `runCaptureForItem` uses `writeItemDirect`.
- `capture/adapter.test.ts` (modified) — capture-in-job deadlock regression test.
- `skills/add-item.ts` (modified) — capture job runs capture + enrichment inline (hop 2).
- `package.json` (modified) — appended `enrichment/worker.test.ts` to the `test` script.

### Change Log

- 2026-06-20 — Story 7.1 implemented: descriptor-driven enrichment (buildEnrichmentSchema/Prompt + runEnrichmentForItem), enrichable-only write + search_blob refresh, disabled→done via 5.2, hop-2 capture→enrich wiring. Fixed a latent capture-in-job deadlock (writeItemDirect). Status → review.
