---
title: board-oss
created: 2026-06-20
updated: 2026-06-20
status: draft
---

# PRD: board-oss

## 0. Document Purpose

This PRD is for the PM, the implementer, and the downstream BMAD workflows (`bmad-create-architecture`, `bmad-create-epics-and-stories`). It is **capabilities-focused**: features grouped, Functional Requirements nested with globally stable IDs, cross-cutting NFRs in their own section. The deep technical reasoning — architecture decision records (AD1–AD12), the full data-model sketch, transport mechanics, and risk caveats (C1–C11) — already exists and lives in **`docs/prd.md`** and **`docs/research.md`**, which act as this PRD's technical addendum; it is referenced here, not duplicated. Vocabulary is anchored in §3 Glossary and used verbatim throughout.

## 1. Vision

`board-oss` is the open-source, self-hostable successor to the `board` prototype, and an **AI taste-engine**: you describe what you collect and an agent carrying the product's taste composes a finished, opinionated **board** for it — its capture mode, the attributes worth keeping, the enrichment lens, the layout — which you accept or nudge. The thesis: **"AI composes opinionated boards for anything you collect."** The moat is the board-*generating* taste, not the boards themselves.

It runs lightweight enough for a small Proxmox LXC, keeps data in a plain SQLite file the user owns, and lets you bring any LLM — an API key, an open model, or your Claude Code / Codex / Cursor subscription. Every capability is a composable **skill** with a typed contract; AI is optional everywhere except the composer, and capture + manual curation work with zero configuration.

## 2. Target User

### 2.1 Jobs To Be Done
- **Functional:** "When I find something worth keeping, capture it, let the machine make sense of it, and let me re-find it by how it looks or what it's about."
- **Functional:** "When I start collecting a new *kind* of thing, give me a tasteful structure for it without making me design a schema."
- **Emotional:** "Make my collection feel curated — like I have a point of view — not like a junk drawer."
- **Contextual:** "Keep it on my own hardware, lightweight, with my own LLM or subscription."
- **Builder's framing:** user-zero is the author; v1 serving him well is a valid primary target.

