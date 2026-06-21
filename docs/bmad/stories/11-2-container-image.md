# Story 11.2: Container image

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Epic 11 — Packaging & community-scripts.** Story 2 of 2. Build order: (1) systemd/LXC install + healthz → **(2) container image ◄ this story**. This story provides a container image so a self-hoster preferring Docker can run board-oss with a mounted data volume. *(FR-23.)*

## Story

As a self-hoster preferring Docker,
I want a container image,
so that I can run board-oss with a mounted data volume.

## Acceptance Criteria

1. **The image boots and serves as a NON-ROOT user, Debian-glibc base, with a mounted `/data` volume.**
   **Given** the image (a **Debian-slim/glibc** base — NOT Alpine/musl: `better-sqlite3` + chromium on musl is an ABI/build minefield, and a builder/runtime libc mismatch makes the compiled `.node` fail to load), **When** I run it with a `/data` volume + `CHROME_PATH`, **Then** it boots, serves, and data persists in the volume. **The container runs as a non-root `USER` with a writable `$HOME`/`/tmp`** (chowned `/data`) — root + `--no-sandbox` is the genuinely dangerous combo (NFR-3), and non-root chromium needs a writable home for its user-data-dir or capture crashes with a profile-lock error.

2. **One real capture succeeds in the container — with a CI smoke gate.**
   **Given** the running container, **When** one URL is captured, **Then** it succeeds (chromium with the `--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage` args, Story 6.2). **Add a CI smoke capture** (AC 3) so this — the single most fragile thing (chromium-in-container) — has an automated gate; without it AC 2 regresses silently.

3. **CI builds the image and hits `/healthz`.**
   **Given** CI, **When** it builds the image and starts it, **Then** it hits `/healthz` (Story 11.1) and asserts OK — proving the image boots.

4. **Data persists across container restarts (volume).**
   **Given** the `/data` volume, **When** the container restarts, **Then** the data is still there (DATA_DIR=/data, Story 2.2) — upgrades/restarts don't lose data.

## Tasks / Subtasks

- [ ] **Task 1 — Write the Dockerfile (Debian-glibc, multi-stage, non-root)** (AC: 1, 2)
  - [ ] A multi-stage `Dockerfile` on a **Debian-slim/glibc** base for BOTH stages (do NOT use Alpine/musl — `better-sqlite3` ABI + musl chromium pain; a glibc-builder/musl-runtime mismatch makes the `.node` fail to load). `npm ci --omit=dev`, apt-install `chromium` + its libs, set `DATA_DIR=/data`, `CHROME_PATH`. 
  - [ ] **Add a non-root `USER`** + `chown` `/data` and a writable `$HOME`/`/tmp` to it (root + `--no-sandbox` = footgun; non-root chromium needs a writable home or profile-lock crash). Expose the port; `VOLUME /data`.
  - [ ] `HOST=0.0.0.0` inside the container (the container boundary is the isolation; the published port + host reverse proxy is the real control). **Story 2.4's mandatory boot warning STILL FIRES by design** — do NOT suppress it; it correctly warns the operator who publishes the port without a proxy. Reference 2.4 AC 5.
  - [ ] Build `better-sqlite3` in the builder stage (prefer its prebuilt binary — may skip the builder entirely if the prebuild lands); slim runtime stage.
- [ ] **Task 2 — Verify capture works in-container** (AC: 2)
  - [ ] Chromium in a container needs `--no-sandbox` (already in the launch args, Story 6.2) + enough `/dev/shm` or `--disable-dev-shm-usage` (already set). Verify one real capture succeeds; document any extra container caps needed (e.g. `--cap-add=SYS_ADMIN` is the alternative to `--no-sandbox` — prefer the no-sandbox args already present).
- [ ] **Task 3 — CI: build + healthz + smoke capture** (AC: 2, 3)
  - [ ] A CI job builds the image, runs it, waits for boot, `curl`s `/healthz`, asserts OK. **Add a smoke capture** (capture one URL, assert success) so chromium-in-container — the most fragile piece — has an automated gate (AC 2). Without it AC 2 is unverified by CI and regresses silently.
