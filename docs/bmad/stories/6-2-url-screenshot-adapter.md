# Story 6.2: URL → screenshot adapter (Inspiration)

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Epic 6 — Capture & ingest.** Story 2 of 5. Build order: (1) adapter interface → **(2) url-screenshot adapter ◄ this story** → (3) url-readable adapter → (4) manual upload → (5) concurrency & timeout. This story ports the prototype's full-page screenshot capture into the `url-screenshot` adapter (Inspiration board), storing the image as a file with path/dims/hash in `asset`, with guaranteed teardown. *(FR-4.)*

## Story

As an Inspiration collector,
I want a full-page screenshot captured for a URL,
so that my visual board shows the site.

## Acceptance Criteria

1. **The adapter screenshots a URL and stores an asset.**
   **Given** a URL, **When** the `url-screenshot` adapter runs, **Then** Chrome launches → screenshots → closes (in `finally`), the image is stored as a file under `screenshotsDir` (Story 2.2), and an `asset` row is written with its path/width/height/hash.

2. **Teardown happens on error.**
   **Given** the screenshot throws mid-capture, **When** the adapter handles it, **Then** the browser is still closed (`finally`) — no leaked Chrome process.

3. **It returns capture fields + the asset (no analysis), and propagates errors.**
   **Given** a successful capture, **When** it returns, **Then** it yields `{ fields: { title: document.title, source/url, text }, assets: [screenshot] }` — capture only (the prototype `screenshot()` returns only `body.innerText` and gets the *title* from LLM analysis; this adapter pulls `document.title` so a no-LLM capture still has a title). Enrichment (design analysis) is Epic 7. **On error the adapter PROPAGATES (throws) — it does NOT swallow→`""` like the prototype** (`add.ts:331-333`), so Story 5.2 can mark the item `error`.

