# board-oss — Product Requirements Document (v1 / MVP)

**Date:** 2026-06-19
**Status:** Approved by party consensus
**Companion docs:** `product-brief.md` (vision/audience) · `research.md` (architecture evidence)
**Baseline:** the existing `board` prototype (Node/TS + Fastify + vanilla-JS + flat-JSON), which defines the experience to match or beat.

---

## 1. Overview

> **Product thesis (decided by founder, 2026-06-20): *"AI composes opinionated boards for anything you collect."*** `board-oss` is not "two hardcoded boards" — it is an **AI taste-engine**: you describe what you're collecting, and an agent that carries the product's taste proposes a finished, opinionated board (its capture mode, the attributes worth keeping, the enrichment lens, the layout). You accept or nudge it. The two boards (Inspiration, Library) ship as **composer-generated reference examples**, not as the whole product. The moat moves from the *boards* to the *board-generating taste*.

`board-oss` re-platforms the `board` prototype into a lightweight, self-hostable, open-source product. v1 reproduces the prototype's **capture → enrich → browse → revisit** loop on a durable datastore, makes the LLM dependency **optional and pluggable**, adds two experience upgrades (optimistic async-save, full-text search), and — per the thesis above — adds the **agentic board composer** on a **schema-as-data** foundation. It targets a one-command install on a small Debian LXC.

### 1.1 Goals

- **G1 — Parity:** the Inspiration + Library experience is preserved; they become the composer's house examples.
- **G2 — Self-hostable by a stranger:** one-command LXC install, ~512MB–1GB RAM, zero external accounts required to reach first value.
- **G3 — LLM optional (for capture/enrich):** boots and is useful with enrichment disabled; BYOK-or-local when configured; graceful when absent/failed. *(Note: the composer **requires** an LLM — it is the one feature that is dark without a provider; capture + manual curation are not.)*
- **G4 — Lighter than incumbents:** single-node, SQLite, no multi-container/Meilisearch stack.
- **G5 — Better than prototype:** async-save feels instant; FTS5 search exists; **and you can create new opinionated boards by describing them.**
- **G6 — The composer has taste, not a form:** every custom board originates as an AI proposal with a stance; the user refines, never builds from a blank schema form. We market the taste, never a generic builder.

### 1.2 Context

The prototype's existential flaw is that enrichment shells out to the user's local `claude`/`codex` CLI (their auth, their subscription) — fatal on a stranger's box. The second flaw is flat-JSON storage, which corrupts under concurrent/bursty writes. v1 fixes both. The binding hardware constraint is **headless Chromium (~400–520MB resident while rendering)**, which dictates launch-per-job/kill, capture concurrency = 1.

---

## 2. Personas

See `product-brief.md` §3. Primary: **the design-literate self-hosting maker** (visual collector with taste; user-zero ≈ the author). Single-user, self-hosted, runs their own reverse proxy.

---

## 3. Key user journeys (experience requirements)

These three journeys are **normative** — they define the felt experience, not just the data flow.

### J1 — The optimistic save (the signature feel)
1. User pastes a URL into the always-present capture field and hits save.
2. **The card appears in the board instantly** — real, clickable — wearing a skeleton/shimmer on its AI fields with a status pulse (`queued → capturing → enriching`).
3. The user can immediately paste the next URL; multiple saves queue.
4. Screenshot and AI fields **fill in underneath the card the user already owns**, pushed live via SSE (poll fallback). Final state: `done` (or `error` with a retry affordance).
> *Rationale: enrichment is 8–40s; a spinner-and-wait is the prototype's weakest moment. Optimistic insertion converts the async gap into the product's fastest-feeling interaction.*

### J2 — The robot is asleep (degraded / disabled LLM)
- If enrichment is **disabled** (no provider configured) or **fails**: the card still saves **complete** — title, favicon, screenshot/url, user notes, user tags.
- AI fields show a **dignified empty state** ("No analysis — enrichment disabled") or, on failure, a single **"Retry analysis"** affordance. **Never** raw error text.
> *Capture is the spine; AI is seasoning. A board of un-enriched cards must still feel like a board you're proud of.*

