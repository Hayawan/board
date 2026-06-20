---
stepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - docs/bmad/PRD.md
  - docs/bmad/architecture.md
  - docs/bmad/brief.md
  - docs/prd.md
  - docs/research.md
title: board-oss — Epic Breakdown (v1)
created: 2026-06-20
---

# board-oss — Epic Breakdown

## Overview

Complete epic and story breakdown for board-oss v1, decomposing PRD requirements (FR-1..FR-23, NFR-1..NFR-6) and the architecture build order (E1–E9 + the cross-cutting skill platform) into implementable, single-dev-sized stories with testable (Given/When/Then) acceptance criteria. Stories are sequenced so none depends on a *later* story; each creates only the tables/modules it needs. TDD posture is preserved — acceptance criteria are test-shaped.

> **Note on existing stories:** `board-oss/stories/` holds STALE prototype stories (1-1..1-7) from the *old* `board` collections work. They are NOT part of this breakdown and should be deleted/ignored. This document and `docs/bmad/stories/` are the board-oss v1 backlog.

## Requirements Inventory

### Functional Requirements
FR-1 boards-as-data · FR-2 closed field-type set · FR-3 dynamic rendering · FR-4 URL capture (screenshot + readable) · FR-5 manual asset upload · FR-6 capture-adapter seam + concurrency-1 · FR-7 dynamic schema-driven enrichment · FR-8 pluggable provider (HTTP + CLI) · FR-9 optional & graceful enrichment · FR-10 re-enrich/refetch · FR-11 compose a board from a description · FR-12 composer guardrails · FR-13 browse & detail · FR-14 filter · FR-15 per-item actions (notes/favorite/delete) · FR-16 full-text search (FTS5) · FR-17 status lifecycle · FR-18 live status (SSE) + optimistic save · FR-19 skill registry + generic invocation · FR-20 import · FR-21 env config + persistent data · FR-22 reverse-proxy auth model · FR-23 packaging.

### NonFunctional Requirements
NFR-1 footprint (512MB–1GB; capture concurrency 1) · NFR-2 datastore (WAL, single-writer, FTS5/search_blob) · NFR-3 security (localhost bind, token-authed capture contract) · NFR-4 resilience (no blocking first-run, graceful degrade) · NFR-5 testability (in-process units, characterization-test CLI) · NFR-6 portability (plain SQLite + screenshots).

### Additional Requirements (caveats from docs/prd.md)
C1 capture concurrency=1 + timeout-kill · C2 capture contract designed (token-authed, idempotent) · C3 bind 127.0.0.1 · C4 status:error persists reason · C5 oslo not Lucia (v2) · C7 composer validate-and-repair · C10 zero-coding-CLI default · C11 closed field-type set.

### UX Design Requirements
UJ-1 optimistic save · UJ-2 degraded/disabled-LLM dignified state · UJ-3 zero-config warm first-run · UJ-4 agentic composer (describe → accept/refine).

### FR Coverage Map
| FR | Epic.Story |
|---|---|
| FR-1 | 1.2 | FR-2 | 1.2 | FR-3 | 7.2 |
| FR-4 | 6.2, 6.3 | FR-5 | 6.4 | FR-6 | 6.1, 6.5 |
| FR-7 | 7.1 | FR-8 | 4.1, 4.2, 4.3 | FR-9 | 4.4 |
| FR-10 | 7.3 | FR-11 | 10.1 | FR-12 | 10.2 |
| FR-13 | 8.1 | FR-14 | 8.2 | FR-15 | 8.3 |
| FR-16 | 9.1 | FR-17 | 5.2 | FR-18 | 5.3, 8.4 |
| FR-19 | 3.1, 3.2 | FR-20 | 1.5, 3.3 | FR-21 | 2.1, 2.2 |
| FR-22 | 2.4 | FR-23 | 11.1, 11.2 | NFR-1/C1 | 5.1, 6.5 |
| NFR-2 | 1.1, 1.3, 1.4 | UJ-2 | 8.5 | UJ-3 | 8.6 |

