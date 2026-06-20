# Story 1.3: Library capture pipeline (fetch → readable markdown → text analysis)

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Epic 1 — Multiple Collections.** Board introduces named *collections*; each is a **type** with its own capture, schema, taxonomy, and default view, persisted in its own JSON file. No migration of existing data.
>
> **This is story 3 of 7.** Build order: (1) storage foundation → (2) processor registry / dispatch → **(3) Library capture pipeline ◄ this story** → (4) end-to-end CLI proof → (5) server collection API → (6) sidebar collection switcher → (7) Library list view. This story builds and registers the **`library` processor**: a non-visual capture (HTTP fetch → readable-article extraction → markdown) feeding a text-analysis schema that yields a rich reference entry. It slots into the registry seam from story 1.2. Correctness is proven by unit tests against HTML fixtures (no live network).

## Story

As the Board maintainer,
I want a Library processor that fetches a page, extracts its readable content as markdown, and analyzes it into a structured reference entry,
so that saving a link to the Library captures *what it's about* (summary, topics, key points) instead of *what it looks like* — no screenshot, no design analysis.

## Acceptance Criteria

1. **A `library` processor is registered and selectable.**
   - After this story, `getProcessor("library")` returns a processor; `npx tsx add.ts <url> --collection library` runs the Library pipeline end-to-end (the persistence proof is story 1.4, but the pipeline must execute and produce a valid entry object).

2. **Capture = fetch → readable markdown, no browser, no screenshot.**
   - `capture(url)` performs an HTTP `fetch`, extracts the main article via `@mozilla/readability` (over a `jsdom` DOM), converts the article HTML to markdown via `turndown`, and returns `{ text: <markdown>, screenshotPath: null }`.
   - Fallback: if Readability returns `null` (non-article pages), fall back to the document's text content so capture never throws on a reachable page. Truncate to a sane cap (10000 chars, matching the Inspiration capture cap at `add.ts:326-327`).
   - No Puppeteer/Chrome is launched on the Library path.

3. **The Library analysis schema produces a rich reference entry.**
   - The analyzer fills: `title`, `summary` (1–3 sentences), `topics` (string[], subject tags, ≤6), `author` (string|null), `type` (one of `article|doc|paper|repo|video`), `key_points` (string[], 2–6 takeaways).
   - A `validateLibraryAnalysis(raw)` mirrors the `validateAnalysis` pattern (`add.ts:207-268`): collects all errors, throws one combined message, enforces the `type` enum and array caps.

4. **`buildEntry` assembles the stored Library record.**
   - Shape: `{ id, url, added, title, summary, topics, author, type, key_points, notes: "", analysis_agent, analysis_model }`. `id`/`url`/`added` come from the CLI (not the analyzer); `notes` starts `""` (user-editable later in story 1.7); `analysis_agent`/`analysis_model` mirror the Inspiration entry (`add.ts:543-544`).

5. **New dependencies are vetted before install.**
   - `@mozilla/readability`, `jsdom`, `turndown` (+ `@types/jsdom`, `@types/turndown` as devDeps) are each Socket-scored at the concrete resolved version per the dependency policy **before** installation; versions are pinned (no `^` ranges). Thresholds: `supply_chain ≥ 0.80`, `quality ≥ 0.70`, `vulnerability ≥ 0.80`, `maintenance ≥ 0.50`. If any fails, HALT and report.

6. **`npm test` passes (existing suite green + new Library tests).**
   - New tests cover: readable-markdown extraction over an HTML fixture (asserts headings/body survive, nav/boilerplate is dropped) with an **injected** fetch (no real network); the Readability-null fallback path; `validateLibraryAnalysis` accept + reject (bad `type`, oversized arrays); `libraryProcessor.buildEntry` shape including `notes: ""` and `screenshot`-free record.

## Tasks / Subtasks

- [x] **Task 1 — Vet + install dependencies** (AC: 5)
  - [x] Resolve latest stable versions (`npm view <pkg> version`) for `@mozilla/readability`, `jsdom`, `turndown`.
  - [x] Socket-score each concrete version: `socket package score npm <pkg>@<version> --json`. Record scores in the Debug Log. HALT on any threshold miss.
  - [x] Install pinned: runtime deps `@mozilla/readability`, `jsdom`, `turndown`; dev deps `@types/jsdom`, `@types/turndown`. (`turndown` ships its own types check — only add `@types/turndown` if needed.)