### J3 — First run, zero config (a stranger, no docs)
- A freshly-installed instance opens to a **warm empty state** (not a blank void): one line of what each board is for, a capture field with placeholder "Drop a URL…".
- **It works with zero configuration** — capture + manual curation function with no LLM key. No API-key wall before first value.
- A single dismissible nudge: "Add a key in Settings to turn on AI analysis." First value is reached in **one paste**.

### J4 — Compose a board (the agentic composer; the thesis feature)
1. User clicks **"New board"** and *describes what they collect* in natural language ("I save synth gear I want to buy", "great onboarding flows", "papers on agents").
2. An agent carrying the product's taste proposes a **finished, opinionated board**: a name, a capture/ingest mode, the **attributes worth keeping** (typed fields), an **enrichment lens** (the prompt that gives the board its point of view), and a **layout** (grid/list).
3. The user sees the proposal as a **preview they accept or nudge** — "add a 'price' field", "make it a grid" — *not* a blank schema form. Refinement is conversational or light-touch editing of the AI's stance.
4. On accept, the board is created (a `board_descriptor` row) and immediately usable; the very next saved item is captured + enriched against the generated schema.
> *Guardrail (Victor): the composer must output a board **with a stance**. If it degenerates into "AI helps you fill out a schema form," it collapses into a generic builder and dilutes the product. The agent takes a stance, not an order.*
> *Sequencing (within v1): the two seeded boards are built first and serve as the composer's reference examples / few-shot taste; the composer ships after them so taste is proven before it is automated.*

---

## 4. Functional requirements

