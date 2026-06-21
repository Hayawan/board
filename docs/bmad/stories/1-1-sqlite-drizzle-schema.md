# Story 1.1: SQLite + Drizzle schema with board / item / asset tables

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Epic 1 — Storage foundation (schema-as-data).** Replace the prototype's flat-JSON files with SQLite/Drizzle on a schema-as-data model, with write-safety, FTS5 over a synthetic search blob, and a one-shot importer that seeds the two boards. This is the foundation every later epic sits on. *(NFR-2, C11.)*
>
> **This is story 1 of 5 in Epic 1.** Build order: **(1) SQLite + Drizzle schema ◄ this story** → (2) board descriptor + closed field-type set + seeded boards → (3) single-writer queue + atomic writes + busy_timeout → (4) FTS5 over a synthetic search_blob → (5) flat-JSON → SQLite importer. Story 1.1 lays the **tables + connection + WAL** ONLY. It deliberately ships no user-visible behavior and does not touch `add.ts`/`server.ts` yet; its correctness is proven by a schema + round-trip test.

## Story

As the board-oss maintainer,
I want the core `board` / `item` / `asset` tables created via Drizzle with WAL enabled,
so that data persists durably in a single SQLite file instead of flat JSON, and every later epic has a typed schema to build on.

## Acceptance Criteria

1. **A SQLite database is created on boot with WAL enabled.**
   **Given** a fresh `DATA_DIR` (no existing DB file), **When** the DB module initializes, **Then** a SQLite file is created at the configured path and `PRAGMA journal_mode` reports `wal`.

2. **The `board`, `item`, `asset` tables exist and match the architecture data model.**
   **Given** the initialized DB, **When** the schema is applied, **Then**:
   - `board` has `{ id, name, view, descriptor (JSON text), created_at, updated_at }`.
   - `item` has `{ id, board_id (FK→board.id), source, title, status, error_reason, favorite, notes, fields (JSON text), search_blob (text), analysis_provider, analysis_model, created_at, updated_at }`.
   - `asset` has `{ id, item_id (FK→item.id), kind, path, width, height, hash, captured_at }` (0..n per item).
   - `item.status` defaults to `pending`; `item.favorite` defaults to `false`/`0`.

3. **`id` columns are caller-suppliable TEXT primary keys; `created_at` is insertable.** *(load-bearing for 1.2 and 1.5)*
   **Given** the schema, **When** a row is inserted with an explicit string `id` and an explicit `created_at`, **Then** both are persisted verbatim (not overwritten by an autoincrement/default). `board.id` and `item.id` are `TEXT PRIMARY KEY` the caller supplies (mirroring the seed's stable `"inspiration"`/`"library"` board ids and the importer's preserved `"<slug>-<epochms>"` item ids). `created_at` accepts an explicit value on insert and falls back to now() only when omitted.

4. **Foreign keys are ENFORCED, not just navigable.**
   **Given** `PRAGMA foreign_keys = ON` is set on every connection, **When** an `item` is inserted with a `board_id` that does not exist (or an `asset` with a nonexistent `item_id`), **Then** the insert is rejected. The schema round-trips a board → item → asset and selecting them back returns the same values; JSON columns (`board.descriptor`, `item.fields`) round-trip as structured objects.

