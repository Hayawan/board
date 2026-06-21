# Story 2.3: CHROME_PATH resolution + Linux autodetect

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Epic 2 — Configuration, data & portability.** Story 3 of 4. Build order: (1) env config → (2) DATA_DIR paths → **(3) CHROME_PATH resolution + Linux autodetect ◄ this story** → (4) localhost bind. This story replaces the prototype's hardcoded macOS Chrome path with `CHROME_PATH` env + Linux autodetect, so capture works on the Debian LXC target. *(supports FR-4; NFR-6 portability.)*

## Story

As a self-hoster on Debian,
I want Chrome located via `CHROME_PATH` or autodetection,
so that capture works off the macOS-only hardcoded path.

## Acceptance Criteria

1. **`CHROME_PATH` env wins when set.**
   **Given** `CHROME_PATH` is set, **When** the browser path resolves, **Then** that path is used.

2. **Autodetect when unset.**
   **Given** `CHROME_PATH` is unset, **When** the path resolves, **Then** it probes known binaries in order — `chromium`, `chromium-browser`, `google-chrome` (Linux), plus the existing macOS default — and uses the first that exists.

3. **Named error when none found.**
   **Given** no Chrome/Chromium is found and `CHROME_PATH` is unset, **When** the path resolves (lazily, at capture time), **Then** a clear, named error tells the user to set `CHROME_PATH`. Boot itself does not fail (capture is optional/lazy — NFR-4).

4. **A unit test covers env-wins / detect / missing-throws via an injected lookup.**
   **Given** an injected `lookup` predicate (not the real filesystem/PATH) and a `chromePath` value, **When** the test runs the three cases, **Then** it asserts: configured path wins; autodetect picks the first candidate `lookup` resolves; none-found → the named error.

