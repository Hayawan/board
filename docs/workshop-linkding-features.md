# Workshop — Which linkding features to steal, and how

> Outcome of a roundtable (party-mode) workshop, 2026-06-23, on the question: *of linkding's features, which should board-oss adopt "right out the gate" — and how, without becoming a worse linkding.*
> Participants: 📋 John (PM), 🏗️ Winston (Architect), 🎨 Sally (UX), 💻 Amelia (Engineer), ⚡ Victor (Disruption strategy).
> Companion to [`competitive-linkding.md`](./competitive-linkding.md) (the full feature inventory + head-to-head). This doc is the **decision record**, not the inventory.

---

## TL;DR — the consensus

The group reached **general consensus** on a single coherent thesis and a build order:

> **Capture the firehose → cheap-enrich into an Inbox → the AI proposes a home → one-tap confirm promotes the link into a typed board (firing the real AI takeaway). That same "assign" verb, run in bulk by the AI, _is_ the board composer. Composed boards are saved _views_, not copies — so the enriched "meaning" never forks.**

What we steal from linkding: **a real save path** (bookmarklet → PWA share-target → extension) and **a public API** — both *neutral enablers* that make our own wedge reachable. What we refuse: linkding's tag-only, configure-it-yourself organizing model (boolean search grammar, auto-tagging rules, saved-search "bundles" as such, custom CSS). Those compete on linkding's home field, where we lose by definition.

