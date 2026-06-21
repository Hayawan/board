# Story 11.1: Systemd / LXC install + healthz

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Epic 11 — Packaging & community-scripts.** One-command self-host on a Debian LXC, plus an optional container image and a healthcheck. *(FR-23, NFR-1, NFR-3.)*
>
> **Story 1 of 2 in Epic 11.** Build order: **(1) systemd / LXC install + healthz ◄ this story** → (2) container image. This story: a one-command LXC install with a systemd service running on boot as a non-root user, plus a `/healthz` endpoint. *(FR-23.)*

## Story

As a self-hoster,
I want a one-command LXC install with a systemd service,
so that board-oss runs on boot as a non-root user.

## Acceptance Criteria

1. **The production run mode is DECIDED so `npm ci --omit=dev` yields a runnable tree.**
   **Given** the prototype's only run path is `tsx server.ts` and **`tsx` is a devDependency**, **When** `npm ci --omit=dev` strips devDeps, **Then** the install must still produce a runnable server. DECIDE here (not defer): either (i) move `tsx` + `typescript` to `dependencies` (simplest — `--omit=dev` keeps them; document the footprint), OR (ii) add a `build` step (`tsc`/`esbuild` → `dist/`, run BEFORE `--omit=dev`) and `ExecStart=node dist/server.js` (note: `.ts`→`.js` ESM specifier rewrite needed). The systemd `ExecStart` (Task 4) and AC 1 must name the chosen mode — they are currently mutually contradictory until decided.

