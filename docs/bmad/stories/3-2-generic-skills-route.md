# Story 3.2: Generic /skills/:name HTTP route with zod validation

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Epic 3 — Skill-modular platform.** Story 2 of 4. Build order: (1) Skill interface + registry → **(2) generic `POST /skills/:name` route ◄ this story** → (3) import-bookmarks skill → (4) core skills. This story adds the ONE route that validates input, runs the named skill, and validates output — so adding a capability needs no new bespoke route. *(FR-19.)*

## Story

As the frontend,
I want one route that validates input, runs the named skill, and validates output,
so that adding a capability needs no new bespoke route.

## Acceptance Criteria

1. **Valid body → parse, run, validate, return.**
   **Given** `POST /skills/:name` with a valid JSON body and a registered skill, **When** invoked, **Then** the body is `inputSchema.parse`d, `run(input, ctx)` executes, the result is validated against `outputSchema`, and the validated output is returned (200).

2. **Invalid body → 400 with the zod error.**
   **Given** `POST /skills/:name` with a body that fails `inputSchema`, **When** invoked, **Then** a 400 is returned with the zod validation error (a structured, readable message); `run` is NOT called.

3. **Unknown skill → 404.**
   **Given** `POST /skills/:name` for a name not in the registry, **When** invoked, **Then** a 404 (not a 500) is returned.

4. **Output that fails its own schema → 500 (a server bug, not a client error).**
   **Given** a skill whose `run` returns a value failing `outputSchema`, **When** invoked, **Then** a 500 is returned (the skill is broken), distinct from the 400 client-input case.

5. **A skill whose `run` throws → 500 (handled, not an unhandled crash).**
   **Given** a skill whose `run` throws, **When** invoked, **Then** the route catches it and returns a 500 — a distinct code path from the output-invalid case (AC 4) and the input-invalid case (AC 2). The process does not crash and no stack trace leaks to the client body.

6. **The route builds the real `ctx` (with `boardId`) and injects it; the registry is injected into `buildServer`.**
   **Given** a request, **When** the route runs a skill, **Then** it constructs `ctx` (db, llm, queue, logger, and `boardId` — not `collectionId` — from the route/body where relevant) and passes it to `run`. The registry is the one injected via `buildServer({ registry })` (Story 3.1), so tests supply a fresh registry holding only their fake skill.

7. **Tests use Fastify `inject()` for valid + invalid + unknown + run-throws.**
   **Given** `buildServer({ registry })` with a fresh registry, **When** the tests `inject()` a valid body, an invalid body, an unknown skill, and a skill whose `run` throws, **Then** they assert 200+output, 400+zod-error (assert `run` NOT called), 404, and 500 respectively — using registered fake skills so the test is hermetic (no dependence on concrete skills from 3.3/3.4).

## Tasks / Subtasks

- [x] **Task 1 — Write the failing route tests first (TDD)** (AC: 1, 2, 3, 4, 5, 7)
  - [x] In `skills-route.test.ts`: build `buildServer({ registry })` with a fresh registry holding fake skills; `inject()` `POST /skills/echo` valid → 200 + output; invalid body → 400 + zod error, assert `run` NOT called (spy); `POST /skills/nope` → 404; a fake skill returning bad output → 500 (AC 4); a fake skill whose `run` throws → 500 (AC 5), assert the process didn't crash and no stack trace in the body.
  - [x] Run; confirm red (no route).
- [x] **Task 2 — Implement the generic route in `buildServer`** (AC: 1, 2, 3, 4, 5, 6)
  - [x] Add `app.post("/skills/:name", handler)` inside `buildServer` (recon: `buildServer` at `server.ts:246`, routes registered through `server.ts:322`). Handler: `registry.get(name)` → 404 if `undefined`; `inputSchema.safeParse(body)` → 400 + error if invalid (do NOT call `run`); build `ctx`; `try { result = await skill.run(input, ctx) } catch → 500`; `outputSchema.safeParse(result)` → 500 if invalid; else return the validated output.
  - [x] Distinguish error classes cleanly: input-invalid = 400, unknown-skill = 404, run-throw = 500, output-invalid = 500. Don't collapse into one catch-all; don't leak zod/stack internals to the client.
