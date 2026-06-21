# Story 1.5: Flat-JSON → SQLite importer

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Epic 1 — Storage foundation (schema-as-data).** Story 5 of 5 — the epic's payoff. Build order: (1) schema → (2) descriptor + seeded boards → (3) single-writer queue → (4) FTS5 → **(5) flat-JSON → SQLite importer ◄ this story**. This story migrates the prototype's `bookmarks.json` (120 inspiration records) and `library.json` (19 library records) into the SQLite `item`/`asset` tables under the two seeded boards, idempotently. After this, the SQLite store holds real data and later epics can read from it. *(FR-20 part 1; NFR-6 portability.)*

## Story

As a prototype user migrating to board-oss,
I want my existing `bookmarks.json` / `library.json` imported into SQLite,
so that I keep my data when the storage layer cuts over from flat JSON.

## Acceptance Criteria

1. **Each flat record becomes an item under the correct seeded board.**
   **Given** the prototype flat-JSON files, **When** the importer runs against a seeded DB (Story 1.2), **Then** each `bookmarks.json` record becomes an `item` under the **Inspiration** board and each `library.json` record becomes an `item` under the **Library** board, with the record's type-specific payload stored in `item.fields`.

2. **Assets are linked.**
   **Given** an inspiration record with a `screenshot` path, **When** imported, **Then** an `asset` row (kind=screenshot) is created and linked to the item, preserving the screenshot path; library records (no screenshot) create no asset.

3. **`search_blob` is populated and items are searchable.**
   **Given** the import completes, **When** an item is queried via FTS5 (Story 1.4), **Then** it is found by a term from its fields (the importer goes through the same write path that maintains `search_blob` + FTS).

4. **The importer is idempotent — at the item AND the FTS level.**
   **Given** the importer has already run, **When** it runs again on the same files, **Then** it does not duplicate items (re-running yields the same `item` counts) **and a known search term returns exactly one FTS hit** (not two). *(An upsert that re-inserts the FTS row without deduping it would leave the same item appearing twice in search — assert the FTS hit count == 1, not just the item-row count.)*

5. **A round-trip test asserts counts + a sampled record's fields.**
   **Given** representative fixture JSON (small, committed under test, NOT the real 464KB file), **When** the importer runs, **Then** the test asserts item counts per board, asset linkage, `search_blob` population/FTS hit, idempotency on a second run, and that a sampled record's fields survived the mapping.

## Tasks / Subtasks

- [ ] **Task 1 — Write the failing importer test first (TDD)** (AC: 1, 2, 3, 4, 5)
  - [ ] Create `db/importer.test.ts` with **small committed fixtures** (`db/__fixtures__/bookmarks.sample.json`, `library.sample.json`) — 2–3 records each, faithfully shaped to the real files (recon shapes below). Do NOT read the real 464KB `bookmarks.json` in tests.
  - [ ] Temp seeded DB; run importer over fixtures; assert per-board counts, asset linkage (inspiration screenshot → asset row; library → none), FTS hit for a known term, idempotency on second run, and a sampled record's `fields` content.
  - [ ] Run; confirm red (importer absent).
- [ ] **Task 2 — Implement the record→item mapping** (AC: 1, 2)
  - [ ] Create `db/importer.ts`: `importFlatJson({ inspirationPath, libraryPath, db })` (paths injectable for tests). For each file, resolve the target board (Inspiration/Library by stable id from Story 1.2), map each record:
    - **Inspiration** (`bookmarks.json` record `{id,url,added,screenshot,title,meta,design,reflection,favorite,favorite_reason}`): `source=url`, `title`, `favorite`, user `notes`/`favorite_reason`; `meta`+`design`+`reflection` → `item.fields` keyed to the Inspiration descriptor; `screenshot` → `asset`. Carry `added` into `created_at` if present.
    - **Library** (`library.json` record `{id,added,url,title,summary,topics,author,type,key_points,analysis_agent,analysis_model,notes}`): `source=url`, `title`, `notes`; `summary/topics/author/type/key_points` → `item.fields`; `analysis_agent`/`analysis_model` → `analysis_provider`/`analysis_model`.
  - [ ] Preserve the original record `id` as the `item.id` (Story 1.1 makes `item.id` caller-suppliable TEXT) — its purpose is to be the **stable dedupe key** for idempotency (AC 4). (Asset paths like `screenshots/<id>.png` are stored verbatim in `asset.path` regardless of `item.id`, so preservation is about dedupe, not path validity.)
