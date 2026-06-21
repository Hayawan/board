# Story 6.3: URL → readable-text adapter (Library, SPA fallback)

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Epic 6 — Capture & ingest.** Story 3 of 5. Build order: (1) adapter interface → (2) url-screenshot → **(3) url-readable adapter ◄ this story** → (4) manual upload → (5) concurrency & timeout. This story ports the prototype's Library capture (Readability + turndown → markdown, with a headless-render SPA fallback) into the `url-readable` adapter. *(FR-4.)*

## Story

As a Library collector,
I want readable text extracted from a URL with a JS-render fallback,
so that articles (including SPAs) capture their content.

## Acceptance Criteria

1. **The adapter extracts readable markdown from an article URL.**
   **Given** an article URL, **When** the `url-readable` adapter runs, **Then** Readability + turndown extract markdown into `fields` (title + content text), via a plain `fetch` (no browser).

2. **SPA fallback to headless render when text is too thin.**
   **Given** a JS-rendered shell yielding too little text (< the useful-text threshold), **When** the adapter runs, **Then** it falls back to a headless render (`launchBrowser`) and keeps the longer result.

3. **No readable text → clear error.**
   **Given** a URL that yields too little text even after the render fallback, **When** the adapter runs, **Then** it throws a clear "no readable text" error (→ item `status=error` with a clean reason, Story 5.2).

