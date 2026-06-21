# Story 2.2: DATA_DIR-rooted persistent paths

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Epic 2 — Configuration, data & portability.** Story 2 of 4. Build order: (1) env config loader → **(2) DATA_DIR-rooted persistent paths ◄ this story** → (3) CHROME_PATH resolution → (4) localhost bind. This story roots the SQLite file and the screenshots dir under a persistent `DATA_DIR` separate from app code, so upgrades never nuke user data. It resolves the `// Story 2.2` markers left in Epic 1. *(FR-21, NFR-6.)*

## Story

As a self-hoster,
I want the SQLite file and screenshots under `DATA_DIR`, separate from the app code,
so that upgrading the code never deletes my data.

## Acceptance Criteria

1. **All data paths derive from `DATA_DIR`.**
   **Given** a configured `DATA_DIR`, **When** the app boots, **Then** the SQLite DB file and the screenshots directory are created under `DATA_DIR` (not under the app source tree).

2. **The data dir is created if missing.**
   **Given** a `DATA_DIR` that does not yet exist, **When** the app boots, **Then** it is created (with the screenshots subdir), so a fresh install works with zero manual setup (NFR-4/UJ-3).

3. **A test asserts every data path derives from `DATA_DIR` and none resolves into the app tree.**
   **Given** a temp `DATA_DIR`, **When** the path resolver runs, **Then** the test asserts `dbPath` and `screenshotsDir` both start with `DATA_DIR` AND neither resolves under the repo/`__dirname` (the app-tree regression this story prevents — assert the negative explicitly, not just the positive).