### 2.2 Non-Users (v1)
- Non-technical designers who will not self-host (the value and the constraints must serve one person; they don't).
- Teams / multi-tenant orgs (single-user v1).
- Mobile-first users. The founder has explicitly accepted this **narrower, agent-comfortable audience**.

### 2.3 Key User Journeys

- **UJ-1. Maya saves a beautiful landing page and the card is alive before the robot finishes.**
  - *Persona + context:* Maya, a design-literate maker, runs board-oss in her homelab. Authenticated implicitly (single-user, behind her reverse proxy).
  - *Path:* pastes a URL into the always-present capture field → the card appears **instantly** in the Inspiration grid, AI fields wearing a shimmer (`queued → capturing → enriching`) → she pastes the next URL immediately.
  - *Climax:* the screenshot and the design read + "steal this" fill in **underneath the card she already owns**, pushed live.
  - *Resolution:* a populated, tasteful card; `done`. (Edge: on failure the card shows a quiet "Retry analysis", never error text.)

- **UJ-2. The robot is asleep and nothing looks broken.**
  - *Persona + context:* a fresh installer with no LLM configured.
  - *Path:* saves a link → card stores complete (title, favicon, screenshot, notes, tags) → AI fields show a dignified "No analysis — enrichment disabled."
  - *Climax/Resolution:* a board full of un-enriched cards still feels like a board to be proud of; a dismissible nudge offers to add a key/provider.

- **UJ-3. A stranger reaches first value in one paste.**
  - *Persona + context:* a homelabber who just one-command-installed the LXC, no docs read.
  - *Path:* opens to a **warm empty state** (what each board is for + a capture field) → it works with **zero configuration** → pastes one URL → sees it captured and looking good.
  - *Resolution:* "this is mine and it looks great" in one paste.

- **UJ-4. Hayawan composes a brand-new board by describing it.** *(the thesis journey)*
  - *Persona + context:* the founder wants a board for "synth gear I want to buy."
  - *Path:* clicks **New board** → types the description → an agent proposes a finished board (name, ingest mode, typed attributes incl. *price*, an enrichment lens, a grid layout) shown as a **preview he accepts or nudges** ("add a 'condition' field") — never a blank schema form.
  - *Climax:* he accepts; the board exists and the next saved item is enriched against the generated schema.
  - *Resolution:* a new opinionated board with a point of view, created in a sentence.

## 3. Glossary

- **Board** — a typed collection with a point of view, defined by a Board Descriptor. Has many Items. Seeded examples: *Inspiration* (grid), *Library* (list).
- **Board Descriptor** — the schema-as-data record defining a Board: its ingest mode, typed Fields (closed type set), enrichment lens/prompt, and view. Stored, not hardcoded.
- **Field** — one typed attribute in a Board Descriptor (`type ∈ {text, number, date, url, enum, tags, image}`), optionally `enrichable`.
- **Item** — one saved thing in a Board (a captured source + its Fields + assets). Has a Status.
- **Capture / Ingest** — fetching/rendering a source into Item Fields + Assets, via a Capture Adapter keyed by ingest mode.
- **Asset** — a binary artifact for an Item (screenshot/image/thumbnail), stored as a file on disk with its path in the DB.
- **Enrichment** — an async LLM pass that fills an Item's `enrichable` Fields against the Board Descriptor's schema, via an LLM Provider.
- **LLM Provider** — a pluggable backend implementing `complete(prompt, schema)`; two transports — **HttpProvider** (API key / open model) and **CliProvider** (coding-agent subscription).
- **Composer** — the agentic skill that turns a natural-language description into a Board Descriptor the user accepts or refines.
- **Skill** — a registered capability `{ name, inputSchema, outputSchema, run(input, ctx) }`, invoked by a generic HTTP route.
- **Status** — an Item's enrichment lifecycle: `pending → processing → done → error`.

## 4. Features

### 4.1 Boards & schema-as-data
**Description:** Board behavior (ingest mode, typed Fields, enrichment lens, view) is stored as a **Board Descriptor**, not hardcoded. The two seeded Boards are descriptors like any other. The frontend renders an Item's Fields generically from the descriptor. Realizes UJ-1, UJ-4.

#### FR-1: Boards defined as data
A Board is defined by a stored Board Descriptor; the two seeded Boards (Inspiration, Library) are seeded descriptors.
**Consequences:** adding a Board type requires no schema migration; descriptor includes `{ fields[], enrichment_prompt, view, ingest_mode }`.

#### FR-2: Closed field-type set
Field `type` is restricted to `{text, number, date, url, enum, tags, image}`.
**Consequences:** a descriptor with an out-of-set type is rejected; this constraint underpins dynamic enrichment, rendering, search, and indexing.

#### FR-3: Dynamic rendering
The UI renders an Item's Fields via a field-type→component map, with no per-Board frontend code.
**Consequences:** a new descriptor renders without code changes.

### 4.2 Capture & ingestion
**Description:** Saving a source captures it into Item Fields + Assets via a Capture Adapter. v1 ships URL→screenshot (Inspiration) and URL→readable-text (Library, with SPA fallback), plus manual upload. Realizes UJ-1, UJ-3.

#### FR-4: URL capture
A user can save an Item by URL; Inspiration captures a full-page screenshot, Library extracts readable text (with a headless-render fallback for JS pages).
**Consequences:** screenshot stored as a file-on-disk with path/dimensions/hash in DB; text extraction handles SPA shells.

#### FR-5: Manual asset upload
A user can manually upload a screenshot/image for an Item (the graceful path when auto-capture fails).

#### FR-6: Capture adapter seam & concurrency cap
Capture is a `CaptureAdapter.fetch(source) → {fields, assets[]}` keyed by ingest mode; **capture concurrency is hard-capped at 1** with a per-capture timeout and guaranteed browser teardown.
**Consequences:** the Item model does not assume "every item is a URL"; two captures never run concurrently (no OOM on a 512MB LXC); a hung capture lands as `error`, never stuck `processing`.
**Out of Scope:** non-URL adapters (image upload as a *board type*, YouTube oEmbed) — seam reserved, adapters deferred.

### 4.3 Enrichment (pluggable, optional LLM)
**Description:** After capture, an async pass fills `enrichable` Fields against the Board Descriptor's schema, via a pluggable LLM Provider. Optional everywhere; graceful when absent. Realizes UJ-1, UJ-2.

#### FR-7: Dynamic, schema-driven enrichment
Enrichment builds the LLM prompt and the expected JSON-schema from the Board Descriptor (not a hardcoded constant) and validates the result.
**Consequences:** Inspiration yields design analysis + "steal this" + facets/tags; Library yields summary/topics/author/type/key-points; output validated against the descriptor.

#### FR-8: Pluggable provider, two transports
Enrichment runs through an `LLMProvider.complete(prompt, schema)` seam with **HttpProvider** (API key / OpenAI-compatible / open model via base-URL) and **CliProvider** (spawn `claude`/`codex`/`cursor-agent`).
**Consequences:** a user configures provider/key/base-URL/model; both transports pass one shared conformance suite.

#### FR-9: Optional & graceful
With no provider configured, capture + manual curation remain fully usable; AI Fields show a dignified disabled/empty state; a failed enrichment offers "Retry analysis."
**Consequences:** boot and first value never require an LLM; `CliProvider` is opt-in and never in the default install contract.

#### FR-10: Re-enrich / refetch
A user can re-run capture + enrichment for an Item, preserving user-authored Fields (notes, favorite).

### 4.4 Agentic composer
**Description:** The user describes a collection in natural language; the Composer proposes a finished Board Descriptor (with a stance) the user accepts or refines — never a blank-form builder. Built **after** the two seeded Boards prove the taste. Realizes UJ-4.

#### FR-11: Compose a board from a description
A user can create a new Board by describing what they collect; the Composer emits a Board Descriptor (name, ingest mode, typed Fields, enrichment lens, view).
**Consequences:** the emitted descriptor conforms to a meta-schema; the user previews and accepts/refines; nothing is written until accept.

#### FR-12: Composer guardrails
The emitted descriptor is validated against the meta-schema with a validate-and-repair loop; enforce field-type ∈ closed set, field-count ≤ N, no duplicate/reserved keys.
**Consequences:** an invalid/insane proposal is repaired or surfaced as an editable draft; composition is non-destructive by construction.
**Out of Scope:** a raw user-facing blank-form schema builder (permanently rejected).

### 4.5 Browse, organize & search
**Description:** Sidebar Board switcher; grid (Inspiration) and list (Library) views; detail modal; filters; per-Item notes/favorite/delete; full-text search. Realizes UJ-1.

#### FR-13: Browse & detail
A user can switch Boards, view items in the Board's view, and open a detail modal showing capture + enriched + user Fields.

#### FR-14: Filter
A user can filter a Board by topic / type / facet / tag.

#### FR-15: Per-item actions
A user can add notes, favorite, and delete an Item; user-authored Fields survive re-enrichment.

#### FR-16: Full-text search
A user can full-text search across captured text, titles, enriched summaries, and notes (FTS5).
**Consequences:** search is backed by a synthetic `search_blob` column maintained on write (net-new over the prototype).

### 4.6 Async job model & live status
**Description:** Saves return fast; enrichment completes later, with live status. Realizes UJ-1.

#### FR-17: Status lifecycle
Each Item carries a `status` (`pending → processing → done → error`); `error` persists the failure reason for display/retry.

#### FR-18: Live status (SSE) & optimistic save
The UI inserts the card optimistically and receives live status via SSE (poll fallback); no external broker.
**Consequences:** enrichment jobs drain on a single in-process worker queue (which is also the SQLite single-writer guard).

### 4.7 Skill-modular platform
**Description:** Every capability is a registered Skill with a typed contract, invoked by a generic route. Internals only in v1; external agent-operability deferred.

#### FR-19: Skill registry & generic invocation
Capabilities (import-bookmarks, create-board, add-item, generate-fields, tag, compose-board) are registered Skills `{name, inputSchema(zod), outputSchema(zod), run(input, ctx)}`, invoked by a single generic HTTP route; the UI is the only v1 client.
**Consequences:** zod contracts are mandatory (they are the future MCP tool schemas); no skill scheduler/bus (that would be a second runtime).

#### FR-20: Import
A user can import bookmarks (incl. the prototype's flat-JSON data) into Boards.

### 4.8 Configuration, data & deployment
**Description:** Env-driven config; data under a persistent dir; one-command LXC install; reverse-proxy auth.

#### FR-21: Env-driven config & persistent data
Deployment knobs (`PORT`, `HOST` default `127.0.0.1`, `DATA_DIR`, `CHROME_PATH` + autodetect, provider/base-URL/key/model) are env-driven; data (SQLite file + screenshots) lives under a persistent `DATA_DIR` separate from code.

#### FR-22: Reverse-proxy auth model
v1 ships **no built-in auth**, binds to localhost by default, and documents a reverse-proxy story; the internal capture contract is token-authed even on localhost.

#### FR-23: Packaging
The app installs on a Debian LXC (Node LTS + `npm ci` + systemd, non-root, persistent data path, `/healthz`), targeting community-scripts.org; an optional container image is provided.

## 5. Non-Goals (Explicit)
- **Not a generic typed-collection platform / blank-form builder** — the Composer supplies the opinion; a raw schema builder is the "worse Notion" trap, permanently rejected.
- **Not agent-operable as a primary surface in v1** — the UI is the front door; external MCP is a later adapter (zod contracts built now).
- **Not multi-user / collaborative / shared** — single-user, self-hosted.
- **Not becoming PKM-for-terminal-dwellers** — agent-native is the moat/onboarding, not the marketed identity; we lead with the board.

## 6. MVP Scope

### 6.1 In Scope
Two seeded Boards on schema-as-data · URL capture (screenshot + readable-text) + manual upload · async pluggable/optional LLM enrichment (HTTP + coding-CLI) · the agentic Composer (after the seeded boards) · skill-modular internals + generic HTTP route · import (incl. prototype data) · optimistic async-save UX + degraded/disabled states + zero-config first-run · FTS5 search · SQLite/Drizzle · env config · reverse-proxy-only auth · LXC packaging.

### 6.2 Out of Scope for MVP
- External agent-operability / MCP server *(deferred to v1.x — zod contracts built so it's an adapter, not a rewrite)*.
- Non-URL ingest adapters (image board, YouTube oEmbed) *(seam reserved; v1.x)*.
- YouTube-channel / RSS **feed-sync** *(separate scheduled-sync subsystem)*.
- **Vision-board / freeform-canvas view** *(net-new layout engine; the `view` field reserves the hook)* `[NOTE FOR PM: emotionally load-bearing — the founder's "Vision Board" idea; revisit post-v1]`.
- Built-in auth / multi-user; offloadable capture **sidecar service** *(contract designed v1, extraction v2)*; tag-management UI; browser extension; mobile.

## 7. Success Metrics
**Primary**
- **SM-1:** A stranger installs on a Debian LXC in one command and reaches "first item captured, looks great" with no docs and no LLM config. Validates FR-21, FR-23, UJ-3.
- **SM-2:** A user creates a new opinionated Board by describing it, and keeps/uses it. Validates FR-11, FR-12, UJ-4.

**Secondary**
- **SM-3:** Idle footprint fits ~512MB–1GB / 1 vCPU; capture never OOMs the box. Validates FR-6, NFR-1.
- **SM-4:** Enrichment works via API key, open model, *and* coding subscription. Validates FR-8.

**Counter-metrics (do not optimize)**
- **SM-C1:** Number of configurable schema knobs exposed in the UI — should stay *low*; the Composer supplies structure, we do not drift toward a database builder. Counterbalances FR-11.
- **SM-C2:** Share of the first-run/marketing surface that is terminal/agent-driven — should stay low; lead with the board. Counterbalances the agent-native moat.

## 8. Open Questions
1. Tags vs facets storage — normalized table vs JSON-array + generated-column index (decide in the storage epic against the filter queries).
2. Frontend evolution — keep vanilla-JS (lightest, already shipping) vs a small framework for the optimistic-save reactivity (lean: keep vanilla-JS unless UJ-1 forces otherwise).
3. Container image vs LXC-script as the *primary* polished distribution for launch.
4. Litestream backup default-on vs opt-in.
5. Marketed surface — *lead* with agent-native (founder leaning) vs board-first; architecture is identical either way.

## 9. Assumptions Index
- §2.2 — the audience runs its own reverse proxy (Caddy/Authelia/Tailscale), so v1 ships no built-in auth.
- §4.3 — an OpenAI-compatible HTTP surface + a coding-CLI subprocess cover the realistic provider space; open models reach us via base-URL.
- §6 — the prototype's shipping Fastify+frontend code is reused; this is an evolution, not a rewrite (~3× cheaper than re-platforming).
- §4.2 — Chromium launch→screenshot→kill keeps memory transient; concurrency-1 keeps it bounded.

---

## Cross-Cutting NFRs

- **NFR-1 — Footprint:** idle within ~512MB–1GB / 1-vCPU LXC; capture is the only heavy op and is bounded (concurrency 1, transient Chromium). Cap Node heap; bound streaming buffers.
- **NFR-2 — Datastore:** SQLite (WAL) + single-writer queue + `busy_timeout`; atomic writes; JSON columns; generated-column indexes on a fixed set of system columns; FTS5 over `search_blob`; screenshots as files-on-disk.
- **NFR-3 — Security (v1):** no built-in auth; bind `127.0.0.1` by default; documented reverse-proxy guidance; capture contract token-authed even on localhost; no secrets in subprocess argv.
- **NFR-4 — Resilience:** no blocking first-run; starts and serves with zero LLM/Chrome config (capabilities degrade independently); hung capture → clean retryable `error`.
- **NFR-5 — Testability:** capture orchestration, providers (HTTP + CLI), job worker, storage, and the composer guardrails are unit-testable in-process (Fastify `inject()`, mocked fetch/spawn); preserve the prototype's TDD posture; characterization-test the prototype's CLI parsing before refactor.
- **NFR-6 — Portability/reversibility:** data is a plain SQLite file + screenshots dir the user can copy and walk away with; optional Litestream backup.

## Constraints & Guardrails

- **Privacy:** self-hosted, single-user; LLM calls are user-configured (cloud, local, or subscription) and optional; nothing leaves the box without a configured provider.
- **Cost:** enrichment is per-call on the user's account/subscription — enrichment is lazy/on-demand, not eager-on-every-write beyond the single queued job; the BYO-subscription / open-model paths remove API-key cost-to-first-value.
- **Taste guardrail (product-defining):** the Composer must output a Board *with a stance*; if it degenerates into a schema-form filler it collapses into a generic builder — the line between wedge and trap (see SM-C1).

## Deployment & Hardware

- **Target:** Debian LXC on Proxmox, ~512MB–1GB RAM / 1 vCPU. Single Node process + SQLite + on-demand Chromium child process. No external DB/broker/search service.
- **Install shape:** Node LTS + `npm ci --omit=dev` + systemd unit (non-root) + persistent `DATA_DIR` + reverse proxy; `/healthz` for the install check; optional container image. Targets community-scripts.org norms.

## Technical addendum

Full architecture decision records (AD1–AD12), data-model sketch, transport mechanics, build order (E1–E9), and risk caveats (C1–C11) live in **`docs/prd.md`** and **`docs/research.md`**. This PRD intentionally states capabilities; the *how* is there.
