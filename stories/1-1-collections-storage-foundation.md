# Story 1.1: Collections storage foundation (per-collection JSON files + manifest)

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Epic 1 — Multiple Collections.** Board currently catalogs one kind of thing (design inspiration). The epic introduces named *collections* so a link can be dropped into the right bucket, AI-processed with logic appropriate to that bucket, and found again. Per the design roundtable, each collection is a **type** (its own capture, schema, taxonomy, default view) and is **persisted in its own JSON file** — there is no migration of existing data.
>
> **This is story 1 of 7.** Build order: **(1) storage foundation ◄ this story** → (2) processor registry / dispatch in `add.ts` → (3) Library capture pipeline (fetch → markdown → text analysis) → (4) end-to-end CLI proof of one Library link → (5) server collection API → (6) sidebar collection switcher → (7) Library list view. Story 1 lays the storage seam ONLY. It deliberately ships no user-visible behavior; its correctness is proven by tests.

## Story

As the Board maintainer,
I want the storage layer to read and write each collection from its own JSON file via a small manifest,
so that a second collection ("Library") can be added later without touching the existing 119 Inspiration bookmarks or breaking the current add/serve flow.

## Acceptance Criteria

1. **Manifest + empty Library file exist; Inspiration data is untouched.**
   - A `collections.json` manifest at the repo root lists exactly two collections:
     - `inspiration` → `{ name: "Inspiration", type: "inspiration", view: "grid", dataFile: "bookmarks.json" }`
     - `library` → `{ name: "Library", type: "library", view: "list", dataFile: "library.json" }`
   - A `library.json` at the repo root is initialized to `[]`.
   - `bookmarks.json` is **byte-for-byte unchanged** by this story (the Inspiration collection keeps using the existing file in place — no rename, no migration).

2. **`storage.ts` exposes collection-parameterized functions** resolving the data file via the manifest:
   - `listCollections()` → the manifest entries (each with `id`, `name`, `type`, `view`, `dataFile`).
   - `getCollection(id)` → one manifest entry; throws a clear error for an unknown id.
   - `loadCollection<T>(id)` → parsed array from that collection's data file.
   - `saveCollection(id, items)` → atomic write to that collection's data file.
   - `mutateCollection<T, R>(id, op)` → locked read-modify-write for that collection.

3. **Existing exports keep identical behavior; `add.ts` and `server.ts` are NOT modified.**
   - `readBookmarks`, `writeBookmarksAtomic`, `mutateBookmarks`, `withBookmarksLock`, and `BOOKMARKS_FILE` remain exported with unchanged signatures and continue to operate on the Inspiration collection (`bookmarks.json`). They become thin delegates over the new collection-aware primitives.
   - No edits to `add.ts` or `server.ts` are required or made in this story.

4. **Locking and atomicity are preserved per data file.**
   - Each collection locks on its own `<dataFile>.lock` and writes via the existing temp-file-then-rename atomic pattern, so a write to `library` and a write to `inspiration` never contend on the same lock.

5. **`npm test` passes (existing suite green + new storage tests).**
   - The existing `add.test.ts` suite still passes with no changes.
   - New unit tests cover: `loadCollection`/`saveCollection` round-trip for a collection; `mutateCollection` read-modify-write; `getCollection` throws on an unknown id; and `mutateBookmarks` still targets `bookmarks.json` (the inspiration delegate path).
   - The `test` npm script is updated so the new test file actually runs (see Dev Notes — the current script names a single file).

## Tasks / Subtasks

- [x] **Task 1 — Add the manifest and the empty Library file** (AC: 1)
  - [x] Create `collections.json` at repo root with the two entries specified in AC 1 (keep `dataFile: "bookmarks.json"` for inspiration — do not rename the existing file).
  - [x] Create `library.json` at repo root containing `[]`.
  - [x] Confirm `bookmarks.json` is not modified by any task in this story.
- [x] **Task 2 — Write failing storage tests first (TDD)** (AC: 2, 4, 5)
  - [x] Create `storage.test.ts` using `node:test` + `node:assert` (same harness as `add.test.ts`).
  - [x] Test the file-path primitives against **temp files** (never the real data files): lock acquisition is per-path, atomic write replaces content, read parses JSON.
  - [x] Test manifest resolution: `getCollection("library").dataFile === "library.json"`; `getCollection("nope")` throws.
  - [x] Test `loadCollection`/`saveCollection`/`mutateCollection` for `library` round-trip; snapshot and restore `library.json` around these so the working tree is left clean.
  - [x] Test that `mutateBookmarks` resolves to `bookmarks.json` (delegate parity) — assert it operates on the inspiration data file without mutating it (read-only op).
  - [x] Run the suite and watch these fail for the right reason before implementing.
