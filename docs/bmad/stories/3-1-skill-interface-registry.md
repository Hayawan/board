# Story 3.1: Skill interface + registry + ctx injection

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Epic 3 — Skill-modular platform.** Establish the skill registry and the single generic invocation route, so every capability is a typed `Skill` from the start (zod contracts = future MCP schemas). *(FR-19, AD11.)*
>
> **Story 1 of 4 in Epic 3.** Build order: **(1) Skill interface + registry + ctx injection ◄ this story** → (2) generic `POST /skills/:name` route → (3) import-bookmarks skill → (4) core skills (add-item, create-board, tag). This story defines the `Skill` contract, the registry, and the injected `ctx`. It is the seam every capability epic plugs into. *(FR-19.)*

## Story

As the board-oss maintainer,
I want a `Skill { name, inputSchema, outputSchema, run(input, ctx) }` registry with an injected `ctx`,
so that capabilities are uniform, testable, and globals-free.

## Acceptance Criteria

1. **The `Skill` contract exists, with a `defineSkill` helper that infers I/O from the zod schemas.**
   **Given** the skill module, **When** a skill is defined via `defineSkill(name, inputSchema, outputSchema, run)`, **Then** the input/output TS types are **inferred** from the passed zod schemas (`z.infer<typeof inputSchema>`) — the author does not hand-write `Skill<I,O>` generics. The shape is `{ name, inputSchema, outputSchema, run(input, ctx): Promise<output> }`.

2. **`ctx` carries the mockable dependencies (named `boardId`, not `collectionId`) — `run` never reaches a global.**
   **Given** a registered skill, **When** `run` executes, **Then** it accesses `db`, `llm`, `queue`, `logger` (and optional `boardId`) **only via `ctx`** — no module-level/global access. All are injectable/mockable. *(Architecture §4.1 writes `collectionId?`; that text predates the boards rename — use `boardId?` to match the §5 data model `item.board_id`.)*

3. **`getSkill` returns `undefined` on an unknown name (the route owns the 404).**
   **Given** the registry, **When** `getSkill(name)` is called for a name not present, **Then** it returns `undefined` (it does NOT throw — unlike the prototype's `getProcessor`). *(Decided here, not "coordinated later": Story 3.2's 404 path only works if miss → undefined; a throw would become a 500.)* Registering a duplicate name MAY throw (a different, registration-time guard).

4. **The registry is injectable into `buildServer`, not an ambient global.**
   **Given** test isolation needs, **When** the server is built, **Then** `buildServer({ registry, db, ... })` accepts the registry as a parameter (like `db`), so `inject()` tests use a fresh registry holding only their fake skill. A module-global Map shared across test files would leak skills (last-write-wins, the `processors.ts` footgun) — avoid it.

5. **`ctx.llm` is a real `LLMProvider` interface (declared here), defaulting to a throwing-sentinel disabled provider.**
   **Given** the ctx type, **When** built with no provider configured, **Then** `ctx.llm` is `disabledLlm` — a provider implementing the real `LLMProvider` interface (NOT `null`, so callers never branch on `llm == null`) **whose `complete` THROWS a typed `EnrichmentDisabledError`** (declared here alongside it). This is a *throwing sentinel*, not a pure null-object: the contract is "`complete` MAY throw `EnrichmentDisabledError`; every caller treats that as enrichment-unavailable (degrade gracefully), never as a fatal/`status=error`." This story DECLARES the `LLMProvider` interface (`complete<T>(prompt: string, schema: ZodType<T>): Promise<T>`, per architecture §4.2) + `EnrichmentDisabledError`; Epic 4 implements the real transports; Epic 7/8.5 own the catch-and-degrade.