5. **Resolution is lazy — boot/import with no Chrome does not throw.**
   **Given** an environment with no Chrome (configured path unset, `lookup` resolves nothing), **When** the server is built/booted (or `browser.ts` is imported), **Then** nothing throws — the app serves the UI; the named error fires ONLY when a capture actually invokes the launch path. *(This is the NFR-4 non-blocking-first-run guarantee, and it's only testable if resolution happens at launch time, not module-load time.)*

## Tasks / Subtasks

- [ ] **Task 1 — Write the failing resolver + laziness tests first (TDD)** (AC: 1, 2, 3, 4, 5)
  - [ ] Create `browser.test.ts`: inject a fake `lookup` + `chromePath`; assert configured-wins, autodetect-order, and missing-throws-named-error (AC 4).
  - [ ] Add the **laziness** test (AC 5): build/boot the server (or import `browser.ts`) with a no-Chrome environment and assert it does NOT throw; assert the named error only surfaces when the launch path (`launchBrowser()`) is invoked.
  - [ ] Run; confirm red.
- [ ] **Task 2 — Implement `resolveChromePath` with a fully injectable lookup** (AC: 1, 2, 3)
  - [ ] In `browser.ts`, replace the hardcoded `CHROME_PATH` const (`browser.ts:4`) with `resolveChromePath({ chromePath, lookup })` where `chromePath` is the configured value (or undefined) and `lookup(candidate)` is an injected predicate that resolves a candidate to an absolute path or null. It: returns `chromePath` if set; else tries candidates in order `["chromium","chromium-browser","google-chrome", <macOS default absolute>]` via `lookup`; else throws a named error telling the user to set `CHROME_PATH`.
  - [ ] **The lookup must be injectable end-to-end** — bare names (`chromium`) need a PATH search, absolute defaults need an existence check. Do NOT split into "PATH for bare names, injected `exists` for absolutes" — that leaves the PATH branch hitting the real environment and makes AC 4 non-deterministic. Use ONE injected `lookup` (default impl = `which`-style PATH search + `existsSync` for absolutes; tests pass a fake `lookup`). 
  - [ ] **The production call passes `config.CHROME_PATH`** (Story 2.1's resolved value) as `chromePath` — not a raw `process.env` read (that would reintroduce the scattered-env anti-pattern AC3 of Story 2.1 forbids). The `lookup`/`chromePath` injection is for tests.
- [ ] **Task 3 — Resolve lazily at capture time, not at import/boot** (AC: 3)
  - [ ] Ensure resolution happens when a capture launches Chrome, not at module load — so a box with no Chrome still boots and serves (NFR-4), and only capture surfaces the error. Both launch sites use it: `add.ts` screenshot launch (`add.ts:314-319`) and `browser.ts renderPageText` (`browser.ts:12-32`).
- [ ] **Task 4 — Centralize the launch path in `launchBrowser()` (required — it's the laziness seam)** (AC: 1, 2, 5)
  - [ ] The puppeteer launch options + `executablePath` are duplicated between `add.ts:315-319` and `browser.ts:16-20` (recon). Create a single `launchBrowser()` helper in `browser.ts` that both call. `resolveChromePath` is invoked **inside** `launchBrowser()` (at launch time), giving exactly one consumer and making AC 5 laziness testable: importing/booting touches no Chrome; only `launchBrowser()` resolves+throws. (Epic 6's CaptureAdapter consolidates further; this helper is the seam now.)
- [ ] **Task 5 — Wire tests + verify green** (AC: 4)
  - [ ] Add the test to the `test` script; run `npm test`; confirm green + existing suites unaffected.

## Dev Notes

### What this story changes vs preserves (read before coding)

- **`browser.ts` (UPDATE)** — the single highest-priority portability fix. `browser.ts:4` is `export const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";` — a hardcoded macOS absolute path with no env override, no platform fallback (recon). Replace with `resolveChromePath`. `renderPageText` (`browser.ts:12-32`) consumes it for the SPA-render fallback.
- **`add.ts` (light touch)** — imports `CHROME_PATH` from `browser.js` (`add.ts:11`) and uses it in `screenshot` launch (`add.ts:314-319`). Switch to the resolved path. Keep the screenshot behavior otherwise identical (the capture-adapter rewrite is Epic 6).
- **Preserve the launch args** — `--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage` (used in both launch sites). `--disable-dev-shm-usage` matters on the small LXC (limited `/dev/shm`); do not drop it. [Source: add.ts#315-319, browser.ts#16-20]

### Why this design (anti-pattern prevention)

- **Lazy resolution, not boot-time.** A fresh self-hoster may have no browser yet; boot must still serve the UI (manual upload + browse work without Chrome). Resolving at capture time keeps boot non-blocking (NFR-4) and turns "no Chrome" into a per-capture named error, not a crash loop. [Source: docs/bmad/PRD.md#NFR-4]
- **Injectable existence check.** Testing autodetect against the real filesystem is non-deterministic across dev machines/CI. Inject the predicate so the three cases are deterministic. Mirrors the prototype's injectable seams. [Source: processor-library.ts#136-137]
- **Probe order is `chromium` first (Linux target).** The deploy target is a Debian LXC where `chromium`/`chromium-browser` is the apt package; prefer those, fall back to `google-chrome`, then the macOS default for dev. Document the order. [Source: docs/bmad/architecture.md#2 — puppeteer-core → system Chromium, CHROME_PATH env + Linux autodetect]
- **Don't bundle Chromium.** Architecture chose `puppeteer-core` → system Chromium deliberately (footprint). Do not switch to full `puppeteer` (downloads a ~300MB Chromium) to "solve" detection. [Source: docs/bmad/architecture.md#2]

### Project Structure Notes

- Lives in `browser.ts` (recon: `browser.ts` is the launch/render module; architecture §6 keeps `capture/browser.ts`). Epic 6 moves capture under `capture/`; for now keep it where the prototype has it.
- ESM `.js` specifiers; `node:test`; add the test to the `test` script.

### Testing standards

- Inject env + existence predicate; never probe the real FS in tests.
- Cover all three branches (env-wins / detect / missing) — the missing-throws case is the one a happy-path test skips.
- Existing suites green (the prototype's capture tests inject overrides, so they should be unaffected — verify).

### References

- [Source: browser.ts#4] — hardcoded macOS `CHROME_PATH` const to replace.
- [Source: browser.ts#12-32] — `renderPageText` consumer (SPA fallback).
- [Source: add.ts#11, #314-319] — `add.ts` screenshot launch consumer.
- [Source: docs/bmad/architecture.md#2-tech-stack] — `puppeteer-core` → system Chromium; `CHROME_PATH` env + Linux autodetect.
- [Source: docs/bmad/PRD.md#FR-4] — URL capture (depends on a resolvable browser).
- [Source: docs/bmad/PRD.md#NFR-4] — non-blocking first-run (lazy resolution).
- [Source: docs/bmad/stories/2-1-env-config-loader.md] — `config.CHROME_PATH` source.

## Dev Agent Record

### Agent Model Used

_(to be filled by dev agent)_

### Debug Log References

### Completion Notes List

### File List