- [x] **Task 3 — Inject the registry + build the real ctx** (AC: 6)
  - [x] Make `buildServer({ registry, db, ... })` accept the registry as a parameter (Story 3.1's seam). At boot, the app constructs a registry via `createRegistry()` + `registerAllSkills(registry)` (early skills/fakes now; 3.3/3.4 add concrete ones) and passes it in. Tests pass a fresh registry holding only their fakes.
  - [x] Build `ctx` from the server's `db`/`queue`/`logger` and the `config`-selected `llm` (or `disabledLlm`); resolve `boardId` (not `collectionId`) from the route params/body where the skill needs it.
- [x] **Task 4 — Add a `skillsUrl(name)` frontend helper (thin)** (AC: 1)
  - [x] In `collections-ui.js`, add `skillsUrl(name)` → `/skills/${name}` alongside the existing URL builders (recon: `itemsUrl`/`addUrl`/etc. at `collections-ui.js:9-13`). This is the client seam for later UI work; no UI behavior change yet.
- [x] **Task 5 — Wire tests + verify green** (AC: 6)
  - [x] Add the test file (if new) to the `test` script; run `npm test`; confirm green + existing suites unaffected (the new route must not disturb the existing `/api/*` routes).

## Dev Notes

### What this story changes vs preserves (read before coding)

- **`server.ts` (UPDATE)** — add ONE route inside the existing `buildServer` factory (`server.ts:246`). The prototype already registers all routes there (collection API `server.ts:259-293`, legacy aliases `server.ts:300-322`); `/skills/:name` slots in alongside. **Do not touch the existing `/api/*` routes** — they keep working; the skills route is additive (capability epics will gradually move logic behind skills).
- **Reuse the `inject()` test pattern** — `server.test.ts` uses `buildServer()` + `app.inject()` (recon). The skills-route tests follow the same pattern, registering a fake skill so they don't depend on concrete skills (which arrive in 3.3/3.4).
- **`ctx` from Story 3.1** — the route is the real `ctx` builder. `db` (Epic 1), `queue` (Story 1.3), `llm` (Epic 4 — may be a no-op/disabled provider at this point, that's fine; skills that need it handle absence per FR-9), `logger`.

### Why this design (anti-pattern prevention)

- **One generic route, not per-capability routes (FR-19).** The whole point of AD11: adding a capability = registering a skill, not adding a route + handler + test. Resist adding `/skills/import`, `/skills/tag` bespoke routes — there is exactly one `/skills/:name`. [Source: docs/bmad/architecture.md#4.1, docs/bmad/PRD.md#FR-19]
- **Validate BOTH directions (zod in and out).** Input validation protects against bad clients (400); output validation catches a broken skill (500). The architecture is explicit: `inputSchema.parse → run → outputSchema`. Skipping output validation lets a malformed skill result reach the UI. [Source: docs/bmad/architecture.md#4.1]
- **Distinct status codes per failure class.** 400 (client input) ≠ 404 (unknown skill) ≠ 500 (skill bug). Collapsing them hides server bugs as client errors and vice versa. The epic AC names the 400-on-invalid-body case explicitly. [Source: docs/bmad/epics.md#Story-3.2]
- **Don't leak zod internals as a 500.** A zod *input* failure is a 400 with a readable error, not an unhandled throw → 500. Use `safeParse` and shape the 400 body. [Source: docs/bmad/epics.md#Story-3.2]

### Project Structure Notes

- Route in `server.ts` (the `buildServer` factory). Registry/ctx from `skills/` (Story 3.1). `skillsUrl` in `collections-ui.js`.
- ESM `.js` specifiers; `node:test` + Fastify `inject()`; add any new test file to the `test` script.

### Testing standards

- Hermetic: register a fake skill in the test; do not depend on concrete skills (3.3/3.4).
- Assert the three classes (200/400/404) + the output-invalid 500; assert `run` is NOT called on a 400 (input rejected before run).
- Existing `/api/*` route tests stay green.

### References

- [Source: docs/bmad/architecture.md#4.1-skill-contract] — `POST /skills/:name` → `inputSchema.parse` → `run` → `outputSchema`; UI is the only v1 caller.
- [Source: docs/bmad/PRD.md#FR-19] — generic invocation route; one route for all capabilities.
- [Source: server.ts#246] — `buildServer` factory where the route registers.
- [Source: server.ts#259-322] — existing routes (collection API + legacy aliases) the skills route sits beside, unchanged.
- [Source: server.test.ts] — `buildServer()` + `inject()` test pattern to follow.
- [Source: collections-ui.js#9-13] — URL builders to extend with `skillsUrl(name)`.
- [Source: docs/bmad/stories/3-1-skill-interface-registry.md] — registry + ctx this route consumes.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (BMAD dev-story workflow)

### Debug Log References

- `npm test` → 162 pass / 0 fail (156 prior + 5 route + 1 skillsUrl). No `./data` pollution.

### Completion Notes List

- ✅ All 7 ACs satisfied.
- **One generic `POST /skills/:name` route** in `buildServer` (no per-capability routes). Flow: `registry.get(name)` → 404 if undefined; `inputSchema.safeParse` → 400 + zod `issues` (run NOT called); build ctx; `try run catch` → 500; `outputSchema.safeParse` → 500 if invalid; else return validated output. Distinct status classes: 400 (client input) ≠ 404 (unknown) ≠ 500 (run-throw / output-invalid). No stack/message leaked to the client body (generic messages; full detail logged server-side).
- **Registry + ctx injection (AC6):** `buildServer({ registry, db, queue, logger, llm })` extended (Story 3.1 seam). Production defaults: fresh `createRegistry()` + `registerAllSkills`, `console` logger, `{ enqueueWrite }` queue, `disabledLlm` (Epic 4 selects the real provider). **ctx is built lazily inside the handler** so opt-less `buildServer()` callers that never hit `/skills` never open the real DB (kept tests pollution-free). `boardId` (not `collectionId`) resolved from the body when present.
- **Existing `/api/*` routes untouched** — the skills route is purely additive.
- **`skillsUrl(name)`** added to `collections-ui.js` (thin client seam, no UI behavior change) + a unit test.
- **Hermetic tests:** fresh registry of fake skills + injected fake db/logger; asserts 200+output, 400+issues (run-count unchanged), 404, output-invalid 500, run-throws 500 with no stack leak.

### File List

- `server.ts` (modified) — `BuildServerOptions` (registry/db/queue/logger/llm), the generic `/skills/:name` route, lazy ctx build.
- `skills-route.test.ts` (new) — 5 route tests (200/400/404/500×2, hermetic).
- `collections-ui.js` (modified) — `skillsUrl(name)` helper.
- `collections-ui.test.ts` (modified) — `skillsUrl` test.
- `package.json` (modified) — appended `skills-route.test.ts` to the `test` script.

### Change Log

- 2026-06-20 — Story 3.2 implemented: the one generic `/skills/:name` route (validate-in → run → validate-out) with distinct 400/404/500 classes and no stack leak; registry/ctx injected into buildServer; skillsUrl client seam. Status → review.