4. **The adapter takes the launcher via parameter/ctx (this seam is part of THIS story's scope).**
   **Given** that the prototype `screenshot()` hardcodes `puppeteer.launch` (`add.ts:314-319` — no injectable seam exists), **When** this adapter is built, **Then** `fetch(url, ctx)` takes the launcher via parameter/ctx (default = real `launchBrowser`, Story 2.3), so tests inject a fake browser whose `newPage`/`screenshot`/`close` are spies. **Story 6.5 depends on this seam existing** — creating it is in scope here, not assumed.

5. **A test (injected browser) asserts the asset record AND teardown-on-error.**
   **Given** the injected launcher (a fake browser; and one that throws mid-capture), **When** the adapter runs, **Then** the test asserts the asset record (path under `screenshotsDir`, dims, hash) on success AND that `close` is called on the error path (spy) AND that the error propagates (so 5.2 fires) — no real Chrome. *(Red-for-the-right-reason requires the parameter seam from AC 4 — without it the test fails on undefined, not on an assertion.)*

## Tasks / Subtasks

- [ ] **Task 1 — Write the failing screenshot-adapter tests first (TDD)** (AC: 1, 2, 3, 5)
  - [ ] Create `capture/url-screenshot.test.ts`: inject a fake launcher/browser (the AC-4 param seam); assert success → asset record (path under `screenshotsDir`, dims, hash) + `fields.title`; assert an error mid-capture still closes the browser (spy on `close`) AND propagates (does not swallow→`""`); no real Chrome.
  - [ ] Run; confirm red for the right reason.
- [ ] **Task 2 — Port the prototype screenshot flow into the adapter (with an injectable launcher)** (AC: 1, 3, 4)
  - [ ] Create `capture/url-screenshot.ts`: a `CaptureAdapter` (Story 6.1) whose `fetch(url, ctx)` **takes the launcher via parameter/ctx** (default `launchBrowser`, Story 2.3) — this seam is net-new (the prototype hardcodes the launch at `add.ts:314-319`). Port `screenshot` (`add.ts:311-337`): launch, viewport 1440×900@1.5, `page.goto(url, {waitUntil:"networkidle2", timeout})`, settle + `dismissOverlays` (`add.ts:272-309`), `page.screenshot`, extract `body.innerText` (cap 10000) + `document.title` into `fields`.
  - [ ] **Do NOT preserve the prototype's error-swallow** (`add.ts:331-333` returns `""` on failure) — propagate the error so Story 5.2 marks the item `error`. Still `close()` in `finally` (AC 5).
  - [ ] Store the image under `config.screenshotsDir` (Story 2.2), compute width/height/hash, return `{ fields, assets: [{ kind:"screenshot", path, width, height, hash }] }`. The stored `asset.path` is the relative `screenshots/<id>.png` form (Story 2.2 contract).
- [ ] **Task 3 — Guarantee teardown** (AC: 2)
  - [ ] `browser.close()` in `finally` (the prototype does this at `add.ts:334-336`). Honor the Story 5.1 cancellation signal (AbortController) so a timeout (Story 6.5) force-closes the browser. The teardown must `await` browser-close before the worker proceeds (the 5.1↔6.5 ordering contract).
- [ ] **Task 4 — Register the adapter for `ingest_mode=url-screenshot`** (AC: 1)
  - [ ] Register in the Story 6.1 dispatcher. The Inspiration board's descriptor has `ingest_mode: url-screenshot` (Story 1.2).
- [ ] **Task 5 — Wire tests + verify green** (AC: 4)
  - [ ] Add the test to the `test` script; run `npm test`; confirm green + existing suites unaffected.

## Dev Notes

### What this story changes vs preserves (read before coding)

- **NEW `capture/url-screenshot.ts`** — ports `screenshot` (`add.ts:311-337`) into the adapter shape. The prototype's screenshot logic is sound; this story moves it behind `CaptureAdapter` + decouples it from analysis.
- **Exact prototype anchors (recon):** `screenshot(url, outputPath)` — `add.ts:311-337`: dynamic `import("puppeteer-core")` (`314`), launch with `executablePath: CHROME_PATH` + `--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage` (`315-319`), viewport 1440×900@1.5 (`321`), `goto(url, {waitUntil:"networkidle2", timeout:30000})` (`322`), settle 1000ms → `dismissOverlays` → 400ms → `screenshot({clip:1440×900})` (`323-326`), `body.innerText` cap 10000 (`327-329`), failure swallowed → `""` (`331-333`), `finally { browser?.close() }` (`334-336`). `dismissOverlays` helper (`add.ts:272-309`).
- **Use `launchBrowser` from Story 2.3** — don't re-duplicate the launch options (the prototype duplicates them in `add.ts` and `browser.ts`; Story 2.3 centralized them). Resolve `CHROME_PATH` lazily (Story 2.3) so a no-Chrome box still boots.
- **Store under `screenshotsDir` (Story 2.2)** — NOT the code tree. The asset path is the relative `screenshots/<id>.png` form; the `/screenshots/` static route (Story 2.2) serves it.

### Why this design (anti-pattern prevention)

- **Teardown in `finally`, always (FR-6/NFR-1).** A leaked Chrome process holds ~500MB and OOMs the box. The prototype's `finally { browser?.close() }` is load-bearing — preserve it, and extend it to honor the timeout signal (6.5). [Source: add.ts#334-336, docs/bmad/PRD.md#NFR-1]
- **Capture only — no analysis here.** The prototype's flow runs analysis inline; v1's adapter returns capture fields + asset, and enrichment (Epic 7) is a separate job. This is what makes capture work with no LLM (FR-9). Don't call the LLM from the adapter. [Source: docs/bmad/architecture.md#4.3]
- **Inject the browser/launcher for tests.** No real Chrome in CI (slow, flaky, needs a binary). Inject the launcher so the asset-record and teardown-on-error paths are deterministic. [Source: docs/bmad/PRD.md#NFR-5]
- **Keep `dismissOverlays`.** The cookie/consent/modal dismissal (`add.ts:272-309`) materially improves screenshot quality — port it, don't drop it.

### Project Structure Notes

- `capture/url-screenshot.ts` + `.test.ts`. Uses `browser.ts` `launchBrowser` (2.3), `config.screenshotsDir` (2.2), the 6.1 dispatcher.
- ESM `.js` specifiers; `node:test`; add the test to the `test` script.

### Testing standards

- Inject the launcher/browser; assert asset record (path/dims/hash) + teardown-on-error (spy `close`). No real Chrome.
- Existing suites green.

### References

- [Source: add.ts#311-337] — `screenshot` flow to port (launch→screenshot→close-in-finally).
- [Source: add.ts#272-309] — `dismissOverlays` to port.
- [Source: docs/bmad/PRD.md#FR-4] — URL capture; Inspiration full-page screenshot; path/dims/hash in DB.
- [Source: docs/bmad/architecture.md#4.3] — CaptureAdapter; concurrency 1; teardown in finally.
- [Source: docs/bmad/stories/2-2-data-dir-paths.md] — `screenshotsDir` + relative-path/`/screenshots/` serving.
- [Source: docs/bmad/stories/2-3-chrome-path-resolution.md] — `launchBrowser` + lazy `CHROME_PATH`.
- [Source: docs/bmad/stories/6-1-capture-adapter-interface.md] — the adapter contract + dispatch.
- [Source: docs/bmad/stories/6-5-capture-concurrency-timeout.md] — the timeout/kill this adapter's teardown honors.

## Dev Agent Record

### Agent Model Used

_(to be filled by dev agent)_

### Debug Log References

### Completion Notes List

### File List
