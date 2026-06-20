---
title: board-oss — Architecture / Solution Design
status: draft
created: 2026-06-20
updated: 2026-06-20
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
inputs:
  - docs/bmad/PRD.md
  - docs/bmad/brief.md
  - docs/prd.md          # deep ADRs AD1-AD12, build order, caveats C1-C11
  - docs/research.md      # framework/datastore decision brief
note: "Decisions were reached by multi-round party consensus; this formalizes them. Deep rationale lives in docs/prd.md and docs/research.md."
---

# board-oss — Architecture / Solution Design

## 1. Context & scope

`board-oss` evolves the `board` prototype (Node/TS + Fastify + vanilla-JS + flat-JSON) into a lightweight, self-hostable, agent-native curation tool. The architecture is an **evolution of the prototype's spine**, not a rewrite — it reuses the shipping Fastify `buildServer`, the collection-scoped API, and the vanilla-JS frontend, swapping the storage layer and generalizing the capture + enrichment seams. Target host: a small Proxmox LXC (~512MB–1GB RAM, 1 vCPU). Binding constraint: headless Chromium (~400–520MB resident while rendering) → capture is launch-per-job, killed immediately, **concurrency 1**.

## 2. Tech stack (the "starter")

| Concern | Choice | Notes |
|---|---|---|
| Runtime | Node.js (pinned LTS), TypeScript | evolve the prototype |
| HTTP | Fastify | keep `buildServer`; `@fastify/static` for assets |
| Datastore | **SQLite via Drizzle** | WAL, JSON columns, generated-column indexes, FTS5 |
| Capture | `puppeteer-core` → system Chromium | `CHROME_PATH` env + Linux autodetect |
| Text extract | `@mozilla/readability` + `jsdom` + `turndown` | from prototype (Library) |
| Validation | `zod` | skill in/out contracts, provider schemas, composer meta-schema |
| Realtime | SSE (native) | no WebSocket, no broker |
| Auth (v1) | none — reverse-proxy | bind `127.0.0.1`; `oslo`+`argon2` reserved for v2 |
| Frontend | vanilla-JS (prototype) | generic field renderer added; revisit only if optimistic-save forces it |

**Rejected** (see `docs/research.md`): PocketBase/Payload/Directus as host, NoSQL, multi-container stacks, Redis/BullMQ.

## 3. Architectural decisions (condensed; full ADRs in `docs/prd.md` §6)

- **AD1 Lean Hybrid** — own the Node/Fastify spine (capture orchestration, async enrichment, boards API); buy commodity as libraries.
- **AD3 SQLite/Drizzle** — WAL + JSON + FTS5; screenshots files-on-disk, path in DB.
- **AD4 Capture in-process, concurrency 1** — launch→screenshot→kill; the offloadable sidecar *service* is deferred but its **contract is designed in v1** (token-authed, idempotent).
- **AD5 `LLMProvider` seam, two transports** — `HttpProvider` (API key / open model) + `CliProvider` (coding-agent subprocess); default install zero-coding-CLI.
- **AD6 Async job model** — in-process single-writer worker queue + `status` column + SSE; no external broker. The queue **is** the SQLite single-writer guard.
- **AD7 Reverse-proxy-only auth** — localhost bind default.
- **AD9 Schema-as-data** — board behavior is a stored `board_descriptor` on a closed field-type set; enrichment + rendering are dynamic.
- **AD10 Agentic composer** — v1 launch feature, built after the seeded boards; meta-schema + validate-and-repair.
- **AD11 Skill-modular internals (Spectrum C)** — every capability is a registered `Skill`, invoked by a generic HTTP route; zod contracts mandatory; no skill scheduler/bus.
- **AD12 Agent-operability deferred** — UI is the only v1 client; in-process off-by-default MCP later. *(Founder relaxed the marketing guard 2026-06-20 — may lead with the agent story; architecture unchanged.)*

## 4. Core patterns & contracts (the consistency-critical seams)

### 4.1 Skill contract (AD11)
```ts
type Ctx = { db: Drizzle; llm: LLMProvider; queue: JobQueue; collectionId?: string; logger: Logger };
interface Skill<I, O> {
  name: string;
  inputSchema: ZodType<I>;
  outputSchema: ZodType<O>;
  run(input: I, ctx: Ctx): Promise<O>;
}
```
- One `registry: Map<string, Skill>`, populated at boot. `run` never reaches a global — everything via `ctx` (so everything is mockable).
- **One generic route:** `POST /skills/:name` → `inputSchema.parse` → `run` → `outputSchema`. The UI is the only v1 caller.
- v1 skills: `import-bookmarks`, `create-board`, `add-item`, `generate-fields`, `tag`, `compose-board`.
- Skills call each other as **plain function calls** — no event bus/scheduler (that would be a second runtime).

### 4.2 LLM provider contract (AD5)
```ts
interface LLMProvider { complete<T>(prompt: string, schema: ZodType<T>): Promise<T>; }
```
- `HttpProvider` — OpenAI-compatible; API key + base-URL (open models/Ollama are config of this class). Native JSON-mode/tool-calling → `schema.parse`.
- `CliProvider` — spawn `claude`/`codex`/`cursor-agent`; inject JSON-schema into prompt; parse + revalidate stdout; **lifecycle hardening**: timeout/kill, exit→typed error, stderr captured, no secrets in argv. Resurrected from the prototype's `add.ts buildAnalysisCommand` (characterization-test first).
- A shared **provider-conformance suite** runs against both impls with a fake backend.