2. **The install script provisions Node LTS + deps + chromium + a service user.**
   **Given** a Debian LXC, **When** the install script runs, **Then** it installs Node LTS, runs `npm ci --omit=dev`, installs **`chromium`** via apt (Debian package — NOT Ubuntu's `chromium-browser`, which is a snap shim that breaks headless launch; the Debian `chromium` package declares its own lib deps so a bare `apt-get install -y chromium` suffices), and creates a non-root service user. **`better-sqlite3`: prefer the prebuilt binary** (it ships prebuilds for glibc Linux/Node LTS — usually no compile); apt-install `build-essential python3` only as a documented from-source fallback.

3. **A systemd unit runs the server on boot on a persistent `DATA_DIR`.**
   **Given** the install, **When** the box boots, **Then** a systemd unit starts the server as the non-root user, with a persistent `DATA_DIR` (Story 2.2), bound to localhost. *(Note: the unit's `Environment=HOST/PORT/DATA_DIR` are INERT unless Stories 2.1/2.4 have shipped — today `server.ts:333` hardcodes the bind. This story's unit assumes the Epic 2 config seam exists; flag the sequencing dependency.)*

4. **`/healthz` is a PURE LIVENESS probe (no DB) returning 200.**
   **Given** the running server, **When** `GET /healthz` is called, **Then** it returns a cheap 200 `{ ok: true }` with **NO DB check**. *(A DB-reachable check makes it a READINESS probe that flaps during a WAL checkpoint / long write → systemd restart loop. If a DB-reachable check is wanted, it's a SEPARATE `/readyz`, not `/healthz`.)*

5. **The unit binds localhost; docs cover the reverse proxy.**
   **Given** the systemd unit, **When** it runs, **Then** it binds `127.0.0.1` (Story 2.4 default); the docs cover the reverse-proxy story (Caddy/Authelia/Tailscale).

6. **A test asserts `/healthz` returns OK.**
   **Given** the server, **When** `GET /healthz` is `inject()`ed, **Then** it returns 200/OK. (The install script itself is validated by CI/manual on a real LXC — see Testing standards.)

## Tasks / Subtasks

- [x] **Task 1 — Write the failing /healthz test first (TDD)** (AC: 4, 6)
  - [x] In `server.test.ts`: `inject()` `GET /healthz` → assert 200/OK + `{ok:true}` + that no DB query ran. Run; confirm red (no route yet).
- [x] **Task 2 — Add the `/healthz` route (pure liveness, no DB)** (AC: 4, 6)
  - [x] Add `GET /healthz` to `buildServer` (`server.ts:246`) returning a cheap 200 `{ ok: true }` — NO DB check (that would make it a readiness probe that flaps on WAL checkpoints). If a DB-reachable check is wanted later, add a separate `/readyz`.
- [x] **Task 3 — Write the LXC install script** (AC: 1, 2, 4)
  - [x] A `scripts/install-lxc.sh` (community-scripts.org norms): install Node LTS, `npm ci --omit=dev`, install `chromium` + the puppeteer/headless deps (the apt libs Chromium needs), create a non-root service user, set up `DATA_DIR` (persistent, owned by the service user), install the systemd unit. Idempotent where possible.
  - [x] `CHROME_PATH` resolves to the apt chromium (Story 2.3 autodetect handles `chromium`/`chromium-browser`).
- [x] **Task 4 — Write the systemd unit (ExecStart matches the AC-1 run mode)** (AC: 3, 5)
  - [x] A systemd unit whose `ExecStart` matches the DECIDED run mode (AC 1): `tsx server.ts` (if tsx moved to deps) OR `node dist/server.js` (if a build step). Run as the non-root user, `Environment=DATA_DIR=... HOST=127.0.0.1 PORT=...` (effective only once Stories 2.1/2.4 ship the config seam), `Restart=on-failure`, `WantedBy=multi-user.target`. Document.
- [x] **Task 5 — Docs: install + reverse proxy** (AC: 4)
  - [x] README/docs: the one-command install, the reverse-proxy story (Story 2.4), the env config table (Story 2.1), how to enable AI (provider config). Targets community-scripts.org.
- [x] **Task 6 — Wire tests + verify green** (AC: 5)
  - [x] Add the `/healthz` test to the `test` script; run `npm test`; confirm green + existing suites unaffected.

## Dev Notes

### What this story changes vs preserves (read before coding)

- **NEW `scripts/install-lxc.sh` + a systemd unit + `/healthz` route.** Architecture §8/PRD §Deployment: Node LTS + `npm ci --omit=dev` + systemd (non-root) + persistent `DATA_DIR` + `/healthz` + reverse proxy; targets community-scripts.org.
- **Depends on the whole app being env-configurable (Epic 2).** `DATA_DIR` (2.2), `HOST`/`PORT` (2.1/2.4), `CHROME_PATH` autodetect (2.3) — packaging is where these pay off. The install is just "set the env + run as a service."
- **Production run mode decision.** The prototype runs via `tsx` (`package.json` `dev: tsx server.ts`). Decide v1 production: keep `tsx` (simplest, ship `tsx` in deps not devDeps) OR add a `tsc`/`esbuild` build step → `node dist/server.js`. Document. (Simplest path: `tsx` in production deps; revisit if footprint demands a build.)
- **Native module note:** `better-sqlite3` (Story 1.1) is a native module — the install must build it (needs build tools) or use a prebuilt. Note this in the script (apt `build-essential`/`python3` if building from source).

### Why this design (anti-pattern prevention)

- **Non-root service user (FR-23/NFR-3).** Running as root is a security footgun. The service runs as a dedicated non-root user owning `DATA_DIR`. [Source: docs/bmad/PRD.md#FR-23, #NFR-3]
- **Persistent DATA_DIR separate from code (FR-21).** The systemd unit points `DATA_DIR` at a persistent path so `npm ci` / upgrades don't nuke data (Story 2.2). [Source: docs/bmad/stories/2-2-data-dir-paths.md]
- **Localhost bind + reverse proxy (NFR-3/AD7).** The unit binds `127.0.0.1` (Story 2.4 default); auth/TLS is the reverse proxy's job. Don't bind `0.0.0.0` in the unit. [Source: docs/bmad/stories/2-4-localhost-bind-reverse-proxy.md]
- **`/healthz` cheap + reliable.** The install check + container/LXC liveness probe — keep it a cheap 200, optionally a DB-reachable check, never an expensive operation. [Source: docs/bmad/PRD.md#FR-23]
- **Chromium from apt, not bundled (NFR-1).** `puppeteer-core` → system chromium (architecture §2); the install apt-installs chromium + its libs. Don't bundle a Chromium download (footprint). [Source: docs/bmad/architecture.md#2]

### Project Structure Notes

- `scripts/install-lxc.sh`, a `.service` unit file, `/healthz` in `server.ts`. Docs in README.
- ESM `.js` specifiers; `node:test` for `/healthz`; the install script is shell (validated on a real LXC / CI, not node:test).

### Testing standards

- `/healthz` is unit-tested via `inject()` (200/OK).
- The install script + systemd unit are validated by a real-LXC run / CI (Story 11.2's CI hits `/healthz`); document the manual verification steps.
- Existing suites green.

### References

- [Source: docs/bmad/PRD.md#FR-23] — packaging; Debian LXC, Node LTS + `npm ci` + systemd, non-root, persistent data, `/healthz`; community-scripts.org.
- [Source: docs/bmad/PRD.md#Deployment] — install shape (Node LTS + npm ci --omit=dev + systemd + persistent DATA_DIR + reverse proxy + /healthz).
- [Source: docs/bmad/architecture.md#8] — implementation sequence; E9 packaging.
- [Source: docs/bmad/architecture.md#2] — puppeteer-core → system chromium (apt, not bundled).
- [Source: docs/bmad/stories/2-1-env-config-loader.md], [Source: docs/bmad/stories/2-2-data-dir-paths.md], [Source: docs/bmad/stories/2-4-localhost-bind-reverse-proxy.md] — the env config the unit sets.
- [Source: docs/bmad/stories/2-3-chrome-path-resolution.md] — CHROME_PATH autodetect for apt chromium.
- [Source: docs/bmad/stories/1-1-sqlite-drizzle-schema.md] — `better-sqlite3` native-module build note.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (BMAD dev-story workflow)

### Debug Log References

- `npm test` → 319 pass / 0 fail (318 prior + 1 /healthz). No pollution.
- Production-mode smoke: `node --import tsx server.ts` boots + `GET /healthz` → `{"ok":true}` (manual). `bash -n scripts/install-lxc.sh` clean.

### Completion Notes List

- ✅ All 6 ACs satisfied (install script + unit validated by syntax-check + the production-mode smoke; full LXC run is the documented manual/CI check, hit by 11.2's CI).
- **AC1 run-mode DECISION: keep `tsx` at runtime (no build step).** Moved `tsx` + `typescript` devDeps → **dependencies**, so `npm ci --omit=dev` yields a runnable tree. Added `npm start` = `node --import tsx server.ts`; systemd `ExecStart` matches. (Already in the tree — a move, not a new install, so no Socket gate.)
- **AC4 `/healthz` — PURE LIVENESS, no DB:** `app.get('/healthz', () => ({ ok: true }))`. No DB check (would flap on a WAL checkpoint → restart loop; `/readyz` is the place for that). Tested via `inject()` on opt-less `buildServer()` (no `data/` pollution → proves no DB touch).
- **`scripts/install-lxc.sh`** (community-scripts norms): Node LTS, apt `chromium` (Debian pkg, NOT the Ubuntu snap shim), non-root `boardoss` user, app → `/opt/board-oss`, persistent `DATA_DIR` `/var/lib/board-oss` (separate from code), installs + `enable --now` the unit, polls `/healthz`. better-sqlite3 prebuilt (build-essential/python3 = documented fallback).
- **`deploy/board-oss.service`** — `ExecStart=env node --import tsx server.ts`, non-root, `Environment=HOST=127.0.0.1/PORT=8080/DATA_DIR=…` (Epic 2 seam — shipped, so effective), `Restart=on-failure`, hardening (`NoNewPrivileges`/`ProtectSystem=strict`/`ProtectHome`/`PrivateTmp`/`ReadWritePaths`), `WantedBy=multi-user.target`. CHROME_PATH autodetects (2.3).
- **AC5:** unit binds `127.0.0.1` (2.4); README documents Caddy+Authelia / Tailscale + env table + enabling AI.

### File List

- `server.ts` (modified) — `GET /healthz` pure-liveness route.
- `server.test.ts` (modified) — `/healthz` inject test.
- `scripts/install-lxc.sh` (new) — one-command Debian LXC install.
- `deploy/board-oss.service` (new) — systemd unit (non-root, hardened, localhost).
- `package.json` (modified) — `tsx`/`typescript` → dependencies; `start` script.
- `README.md` (modified) — self-host + healthz + reverse-proxy + enable-AI docs.

### Change Log

- 2026-06-20 — Story 11.1 implemented: `/healthz` + LXC install script + systemd unit + docs. Run mode = tsx at runtime. Status → review.