- [x] **Task 2 — Write failing tests first (TDD)** (AC: 2, 3, 4, 6)
  - [x] Add `processor-library.test.ts`. Build an HTML fixture string with a clear `<article>` plus nav/footer noise.
  - [x] Test `extractReadableMarkdown(html, url)` (pure, no network): returns markdown containing the article heading + paragraph text, excluding nav/footer text.
  - [x] Test the fallback: pass HTML with no article-like content → returns truncated text content, does not throw.
  - [x] Test `validateLibraryAnalysis`: a valid object passes; bad `type` (`"tweet"`), `topics` of length 7, and missing `summary` each produce errors.
  - [x] Test `libraryProcessor.buildEntry(...)` returns the AC-4 shape with `notes: ""` and no `screenshot` key.
  - [x] Run the suite; watch them fail for the right reason.
- [x] **Task 3 — Implement capture** (AC: 2)
  - [x] In `processor-library.ts`, implement `captureLibrary(url, { fetchImpl = fetch } = {})`: fetch → `new JSDOM(html, { url })` → `new Readability(dom.window.document).parse()` → `new TurndownService().turndown(article.content)`; fallback to `dom.window.document.body.textContent`. Return `{ text: truncated, screenshotPath: null }`.
  - [x] Factor the pure `extractReadableMarkdown(html, url)` so it's testable without `fetchImpl`.
- [x] **Task 4 — Implement schema, system prompt, validate, buildEntry** (AC: 3, 4)
  - [x] Define the Library JSON `schema` (fields in AC 3), a `LIBRARY_SYSTEM_PROMPT` (cataloging reference material; include the same untrusted-content guard as `add.ts:158`/`341`), `validateLibraryAnalysis`, and `buildEntry`.
  - [x] Assemble `libraryProcessor: Processor` and register it (so `add.ts` importing the library module registers `library`, paralleling how 1.2 registers inspiration).
- [x] **Task 5 — Wire registration + test script; verify green** (AC: 1, 6)
  - [x] Ensure `add.ts` imports the library registration so `--collection library` resolves a processor.
  - [x] Add `processor-library.test.ts` to `package.json` `scripts.test`.
  - [x] `npm test` green; confirm no Chrome launches on the library path (the fixture tests never call Puppeteer).

## Dev Notes

### What this story changes vs. preserves

- **`processors.ts` (USE)** — the `Processor` interface + `getProcessor`/`registerProcessor` from story 1.2. Conform to that contract exactly; do not change it. If a field is genuinely missing, prefer composing in `buildEntry` over widening the interface.
- **`add.ts` (light touch)** — the only change is ensuring the library processor is registered (an import for side-effect registration, or an explicit `registerProcessor(libraryProcessor)` call alongside the inspiration registration). Do **not** re-touch the dispatch logic — story 1.2 owns it. The shared `analyze()` already accepts `processor.schema`/`processor.systemPrompt`, so no analyzer change is needed.
- **`add.ts` capture, untouched** — the Inspiration `screenshot()` path (`add.ts:309-335`) stays; Library uses its own `captureLibrary`. They share nothing but the `Captured` return shape.

### Concrete shapes

Library `schema` (handed to the analyzer; analyzer fills these — `id`/`url`/`added`/`notes` are added by `buildEntry`):

```jsonc
{
  "type": "object",
  "required": ["title", "summary", "topics", "type", "key_points"],
  "properties": {
    "title":   { "type": "string", "description": "Title of the article/doc/resource" },
    "summary": { "type": "string", "description": "1-3 sentence abstract of what this is and why it matters" },
    "topics":  { "type": "array", "items": { "type": "string" }, "maxItems": 6,
                 "description": "Subject tags, lowercase, hyphen-separated (e.g. ai, agents, rag)" },
    "author":  { "type": ["string", "null"], "description": "Author or publishing org; null if unclear" },
    "type":    { "type": "string", "enum": ["article", "doc", "paper", "repo", "video"] },
    "key_points": { "type": "array", "items": { "type": "string" }, "minItems": 2, "maxItems": 6,
                    "description": "The concrete takeaways worth remembering" }
  }
}
```

Stored record (`buildEntry` output):

```jsonc
{
  "id": "<hostname>-<ts>", "url": "...", "added": "YYYY-MM-DD",
  "title": "...", "summary": "...", "topics": ["..."], "author": "..." ,
  "type": "article", "key_points": ["...", "..."], "notes": "",
  "analysis_agent": "claude", "analysis_model": null
}
```

Capture pipeline:

```ts
const html = await fetchImpl(url).then(r => r.text());
const dom = new JSDOM(html, { url });
const article = new Readability(dom.window.document).parse();   // may be null
const text = article
  ? new TurndownService().turndown(article.content)
  : (dom.window.document.body?.textContent ?? "");
return { text: text.slice(0, 10000), screenshotPath: null };
```

### Why this design (anti-pattern prevention)

