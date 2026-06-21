# Story 1.2: Board descriptor (schema-as-data) + closed field-type set + seeded boards

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Epic 1 — Storage foundation (schema-as-data).** Story 2 of 5. Build order: (1) SQLite + Drizzle schema → **(2) board descriptor + closed field-type set + seeded boards ◄ this story** → (3) single-writer queue → (4) FTS5 over search_blob → (5) importer. This story makes board behavior **data**: a validated `descriptor` JSON on a closed field-type set, with the two boards seeded as descriptors. The rest of the system (enrichment, rendering, search) reads these descriptors generically. *(FR-1, FR-2, C11.)*

## Story

As the board-oss maintainer,
I want board behavior stored as a validated `descriptor` on a closed field-type set, with the Inspiration and Library boards seeded,
so that board types are data (not code) and the rest of the system reads them generically without per-board branches.

## Acceptance Criteria

1. **A descriptor type + zod schema exist over the closed field-type set.**
   **Given** the descriptor module, **When** a descriptor is validated, **Then** it must conform to `{ fields: [{ key, label, type, enrichable? }], enrichment_prompt, view, ingest_mode }` where every field `type ∈ {text, number, date, url, enum, tags, image}` (and `enum` fields carry their allowed values).

2. **An out-of-set field type is rejected with a clear error.**
   **Given** a descriptor whose field declares a `type` outside the closed set (e.g. `"datetime"`, `"object"`), **When** it is validated, **Then** validation fails with a clear, field-identifying error message; the descriptor is not accepted.

3. **The two boards are seeded as descriptors.**
   **Given** the schema from 1.1, **When** the seed runs against a fresh DB, **Then** a `board` row exists for **Inspiration** (`view: grid`, `ingest_mode: url-screenshot`) and **Library** (`view: list`, `ingest_mode: url-readable`), each with a `descriptor` JSON holding `{ fields[], enrichment_prompt, view, ingest_mode }` that reflects the prototype's existing field sets.

4. **Seeding is idempotent.**
   **Given** the seed has already run, **When** it runs again, **Then** it does not create duplicate boards (no second Inspiration/Library row).

5. **A unit test asserts load + rejection with concrete, named assertions (not a field count).**
   **Given** the seeded DB, **When** the test loads the two descriptors, **Then** it asserts specific keys + types + flags, e.g.: Inspiration's `meta.audience` is `enum` carrying the `taxonomy.json` audience vocabulary, `meta.form`/`meta.domain` are `text`, `design_system_score` is `enum`, `tone`/`tags` are `tags`, and `favorite`/`notes` are `enrichable: false`; Library's `type` is `enum` from `LIBRARY_TYPES`, `key_points` is `text`, `topics` is `tags`, `notes` is `enrichable: false`. **And** the test asserts an out-of-set field `type` is rejected (AC 2). A test that only asserts "the descriptor has some fields" does NOT satisfy this AC.

## Tasks / Subtasks

- [x] **Task 1 — Write failing descriptor-validation + seed tests first (TDD)** (AC: 1, 2, 3, 4, 5)
  - [x] Create `descriptor/descriptor.test.ts`: assert a valid descriptor parses; assert an off-list `type` is rejected with a clear error; assert `enum` fields require allowed values.
  - [x] Create/extend a seed test (temp DB): run seed, assert two boards exist with the right `view`/`ingest_mode`, re-run seed, assert still exactly two (idempotent).
  - [x] Run; confirm red for the right reason (modules absent).
- [x] **Task 2 — Implement the descriptor schema (zod) + closed field-type set** (AC: 1, 2)
  - [x] Create `descriptor/types.ts` (or `descriptor/schema.ts`): the closed `FieldType` union `{text, number, date, url, enum, tags, image}`; the `Field` and `BoardDescriptor` zod schemas; a `validateDescriptor(value)` that returns the parsed descriptor or throws a clear error.
  - [x] Export the inferred TS types (`BoardDescriptor`, `Field`, `FieldType`) for downstream epics (enrichment 7.1, renderer 7.2, composer 10).