### 4.1 Capture & ingestion
- **FR1** — Save an item by URL via the web UI (and retain a CLI path for power users).
- **FR2** — **Inspiration** capture: full-page screenshot via headless Chromium (launch→screenshot→**close**). Stored as a **file on disk**, path + metadata (dimensions, hash, capture time) in the DB.
- **FR3** — **Library** capture: readable-text extraction (fetch + Readability) with a headless-render fallback for JS-rendered SPAs (port the prototype's `captureLibrary` fallback).
- **FR4** — **Manual screenshot upload** for an item (the graceful path when auto-capture fails) — preserved from the prototype.
- **FR5** — Capture runs as an async job; **capture concurrency is hard-capped at 1** (runs on the single serialized worker), with a per-capture wall-clock timeout and guaranteed browser teardown.

### 4.2 Enrichment (LLM)
- **FR6** — Enrichment runs **asynchronously** after capture, writing structured fields back to the item.
- **FR7** — Enrichment is **pluggable** behind an `EnrichmentProvider` seam. v1 ships **one provider**: an **OpenAI-compatible HTTP** client (covers cloud BYOK *and* local Ollama/LM Studio via base-URL config).
- **FR8** — Enrichment is **optional**: with no provider configured, the app is fully usable (J2). Provider config (provider, base URL, API key, model) is via env/settings.
- **FR9** — Provider calls use native async with **timeouts, retries, and JSON-schema-constrained output**, validated defensively (local models emit imperfect JSON).
- **FR10** — Per board type, enrichment fills:
  - **Inspiration:** design analysis, a **"steal this"** takeaway, audience/form/domain facets, tags.
  - **Library:** summary, topics, author, type (article/doc/paper/repo/video), key points.
- **FR11** — **Re-enrich / refetch** an existing item (re-run capture + enrichment), preserving user-authored fields (notes, favorite). Preserved from prototype.

### 4.3 Boards, browse & organize
- **FR12** — Two boards: **Inspiration** (visual grid) and **Library** (list/rows). Sidebar board switcher.
- **FR13** — **Detail modal** for an item showing capture + all enriched + user fields.
- **FR14** — **Filters**: by topic / type / facet / tag, per board.
- **FR15** — Per-item user actions: **notes** (free text), **favorite**, **delete**. Preserved from prototype.
- **FR16** — **Full-text search (FTS5)** across captured text, titles, summaries, and notes. *(Bonus — net-new over the prototype; near-free on SQLite.)*

### 4.4 Status & realtime
- **FR17** — Each item carries a **`status`** (`pending → processing → done → error`); `error` **persists the failure reason** for display/retry.
- **FR18** — The UI receives live status via **SSE** (`GET …/events`), with refetch/poll as fallback. No external broker.

### 4.5 Config & data
- **FR19** — All deployment knobs are **env-driven**: `PORT`, `HOST` (default `127.0.0.1`), `DATA_DIR`, `CHROME_PATH` (+ Linux autodetect), enrichment provider/base-URL/key/model.
- **FR20** — Data lives under a **persistent `DATA_DIR`** (SQLite file + screenshots dir), separate from app code, survives upgrades.
- **FR21** — **One-shot importer** from the prototype's flat-JSON (`bookmarks.json` / `library.json`) into SQLite, so existing data migrates.
- **FR22** — Board types are defined as **data**, not code: a `board_descriptor` (capture/ingest mode + typed field list + enrichment lens/prompt + view) stored per board. The two seeded boards are descriptors like any other. *(Supersedes the prior "seam-only, no builder" stance — see AD8.)*

### 4.6 Customization & the agentic composer (thesis features)
- **FR23 — Board descriptor (schema-as-data):** each board carries a descriptor `{ fields: [{key, label, type, enrichable}], enrichment_prompt, view, ingest_mode }`. **Field `type` is drawn from a deliberately CLOSED set** (text, number, date, url, enum, tags, image) — this is what keeps dynamic enrichment, dynamic rendering, and indexing tractable.
- **FR24 — Dynamic enrichment:** the enrichment worker builds the LLM prompt **and** the output JSON-schema from the board's stored descriptor (not a hardcoded constant). The E3 provider already accepts a schema; it is now fed the descriptor's.
- **FR25 — Dynamic rendering:** the frontend renders an item's fields generically via a **field-type → component map** over the closed type set; no per-board frontend code.
- **FR26 — Agentic composer:** "New board" takes a natural-language description and, via the LLM provider, emits a **board descriptor** (FR23) conforming to a **meta-schema** (the schema *for* descriptors). The user previews and **accepts or refines** the proposal (J4). The composer **pre-fills** the refine view; it is never a blank-form builder.
- **FR27 — Composer guardrails:** the emitted descriptor is validated against the meta-schema with a **validate-and-repair** loop (one re-ask on failure); enforce: field `type` ∈ closed set, field count ≤ N, no duplicate/reserved keys (`id`, `created_at`, `status`). Nothing is written until the user accepts — composition is non-destructive by construction.
- **FR28 — Ingest seam (`CaptureAdapter`):** capture is generalized to `adapter.fetch(source) → { fields, assets[] }`, keyed by ingest mode. v1 ships the **URL/screenshot** + **URL/readable-text** adapters (parity). The interface is designed so non-URL adapters (uploaded image, YouTube oEmbed) slot in without core changes. **The item model must not assume "every item is a URL."**

### 4.7 Skill-modular architecture & LLM providers (AD11/AD12, AD5)
- **FR29 — Skill registry:** each capability is a registered `Skill { name, inputSchema (zod), outputSchema (zod), run(input, ctx) }` where `ctx = { db, llm, queue, collectionId, logger }` (no globals — everything injected, everything mockable). v1 capabilities land as skills: **import-bookmarks, create-board, add-item, generate-fields, tag, compose-board**.
- **FR30 — Generic invocation:** skills are invoked in v1 by a **single generic HTTP route** (`POST /skills/:name` → `inputSchema.parse` → `run` → `outputSchema`). The UI is the only v1 client. *(MCP/CLI adapters over the same registry are deferred — FR-deferred.)*
- **FR31 — `LLMProvider` seam (AD5):** `complete(prompt, schema) → structured`, with two implementations — **`HttpProvider`** (API key / OpenAI-compatible / open-model via base-URL) and **`CliProvider`** (spawn `claude`/`codex`/`cursor-agent`, inject JSON-schema into the prompt, parse + revalidate stdout, harden subprocess lifecycle: timeout/kill, exit→typed error, no secrets in argv). A shared **provider-conformance suite** runs against both.
- **FR32 — Zero-coding-CLI default (AD12, NFR3):** the default install requires **no** coding-CLI; AI enrichment is optional and points at an open-model HTTP endpoint or a pasted key, degrading to no-AI. `CliProvider` is an **opt-in** provider for users who already have a coding subscription authed on the box.
- **FR33 — Characterization-first for `CliProvider`:** before refactoring the prototype's `add.ts buildAnalysisCommand`, pin its current argv-build + stdout-parse behavior with a characterization test, then wrap behind `LLMProvider`.

---

## 5. Non-functional requirements

- **NFR1 — Footprint:** idle within a 512MB–1GB / 1-vCPU LXC; capture is the only heavy operation and is bounded (concurrency 1, transient). Cap Node heap (`--max-old-space-size`); bound streaming buffers.
- **NFR2 — Datastore:** SQLite in **WAL** mode; **single-writer queue** + `busy_timeout`; atomic writes; JSON/JSONB columns for flexible fields; generated-column indexes on filtered fields; FTS5 for search. Screenshots as files-on-disk.
- **NFR3 — Security (v1):** **no built-in auth**; **bind `127.0.0.1` by default**; ship documented reverse-proxy guidance (Caddy/Authelia/Tailscale). The internal capture contract is **token-authed** even on localhost.
- **NFR4 — Packaging:** installable on Debian LXC as `install Node (pinned LTS) → npm ci --omit=dev → systemd unit (non-root) → reverse proxy`. Optional container image. Targets community-scripts.org norms.
- **NFR5 — Resilience:** no blocking first-run; app starts and serves with zero LLM/Chrome config (capabilities degrade independently). A hung capture lands as a clean `error` row, never a stuck `processing`.
- **NFR6 — Testability:** core logic (capture orchestration, enrichment provider, job worker, storage) is unit-testable in-process (Fastify `inject()`, mocked fetch) — preserve the prototype's TDD posture.
- **NFR7 — Portability/reversibility:** data is a plain SQLite file + a screenshots dir; user can copy and walk away. Optional Litestream backup.

---

## 6. Architecture decisions (ADR)

| # | Decision | Rationale | Rejected alternatives |
|---|---|---|---|
| **AD1** | **Lean Hybrid** — evolve Node/Fastify as the owned spine (capture orchestration, async enrichment, boards API). | The 3 differentiators need a runtime we control; the prototype's spine already speaks this language; ~3× cheaper than re-platforming. | PocketBase-as-host — rejected on **v1 migration economics** (~3× reuse of shipping Fastify+frontend code) **+ auth-deferred timing** (PocketBase's biggest free win is auth, which v1 defers to reverse-proxy anyway, so it buys only file-storage/auto-REST/SSE here — not worth a frontend-SDK rewrite). *Goja-async is **secondary** friction, not a hard blocker:* enrichment could run as an external Node worker against PocketBase's API (the Karakeep pattern), exactly like the accepted capture sidecar. **Reconsider PocketBase at v2 when auth becomes a real requirement.** Payload (Next coupling + `next build` OOM on 1GB); Directus/Supabase/Appwrite (RAM/license). |
| **AD2** | **Buy commodity as libraries** — `oslo` primitives + `argon2` (auth, v2), `@fastify/static` (assets). | Honors "don't hand-code every feature" without surrendering the request lifecycle to a platform. | Hand-rolling auth from scratch; adopting a BaaS for commodity. |
| **AD3** | **SQLite via Drizzle** (WAL, JSON columns, FTS5); screenshots as files-on-disk. | Hits every need with one in-process dep; lightest on the binding axis; reversible. | NoSQL/Mongo (footprint, buys nothing here); flat-JSON (corrupts under bursty writes); RxDB/PouchDB (solves multi-device sync we don't have). |
| **AD4** | **Capture in-process for v1** (launch→screenshot→kill, **concurrency 1**); **sidecar contract designed**, extraction deferred to v2. | Chromium is non-resident either way; an always-on capture service is high-cost/low-v1-value; designing the contract keeps v2 a lift-and-shift. | Building the offloadable capture sidecar service in v1. |
| **AD5** | **Pluggable, optional `LLMProvider` seam with TWO transports** *(generalized 2026-06-20)*: **`HttpProvider`** (API key *and* open-model/Ollama/LM-Studio — same seam, just a base-URL+key+model) and **`CliProvider`** (a coding-agent subprocess — "use your **Claude Code / Codex / Cursor** subscription," resurrected from the prototype's `add.ts`). Both satisfy `complete(prompt, schema) → structured`. | Lowers cost-to-first-enrichment (a maker with a Claude/Cursor sub but no API key is otherwise blocked at the door); BYO-anything; optional = boots without it; graceful degradation to no-AI. | A hard dependency on one cloud vendor; **and — critically — coding-CLI as the install *default* (it stays an opt-in power path; see AD12).** |
| **AD6** | **Async job model:** in-process single-writer worker queue + `status` column + **SSE**. | Right-sized for single-node; the queue *is* the SQLite single-writer guard; no new dependency. | Redis/BullMQ (violates lightweight/single-binary); WebSockets (bidirectional overkill). |
| **AD7** | **Auth deferred** — reverse-proxy-only, localhost-bind for v1. | Audience runs a proxy; half-baked auth is worse than none; commodity work that serves nobody on day one. | Built-in oslo login in v1. |
| **AD8** | **~~Seam-only extensibility~~ → Composer-driven extensibility** *(revised 2026-06-20).* Board types are data; users create new boards via the **agentic composer**, which outputs an opinionated board they accept/refine — **never a blank-form builder**, and we never market a generic engine. | The original seam-only line assumed flexibility and opinion are opposed. The composer dissolves that: the AI supplies the opinion, so users get flexibility *with* taste. The wedge moves from "two boards" to "the board-generating taste." | A *raw user-facing schema/form builder* (the "worse Notion" trap) and *marketing a generic typed-collection platform* remain rejected — the guardrail (FR23/FR26: stance not form) is what separates the wedge from the trap. |
| **AD9** | **Schema-as-data foundation in v1** — board-type behavior (capture mode, typed fields, enrichment lens, view) is a stored `board_descriptor`, on a **closed field-type set**; enrichment + rendering are dynamic. | Cheap (~1 epic — the existing seam relocated into data) and it **preserves optionality for the entire vision** (composer, content types, future canvas) without a later core migration. | Hardcoding board types in code (forces a data-model migration for every future board type). |
| **AD10** | **Agentic composer is a v1 launch feature** (per founder thesis), built **after** the two seeded boards (taste proven first); reuses the E3 provider + a meta-schema + validate-and-repair guardrails. | Founder decision: launch *as* "AI composes opinionated boards." Engineering confirmed it's small once AD9 lands (it rides entirely on the descriptor). | Deferring the composer to v2 (the conservative option the founder considered and declined); building it *before* the reference boards (taste unproven). |
| **AD11** | **Skill-modular internals (Spectrum C)** *(2026-06-20)*: every capability (import-bookmarks, create-board, add-item, generate-fields, tag, compose-board) is a registered **`Skill { name, inputSchema(zod), outputSchema(zod), run(input, ctx) }`**, invoked by a **generic HTTP route** in v1. The zod contract is a v1 requirement — it *is* the future MCP tool schema. Skills call each other as plain function calls. | Near-free architectural hygiene that mirrors how the composer already works; makes the external MCP/CLI surface a later *adapter*, not a rewrite. Amplifies the agent-native thesis without a new runtime. | A skill *scheduler / message bus / daemon* (that would be a second runtime — rejected); building the **external** agent surface in v1. |
| **AD12** | **Agent-operability is deferred; UI is the only v1 client; default install is zero coding-CLI.** An optional **in-process** MCP server (off by default, never a sidecar) and the `CliProvider` are *opt-in power paths*. **Positioning markets the board, not the engine** — agent-native + BYO-subscription are the moat and a quiet onboarding path, never the homepage. | Option B (drive-it-by-talking-to-your-agent as the primary surface) would silently **narrow the audience** to "developers who use coding agents" and abandon the designer tip of the wedge. C serves both. | Making the agent CLI / MCP the front door; letting coding-CLI leak into the install contract; marketing "composable skills / bring your coding subscription" as the identity. |

> **Founder update to AD12 (2026-06-20):** *"I like what an agent can do, but I don't mind fallbacks eventually. I'm not chasing the widest audience — if folks don't want it, no biggie."* This **relaxes AD12's marketing guard**: an **agent-forward identity is embraced** and a narrower, agent-comfortable maker audience is accepted. The relaxation is to *marketing emphasis + audience expectation*, **not architecture** — the visual board stays the soul; the default install stays **zero-coding-CLI and fully UI-usable**; non-agent fallbacks remain welcome but **deferrable**; external MCP stays **v1.x on cost grounds** (Amelia), not positioning grounds. Net: we may *lead* with the agent/composer story rather than hide it; Spectrum C is unchanged.

---

## 7. Data model sketch (indicative)

- **`board`**: `id`, `name`, `view` (grid|list|…), **`descriptor` (JSON)** — the schema-as-data record: `{ fields:[{key,label,type∈closed-set,enrichable}], enrichment_prompt, ingest_mode }` (FR23). The two seeded boards are descriptors like any other. The `view` field is also the future hook for a canvas view type (AD8/§9).
- **`item`**: `id`, `board_id`, `source` *(not assumed to be a URL — FR28)*, `title`, `status` (enum), `error_reason`, `created_at`, `updated_at`, `favorite`, `notes`, **`fields` (JSON — values keyed by the board descriptor's field keys)**, **`search_blob`** (text — concatenation of enrichable/text fields, assembled on write), `analysis_provider`, `analysis_model`.
- **`asset`**: `id`, `item_id`, `kind` (screenshot|image|thumbnail), `path`, `width`, `height`, `hash`, `captured_at`. (An item has zero-or-more assets — FR28.)
- **FTS5 virtual table** over the synthetic **`search_blob`** (single column), NOT per-board fields — kept in sync on write. *(Amelia's non-deferrable E1 decision: dynamic fields make per-field FTS columns impossible.)*
- **Indexing:** generated-column indexes on a **fixed set of system columns** (board_id, status, favorite, created_at); filtering on **custom descriptor fields** uses `json_extract` scans at v1 scale, with lazy promotion of a hot field to a generated column + index later (deferred).
- **Tags / facets**: a `tags`-typed descriptor field (JSON array) + FTS coverage; normalize later only if a tag-management UI lands (deferred).

---

## 8. Epics & build order (proposed)

Ordered by "what unblocks a stranger," reusing the shipping frontend + API where possible. **Sequencing rule (AD10): the two seeded boards land before the composer** — taste proven, then automated. **Cross-cutting (AD11): each capability below lands as a registered `Skill` behind a generic HTTP route, with zod in/out contracts** — near-free hygiene that makes future MCP/CLI adapters non-rewrites; no skill scheduler/bus (that would be a second runtime).

1. **E1 — Storage foundation (schema-as-data):** SQLite/Drizzle schema with the **`board.descriptor`** JSON column, **`item.fields`** + **`item.search_blob`**, `view` field; WAL, single-writer queue + `busy_timeout`, atomic writes; **FTS5 over `search_blob`** (the non-deferrable decision); flat-JSON → SQLite importer that writes the two seeded descriptors (FR20–23, NFR2, AD9). *Tests: concurrent-write safety, importer round-trip, arbitrary-fields survive write→search_blob→FTS.*
2. **E2 — Config & portability:** env-driven config; `CHROME_PATH` autodetect; `DATA_DIR`; localhost-bind default (FR19, NFR3–4).
3. **E2.5 — Generic renderer + dynamic enrichment:** field-type→component map over the closed type set (FR25); descriptor-driven enrichment prompt/schema construction (FR24). *Serves both the seeded boards and, later, the composer.*
4. **E3 — `LLMProvider` seam (two transports):** the interface + `HttpProvider` (API-key / open-model) + `CliProvider` (coding-agent subprocess — characterization-test the prototype's `add.ts` first, then wrap + harden lifecycle); a shared provider-conformance suite; optional/graceful; zero-coding-CLI default (FR6–10, FR31–33, AD5/AD12). *Highest-risk refactor — pin behavior first.*
5. **E4 — Async job model:** single-writer worker queue, `status` column, capture-concurrency-1, timeout-kill, `status:error` with reason; SSE (FR5, FR17–18, AD4/AD6, C1/C4).
6. **E5 — Ingest on the new spine:** `CaptureAdapter` interface (FR28); ship URL/screenshot + URL/readable-text(+SPA fallback) + manual upload, behind the token-authed idempotent capture contract (FR2–4, C2). *Item model is source-agnostic from birth.*
7. **E6 — Experience upgrades:** optimistic async-save UX (J1), degraded/disabled states (J2), warm zero-config first-run (J3). **The two seeded boards are fully working here — taste is now proven.**
8. **E7 — Search:** FTS5 search over `search_blob` (FR16).
9. **E8 — Agentic composer (thesis feature):** meta-schema + composer prompt + validate-and-repair guardrails (FR26–27) + accept/refine UI riding E2.5's renderer (J4, AD10). *Built last in v1, on everything above.*
10. **E9 — Packaging:** systemd unit, non-root, install script, optional container image, `/healthz`; community-scripts.org submission (NFR4).

> Deferred to **v1.x / v2+**: **external agent-operability** — an in-process, off-by-default **MCP server** re-publishing the skill registry, and agent-operability as a *primary* surface (the registry's zod contracts are built v1 so this is a later *adapter*, not a rewrite); non-URL capture adapters (uploaded image, YouTube oEmbed — *seam reserved in E5*); **YouTube-channel/RSS feed-sync** (a separate scheduled-sync subsystem, not an adapter); **vision-board canvas** (a net-new layout engine ≈ the size of E1–E8 combined — slots into the `view` field later); built-in auth (oslo+argon2); offloadable capture sidecar *service*; tag-management UI; lazy field-index promotion; Litestream backup UI.

---

## 9. Out of scope (v1)

Built-in auth/login · multi-user / sharing / collaboration · browser extension · mobile/responsive-native · full **search UI** beyond basic FTS · bulk operations · tag-management CRUD UI · board reordering/theming · export/backup UI · public share links · analytics/stats · smart dedup.

*(Moved INTO v1 since the original cut line: **import-bookmarks** is now a v1 skill (FR29) — the founder named it explicitly; it also covers the prototype-data importer FR21.)*

**Deferred from the customization + agent-native rounds:**
- A **raw user-facing schema/form builder** — the composer's accept/refine (FR26) replaces it; a blank-form builder is the "worse Notion" trap, *permanently* rejected (AD8).
- **Non-URL ingest adapters** (image upload, YouTube oEmbed) — seam reserved in E5, adapters are v1.x.
- **YouTube-channel / RSS feed-sync** — a separate scheduled-sync subsystem, not an adapter.
- **Vision-board / freeform-canvas view** — net-new layout engine; the `view` field reserves the hook.
- **External agent-operability** — in-process off-by-default MCP server + agent-as-primary-surface (AD12); zod contracts built in v1 so it's a later adapter.

---

## 10. Risks & caveats (carried from architecture sign-off)

- **C1 (load-bearing):** Capture concurrency = 1, enforced on the single serialized worker; per-capture timeout with `browser.close()` in `finally`. This is what makes in-process capture safe on a 512MB LXC.
- **C2:** The capture contract (endpoint, token auth, payload schema, idempotency-on-retry) is a **designed v1 deliverable** even though the sidecar is deferred — else v2 becomes a rewrite.
- **C3:** **Bind `127.0.0.1` by default**, never `0.0.0.0`. The reverse-proxy-only model is only safe if the raw port is never exposed. Explicit default + documented warning.
- **C4:** `status:error` must persist the failure reason; a hung-Chromium timeout becomes a clean retryable `error` row, never a silently-stuck `processing` job.
- **C5:** Pin `oslo` primitives + `argon2`, **not** the sunsetting Lucia framework (auth is v2 regardless).
- **C6:** Node memory baseline is heavier than a Go binary — cap `--max-old-space-size`, watch streaming/JSON-schema buffers. Bounded by design, not discovered in prod.
- **C7 (composer):** the LLM may emit an invalid/insane board descriptor → meta-schema validate-and-repair loop; enum allowed field types; cap field count; reject reserved/duplicate keys; nothing writes until the user accepts (FR27). Non-destructive by construction.
- **C8 (composer, taste-unproven):** mitigated by sequencing — the two seeded boards prove the taste before the composer automates it (AD10, E8 after E6).
- **C9 (positioning / audience drift):** marketing "agent-native / bring your coding subscription" as the identity would narrow the audience to terminal-dwelling devs and abandon the designer tip. Mitigation: market the board; agent-native stays a seam + onboarding path (AD12). Keep the UI the v1 front door.
- **C10 (coding-CLI in the default install):** `CliProvider` must never enter the install contract — a stranger's LXC has no authed `claude`/`codex`/`cursor`. Default = zero coding-CLI, AI optional via HTTP/open-model, degrades to no-AI (FR32, AD12).
- **C11 (closed field-type set):** descriptor field `type` must stay a closed enum — it's what keeps dynamic enrichment, dynamic rendering, FTS `search_blob`, and indexing tractable (FR23). Don't let it go open-ended.

---

## 11. Open questions (for the next phase — not blockers)

1. **Tags vs facets storage** — normalized table vs JSON-array + generated-column index. Decide during E1 against the filter queries.
2. **Frontend evolution** — keep vanilla-JS (lightest, already shipping) or adopt a small framework for the optimistic-save reactivity (J1)? Lean toward keeping vanilla-JS unless J1 forces otherwise.
3. **Container vs LXC-script as the *primary* distribution** — both are in scope (NFR4); which to polish first for launch.
4. **Litestream** as default-on backup vs opt-in.

---

## 12. Consensus log

| Decision | Outcome | How reached |
|---|---|---|
| Audience | Design-literate self-hosting maker | Unanimous (round 1) |
| Datastore | SQLite/Drizzle; NoSQL & flat-JSON rejected | Unanimous (round 1 + research) |
| Spine | Lean Hybrid (evolve Fastify + buy libraries) | Ratified YES by PM/Architect/Engineer/Innovation after 2 PocketBase advocates reversed on implementation facts (rounds 2–3) |
| Capture (sidecar) | In-process v1, concurrency 1, contract designed, extraction v2 | Architect sign-off after Engineer proposal (round 5) |
| Auth | Reverse-proxy-only v1 | Unanimous (round 4) |
| Extensibility | Seam-only, no board builder | Unanimous (round 4) |
| MVP scope & job model | Per §4–§8 | Convergent (round 4) |
| **Customization / vision** (2026-06-20) | Schema-as-data foundation in v1; **agentic composer IS a v1 launch feature** (founder chose "lean all the way in"); thesis → "AI composes opinionated boards for anything you collect"; canvas + feed-sync deferred | Party decomposed (a/b/c/d); founder decision on composer timing/thesis |
| **Agent-native architecture** (2026-06-20) | **Spectrum C** — skill-modular internals + 3-class pluggable LLM (HTTP + coding-CLI) in v1; external MCP/agent-operability deferred; default install zero-coding-CLI; **market the board, not the engine** | Unanimous (Winston/Amelia/John/Victor) |

*Participants: Mary (Analyst, research), John (PM), Winston (Architect), Amelia (Engineer), Sally (UX), Victor (Innovation).*