## Epic List

1. **Storage foundation** — SQLite/Drizzle schema-as-data, write-safety, FTS5, importer (E1).
2. **Configuration, data & portability** — env config, data dir, Chrome autodetect, localhost bind (E2).
3. **Skill-modular platform** — registry + generic route + import skill (cross-cutting).
4. **LLM provider seam** — HTTP + CLI transports, optional/graceful (E3).
5. **Async job model & live status** — single-writer queue, status, SSE (E4).
6. **Capture & ingest** — adapters, concurrency-1, manual upload (E5).
7. **Dynamic enrichment & rendering** — descriptor-driven enrichment, generic renderer, re-enrich (E2.5).
8. **Boards experience** — browse, filter, per-item actions, optimistic save, degraded/first-run (E6).
9. **Full-text search** — FTS5 search UX (E7).
10. **Agentic composer** — describe → propose → accept/refine (E8).
11. **Packaging & community-scripts** — systemd/LXC/container, healthz (E9).

---

## Epic 1: Storage foundation (schema-as-data)

**Goal:** Replace flat-JSON with SQLite/Drizzle on a schema-as-data model, with write-safety, FTS5 over a synthetic search blob, and a one-shot importer that seeds the two boards. This is the foundation every later epic sits on. *(NFR-2, C11.)*

### Story 1.1: SQLite + Drizzle schema with board / item / asset tables
As the board-oss maintainer,
I want the core tables created via Drizzle with WAL enabled,
So that data persists durably in a single SQLite file instead of flat JSON.

**Acceptance Criteria:**
**Given** a fresh `DATA_DIR`, **When** the app boots, **Then** a SQLite file is created with `board`, `item`, `asset` tables matching the architecture data model, and `PRAGMA journal_mode=WAL` is set.
**And** `item` includes `fields (JSON)`, `search_blob (text)`, `status`, `error_reason`, `favorite`, `notes`, `analysis_provider/model`, timestamps; `asset` holds `kind/path/width/height/hash`.
**And** a unit test opens the DB, asserts the schema, and round-trips a board+item+asset insert/select.

### Story 1.2: Board descriptor (schema-as-data) + closed field-type set + seeded boards
As the board-oss maintainer,
I want board behavior stored as a `descriptor` on a closed field-type set, with the two boards seeded,
So that board types are data (not code) and the rest of the system reads them generically. *(FR-1, FR-2, C11.)*

**Acceptance Criteria:**
**Given** the schema from 1.1, **When** migrations/seed run, **Then** `board.descriptor` JSON exists and the Inspiration (grid) and Library (list) boards are seeded as descriptors with `{ fields[], enrichment_prompt, view, ingest_mode }`.
**Given** a descriptor with a field `type` outside `{text,number,date,url,enum,tags,image}`, **When** it is validated, **Then** validation rejects it with a clear error.
**And** a unit test asserts the two seeded descriptors load and an out-of-set field type is rejected.

### Story 1.3: Single-writer queue + atomic writes + busy_timeout
As the board-oss maintainer,
I want all writes serialized through one writer with `busy_timeout`,
So that concurrent/bursty writes never corrupt the DB. *(NFR-2.)*

**Acceptance Criteria:**
**Given** N concurrent write requests, **When** they execute, **Then** all N land (none lost) and no `SQLITE_BUSY` error surfaces to the caller.
**And** `busy_timeout` is set and writes go through a single serialized path (the future job worker reuses it).
**And** a test fires N parallel writes and asserts all N rows are present.

### Story 1.4: FTS5 over a synthetic search_blob
As the board-oss maintainer,
I want an FTS5 table over a single `search_blob` column maintained on write,
So that full-text search works across dynamic fields without per-field FTS columns. *(NFR-2, foundation for FR-16.)*

