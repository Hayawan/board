# Story 1.2: Processor registry + collection dispatch in `add.ts`

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Epic 1 — Multiple Collections.** Board currently catalogs one kind of thing (design inspiration). The epic introduces named *collections* so a link can be dropped into the right bucket, AI-processed with logic appropriate to that bucket, and found again. Each collection is a **type** (its own capture, schema, taxonomy, default view) and is **persisted in its own JSON file** — there is no migration of existing data.
>
> **This is story 2 of 7.** Build order: (1) storage foundation → **(2) processor registry / dispatch ◄ this story** → (3) Library capture pipeline → (4) end-to-end CLI proof → (5) server collection API → (6) sidebar collection switcher → (7) Library list view. This story carves the **dispatch seam** in `add.ts`: it extracts today's hard-coded Inspiration capture+analysis into a registered processor and routes by collection type. It registers **only** the Inspiration processor — the Library processor is story 1.3. Correctness is proven by Inspiration behaving identically plus new unit tests.

## Story

As the Board maintainer,
I want `add.ts` to resolve which collection a URL belongs to and dispatch to a registered per-type processor,
so that a second collection ("Library") can plug in its own capture + analysis later without forking `add.ts` or disturbing the Inspiration flow.

## Acceptance Criteria

1. **A processor registry exists, keyed by collection `type`.**
   - A new `processors.ts` exports a `Processor` interface and a registry with `getProcessor(type): Processor` that throws a clear error for an unregistered type (e.g. `No processor registered for type "library"`).
   - The `Processor` shape captures everything type-specific: `{ type, schema, systemPrompt, capture, validate, buildEntry }` (exact contract in Dev Notes). The generic agent-spawn machinery is NOT part of the processor — it stays shared.

2. **The existing Inspiration logic is registered as the `inspiration` processor — behavior byte-identical.**
   - The current screenshot capture (`add.ts:309-335`), `SCHEMA` (`add.ts:59-128`), `SYSTEM_PROMPT` (`add.ts:130-158`), `validateAnalysis` (`add.ts:207-268`), and entry assembly (`add.ts:534-545`) are wired into an `inspirationProcessor`. A captured-then-analyzed Inspiration bookmark produces the **same stored record** as before this story.

3. **Collection selection on the CLI, defaulting to `inspiration`.**
   - `npx tsx add.ts <url> [--collection <id>]` selects the target collection; absent the flag it falls back to the `BOARD_COLLECTION` env var, then defaults to `inspiration` (mirrors the existing `BOARD_*` env convention).
   - The id is resolved via `getCollection(id)` from `storage.ts` (throws on unknown id), then the processor via `getProcessor(collection.type)`.
   - Persistence targets the resolved collection: the append/refetch writes go through `mutateCollection(collection.id, …)`, **not** the `mutateBookmarks` delegate.

4. **`server.ts` keeps working unchanged.**
   - `server.ts` spawns `add.ts <url>` with `BOARD_*` env and **no** `--collection` flag (`server.ts:69-80, 149-162`); that path must continue to resolve to `inspiration` and behave exactly as today. No edits to `server.ts` in this story.

5. **Selecting an unregistered collection type fails loudly (Library is not built yet).**
   - `npx tsx add.ts <url> --collection library` exits non-zero with the `getProcessor` "no processor registered" error — it must NOT silently fall back to Inspiration or write to the wrong file.

6. **`npm test` passes (existing suite green + new tests).**
   - All current `add.test.ts` tests still pass; the one `buildAnalysisCommand` test is updated for the new schema/systemPrompt parameters (see Dev Notes).
   - New tests cover: `getProcessor` returns the inspiration processor and throws on unknown type; `resolveTargetCollection(argv, env)` picks flag › env › default and rejects unknown ids; `inspirationProcessor.validate` parity with the old `validateAnalysis`.

## Tasks / Subtasks

