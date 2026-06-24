# Product

## Register

product

## Users

Design-literate self-hosting makers — "visual collectors with taste," defined by behavior, not job title. They collect online inspiration and reference compulsively (designs, articles, papers, repos), are competent to run a service on a homelab / Proxmox LXC, and genuinely care how their tools look. The designer is the sharp tip of the audience; the indie hacker and design-curious developer are the wide handle. **User-zero is the author.** They live inside coding agents and often run local models.

Context of use: at their own machine (or phone), curating a personal collection they own outright — a single-user, local-first tool, not a team workspace. Explicit non-users for v1: non-technical designers who won't self-host, and teams / multi-tenant orgs.

## Product Purpose

`board-oss` is an **AI taste-engine** for personal collections. You save something (a URL today; more behind a reserved seam), it captures the page and runs an LLM to fill *opinionated*, structured metadata — a design read and a "steal this" takeaway, not metadata-for-search. When you want a new kind of collection you **describe it**, and an agentic composer proposes a complete, opinionated board (its capture mode, the attributes worth keeping, the enrichment lens, the layout) that you accept or nudge — you never build from a blank form.

The thesis: *"AI composes opinionated boards for anything you collect."* The moat is the board-generating **taste**, not the boards. It stays lightweight (single-node, a plain SQLite file you can copy and walk away with, ~512MB–1GB RAM), and brings any LLM (API key, open model, or an existing coding-agent subscription). AI is optional everywhere except the composer: capture and manual curation work with zero config and degrade gracefully.

Success looks like: a stranger installs it in one command and reaches *"saved my first thing, it looks great"* without docs — and can *describe a board and feel the result has taste.*

## Brand Personality

Tasteful, quietly confident, opinionated. The voice is a design-literate friend with an actual point of view — the kind who tells you *why* something is good and what to steal from it — never chirpy, never a cheerleader. Chrome is restrained and recedes; the collection and its AI "reads" are the spectacle. Three words: **tasteful, confident, calm.** The emotional goal is the quiet satisfaction of a well-kept, good-looking personal collection that is unmistakably yours.

## Anti-references

- **Cutesy mascots / over-illustrated empty boxes** — cartoon characters and stock "empty drawer" illustrations that condescend to a design-literate audience.
- **Soulless self-hosted utilitarianism** (Linkwarden, Karakeep) — metadata-forward, no taste, no warmth; chrome that looks like an admin panel.
- **Notion's opinionless blankness** — infinite flexibility as the *absence* of a point of view.
- **The generic SaaS empty state** — a giant centered illustration above one "Get started" button; the AI-slop reflex.

## Design Principles

1. **Taste over neutrality.** Every surface carries a point of view. When the safe, generic default suggests itself, refuse it — being opinionated is the product.
2. **The collection is the hero.** Chrome recedes so the user's saved things, and the AI's read of them, are what you look at. Reduce ceremony around the content.
3. **Degrade with dignity.** AI-off, mid-capture, and empty states are first-class designed moments, never error walls or dead ends. An empty board should still feel intentional and inviting.
4. **Yours, and light on its feet.** Fast, calm, and local — nothing that implies a heavy cloud SaaS or asks the user to trust a server with their taste.
5. **Show the stance, don't list the fields.** Surface the opinion (a design read, a "steal this") over raw metadata; lead with meaning, not attributes.

## Accessibility & Inclusion

Target **WCAG 2.1 AA**: AA contrast on text and meaningful UI, full keyboard operability with a clearly visible focus ring, and never conveying state through color alone. Honor `prefers-reduced-motion` (motion is enhancement, never required to understand a screen). Respect the user's light/dark context rather than forcing a theme.
