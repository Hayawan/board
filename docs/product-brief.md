# board-oss — Product Brief

**Date:** 2026-06-19
**Status:** Approved by party consensus (Analyst, PM, Architect, Engineer, UX, Innovation)
**Companion docs:** `research.md` (architecture decision brief) · `prd.md` (requirements)

---

## 1. Executive summary

`board-oss` is the open-source, self-hostable successor to `board` — a tool that turns the act of *saving a URL* into *curating an opinionated, AI-enriched collection*. You drop a link; it captures the page (a full-bleed screenshot for a visual **Inspiration** board, readable text for a **Library** reading list) and runs an LLM to fill in structured, *opinionated* metadata — a design read plus a **"steal this"** takeaway for Inspiration; a summary, topics, and key points for Library.

The existing `board` is the **prototype / baseline experience**. `board-oss` re-platforms it to be installable by a stranger in a small Proxmox LXC, with the LLM dependency made optional and pluggable — while preserving (and in two places exceeding) the prototype's feel.

**One line:** *Are.na-meets-self-hosted, with taste — a private, lightweight vault where **AI composes opinionated boards for anything you collect.***

> **Thesis (founder-chosen, 2026-06-20):** board-oss is not "two hardcoded boards" — it's an **AI taste-engine**. You describe what you're collecting; an agent carrying the product's taste proposes a finished, opinionated board (its capture mode, the attributes worth keeping, the enrichment lens, the layout), which you accept or nudge. Inspiration + Library ship as the composer's reference examples. *Built agent-native to the bone; positioned as the board.*

---

## 2. Problem statement

People who collect things online — designers, indie hackers, design-literate developers — accumulate a junk drawer of links, screenshots, and "I'll read it later" tabs that never resolve into anything usable. Existing tools split badly:

- **SaaS curation (Are.na, Mymind, Pocket)** — lovely, but not yours: subscription-gated, privacy-surrendering, not self-hostable.
- **Self-hosted bookmarkers (Linkwarden, Karakeep)** — yours, but soulless: their AI produces *metadata-for-search* (tags, generic summaries). Neither *interprets* a page aesthetically, neither offers a browsable visual-inspiration wall, and both are heavy (multi-container, Meilisearch-backed, 700MB–2GB+).

There is no **lightweight, self-hostable tool that has *taste*** — that looks at what you saved and tells you *why it's good and what to steal from it*, and presents your visual collection as a moodboard rather than a list.

---

## 3. Target user

**Primary persona — "the design-literate self-hosting maker" (a.k.a. the visual collector with taste).**

Defined by **behavior, not profession**: someone who (a) compulsively collects visual/intellectual inspiration, *and* (b) is competent and motivated to self-host on a homelab / Proxmox box, *and* (c) cares how their tools look and feel. The **designer is the sharp tip** of the wedge; the **indie hacker, brand-builder, and design-curious developer are the wide handle**. **User-zero is the author himself** — the tightest possible product-market fit for an OSS v1.

This single persona is what makes the constraints coherent: the *value* (visual taste, AI design-reads) and the *constraints* (lightweight, self-hostable, runs-behind-my-own-reverse-proxy) serve **one** person. A pure non-technical designer would never `pct create` an LXC; a pure homelabber without taste wouldn't care about the inspiration grid. We build for the overlap.

**Explicit non-users (for v1):** teams / multi-tenant orgs; non-technical users who need a hosted SaaS; mobile-first users.

---

## 4. Differentiator & value proposition

The job `board-oss` is hired for is **taste-making**, not storage. Competitors *retrieve*; `board-oss` *judges*.

The defensible wedge (validated against Linkwarden & Karakeep in `research.md` §3):

1. **Opinionated AI enrichment** — not tags-for-search, but a *design read* + a **"steal this" takeaway**: interpreting a page aesthetically and saying what to learn from it.
2. **A true visual-inspiration grid** — a full-bleed, browsable moodboard, not a list with thumbnail favicons.
3. **Lighter than the incumbents** — single-node, SQLite, no Meilisearch, no multi-container stack; runs happily where Linkwarden/Karakeep can't.

**The wedge moved (2026-06-20):** the differentiator is no longer "two hardcoded opinionated boards" — it's the **board-*generating* taste**. An agent that manufactures opinionated boards on demand is curation that scales: a thing Notion structurally cannot do (it has no point of view to lend you), and that Linkwarden/Karakeep aren't built for.

