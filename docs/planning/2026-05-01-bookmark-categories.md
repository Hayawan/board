# Bookmark categories: organization & data model

**Date:** 2026-05-01
**Status:** Problem statement

## Problem

The `#category-filter` `<select>` on `index.html` is becoming unusable as `bookmarks.json` grows. Two compounding issues:

### 1. The data model encodes hierarchy as a free-form string

Each bookmark stores its category at `meta.category` as a single string, often slash-delimited to imply a tier-1 / tier-2 hierarchy:

- `"SaaS"`
- `"AI SaaS / Productivity"`
- `"Developer Tools / SDK"`

Because the string IS the hierarchy, there is no enforced taxonomy. Anyone adding a bookmark invents a new value, and renaming a tier-1 requires a find-and-replace across every entry.

### 2. The taxonomy has fragmented into near-singletons

As of 2026-05-01, **96 bookmarks produce 73 distinct category strings**. Concrete examples of the drift:

- **Singular vs plural:** `Developer Tool / Open Source CLI` vs `Developer Tools / Open Source`
- **Near-synonyms:** `AI SaaS / Productivity` vs `AI SaaS / Productivity Tool`
- **Catch-all bloat:** `SaaS` alone covers 17 entries (~18% of the dataset), masking the actual sub-categories
- **Sibling explosion:** at least 9 distinct spellings for health/wellness products (`Health Tech / Consumer Health SaaS`, `Health & Wellness SaaS`, `Health/Wellness app marketing`, `Wellness / Mental Health App`, `Wellness / Spiritual App`, `Consumer Health / Mental Wellness SaaS`, `Digital Health / MedTech`, `Hardware / Health Tech`, `Consumer Hardware / Health Tech`)

The result: the filter dropdown is a flat list of ~70 mostly-singleton options. It cannot be skimmed, cannot be grouped, and cannot answer the question a tier-1 filter should answer ("show me all SaaS bookmarks" returns only the 17 catch-all entries, not the dozens of tier-2 SaaS variants).

## Constraints to consider

- The dataset is small (96 entries) — a one-time migration is feasible.
- Categories are author-curated (single user), not user-generated, so a closed taxonomy is realistic.
- `meta.category` is read by at least `index.html` (the filter) and likely `add.ts` — any data-shape change touches both.

## Decision

Adopt **Option B (refined): faceted taxonomy across structured fields, with `meta.tags` retained for design/aesthetic signals only.**

The category string was conflating three independent questions. Separate them:

