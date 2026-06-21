# Story 3.3: import-bookmarks skill

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Epic 3 — Skill-modular platform.** Story 3 of 4. Build order: (1) Skill interface + registry → (2) generic route → **(3) import-bookmarks skill ◄ this story** → (4) core skills. This story makes import a first-class, invokable Skill (FR-20 part 2), wrapping the flat-JSON importer core from Story 1.5. *(FR-20 part 2.)*

## Story

As a user,
I want an import skill that ingests bookmarks (incl. the prototype's flat JSON) into a board,
so that import is a first-class, invokable capability rather than a one-off script.

## Acceptance Criteria

1. **The `import-bookmarks` skill creates items under the target board.**
   **Given** a bookmarks payload and a target board, **When** the `import-bookmarks` skill runs (via `POST /skills/import-bookmarks` or directly), **Then** items are created under that board with `status=pending`.

2. **Dedupe by preserved record id (global, via the `item.id` PK).**
   **Given** a payload containing a bookmark whose preserved record id already exists as an `item.id`, **When** the skill runs, **Then** the existing item is not duplicated. *(Dedupe is GLOBAL by `item.id` — Story 1.5 preserves the record id as the `item.id` primary key, so a given record can't be re-inserted regardless of board. The earlier "exists in the board" framing was wrong: the same record id can't live under two boards, since `item.id` is the PK.)*

3. **Reuses the Story 1.5 board-agnostic per-record mapper — does not fork the mapping.**
   **Given** Story 1.5's layer-(a) `importRecords({ boardId, records, db })` (the board-agnostic mapper + insert), **When** the skill runs, **Then** it calls that — it does not reimplement record→item mapping. *(This is why 1.5 was amended to expose a board-agnostic mapper separable from file-reading: the skill's in-memory `{boardId, bookmarks}` payload wraps it directly.)*

