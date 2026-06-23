# Story 17.1: Export (JSON + Netscape HTML)

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Epic 17 — Data portability.** Story 1 of 1 — the trust handshake. Build order (epic is a single story): **export (JSON + Netscape HTML) ◄ this story**. Export is the cheapest, highest-leverage trust signal — a user pours their taste in only if they can leave with it. It is **read-only, no schema change** (export only reads). This story adds one `export` skill that serializes every board (descriptors), item (fields, notes, favorites, status, source) and asset reference (paths/hashes) to a JSON file round-trippable with the flat-JSON importer where possible, plus a Netscape-HTML bookmark file for browser/linkding interop. *(D14; FR Epic 17 AC1–4; NFR-6 portability; NFR-BC.)*

## Story

As a user,
I want to export all my boards and items,
so that my data isn't trapped and I can re-import elsewhere.

## Acceptance Criteria

1. **Full JSON export covers every board, item, and asset reference.**
   **Given** `POST /skills/export` (the generic skill route, `server.ts:591`) with `{ format: "json" }`, **When** invoked, **Then** it returns a JSON document containing **all boards** (id, name, view, descriptor), **all items** (id, boardId, source, title, status, favorite, notes, the `fields` JSON bag, analysisProvider/analysisModel, createdAt) and **all asset references** (id, itemId, kind, path, hash, width, height). The export is grouped/shaped so the existing flat-JSON importer (`db/importer.ts`'s `importRecords`, Story 1.5 / 3.3) can re-ingest it **where possible** (per-board record arrays under the seeded board ids) — see Dev Notes for the honest round-trip boundary.

2. **Netscape HTML export is browser/linkding-compatible.**
   **Given** `POST /skills/export` with `{ format: "netscape" }`, **When** invoked, **Then** it produces a standards-conformant Netscape Bookmark File (`<!DOCTYPE NETSCAPE-Bookmark-file-1>` … `<DL><DT><A HREF=... ADD_DATE=... TAGS=...>title</A>`) carrying **url + title + tags + add-date** per item. URL = `item.source`; title = `item.title`; ADD_DATE = `item.createdAt` (unix seconds); TAGS = the item's tag-typed field values (e.g. `meta.tags`, `meta.tone`, `topics`) comma-joined. Items with no `source` (no URL) are skipped (a Netscape bookmark must have an HREF). The output imports into a browser and into linkding.

3. **Read-only + complete, with the documented binary-asset caveat.**
   **Given** any export run, **When** it executes, **Then** it **mutates nothing** in `data/board.db` (no INSERT/UPDATE/DELETE — `select()` only) and covers **every** board/item (no silent truncation/pagination drop). Binary assets (screenshot/snapshot files on disk) are **referenced by path + hash, not inlined** — the export documents that the user must copy the `screenshots/` (and any `snapshot`) files separately, mirroring linkding's documented export limitation. *(NFR-BC: export is read-only by definition.)*

4. **Zero-mutation is asserted by a test.**
   **Given** a seeded DB with items + assets, **When** the export skill runs (both formats), **Then** a test asserts the DB is **byte-for-byte unchanged** after the run (snapshot/compare row counts of board/item/asset + FTS, OR compare the file bytes/mtime of a temp DB copy before and after) — proving export performs zero writes. *(NFR-BC.)*

5. **Tests assert JSON completeness, Netscape validity, and round-trip-where-possible.**
   **Given** the export skill over a temp seeded DB with a couple of inspiration + library items (one with a screenshot asset), **When** the tests run, **Then** they assert: (a) the JSON contains every board/item/asset with the listed fields; (b) the Netscape HTML parses and contains an `<A HREF>` per URL-bearing item with `ADD_DATE`/`TAGS`; (c) feeding the JSON's per-board record arrays back through `importRecords` re-creates the items (round-trip where possible); (d) a URL-less item is omitted from the Netscape output but present in the JSON.

## Tasks / Subtasks

- [x] **Task 1 — Failing export tests first (TDD)** (AC: 1, 2, 3, 4, 5)
  - [x] `db/export.test.ts` over a temp seeded DB: an inspiration item (nested-group fields + a screenshot asset w/ hash + dimensions, status `done`), a library item (flat fields + `analysisProvider`), and a `source=null` item.
  - [x] Asserts (JSON): every board (incl. descriptor); item fields incl. `status`, `analysis_agent`, `added` (ISO), favorite/notes; asset ref incl. `hash`/`width`/`height`; the `source=null` item present. Asserts (Netscape): one `<A HREF>` per URL-bearing item with `ADD_DATE`+`TAGS`; the URL-less item absent; HTML-escaping. Confirmed red.
- [x] **Task 2 — JSON serializer (read-only)** (AC: 1, 3)
  - [x] `db/export.ts` → `exportJson(handle): ExportDocument`. **`select()` only.** Items grouped per board as `importRecords`-compatible record arrays (dotted `fields` un-flattened into nested groups for inspiration; flat keys for library); top-level `boards[]` (descriptors) + `assets[]` (`{id,itemId,kind,path,hash,width,height}`).
- [x] **Task 3 — Netscape HTML serializer** (AC: 2)
  - [x] `exportNetscape(handle): string` — standard header + `<DL>`, one escaped `<DT><A HREF ADD_DATE TAGS>title</A>` per URL-bearing item, `</DL>`. Tags resolved generically from the board descriptor's `type:'tags'` field keys (+ `meta.tags`/`meta.tone`/`topics` fallback). URL-less items skipped. HTML-escaped.
- [x] **Task 4 — Register the `export` skill** (AC: 1, 2)
  - [x] `skills/export.ts` via `defineSkill('export', {format: enum(json|netscape).default(json)}, <discriminated-union output, real zod>, run)`. `run` calls `exportJson`/`exportNetscape` on `ctx.db` — read-only, no `ctx.queue`. Registered in `registerAllSkills`; invokable via `POST /skills/export`. (The `GET /api/v1/export` alias remains a thin follow-up.)
- [x] **Task 5 — Wire tests + verify green** (AC: 4, 5)
  - [x] Registered `db/export.test.ts` + `skills/export.test.ts` in the `test` script; full suite → **423 pass / 0 fail**, existing suites unaffected (NFR-BC).

## Dev Notes

### What this story changes vs preserves (read before coding)

- **NEW `db/export.ts`** (serializers) + **`skills/export.ts`** (the Skill contract) + tests. Adding a capability = registering a Skill, not a bespoke route (`server.ts:579-585` — the one generic `POST /skills/:name`). The `export` skill slots into `registerAllSkills` next to `import-bookmarks`.
- **Read-only — no schema change, no migration, no writes.** Export reaches `ctx.db` only through `select()`. It is the inverse of `db/importer.ts`: importer maps records → items via `writeItem`; export reads items → records. It must NOT go through `writeItem`/`enqueueWrite`/the single-writer queue at all (those are write paths). *(NFR-BC: "export only reads.")*
- **Round-trip is the design target but bounded by the flatten/unflatten gap.** The importer's `mapInspiration` reads **nested** `meta`/`design`/`reflection` groups (`db/importer.ts:44-71`, via `flattenGroup`) and flattens them to dotted `item.fields` keys (`meta.audience`, …). The SQLite store holds the **already-flattened** dotted keys (`db/seed.ts:33` descriptor uses `meta.audience` etc.). So a fully round-trippable JSON export must **un-flatten** the dotted `fields` back into nested groups for inspiration records (and emit library records flat, as `mapLibrary` at `db/importer.ts:74-94` expects flat `summary`/`author`/`topics`/`type`/`key_points`). Where un-flattening is lossy or a composed board has no registered `MAPPERS` entry (`db/importer.ts:98-101` only registers inspiration/library), document it as "round-trippable where possible" (Epic 17 AC1's exact phrasing) — the JSON is still complete; re-import of arbitrary composed boards is best-effort.
- **Preserves existing data & UI byte-for-byte.** No existing route, board, item, asset, descriptor, or the legacy flat-JSON path changes. The export skill is purely additive. *(NFR-BC.)*