| Field | Question it answers | Closedness | Multiplicity |
| --- | --- | --- | --- |
| `meta.audience` | *Who is this product for?* | strictly closed (enum) | one |
| `meta.form` | *What shape does the offering take?* | semi-closed (canonical list, extensible by deliberate edit) | one |
| `meta.domain` | *What industry / use case?* | semi-closed, **nullable** (some sites genuinely don't fit a domain) | one |
| `meta.tags` | *What does the **page** look and feel like?* | open vocabulary, normalized casing | many |

`meta.category` is removed.

### Why faceted, not deeper hierarchy

A single bookmark like Whoop is *consumer + hardware + health*. Forcing it into one tier-1 home (`Consumer Hardware` or `Health Tech`?) was the original failure mode. Three small orthogonal axes (~5/8/10 values) replace one giant axis (73 values) and answer the filter questions the dropdown was meant to answer.

### Why `tags` stays as-is in shape

The existing tags already do a real job — describing the *page* (`dark-theme`, `editorial`, `manifesto`, `scroll-reveal`). That's the highest-signal axis for a design-inspiration board. We pull *company-attribute* tags out of `tags` and into the structured fields where they belong (`B2B`, `enterprise`, `consumer app`, `iOS`, `developer-tools` → audience/form/domain), then normalize the casing of what remains.

## Proposed taxonomy

Values are drawn from frequency analysis of the existing 96 entries — not invented. The full canonical list lives in a new `taxonomy.json` at the repo root and is the single source of truth (consumed by both `add.ts` and the UI).

### `audience` — closed enum (~5)
- `b2b` — sells to businesses
- `enterprise` — sells to large orgs (kept distinct from `b2b` because the design language is genuinely different)
- `consumer` — sells to individuals
- `developer` — developers are the buyer/user
- `prosumer` — indie maker / creator / power user (the gray zone between consumer and b2b)

### `form` — semi-closed (~8)
- `saas` — web app, subscription
- `mobile-app` — iOS/Android-primary
- `hardware` — physical product
- `e-commerce` — DTC / retail storefront
- `portfolio` — agency, studio, or individual showcase
- `editorial` — magazine, publication, content-led
- `agency` — services firm
- `infrastructure` — developer platforms, APIs, SDKs

### `domain` — semi-closed, **nullable** (~10)
- `ai`
- `productivity`
- `dev-tools`
- `health` (covers wellness, mental health, medtech)
- `fintech`
- `creative` (design, photo, video tooling)
- `commerce` (commerce *infrastructure*, distinct from `form: e-commerce`)
- `crypto` / web3
- `legal`
- `recruitment`
- `null` is valid — a generic SaaS landing page may not have a meaningful domain

### Extensibility model

`form` and `domain` are **not strict enums in the JSON schema** — they are typed as `string` with a description that lists canonical values and instructs Claude: *"Prefer one of these. If none genuinely fits, propose a new value and briefly justify it in the analysis."* The lists in `taxonomy.json` are advisory to the LLM and authoritative for the UI.

A new value gets canonicalized by editing `taxonomy.json` (a one-line PR). A `scripts/check-taxonomy.mjs` lint pass surfaces any value in `bookmarks.json` that isn't in `taxonomy.json` so drift is visible. `audience` stays a strict enum because the value set is small and stable.

## Proposed JSON shape

```jsonc
{
  "id": "...",
  "url": "...",
  "title": "...",
  "meta": {
    "audience": "b2b",
    "form": "saas",
    "domain": "dev-tools",      // or null
    "tier": "reference",
    "tone": ["calm", "precise", "premium"],
    "tags": ["dark-theme", "monospace", "manifesto"]   // page-aesthetic only, normalized
  },
  "design": { /* unchanged */ },
  "reflection": { /* unchanged */ }
}
```

Tag normalization rules (applied during migration and enforced going forward):
- lowercase
- hyphen-separated, no spaces (`dark theme` → `dark-theme`)
- collapse known synonyms (`dark-mode` → `dark-theme`, `developertools`/`developer tools` → `developer-tools`)
- drop tags that are now structured (`B2B`, `enterprise`, `consumer app`, `iOS`, `developer-tools` when used as audience/form signal)

## Migration plan

One-shot script, `scripts/migrate-categories.mjs`. Idempotent (safe to re-run on the output of a previous run).

1. **Read** `bookmarks.json` and `taxonomy.json`.
2. **Map** each existing `meta.category` string to `(audience, form, domain)` via a hand-curated lookup table embedded in the script. The 73 distinct strings collapse to ~50 unique mappings (many are dupes after lowercasing). The script prints the table on first run for review before writing.
3. **Normalize** `meta.tags` per the rules above.
4. **Write** updated bookmarks back, dropping `meta.category`.
5. **Verify** by running `scripts/check-taxonomy.mjs` — must report zero unknown values.

The lookup table is reviewed by the user before the script writes. We iterate on the table, not the data.

## Code changes

### `add.ts`
- Load `taxonomy.json` at top of file.
- Replace `meta.category` in `SCHEMA` with `audience`, `form`, `domain`:
  - `audience`: `{ type: "string", enum: TAXONOMY.audience }`
  - `form`: `{ type: "string", description: "Prefer one of: <list>. Propose a new value only if none genuinely fits." }`
  - `domain`: same as form, plus `nullable: true` (or `type: ["string", "null"]`).
- Update `required` array.
- Update the closing `console.log` to print the new fields instead of `category`.

### `server.ts`
- Update the `Bookmark` interface:
  ```ts
  meta: { audience: string; form: string; domain: string | null; tier: string; tone: string[]; tags: string[] };
  ```
- Add a `GET /api/taxonomy` endpoint that serves `taxonomy.json` so the UI doesn't need to derive vocabulary from data.

### `index.html`
- Replace the single `#category-filter` `<select>` with **three** small selects: Audience, Form, Domain. Populate each from `/api/taxonomy` (not from data — empty values still appear so users can filter by something the data doesn't yet contain).
- `applyFilters()` checks all three independently; any unset facet is "all."
- Search haystack updates to include the three new fields instead of `category`.
- The `.list-category` cell in list view shows `form` (the most browseable axis) — or a compact `audience · form` pair if there's room.
- Tag cloud is unchanged behaviorally; it'll naturally clean up after migration since the company-attribute tags get pulled out.

### New: `taxonomy.json`
Single source of truth. Shape:
```json
{
  "audience": ["b2b", "enterprise", "consumer", "developer", "prosumer"],
  "form": ["saas", "mobile-app", "hardware", "e-commerce", "portfolio", "editorial", "agency", "infrastructure"],
  "domain": ["ai", "productivity", "dev-tools", "health", "fintech", "creative", "commerce", "crypto", "legal", "recruitment"]
}
```

### New: `scripts/check-taxonomy.mjs`
Lint pass. Reads bookmarks + taxonomy, prints any value not in the canonical list. Exits non-zero if drift is found. Suitable as a pre-commit check later.

### New: `scripts/migrate-categories.mjs`
One-shot. Reads the curated mapping table, applies to bookmarks, writes. Prints a summary diff at the end (X bookmarks migrated, Y unique audience/form/domain values produced).

## Execution order

**Step 0 (do first, before any changes):** initialize git and commit the current state.
- `git init`
- Add a `.gitignore` for `node_modules/`, `.repomix/`, `screenshots/` (the board is private and screenshots rarely change — not worth the repo bloat).
- `git add -A && git commit -m "initial commit before taxonomy migration"`

This gives us a clean rollback point before touching `bookmarks.json`.

**Then, in order:**

1. Add `taxonomy.json` (no behavior change yet).
2. Add `scripts/check-taxonomy.mjs` and run it — expect a flood of "unknown" reports, which is fine; it's the baseline.
3. Write `scripts/migrate-categories.mjs` with the curated mapping table; **review the table together** before running.
4. Run migration on `bookmarks.json`. Commit.
5. Update `server.ts` (`Bookmark` interface + `/api/taxonomy` endpoint). Commit.
6. Update `add.ts` (schema + logging). Test by adding a fresh bookmark. Commit.
7. Update `index.html` (three filters, search, list cell). Test in browser. Commit.
8. Run `scripts/check-taxonomy.mjs` — must be clean.

Each step is a separate commit so any can be reverted independently.

## Out of scope (for this document)

- Pre-commit hooks for the taxonomy lint (nice-to-have, defer).
- Multi-domain bookmarks (e.g., a fintech-AI product). If this becomes common, promote `domain` to an array later — but start with one and see.
- A taxonomy admin UI. The friction of editing `taxonomy.json` by hand is a feature, not a bug, at this scale.