4. **A screenshot stored under `screenshotsDir` is served at `/screenshots/<file>`.**
   **Given** a screenshot file present under `config.screenshotsDir`, **When** the UI requests `/screenshots/<file>` (via `app.inject()`), **Then** it returns 200 with the bytes — proving the static-serving followed the files out of the app tree (assets don't 404). *(Committed, not hedged — this is the subtlest breakage in the story.)*

5. **Screenshot writes (capture + manual upload) land under `screenshotsDir`, and tests don't pollute the real dir.**
   **Given** a temp `DATA_DIR` injected into the server, **When** a manual-upload screenshot is written (the `handleScreenshot` path), **Then** the file lands under the temp `screenshotsDir`, not the app tree — and the existing `server.test.ts` screenshot test is retrofitted to point at a temp dir so it no longer writes into the default `DATA_DIR`.

## Tasks / Subtasks

- [ ] **Task 1 — Write the failing path-derivation test first (TDD)** (AC: 1, 2, 3)
  - [ ] Create `paths.test.ts` (or extend `config.test.ts`): point config at a temp `DATA_DIR`; assert `dbPath` and `screenshotsDir` resolve under it; assert the dir is created when absent.
  - [ ] Run; confirm red.
- [ ] **Task 2 — Add path derivation to config** (AC: 1)
  - [ ] In `config.ts` (Story 2.1), derive `dbPath = <DATA_DIR>/board.db` (name TBD) and `screenshotsDir = <DATA_DIR>/screenshots`. Expose them on the config object. Replace the Epic-1 `// Story 2.2` DB-path placeholder in `db/index.ts` with `config.dbPath`.
- [ ] **Task 3 — Ensure-dir on boot** (AC: 2)
  - [ ] On startup, `mkdir -p` the `DATA_DIR` and `screenshots` subdir (idempotent). Do this in one place (config init or a small `ensureDataDir()`), not scattered.
- [ ] **Task 4 — Repoint ALL screenshot read/write/serve sites to `screenshotsDir`** (AC: 1) — *there are FIVE code-tree-relative sites, not one; missing any splits screenshots between DATA_DIR and the app tree.*
  - [ ] **Keep stored `asset.path`/`screenshot` values RELATIVE** (`screenshots/<id>.png`) — Story 1.5 already commits real rows with this verbatim relative format (1.5 stores `asset.path` as `screenshots/<id>.png`), and the frontend builds the URL as `/${b.screenshot}` (`index.html:1979-1980` `shotSrc`). So do NOT change the stored format and do NOT switch to absolute — that would break already-imported rows and the frontend contract. This story changes only the **resolution base** (resolve the relative path under `config.screenshotsDir`).
  - [ ] Repoint every WRITE/READ/UNLINK that currently joins `__dirname`:
    - `add.ts:15` `SCREENSHOTS_DIR = path.join(__dirname, "screenshots")` → derive from `config.screenshotsDir`.
    - `add.ts:524` and `add.ts:538` — the stored literal `screenshots/${id}.png` (keep the stored string, but ensure the actual file write target is under `screenshotsDir`).
    - `server.ts:227-230` `handleScreenshot` — `absPath = path.join(__dirname, relPath); fs.mkdirSync; fs.writeFileSync(absPath, buf)` → write under `screenshotsDir` (this is the manual-upload write site; missing it sends uploads to the app tree).
    - `server.ts:172` — the delete handler `path.join(__dirname, removed.screenshot)` unlink → resolve under `screenshotsDir`.
    - `server.ts:233` — stores `screenshot: relPath` (keep relative).
  - [ ] **Static serving:** screenshots now live OUTSIDE `__dirname`, so the existing `@fastify/static` root (`server.ts:249-254`) no longer serves them. Add serving for `screenshotsDir` at prefix `/screenshots/` so the frontend's `/screenshots/foo.png` URL still resolves. **Do NOT register `@fastify/static` a second time naively — it throws** (`decorateReply`/`sendFile` already decorated). Either pass `decorateReply: false` on the second registration, or add a plain `GET /screenshots/*` route that streams the file from `screenshotsDir`. Document which.
- [ ] **Task 5 — Wire tests + verify green** (AC: 3)
  - [ ] Add the new test to the `test` script; run `npm test`; confirm green + existing suites unaffected.

## Dev Notes

### What this story changes vs preserves (read before coding)

- **`config.ts` (UPDATE from Story 2.1)** — add `dbPath` + `screenshotsDir` derivation.
- **`db/index.ts` (UPDATE from Story 1.1)** — replace the `// Story 2.2` placeholder DB path with `config.dbPath`.
- **Screenshot paths (UPDATE) — FIVE sites, enumerated in Task 4.** The prototype touches screenshots in five code-tree-relative places: `add.ts:15` (`SCREENSHOTS_DIR`), `add.ts:524`/`538` (stored literal + write), `server.ts:227-230` (manual-upload write), `server.ts:172` (delete unlink), `server.ts:233` (stored path). `@fastify/static` serves `__dirname` so `screenshots/*` is web-served today (`server.ts:249-254`). A dev who only fixes the obvious `SCREENSHOTS_DIR`/static-root sites will **split** screenshots (captures → DATA_DIR, manual uploads → app tree) and 404 served assets. Fix all five.
- **Stored path stays RELATIVE — this is settled by 1.5, not an open decision.** Story 1.5 commits rows with `asset.path = "screenshots/<id>.png"` (relative); the frontend builds URLs as `/${b.screenshot}` (`index.html:1979-1980`). Keep relative; resolve under `config.screenshotsDir`; serve at prefix `/screenshots/`. This is the zero-migration path — existing/imported rows and the frontend contract both survive untouched.
- **Static-register crash:** registering `@fastify/static` twice without `decorateReply:false` throws at boot (the plugin already decorated `reply.sendFile`). Use `decorateReply:false` on the second root, or a plain `GET /screenshots/*` stream route. (Epic 6's capture-adapter rewrite further owns screenshot writes; here, just root them under DATA_DIR and keep serving working.)
- **`.gitignore` already ignores `screenshots/`, `bookmarks.json`, `library.json`** (recon) — once data lives under `DATA_DIR`, those code-tree paths become legacy. Don't delete the gitignore lines (the importer in 1.5 still reads the legacy flat files from wherever they are), but the new write target is `DATA_DIR`.

### Why this design (anti-pattern prevention)

- **Data separate from code is the upgrade-safety guarantee (FR-21/NFR-6).** If the DB or screenshots live in the app tree, a `git pull` / `npm ci` / container rebuild can wipe them. Rooting under `DATA_DIR` (a mounted volume in the container/LXC) is what makes the data "a plain SQLite file + screenshots the user can copy and walk away with." [Source: docs/bmad/PRD.md#FR-21, #NFR-6]
- **Create the dir; don't make the user pre-make it.** Zero-config first-run (UJ-3) means boot must succeed against a fresh empty `DATA_DIR`. `mkdir -p` on boot. [Source: docs/bmad/PRD.md#NFR-4]
- **Store portable asset paths.** Prefer storing `asset.path` relative to `DATA_DIR` (or to `screenshotsDir`) so the data dir is relocatable — absolute paths break the "copy and walk away" portability. Document and test the choice. [Source: docs/bmad/PRD.md#NFR-6]
- **One ensure-dir, one path source.** Don't scatter `path.join(DATA_DIR, ...)` across modules; derive once in config so Epic 11's container/LXC volume mount has a single contract.

### Project Structure Notes

- Paths derived in `config.ts`; `screenshotsDir` consumed by capture (Epic 6) + static serving (`server.ts`). 
- ESM `.js` specifiers; `node:test`; add the test to the `test` script.

### Testing standards

- Temp `DATA_DIR` under `os.tmpdir()`; assert derivation + dir creation; never write into the real data dir.
- Assert NO data path resolves into the app source tree (AC 3 — the regression this story prevents).
- **Add a `DATA_DIR`/`screenshotsDir` injection seam the `inject()` tests can use.** Today `buildServer()` takes no args and screenshots resolve from `__dirname`; once they're config-driven, `server.test.ts`'s existing "passes visual guard" screenshot test (`server.test.ts:145-163`) posts a real base64 dataUrl that triggers `fs.writeFileSync` (`server.ts:230`) — without a temp-dir seam it would write into the default `DATA_DIR`. **Retrofit that test to a temp `screenshotsDir`** (AC 5) and **add the `/screenshots/<file>` 200 serving assertion** (AC 4 — committed, not "if practical").
- Existing suites stay green.

### References

- [Source: docs/bmad/PRD.md#FR-21] — data (SQLite + screenshots) under a persistent `DATA_DIR` separate from code.
- [Source: docs/bmad/PRD.md#NFR-6] — portability: plain SQLite file + screenshots the user can copy.
- [Source: docs/bmad/PRD.md#NFR-4] — zero-config first-run (create the dir, don't require pre-setup).
- [Source: add.ts#15,#524,#538] — prototype `SCREENSHOTS_DIR` + the stored-literal/write sites to repoint.
- [Source: server.ts#172,#227-230,#233] — delete-unlink, manual-upload write, and stored-path sites (all `__dirname`-relative) to repoint.
- [Source: server.ts#249-254] — `@fastify/static` serving `__dirname` (incl. screenshots) — must follow the screenshots to `DATA_DIR` (mind the double-register crash).
- [Source: index.html#1979-1980] — frontend `shotSrc` builds `/${b.screenshot}` → the `/screenshots/` URL contract the relative stored path must keep satisfying.
- [Source: docs/bmad/stories/1-5-flat-json-importer.md] — already commits `asset.path = "screenshots/<id>.png"` (relative); this story adopts that, doesn't re-decide it.
- [Source: server.test.ts#145-163] — the existing screenshot test whose write target must be retrofitted to a temp dir.
- [Source: docs/bmad/stories/2-1-env-config-loader.md] — the config loader this story extends with path derivation.
- [Source: docs/bmad/stories/1-1-sqlite-drizzle-schema.md] — the `// Story 2.2` DB-path placeholder resolved here.

## Dev Agent Record

### Agent Model Used

_(to be filled by dev agent)_

### Debug Log References

### Completion Notes List

### File List