**Acceptance Criteria:**
**Given** an item written with enrichable/text fields, **When** the write completes, **Then** `search_blob` is the concatenation of those fields and the FTS5 table is updated.
**Given** a query term present in an item's fields, **When** the FTS5 table is queried, **Then** the item is returned.
**And** a test writes items with arbitrary fields and asserts write→search_blob→FTS query returns the right rows.

### Story 1.5: Flat-JSON → SQLite importer
As a prototype user migrating to board-oss,
I want my existing `bookmarks.json` / `library.json` imported into SQLite,
So that I keep my data. *(FR-20 part 1.)*

**Acceptance Criteria:**
**Given** prototype flat-JSON files, **When** the importer runs, **Then** each record becomes an `item` under the correct seeded board, with assets linked and `search_blob` populated.
**And** the importer is idempotent (re-running does not duplicate) and a round-trip test asserts counts + a sampled record's fields.

---

## Epic 2: Configuration, data & portability

**Goal:** Make every deployment knob env-driven, root data under a persistent dir, autodetect Chrome on Linux, and bind localhost by default. *(FR-21, FR-22, NFR-3.)*

### Story 2.1: Env-driven config loader
As a self-hoster,
I want all settings from environment variables with sane defaults,
So that I configure board-oss without editing source. *(FR-21.)*

**Acceptance Criteria:**
**Given** unset env, **When** the app boots, **Then** defaults apply (`PORT`, `HOST=127.0.0.1`, `DATA_DIR`, provider unset = no-AI).
**Given** env overrides, **When** the app boots, **Then** they win; a test asserts default + override resolution for each key.

### Story 2.2: DATA_DIR-rooted persistent paths
As a self-hoster,
I want the SQLite file and screenshots under `DATA_DIR`, separate from app code,
So that upgrades never nuke my data. *(FR-21, NFR-6.)*

**Acceptance Criteria:**
**Given** a `DATA_DIR`, **When** the app boots, **Then** the DB file and screenshots dir are created under it (not under app code).
**And** a test asserts all four data paths derive from `DATA_DIR`.

### Story 2.3: CHROME_PATH resolution + Linux autodetect
As a self-hoster on Debian,
I want Chrome located via `CHROME_PATH` or autodetect,
So that capture works off the macOS-only hardcoded path. *(supports FR-4.)*

**Acceptance Criteria:**
**Given** `CHROME_PATH` set, **When** resolved, **Then** it wins. **Given** unset, **Then** autodetect checks `chromium`, `chromium-browser`, `google-chrome`. **Given** none found, **Then** a named error tells the user to set `CHROME_PATH`.
**And** a unit test covers env-wins / detect / missing-throws.

### Story 2.4: Localhost bind default + reverse-proxy posture
As a security-conscious self-hoster,
I want board-oss bound to 127.0.0.1 with documented reverse-proxy guidance,
So that it is never accidentally world-exposed. *(FR-22, NFR-3, C3.)*

**Acceptance Criteria:**
**Given** default config, **When** the server starts, **Then** it binds `127.0.0.1`; binding `0.0.0.0` requires an explicit `HOST` override.
**And** the README documents the reverse-proxy story; a test asserts the default bind address.

---

## Epic 3: Skill-modular platform

**Goal:** Establish the skill registry and the single generic invocation route, so every capability is a typed `Skill` from the start (zod contracts = future MCP schemas). *(FR-19, AD11.)*

### Story 3.1: Skill interface + registry + ctx injection
As the board-oss maintainer,
I want a `Skill { name, inputSchema, outputSchema, run(input, ctx) }` registry with injected `ctx`,
So that capabilities are uniform, testable, and globals-free. *(FR-19.)*

**Acceptance Criteria:**
**Given** a registered skill, **When** the registry is queried by name, **Then** it returns the skill; `ctx` carries `{db, llm, queue, logger}` (all mockable).
**And** a unit test registers a fake skill and runs it with a mock ctx, asserting no global access.

