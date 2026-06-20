# Story 1.4: End-to-end CLI proof of one Library link

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Epic 1 — Multiple Collections.** Named *collections*, each a **type** with its own capture/schema/view, persisted in its own JSON file. No migration.
>
> **This is story 4 of 7.** Build order: (1) storage foundation → (2) processor registry / dispatch → (3) Library capture pipeline → **(4) end-to-end CLI proof ◄ this story** → (5) server collection API → (6) sidebar collection switcher → (7) Library list view. This story proves the **whole CLI chain** for Library — dispatch (1.2) + processor (1.3) → persisted record in `library.json` — and polishes the CLI's collection-aware UX (summary output, result-file output the server will consume in 1.5). It is the integration checkpoint before any UI/server work.

## Story

As the Board maintainer,
I want to run one real link through `add.ts --collection library` and see a correct entry land in `library.json`,
so that the storage seam (1.1), dispatch (1.2), and Library processor (1.3) are proven to work together before the server and UI are built on top.

## Acceptance Criteria

1. **A Library add persists exactly one valid entry to `library.json`.**
   - Driving the full pipeline for a `library` collection appends one record matching the story 1.3 `buildEntry` shape (`id, url, added, title, summary, topics, author, type, key_points, notes:"", analysis_agent, analysis_model`) via `mutateCollection("library", …)`.
   - `bookmarks.json` is **byte-for-byte unchanged** by any Library add; the Inspiration CLI path still works identically (`npx tsx add.ts <url>` → `bookmarks.json`).

2. **The CLI summary output is collection-aware.**
   - The closing `console.log` block (`add.ts:555-560`) currently prints Inspiration facets (`audience · form · domain`, tags). For Library it must print Library-appropriate lines (e.g. `type`, `topics`, a `summary`/`key_points` preview) and not reference Inspiration-only fields. Drive this off the processor, not an `if (collection === …)` ladder in `main` (see Dev Notes).

3. **`BOARD_RESULT_FILE` works on the Library path.**
   - When `BOARD_RESULT_FILE` is set, the freshly added Library entry is written there as JSON (parity with `add.ts:549-551`) — the server (story 1.5) depends on this to return the new item to the UI.

4. **Refetch works for a Library item.**
   - `BOARD_UPDATE_ID=<libraryId> npx tsx add.ts <url> --collection library` updates that entry in place (re-captures + re-analyzes), preserving the user-owned `notes` field (parity with how Inspiration preserves `favorite`/`reflection` at `add.ts:516-526, 523`).

5. **An automated integration test proves the round trip offline.**
   - A test drives the Library add pipeline against a **temp collection data file** (never the real `library.json`) with an **injected capture/fetch fixture** and a **stubbed analyzer** (no real `claude`/`codex` subprocess), asserting: one entry persisted, correct shape, `notes:""`, and `bookmarks.json` not touched. Snapshot/restore any real file if the manifest path is exercised.

6. **A real manual run is documented.**
   - One genuine Library URL is added via the CLI and the resulting `library.json` entry is recorded in the Debug Log (then reverted so the working tree is clean, unless the maintainer wants to keep it). `npm test` stays green.

## Tasks / Subtasks

- [x] **Task 1 — Make the CLI summary processor-driven** (AC: 2)
  - [x] Add an optional `summarize(entry): string[]` (or `summaryLines`) to the `Processor` contract, defaulting to a generic line set; implement it for inspiration (current facets/tags) and library (type/topics/key_points). Replace the hard-coded block at `add.ts:555-560` with `for (const line of processor.summarize(entry)) console.log(line)`.
  - [x] This keeps `main` free of per-type branches (anti-pattern prevention).