- [x] **Task 3 — Author the two seed descriptors from the prototype field sets** (AC: 3) — *transcribe the REAL schemas exactly; see the field-type table in Dev Notes (the prototype's types are subtler than they look).*
  - [x] **Inspiration** descriptor (`view: grid`, `ingest_mode: url-screenshot`): port from `SCHEMA` (`add.ts:61-130`) + `taxonomy.json`:
    - `title` → `text`.
    - `meta.audience` → `enum` (vocabulary from `taxonomy.json` audience; the prototype constrains it — `add.ts:70-74`). `meta.tier` → `enum` (`add.ts:89-93`).
    - **`meta.form` and `meta.domain` → `text`** (NOT `enum`). In the prototype these are *open* strings — the schema says "propose a new value only if none genuinely fits" (`add.ts:75-82`); `taxonomy.json` is a *suggested* vocabulary, not a closed one. Forcing `enum` would stop Story 7.1's enrichment from emitting a novel value, breaking fidelity. (See the closed-set gap note below.)
    - `meta.tone`, `meta.tags` → `tags` (arrays).
    - `design` → **9 `text` fields + `design_system_score` as `enum`** (`systematic`/`semi-systematic`/`bespoke`, `add.ts:110-114`). The `design` object has **10** properties total (`add.ts:97-130`), not 11.
    - `reflection` (`five_second_message`, `what_we_learn`, `apply_to_naruki`) → `text`.
    - `favorite` (bool, user) and `favorite_reason`/`notes` (text, user) → **`enrichable: false`**.
    - Set `enrichable: true` on the LLM-filled fields (meta facets, design, reflection). Carry `enrichment_prompt` from `SYSTEM_PROMPT` (`add.ts:132-160`).
  - [x] **Library** descriptor (`view: list`, `ingest_mode: url-readable`): port from `LIBRARY_SCHEMA` (`processor-library.ts:22-53`):
    - `title`, `summary` → `text`; `author` → `text`.
    - `topics` → `tags`.
    - **`key_points` → `text`** (NOT tags) — these are prose takeaways, `minItems:2,maxItems:6`, "concrete takeaways worth remembering" (`processor-library.ts:45-51`). `topics` are the tag-like facet; `key_points` are sentences.
    - `type` → `enum` (from `LIBRARY_TYPES`, `processor-library.ts:20`).
    - `notes` (user text) → `enrichable: false`.
    - `enrichment_prompt` from `LIBRARY_SYSTEM_PROMPT` (`processor-library.ts:55-65`).
  - [x] Keep the descriptors faithful to the prototype so Story 1.5's importer maps cleanly and Story 7.1's enrichment reproduces the prototype's outputs.
- [x] **Task 4 — Implement the seed routine** (AC: 3, 4)
  - [x] Create `db/seed.ts`: insert the two boards if absent (idempotent — check by a stable key such as board `name` or a fixed `id`). Validate each descriptor with `validateDescriptor` before insert (the seed must not write an invalid descriptor).
  - [x] Decide and document the idempotency key (stable board `id` like `"inspiration"`/`"library"` is recommended so the importer and later code can reference boards by a known id).
- [x] **Task 5 — Wire tests + verify green** (AC: 5)
  - [x] Add the new test file(s) to the `test` script; run `npm test`; confirm green + existing 7 suites unaffected.

## Dev Notes

### What this story changes vs preserves (read before coding)

- **NEW `descriptor/types.ts` (or `schema.ts`)** and **`db/seed.ts`** — matches architecture §6 (`descriptor/meta-schema.ts`, `descriptor/render-map.ts`). The **meta-schema** (the schema *for a descriptor*, the composer's target) is Story 10; this story builds the descriptor's own zod schema + the seed. Keep the file/export names composer-friendly so 10.1/10.2 reuse them.
- **Prototype `SCHEMA`/`SYSTEM_PROMPT` and `LIBRARY_SCHEMA`/`LIBRARY_SYSTEM_PROMPT` stay where they are** (`add.ts:61-160`, `processor-library.ts:22-65`) — this story *transcribes* them into descriptor form; it does not delete them (the prototype add/serve path still uses them until later epics cut over). Treat them as the source of truth for the seeded field sets.
- **Depends on Story 1.1's `board` table** (`board.descriptor` JSON column). Do not redefine the table.

### The descriptor contract (target)

[Source: docs/bmad/architecture.md#4.4-schema-as-data-descriptor]
```
board.descriptor JSON = {
  fields: [{ key, label, type ∈ {text,number,date,url,enum,tags,image}, enrichable }],
  enrichment_prompt: string,
  view: "grid" | "list",
  ingest_mode: "url-screenshot" | "url-readable" | "manual-upload"
}
```
- **Dynamic enrichment** (Story 7.1) builds the prompt + JSON-schema from this descriptor.
- **Dynamic rendering** (Story 7.2) is a field-type→component map over the closed set.
- **The composer** (Epic 10) emits a descriptor validated against the meta-schema. This story builds only the **closed-type** check; the additional composer guardrails (field-count cap, reserved/duplicate-key rejection, validate-and-repair) are Story 10.2 — do not build them here.

### Prototype field sets to port (recon — exact sources, types verified against real code)

- **Inspiration** — `add.ts:61-130` (`SCHEMA`, required `["title","meta","design","reflection"]`). Verified types: `meta.audience` **enum** (`add.ts:70-74`) and `meta.tier` **enum** (`add.ts:89-93`) are the only true enums; `meta.form` (`add.ts:75-78`) and `meta.domain` (`add.ts:79-82`) are **open strings** ("propose a new value only if none genuinely fits"); `meta.tone`/`meta.tags` arrays (→ `tags`); `design` is **10 properties** (`add.ts:97-130`) = 9 `text` + `design_system_score` **enum** (`add.ts:110-114`); `reflection` = 3 `text` fields. Prompt: `SYSTEM_PROMPT` `add.ts:132-160`. (`taxonomy.json` loaded at `add.ts:17-21` supplies the *audience* vocabulary; its form/domain lists are suggestions, not constraints.)
- **Library** — `processor-library.ts:22-53` (`LIBRARY_SCHEMA`, required `["title","summary","topics","type","key_points"]`); `type` **enum** from `LIBRARY_TYPES` (`processor-library.ts:20`); `topics` → `tags`; `key_points` are **prose** (`text`), `minItems:2,maxItems:6` (`processor-library.ts:45-51`). Prompt: `LIBRARY_SYSTEM_PROMPT` `processor-library.ts:55-65`.
- **User-authored (non-enrichable) fields:** `favorite`, `favorite_reason`/`notes` (inspiration), `notes` (library) — these must NOT be `enrichable` (Story 7.3 preserves them across re-enrichment).

### Known gap surfaced by the port: no "suggested-but-open vocabulary" field type

The prototype's `meta.form`/`meta.domain` are *open* strings with a *suggested* vocabulary (enrich freely, propose new values). The closed field-type set `{text,number,date,url,enum,tags,image}` has **no** type that expresses "constrained-suggestion" — `enum` is hard-closed (rejects novel values, breaks enrichment fidelity) and `text` loses the suggested vocabulary. **Decision for v1:** map them to `text` (or `tags` if multi-valued) and accept the lost suggestion-vocabulary. **Flag this for the descriptor schema + composer (Epic 10):** if a "suggested-enum"/"open-enum" type is ever wanted, it is a closed-set change (C11) and must be decided deliberately, not smuggled in. Record the decision here so 7.1 enrichment and 10.x composer don't rediscover it.

### Why this design (anti-pattern prevention)

- **The closed field-type set is the load-bearing constraint (C11).** It keeps enrichment, rendering, FTS, and indexing tractable. Validation must reject off-list types *hard* — this is what stops the composer (Epic 10) from generating an "insane board". Do not add a permissive escape hatch (`type: "any"`). [Source: docs/bmad/PRD.md#FR-2, docs/bmad/architecture.md#7]
- **Seed by stable id, idempotently.** The importer (1.5) and server (later) reference boards; a fixed `id` (`inspiration`/`library`) makes those references stable and makes idempotency a simple existence check. Avoid seeding by auto-increment + name-match heuristics.
- **Don't build the meta-schema or the composer here.** The descriptor's *own* schema (validate a given descriptor) is in scope; the schema *for generating* descriptors (meta-schema, validate-and-repair) is Epic 10. Building it now is scope-creep. [Source: docs/bmad/epics.md#Story-10.2]
- **`enrichable` is a per-field flag, not a separate table.** It marks which fields the enrichment worker fills vs which the user owns. This single flag drives both enrichment (7.1) and field-preservation (7.3).

### Project Structure Notes

- `descriptor/` directory per architecture §6. Zod is already a planned dep (architecture §2 "Validation: zod"); **if zod is not yet installed, add it under the dependency policy** (Socket score check, pin version) — it is also needed by Epic 3 (skill contracts) and Epic 4 (provider schemas), so installing it here is correct sequencing.
- ESM `.js` import specifiers; `node:test` harness; add new test files to the `test` script.

### Testing standards

- Validation tests are pure (no DB) — fast unit tests over in-memory descriptor objects.
- Seed tests use a temp DB (Story 1.1's `initDb(tmpPath)`); never the real `DATA_DIR`.
- Assert both the happy path (two valid descriptors load) and the guardrail (off-list type rejected) — the rejection test is the one that matters for C11.

### References

- [Source: docs/bmad/architecture.md#4.4-schema-as-data-descriptor] — descriptor shape, dynamic enrichment/rendering, composer meta-schema.
- [Source: docs/bmad/architecture.md#9-AD9] — schema-as-data: board behavior is a stored descriptor on a closed field-type set.
- [Source: docs/bmad/PRD.md#FR-1] — boards defined as data; the two seeded boards are descriptors.
- [Source: docs/bmad/PRD.md#FR-2] — closed field-type set `{text,number,date,url,enum,tags,image}`; out-of-set rejected.
- [Source: add.ts#61-160] — inspiration `SCHEMA` + `SYSTEM_PROMPT` to transcribe into the Inspiration descriptor.
- [Source: processor-library.ts#22-65] — `LIBRARY_SCHEMA` + `LIBRARY_SYSTEM_PROMPT` to transcribe into the Library descriptor.
- [Source: taxonomy.json] — audience/form/domain enum vocabularies for the Inspiration descriptor's `enum`/`tags` fields.
- [Source: docs/bmad/stories/1-1-sqlite-drizzle-schema.md] — the `board.descriptor` JSON column this story populates.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (BMAD dev-story workflow)

### Debug Log References

- `npm test` → 112 pass / 0 fail (99 prior + 13 new: 8 descriptor + 5 seed/contract).
- zod 3.25.76 used (initially relied on the version resolved transitively via puppeteer-core). **Correction (Story 3.1 review):** zod was NOT a declared dependency at the time — only transitive. It was promoted to a direct, Socket-scored, pinned `dependencies` entry (`zod@3.25.76`: supplyChain 99 / quality 100 / vulnerability 100 / maintenance 92) during Story 3.1's review pass, since the skill platform now rests on it. A puppeteer bump dropping zod would otherwise have broken descriptor/config/skills.

### Completion Notes List

- ✅ All 5 ACs satisfied. Descriptor zod schema over the closed set, off-list-type rejection with field-identifying errors, two boards seeded idempotently as validated descriptors, concrete named field-contract assertions.
- **Party-mode consensus on the descriptor↔system-column boundary** (Architect + Test Architect unanimous, Senior Dev dissent noted). Verdicts encoded:
  1. **System columns are never descriptor fields.** `title`, `notes`, `favorite` live only on `item`; excluded from `descriptor.fields`. `favorite_reason` is not a system column → it IS a descriptor field (`text`, `enrichable:false`). AC5's "favorite/notes enrichable:false" intent is satisfied *structurally* (they can't be enriched because they aren't fields) and asserted via `enrichableTargets()` + the absence checks — a stronger guarantee than a flag.
  2. **No `boolean` added to the closed set;** future two-state board fields use `enum`.
  3. **Single-writer-per-cell:** importer/capture/UI own system columns; enrichment writes only `enrichable:true` keys into `item.fields` (flat). `enrichableTargets(descriptor)` is the single source of truth; `SYSTEM_COLUMNS` exported as the reserved set.
  4. **Flat `item.fields`, opaque dotted keys** (`meta.audience`, `design.design_system_score`), max one dot, grammar `^[a-z0-9_]+(\.[a-z0-9_]+)?$`. UI grouping = render-time prefix split.
- **Closed-set gap recorded** (from the story): `meta.form`/`meta.domain` are suggested-but-open vocab with no matching closed type → mapped to `text` (suggestion-vocabulary lost). Any "open-enum" type is a deliberate C11 change for Epic 10, not to be smuggled in.
- **Scope respected:** composer guardrails (reserved-key/field-cap/dup-key rejection, validate-and-repair) deferred to Story 10.2 — only the closed-type check + enum-values + key-grammar built here. Prototype `SCHEMA`/`LIBRARY_SCHEMA` left in place (transcribed, not deleted).
- **Inspiration descriptor** = 20 fields (19 enrichable meta/design/reflection + `favorite_reason` non-enrichable); **Library** = 5 enrichable fields. Both transcribed faithfully from `add.ts:61-160` / `processor-library.ts:20-65` + `taxonomy.json`.

### File List

- `descriptor/types.ts` (new) — closed `FieldType` set, `Field`/`BoardDescriptor` zod schemas, `validateDescriptor`, `enrichableTargets`, `SYSTEM_COLUMNS`, inferred types.
- `descriptor/descriptor.test.ts` (new) — 8 pure validation tests.
- `db/seed.ts` (new) — `INSPIRATION_DESCRIPTOR`, `LIBRARY_DESCRIPTOR`, stable board ids, idempotent `seed(db)`.
- `db/seed.test.ts` (new) — 5 seed + concrete field-contract tests (AC 3/4/5).
- `package.json` (modified) — appended the two new test files to the `test` script.

### Change Log

- 2026-06-20 — Story 1.2 implemented: descriptor schema over the closed field-type set + two seeded boards (idempotent), with the descriptor↔system-column boundary fixed by party-mode consensus. Status → review.