**Strategic guardrail (the refusal):** users create boards via the **agentic composer**, which outputs a finished board *with a stance* the user accepts or nudges — **never a blank-form schema builder** (that's the "worse Notion" trap, permanently rejected). And the agent-native architecture (every capability a composable skill; bring any LLM or your Claude Code / Codex / Cursor subscription) is the **moat and onboarding path.**

> **Founder call (2026-06-20):** an **agent-forward identity is embraced** and a narrower, agent-comfortable audience is accepted ("not chasing the widest audience — no biggie"). We may *lead* with the agent/composer story rather than hide it; non-agent fallbacks are welcome **eventually**, not v1-gating. This is a *positioning/audience* relaxation only — the visual board stays the soul, the default install stays zero-coding-CLI and UI-usable, and Spectrum C is unchanged.

---

## 5. Goals & success criteria

| Goal | Success looks like |
|---|---|
| **Experience parity with the prototype** | A user of `board` feels at home: same two boards, same capture→enrich→browse→revisit loop, same-or-better feel. |
| **Self-hostable by a stranger** | One-command install on a Debian LXC; runs in ~512MB–1GB RAM, 1 vCPU; no external accounts *required* to reach first value. |
| **LLM is optional, not existential** | App boots and is useful with enrichment disabled; capture + manual curation work with zero LLM config. BYOK or local model when desired. |
| **Lands on community-scripts.org** | Meets the catalog's bar: systemd service, non-root user, persistent data path, no blocking first-run, localhost-bind default. |
| **Bonus: better than the prototype** | The async-save *optimistic* flow and full-text search make v1 feel faster and more capable than `board`. |

**Non-goals for v1:** multi-user/auth, collaboration/sharing, browser extension, mobile app, RSS ingestion, analytics, public links. (See `prd.md` § Out of scope.)

---

## 6. Constraints & assumptions

- **Lightweight above all.** Target host: small Proxmox LXC, ~512MB–1GB RAM / 1 vCPU. *The binding constraint is headless Chromium (~400–520MB resident while rendering)* — so capture must be launch-per-job, killed immediately, **concurrency capped at 1**. (See `research.md` ⭐.)
- **Self-hostable by non-experts**, eventual community-scripts.org listing (Debian LXC + systemd).
- **"Don't hand-code every feature"** — buy commodity (auth/sessions/static) as *libraries*, spend bespoke effort only on the differentiators.
- **Reversible data** — plain SQLite file the user can copy and walk away with.
- **Assumption:** the audience already runs a reverse proxy (Caddy/Authelia/Tailscale), so v1 ships **no built-in auth** — it binds to localhost and documents the proxy story.

---

## 7. Chosen approach (one-paragraph summary)

**The "Lean Hybrid."** Evolve the existing Node/Fastify prototype as the owned spine — it hosts the three differentiators (capture orchestration, async LLM enrichment, the opinionated boards API the frontend already consumes). Replace flat-JSON with **SQLite via Drizzle** (WAL, JSON columns, FTS5). **Buy** the commodity layer as libraries (`oslo`/`argon2` for the deferred v2 auth, `@fastify/static`). Make LLM enrichment a **pluggable, optional, BYOK-or-local** provider behind a clean seam, with graceful degradation. Keep capture **in-process** for v1 (launch→screenshot→kill, concurrency 1) while **designing** the sidecar contract so a future offloadable capture service is a lift-and-shift, not a rewrite. Host platforms (PocketBase, Payload, Directus) were evaluated and **rejected** — full rationale in `research.md` Addendum and `prd.md` § Architecture Decisions.

---

## 8. Key risks

| Risk | Mitigation |
|---|---|
| **Chromium OOMs the LXC** | Capture concurrency hard-capped at 1 (on the single serialized worker); per-capture timeout with guaranteed `browser.close()` in `finally`. |
| **Async enrichment feels broken (dead air)** | Optimistic insertion: card appears instantly, AI fields shimmer→fill; SSE live status (queued→capturing→enriching→done/failed). |
| **Degraded/disabled LLM looks broken** | Card always saves complete (title/screenshot/notes/tags); AI fields show a dignified empty/"retry" state, never error vomit. |
| **Scope creep into a generic platform** | Seam-only extensibility; hard MVP cut line (see PRD). |
| **`oslo`/Lucia churn** | Pin `oslo` primitives + `argon2`, not the sunsetting Lucia framework; auth is v2 anyway. |
| **SQLite write contention under bursty enrichment** | Single-writer queue + `busy_timeout` + WAL; enrichment writes funnel through the one worker. |

---

## 9. Consensus record

Reached via multi-round BMAD party deliberation (positions changed under argument, which is the point):

- **Audience** — unanimous: the design-literate self-hosting maker.
- **Spine** — *Lean Hybrid* (evolve Fastify + buy commodity libraries), ratified YES by PM, Architect, Engineer, Innovation after the two PocketBase advocates reversed on implementation facts.
- **Datastore** — unanimous: SQLite/Drizzle. NoSQL explicitly rejected (buys nothing here).
- **Auth** — unanimous: reverse-proxy-only for v1.
- **Extensibility** — ~~seam-only~~ → **composer-driven** (AI proposes opinionated boards; accept/refine, never a blank-form builder).
- **Capture** — in-process v1 (concurrency 1), sidecar contract designed, extraction deferred to v2 (Architect signed off).
- **Customization / vision** (2026-06-20) — **schema-as-data** foundation + **agentic composer as a v1 launch feature** (founder chose "lean all the way in"); content-type adapters' seam reserved; vision-board canvas + feed-sync deferred. New thesis: "AI composes opinionated boards for anything you collect."
- **Agent-native architecture** (2026-06-20) — **Spectrum C** (unanimous): skill-modular internals + 3-class pluggable LLM (HTTP API-key/open-model + coding-agent CLI subscription) in v1; external MCP/agent-operability deferred; **default install zero-coding-CLI**; market the board, not the engine.