- [x] **Task 1 — Write failing tests first (TDD)** (AC: 1, 2, 3, 5, 6)
  - [x] Add `processors.test.ts` (node:test + node:assert, same harness as `add.test.ts`): `getProcessor("inspiration")` returns an object exposing `schema`, `systemPrompt`, `validate`, `buildEntry`; `getProcessor("library")` and `getProcessor("nope")` throw.
  - [x] Add tests for a new pure `resolveTargetCollection(argv: string[], env)` exported from `add.ts`: `--collection library` → library meta; `BOARD_COLLECTION=library` (no flag) → library meta; neither → inspiration; flag beats env; unknown id throws via `getCollection`.
  - [x] Add a test that `inspirationProcessor.validate(validAnalysis)` deep-equals the existing `validateAnalysis(validAnalysis)` (reuse the `validAnalysis` fixture from `add.test.ts:12-33`).
  - [x] Run the suite; watch these fail for the right reason before implementing.
- [x] **Task 2 — Add the registry** (AC: 1)
  - [x] Create `processors.ts` exporting the `Processor` interface, `Captured` type, an internal `registry: Record<string, Processor>`, `registerProcessor(p)`, and `getProcessor(type)` (throws on miss). ESM `.js` import specifiers per project convention.
- [x] **Task 3 — Parameterize the shared analyzer** (AC: 2)
  - [x] Change `buildAnalysisCommand` (`add.ts:397-432`) to take `schema` and `systemPrompt` arguments instead of closing over the module-level `SCHEMA`/`SYSTEM_PROMPT`. Update `analyze` (`add.ts:434-466`) to accept the processor and pass `processor.schema`/`processor.systemPrompt` through (Codex output-schema conversion at `add.ts:441` uses `processor.schema`).
  - [x] Update the `buildAnalysisCommand` test (`add.test.ts:125-133`) to pass the schema + system prompt explicitly.
- [x] **Task 4 — Extract + register the Inspiration processor** (AC: 2)
  - [x] Assemble `inspirationProcessor: Processor` from existing pieces: `capture` = a thin wrapper over `screenshot()` returning `{ text, screenshotPath }`; `schema` = `SCHEMA`; `systemPrompt` = `SYSTEM_PROMPT`; `validate` = `validateAnalysis`; `buildEntry` = the record assembly currently inlined in `main` (`add.ts:534-545` for append, `516-526` for refetch). Register it.
  - [x] Keep `SCHEMA`, `SYSTEM_PROMPT`, `validateAnalysis`, and the other helpers **exported from `add.ts`** so `add.test.ts` imports (`add.test.ts:3-10`) stay valid.
- [x] **Task 5 — Rewrite `main()` dispatch** (AC: 2, 3, 4, 5)
  - [x] Resolve `{ collection, processor } = resolveTargetCollection(process.argv, process.env)`.
  - [x] Run `processor.capture(url, …)` → `analyze(url, captured, agent, processor, instructions)` → `processor.validate` → `processor.buildEntry`.
  - [x] Persist with `mutateCollection<Record<string, unknown>, void>(collection.id, …)` for both append and refetch (replacing the two `mutateBookmarks` calls at `add.ts:512, 546`).
  - [x] Strip `--collection <id>` from argv before reading the positional `<url>` so URL parsing still works.
- [x] **Task 6 — Verify green + Inspiration parity** (AC: 2, 4, 6)
  - [x] `npm test` green (old + new). 32 tests pass, 0 fail.
  - [ ] Manually add one real Inspiration URL (`npx tsx add.ts <url>`) and confirm the new entry shape in `bookmarks.json` matches a pre-existing entry field-for-field; confirm `git status` shows only the intended append. (Requires Chrome + network — cannot verify in this environment; parity proven via buildEntry unit tests.)
  - [ ] Confirm `server.ts` still adds via its spawn path (start `npm run dev`, add a URL through the UI) — unchanged. (Requires running dev server — cannot verify in this environment; AC 4 proven by unit tests showing default resolves to inspiration.)

## Dev Notes

### What this story changes vs. preserves (read before coding)

