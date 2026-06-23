# board-oss — Architecture Decision Brief

**Date:** 2026-06-19
**Purpose:** Ground the framework/datastore architecture debate for the open-source, self-hostable successor to `board`.

## The shape of the problem

`board-oss` saves a URL and does two distinctive things:

1. **Captures the page** — full-page screenshot (visual "Inspiration" board) + readable text (a "Library" reading list).
2. **Runs an LLM** to auto-fill structured metadata — design analysis + a "steal this" takeaway + facets for Inspiration; summary / topics / key-points / type for Library.

Prototype today: Node/TS + Fastify + vanilla-JS frontend + flat JSON files.

### Hard constraints (these decide the brief)

- **Lightweight above all.** Target host is a small Proxmox LXC: **~512MB–1GB RAM, 1 vCPU.** Low CPU/RAM is a primary goal, not a nice-to-have.
- **Self-hostable by non-experts**, eventually listable on **community-scripts.org** → one-command Debian LXC install + systemd service.
- **Avoid hand-coding commodity features** (auth, storage, admin UI, REST/realtime API, file/image handling). Lean on a platform for those; spend effort on the distinctive AI-enrichment + boards UX.
- **Needs:** flexible/evolving record schema (each board type has different fields), binary asset storage (screenshots), a web UI, an API, server-side headless-Chrome capture + LLM calls.

---

## ⭐ The finding that reframes everything: Chromium is the binding constraint

Every framework candidate is cheap on RAM. **Headless Chromium is not.** Current figures (Puppeteer/Playwright on constrained hardware):

- **~400MB per browser instance** (core process) **+ ~120MB per page** actively rendering.
- A single full-page capture ≈ **400–520MB resident** while it runs.
- Chrome's "new headless" (112+) trims ~15%, but the floor is still **~200–400MB when rendering a non-trivial page.**

**Implication:** On a 512MB–1GB / 1-vCPU box, the capture engine alone can consume the whole container. The mandatory architecture is **launch Chromium per-job → render → kill immediately → concurrency capped at 1.** A warm browser pool is a non-starter here.

This is true **regardless of framework**, and it has two big consequences for the decision below:

1. The framework's own footprint is almost a rounding error against Chromium. Pick the framework on *fit, license, and how little you hand-code* — not on its idle MB.
2. You want Chromium as a **spawn-and-kill sidecar process**, not running inside your app/request process. So a platform's ability to run Puppeteer *in-process* is **not actually an advantage on this hardware** — in-process Chromium is the thing most likely to OOM your whole instance. This dissolves the headline weakness of the otherwise-best-fitting option (see PocketBase).

---

## 1. Framework / Platform options