### Story 3.2: Generic /skills/:name HTTP route with zod validation
As the frontend,
I want one route that validates input, runs the named skill, and validates output,
So that adding a capability needs no new bespoke route. *(FR-19.)*

**Acceptance Criteria:**
**Given** `POST /skills/:name` with a valid body, **When** invoked, **Then** input is `inputSchema.parse`d, `run` executes, output is validated and returned.
**Given** an invalid body, **Then** a 400 with the zod error is returned; a test uses Fastify `inject()` for valid + invalid.

### Story 3.3: import-bookmarks skill
As a user,
I want an import skill that ingests bookmarks (incl. prototype JSON) into a board,
So that import is a first-class, invokable capability. *(FR-20 part 2.)*

**Acceptance Criteria:**
**Given** a bookmarks payload, **When** the `import-bookmarks` skill runs, **Then** items are created under the target board with `status=pending`.
**And** a unit test runs the skill with a mock ctx and asserts created items + dedupe.

---

## Epic 4: LLM provider seam

**Goal:** A pluggable `LLMProvider.complete(prompt, schema)` with two transports, optional and graceful, defaulting to zero-coding-CLI. *(FR-8, FR-9, AD5, C10.)*

### Story 4.1: LLMProvider interface + conformance suite
As the board-oss maintainer,
I want one provider interface and a shared conformance suite,
So that any transport is provider-agnostic to the rest of the system. *(FR-8.)*

**Acceptance Criteria:**
**Given** the `complete(prompt, schema)` interface, **When** a fake backend implements it, **Then** a reusable conformance suite passes against it (valid structured output, schema-mismatch → typed error).

### Story 4.2: HttpProvider (API key + open model)
As a user with an API key or local model,
I want an OpenAI-compatible HTTP provider,
So that I can enrich via cloud or Ollama/LM-Studio with one code path. *(FR-8.)*

**Acceptance Criteria:**
**Given** a base-URL + key + model, **When** `complete` is called, **Then** it uses native JSON-mode/tool-calling and `schema.parse`s the result; open-model is config (base-URL), not a separate class.
**And** a unit test injects `fetch` and asserts request shape + parse; the provider passes the 4.1 conformance suite.

### Story 4.3: CliProvider (coding-agent subprocess)
As a user with a Claude Code / Codex / Cursor subscription,
I want a provider that drives my coding-agent CLI,
So that I can enrich without an API key. *(FR-8.)*

**Acceptance Criteria:**
**Given** the prototype's `add.ts buildAnalysisCommand`, **When** I begin, **Then** a characterization test first pins its current argv-build + stdout-parse (NFR-5).
**Given** a configured CLI provider, **When** `complete` is called, **Then** it spawns the agent, injects the JSON-schema into the prompt, parses+revalidates stdout, and hardens lifecycle (timeout/kill, exit→typed error, no secrets in argv).
**And** a unit test injects the spawner (canned stdout/exit) — no real subprocess; passes the 4.1 conformance suite.

### Story 4.4: Optional & graceful provider selection (zero-coding-CLI default)
As a stranger installing board-oss,
I want enrichment to be optional with a no-AI default,
So that nothing requires a coding CLI or key to start. *(FR-9, C10, NFR-4.)*

**Acceptance Criteria:**
**Given** no provider configured, **When** the app boots, **Then** it starts and serves; enrichment is a no-op that leaves items capturable/manual.
**Given** provider config, **When** set, **Then** the matching transport is selected; the default install path never requires `CliProvider`.
**And** tests cover no-provider (graceful) and each provider selection.

---

## Epic 5: Async job model & live status

**Goal:** Saves return fast; capture+enrichment run on a single-writer worker queue with a status lifecycle streamed over SSE. *(FR-17, FR-18, AD6, C1, C4.)*

### Story 5.1: Single-writer worker queue (capture concurrency 1)
As the board-oss maintainer,
I want one async worker draining jobs serially,
So that capture concurrency is 1 and writes stay single-writer. *(NFR-1, C1.)*