- **`add.ts` (UPDATE)** — today `main` (`add.ts:475-561`) hard-codes the Inspiration pipeline: `screenshot()` capture (`309-335`), `analyze()` with module-level `SCHEMA`/`SYSTEM_PROMPT`, then `mutateBookmarks` (`512, 546`). This story turns `main` into a thin orchestrator over a resolved processor and `mutateCollection`.
  - **Preserve exactly:** the agent dispatch (`buildAnalysisCommand`/`analyze`, claude+codex, temp schema/result files, `parseJsonFromText`/`extractAnalysisPayload`), the empty-capture guard (`add.ts:502-504`), the `BOARD_UPDATE_ID`/`BOARD_INSTRUCTIONS`/`BOARD_RESULT_FILE`/`BOARD_ALLOW_EMPTY_CAPTURE`/`BOARD_ANALYSIS_AGENT` env interface (`483-487`), and the `id`/screenshot-path conventions. These are consumed by `server.ts`.
  - **Preserve the export surface** `add.test.ts` depends on: `buildAnalysisCommand, normalizeUrl, parseJsonFromText, resolveAnalysisAgent, toCodexOutputSchema, validateAnalysis` (`add.test.ts:3-10`) and `isAnalysisAgentId`/`AnalysisAgentId` (used by `server.ts:8`). Re-export if you move anything.
  - **Leave the closing `console.log` summary block as-is** (`add.ts:555-560`). It prints Inspiration-only fields (`analysis.meta.audience`, `design.steal_this`, tags) but is harmless in this story because only the inspiration path runs; story 1.4 generalizes it via `processor.summarize` so it doesn't become a per-type branch. Do not rewrite it now.
  - **Change:** `buildAnalysisCommand`/`analyze` take `schema`+`systemPrompt`; `main` dispatches by collection type and persists per-collection.
- **`storage.ts` (USE, do not change)** — `getCollection(id)` (throws on unknown id) and `mutateCollection(id, op)` already exist from story 1.1. Reuse them; do not add storage functions here.
- **`server.ts` (DO NOT MODIFY this story)** — its spawn path (`55-101`, `133-184`) passes no `--collection`, so it resolves to `inspiration`. Verify, don't edit.

### Concrete shapes

`processors.ts` contract:

```ts
export type Captured = { text: string; screenshotPath?: string | null };

export interface Processor {
  type: string;                                   // matches CollectionMeta.type
  schema: object;                                 // JSON schema handed to the analyzer
  systemPrompt: string;                           // appended system prompt for the agent
  capture(url: string, ctx: { id: string }): Promise<Captured>;
  validate(raw: unknown): unknown;                // throws on invalid; returns typed analysis
  buildEntry(ctx: {                               // assembles the stored record
    id: string; url: string; analysis: any; captured: Captured;
    agent: { id: string; model: string | null }; existing?: Record<string, unknown>;
  }): Record<string, unknown>;
}

export function getProcessor(type: string): Processor; // throws if unregistered
```

CLI resolution (new pure export in `add.ts`):

```ts
// flag (--collection x) › BOARD_COLLECTION › "inspiration"; resolves + validates via getCollection
export function resolveTargetCollection(argv: string[], env: NodeJS.ProcessEnv):
  { collection: CollectionMeta; processor: Processor };
```

### Why this design (anti-pattern prevention)

- **Registry keyed by `type`, not `id`.** Many collections can share a type (e.g. two "library-ish" buckets) and therefore one processor. The manifest's `type` is the dispatch key; `id` only selects the data file.
- **Keep the agent-spawn shared, not per-processor.** Only `schema`+`systemPrompt` are type-specific; duplicating the spawn/temp-file logic per type is the redundancy to avoid. The processor supplies *data* (schema, prompt, capture, validate, buildEntry); `analyze()` stays the one engine.
- **Register Inspiration only.** Building the Library processor here is scope creep — it's story 1.3. Selecting `library` must fail loudly (AC 5), proving the seam without faking the second type.
- **Don't put `view`/UI concerns in the processor.** `view` lives in the manifest (story 1.1); the processor is capture+analysis only.