| Platform | Lang / runtime | Distribution | Idle RAM | What's free (auth / admin / API / realtime / files) | Custom server logic (Chromium + LLM)? | License | LXC fit (512MB–1GB) | Biggest risk |
|---|---|---|---|---|---|---|---|---|
| **PocketBase** | Go | **Single binary**, no Docker | **~25–30MB** | Auth, admin UI, REST + **realtime (SSE)**, file storage (local/S3), SQLite | **LLM: yes** (JS hooks `$http.send`). **Chromium: not in JSVM** → Go extension or **sidecar** | **MIT** | **Excellent** — binary + systemd | **Pre-1.0** (v0.39.x); occasional breaking migrations |
| **Payload CMS** | TS / Node (installs into Next.js) | Node app + DB (SQLite/PG/Mongo) | low-hundreds MB | Auth, rich admin UI, REST + GraphQL, files (local/S3), **jobs queue**; no first-class realtime | **Yes, fully** — own Node server, `npm i` Puppeteer, no sandbox/timeout; jobs queue for long work | **MIT** | **Good at runtime**; **build-time OOM risk** on 1GB | `next build` can OOM small box; Next.js coupling |
| **Directus** | TS / Node | **Docker** + external DB | 100s of MB; wants ~1.5GB+ | Auth/RBAC, polished Studio admin, REST + GraphQL + realtime, files + transforms, Flows | **Yes** (Node hooks/extensions); but in-process Puppeteer competes for the same scarce RAM | **BSL 1.1 / MSCL** (free < $5M rev) | **Tight** — 1GB is floor; OOM-prone | RAM fit **and** non-OSS license |
| **Appwrite** | PHP core + workers | **Docker Compose, ~15–20 containers** | **~2–3GB** | Auth, console, REST + GraphQL, **realtime**, files + AV, messaging, DB | Functions sandboxed; **Puppeteer painful** (offload to external Browserless); 30s sync / 900s async caps | **BSD-3** (not BSL) | **No** — 2GB hard floor | Does not fit the hardware at all |
| **Supabase** (self-host) | Postgres + Go/Elixir/Deno svcs | **Docker Compose, ~10–12 containers** | **~4GB** | Auth (GoTrue), Studio, REST (PostgREST) + GraphQL, **realtime**, storage, Postgres | Edge Functions = **Deno isolate, no Puppeteer** (docs say call external browser API) | **Apache-2 / permissive** | **No** — ~4GB idle, 8GB recommended | 4×+ over RAM budget |
| **NocoDB** | TS / Node | Single Node app + DB | fits 256MB–1GB | Auth, **rich spreadsheet admin** (grid/kanban/gallery/form), per-table REST + GraphQL, attachment fields | **No** — webhooks + Scripts only; **can't host long-running logic or Chromium** | **Fair-code** (Sustainable Use Lic.) | **Fits**, but… | Capability ceiling: it's a table/API tool, not a backend runtime |
| **Roll-your-own lean** (SvelteKit / Astro / **Hono + SQLite**) | TS / Node (or Deno/Bun) | Node process | **tens of MB** (Hono lightest) | **Routing only** (Hono); SvelteKit/Astro add SSR + API routes. **No auth / admin / file handling** | **Yes, trivially** — plain Node, no sandbox limits | **MIT** | **Excellent** | **You hand-code the commodities** — the exact thing the project wants to avoid |

### Notes per option

- **PocketBase** — One Go binary: auth + admin + auto REST + SSE realtime + file storage + SQLite, ~25–30MB idle. LLM calls are native in JS hooks (`$http.send`). Its "weakness" — no Puppeteer inside the embedded ES5 JSVM — **is moot here**: you wouldn't run Chromium in-process on 1GB anyway. The natural pattern is a tiny **capture sidecar** (Node or Go shelling to Chromium) the backend triggers over HTTP, exactly the launch-per-job/kill model the hardware forces. Pre-1.0 (latest **v0.39.x, June 2026**), MIT, actively maintained.
- **Payload CMS** — v3 installs into a Next.js app; runs as one Node process + a DB (SQLite via Drizzle = fully embedded). MIT (Figma-owned, no rug-pull). Best-in-class for *in-process* custom logic — full Node, jobs queue, no sandbox/timeout — but that strength matters less here given the Chromium-sidecar reality. **Runtime fits; the catch is `next build` memory** on a 1 vCPU/1GB box (mitigate: bump Node heap, or build off-box and ship the standalone artifact). No first-class realtime.
- **Directus** — Strong admin + data modeling + native Node extensions, but Docker-centric, 1GB is the floor before adding Postgres or a Puppeteer job, OOM is a documented pattern, and the **BSL/MSCL license** (free only under $5M revenue, converts to GPLv2 after 3 yrs) is a real consideration for a community OSS tool.
- **Appwrite / Supabase** — Both excluded on RAM alone: Appwrite ~2–3GB idle / 2GB hard floor across ~15–20 containers; Supabase ~4GB idle / 8GB recommended across ~10–12 containers. Both *also* can't run Puppeteer in their function sandboxes (Browserless / external browser API instead). Wrong weight class.
- **NocoDB** — The only heavy-platform that fits the RAM budget, but it's an Airtable-style table/API/admin layer, **not** a place to host headless-Chrome capture or long-running enrichment. Adopting it means bolting on a separate worker anyway — at which point it's just your DB+admin, not your backend.
- **Roll-your-own** — Smallest footprint, total control, trivial Puppeteer (no serverless sandbox: no missing `/dev/shm`, no function timeout, no "Chromium won't fit in the layer"). **But** SvelteKit/Astro give you only SSR + API routes, and Hono only routing — **auth, admin UI, file/asset handling, API plumbing, migrations are all hand-coded.** That is precisely the commodity work the project set out to avoid. The current Fastify + flat-JSON prototype already lives here; moving to SvelteKit/Astro/Hono is a *lateral* move on that axis.

