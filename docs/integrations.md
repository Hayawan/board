# Integrations — send captures to board-oss

Every capture in board-oss is just an HTTP call, so any app, script, shortcut, or
agent can drop a link into your **Inbox** (or straight onto a specific board). There
are three entry points; pick by how the client authenticates.

Examples assume the dev default `BASE=http://127.0.0.1:3141`. Swap in your
reverse-proxy URL when the instance is exposed.

---

## 1. The v1 API (recommended) — token-authed

The gated, cross-origin-friendly surface. Best for extensions, scripts, and agents.

```bash
curl -sS -X POST "$BASE/api/v1/items" \
  -H "Authorization: Bearer $BOARD_API_TOKEN" \
  -H "content-type: application/json" \
  -d '{"url":"https://example.com"}'
```

- **`{"url": "...", "boardId": "..."}`** — JSON. `url` is required. Omit `boardId`
  (or leave it blank) and the item lands in the **Inbox**; pass a board id
  (`inbox`, `library`, `inspiration`, or any composed board's id) to target it.
- **Auth:** requires `Authorization: Bearer $BOARD_API_TOKEN`. The v1 surface is
  **fail-closed** — if `BOARD_API_TOKEN` is unset on the server, every v1 request is
  rejected with `401`. Set it to turn the API on.
- **Response:** `201` with the created item, which starts in a `pending` state —
  capture (and AI enrichment, if configured) run asynchronously. Subscribe to
  `GET /events` (SSE) to see it flip to `done`. An unknown `boardId` or missing
  `url` returns `400`.
- **CORS** is enabled on the v1 plugin, so browser extensions and other origins can
  call it directly.

## 2. The share target — no auth, dead simple

The PWA's share endpoint, usable as a generic "save this link" webhook.

```bash
curl -sS -X POST "$BASE/share" \
  -H "content-type: application/x-www-form-urlencoded" \
  --data-urlencode "url=https://example.com"
```

- **Form-encoded** `url=...`. It also accepts `text=` / `title=` and extracts the
  first `http(s)` URL it finds — that's how a phone's share sheet posts shared text.
- **Always lands in the Inbox.** Returns a tiny HTML confirmation page (it is built
  for the OS share sheet), so treat it as fire-and-forget.
- **No token.** It relies on board-oss's deployment posture (see *Auth & exposure*).

## 3. The same-origin collections route

What the web app itself uses; handy for same-host scripts that want to target a
specific board by id.

```bash
curl -sS -X POST "$BASE/api/collections/inbox/items" \
  -H "content-type: application/json" \
  -d '{"url":"https://example.com"}'
```

- **`{"url": "..."}`** → the board named in the path (`inbox`, `library`, …).
- **No token** (same-origin / reverse-proxy posture).

---

## Auth & exposure

board-oss ships **no built-in app auth** by design (localhost bind by default,
reverse-proxy-only auth — see the README's *Security* section). What that means for
integrations:

- The **`BOARD_API_TOKEN` bearer on `/api/v1`** is the one built-in gate. Keep it set.
- **`/share` and `/api/collections` are unauthed.** On a localhost-only box that is
  fine. If you expose the instance, your reverse proxy (Caddy + Authelia, a Tailscale
  tailnet, …) is what carries auth for those open routes.
- Captures of **private / loopback / link-local** addresses are blocked (SSRF
  denylist), so an integration can't steer board-oss at your internal network.

## Recipes

- **Shell alias** (v1):
  ```bash
  board() { curl -sS -X POST "$BASE/api/v1/items" \
    -H "Authorization: Bearer $BOARD_API_TOKEN" \
    -H "content-type: application/json" -d "{\"url\":\"$1\"}" ; }
  # board https://example.com
  ```
- **Phone:** install board-oss as a PWA (Add to Home Screen) and use the system
  **share sheet** → it posts to `/share`. Or build an iOS Shortcut / Android intent
  that `POST`s to `/api/v1/items` with your token.
- **Bookmarklet:** the server serves a ready-made one at **`GET /bookmarklet`** —
  open it, paste your `BOARD_API_TOKEN`, and drag the button to your bookmarks bar.
- **Agents / MCP:** the same `/api/v1` contract is the seam. An agent-as-primary
  surface (e.g. an MCP adapter) is a planned addition, not yet shipped — but the
  typed contracts are already shaped for it.