- [x] **Task 3 — Refactor `storage.ts` to path-parameterized primitives** (AC: 2, 3, 4)
  - [x] Extract the lock/read/write/mutate internals to accept an explicit absolute file path: e.g. `withFileLock(path, op)`, `readJsonFile<T>(path)`, `writeJsonAtomic(path, data)`, `mutateJsonFile(path, op)`. Keep the lock file as `${path}.lock` and the temp-then-rename write exactly as today (`storage.ts:17-49`).
  - [x] Add manifest loading: read `collections.json` next to `storage.ts`; expose `listCollections()` and `getCollection(id)` (throw on unknown id). Resolve each `dataFile` to an absolute path under `__dirname`.
  - [x] Add `loadCollection`/`saveCollection`/`mutateCollection` composing manifest resolution with the primitives.
  - [x] Re-implement `readBookmarks`, `writeBookmarksAtomic`, `mutateBookmarks`, `withBookmarksLock`, `BOOKMARKS_FILE` as delegates over the inspiration collection so their external behavior is identical.
- [x] **Task 4 — Wire the test script and verify green** (AC: 5)
  - [x] Update `package.json` `test` script so `storage.test.ts` runs alongside `add.test.ts` (e.g. `node --import tsx --test add.test.ts storage.test.ts`).
  - [x] Run `npm test`; confirm the full suite (old + new) is green and `git status` shows `bookmarks.json` unchanged.

## Dev Notes

### What this story changes vs. preserves (read before coding)

- **`storage.ts` (UPDATE)** — `storage.ts:1-60`. Today every function is bound to a single module-level `BOOKMARKS_FILE` (`storage.ts:7`) with a per-file lock (`storage.ts:9, 31-39`), a JSON read (`storage.ts:41-43`), a temp-file atomic write (`storage.ts:45-49`), and a locked read-modify-write `mutateBookmarks` (`storage.ts:51-60`).
  - **Preserve exactly:** the lock protocol (`wx` open, retry-with-deadline, `sleepSync` via `Atomics.wait`), the `<file>.lock` naming, and the temp-`<pid>.<ts>.tmp`-then-`rename` atomic write. These solve real concurrency between the CLI (`add.ts`) and the server (`server.ts`), which both write the same file. Do not weaken them.
  - **Change:** make those primitives take an explicit path, then layer collection resolution on top. The public `*Bookmarks` exports must keep their current signatures and behavior (they are the inspiration delegate).
- **`add.ts` (DO NOT MODIFY this story)** — imports `mutateBookmarks` (`add.ts:8`) and calls it to append/refetch (`add.ts:512, 546`). It must keep compiling and behaving identically. Its capture+analysis pipeline and `SCHEMA` are Inspiration-specific and are out of scope here.
- **`server.ts` (DO NOT MODIFY this story)** — imports `mutateBookmarks, readBookmarks` (`server.ts:9`) and uses them across the bookmarks/refetch/screenshot/delete endpoints. Must keep working unchanged. The `/api/collections` endpoint and any server wiring are a later story.

### Concrete shapes

`collections.json` (repo root):

```json
[
  { "id": "inspiration", "name": "Inspiration", "type": "inspiration", "view": "grid", "dataFile": "bookmarks.json" },
  { "id": "library",     "name": "Library",     "type": "library",     "view": "list", "dataFile": "library.json" }
]
```

Target export surface of `storage.ts` after refactor:

```ts
// New, collection-aware
export function listCollections(): CollectionMeta[];
export function getCollection(id: string): CollectionMeta;            // throws on unknown id
export function loadCollection<T>(id: string): T[];
export function saveCollection(id: string, items: unknown[]): void;   // atomic
export function mutateCollection<T, R>(id: string, op: (items: T[]) => R): R; // locked RMW

// Backward-compatible delegates over the "inspiration" collection — UNCHANGED behavior
export const BOOKMARKS_FILE: string;             // still absolute path to bookmarks.json
export function withBookmarksLock<T>(op: () => T): T;
export function readBookmarks<T>(): T[];
export function writeBookmarksAtomic(bookmarks: unknown[]): void;
export function mutateBookmarks<TBookmark, TResult>(op: (b: TBookmark[]) => TResult): TResult;

type CollectionMeta = { id: string; name: string; type: string; view: "grid" | "list"; dataFile: string };
```

### Why this design (anti-pattern prevention)

