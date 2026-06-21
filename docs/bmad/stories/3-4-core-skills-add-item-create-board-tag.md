# Story 3.4: Core capabilities registered as skills (add-item, create-board, tag)

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Epic 3 — Skill-modular platform.** Story 4 of 4. Build order: (1) Skill interface + registry → (2) generic route → (3) import-bookmarks → **(4) core skills (add-item, create-board, tag) ◄ this story**. This story registers the remaining core capabilities as Skills with zod contracts, so the "every capability is a skill" principle (AD11) holds uniformly and the UI drives them through the one generic route. *(FR-19; full behaviors detailed in their home epics.)*

## Story

As the board-oss maintainer,
I want the remaining core capabilities registered as Skills with zod contracts,
so that AD11 holds uniformly and the UI drives them through the one generic route.

## Acceptance Criteria

1. **`add-item`, `create-board`, `tag` are registered Skills with zod in/out schemas.**
   **Given** the registry, **When** the app boots, **Then** `add-item`, `create-board`, and `tag` are registered with real zod `inputSchema`/`outputSchema` and are invokable via `POST /skills/:name`.

2. **The `tag` skill updates tags and the item becomes findable by the new tag via FTS.**
   **Given** the `tag` skill with `{ itemId, tags }`, **When** invoked, **Then** the item's `tags` field is updated AND **an FTS query for the new tag returns the item** (proving the index refreshed, not just the column — exercise the index, since "field updated but index stale" is the silent search bug). The field-changed assertion is secondary; the FTS-returns-item assertion is load-bearing.