### 4.3 Capture adapter contract (AD4)
```ts
interface CaptureAdapter { fetch(source: string, ctx): Promise<{ fields: Record<string,unknown>; assets: AssetSpec[] }>; }
```
- Keyed by the board's `ingest_mode`. v1: `url-screenshot` (Inspiration), `url-readable` (Library, with SPA render fallback), `manual-upload`.
- **Concurrency 1**, enforced by running capture on the single serialized worker; per-capture timeout + `browser.close()` in `finally`.
- Designed (not extracted) sidecar contract: token-authed, idempotent-on-retry — so a future offloadable capture service is lift-and-shift.

### 4.4 Schema-as-data descriptor (AD9)
- `board.descriptor` JSON: `{ fields: [{key,label,type∈closed-set,enrichable}], enrichment_prompt, view, ingest_mode }`.
- **Dynamic enrichment:** the worker builds the prompt + JSON-schema from the descriptor → `LLMProvider.complete`.
- **Dynamic rendering:** a field-type→component map over the closed set.
- **Composer meta-schema:** the JSON-schema *for a descriptor*; the composer emits a descriptor validated against it (validate-and-repair; closed types; field cap; reserved-key rejection).

### 4.5 Job model & status (AD6)
- `JobQueue` = a single async worker draining jobs serially; capture + enrichment jobs run here (this is also the SQLite single-writer).
- `item.status`: `pending → processing → done → error` (`error_reason` persisted). SSE endpoint streams transitions; refetch/poll fallback.

## 5. Data model

- **`board`** `{ id, name, view, descriptor (JSON), created_at, updated_at }`.
- **`item`** `{ id, board_id, source, title, status, error_reason, favorite, notes, fields (JSON), search_blob (text), analysis_provider, analysis_model, created_at, updated_at }`.
- **`asset`** `{ id, item_id, kind, path, width, height, hash, captured_at }` (0..n per item).
- **FTS5** virtual table over `search_blob` only (synthetic concat of enrichable/text fields, assembled on write — *not* per-field columns; this is a non-deferrable storage decision).
- **Indexes:** generated-column indexes on fixed system columns (`board_id`, `status`, `favorite`, `created_at`); custom-field filtering via `json_extract` scans at v1 scale (lazy index promotion deferred).
- **Storage guards:** WAL, single-writer queue, `busy_timeout`, atomic writes; flat-JSON → SQLite importer seeds the two descriptors.

## 6. Source-tree / module structure (indicative)

```
board-oss/
  server.ts                 # buildServer (Fastify) — generic /skills/:name route, SSE, static
  config.ts                 # env-driven config (PORT, HOST, DATA_DIR, CHROME_PATH, provider…)
  db/
    schema.ts               # Drizzle schema (board, item, asset, FTS5)
    queue.ts                # single-writer worker queue
    importer.ts             # flat-JSON → SQLite
  skills/
    registry.ts             # Skill registry + generic dispatch
    import-bookmarks.ts  create-board.ts  add-item.ts  generate-fields.ts  tag.ts  compose-board.ts
  llm/
    provider.ts             # LLMProvider interface + conformance suite
    http-provider.ts  cli-provider.ts
  capture/
    adapter.ts              # CaptureAdapter interface
    url-screenshot.ts  url-readable.ts  manual-upload.ts
    browser.ts              # launch→screenshot→kill, CHROME_PATH autodetect (from prototype)
  enrichment/
    worker.ts               # descriptor → prompt+schema → provider → validate → write
  descriptor/
    meta-schema.ts          # the schema-for-descriptors (composer target)
    render-map.ts           # field-type → component (frontend)
  public/                   # vanilla-JS frontend (evolved prototype index.html)
```

## 7. Validation & cross-cutting (caveats are load-bearing)

- **NFR footprint:** capture concurrency 1 + transient Chromium; cap Node heap; bound streaming buffers (NFR-1, C1/C6).
- **Security:** bind `127.0.0.1`; reverse-proxy story; capture contract token-authed even localhost; no secrets in argv (NFR-3, C3, C10).
- **Resilience:** boot with zero LLM/Chrome config; degrade independently; hung capture → clean `error` (NFR-4, C4).
- **Testability (TDD):** Skills, providers (HTTP+CLI), worker, storage, composer guardrails unit-testable in-process; characterization-test the prototype CLI parsing before refactor (NFR-5, C7).
- **Closed field-type set** keeps enrichment/rendering/FTS/index tractable (C11).
- **`oslo` not Lucia** when auth lands (C5).

## 8. Implementation sequence → handoff

Build order (maps to PRD §6 / epics): **E1** storage foundation (schema-as-data, FTS5/search_blob, queue, importer) → **E2** config & portability → **E2.5** generic renderer + dynamic enrichment → **E3** `LLMProvider` two-transport seam → **E4** async job model + status + SSE → **E5** ingest (`CaptureAdapter`) → **E6** experience UX + the two seeded boards working → **E7** FTS5 search → **E8** agentic composer → **E9** packaging (systemd/LXC/container, `/healthz`, community-scripts).

Sequencing rule: the two seeded boards (E6) land **before** the composer (E8). The skill-registry + zod-contract discipline is cross-cutting from E1 so MCP/CLI become later adapters, not rewrites.

→ Hand off to **`bmad-create-epics-and-stories`**: each E-item becomes an epic; FRs (PRD §4) and the contracts above become stories with testable acceptance criteria.