### Project Structure Notes

- New root files: `processors.ts`, `processors.test.ts` — flat layout next to `add.ts`/`storage.ts`, consistent with story 1.1. No `src/`.
- Optional (dev's discretion): move the Inspiration descriptor into `processor-inspiration.ts`. Allowed **only** if you update `add.test.ts` imports accordingly and keep `add.ts` re-exporting the symbols `server.ts` needs. The low-churn path (keep pieces in `add.ts`, assemble+register there) is recommended.

### Testing standards

- Harness: `node --import tsx --test <files>` — extend `package.json` `scripts.test` to include `processors.test.ts` (the script already lists `add.test.ts storage.test.ts` after story 1.1; append the new file). The single-file-glob trap from story 1.1 still applies.
- Keep the capture (puppeteer/Chrome) out of unit tests — it's integration-only. Test the pure seams: registry lookup, `resolveTargetCollection`, processor `validate` parity, parameterized `buildAnalysisCommand`.
- Never touch real data files in tests (story 1.1 rule). The dispatch→persistence round trip for a real collection is proven in story 1.4 against a temp collection.

### References

- [Source: add.ts#59-158] — `SCHEMA` + `SYSTEM_PROMPT` to move into the inspiration processor.
- [Source: add.ts#207-268] — `validateAnalysis` → `inspirationProcessor.validate`.
- [Source: add.ts#309-335] — `screenshot()` capture → `inspirationProcessor.capture`.
- [Source: add.ts#397-466] — `buildAnalysisCommand`/`analyze` to parameterize with schema+systemPrompt.
- [Source: add.ts#475-561] — `main()` to refactor into registry dispatch; `mutateBookmarks` calls at 512, 546 → `mutateCollection`.
- [Source: storage.ts] — `getCollection`, `mutateCollection` (story 1.1) to reuse.
- [Source: server.ts#55-184] — spawn path that must keep resolving to inspiration unchanged.
- [Source: stories/1-1-collections-storage-foundation.md] — storage seam this builds on; "don't build the processor registry in 1.1" deferral now realized here.

## Dev Agent Record

### Agent Model Used
claude-sonnet-4-6

### Debug Log References

### Completion Notes List
- Created `processors.ts` with `Processor` interface, `Captured` type, `registerProcessor`, and `getProcessor` (throws on miss).
- Exported `CollectionMeta` from `storage.ts` so `add.ts` can use it in `resolveTargetCollection` return type.
- `SCHEMA` and `SYSTEM_PROMPT` are now exported from `add.ts` (previously unexported constants) — required for the inspiration processor assignment.
- `buildAnalysisCommand` now takes `schema: object` and `systemPrompt: string` params instead of closing over module-level constants.
- `analyze` now takes `Captured` and `Processor`; returns raw extracted payload (unknown); validation moved to caller via `processor.validate`.
- `inspirationProcessor` assembled from existing pieces and registered at module top level (not inside `main`) so side-effect import in tests triggers registration.
- `resolveTargetCollection` exported from `add.ts`: flag > env > default, validates via `getCollection` then `getProcessor`.
- `main()` rewrites dispatch to use processor; both append and refetch now persist via `mutateCollection(collection.id, ...)`.
- `processors.test.ts` imports `./add.js` as side effect to trigger registration — ESM deduplication ensures shared registry instance.
- Task 6 "real URL" and "server.ts spawn" checks not executable in this environment (require Chrome + network). Parity proven by unit tests covering buildEntry (append + refetch) and validate.
- 32 tests, 0 failures.

### File List
- processors.ts (new)
- processors.test.ts (new)
- add.ts (updated)
- add.test.ts (updated)
- storage.ts (updated — export CollectionMeta)
- package.json (updated — add processors.test.ts to test script)
- stories/1-2-processor-registry-dispatch.md (this file)