3. **`add-item` and `create-board` have correct contracts + minimal, UNCONDITIONAL v1 behavior.**
   **Given** the registry, **When** the skills run, **Then**:
   - `create-board` takes a **validated descriptor** (reusing Story 1.2's descriptor-validation + board-insert — does NOT fork them) and inserts a `board` row. NL→descriptor generation is Epic 10 (the composer calls this skill on accept).
   - `add-item` takes `{ boardId, source, fields? }` and creates an `item` at `status=pending`. **It does NOT enqueue a capture/enrichment job** — there is no worker draining the queue (5.1) and no capture adapter (Epic 6) yet, so an enqueue would dangle. The enqueue is a documented seam Epic 6 fills; v1 here is "create the pending item, full stop."

4. **Unit tests assert SIDE-EFFECTS, not just registration.**
   **Given** the registry + `inject()` (fresh registry per Story 3.1) + a temp DB, **When** the tests run, **Then** they assert: after `create-board`, a `board` row exists; after `add-item`, a `status=pending` item exists; after `tag`, the FTS query returns the item (AC 2). Asserting only "registered + reachable / 200" does NOT satisfy this — an empty `run` would pass that.

## Tasks / Subtasks

- [ ] **Task 1 — Write failing tests first (TDD)** (AC: 1, 2, 4)
  - [ ] In `skills/core-skills.test.ts` (fresh registry + temp DB): assert each of the three skills resolves and is reachable via `POST /skills/:name`; then assert the **side-effects** (AC 4): after `create-board` a `board` row exists; after `add-item` a `status=pending` item exists; after `tag`, an **FTS query for the new tag returns the item** (AC 2 — exercise the index, not just read the field).
  - [ ] Run; confirm red.
- [ ] **Task 2 — Implement the `tag` skill (fully specified here)** (AC: 2)
  - [ ] `skills/tag.ts`: `inputSchema { itemId, tags: string[] }`, `outputSchema { itemId, tags }`. `run` loads the item via `ctx.db`, updates its `tags` field, and writes through the **typed item-write helper (Story 1.4 — the FTS-maintaining write)** so `search_blob`/FTS refresh. The proof (Task 1) is an FTS query returning the item, not a column read.
- [ ] **Task 3 — Implement `create-board` (reuse 1.2; persistence primitive only)** (AC: 3)
  - [ ] `skills/create-board.ts`: `inputSchema` = a board descriptor validated against **Story 1.2's descriptor schema + board-insert helper** — REUSE them, do not fork (same wrap-not-fork rule as 3.3, so there aren't two board-insert paths drifting from 1.2's seed). `run` validates (closed field-type set) and inserts a `board` row. The composer (Epic 10) builds the descriptor from NL and calls this skill on accept — keep `create-board` the persistence primitive, not the NL generator.
- [ ] **Task 4 — Implement `add-item` (create pending item ONLY; no enqueue)** (AC: 3)
  - [ ] `skills/add-item.ts`: `inputSchema { boardId, source, fields?: z.record(z.unknown()) }` (freeform `fields` is descriptor-shaped — `z.record(z.unknown())`, not `any`), `outputSchema { itemId, status }`. `run` creates an `item` under the board at `status=pending` via the typed item-write helper — and **does NOT enqueue** any capture/enrichment job (no worker drains the queue until 5.1; no capture adapter until Epic 6). Leave a documented seam (a clearly-commented extension point) where Epic 6 adds the enqueue. Do NOT half-wire an enqueue against a non-existent worker/adapter.
- [ ] **Task 5 — Register all three at boot** (AC: 1)
  - [ ] Add the three to `registerAllSkills(registry)`. Confirm each is invokable via the 3.2 route.
- [ ] **Task 6 — Wire tests + verify green** (AC: 4)
  - [ ] Add the test to the `test` script; run `npm test`; confirm green + existing suites unaffected.

## Dev Notes

### What this story changes vs preserves (read before coding)

- **NEW `skills/add-item.ts`, `skills/create-board.ts`, `skills/tag.ts`.** Architecture §4.1 lists all three as v1 skills.
- **Boundary discipline is the whole point of this story.** The epic AC explicitly says these skills' *full* behavior is "detailed in their home epics" — `add-item` capture/enrich in Epics 6/7, `create-board` composer in Epics 1/10. This story registers the **contracts** + the **minimal correct v1 `run`**, and the `tag` skill's *complete* behavior (it has no later home). Do NOT build capture, enrichment, or the NL composer here.
- **The prototype's "add" is `runAdd` in `add.ts` (recon).** `runAdd` (`add.ts:570-634`) does the full capture→analyze→persist flow via `mutateCollection`. `add-item` here is the *skill contract* over creating a pending item; Epic 6/7 migrate the capture/enrich behind it. Do not try to port all of `runAdd` into the skill now — that's Epic 6/7.
- **`tag` interacts with the typed item-write helper (Story 1.3/1.4)** so search_blob/FTS refresh. The prototype has no server-side tagging skill; client filtering uses `tags` in `item.fields`.

### Why this design (anti-pattern prevention)

- **Contracts now, heavy behavior in home epics (sequencing).** Registering the skill contracts early means the UI can target the generic route and later epics fill the `run` bodies — AD11's "every capability is a skill from the start." Building capture/enrichment here would duplicate Epics 6/7 and bloat this story. [Source: docs/bmad/epics.md#Story-3.4]
- **`create-board` is the persistence primitive; the composer calls it.** Keep the NL→descriptor generation out (Epic 10). `create-board` takes a *validated descriptor* and writes it. This clean split is what lets the composer (10.1) "on accept, create a board" by invoking this skill. [Source: docs/bmad/epics.md#Story-10.1]
- **`tag` must refresh search_blob.** Tags are searchable (FTS over search_blob, Story 1.4). A `tag` skill that updates the field but not the index is a silent search bug — write through the typed item-write helper. [Source: docs/bmad/stories/1-4-fts5-search-blob.md]
- **Real zod schemas (FR-19).** All three are future MCP tools. [Source: docs/bmad/PRD.md#FR-19]

### Project Structure Notes

- `skills/add-item.ts`, `create-board.ts`, `tag.ts` (+ tests). Registered at boot.
- Depends on Story 1.2 (descriptor validation for `create-board`), Story 1.3/1.4 (typed item-write for `tag`/`add-item`), Stories 3.1/3.2 (registry + route).
- ESM `.js` specifiers; `node:test`; add the test to the `test` script.

### Testing standards

- Mock/temp-DB ctx; assert registration + invokability for all three; assert the concrete `tag` effect (field + search_blob).
- Keep `add-item`/`create-board` tests to their minimal v1 behavior (pending item; board-from-descriptor) — don't assert capture/enrich/composer here.
- Existing suites green.

### References

- [Source: docs/bmad/architecture.md#4.1-skill-contract] — `add-item`, `create-board`, `tag` as v1 skills.
- [Source: docs/bmad/PRD.md#FR-19] — registry & generic invocation; zod contracts.
- [Source: docs/bmad/epics.md#Story-3.4] — contracts now; full behavior in home epics; the `tag` effect.
- [Source: add.ts#570-634] — prototype `runAdd` (full capture/analyze/persist) that Epics 6/7 migrate behind `add-item`.
- [Source: docs/bmad/stories/1-2-board-descriptor-seeded-boards.md] — descriptor validation for `create-board`.
- [Source: docs/bmad/stories/1-4-fts5-search-blob.md] — typed item-write/search_blob the `tag` skill refreshes.
- [Source: docs/bmad/stories/3-1-skill-interface-registry.md], [Source: docs/bmad/stories/3-2-generic-skills-route.md] — registry + route.

## Dev Agent Record

### Agent Model Used

_(to be filled by dev agent)_

### Debug Log References

### Completion Notes List

### File List