### Why this design (anti-pattern prevention)

- **Read-only is a hard invariant, asserted, not asserted-in-prose.** "Export reads" is trivially violable (a stray `writeItem` to backfill a missing field, a "touch updatedAt on access"). AC 4's zero-mutation test is the guard: snapshot the DB (row counts + FTS hit + ideally file bytes) before/after and assert identity. [Source: docs/bmad/epics-v2.md#Epic-17 (NFR-BC: "export only reads")]
- **One generic skill route, not a bespoke endpoint.** The architecture's rule (AD11/FR-19): a new capability is a registered Skill invoked through `POST /skills/:name`, not a hand-rolled route. Export follows `import-bookmarks` exactly. [Source: server.ts#591, skills/registry.ts#52, skills/import-bookmarks.ts#17]
- **Don't fork the record shape — mirror the importer's expected shape.** The JSON must be re-ingestible by `importRecords`, so its per-board record arrays must match what `mapInspiration`/`mapLibrary` read (nested groups for inspiration, flat keys for library). Inventing a new export shape that the importer can't read would make "round-trippable" a lie. [Source: db/importer.ts#44, db/importer.ts#74, db/importer.ts#122]
- **Binary assets are referenced, never inlined — document the caveat.** Inlining base64 screenshots/snapshots would bloat the export and is not what linkding does. Reference by path + hash and document that files are copied separately (the user already has portable `screenshots/` under DATA_DIR, Story 2.2 / NFR-6). [Source: docs/bmad/epics-v2.md#Epic-17 (binary-asset caveat); db/schema.ts#56]
- **HTML-escape the Netscape output (untrusted data).** Titles/urls/tags are user/enrichment data; the Netscape file is HTML. Escape `&<>"` to avoid producing a malformed/injectable bookmark file. [Source: db/schema.ts#26 (source/title/fields are free user data)]
- **Real zod I/O, not `z.any()`.** The skill's in/out schemas are the future MCP tool contract (FR-19), as with every skill. [Source: skills/import-bookmarks.ts#17, skills/types.ts#79]

### Project Structure Notes

- `db/export.ts` (new) — `exportJson` + `exportNetscape`, read-only `select()` serializers, alongside `db/importer.ts`.
- `skills/export.ts` (new) — `defineSkill('export', …)`; registered in `skills/registry.ts`'s `registerAllSkills`.
- Serialize from the three tables: boards (`db/schema.ts:17-24` — id/name/view/descriptor), items (`db/schema.ts:26-54` — source/title/status/favorite/notes/fields/analysis*/createdAt), assets (`db/schema.ts:56-67` — kind/path/hash/width/height).
- `DbHandle` = `{ db, sqlite }` (`db/index.ts:73`); skills receive it as `ctx.db` (`skills/types.ts:59`). Use `ctx.db.db.select()` for reads.
- ESM `.js` specifiers; `node:test` + `inject()` for the route smoke; add the new test(s) to the `test` script.

### Testing standards

- Temp seeded DB (`seed`, Story 1.2) + temp `screenshotsDir`; never the real `DATA_DIR`. Seed via `writeItem` so items carry `search_blob`/FTS and an asset row (the export must surface the asset reference).
- **Zero-mutation (AC 4) is the load-bearing assertion** — capture board/item/asset row counts + a known-term FTS hit count before the run and assert identical after; optionally copy the temp DB file and `Buffer.compare` bytes before/after. A naive implementation that "fixes up" a row on read fails this.
- **Round-trip-where-possible (AC 5c):** feed the JSON's inspiration/library record arrays back through `importRecords({ handle, boardId, records })` into a *second* temp DB and assert the items re-create (dedupe semantics from Story 3.3 apply — same ids skip on a re-run into the same DB).
- **Netscape validity (AC 5b):** assert the header/`<DL>` structure and one `<A HREF>` per URL-bearing item with `ADD_DATE`/`TAGS`; assert the `source=null` item is omitted from Netscape but present in JSON (AC 5d).
- Existing suites stay green (NFR-BC — no existing data/route touched).

### References

- [Source: docs/bmad/epics-v2.md#Epic-17] — Story 17.1 goal + ACs (full JSON export, Netscape HTML, read-only + binary-asset caveat, zero-mutation test); Decisions Inventory D14; NFR-BC wave constraint.
- [Source: db/importer.ts#44,#74,#98,#122] — `mapInspiration` (nested groups → dotted), `mapLibrary` (flat keys), `MAPPERS` registry, `importRecords` (the round-trip target; export shape must match its inputs).
- [Source: db/import-cli.ts#1] — the one-shot importer runner (the migration counterpart export complements).
- [Source: skills/import-bookmarks.ts#17] — the thin-skill-wrapping-a-db-core pattern to mirror (export skill wraps `db/export.ts`).
- [Source: skills/registry.ts#52] — `registerAllSkills`; register `export` here.
- [Source: server.ts#591] — the generic `POST /skills/:name` route `export` is invoked through.
- [Source: db/schema.ts#17,#26,#56] — boards/items/assets columns to serialize.
- [Source: db/index.ts#73] — `DbHandle` shape; read via `ctx.db.db.select()`.
- [Source: skills/types.ts#59,#79] — `Ctx` (read-only use of `ctx.db`) + `defineSkill` (real zod I/O, FR-19).
- [Source: db/seed.ts#26,#76] — the inspiration/library descriptors whose dotted field keys export must un-flatten for round-trip.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (BMAD dev-story workflow)

### Debug Log References

- RED → GREEN → full regression: **423 pass / 0 fail**, 76 suites.
- Two esbuild gotchas hit + fixed during impl: an inline `typeof items.$inferSelect` param type (→ used the exported `Item` type) and a JSDoc comment containing `*/` (`analysis_*/screenshot` closed the block comment early → reworded).

### Completion Notes List

- ✅ All ACs satisfied. Export is the inverse of `db/importer.ts`: `select()` only, no `writeItem`/`enqueueWrite`/INSERT/UPDATE/DELETE. The skill wraps the serializers and uses `ctx.db` only (no `ctx.queue`).
- **Round-trip is symmetric for the two real boards:** `toRecord` un-flattens dotted `fields` into nested groups (inspiration) / leaves flat keys (library); `mapInspiration`/`mapLibrary` re-flatten on re-import. Verified by feeding the export back through `importRecords` into a fresh DB and asserting `meta.audience`/`meta.tags` (inspiration) and `summary`/`topics`/url (library) re-create. Composed/unmapped boards are export-complete but best-effort on re-import (documented — `importRecords` has no MAPPER for them).
- **Binary assets referenced by path+hash, not inlined** (the user copies `screenshots/` separately, mirroring linkding).
- **Netscape escaping** covers `& < > " '`; URL-less items skipped (a bookmark needs an HREF); tags from the board's `type:'tags'` fields.

**Party-mode review (Amelia correctness / Quinn QA) — both APPROVE-WITH-NITS; fixes applied before commit:**
- ✅ [Med, Amelia] **`added` dropped on a falsy `createdAt`** (truthy guard would drop epoch-0). Changed to `!= null` so a legitimate 0 is preserved.
- ✅ [Med, Quinn] **AC1 under-asserted** — `status`, `analysisProvider/Model`, `added`, and asset `width/height` were emitted but untested. Added assertions (incl. `lib-1.analysis_agent === 'claude'`, an ISO `added`, asset dimensions, and a `done` status).
- ✅ [Low, Quinn] **Library round-trip was count-only** — added field re-create assertions (`summary`/`topics`/source).
- ✅ [Low, Quinn] **No empty-DB test** — added one (seeded boards, no items → valid empty document + minimal Netscape file).
- 📝 [Low, accepted] Inspiration records carry `analysis_*: null` keys the mapper ignores (cosmetic JSON bloat); `ADD_DATE=""` only if `createdAt` were null (it's `NOT NULL` in schema). The `GET /api/v1/export` alias is a deferred thin follow-up (the skill is the deliverable).

### File List

- `db/export.ts` (new) — read-only `exportJson` (per-board importer-compatible records + boards + asset refs) + `exportNetscape` (escaped bookmark file; descriptor-driven tags).
- `db/export.test.ts` (new) — JSON completeness (incl. status/analysis/added/asset dims), Netscape validity + escaping + URL-less skip, empty-DB, round-trip via `importRecords`, zero-mutation (rows + FTS unchanged).
- `skills/export.ts` (new) — `defineSkill('export', …)` thin read-only wrapper; discriminated-union output (real zod).
- `skills/export.test.ts` (new) — registration + `POST /skills/export` route smoke (both formats).
- `skills/registry.ts` (modified) — registered `exportSkill`.
- `package.json` (modified) — registered the two new test files.

### Change Log

- 2026-06-23 — Story 17.1: the `export` skill + `db/export.ts` serializers (read-only JSON + Netscape HTML). Full per-board/item/asset JSON re-ingestible via `importRecords` where possible; browser/linkding-compatible bookmark file; binary assets referenced. Zero-mutation proven. 423 pass / 0 fail.
- 2026-06-23 — Addressed party-mode review: `createdAt` `!= null` guard, AC1 field assertions (status/analysis/added/asset dims), library round-trip assertions, empty-DB test.