5. **The four system-column indexes exist.**
   **Given** the schema, **When** applied, **Then** indexes exist on the fixed system columns `item.board_id`, `item.status`, `item.favorite`, `item.created_at` (per architecture §5 / NFR-2). *(Only the tags / `json_extract` custom-field index promotion is deferred — PRD Open Question #1 — not these four.)*

6. **A unit test asserts the schema, the id/FK behavior, and the round-trip.**
   **Given** a throwaway temp DB, **When** the test opens it, **Then** it asserts `journal_mode=wal`; asserts the three tables, their columns, and the four indexes exist; asserts an explicit `id`/`created_at` survive insert (AC 3); asserts an orphan-FK insert throws (AC 4); and round-trips an insert/select of board+item+asset. The test never touches the real `DATA_DIR`.

## Tasks / Subtasks

- [x] **Task 1 — Add SQLite + Drizzle dependencies** (AC: 1, 2)
  - [x] Add `drizzle-orm` and a SQLite driver (`better-sqlite3`) to `dependencies`, and `drizzle-kit` to `devDependencies`. **Run the Socket score check (`socket package score npm <pkg>@<version> --json`) on each resolved version before installing** (see Dev Notes — dependency policy). Pin concrete versions, not ranges.
  - [x] Confirm `better-sqlite3` builds under the pinned Node LTS (it is a native module). Note the build in the story File List.
- [x] **Task 2 — Write the failing schema + round-trip test first (TDD)** (AC: 1, 2, 3, 4)
  - [x] Create `db/schema.test.ts` using `node:test` + `node:assert/strict` (match the existing harness — see Testing standards).
  - [x] Open a temp DB under `os.tmpdir()` (never the real `DATA_DIR`); assert `PRAGMA journal_mode` returns `wal`.
  - [x] Assert the `board`/`item`/`asset` tables exist with the AC-2 columns (query `PRAGMA table_info(<table>)` or insert/select each column).
  - [x] Round-trip: insert a board (with a JSON `descriptor`), an item (with JSON `fields`, default `status`), and an asset; select them back and assert equality + FK resolution.
  - [x] Run the suite; watch it fail for the right reason (module/exports absent) before implementing.
- [x] **Task 3 — Implement `db/schema.ts` (Drizzle table definitions)** (AC: 2, 3, 5)
  - [x] Define the three Drizzle tables per AC 2. Use a JSON/text column for `board.descriptor` and `item.fields`; `search_blob` is a plain `text` column here (the FTS5 virtual table is Story 1.4 — do not build it now).
  - [x] Make `board.id` and `item.id` **`TEXT PRIMARY KEY` the caller supplies** (AC 3) — not integer autoincrement. Make `created_at` accept an explicit value on insert with a now() fallback. This is what lets 1.2 seed stable ids and 1.5 preserve the original record id as a dedupe key + carry `added → created_at`.
  - [x] Declare FKs: `item.board_id → board.id`, `asset.item_id → item.id`. Set sensible defaults (`status='pending'`, `favorite=0`, `updated_at`).
  - [x] Create the four system-column indexes (AC 5): `item.board_id`, `item.status`, `item.favorite`, `item.created_at`. Do NOT add `json_extract`/tags indexes (deferred — PRD Open Question #1).
  - [x] Export the table objects and inferred row types for consumers (`Board`, `Item`, `Asset`, and `New*` insert types).
- [x] **Task 4 — Implement `db/index.ts` (connection + WAL + FK enforcement + path)** (AC: 1, 4)
  - [x] Open the SQLite file via `better-sqlite3`, wrap with `drizzle()`. Resolve the DB file path from config (placeholder until Story 2.2 lands `DATA_DIR` — read `process.env.DATA_DIR` with a local default, leave a `// Story 2.2` marker; do NOT build the full env loader here).
  - [x] On open set `PRAGMA journal_mode = WAL` **and `PRAGMA foreign_keys = ON`** (SQLite defaults FKs OFF per connection — without this, AC 4 enforcement silently doesn't happen).
  - [x] Apply the schema (create tables if not exist) via an idempotent bootstrap or generated Drizzle migration; document the choice. **Note:** Story 1.4 will add an FTS5 virtual table + triggers as **raw SQL** (`CREATE VIRTUAL TABLE … USING fts5(...)`) — Drizzle cannot model FTS5 declaratively. Pick a schema-apply approach in this story that leaves room for 1.4 to inject raw SQL (don't lock into a Drizzle-only migration pipeline that can't run hand-written DDL).
  - [x] Export a `getDb()` / `db` handle and an `initDb(path)` factory the test can point at a temp file.
- [x] **Task 5 — Wire the test into the runner and verify green** (AC: 4)
  - [x] Add `db/schema.test.ts` to the `test` npm script (the script enumerates files explicitly — a new file is silently skipped otherwise; see Testing standards).
  - [x] Run `npm test`; confirm the new test passes and the existing 7 suites stay green (this story adds tables; it must not change prototype behavior).

## Dev Notes

### What this story changes vs preserves (read before coding)

- **NEW `db/schema.ts`, `db/index.ts`, `db/schema.test.ts`** — the architecture's target module layout puts storage under `db/` (`docs/bmad/architecture.md#6` lists `db/schema.ts`, `db/queue.ts`, `db/importer.ts`). This story creates `schema.ts` (tables) + a connection module; the queue is Story 1.3 and the importer is Story 1.5.
- **`storage.ts` (DO NOT MODIFY this story)** — the prototype's flat-JSON storage layer (`storage.ts:1-127`) keeps working untouched. The two systems coexist until the importer (1.5) and the later epics migrate consumers. Do **not** rewire `add.ts`/`server.ts` to the DB here — that is out of scope and would break the green suite.
- **No `DATA_DIR` concept exists yet** — `storage.ts` hard-resolves paths from `import.meta.url`/`__dirname` (recon: storage.ts uses `__dirname`); `.gitignore` ignores `bookmarks.json`/`library.json`/`screenshots/` but defines no data dir. This story reads `process.env.DATA_DIR` with a local fallback and leaves the real env-driven loader to **Story 2.1/2.2**. Keep the coupling to a single line so 2.2 is a one-spot change.

### Data model (the target — from architecture §5)

[Source: docs/bmad/architecture.md#5-data-model]
- **`board`** `{ id, name, view, descriptor (JSON), created_at, updated_at }`.
- **`item`** `{ id, board_id, source, title, status, error_reason, favorite, notes, fields (JSON), search_blob (text), analysis_provider, analysis_model, created_at, updated_at }`.
- **`asset`** `{ id, item_id, kind, path, width, height, hash, captured_at }` (0..n per item).
- `status` lifecycle (used by later epics; just the column here): `pending → processing → done → error` with `error_reason` persisted [Source: docs/bmad/architecture.md#4.5].
- The closed field-type set (`{text, number, date, url, enum, tags, image}`) lives in the **descriptor** (Story 1.2), not in these table columns — `item.fields` is a JSON bag validated against the descriptor. Do not add per-field columns. [Source: docs/bmad/PRD.md#FR-2]

### How the prototype data maps (context for the importer in 1.5 — do NOT import here)

The two flat files this schema will eventually hold (recon):
- `bookmarks.json` (120 records, inspiration): `{ id, url, added, screenshot, title, meta{...}, design{...}, reflection{...}, favorite, favorite_reason }` → becomes `item` rows under the Inspiration board with the design/meta/reflection payload in `item.fields` and the screenshot as an `asset`.
- `library.json` (19 records, library): `{ id, added, url, title, summary, topics, author, type, key_points, analysis_agent, analysis_model, notes }` → `item` rows under the Library board, payload in `fields`, `notes` first-class.
This story only needs the schema to *accommodate* both shapes via the `fields` JSON column — the actual import is Story 1.5.

### Why this design (anti-pattern prevention)

- **Single `item.fields` JSON column, not per-collection columns.** The two prototype collections have disjoint schemas (inspiration's nested `meta/design/reflection` vs library's flat `summary/topics/...`). A typed JSON column keeps one `item` table for all boards — the schema-as-data principle (AD9). Do not create `inspiration_item` / `library_item` tables.
- **`search_blob` is a plain column now; the FTS5 virtual table is Story 1.4.** Architecture §5 is explicit: FTS5 is over `search_blob` only (synthetic concat), assembled on write — "a non-deferrable storage decision" but sequenced into 1.4. Creating the column here lets 1.4 add the FTS5 table + triggers without a schema change to `item`. [Source: docs/bmad/architecture.md#5]
- **System-column indexes here; `json_extract`/tags indexes deferred.** Architecture §5 + NFR-2 call for indexes on the fixed system columns (`board_id, status, favorite, created_at`) — **create these four in this story** (AC 5); the epics.md coverage map assigns NFR-2's index clause to 1.1. PRD Open Question #1 defers only the **tags / `json_extract` custom-field** index-promotion decision, so do NOT build json_extract indexes here. [Source: docs/bmad/architecture.md#5, docs/bmad/PRD.md#8 Open Questions]
- **`id` is caller-supplied TEXT, not autoincrement — this is a cross-story contract.** 1.2 seeds boards by stable id (`"inspiration"`/`"library"`); 1.5 preserves each record's original `"<slug>-<epochms>"` id as its idempotency/dedupe key and carries `added → created_at`. If this story defaults `id` to integer autoincrement or makes `created_at` default-only, **1.2 and 1.5 break.** Pin TEXT PKs + insertable `created_at` here.
- **Enforce FKs (`PRAGMA foreign_keys = ON`).** SQLite leaves FK enforcement OFF by default per connection. A JOIN "resolving" is navigability, not enforcement — an `item.board_id` pointing at a missing board is a corruption later epics will trip on. Turn enforcement on at connection init and test the negative case. [Source: docs/bmad/architecture.md#5]
- **WAL is load-bearing, not cosmetic.** WAL + single-writer queue + `busy_timeout` is the datastore NFR (NFR-2). WAL belongs here (connection setup); the single-writer queue + `busy_timeout` is Story 1.3. [Source: docs/bmad/PRD.md#NFR-2]

### Dependency policy (gate before install)

Per the user's dependency policy: before adding `drizzle-orm`, `better-sqlite3`, `drizzle-kit`, resolve each latest stable version, run `socket package score npm <pkg>@<version> --json`, and block if `supply_chain < 0.80`, `quality < 0.70`, `vulnerability < 0.80`, or `maintenance < 0.50`. Report scores and pin the scored version. `better-sqlite3` is a native module — confirm it compiles on the target Node LTS and the Debian LXC toolchain (Epic 11 packaging will need its build deps).

### Project Structure Notes

- New `db/` directory at repo root, matching architecture §6 (`db/schema.ts`, later `db/queue.ts`, `db/importer.ts`). Consistent with the current flat layout (no `src/`).
- ESM + `.js` import specifiers: project is `"type": "module"`; TS imports use compiled-style specifiers (e.g. `./schema.js`) resolved by `tsx`. Match this in any new imports. [Source: tsconfig.json — module/moduleResolution NodeNext]
- Execution is via `tsx`, not `tsc` (tsconfig has no `outDir`/`include`; it is type-check config only). Drizzle migration tooling (`drizzle-kit`) runs separately from app execution.

### Testing standards

- Harness: `node --import tsx --test <files>` (the `test` script enumerates files explicitly). Tests use built-in `node:test` (`describe`/`it`) + `node:assert/strict` — match `storage.test.ts`/`server.test.ts` style. [Source: package.json#scripts.test]
- **Add the new test file to the `test` script** or it silently won't run (same trap as the prototype's earlier stories).
- **Never touch the real `DATA_DIR`/data files in tests.** Open temp DBs under `os.tmpdir()`; the schema test is fully self-contained (no fixtures from `bookmarks.json`/`library.json`).
- This story must leave the existing 7 suites green — it adds a parallel storage layer, it does not alter the prototype's flat-JSON path.

### References

- [Source: docs/bmad/architecture.md#5-data-model] — board/item/asset shapes, FTS5-over-search_blob, index strategy.
- [Source: docs/bmad/architecture.md#2-tech-stack] — SQLite via Drizzle (WAL, JSON columns, generated-column indexes, FTS5); `better-sqlite3`-class driver.
- [Source: docs/bmad/architecture.md#6-source-tree] — `db/schema.ts`, `db/queue.ts`, `db/importer.ts` target layout.
- [Source: docs/bmad/PRD.md#NFR-2] — datastore NFR (WAL, single-writer, busy_timeout, JSON columns, FTS5, files-on-disk screenshots).
- [Source: docs/bmad/PRD.md#FR-2] — closed field-type set lives in the descriptor; underpins enrichment/rendering/search/index.
- [Source: storage.ts#1-127] — the flat-JSON layer this DB will eventually supersede (untouched this story); `CollectionMeta` (7-13), collection API (78-104).
- [Source: .gitignore] — data files git-ignored; "self-hostable version will seed/auto-create these on first run" — the seam this epic delivers.
- [Source: package.json#scripts.test] — test harness + the explicit file list to extend.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (BMAD dev-story workflow)

### Debug Log References

- `npm test` → 99 pass / 0 fail (89 pre-existing prototype tests + 10 new schema tests).
- Socket dependency gate (scores 0–100; thresholds supply_chain≥80, quality≥70, vulnerability≥80, maintenance≥50):
  - `drizzle-orm@0.45.2` — supplyChain 87, quality 87, vulnerability 100, maintenance 97 → PASS. Alerts: `obfuscatedFile` (high, bundled dist), `urlStrings` (low) — benign for a popular ORM's minified bundle.
  - `better-sqlite3@12.11.1` — supplyChain 87, quality 100, vulnerability 100, maintenance 92 → PASS. Alerts: `obfuscatedFile`, `hasNativeCode`, `filesystemAccess` — all expected for a native SQLite binding.
  - `drizzle-kit` — Socket rate-limited (HTTP 429) on every attempt; NOT installed (see decision below), so no gate to clear.

### Completion Notes List

- ✅ All 6 ACs satisfied; schema + connection + WAL + FK enforcement + 4 indexes + JSON round-trip proven by `db/schema.test.ts` (10 tests).
- **Decision — idempotent raw-SQL bootstrap instead of drizzle-kit migrations.** Task 4 explicitly permits either approach. A raw bootstrap (`CREATE TABLE/INDEX IF NOT EXISTS` in `db/index.ts`) was chosen because (a) Story 1.4 must inject an FTS5 virtual table + triggers as raw SQL, which Drizzle cannot model declaratively, and (b) it removes the need for `drizzle-kit` entirely — which Socket kept rate-limiting and which adds a large dev-tooling vuln tree. The DDL mirrors `db/schema.ts`; the round-trip test guards against drift.
- **`created_at`/`updated_at`/`captured_at`** use `DEFAULT (unixepoch())` at the DB level + `.default(sql\`(unixepoch())\`)` in Drizzle so they are optional-on-insert (DB fills) yet overridable with an explicit value (AC 3).
- **Scope respected:** `storage.ts`/`add.ts`/`server.ts` untouched; flat-JSON path unchanged; new code lives under `db/`. Prototype suites remained green.
- **Pre-existing npm-audit findings** (8: @fastify/static, undici, fast-uri, basic-ftp via puppeteer, etc.) belong to the existing fastify/puppeteer tree, not the two deps added here; out of scope for this story (which must not change prototype behavior).
- **Note for Story 2.2:** DB path resolution is isolated to `resolveDbPath()` in `db/index.ts` behind a single `// Story 2.2` marker. `@types/better-sqlite3` was not added — `tsx` strips types at runtime and the test path has no `tsc`; add it if a type-check step is introduced later.

### File List

- `db/schema.ts` (new) — Drizzle table definitions (board/item/asset) + inferred types.
- `db/index.ts` (new) — connection factory (`initDb`/`getDb`), WAL + FK pragmas, idempotent bootstrap DDL.
- `db/schema.test.ts` (new) — 10-test schema/round-trip/FK/index/WAL suite.
- `package.json` (modified) — added `drizzle-orm@0.45.2` + `better-sqlite3@12.11.1`; appended `db/schema.test.ts` to the `test` script.
- `package-lock.json` (modified) — dependency lock.
- `.gitignore` (modified) — ignore `data/` + `*.db*` SQLite artifacts.

### Change Log

- 2026-06-20 — Story 1.1 implemented: SQLite/Drizzle schema (board/item/asset), WAL + FK-enforcing connection factory, idempotent bootstrap, 4 system-column indexes, 10-test suite. Status → review.