6. **A unit test proves ctx-injection positively and global-freedom structurally.**
   **Given** a fake skill whose `run` actually CALLS a ctx collaborator (e.g. `ctx.logger.info(...)` / a `ctx.db` op) and a mock ctx with **spies**, **When** run, **Then** the test asserts the spy received the call (positive proof injection works — an `echo` that touches no collaborator proves nothing). Global-freedom is enforced **structurally**: the test module imports no real db/llm/queue singleton, so any global reach is impossible by construction (state this mechanism — "no global accessed" is not a runtime assertion).

## Tasks / Subtasks

- [x] **Task 1 — Write the failing skill + registry test first (TDD)** (AC: 1, 2, 3, 4, 6)
  - [x] Create `skills/registry.test.ts`: define a fake skill via `defineSkill` whose `run` **calls a ctx collaborator** (e.g. `ctx.logger.info`); register it in a **fresh registry**; resolve by name; run with a mock ctx carrying spies; assert the spy received the call (AC 6 positive injection proof) and the output. Assert `getSkill("nope") === undefined` (AC 3).
  - [x] Run; confirm red (no registry/Skill types/`defineSkill`).
- [x] **Task 2 — Define `Skill`/`Ctx` types + the `defineSkill` helper + the `LLMProvider` interface** (AC: 1, 2, 5)
  - [x] Create `skills/types.ts`: the `Ctx` type `{ db, llm, queue, logger, boardId? }` (use `boardId`, not `collectionId`); the `Skill<I,O>` interface; and **`defineSkill(name, inputSchema, outputSchema, run)`** that infers `I = z.infer<typeof inputSchema>` / `O = z.infer<typeof outputSchema>` so skills never hand-write the generics (the ergonomic path — avoids `ZodType<I>` variance pain).
  - [x] **Declare the real `LLMProvider` interface here** (`complete<T>(prompt: string, schema: ZodType<T>): Promise<T>`, architecture §4.2) — interface only, zero impl. Epic 4 implements it. Do NOT write a throwaway "placeholder"; this is the canonical type Epic 4 depends on.
  - [x] Provide `disabledLlm` (a `LLMProvider` whose `complete` **throws `EnrichmentDisabledError`** — declare that error class here too) so `ctx.llm` is never `null` (AC 5). Do NOT leave it as "throws OR returns a sentinel" — pin the throw, because Epic 7's worker catches exactly that error to degrade gracefully; a sentinel-return would break that contract. Type `db` (Epic 1), `queue` (Story 1.3) against the real collaborators; `logger` is a minimal interface (prototype uses `console`; no logging lib).
- [x] **Task 3 — Implement the registry (undefined-on-miss, injectable)** (AC: 3, 4)
  - [x] Create `skills/registry.ts`: a `createRegistry()` factory returning `{ register(skill), get(name): Skill | undefined, list() }`. `get` returns `undefined` on miss (NOT throw). `register` MAY throw on a duplicate name (registration-time guard — the prototype lacks this, `processors.ts:22-24`).
  - [x] Make the registry an **injectable parameter of `buildServer({ registry })`** (Story 3.2 wires it) — not a module-global. A `registerAllSkills(registry)` boot function populates a given registry. Tests build a fresh registry per `inject()`.
- [x] **Task 4 — Build the `ctx` factory** (AC: 2, 5)
  - [x] A `buildCtx({ db, llm = disabledLlm, queue, logger, boardId? })` that assembles a `ctx`. The server (Story 3.2) builds the real ctx (with `config`-selected provider or `disabledLlm`); tests build a mock ctx with spies. No skill constructs its own db/llm/queue.
- [x] **Task 5 — Wire tests + verify green** (AC: 4)
  - [x] Add `skills/registry.test.ts` to the `test` script; run `npm test`; confirm green + existing suites unaffected.

## Dev Notes

### What this story changes vs preserves (read before coding)