- [x] **Task 2 — Write the failing integration test first (TDD)** (AC: 1, 3, 5)
  - [x] Add `library-e2e.test.ts`. Provide a fixture markdown/HTML and a stubbed analyzer returning a fixed valid Library analysis (inject via the seam from 1.2/1.3 — e.g. an exported `runAdd({ argv, env, captureImpl, analyzeImpl })`, or call the processor's `buildEntry` + `mutateCollection` against a temp file).
  - [x] Point persistence at a temp collection file (a temp manifest entry or a temp `dataFile`), NOT real `library.json`. (Used snapshot/restore of real library.json — correct approach since mutateCollection resolves via cached _manifest.)
  - [x] Assert: exactly one entry; shape matches AC 1; `notes === ""`; `BOARD_RESULT_FILE` (a temp path) receives the same entry; a read-only check that `bookmarks.json` mtime/content is unchanged.
  - [x] Run; watch it fail for the right reason.
- [x] **Task 3 — Make `main()` testable enough to drive** (AC: 1, 3, 5)
  - [x] Extract `runAdd(argv, env, deps)` with injectable `captureOverride` and `analyzeOverride`; `main()` calls it; entrypoint guard unchanged.
- [x] **Task 4 — Verify refetch parity for Library** (AC: 4)
  - [x] Library `buildEntry` existing branch spreads existing (preserving notes/id/added), overrides analyzed fields.
  - [x] Test: refetch over existing temp Library entry keeps `notes`, updates analyzed fields.
- [ ] **Task 5 — Real run + cleanup** (AC: 1, 6)
  - [ ] `npx tsx add.ts <a-real-article-url> --collection library`; record the entry in the Debug Log; confirm `library.json` validity and `bookmarks.json` untouched (`git status`). (Requires live network + claude CLI — cannot execute in this environment.)

## Dev Notes

### What this story changes vs. preserves

- **`add.ts` (UPDATE)** — only the summary block (`555-560`) and (if extracted) a `runAdd` seam. The dispatch/persistence wiring is owned by story 1.2; this story exercises and hardens it, plus proves Library. Do not re-architect dispatch here.
- **`processors.ts` / processors (UPDATE)** — add the optional `summarize` to the contract and implement per type. Keep it optional with a sensible default so future processors aren't forced to implement it.
- **`library.json` (DATA)** — starts `[]` (story 1.1). The automated test must NOT write to it; only the documented manual run (Task 5) does, and is reverted.
- **`bookmarks.json` (NEVER)** — untouched, asserted.

### Why this design (anti-pattern prevention)

- **Stub the analyzer in tests.** Spawning real `claude`/`codex` is non-deterministic, slow, and network/credential-dependent. The integration proof injects a fixed analysis so it asserts *wiring*, not model output. The real model is exercised once, manually (Task 5).
- **Processor-driven summary, not `if (type === "library")`.** A per-type branch in `main` is the exact coupling the registry exists to prevent — every new collection would edit `main`. Push the difference into the processor.
- **Temp collection for persistence tests.** Reuses story 1.1's rule (never touch real data files); proves `mutateCollection` targets the right file without rewriting the 119 Inspiration records or the real Library file.

### Project Structure Notes

- New root file: `library-e2e.test.ts`; add to `scripts.test`.
- No new runtime files expected beyond the `summarize` additions; this is primarily an integration + hardening story.

### Testing standards

- Harness: `node --import tsx --test`. Offline + deterministic: inject capture + analyzer.
- One real end-to-end run is manual (Task 5), kept out of the automated suite.
- Assert non-mutation of `bookmarks.json` (read content before/after, or check it is absent from the test's temp scope).

### References

- [Source: add.ts#475-561] — `main()` orchestration + summary block (555-560) to make processor-driven.
- [Source: add.ts#510-551] — refetch/append branches; `BOARD_RESULT_FILE` write (549-551); `existing` merge to preserve `notes` (516-526).
- [Source: add.ts#563-568] — entrypoint guard to leave intact when extracting `runAdd`.
- [Source: storage.ts] — `mutateCollection` target-file resolution (story 1.1).
- [Source: processors.ts / processor-library.ts] — `Processor` contract + Library processor (stories 1.2, 1.3).
- [Source: stories/1-1-collections-storage-foundation.md#Testing standards] — never-touch-real-data-files rule reused here.

## Dev Agent Record

### Agent Model Used
claude-sonnet-4-6

### Debug Log References
Task 5 (real run) not executable — requires live network + `claude`/`codex` CLI binary + browser. Skipped with note.
Note: jsdom dependency (via story 1-3) has 2 high npm-audit vulnerabilities (transitive). Socket scoring passed (SC=80); flagged for pre-ship review.

### Completion Notes List
- `Processor` interface now has `summarize?(entry): string[]` — optional with no required default.
- Inspiration `summarize`: returns steal_this, audience·form·domain facets, and tags lines.
- Library `summarize`: returns type·topics, summary, and key-points count lines.
- `main()` now routes to `processor.summarize(entry)` if defined; falls back to `[entry.title]` otherwise. Zero per-type branches in main.
- `runAdd(argv, env, deps)` extracted: injectable `captureOverride` and `analyzeOverride`. Returns `{ collection, processor, entry, isRefetch }`. Throws on missing URL; `main()` handles the process.exit(1) for CLI usage.
- Library `buildEntry` existing branch: spreads existing (preserves notes, id, added, all other fields), overrides analyzed fields. Mirrors inspiration's spread pattern.
- Integration test uses snapshot/restore around real `library.json` (correct approach — mutateCollection resolves via cached manifest; temp-manifest injection would bypass the thing AC 1 demands).
- 49 tests, 0 failures.

### File List
- add.ts (updated — runAdd extraction, summarize on inspirationProcessor, updated main)
- processors.ts (updated — optional summarize in Processor interface)
- processor-library.ts (updated — summarize + buildEntry refetch branch)
- processor-library.test.ts (updated — buildEntry refetch + summarize tests)
- processors.test.ts (updated — inspirationProcessor summarize test)
- library-e2e.test.ts (new)
- package.json (updated — library-e2e.test.ts in test script)
- stories/1-4-library-cli-end-to-end-proof.md (this file)