**Acceptance Criteria:**
**Given** multiple queued capture jobs, **When** they run, **Then** at most one executes at a time (concurrency 1) and each has a wall-clock timeout.
**And** a test enqueues N jobs and asserts serial execution + that a timed-out job is killed and marked failed.

### Story 5.2: Item status lifecycle with persisted error reason
As a user,
I want each item to carry a status and a persisted error reason,
So that I can see and retry failures. *(FR-17, C4.)*

**Acceptance Criteria:**
**Given** a job, **When** it progresses, **Then** `status` moves `pending→processing→done`; on failure it becomes `error` with `error_reason` persisted (never stuck `processing`).
**And** a test drives a failing job and asserts the `error` row + reason.

### Story 5.3: SSE status endpoint
As the frontend,
I want a server-sent-events stream of status transitions,
So that cards update live without polling. *(FR-18.)*

**Acceptance Criteria:**
**Given** an open SSE connection, **When** an item's status changes, **Then** an event is emitted; a poll/refetch fallback exists.
**And** a test asserts an SSE event fires on a simulated transition.

---

## Epic 6: Capture & ingest

**Goal:** Generalize capture into a `CaptureAdapter` keyed by ingest mode; ship the URL screenshot + readable-text adapters and manual upload, with concurrency-1 safety. *(FR-4, FR-5, FR-6, AD4, C1, C2.)*

### Story 6.1: CaptureAdapter interface + ingest dispatch
As the board-oss maintainer,
I want `CaptureAdapter.fetch(source) → {fields, assets[]}` keyed by `ingest_mode`,
So that the item model is source-agnostic and new adapters slot in later. *(FR-6.)*

**Acceptance Criteria:**
**Given** a board's `ingest_mode`, **When** an item is captured, **Then** the matching adapter runs and returns `{fields, assets}`; the item does not assume a URL.
**And** the internal capture contract is token-authed + idempotent-on-retry (C2); a unit test covers dispatch + a fake adapter.

### Story 6.2: URL → screenshot adapter (Inspiration)
As an Inspiration collector,
I want a full-page screenshot captured for a URL,
So that my visual board shows the site. *(FR-4.)*

**Acceptance Criteria:**
**Given** a URL, **When** the screenshot adapter runs, **Then** Chrome launches→screenshots→closes (in `finally`), the image is stored as a file, and its path/dims/hash are written to `asset`.
**And** a test (injected browser) asserts teardown-on-error and the asset record.

### Story 6.3: URL → readable-text adapter (Library, SPA fallback)
As a Library collector,
I want readable text extracted from a URL with a JS-render fallback,
So that articles (incl. SPAs) capture their content. *(FR-4.)*