- **NEW `skills/` directory** — architecture §6 (`skills/registry.ts` + per-skill files). This story builds `types.ts` + `registry.ts` + the ctx factory; concrete skills come in 3.3/3.4 and later epics.
- **The prototype already has a registry pattern to learn from — `processors.ts` (recon).** `processors.ts` defines `Processor` (a `{type, schema, systemPrompt, capture, validate, buildEntry, summarize}` interface, `processors.ts:3-18`), a module-level `registry: Record<string, Processor>` (`processors.ts:20`), `registerProcessor` (`processors.ts:22-24`, **last-registration-wins, no dup guard**), and `getProcessor` (`processors.ts:26-30`, throws on missing). The Skill registry is the *generalization* of this. Note the prototype's footguns to avoid: (a) **no duplicate-name guard** (a second `registerSkill("x")` silently overwrites — decide whether to throw on dup), and (b) **registration via import side-effects** (`inspirationProcessor` self-registers at `add.ts:561`, `libraryProcessor` at `processor-library.ts:218`), which is fragile (depends on import order). Prefer **explicit registration at boot** (a `registerAllSkills(registry)` called once) over import-side-effect registration.
- **`Processor` and `Skill` coexist for now.** The prototype's capture/analysis still runs through `Processor`; the Skill registry is the new platform. Epics 6/7 migrate capture/enrichment onto the new seams. Do not delete `processors.ts` here.

### The Skill contract (target — architecture §4.1)

