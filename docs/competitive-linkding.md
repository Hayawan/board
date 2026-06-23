# Competitive analysis — linkding

> Feature inventory of [linkding](https://linkding.link/) and a head-to-head against `board-oss`.
> Compiled 2026-06-23 from linkding's docs (`linkding.link`, `github.com/sissbruecker/linkding`) and the current `board-oss` codebase.
> Complements `research.md` §3 (Karakeep / Linkwarden), which omitted linkding — the most popular *minimalist* self-hosted bookmark manager and the closest competitor on the **"light footprint"** axis.

---

## 0. One-line positioning

- **linkding** — a fast, minimal, **tag-based bookmark manager** for *retrieval at scale*. Mature (since 2019), broad feature surface, single Docker container, multi-user, full REST API + browser extensions. Stores **what** you saved so you can find it later.
- **board-oss** — an **opinionated, AI-curating board app** for *taste-making*. A visual inspiration grid + design-takeaway enrichment + **board-generating** composer (NL → typed board). Stores a **judgment** about what you saved.

They overlap on "self-hosted, SQLite, save-a-URL" and diverge on almost everything else. linkding is **breadth + maturity**; board-oss is **opinion + generativity**.

---

## 1. Full linkding feature inventory

### Data model — the bookmark
A bookmark is a fixed record: `url`, `title`, `description`, `notes` (Markdown), `tag_names[]`, plus three boolean states: `is_archived`, `unread`, `shared`. Auto-scraped `favicon_url` and `preview_image_url`. Timestamps `date_added` / `date_modified`. **One flat schema for everyone** — no custom fields, no per-collection shape.

### Capture & metadata
- Save a URL; linkding **auto-scrapes title, description, favicon, and OpenGraph preview image**.
- Scraping can be disabled per-request (`disable_scraping`).
- Configurable favicon provider (`LD_FAVICON_PROVIDER`, default Google; DuckDuckGo documented).
- **No content extraction / reader view / AI** — metadata only.

### Organization
- **Tags** — the primary (only) organizing primitive. Tag autocomplete on entry.
- **Auto-tagging rules** — profile-defined `url-pattern → tags` mappings. Matches on hostname (subdomain-aware), path (prefix), query params, and fragment. No wildcards; URL-only (not content). Previewed in the form and the extension. Applied on every create *and* update.
- **Bundles** — saved smart-filters: a named combination of `search` text + `any_tags` + `all_tags` + `excluded_tags`, ordered. Effectively reusable saved searches / virtual collections. Full CRUD via API.
- **"untagged"** is a first-class filter.

### Search
- Full **boolean expression engine** (since v1.44): words, `"exact phrases"`, `#tags`, `and` / `or` / `not`, and `( )` grouping. Implicit `and` between bare terms. Case-insensitive. Backed by SQLite **FTS5**.
- Searches across title, description, notes, and URL.
- **`lax` vs `strict` tag mode** (setting): in lax mode the `#` prefix is optional and a word matches both content and tags.
- Legacy search engine retained as a fallback toggle.

### Read-later / states
- **`unread`** flag = "read it later." Filterable; surfaced in the UI and API.
- **`shared`** flag = expose to other users / public feed.
- **`is_archived`** = soft-archive (out of the main list, still searchable via the archived view).

### Notes
- Per-bookmark **Markdown notes**. `permanent_notes` setting renders notes always-visible in the list; otherwise toggled with the `e` shortcut.

### Bulk editing
- In-UI bulk edit: select many → add/remove tags, archive/unarchive, mark read/unread, delete.
- Django **admin app** adds heavier bulk ops + filtering by user/archived/tags, and tag cleanup ("delete unused tags").

### Archiving / snapshots / assets
- **Server-side HTML snapshots** via `singlefile-cli` + headless Chromium (the `latest-plus` Docker image only; ~1GB RAM, no ARMv7). Loads uBlock Origin Lite. PDFs are downloaded as-is.
- **Internet Archive Wayback** integration — stores a `web_archive_snapshot_url` per bookmark.
- **SingleFile browser-extension** path — upload a client-rendered snapshot to `/api/bookmarks/singlefile/` (captures exactly what *you* see; bypasses server anti-bot problems).
- **Arbitrary file assets** per bookmark (`asset_type: snapshot | upload`) — upload/download/list/delete via API.

### Sharing & multi-user
- **Multiple users** in one instance (admin-managed).
- **`enable_sharing`** — share bookmarks with other logged-in users.
- **`enable_public_sharing`** — expose shared bookmarks publicly (no login).
- A shared-bookmarks feed/view across users.

### Import / export / backups
- **Netscape HTML** import *and* export (the browser-bookmarks interchange format) — preserves tags and dates on import.
- **Full backup** CLI (`manage.py full_backup`) → zip of db + assets + favicons + previews. SQL-dump and raw-sqlite paths also documented.
- UI export caveats: own bookmarks only, no snapshots/favicons/profiles.

### REST API (the big one)
Token-auth (per-user token in Settings). Full surface:
- **Bookmarks**: list / list-archived / retrieve / **check** (is-it-bookmarked + scraped metadata + would-be auto-tags) / create / update (PUT/PATCH) / archive / unarchive / delete. List filters: `q`, `limit`, `offset`, `modified_since`, `added_since`, `bundle`.
- **Assets**: list / retrieve / download / upload / delete.
- **Tags**: list / retrieve / create.
- **Bundles**: full CRUD.
- **User profile**: read preferences.
- Documented as the foundation for a real **3rd-party app ecosystem**.

### Browser & device integration
- **Official browser extension** (Firefox + Chrome) — quick-add + address-bar search + auto-tag preview + SingleFile integration.
- **Bookmarklet** (incl. an Android/Chrome workaround).
- **PWA** — installable; registers in Android's native **share sheet**.
- Documented **iOS Shortcut** and **Android HTTP-Shortcuts** share actions.

### Auth & SSO
- Built-in username/password (superuser bootstrapped via `LD_SUPERUSER_*`).
- **OIDC SSO** (full endpoint/claim config, PKCE, configurable username claim).
- **Auth-proxy** mode (header-based, e.g. Authelia/Authentik in front).
- `LD_DISABLE_LOGIN_FORM` for OIDC-only.

### Customization / settings
- **Themes**: auto / light / dark.
- **Custom CSS** field (documented font-size recipe, etc.).
- Per-user prefs: date display (relative/absolute), link target, web-archive integration on/off, tag-search lax/strict, enable favicons, display URL, permanent notes, default search sort + shared/unread filters.

### Keyboard shortcuts
`n` new bookmark · `s` focus search · `↑`/`↓` navigate · `e` toggle notes.

### Stack / deployment / footprint
- **Django + uWSGI**, **SQLite or PostgreSQL** (`LD_DB_ENGINE`).
- **Single Docker container** (`latest`); `latest-plus` adds Chromium for snapshots.
- Reverse-proxy friendly: context path, CSRF trusted origins, X-Forwarded-Host, request size/timeout knobs.
- Background-task processor (toggle/supervisor options).
- Base `latest` image runs comfortably on low-end hardware; `latest-plus` needs ≥1GB for snapshots.
- AGPL-3.0. Large community ecosystem (mobile apps, libraries, extensions, managed hosting).

---

## 2. Head-to-head — linkding vs board-oss

| Capability | linkding | board-oss |
|---|---|---|
| **Core metaphor** | Tag-based bookmark list | Opinionated, typed **boards** (schema-as-data) |
| **Data shape** | One fixed bookmark record | Per-board **descriptor** → arbitrary typed fields (text/number/date/url/enum/tags/image) in a JSON bag |
| **Collections** | Tags + saved **bundles** (virtual) | First-class **boards**, each with its own fields, view, ingest + enrichment lens |
| **Generate a collection from a prompt** | ❌ | ✅ **`compose-board`** — NL description → proposed board descriptor (the thesis feature) |
| **Visual inspiration grid** | ❌ (favicon + small preview thumb) | ✅ full-bleed **screenshot grid** (Inspiration board) |
| **Reader/content extraction** | ❌ (metadata scrape only) | ✅ Readability + turndown → markdown (Library board), Chrome-render fallback |
| **AI enrichment** | ❌ | ✅ **descriptor-driven LLM analysis** — design takeaways, summaries, typed fields; re-enrich; prompt-injection fenced |
| **Auto-tagging** | ✅ URL-pattern rules | ⚠️ LLM `tag` skill, but **no rule engine** |
| **Search** | ✅ boolean expression engine (FTS5) | ✅ FTS5 (literal phrase) + client-side facet filters; **no boolean operators** |
| **Saved searches / smart filters** | ✅ **bundles** | ❌ |
| **Read-later / unread state** | ✅ | ❌ (has `favorite` + `notes`) |
| **Archiving (HTML snapshot / Wayback)** | ✅ SingleFile + Internet Archive + PDF + assets | ❌ (Inspiration stores a screenshot, Library stores extracted markdown — not a fidelity archive) |
| **File assets per item** | ✅ upload/download API | ⚠️ `asset` table + `upload-asset` skill exist, but **manual-upload not wired** into ingest dispatcher |
| **Bulk editing** | ✅ (UI + admin) | ❌ |
| **Import** | ✅ Netscape HTML | ⚠️ flat-JSON importer only (no Netscape HTML) |
| **Export / backup-in-app** | ✅ Netscape HTML + `full_backup` CLI | ❌ **no export** (portability = copy SQLite + screenshots dir) |
| **REST API for 3rd parties** | ✅ broad, documented, token-auth | ⚠️ Fastify routes + generic `/skills/:name`, but **not positioned/documented as a public 3rd-party API**, no API tokens |
| **Browser extension** | ✅ Firefox + Chrome | ❌ |
| **Bookmarklet** | ✅ | ❌ |
| **PWA / mobile share-sheet** | ✅ | ❌ |
| **Keyboard shortcuts** | ✅ `n`/`s`/`↑↓`/`e` | ⚠️ Escape-to-close-modal only (no shortcut system) |
| **Multi-user** | ✅ | ❌ (single-tenant by design) |
| **Sharing / public links** | ✅ user + public sharing | ❌ |
| **Auth / SSO** | ✅ password + **OIDC** + auth-proxy | ❌ **deferred to v2** — reverse-proxy model (binds 127.0.0.1; `oslo`+`argon2` reserved) |
| **Admin panel** | ✅ Django admin | ❌ |
| **Themes** | ✅ auto/light/dark | ✅ light/dark toggle (localStorage + system pref) |
| **Custom CSS** | ✅ user CSS field | ❌ |
| **Stack** | Django + uWSGI, SQLite **or Postgres** | Node/Fastify 5 + better-sqlite3 + Drizzle, **tsx (no build step)** |
| **Capture engine** | server SingleFile/Chromium (plus image) | puppeteer-core / Chromium sidecar, **concurrency=1** + teardown (LXC-tuned) |
| **Footprint** | `latest` tiny; `latest-plus` ≥1GB | single node, ~512MB–1GB; one-command **LXC/systemd** + Docker + Proxmox |
| **License** | AGPL-3.0 | ⚠️ **none declared yet** (no `LICENSE` file / `package.json` license field) |
| **Maturity** | since 2019, large ecosystem | new; v1 backlog in `docs/bmad/stories/` |

Legend: ✅ has it · ⚠️ partial/seam present but not shipped · ❌ absent.

---

## 3. Analysis

### Where linkding decisively wins (and board-oss isn't trying to compete)
**Multi-user, sharing, OIDC SSO, admin panel.** board-oss is single-tenant by deliberate decision (PRD AD7 — auth deferred to v2 behind a reverse proxy). For any team/family/multi-account use case, linkding is simply in a different bracket today.

### Where linkding wins on **table-stakes** board-oss should care about
These aren't philosophical differences — they're maturity gaps a self-hosted bookmark tool is *expected* to have, and their absence is friction:

1. **No browser extension / bookmarklet / PWA.** This is the single biggest *capture-UX* gap. linkding's "save the current tab in two clicks" is the daily-driver loop of a bookmark manager; board-oss currently has **no in-browser add path at all** — you go to the web UI and paste a URL. For an app whose whole value is what happens *after* capture, the capture funnel is conspicuously narrow.
2. **No export.** "Portability = copy the SQLite file" is a developer answer, not a user answer. linkding's Netscape-HTML export (and `full_backup`) is table stakes and a trust signal ("your data isn't trapped"). Cheap to add; high symbolic value for an OSS tool.
3. **No read-later / unread state.** A near-universal bookmark-manager expectation. board-oss has `favorite` but not the triage-oriented unread workflow.
4. **No saved searches / smart collections** (linkding bundles). board-oss has boards, but no *dynamic* collection defined by a query.
5. **No boolean search, no keyboard shortcuts, no Netscape-HTML import.** Smaller, but each is a "linkding just does this" moment.

### Where board-oss decisively wins (the wedge — consistent with `product-brief.md`)
linkding has **zero AI and zero visual-grid**, by design — it's a metadata-and-tags retrieval tool. board-oss's entire reason to exist sits in linkding's blind spot:

1. **Opinionated AI taste** — design analysis + "steal this" takeaways, not just scraped metadata. linkding doesn't interpret a page; it indexes it.
2. **Board-*generating* curation** — `compose-board` turns "make me a board for tracking SaaS pricing pages" into a typed, enriched board. linkding has one fixed schema forever; you cannot ask it for a *shape*.
3. **Visual inspiration wall** — full-bleed screenshots as a browsable canvas, not favicon-sized thumbnails on list rows.
4. **Schema-as-data** — typed per-board fields with descriptor-driven rendering and enrichment, vs linkding's single flat record + free-text tags.

Note this re-confirms the `research.md` §3 finding against Karakeep/Linkwarden: **none of the three incumbents (linkding included) do opinionated AI taste or a designer's moodboard.** linkding is the *lightest* and *most mature* of the field, but also the *least* AI-ambitious — it's the purest expression of "the commodity board-oss is fleeing."

### The honest framing
> linkding is a **better bookmark manager** than board-oss and will be for the foreseeable future — it's mature, multi-user, has the extension/API/sharing ecosystem, and is battle-tested. board-oss is **not a better bookmark manager; it's a different product** — a taste/curation tool that happens to save URLs. The risk is positioning board-oss *as* a bookmark manager (where it loses on breadth) instead of *as* an AI curation surface (where linkding doesn't play).

### Suggested watch-list (parity items, ranked by leverage — not commitments)
1. **Browser extension / bookmarklet** — closes the capture-funnel gap; highest daily-use leverage.
2. **Export** (Netscape HTML or JSON) — cheap, high-trust, table stakes.
3. **Saved/smart boards** (bundle-equivalent: a board defined by a query) — fits the boards model naturally.
4. **Read-later/unread + boolean search + keyboard shortcuts** — incremental polish to not feel primitive next to linkding.
5. **Auth/multi-user** — already correctly deferred to v2; linkding sets the eventual bar (OIDC + auth-proxy).

*Deliberately out of scope to copy:* linkding's tag-only organizing model and metadata-only philosophy — adopting them would erode the board-oss wedge, not strengthen it.
