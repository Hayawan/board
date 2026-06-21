# board-oss

A lightweight, self-hostable, agent-native curation tool. Evolution of the `board`
prototype: Node/TypeScript + Fastify + SQLite, designed to run on a small Proxmox
LXC (~512MB–1GB RAM).

## Quick start

```bash
npm install
npm run dev          # serves http://127.0.0.1:3141
```

Optional: migrate existing prototype data (`bookmarks.json` / `library.json`) into
SQLite:

```bash
npm run import:flat
```

## Configuration

All settings are environment variables with safe defaults (see `.env.example` for
the full annotated list). Empty/whitespace values are treated as unset.

| Var | Default | Meaning |
|---|---|---|
| `PORT` | `3141` | Listen port. |
| `HOST` | `127.0.0.1` | Bind address. **Localhost-only by default** (see Security). |
| `DATA_DIR` | `./data` | Persistent data root (SQLite DB + screenshots). |
| `CHROME_PATH` | autodetect | System Chromium/Chrome binary; autodetected on Linux when unset. |
| `LLM_AGENT` / `LLM_MODEL` / `LLM_BASE_URL` / `LLM_API_KEY` | unset | LLM provider. **Unset = no-AI** (enrichment disabled). |

## Security & the reverse-proxy model

**board-oss v1 ships no built-in authentication — this is deliberate** (the
reverse-proxy-only auth model, AD7). The security posture is:

- **Localhost bind by default.** The server binds `127.0.0.1` unless you set an
  explicit, non-empty `HOST`. There is no other path to a non-localhost bind, and
  exposing the port logs a boot warning.
- **Put a reverse proxy in front for auth/TLS.** To expose board-oss beyond
  localhost, set `HOST=0.0.0.0` (or bind to a private interface) **and** front it
  with a reverse proxy that provides authentication and TLS — e.g.
  **Caddy + Authelia**, or a **Tailscale** tailnet. Do not expose `0.0.0.0`
  expecting app-level auth; there is none.
- **The internal capture contract is token-authed even on localhost** (Epic 6), so
  the security model stays coherent regardless of bind address.

> ⚠️ If you set `HOST` to a non-localhost address, board-oss logs a one-line
> warning at boot reminding you to put a reverse proxy / firewall in front.

`oslo` + `argon2` (app-level auth) are reserved for a future v2; v1's auth story is
the reverse proxy.

## Self-hosting on a Debian LXC (systemd)

One command on a fresh Debian LXC (run as root, from the repo root):

```bash
sudo bash scripts/install-lxc.sh
```

It installs Node LTS + apt `chromium`, creates a non-root `boardoss` service user,
installs the app to `/opt/board-oss` with a persistent `DATA_DIR` at
`/var/lib/board-oss`, installs + starts the `board-oss` systemd unit
(`deploy/board-oss.service`), and waits for `/healthz`. Tunables via env:
`APP_DIR`, `DATA_DIR`, `PORT`, `APP_USER`.

- **Run mode:** the service runs `node --import tsx server.ts` (no build step; `tsx`
  + `typescript` are runtime deps, so `npm ci --omit=dev` keeps them).
- **`better-sqlite3`** uses its prebuilt binary on glibc Linux / Node LTS (no
  compiler needed). If a from-source build is ever required, `apt-get install -y
  build-essential python3` (commented in the install script).
- **Service management:** `systemctl status|restart board-oss`,
  `journalctl -u board-oss -f`.

### Health check

`GET /healthz` → `200 {"ok":true}` — a **pure liveness probe with no DB check** (so
it never flaps during a SQLite WAL checkpoint and trips a restart loop). Used by the
systemd unit and the container healthcheck.

### Reverse proxy (auth + TLS)

The unit binds `127.0.0.1:8080`. To reach board-oss beyond the box, front it with a
reverse proxy that provides auth + TLS — **Caddy + Authelia**, or a **Tailscale**
tailnet. Don't expose the port directly; v1 has no app-level auth (see above).

### Enabling AI (optional)

board-oss runs fully with no AI (enrichment shows a dignified "disabled" state). To
enable analysis, set the provider env on the unit (`Environment=LLM_BASE_URL=…
LLM_API_KEY=… LLM_MODEL=…` or a CLI agent via `LLM_AGENT`) and `systemctl restart
board-oss`.

### Docker

A multi-stage **Debian-slim/glibc** image (not Alpine — `better-sqlite3` + chromium
on musl is an ABI minefield) runs board-oss as a non-root user with chromium baked in.

```bash
docker build -t board-oss .
docker run -d --name board-oss \
  -p 8080:8080 \
  -v board-oss-data:/data \
  board-oss
```

- **Data persists in the `/data` volume** (`DATA_DIR=/data`) — rebuilds/restarts never
  lose data. Mount a host path or named volume.
- **`HOST=0.0.0.0` inside the container** is the one acceptable broad bind: the
  container boundary is the isolation and the published port is what you control. The
  Story 2.4 boot warning still fires by design — **front the published port with a
  reverse proxy** (Caddy+Authelia / Tailscale); don't expose it raw.
- **Chromium** is the apt `chromium` package; capture uses the no-sandbox launch args
  (Story 6.2) so no `--privileged`/`SYS_ADMIN` is needed. `HEALTHCHECK` hits `/healthz`.
- **Enable AI:** pass provider env, e.g. `-e LLM_BASE_URL=… -e LLM_API_KEY=… -e
  LLM_MODEL=…` (or `-e LLM_AGENT=…` for a CLI agent).

CI (`.github/workflows/ci.yml`) runs the unit suite and builds + boots the image,
asserting `/healthz` and a real in-container screenshot capture.

## Portability

Your data is a plain SQLite file plus a `screenshots/` directory under `DATA_DIR` —
copy the directory and walk away. Upgrading the code (a `git pull` / container
rebuild) never touches `DATA_DIR`.
