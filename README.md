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
the reverse proxy. Packaging (systemd / LXC / container) docs land in Epic 11.

## Portability

Your data is a plain SQLite file plus a `screenshots/` directory under `DATA_DIR` —
copy the directory and walk away. Upgrading the code (a `git pull` / container
rebuild) never touches `DATA_DIR`.