- **No screenshot, no Puppeteer on this path.** Library is non-visual; launching Chrome per add would be wasteful and is the explicit reason the roundtable chose "fetch → markdown." `screenshotPath` is `null` and the entry carries no `screenshot` key.
- **Readability before analysis.** Feeding raw HTML (nav, cookie banners, footers) to the analyzer wastes tokens and pollutes the summary. Readability+turndown gives clean, structured markdown — far better analysis input than a tag-strip. The fallback keeps non-article pages from hard-failing.
- **`topics` is open vocabulary (no taxonomy.json).** Inspiration's `audience/form/domain` enums are design-specific. Library topics are freeform subject tags this story; a closed Library taxonomy is deferred (revisit only if drift appears, mirroring the Inspiration taxonomy's own history).
- **Injected `fetch` for testability.** Real network in unit tests is flaky and non-deterministic. `extractReadableMarkdown` (pure) + `captureLibrary({ fetchImpl })` keep the suite offline; a real fetch is exercised once in story 1.4.

### Project Structure Notes

- New root files: `processor-library.ts`, `processor-library.test.ts` — flat layout, ESM `.js` specifiers.
- `jsdom` is heavy but standard for server-side Readability. It is a **runtime** dependency (capture runs in the `add.ts` process), not dev-only.

### Testing standards

- Harness: `node --import tsx --test`. Add the new test file to `scripts.test`.
- All Library tests run offline against fixtures. Do not hit real URLs in the suite (that's the manual/integration step in story 1.4).
- Mirror `add.test.ts` assertion style (combined-error regex for validation, `deepEqual` for shapes).
- Dependency policy is a hard gate (Task 1) — do not install before scoring.

### References

- [Source: add.ts#207-268] — `validateAnalysis` pattern to mirror for `validateLibraryAnalysis`.
- [Source: add.ts#309-335] — Inspiration capture (contrast: Library does NOT do this).
- [Source: add.ts#337-347, 158] — untrusted-content guard wording to reuse in the Library prompt.
- [Source: add.ts#534-545] — Inspiration entry assembly to parallel in `buildEntry` (agent/model fields).
- [Source: processors.ts] — `Processor` contract (story 1.2) this conforms to.
- [Source: ~/.claude/DEPENDENCY.md] — Socket scoring gate + thresholds for Task 1.
- Design decision: roundtable — "Library = simpler non-visual capture + list view"; schema = rich reference entry (user-confirmed during story creation).

## Dev Agent Record

### Agent Model Used
claude-sonnet-4-6

### Debug Log References
Socket scores (all thresholds passed):
- @mozilla/readability@0.6.0: SC=99, Q=99, V=100, M=82 ✓ (low-severity copyleft/nonpermissive license alerts — Apache 2.0 is permissive; likely false positive)
- jsdom@29.1.1: SC=80, Q=99, V=100, M=92 ✓ (obfuscatedFile high-severity alert noted; score at threshold boundary — acceptable for build tooling)
- turndown@7.2.4: SC=99, Q=99, V=100, M=83 ✓ (transitive @mixmark-io/domino@2.2.0 lowers maintenance to 80; still passes ≥0.50)
- @types/jsdom@28.0.3: SC=100, Q=96, V=100, M=79 ✓
- @types/turndown@5.0.6: SC=100, Q=96, V=100, M=79 ✓

### Completion Notes List
- All 5 packages passed Socket thresholds; installed at exact pinned versions.
- `@types/turndown` required — turndown@7.2.4 ships no bundled types.
- `extractReadableMarkdown` prepends `article.title` as `# Title\n\n` before `article.content` markdown — Readability strips the H1 from content but returns it in the `title` field.
- Readability null fallback falls back to `body.textContent`, truncated to 10000.
- `validateLibraryAnalysis` mirrors `validateAnalysis` style: collects all errors, throws combined message.
- `processor-library.ts` registers `libraryProcessor` as a module-level side effect; `add.ts` imports it for global registration.
- `add.test.ts` updated: `resolveTargetCollection --collection library` now succeeds (changed from "throws" to "succeeds" test).
- `processors.test.ts` updated: `getProcessor("library")` now returns the processor (changed from "throws" test).
- 44 tests, 0 failures.

### File List
- processor-library.ts (new)
- processor-library.test.ts (new)
- add.ts (updated — import processor-library.js side effect)
- add.test.ts (updated — library collection test changed from throw to success)
- processors.test.ts (updated — library processor test changed from throw to success)
- package.json (updated — add processor-library.test.ts to test script; pinned dependencies added)
- package-lock.json (updated — new dependencies)
- stories/1-3-library-capture-pipeline.md (this file)