- [ ] **Task 3 — Write through the single-writer path** (AC: 3)
  - [ ] Insert items/assets via the Story 1.3 serialized writer so `search_blob` + FTS (Story 1.4) are maintained automatically. Do NOT bypass the writer with raw inserts (that would skip blob/FTS maintenance).
- [ ] **Task 4 — Make it idempotent (item + FTS)** (AC: 4)
  - [ ] Key on the preserved record `id` (Story 1.1's caller-suppliable `item.id`): skip or upsert on re-run. Document the chosen key. Re-running must not create a second `item` row.
  - [ ] If using upsert, ensure the FTS row is also deduped (the typed item-write helper's upsert from 1.3/1.4 should handle this — verify the second run leaves FTS hit count == 1). This is the subtle failure mode the AC 4 test guards.
- [ ] **Task 5 — Expose a board-agnostic per-record mapper (the seam Story 3.3 wraps)** (AC: 1)
  - [ ] Structure `db/importer.ts` in two layers so 3.3 can reuse the mapping without forking it: (a) a **board-agnostic per-record mapper + insert** — e.g. `importRecords({ boardId, records, db })` (or `mapRecordToItem(record, boardId)` + an insert helper) that maps an in-memory record array into items under an arbitrary `boardId` and writes through the typed item-write helper; (b) the **file/board-resolution wrapper** `importFlatJson({ inspirationPath, libraryPath, db })` that reads the flat files, resolves the two seeded boards, and delegates to (a). Story 3.3's `import-bookmarks` skill calls layer (a) with an in-memory payload; the one-shot migration calls (b). This split is non-negotiable — without it, 3.3's `{boardId, bookmarks}` payload mode cannot wrap the mapping and would silently fork it.
  - [ ] Expose the one-shot as a runnable (npm script `import:flat` or a small CLI). The *skill* wrapper (`import-bookmarks`, FR-20 part 2) is **Story 3.3**.
- [ ] **Task 6 — Wire tests + verify green** (AC: 5)
  - [ ] Add `db/importer.test.ts` to the `test` script; run `npm test`; confirm green + existing 7 suites unaffected.

## Dev Notes

### What this story changes vs preserves (read before coding)

- **NEW `db/importer.ts`** + fixtures + test. Architecture §6 names `db/importer.ts` ("flat-JSON → SQLite"). 
- **Reads the prototype data files read-only** — `bookmarks.json` (120 records) / `library.json` (19 records). These are git-ignored "personal capture data" (recon: `.gitignore`), so the importer must handle their absence gracefully (a fresh clone has none) — import what exists, skip missing files with a log line, don't crash.
- **Does NOT modify `storage.ts` or the flat files** — it reads them and writes to SQLite. The flat-JSON path keeps working until later epics fully cut over.
- **Depends on Stories 1.1 (tables), 1.2 (seeded boards + descriptors), 1.3 (writer), 1.4 (search_blob/FTS).** This is correctly last in the epic — it exercises the whole foundation end-to-end.

### Exact source shapes (recon — for the mapping)

- **`bookmarks.json`** record: `{ id: "<slug>-<epochms>", url, added: "YYYY-MM-DD", screenshot: "screenshots/<id>.png", title, meta: { audience, form, domain, tier, tone[], tags[] }, design: { steal_this, above_fold, nav_pattern, whitespace, color_story, design_system_score, typography_hierarchy, scroll_behavior, cta_strategy, social_proof }, reflection: { five_second_message, what_we_learn, apply_to_naruki }, favorite, favorite_reason }`. (120 records, top-level array.)
- **`library.json`** record: `{ id: "<slug>-<epochms>", added, url, title, summary, topics[], author, type, key_points[], analysis_agent, analysis_model: string|null, notes }`. (19 records, top-level array.)
- Common fields across both: `id`, `url`, `title`, `added`. The mapping targets the descriptors authored in Story 1.2 — keep field keys aligned so enrichment (7.1) and rendering (7.2) read them back consistently.

### Why this design (anti-pattern prevention)

- **Go through the writer, not raw inserts.** The importer is the first real exercise of `search_blob`+FTS maintenance (1.4). If it bypasses the single-writer write path, imported items won't be searchable and the FTS index will be empty — a silent correctness bug. Insert via the same path app writes use. [Source: docs/bmad/stories/1-4-fts5-search-blob.md]
- **Idempotent by stable id, tested explicitly.** A migration users might run twice must not duplicate. Preserve the original `id` as the dedupe key and assert second-run counts in the test. [Source: docs/bmad/epics.md#Story-1.5]
- **Small committed fixtures, never the real file in tests.** The real `bookmarks.json` is 464KB and git-ignored — tests must use 2–3-record committed fixtures shaped like the real data. This keeps tests fast, deterministic, and runnable on a fresh clone with no personal data. [Source: docs/bmad/architecture.md#7 — testability]
- **Importer core is reused by the import skill (3.3), not duplicated.** FR-20 has two parts: the one-shot flat-JSON importer (this story) and the `import-bookmarks` *skill* (Story 3.3). Keep the mapping/insert logic in `db/importer.ts` so 3.3 wraps it in a Skill contract. Do not fork the logic. [Source: docs/bmad/epics.md#Story-3.3]
- **Graceful on missing files.** A fresh self-hoster has no prototype JSON. The importer must no-op cleanly (log + continue) rather than throwing — this is the NFR-4 "no blocking first-run" posture applied to migration. [Source: docs/bmad/PRD.md#NFR-4]

### Project Structure Notes

- `db/importer.ts` (new) + `db/__fixtures__/*.sample.json` (new, committed) + `db/importer.test.ts` (new). Under `db/` per architecture §6.
- Optional npm script `import:flat` in `package.json` for the one-shot run.
- ESM `.js` specifiers; `node:test`; add the new test to the `test` script.

### Testing standards

- Temp seeded DB; never the real `DATA_DIR`. Fixtures are committed and tiny.
- Assert: counts per board, asset linkage, FTS hit, idempotency (run twice), sampled field fidelity. Idempotency + FTS-hit are the two that catch the subtle bugs.
- Existing 7 suites stay green.

### References

- [Source: docs/bmad/architecture.md#6-source-tree] — `db/importer.ts` (flat-JSON → SQLite).
- [Source: docs/bmad/architecture.md#5-data-model] — storage guards: "flat-JSON → SQLite importer seeds the two descriptors."
- [Source: docs/bmad/PRD.md#FR-20] — import (incl. the prototype's flat-JSON data); part 2 (the skill) is Story 3.3.
- [Source: docs/bmad/PRD.md#NFR-6] — portability/reversibility: plain SQLite + screenshots the user can copy.
- [Source: docs/bmad/PRD.md#NFR-4] — no blocking first-run (importer no-ops gracefully when files absent).
- [Source: .gitignore] — `bookmarks.json`/`library.json`/`screenshots/` are git-ignored personal data; importer handles absence.
- [Source: docs/bmad/stories/1-2-board-descriptor-seeded-boards.md] — seeded boards + descriptors the importer maps onto.
- [Source: docs/bmad/stories/1-3-single-writer-queue.md] + [Source: docs/bmad/stories/1-4-fts5-search-blob.md] — the write path that maintains search_blob/FTS.
- [Source: docs/bmad/epics.md#Story-3.3] — the `import-bookmarks` skill that wraps this importer core.

## Dev Agent Record

### Agent Model Used

_(to be filled by dev agent)_

### Debug Log References

### Completion Notes List

### File List