4. **A unit test asserts created items, status, and reported dedupe counts.**
   **Given** a fake/mock `ctx`, **When** the test runs the skill on a small payload twice, **Then** the first run reports `created = N` (items under the target board at `status=pending`) and the second run reports `created = 0, skipped = N` (assert the OUTPUT counts, not just that the DB didn't grow — proves the skill *reports* the dedupe).

## Tasks / Subtasks

- [x] **Task 1 — Write the failing skill test first (TDD)** (AC: 1, 2, 3, 4)
  - [x] Create `skills/import-bookmarks.test.ts`: mock ctx (temp DB + seeded boards); run the skill on a 2–3-record payload; assert items under the target board with `status=pending`; run again; assert no duplicates.
  - [x] Run; confirm red.
- [x] **Task 2 — Define the skill's zod in/out schemas** (AC: 1)
  - [x] `inputSchema`: `{ boardId: string, bookmarks: z.array(z.record(z.unknown())) }` — the records are descriptor-shaped/freeform, so use `z.record(z.unknown())`, **NOT `z.any()`** (FR-19 forbids `any`-typed I/O). `outputSchema`: `{ created: number, skipped: number, itemIds: string[] }`. (The `source`-flat-file path is the optional migration convenience; the payload form is the v1-must that satisfies the AC.)
- [x] **Task 3 — Implement the skill wrapping the 1.5 per-record mapper** (AC: 1, 2, 3)
  - [x] Create `skills/import-bookmarks.ts`: a skill (via `defineSkill`) whose `run(input, ctx)` validates the target board exists, then calls Story 1.5's **`importRecords({ boardId, records, db: ctx.db })`** (layer (a), the board-agnostic mapper that writes through the typed item-write helper so `status=pending`, `search_blob`/FTS maintained, dedupe by preserved `item.id`). Return the created/skipped counts.
  - [x] If supporting the flat-file migration path (FR-20 part 1 reuse), accept an optional `source` mode that delegates to 1.5's `importFlatJson` wrapper (graceful when files absent). This is optional; the payload form is required.
- [x] **Task 4 — Register the skill at boot** (AC: 1)
  - [x] Add `import-bookmarks` to `registerAllSkills(registry)` (Story 3.1/3.2). Confirm it's invokable via `POST /skills/import-bookmarks` (the 3.2 route).
- [x] **Task 5 — Wire tests + verify green** (AC: 4)
  - [x] Add the test to the `test` script; run `npm test`; confirm green + existing suites unaffected.

## Dev Notes

### What this story changes vs preserves (read before coding)

- **NEW `skills/import-bookmarks.ts`** — a thin Skill over the Story 1.5 importer core. Architecture §4.1 lists `import-bookmarks` as a v1 skill.
- **Depends on Story 1.5 (`db/importer.ts`) and Stories 3.1/3.2 (registry + route).** The mapping logic lives in 1.5; this story is the Skill *contract* + registration + the dedupe/`status=pending` behavior. **Do not fork the record→item mapping** — 1.5's Dev Notes explicitly reserve the skill wrapper for this story and say "don't fork the logic."
- **The prototype's import is ad-hoc, not a skill (recon).** Today there is no import skill; the closest is the importer this epic introduces. There is a prototype `scripts/migrate-categories.mjs` (a one-off taxonomy migration) — not related; do not extend it.

### FR-20's two parts (the split that matters)

[Source: docs/bmad/PRD.md#FR-20, docs/bmad/epics.md#Story-1.5, #Story-3.3]
- **Part 1 (Story 1.5):** the one-shot flat-JSON → SQLite importer core (`db/importer.ts`) — the migration.
- **Part 2 (this story):** `import-bookmarks` as a registered Skill — making import a first-class capability invokable through the generic route. Both share the 1.5 core.

### Why this design (anti-pattern prevention)

- **Wrap, don't reimplement.** The mapping (bookmarks/library record → item + asset, dedupe by id, search_blob/FTS) is hard-won in 1.5. The skill adds the contract + `status=pending` + the board-target parameter, calling the same core. Two copies of the mapping will drift. [Source: docs/bmad/stories/1-5-flat-json-importer.md]
- **`status=pending`, not `done`.** Imported items are un-enriched; they enter at `pending` so the enrichment worker (Epic 7) can process them (or they sit as captured-only under FR-9 graceful). The epic AC is explicit about `status=pending`. [Source: docs/bmad/epics.md#Story-3.3]
- **Dedupe is the skill's job too.** A user might invoke import twice; dedupe (by the preserved record id from 1.5) must hold at the skill level, not just the migration. [Source: docs/bmad/epics.md#Story-3.3]
- **Real zod schemas (FR-19).** Even though the UI/migration is the only caller now, the in/out schemas are the future MCP tool contract. [Source: docs/bmad/PRD.md#FR-19]

### Project Structure Notes

- `skills/import-bookmarks.ts` + `.test.ts`. Registered in the boot registration (3.1/3.2).
- ESM `.js` specifiers; `node:test`; add the test to the `test` script.

### Testing standards

- Mock ctx with a temp seeded DB; small committed payload (not the real 464KB file).
- Assert created items (status=pending) + dedupe on a second run (the two AC behaviors).
- Existing suites green.

### References

- [Source: docs/bmad/PRD.md#FR-20] — import (incl. prototype flat-JSON); part 2 = the skill.
- [Source: docs/bmad/architecture.md#4.1-skill-contract] — `import-bookmarks` as a v1 skill.
- [Source: docs/bmad/stories/1-5-flat-json-importer.md] — the importer core this skill wraps (don't fork).
- [Source: docs/bmad/stories/3-1-skill-interface-registry.md] — the `Skill`/`ctx`/registry contract.
- [Source: docs/bmad/stories/3-2-generic-skills-route.md] — the `POST /skills/:name` route that invokes it.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (BMAD dev-story workflow)

### Debug Log References

- `npm test` → 166 pass / 0 fail (162 prior + 4 new skill tests). No `./data` pollution.

### Completion Notes List

- ✅ All 4 ACs satisfied.
- **`import-bookmarks` skill** = a thin `defineSkill` wrapper over Story 1.5's `importRecords` (the board-agnostic mapper) — mapping is NOT forked. `run` validates the target board exists (throws a clear error → 500 via the route if not), then delegates to `importRecords({ handle: ctx.db, boardId, records })`. Items land at `status=pending` (schema default), search_blob/FTS maintained by the writer.
- **Dedupe (AC2):** refactored `importRecords` to be **global dedupe by `item.id`** — it now SELECTs each record id and **skips** existing ones (instead of upserting), returning `{ created, skipped, itemIds }`. So a second run reports `created=0, skipped=N` and never duplicates or clobbers user edits. (1.5's `importFlatJson` still idempotent — it now reads `.created`; the 1.5 tests assert DB state, which is unchanged.)
- **Schemas (FR-19):** `input = { boardId: string, bookmarks: z.array(z.record(z.unknown())) }` (records freeform but NOT `z.any()`); `output = { created, skipped, itemIds }`.
- **Registered** in `registerAllSkills` → invokable via `POST /skills/import-bookmarks` (the 3.2 route).
- **Tests:** mock ctx + temp seeded DB + 2-record payload; asserts created=2/skipped=0/status=pending, second-run created=0/skipped=2/no-dup (the OUTPUT counts, per AC4), unknown-board throws, and zod shape rejection.

### File List

- `skills/import-bookmarks.ts` (new) — the skill (thin wrapper + board validation).
- `skills/import-bookmarks.test.ts` (new) — 4 tests (create/pending, dedupe counts, unknown board, schema).
- `db/importer.ts` (modified) — `importRecords` now skip-existing dedupe + returns `{created,skipped,itemIds}`; `importFlatJson` reads `.created`.
- `skills/registry.ts` (modified) — `registerAllSkills` registers `import-bookmarks`.
- `package.json` (modified) — appended the skill test to the `test` script.

### Change Log

- 2026-06-20 — Story 3.3 implemented: import-bookmarks skill wrapping the 1.5 importer core; importRecords upgraded to global id-dedupe with created/skipped reporting; registered on the generic route. Status → review.