**Acceptance Criteria:**
**Given** an article URL, **When** the readable adapter runs, **Then** Readability+turndown extract markdown; **Given** a JS-rendered shell yielding too little text, **Then** it falls back to a headless render.
**And** unit tests over HTML fixtures (injected fetch) cover article extraction and the empty-shell fallback (port the prototype's `captureLibrary`).

### Story 6.4: Manual asset upload
As a user whose auto-capture failed,
I want to upload a screenshot/image for an item,
So that I always have a graceful path. *(FR-5.)*

**Acceptance Criteria:**
**Given** an item, **When** I upload an image, **Then** it is stored as an asset and linked; a test asserts the stored file + asset row.

### Story 6.5: Capture concurrency & timeout safety
As a 512MB-LXC self-hoster,
I want capture hard-capped at one Chrome at a time with a kill-timeout,
So that capture never OOMs my box. *(FR-6, NFR-1, C1.)*

**Acceptance Criteria:**
**Given** two capture requests, **When** they run, **Then** only one Chrome is live at a time (capture runs on the single worker from 5.1).
**Given** a hung capture, **When** the timeout fires, **Then** the browser is force-closed and the item marked `error`.

---

## Epic 7: Dynamic enrichment & rendering

**Goal:** Enrichment builds its prompt+schema from the board descriptor and writes validated fields; the frontend renders fields generically; items can be re-enriched. The two seeded boards now come alive. *(FR-7, FR-3, FR-10.)*

### Story 7.1: Descriptor-driven enrichment worker
As a user,
I want enrichment to fill fields based on my board's descriptor,
So that each board enriches through its own lens. *(FR-7.)*

**Acceptance Criteria:**
**Given** a captured item and its board descriptor, **When** the enrichment job runs, **Then** the worker builds the prompt + JSON-schema from the descriptor, calls `LLMProvider.complete`, validates, and writes `enrichable` fields + updates `search_blob`.
**And** Inspiration yields design-analysis + "steal this" + facets/tags; Library yields summary/topics/author/type/key-points; a test (mock provider) asserts schema-from-descriptor and the written fields.

### Story 7.2: Generic field renderer (field-type → component)
As a user,
I want item cards to render any descriptor's fields,
So that boards display without per-board frontend code. *(FR-3.)*

**Acceptance Criteria:**
**Given** an item + descriptor, **When** rendered, **Then** each field renders via a field-type→component map over the closed set; an unknown type degrades safely.
**And** a test renders a sample descriptor's fields and asserts the component mapping.

### Story 7.3: Re-enrich / refetch (preserve user fields)
As a user,
I want to re-run capture+enrichment on an item,
So that I can refresh analysis without losing my notes/favorite. *(FR-10.)*

**Acceptance Criteria:**
**Given** an item with notes/favorite, **When** I refetch, **Then** capture+enrichment re-run but user-authored fields are preserved; a test asserts preservation.

---

## Epic 8: Boards experience

**Goal:** The browseable product — sidebar switcher, grid/list views, detail modal, filters, per-item actions, optimistic save, and the degraded + first-run states. *(FR-13, FR-14, FR-15, FR-18; UJ-1, UJ-2, UJ-3.)*

### Story 8.1: Board switcher, views & detail modal
As a user, I want to switch boards, see grid/list views, and open item details,
So that I can browse my collections. *(FR-13.)*

**Acceptance Criteria:**
**Given** ≥1 board, **When** I load the UI, **Then** a sidebar lists boards; selecting one shows its view (grid for Inspiration, list for Library); opening an item shows capture + enriched + user fields.

### Story 8.2: Filters
As a user, I want to filter a board by topic/type/facet/tag,
So that I can narrow a large board. *(FR-14.)*

**Acceptance Criteria:**
**Given** items with facet/tag fields, **When** I apply a filter, **Then** only matching items show; a test asserts filtered results.

### Story 8.3: Per-item actions (notes, favorite, delete)
As a user, I want to annotate, favorite, and delete items,
So that I can curate. *(FR-15.)*

**Acceptance Criteria:**
**Given** an item, **When** I edit notes / toggle favorite / delete, **Then** the change persists (delete removes the item + its assets); tests cover each via the API.

### Story 8.4: Optimistic save (card appears instantly, fields shimmer→fill)
As a collector, I want a saved card to appear instantly and fill in live,
So that the app feels fast though the robot is slow. *(FR-18; UJ-1.)*

**Acceptance Criteria:**
**Given** I save a URL, **When** the request is accepted, **Then** a card appears immediately with a status shimmer (`queued→capturing→enriching`) and I can save the next URL right away.
**Given** SSE transitions arrive, **Then** the card's fields fill in underneath; final state `done` or `error` (with retry).

### Story 8.5: Degraded / disabled-LLM dignified state
As a user with no/failed LLM, I want a complete card with a dignified empty state,
So that nothing looks broken. *(UJ-2, FR-9.)*

**Acceptance Criteria:**
**Given** enrichment disabled or failed, **When** an item saves, **Then** the card shows title/screenshot/notes/tags and a quiet "No analysis — enrichment disabled" or a single "Retry analysis" — never raw error text.

### Story 8.6: Warm zero-config first-run
As a stranger on first launch, I want a warm empty state that works with zero config,
So that I reach first value in one paste. *(UJ-3, NFR-4.)*

**Acceptance Criteria:**
**Given** a fresh install with no LLM, **When** I open the UI, **Then** each board shows a warm empty state + a capture field; pasting one URL captures and displays it; a dismissible nudge offers to enable AI.

---

## Epic 9: Full-text search

**Goal:** Expose FTS5 search across captured text, titles, summaries, and notes. *(FR-16.)*

### Story 9.1: Search UX over search_blob
As a user, I want to full-text search my items,
So that I can re-find things. *(FR-16.)*

**Acceptance Criteria:**
**Given** a query, **When** I search, **Then** results rank over the `search_blob` FTS5 index (from 1.4) across captured text/title/summary/notes; a test asserts a known item is found by a term in its fields.

---

## Epic 10: Agentic composer

**Goal:** The thesis feature — describe a collection and get a finished, opinionated board you accept or refine. Built AFTER the seeded boards (Epics 1–9) prove the taste. *(FR-11, FR-12; UJ-4; C7.)*

### Story 10.1: Compose a board from a description
As a user, I want to describe what I collect and get a proposed board,
So that I can create an opinionated board without designing a schema. *(FR-11.)*

**Acceptance Criteria:**
**Given** a natural-language description, **When** the `compose-board` skill runs, **Then** the LLM emits a board descriptor (name, ingest_mode, typed fields, enrichment_prompt, view) conforming to the meta-schema; I see a preview I can accept or refine; nothing is written until accept.
**And** on accept, a board is created and the next saved item enriches against it; a test (mock provider) asserts a valid descriptor is produced and only persisted on accept.

### Story 10.2: Composer guardrails (validate-and-repair)
As the board-oss maintainer, I want the composer output validated and repaired,
So that a bad LLM proposal can't create an insane board. *(FR-12, C7, C11.)*

**Acceptance Criteria:**
**Given** an emitted descriptor, **When** validated, **Then** field types must be in the closed set, field count ≤ N, no duplicate/reserved keys; on failure one repair re-ask runs, else it surfaces as an editable draft.
**And** adversarial tests (off-list types, 500 fields, reserved keys, malformed JSON) assert the guardrails reject/repair and never write on failure.

---

## Epic 11: Packaging & community-scripts

**Goal:** One-command self-host on a Debian LXC, plus an optional container image and a healthcheck. *(FR-23, NFR-1, NFR-3.)*

### Story 11.1: Systemd / LXC install + healthz
As a self-hoster, I want a one-command LXC install with a systemd service,
So that board-oss runs on boot as a non-root user. *(FR-23.)*

**Acceptance Criteria:**
**Given** a Debian LXC, **When** the install script runs, **Then** Node LTS + `npm ci --omit=dev` + chromium deps install, a non-root service user is created, a systemd unit runs the server on a persistent `DATA_DIR`, and `/healthz` returns OK.
**And** the unit binds localhost; docs cover the reverse proxy.

### Story 11.2: Container image
As a self-hoster preferring Docker, I want a container image,
So that I can run board-oss with a mounted data volume. *(FR-23.)*

**Acceptance Criteria:**
**Given** the image, **When** I run it with a `/data` volume + `CHROME_PATH`, **Then** it boots, serves, and one real capture succeeds; CI builds the image and hits `/healthz`.

---

## Coverage check

Every FR-1..FR-23 maps to ≥1 story (see FR Coverage Map); NFR-1/2/3/4/5/6 are covered by 5.1/6.5 (footprint), 1.1/1.3/1.4 (datastore), 2.4 (security), 4.4/8.6 (resilience), characterization/unit tests throughout (testability), 1.1/2.2 (portability). UJ-1..UJ-4 map to 8.4 / 8.5 / 8.6 / 10.1. Sequencing honored: seeded boards (Epics 1–9) precede the composer (Epic 10); the skill registry + zod contracts (Epic 3) are established before capability epics.