---

## 2. Datastore options

The needs are: **flexible/evolving schema + JSON-ish LLM fields + binary assets (screenshots), on one small node, lightweight above all.**

| Option | Footprint | Flexible schema / JSON fields | Search | Concurrency / durability | Verdict for this project |
|---|---|---|---|---|---|
| **Flat JSON files** (current) | zero deps, but **whole file parsed into RAM** to read/write anything | trivial | none (linear scan in app) | **No locking**; crash = lose whole collection | OK now; **predictably bad** as records accumulate (heap spike per load; torn reads once a processor + server share a file) |
| **Embedded SQLite** ⭐ | **~zero extra process** (~1MB in-process lib, no daemon, no port) | `JSON`/**`JSONB`** column (binary, 3.45+); `json_extract`/`->>`; **generated-column / expression indexes** at full B-tree speed | **FTS5** (BM25 ranking, highlight) | **WAL**: concurrent readers + 1 writer; ACID, atomic writes | **Default winner** — hits every need with one in-process dep |
| **MongoDB** (self-host) | **RAM-hungry**: WiredTiger cache = 50%×(RAM−1GB), min 256MB; assumes ~1GB headroom | native documents | text index | document-level locking, replica sets | **Disqualified on footprint** before features matter |
| **PocketBase-on-SQLite** | = SQLite | = SQLite | = SQLite | = SQLite | Not a separate DB — it **is** SQLite. A backend-framework choice, not a datastore one |
| **RxDB / PouchDB** | client/offline-first doc DB (CouchDB sync protocol) | documents | — | built for **multi-client offline sync** | Solves a problem you don't have (no multi-device offline sync) |
| **LiteFS / Litestream** | not a DB — **SQLite replication/backup** layer | — | — | Litestream = single-node WAL→object-storage backup; LiteFS = multi-node | **Litestream is a nice optional backup add-on** on top of SQLite; LiteFS is overkill (multi-node) |

### Does NoSQL actually buy anything here? — No.

The historical NoSQL pitch was "schemaless storage + query JSON fields without a rigid schema." **SQLite now does all of that in-process:**

| Need | Document-DB answer | SQLite-with-JSON answer |
|---|---|---|
| Flexible/evolving fields | schemaless docs | `JSON`/`JSONB` column, no migration |
| Query into JSON | dotted-path query | `json_extract` / `->>` |
| Index a nested field | secondary index | generated-column / expression index (full B-tree speed) |
| Text search | text index | FTS5 + BM25 |
| Safe concurrent R/W | document locking | WAL: many readers + 1 writer, ACID |
| Footprint | **separate daemon** (Mongo: ≥256MB, wants ≥1GB headroom) | **in-process lib, ~0 extra RAM** |

A document DB only genuinely adds **horizontal scale-out/sharding** and **multi-client offline replication** — *neither* of which a single small LXC needs. Its costs (extra process, extra RAM, ops surface) directly violate "lightweight above all." **SQLite-with-JSON is strictly better on the lightweight axis.**

### Binary assets (screenshots): files-on-disk, path-in-DB

Standard recommendation: **store screenshot files on disk** (content-addressed dir) and keep **path + metadata (dimensions, hash, capture time) in the DB.** Full-page screenshots are 100s of KB–several MB; BLOB-ing them bloats the DB file, inflates every backup/Litestream pass, and pulls big blobs through the page cache — all bad on 512MB. (SQLite's "35% faster than the filesystem" BLOB advantage applies only to *small* blobs, ~tens of KB; screenshots are well past that.)

---

## 3. Competitive note — the nearest self-hosted competitors

> See also [`competitive-linkding.md`](./competitive-linkding.md) for a full feature inventory + head-to-head against **linkding** — the lightest and most mature self-hosted bookmark manager, omitted from the table below.

| | **Karakeep** (ex-Hoarder) | **Linkwarden** |
|---|---|---|
| Stack | Next.js + tRPC + Drizzle + **SQLite**; dedicated **worker** | Next.js + Prisma + **Postgres** |
| Capture | **Puppeteer** + Chromium; monolith/yt-dlp/OCR | **Playwright** + Chromium (in-app) |
| Search | **Meilisearch** (separate) | **Meilisearch** (separate) |
| Deploy | docker-compose, **~4 containers** | docker-compose, **3 containers** |
| RAM | rec. **2GB**; worker known to exhaust 2–4GB on big imports + a memory-leak report | **~700MB idle**, spikes hard during archiving |
| AI today | LLM **auto-tagging + summarization** (Ollama / OpenAI-compatible) | **AI tagging only** (no summarization) |
| License / stars | AGPL-3.0 / ~26k | AGPL-3.0 / ~19k |

**What they DON'T do — the `board-oss` gap:**

- **No opinionated AI "taste."** Their AI produces *metadata-for-search* (tags, generic summary). Neither does **design analysis** or a **"steal this" takeaway** — interpreting a page aesthetically and saying what to learn from it.
- **No visual inspiration grid.** Both are **list/card bookmark managers**. Linkwarden shows list rows / compact cards; screenshots are *archival artifacts* (link-rot insurance), not a browsable wall. Karakeep has a Pinterest-ish card grid, but cards are title + favicon + description text — the screenshot is a small thumbnail, **not a full-bleed visual canvas.** Neither positions as a **designer's moodboard**.

So `board-oss`'s defensible wedge is the **opinionated visual-inspiration grid + AI design-takeaway enrichment**, ideally at a **lighter footprint** than these (both are heavier, multi-container, Meilisearch-backed).

---

## 4. Ranked recommendation

### The field narrows fast (this is what makes it *ranked*)

Five of seven fall away cleanly against the hard constraints:

- ❌ **Supabase** — ~4GB idle. 4×+ over budget.
- ❌ **Appwrite** — 2GB hard floor, ~2–3GB idle, ~15–20 containers. Doesn't fit.
- ❌ **Directus** — 1GB is the floor *before* Postgres/Puppeteer; OOM-prone; **BSL license** ($5M cap) is wrong for a community OSS tool.
- ❌ **NocoDB** — fits the RAM, but can't host the custom capture/enrichment logic; you'd bolt on a worker anyway.
- ❌ **Roll-your-own** (SvelteKit/Astro/Hono) — smallest footprint, but it *is* the commodity hand-coding the project is fleeing; the prototype already lives here.

That leaves a genuine **top-2: PocketBase vs Payload CMS.**

### 🥇 #1 — PocketBase (+ a capture sidecar) + SQLite

- **Fits the hardware with enormous headroom** (~25–30MB idle), leaving the RAM budget free for the one thing that actually eats it: a launch-per-job Chromium sidecar.
- **Single Go binary + systemd** maps **directly onto the community-scripts.org one-command Debian-LXC** distribution goal. No Docker, no build step, no Node toolchain on the host. This deployment-shape advantage is load-bearing, not cosmetic.
- **MIT**, clean. Gives auth + admin + auto REST + SSE realtime + file storage + SQLite out of the box — the commodity features the project wants for free.
- Its only headline weakness (no in-process Puppeteer) **is dissolved by the Chromium-as-sidecar reality** the hardware mandates anyway.

### 🥈 #2 — Payload CMS (Node + SQLite, jobs queue)

- **MIT**, single Node process, SQLite-embeddable, the **richest in-process extensibility** (full Node, jobs queue, no sandbox/timeout) and the **strongest admin UI** of the realistic options.
- The cost: a **Next.js-coupled app with a build step** that can **OOM on a 1GB box at `next build`** (mitigable by building off-box), and a heavier/more-moving-parts deploy than a single binary — a worse fit for the community-scripts one-command-LXC story. No first-class realtime.

### Datastore — clear

**SQLite (WAL) with a JSON/JSONB metadata column, generated-column indexes on the fields you filter, and an FTS5 table for title/notes search.** Screenshots as **files on disk, paths in the DB.** Optionally add **Litestream** for continuous backup to object storage. Skip Mongo (footprint) and the embedded-NoSQL/sync options (solve problems you don't have, or *are* SQLite). Note both top frameworks use SQLite under the hood, so this choice is consistent either way.

### Key trade-off, stated plainly

> **Two small processes that fit perfectly (PocketBase + capture sidecar) vs. one all-in-one Node runtime with a build step that's tighter on this hardware (Payload).** PocketBase wins on RAM, license cleanliness, and the single-binary LXC-distribution story; Payload wins on in-process power and admin richness, which matter *less* once Chromium has to live in a sidecar regardless.

### Where a human / party decision is still needed

1. **PocketBase's pre-1.0 status** (v0.39.x) — accept occasional breaking changes / manual migrations on upgrade? Research can't price the team's tolerance for this.
2. **Two-process vs single-runtime taste** — PocketBase + sidecar (more moving parts, perfect fit) vs Payload all-in-one Node (simpler mental model, tighter on 1GB, build-step friction). A team-preference call.
3. **Next.js lock-in** — choosing Payload couples the project to the Next.js/App-Router world; acceptable, or a constraint to avoid?

*Verdict the evidence supports: **PocketBase #1, Payload #2, SQLite for the datastore.** The one real open question for the party is which of those two frameworks — and that's a fit-vs-richness trade-off to decide deliberately, not a coin-flip.*

---

## Addendum — Party decision (2026-06-19, post-research)

The roundtable **overrode this brief's PocketBase #1 recommendation** — but on durable *economic/timing* grounds, not on a hard technical blocker (an important distinction for the v2 reconsideration below):

1. **Migration economics (decisive).** The prototype already ships a working Fastify `buildServer`, a collection-scoped API, and a co-designed frontend (git Stories 1-4→1-7). Adopting PocketBase means re-pointing the entire frontend at its SDK — **≈3× the work** of evolving in place, for no net v1 feature gain.
2. **Auth-deferred timing (decisive).** PocketBase's single biggest "free" win is **auth** — and v1 explicitly *defers* auth to reverse-proxy (see PRD AD7). So in v1 PocketBase buys only file-storage + auto-REST + SSE, which Fastify+Drizzle provide with modest code. Its value is highest precisely where v1 spends nothing.
3. **Goja-async is *secondary* friction, not a blocker (correction).** It's tempting to reject PocketBase because `pb_hooks` runs in a goja ES5.1 VM with no native async — wrong home for an 8–40s LLM call. But the **same Chromium-sidecar logic that dissolves the capture weakness dissolves this too**: enrichment can run as an **external Node worker** talking to PocketBase over its API (precisely how **Karakeep**, cited in §3, is architected), never touching goja. So this is a mild ergonomic cost, not the reason. *(The party's round-3 deliberation over-weighted this; recording the correction here.)*

> **v2 note:** because the rejection rests on migration economics + auth-deferred timing — not impossibility — **PocketBase is worth re-evaluating at v2**, when multi-user auth becomes a real requirement and its "free auth" win actually pays.

**The brief's framing of "roll-your-own" as «hand-code all the commodities» was the false dichotomy.** The party's resolution — the **"Lean Hybrid"** — is a third path:

> **Evolve the existing Node/Fastify spine** (it owns the three differentiators: capture orchestration, async LLM enrichment, the opinionated boards API), **keep SQLite/Drizzle as recommended here**, and **BUY the commodity layer as libraries** — `oslo` primitives + `argon2` for auth (deferred to v2), `@fastify/static` for assets — rather than either hand-rolling them *or* adopting a host platform. This honors "don't hand-code every feature" without surrendering the request lifecycle.

So the research's **datastore verdict stands unchanged (SQLite/Drizzle, WAL, JSON columns, FTS5, screenshots as files-on-disk)**, and its **Chromium-binding-constraint finding is load-bearing** in the final design (capture concurrency = 1, launch→screenshot→kill). Only the *framework* verdict was superseded. Full decision record: see `prd.md` § Architecture Decisions.