**Build order (the spine):**
1. **Keystone — full CRUD API + a single static bearer token** (one story; the prerequisite for every capture client).
2. **Bookmarklet** capture → lands in an **Inbox** board with *cheap* enrichment (title/favicon/description/screenshot).
3. **"Move to board"** = assign to a typed board + fire the *expensive* AI takeaway. **One verb, one endpoint.**
4. **Scannable Inbox** view (with the AI suggested-board chip — see hinge #2).
5. *(later)* **AI Composer** — batch-assign from the Inbox; same endpoint as #3, AI-driven. The wedge payoff.
6. *(later)* **Browser extension** — popover/sidebar as the "recent additions" review lane.
7. *(later)* **Per-board opt-in archival** that preserves the AI takeaway, not just the bytes.
8. **NOT now** — the many-to-many / global-pool data-model refactor. Rejected (see below).

The **PWA share-target** is ranked #2-by-value (mobile is where inspiration is born) and rides the same keystone API; it should not drift to the bottom even though the bookmarklet is the cheapest first cut.

---

## The thesis that emerged

The defining move of the workshop was reframing the dual identity Hayawan named — *"it is a curation tool, but it is also an archival tool"* — from a contradiction into a **pipeline**.

- The **archivist's instinct** (capture everything, lose nothing, a drop-in bucket) and the **curator's instinct** (an opinionated mood board, taste = leaving things out) look like opposing jobs. A tool that worships both usually becomes "a junk drawer with good lighting."
- They reconcile **if the AI is the curator.** Every competitor hands you a firehose and a filing cabinet and says *"now you organize 4,000 links"* — which is why most bookmark managers are graveyards. board-oss inverts the deal: **you capture; the composer organizes.** Completeness stops being curation's enemy and becomes its *fuel* — the more you save, the more raw material the composer has.
- A year out, the win condition is a user saying *"I throw everything at it and it hands me back boards I didn't know I had in me"* — **not** *"it's a lighter linkding."*

This thesis is what makes the feature decisions below cohere instead of being a parity checklist.

---

## Direct answers to Hayawan's questions

**"Don't we already have the ability to create boards? What are 'smart/saved boards'?"**
Yes — you already create boards, and each board is a *typed container* (its own field descriptor). "Smart/saved boards" in the linkding sense ("bundles") means a board defined by a *saved query* over your links rather than by explicit membership. We are **not** copying that as-is. Instead, the AI **composer** generates boards, and its output is a **saved view** (a stored filter), not a new pile you hand-fill. See the data-model decision next.

**"Would that mean all bookmarks live in the same table, aggregated by board based on tags/assignment? Feels like a big refactor."**
Correct instinct — and we are **not** doing it. Today `item.board_id` is a `NOT NULL` foreign key: every item belongs to **exactly one** board (verified in `db/schema.ts`). The three options were:
- **A — keep the FK; "smart board" = a saved cross-board query (a view).** No schema change. Size: **M**. Caveat: typed fields are per-board, so a cross-board view can only render *universal* fields (title, URL, thumbnail, tags) — it degrades the rich per-board columns.
- **B — many-to-many `item_board` join table** (one link in many boards). Size: **L**, plus a *hidden second refactor*: an item in N boards with N different field schemas — whose `fields` JSON validates it? You'd have to move fields onto the membership.
- **C — fully decouple: items in a global pool, boards become pure views.** Size: **XL**. Maximizes B's field-collision problem. Don't.

**Decision: keep the one-board FK (no refactor).** Your three use-cases — a project, a drop-in bucket, a mood board — are *different boards*, and a link **progresses** from the bucket into a curated board. That's a **move (single-FK update), not a share.** Many-to-many only earns its cost if the *same physical link* must simultaneously live in multiple boards with no canonical home — which your described workflow doesn't require. The per-board typed-field model actively *resists* a flattened global pool, so the refactor would also be a product regression, not just an engineering cost.

**"Wouldn't full CRUD via API be a huge, easy win that opens the door to the extension?"**
Yes — it's the **keystone**, build it first. One caveat from engineering: it's **M, not S**. The route handlers are easy; the real work is (a) `DELETE` semantics (cascade to `asset` rows *and* the on-disk files), (b) a `token` table storing **hashed** tokens (never plaintext), (c) a Fastify `preHandler` auth hook applied + tested on every write route, (d) CORS (`@fastify/cors`, score it per dependency policy) the moment a browser extension calls cross-origin. **An unauthenticated write API on a self-hosted box is the one hard line** — CRUD and the token ship as one unit, which also resolves the "auth is deferred to v2" tension: a *single static bearer token* (not full multi-user auth) is the right-sized amount of auth to pull forward.

**"Should we support archival? What if the page goes down?"**
Yes — but with two corrections and a scope. **Correction:** archival is **not** "a feature neither has" — linkding (SingleFile + Internet Archive), Karakeep, and Linkwarden all archive HTML. So "save the page" is *commodity parity*, and shipping only that means a v1 snapshot pipeline competing with years-hardened ones. **The differentiated version:** archive **meaning, not just bytes** — the HTML snapshot *plus* the AI takeaway/typed enrichment, so what survives link-rot is *why it mattered*, not just what it looked like. **Scope:** opt-in per-item/per-board, tied to the **curated tier** (you archive what you promoted, not the bucket churn) — never capture-everything-by-default on a 512 MB–1 GB box.

---

## Decisions in detail

### 1. Keystone: CRUD API + static bearer token
- Routes: `POST /items` (create-from-URL = the universal save path), `GET /items` with filters + recency (powers the popover's "recent additions"), `PATCH /items/:id`, `DELETE /items/:id` (+ board routes).
- Reuses the existing **async enrichment queue**: `POST /items` returns immediately with `status: pending`; the worker enriches; clients poll/SSE. This is the payoff of having already built async + the no-LLM fallback — no new architecture.
- Auth: one static bearer token in config, hashed in a `token` table, checked by one `preHandler`. Sized **M**.

### 2. Capture funnel (bookmarklet → PWA → extension)
- **Capture is sacred: one tap/click, sub-second, zero decisions, and it's over.** No board picker, no tagging at capture time. It lands in the **Inbox**. Any decision placed in the capture moment is one the user will resent and route around.
- **Bookmarklet first** — a one-line `javascript:` POST to the API; no second codebase, no store review. Cheapest unblock.
- **PWA share-target second (load-bearing, not nice-to-have)** — registers in the mobile native share sheet. Inspiration is born on the phone; the firehose *is* mobile, and the composer thesis starves without it. The API-first plan makes this a thin client.
- **Extension later** — its job is **not** primarily saving; it's the **ambient review lane**: open the popover, see the last ~5 captures each wearing a one-tap AI suggested-board chip, triage in seconds. *That* is what justifies the extension over the bookmarklet.

### 3. The Inbox + one organizing verb
- The **Inbox** is a real board (`item.board_id` → Inbox) and the **typeless default destination** for captures that match no board's descriptor.
- There is exactly **one organizing verb: assign a link to a typed board.** Manual = user picks the board. Composer = the AI proposes a batch of assignments. **Same FK write, same enrichment trigger, same endpoint.** Protect the single endpoint or the UX fractures into two motions.
- **"Move to board" = assigning a type** (the destination board's field schema), which is the moment the expensive AI takeaway is generated *for that purpose*.

### 4. Enrichment is earned
- **On capture into Inbox:** *cheap* enrichment only — title, favicon, fetched description, screenshot. Enough to make the Inbox scannable. (Don't spend AI compute on bucket churn you'll delete tomorrow.)
- **On assignment to a typed board:** the *expensive* AI design-takeaway/typed-field enrichment fires, because only now does the link have a purpose and a target schema.
- (Enrichment is already async because of the built-in no-LLM fallback — confirmed; keep it that way.)

### 5. Smart/composed boards = views, not copies
- Composer output is a **saved cross-board query (a view)** by default. The Inbox/firehose stays the single source of truth; composed boards are **lenses** over it.
- **Why view, not copy:** the AI takeaway lives **once** on the canonical item; every view sees the latest. COPY would fork enrichment into divergent duplicate rows — violating the very "preserve meaning" principle archival is built on — and reintroduce double-counting and "delete the original?" ambiguity.
- **COPY-on-write** is the deliberate, user-initiated escape hatch ("materialize to board") for when someone wants to hand-prune/reorder a composed board.
- **A cross-partition *read* (a lens) is not a global pool; a shared membership *write* table (m2m) is.** Bucket-as-board keeps the NOT-NULL FK partition fully intact.

### 6. Archival
- New `asset` kind = `'snapshot'`: a SingleFile-produced self-contained `.html` on disk, hashed for dedupe, reusing the **existing concurrency=1 Chrome sidecar** (so screenshot + snapshot share one serialized Chrome — accept slow serial *backfill*; fine for incremental save-on-promote).
- Footprint guardrails (a 512 MB–1 GB box has limits even if disk doesn't): per-snapshot size cap (~25 MB), capture timeout, surface total archive size in the UI. Graceful degradation: if capture OOMs/times out, the item still saves; the snapshot is simply absent.
- Differentiator: pair the snapshot with the preserved AI takeaway. Dependency note: `single-file-cli` must pass the dependency score check before install.

---

## What we explicitly rejected (and why)

| Rejected | Why |
|---|---|
| **Many-to-many / global-pool refactor** | Hayawan's JTBD is *move* (links progress bucket→curated), not *share*. Per-board typed fields resist a flat pool. Cost L–XL with a hidden field-schema collision. Revisit only if real cross-board usage demands it. |
| **Boolean search grammar, auto-tagging rules, "bundles", bulk tag edit, custom CSS** | linkding's home field (retrieval-and-organization for a tag pile). Building them = being measured on the axis where we're structurally six years behind. Get the *value* underneath them via the composer + AI enrichment instead. |
| **Synchronous enrichment at capture** | Capture must stay sub-second; enrichment is async (and degrades to "done" with no LLM). The AI's opinion arrives *after*, as a confirmable suggestion — never a gate. |
| **Default-on, capture-everything archival** | Runaway disk + RAM on a small self-hosted box. Opt-in, curated-tier-scoped. |

---

## Open hinges for Hayawan to confirm (not blockers)

1. **View-definition shape.** A composed board is a view storing `{ filter }` **plus** an optional **ordered array of item-ids** and an optional **per-item caption map** — as fields on the view-def record, *not* a join table. This is what keeps composed boards (with manual ordering/blurbs) at size S–M instead of collapsing into the rejected m2m. *Confirm this is acceptable.*
2. **Don't ship the Inbox without the AI suggested-board chip.** A bare Inbox + manual move = a guilt pile that kills the product. The suggestion chip turns promotion from a *decision* into a one-tap *confirmation* (and overrides are the highest-signal taste-training data). If the chip can't make v1, ship the Inbox **small and loud** (a nagging count), never quiet and infinite.
3. **Single endpoint for move + compose.** Manual "move to board" and the AI composer must be the same batch-assign endpoint under the hood, or they drift into two divergent UX motions.

---

## Corrections to the record

- **linkding already has archival** (SingleFile HTML snapshots + Internet Archive Wayback); so do Karakeep and Linkwarden. Archival is parity, not novelty — our differentiation is archiving *meaning* (snapshot + takeaway). `competitive-linkding.md` already lists linkding's archiving; this corrects the workshop's initial "a feature neither has" framing.
- **Enrichment is already async** by design (no-LLM fallback), so the "sync vs async at capture" question is settled: async, with the cheap/expensive split above.