- **Per-file, not one discriminated-union file.** The roundtable explicitly reversed an earlier "single file" idea: separate files give physical isolation, **zero migration** of the 119 existing records, and no schema-pollution between collection types. Do not introduce a `collection` discriminator field on existing bookmarks — the *file* is the discriminator. (Cross-collection unified search is deferred and not a concern here.)
- **Manifest is the single source of truth for which collections exist + their default view** — mirrors the existing `taxonomy.json` "authoritative list consumed by code + UI" convention established in `_planning_documents/2026-05-01-bookmark-categories.md`.
- **Don't build the type descriptor / processor registry here.** `{ capture, analyze, schema, taxonomy }` per-type dispatch is story 1.2/1.3. Adding it now is the scope-creep the PM flagged. `view` is the only type-specific field the manifest needs at this stage.

### Project Structure Notes

- New root files: `collections.json`, `library.json`, `storage.test.ts`. All at repo root next to the existing `bookmarks.json`, `taxonomy.json`, `add.test.ts` — consistent with the current flat layout (no `src/`, no `data/` dir today). Keeping `bookmarks.json` in place (rather than moving to `data/inspiration.json`) is the deliberate least-risk choice — the manifest's `dataFile` indirection means a future move is a one-line manifest edit, not a code change.
- ESM + `.js` import specifiers: this project is `"type": "module"` and imports compiled-style specifiers (`./storage.js` from `add.ts:8`, `server.ts:9`) resolved by `tsx`. Keep that convention in any new imports.

### Testing standards

- Harness: `node --import tsx --test <files>` (see `package.json` `scripts.test`). Tests use built-in `node:test` (`describe`/`it`) + `node:assert` — match `add.test.ts` style. No new test deps.
- **Current `test` script names a single file** (`add.test.ts`) — it will silently skip `storage.test.ts` unless you add it to the script. This is the easiest way to "pass" while not actually running the new tests; do not let that happen (AC 5).
- **Never touch real data files in tests.** Exercise the path primitives against `os.tmpdir()` fixtures. For the few tests that go through the real manifest (`library` round-trip), snapshot `library.json`, run, then restore, so `git status` is clean afterward. Use read-only ops when asserting the `mutateBookmarks` → `bookmarks.json` delegate so the 119 records are never rewritten.

### References

- [Source: storage.ts#1-60] — current single-file lock/read/write/mutate to refactor.
- [Source: add.ts#8,512,546] — `mutateBookmarks` consumer that must keep working untouched.
- [Source: server.ts#9,49,107,220] — `readBookmarks`/`mutateBookmarks` consumers across endpoints; unchanged this story.
- [Source: package.json#scripts.test] — test harness and the single-file glob to extend.
- [Source: taxonomy.json] + [Source: _planning_documents/2026-05-01-bookmark-categories.md#Proposed-taxonomy] — the "JSON file is the authoritative vocabulary consumed by code + UI" convention the manifest follows.
- Design decision record: party-mode roundtable (this session) — collections-as-types, per-file storage with a manifest, Library = simpler non-visual capture + list view. Build order owner: PM (John).

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

None — no blocking issues encountered.

### Completion Notes List

- Task 1: Created `collections.json` (two-entry manifest) and `library.json` (`[]`). `bookmarks.json` byte-for-byte unchanged — confirmed via `git status`.
- Task 2 (TDD red): Wrote `storage.test.ts` with 8 tests before touching `storage.ts`. Confirmed failure with "does not provide an export named 'getCollection'" — correct red-phase failure.
- Task 3 (TDD green): Refactored `storage.ts` — extracted `withFileLock`, `readJsonFile`, `writeJsonAtomic`, `mutateJsonFile` as path-parameterized internals; added manifest layer (`listCollections`, `getCollection`); added collection API (`loadCollection`, `saveCollection`, `mutateCollection`); re-wired all five `*Bookmarks` exports as thin delegates over `resolveDataFile("inspiration")` — identical external behavior, no signature changes.
- Task 4: Updated `package.json` test script to include `storage.test.ts`. Full suite: 18/18 pass (10 original + 8 new). `bookmarks.json` unchanged in `git status`.
- AC notes: Delegate parity verified via `BOOKMARKS_FILE` path assertion rather than calling `mutateBookmarks` (avoids rewriting 460KB file in tests). `library.json` round-trip tests use snapshot/restore so git working tree is clean after tests.

### File List

- `collections.json` (created)
- `library.json` (created)
- `storage.ts` (modified)
- `storage.test.ts` (created)
- `package.json` (modified)
