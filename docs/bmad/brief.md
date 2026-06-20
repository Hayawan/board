---
title: "Product Brief: board-oss"
status: draft
created: 2026-06-20
updated: 2026-06-20
source: distilled from docs/product-brief.md, docs/prd.md, docs/research.md (multi-round party consensus)
---

# Product Brief: board-oss

## Executive Summary

`board-oss` is the open-source, self-hostable successor to the `board` prototype — and it makes a bigger bet than its parent. Where `board` shipped two hand-built boards (a visual *Inspiration* grid, a *Library* reading list), `board-oss` is an **AI taste-engine**: you describe what you collect, and an agent carrying the product's taste composes a finished, opinionated board for it — its capture mode, the attributes worth keeping, the enrichment lens, the layout — which you accept or nudge. The two original boards ship as the composer's reference examples, not as the whole product.

The thesis in one line: **"AI composes opinionated boards for anything you collect."** The moat is not the boards; it's the *board-generating taste* — a thing Notion structurally cannot do (it has no point of view to lend you) and that self-hosted bookmark managers (Linkwarden, Karakeep) aren't built for. It runs lightweight enough for a small Proxmox LXC, keeps your data in a plain SQLite file you own, and lets you bring any LLM — an API key, an open model, or your existing Claude Code / Codex / Cursor subscription.

Why now: self-hosters increasingly run local models and live inside coding agents; agent-native curation is a lane the incumbents haven't entered. The author is user-zero, which gives v1 the tightest possible product-market fit.

## The Problem

People who collect online inspiration — designers, indie hackers, design-literate developers — accumulate a junk drawer of links and screenshots that never resolve into anything usable. The existing tools split badly:

- **SaaS curation (Are.na, Mymind, Pocket):** lovely, but not yours — subscription-gated, privacy-surrendering, not self-hostable.
- **Self-hosted bookmarkers (Linkwarden, Karakeep):** yours, but soulless — their AI produces metadata-for-search (tags, generic summaries). Neither *interprets* a page aesthetically, neither offers a browsable visual-inspiration wall, and both are heavy (multi-container, Meilisearch-backed, 700MB–2GB+).
- **Generic databases (Notion):** infinitely flexible, and therefore opinionless — flexibility is the *absence* of taste.

No lightweight, self-hostable tool *has taste*: looks at what you saved and tells you why it's good and what to steal from it — and lets you spin up a new opinionated collection just by describing it.

## The Solution

Save something (a URL today; images, video, and more behind a reserved seam) and `board-oss` captures it and runs an LLM to fill structured, opinionated metadata. When you want a new kind of collection, you *describe it* and the **agentic composer** proposes a complete board with a point of view — you accept or refine, never build from a blank form. Under the hood every capability (import, compose, add, tag, generate fields) is a composable skill with a typed contract, and the LLM backend is pluggable: API key, open model, or your coding-agent subscription. AI is optional everywhere except the composer — capture and manual curation work with zero configuration and degrade gracefully.

## What Makes This Different

- **Opinionated AI enrichment, not metadata-for-search** — a design read and a "steal this" takeaway, not just tags.
- **The composer is the moat** — curation that *scales* to any collection while staying opinionated, because the AI supplies the stance.
- **Agent-native and BYO-LLM** — composable skills + "bring your coding subscription" removes the #1 cost-to-first-value (the API key) and rides the 2026 agent wave the incumbents are nowhere near.
- **Genuinely lightweight + yours** — single-node, SQLite, no Meilisearch/multi-container; a plain data file you can copy and walk away with.

Honest about the moat: it's the *opinionated-taste + agent-native* combination and execution, not a defensible technical secret. The risk to manage is staying tasteful, not generic.

## Who This Serves

**Primary — the design-literate self-hosting maker** ("visual collector with taste"): defined by behavior, not job title — collects inspiration compulsively, is competent to self-host on a homelab/Proxmox box, and cares how their tools look. Designer is the sharp tip; indie hacker / design-curious developer is the wide handle. **User-zero is the author.**

The founder has consciously **embraced an agent-forward identity and a narrower, agent-comfortable audience** — not chasing the widest market. Non-technical designers who won't self-host, and teams/multi-tenant orgs, are explicit non-users for v1.

## Success Criteria

- A stranger installs it on a Debian LXC in one command and reaches "saved my first thing, it looks great" without reading docs.
- Runs comfortably in ~512MB–1GB RAM / 1 vCPU.
- AI is optional: useful with enrichment disabled; works with an API key, an open model, or a coding subscription.
- A user can **create a new opinionated board by describing it** and feel the result has taste.
- Lands on community-scripts.org (systemd, non-root, persistent data path, no blocking first-run).

## Scope

**In (v1):** the two seeded boards (Inspiration, Library) on a **schema-as-data** model; URL capture (screenshot + readable-text) + manual upload; async **pluggable/optional LLM enrichment** (HTTP + coding-CLI transports); the **agentic composer** (built after the seeded boards prove the taste); skill-modular internals behind a generic HTTP route; optimistic async-save UX; FTS5 search; SQLite/Drizzle; env-driven config; **reverse-proxy-only auth, localhost-bind default.**

**Out (v1):** built-in auth/multi-user; external MCP / agent-as-primary-surface (zod contracts built so it's a later adapter); non-URL ingest adapters (image, YouTube oEmbed — seam reserved); feed/channel sync; vision-board canvas (`view` field reserves the hook); a raw blank-form schema builder (permanently rejected); browser extension; mobile.

## Vision

In 2–3 years, `board-oss` is *the* agent-native, self-hosted curation tool: you converse with it (UI or your coding agent) to compose tasteful boards for anything — inspiration, reading, research, video, products, moodboards — each enriched with a genuine point of view, all on infrastructure and data you own. The incumbents archive links; `board-oss` composes collections with taste.