4. **Unit tests over HTML fixtures (injected fetch) cover article extraction + the empty-shell fallback.**
   **Given** committed HTML fixtures and an injected `fetch` (+ injected renderer), **When** the adapter runs, **Then** the test asserts article extraction (fixture → markdown) AND the empty-shell → render-fallback path — no real network, no real Chrome. (Port the prototype's `captureLibrary` tests.)

## Tasks / Subtasks

- [ ] **Task 1 — Write the failing readable-adapter tests first (TDD)** (AC: 1, 2, 3, 4)
  - [ ] Create `capture/url-readable.test.ts` (or port `processor-library.test.ts`): inject `fetch` returning a committed article HTML fixture → assert markdown extraction; inject a thin-shell HTML + an injected renderer returning fuller text → assert fallback keeps the longer result; inject thin everywhere → assert "no readable text" error.
  - [ ] Run; confirm red.
- [ ] **Task 2 — Port `extractReadableMarkdown` + `captureLibrary`** (AC: 1, 2, 3)
  - [ ] Create `capture/url-readable.ts`: port `extractReadableMarkdown(html, url)` (`processor-library.ts:121-130`: JSDOM → Readability → `# title` + turndown, cap 10000, body-textContent fallback) and `captureLibrary(url, opts)` (`processor-library.ts:132-167`: `fetchFn` injectable → extract → if `< MIN_USEFUL_TEXT` (200, `processor-library.ts:9`) call `renderFn` (default `renderPageText`/`launchBrowser`) and keep longer → if still thin, throw). Shape the result as `{ fields: { title, summary?/text }, assets: [] }` (Library captures no screenshot — `screenshotPath: null` in the prototype, `processor-library.ts:166`).
  - [ ] Keep `fetchFn` and `renderFn` injectable (the prototype already does, `processor-library.ts:136-137`) for tests.
- [ ] **Task 3 — Register the adapter for `ingest_mode=url-readable`** (AC: 1)
  - [ ] Register in the Story 6.1 dispatcher. The Library board's descriptor has `ingest_mode: url-readable` (Story 1.2).
- [ ] **Task 4 — Honor the timeout signal on the render fallback** (AC: 2)
  - [ ] The headless-render fallback launches Chrome (`launchBrowser`, Story 2.3) — it must honor the Story 5.1 cancellation signal + close in `finally` (Story 6.5), same as the screenshot adapter. The plain-`fetch` path has its own timeout (don't hang on a slow server).
- [ ] **Task 5 — Wire tests + verify green** (AC: 4)
  - [ ] Add the test to the `test` script; run `npm test`; confirm green + existing suites unaffected.

## Dev Notes

### What this story changes vs preserves (read before coding)

- **NEW `capture/url-readable.ts`** — ports the prototype's Library capture. This is a clean port; the logic is sound and already injectable/tested.
- **Exact prototype anchors (recon):** `MIN_USEFUL_TEXT = 200` (`processor-library.ts:9`); `extractReadableMarkdown(html, url)` — `processor-library.ts:121-130` (pure: JSDOM+Readability+turndown, body-textContent fallback); `captureLibrary(url, opts?)` — `processor-library.ts:132-167` (fetchFn injectable `136-137`, fetch→extract `139-141`, SPA fallback if `< MIN_USEFUL_TEXT` via `renderFn`/`renderPageText` keeping the longer `146-155`, throw if still thin `157-164`, returns `{text, screenshotPath:null}` `166`). `renderPageText` lives in `browser.ts:12-32` (Story 2.3's `launchBrowser` consolidates it).
- **Decouple from analysis.** The prototype's `libraryProcessor` (`processor-library.ts:169-216`) bundles capture + validate + buildEntry. v1 takes only the capture half here; the Library enrichment (summary/topics/author/type/key_points) is Epic 7 against the descriptor.
- **Port the existing tests.** `processor-library.test.ts` already covers article extraction + the empty-shell fallback over HTML fixtures — port/adapt these to `capture/url-readable.test.ts` rather than writing from scratch.

### Why this design (anti-pattern prevention)

- **Plain `fetch` first, browser only as fallback (NFR-1).** Launching Chrome for every article wastes the box's memory budget; most articles extract fine from raw HTML. Only fall back to a headless render when text is too thin (SPA shells). The `MIN_USEFUL_TEXT` threshold gates this — preserve it. [Source: processor-library.ts#9, #146-155]
- **Injectable `fetch` + `render`.** The prototype's injectable seams (`fetchImpl`, `renderFn`) are what make this unit-testable over fixtures with no network/Chrome. Keep them. [Source: processor-library.ts#136-137]
- **"No readable text" is a clean error, not a crash.** A URL that yields nothing → a clear error → item `status=error` with reason "no readable text" (Story 5.2), never a raw throw. [Source: processor-library.ts#157-164, docs/bmad/stories/5-2-item-status-lifecycle.md]
- **Render fallback honors teardown.** The fallback launches Chrome — it must close in `finally` + honor the timeout (6.5), same as 6.2. A leaked render-browser OOMs the box. [Source: docs/bmad/PRD.md#NFR-1]

### Project Structure Notes

- `capture/url-readable.ts` + `.test.ts` (port `processor-library.test.ts`). Uses `browser.ts` `launchBrowser` (2.3), the 6.1 dispatcher. Deps `@mozilla/readability`, `jsdom`, `turndown` already in package.json (recon).
- ESM `.js` specifiers; `node:test`; add the test to the `test` script.

### Testing standards

- Committed HTML fixtures; injected `fetch` + `render`; never real network/Chrome.
- Cover: article extraction, empty-shell→render fallback (keeps longer), no-text→error. The fallback + error cases are the ones that matter.
- Existing suites green.

### References

- [Source: processor-library.ts#121-167] — `extractReadableMarkdown` + `captureLibrary` (the port target).
- [Source: processor-library.ts#9] — `MIN_USEFUL_TEXT` threshold.
- [Source: processor-library.test.ts] — existing fixture-based tests to port.
- [Source: browser.ts#12-32] — `renderPageText` (the SPA-render fallback), consolidated into `launchBrowser` (Story 2.3).
- [Source: docs/bmad/PRD.md#FR-4] — URL capture; Library readable text with SPA fallback.
- [Source: docs/bmad/stories/6-1-capture-adapter-interface.md] — adapter contract + dispatch.
- [Source: docs/bmad/stories/5-2-item-status-lifecycle.md] — the clean-error mapping for "no readable text".

## Dev Agent Record

### Agent Model Used

_(to be filled by dev agent)_

### Debug Log References

### Completion Notes List

### File List