- [ ] **Task 4 — Docs: run command + volume** (AC: 1, 4)
  - [ ] Document the `docker run` (volume mount `/data`, port publish, `CHROME_PATH`, provider env to enable AI). Note data persistence via the volume.

## Dev Notes

### What this story changes vs preserves (read before coding)

- **NEW `Dockerfile` + CI build job.** Architecture §8/PRD §Deployment: "optional container image." The LXC script (11.1) is the primary distribution; the image is the Docker-preferring alternative.
- **Reuses everything env-driven (Epic 2).** `DATA_DIR=/data`, `CHROME_PATH`, `HOST`/`PORT` — the image just sets the env + mounts the volume. Same app, different package.
- **`HOST=0.0.0.0` inside the container is the ONE place it's acceptable** — the container boundary is the isolation, and the published port is what the host/reverse-proxy controls. Document why this doesn't violate Story 2.4's localhost-default (it's the container's internal bind; the host still fronts it with a reverse proxy). This is a deliberate, documented exception.
- **`better-sqlite3` native build** — multi-stage Dockerfile (build deps in a builder stage, slim runtime) so the final image isn't bloated with build tools.

### Why this design (anti-pattern prevention)

- **Data in a mounted volume (FR-23/NFR-6).** `DATA_DIR=/data` mounted as a volume → data survives container rebuilds/upgrades (the portability guarantee). A container writing data to its own layer loses it on rebuild. [Source: docs/bmad/stories/2-2-data-dir-paths.md, docs/bmad/PRD.md#NFR-6]
- **CI hits /healthz (the boot proof).** The one place a real container boot is tested — CI builds + starts + `/healthz`. This catches "the image doesn't even boot" before users do. [Source: docs/bmad/PRD.md#FR-23]
- **Reuse the no-sandbox launch args (Story 6.2).** Chromium-in-container is the classic footgun; the `--no-sandbox --disable-dev-shm-usage` args (already in the launch, Story 6.2) handle it. Don't reach for `--privileged`/`SYS_ADMIN` if the no-sandbox path works. [Source: docs/bmad/stories/6-2-url-screenshot-adapter.md]
- **Slim image (NFR-1).** Multi-stage build, system chromium (not a bundled puppeteer download), `--omit=dev` — keep the image lean for the small-host audience. [Source: docs/bmad/architecture.md#1, #2]

### Project Structure Notes

- `Dockerfile` (multi-stage), a CI workflow (build + healthz). Reuses the env config (Epic 2) + `/healthz` (11.1).
- The image is validated by CI (build + boot + healthz), not node:test.

### Testing standards

- The image's "test" is the CI build + boot + `/healthz` check (AC 3) + a manual one-capture verification (AC 2).
- The app's unit suite already covers the logic; the image story is about the package booting + persisting.
- Existing suites green (no app-code change beyond what 11.1 added).

### References

- [Source: docs/bmad/PRD.md#FR-23] — packaging; optional container image with mounted data volume; CI builds + hits /healthz.
- [Source: docs/bmad/PRD.md#Deployment] — optional container image.
- [Source: docs/bmad/architecture.md#8] — E9 packaging; container image.
- [Source: docs/bmad/architecture.md#1,#2] — slim footprint; system chromium.
- [Source: docs/bmad/stories/2-2-data-dir-paths.md] — DATA_DIR=/data volume.
- [Source: docs/bmad/stories/2-4-localhost-bind-reverse-proxy.md] — the localhost-default (and why container HOST=0.0.0.0 is a documented exception).
- [Source: docs/bmad/stories/6-2-url-screenshot-adapter.md] — the no-sandbox launch args for container chromium.
- [Source: docs/bmad/stories/11-1-systemd-lxc-install-healthz.md] — the `/healthz` CI hits.

## Dev Agent Record

### Agent Model Used

_(to be filled by dev agent)_

### Debug Log References

### Completion Notes List

### File List