[Source: docs/bmad/architecture.md#4.1-skill-contract]
```ts
type Ctx = { db: Drizzle; llm: LLMProvider; queue: JobQueue; collectionId?: string; logger: Logger };
interface Skill<I, O> {
  name: string;
  inputSchema: ZodType<I>;
  outputSchema: ZodType<O>;
  run(input: I, ctx: Ctx): Promise<O>;
}
```
- One `registry: Map<string, Skill>`, populated at boot.
- v1 skills (registered across this epic + later): `import-bookmarks` (3.3), `create-board`/`add-item`/`tag` (3.4), `generate-fields` (10.3), `compose-board` (10.1).
- **Skills call each other as plain function calls** — no event bus / scheduler (that would be a second runtime). [Source: docs/bmad/architecture.md#4.1, AD11]

### Why this design (anti-pattern prevention)

- **Everything via `ctx`, nothing global (AD11/testability).** The whole point is that every skill is mockable in-process: pass `db/llm/queue/logger` through `ctx` so a unit test runs a skill with fakes and zero I/O. This mirrors the prototype's injectable seams (`RunAddDeps`, injectable `fetchImpl`). A skill that imports the real `db` singleton breaks this — forbid it. [Source: docs/bmad/architecture.md#4.1, #7]
- **No scheduler/bus (AD11).** Skills compose by calling each other directly. Do NOT build an event system, queue-of-skills, or pub/sub — "that would be a second runtime." The job queue (Story 1.3/5.1) is for capture/enrichment work, not skill orchestration. [Source: docs/bmad/architecture.md#3-AD11]
- **zod contracts are mandatory — they are the future MCP tool schemas (FR-19).** Even though the UI is the only v1 caller, the in/out schemas must be real zod so external MCP/agent operability later is an adapter, not a rewrite. No `any`-typed skill I/O. [Source: docs/bmad/PRD.md#FR-19, AD12]
- **Explicit boot registration over import side-effects.** The prototype's side-effect registration (`add.ts:561`, `processor-library.ts:218`) is order-fragile. Register skills explicitly in one boot function so the set is deterministic and testable. [Source: processors.ts#20-30]

### Project Structure Notes

- `skills/types.ts`, `skills/registry.ts` (+ ctx factory, can co-locate). Per architecture §6.
- zod required — **Story 1.2 owns adding it as a direct dependency** (under the dependency policy). By Epic 3 it is a direct dep; do not relitigate the install. (Note: in the current prototype tree zod is only a *transitive* dep via puppeteer-core — a footgun, since a puppeteer bump could drop it; 1.2 makes it direct.)
- **3.1 owns the canonical `LLMProvider` interface** (architecture §4.2). Epic 4 implements transports against it — it does NOT redefine it. `ctx.llm` defaults to the disabled null-object so 3.2 can construct ctx before Epic 4 lands.
- ESM `.js` specifiers; `node:test`; add the test to the `test` script.

### Testing standards

- Fresh/factory registry per test (no shared module-global leakage between tests).
- Mock ctx with fakes for db/llm/queue/logger; assert the skill touched only the mocks (the "no global" proof).
- Existing suites green.

### References

- [Source: docs/bmad/architecture.md#4.1-skill-contract] — `Ctx`, `Skill<I,O>`, the registry, plain-function composition.
- [Source: docs/bmad/architecture.md#3-AD11] — skill-modular internals; zod contracts mandatory; no scheduler/bus.
- [Source: docs/bmad/PRD.md#FR-19] — skill registry & generic invocation; zod = future MCP schemas; UI-only v1 caller.
- [Source: processors.ts#3-30] — the prototype `Processor` interface + registry to generalize (and its dup-guard/side-effect-registration footguns to avoid).
- [Source: docs/bmad/stories/1-3-single-writer-queue.md] — the `queue` collaborator carried on ctx.
- [Source: docs/bmad/architecture.md#6-source-tree] — `skills/` module layout.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (BMAD dev-story workflow)

### Debug Log References

- `npm test` → 156 pass / 0 fail (149 prior + 7 new skill-registry tests).

### Completion Notes List

- ✅ All 6 ACs satisfied.
- **`defineSkill(name, inputSchema, outputSchema, run)`** infers I/O from the zod schemas (`z.infer<typeof inputSchema>`) — authors never hand-write `Skill<I,O>` generics.
- **`Ctx`** = `{ db, llm, queue, logger, boardId? }` (named `boardId`, not `collectionId`, to match §5). `run` reaches nothing global — all collaborators arrive via ctx. AC6 proven positively: the fake skill's `run` actually calls `ctx.logger.info` + `ctx.queue.enqueueWrite` and the test asserts the spies received the calls (not a passthrough echo). Global-freedom is structural: the test imports no real db/llm/queue singleton.
- **`createRegistry()`** factory (not a module-global): `register` (throws on duplicate name — the processors.ts footgun), `get` (returns `undefined` on miss, NOT throw — so Story 3.2's 404 works), `list`. `registerAllSkills(registry)` is the explicit boot-registration seam (empty now; 3.3/3.4/Epic 10 add skills) — chosen over import side-effects.
- **`LLMProvider` interface declared here** (canonical, `complete<T>(prompt, schema): Promise<T>`, architecture §4.2) — interface only; Epic 4 implements transports against it. **`disabledLlm`** is a throwing sentinel implementing the interface whose `complete` always throws the typed **`EnrichmentDisabledError`** (also declared here) — so `ctx.llm` is never null and callers degrade gracefully (Epic 7 / 8.5 own catch-and-degrade). `buildCtx` defaults `llm` to `disabledLlm`.
- **Registry not yet wired into `buildServer`** — that's Story 3.2 (the `buildServer({registry})` param). `processors.ts`/`Processor` left intact (coexist until Epics 6/7 migrate).

### File List

- `skills/types.ts` (new) — `Skill`/`Ctx`/`Logger`/`JobQueue` types, `LLMProvider` interface, `EnrichmentDisabledError` + `disabledLlm`, `defineSkill`, `buildCtx`.
- `skills/registry.ts` (new) — `createRegistry()` factory (dup-guard, undefined-on-miss) + `registerAllSkills` boot seam.
- `skills/registry.test.ts` (new) — 7 tests (defineSkill inference, positive ctx injection, fresh registry, undefined-on-miss, dup-throw, disabledLlm throws, buildCtx default).
- `package.json` (modified) — appended `skills/registry.test.ts` to the `test` script.

### Change Log

- 2026-06-20 — Story 3.1 implemented: Skill contract + defineSkill, injectable createRegistry (undefined-on-miss, dup-guard), Ctx + buildCtx, canonical LLMProvider interface + disabledLlm throwing sentinel. Status → review.
