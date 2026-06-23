# Story 14.3: Scannable Inbox + AI suggested-board chip

Status: draft

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Epic 14 — Inbox triage & the one-verb assignment.** Story 3 of 3. Build order: (1) cheap-vs-earned enrichment split → (2) move/assign endpoint (the one verb) → **(3) scannable Inbox + suggested-board chip ◄ this story**. This story makes the Inbox a fast, scannable list and adds an AI suggested-board chip so promotion is a one-tap confirmation (calling 14.2's assign endpoint) — degrading to a dignified manual board picker when AI is unavailable, never a guilt-pile. *(D9; NFR-BC.)*

## Story

As a user,
I want each Inbox item to show a suggested home board I can accept with one tap,
so that triage is confirmation, not a filing chore.

## Acceptance Criteria

1. **Inbox view is scannable.**
   **Given** the Inbox, **When** rendered, **Then** cheap metadata (title, thumbnail, source) shows in a fast list/grid — using the existing generic renderer (`descriptor/render-map.js`), no per-board frontend code.

2. **Suggestion chip present (one-tap confirm).**
   **Given** an Inbox item, **When** the AI is available (`providerConfigured === true`, `server.ts:383`), **Then** a suggested-board chip is shown; tapping it calls the **14.2 assign endpoint** for that item with the suggested `boardId` (one tap → move + earned enrichment).

3. **Degrades to a manual board picker (dignified, UJ-2).**
   **Given** the AI is unavailable (`providerConfigured === false`) **or** a suggestion can't be computed, **When** the Inbox renders, **Then** the chip degrades to a **manual board picker** (a dropdown/list of target boards that still calls 14.2 on selection) — never a hidden item, never an error, never a silent infinite bucket. The degradation keys off `providerConfigured` (the same signal as `renderEnrichmentState`, `collections-ui.js:127`), NOT field-emptiness.

4. **Override is captured as signal (additive store).**
   **Given** a suggestion is shown and I pick a **different** board than suggested, **When** I confirm, **Then** the override (suggested vs chosen) is recorded for future suggestion quality — written to an **additive** store (a new column/table/append-only log), never by mutating existing item/board rows.

5. **No guilt-pile fallback.**
   **Given** the suggestion can't be computed, **Then** the Inbox still shows a clear item **count** + a manual promote path — the bucket is never silent or infinite.

6. **No-regression (NFR-BC).** *(Added per house rules — Epic 14.3's listed ACs omit an explicit NFR-BC line.)*
   **Given** existing boards/items, **When** the Inbox view + suggestion + override-capture ship, **Then** rendering and computing suggestions is **read-only** — no existing item's `board_id`/`fields`/`status` is mutated by viewing the Inbox or computing a suggestion; only an explicit tap/confirm (via 14.2) moves an item; the override store is additive (no reshape of existing rows). A regression test asserts viewing/suggesting mutates nothing.

7. **Tests** assert chip → assign wiring (tap calls 14.2 with the suggested board), the manual-picker fallback when `providerConfigured` is false, override capture into the additive store, the count/manual-promote no-guilt-pile path, and the read-only NFR-BC regression.

## Tasks / Subtasks

- [ ] **Task 1 — Write the failing suggestion-compute test first (TDD)** (AC: 2, 3, 6)
  - [ ] Headless unit test (like `render-map.test.ts` / `collections-ui` pure-fn tests): given an Inbox item + the list of candidate boards + `providerConfigured`, the suggestion function returns either `{suggestedBoardId}` (AI on) or `null` (AI off / uncomputable) AND mutates nothing. Run; confirm red.
- [ ] **Task 2 — Implement the suggestion compute (read-only)** (AC: 2, 3)
  - [ ] A pure/read-only suggestion resolver: when `providerConfigured`, compute/serve a suggested target board for an Inbox item; otherwise return null (→ manual picker). Reuse the descriptor-driven AI seam (no per-board code). It MUST NOT write to the item.
- [ ] **Task 3 — Write the failing chip-render test, then render the chip** (AC: 1, 2, 3, 5)
  - [ ] Pure render test (markup string, like `render-map.js`): an Inbox row renders title/thumbnail/source + a chip when a suggestion exists; a **manual board picker** when not; always a clear state (count visible, manual promote reachable). Implement the renderer in the pure layer; the DOM glue is `el.innerHTML = ...`.
- [ ] **Task 4 — Wire tap → 14.2 assign** (AC: 2, 3)
  - [ ] On chip tap (or manual-picker selection), call the 14.2 `POST /api/v1/items/assign` endpoint with `{itemIds:[id], boardId}`. Test the wiring asserts the right payload (suggested board on chip tap; chosen board on manual select).
- [ ] **Task 5 — Write the failing override-capture test, then the additive store** (AC: 4, 6)
  - [ ] Decide the store shape (a new `suggestion_override` table OR an append-only log file under `DATA_DIR` OR a new nullable column) — additive only. Test: choosing a board ≠ suggested writes `{itemId, suggestedBoardId, chosenBoardId, at}` to the store; choosing the suggested board writes nothing (or a confirm record — pick one + test it). Implement minimally.
- [ ] **Task 6 — Write the failing NFR-BC read-only regression, confirm green** (AC: 6)
  - [ ] Test: render the Inbox + compute suggestions over a pre-wave DB with existing boards/items; assert NO existing item row changed (board_id/fields/status/updatedAt) and existing boards untouched. Then `npm test`; confirm green + existing suites unaffected.

## Dev Notes

### What this story changes vs preserves (read before coding)

- **Adds the Inbox UI + suggestion chip; reuses the assign verb.** The chip/picker is a thin trigger over 14.2's `POST /api/v1/items/assign` — no new move/enrich logic here. The Inbox renders with the existing generic renderer (`descriptor/render-map.js`), so a typeless Inbox board needs no special frontend.
- **Degradation keys off `providerConfigured`, not field-emptiness.** When no provider is configured the server reports `providerConfigured:false` (`server.ts:383-386`); the chip degrades to a manual picker exactly as `renderEnrichmentState` keys its dignified state off the same flag (`collections-ui.js:127-152`). An AI-enabled box can legitimately return an empty/low-confidence suggestion → still show the picker, never an error. [Source: server.ts#L383, collections-ui.js#L127]
- **Adds an additive override store.** Override capture (AC4) gets a real home: a new `suggestion_override` table / append-only log / nullable column — additive, never a reshape of `item`/`board`. This is the one genuine new persistence surface in the story.
- **Preserves existing boards/items (NFR-BC).** Viewing the Inbox and computing suggestions are read-only; only an explicit tap/confirm moves an item (through 14.2). Nothing auto-files. [Source: docs/bmad/epics-v2.md#L156]

### Why this design (anti-pattern prevention)

- **Confirmation, not a filing chore (D9).** The chip turns promotion into one tap; the override is a signal, not a penalty. The fallback is a manual picker with a visible count + promote — a "guilt-pile" infinite silent bucket is explicitly forbidden (AC5). [Source: docs/bmad/epics-v2.md#L184, docs/bmad/epics-v2.md#L193]
- **Dignified degradation off the provider signal (UJ-2).** Keying degradation off `providerConfigured` (not "the suggestion field is empty") means a no-AI install gets a clean manual picker, and an AI install that can't compute a suggestion still degrades to the picker — never an error wall, never a phantom suggestion. Mirror `renderEnrichmentState`'s precedent. [Source: collections-ui.js#L127, server.ts#L383]
- **One assign path (D8).** The chip/picker calls 14.2's endpoint — it does NOT implement its own move/enrich. This keeps the "one verb" invariant: manual triage, composer (15.2), and chip all go through the single assign helper. [Source: docs/bmad/epics-v2.md#L178]
- **Override store is additive (NFR-BC).** Recording overrides via a NEW table/log/column — never by mutating existing rows — keeps the wave-wide no-regression guarantee. A naive impl that crammed it into `item.fields` would risk colliding with descriptor keys; keep it separate. [Source: docs/bmad/epics-v2.md#L24]
- **Read-only suggestion compute.** Computing a suggestion must not write to the item (no "cache the suggestion on the row" that mutates pre-wave items). If cached, cache in the additive store. [Source: docs/bmad/epics-v2.md#L31]

### Project Structure Notes

- Pure render + suggestion-resolve functions in the no-build pure layer (alongside `descriptor/render-map.js` / `collections-ui.js`), headless-unit-testable; DOM glue is `innerHTML`.
- Chip/picker triggers `POST /api/v1/items/assign` (14.2).
- Additive override store: new `db/schema.ts` table (`suggestion_override`) OR an append-only log under `DATA_DIR` — additive migration only (NFR-BC).
- `server.ts` — a read endpoint to serve suggestions (if server-computed) and/or the override-capture write route, under the `/api/v1` guarded surface (Epic 12).
- ESM `.js` specifiers; `node:test` + `inject()` for routes, pure-fn tests for render/suggest; add new test files to the `test` script.

### Testing standards

- Pure-fn tests for the chip/picker markup + suggestion resolver (string output, no DOM) — the `render-map.test.ts` pattern.
- `inject()` for the override-capture route + (if server-side) the suggestion read route.
- The assertions naive impls miss: (a) degradation keys off `providerConfigured` not field-emptiness, (b) the override store is additive + populated only on a true override, (c) suggestion compute + Inbox render mutate NOTHING (read-only NFR-BC).

### References

- [Source: docs/bmad/epics-v2.md#L184] — Story 14.3 ACs (scannable Inbox, suggestion chip one-tap, override = signal, no guilt-pile).
- [Source: docs/bmad/epics-v2.md#L191] — chip degrades to a manual board picker when AI unavailable (dignified, UJ-2).
- [Source: docs/bmad/epics-v2.md#L24] — NFR-BC wave-wide constraint (additive only; existing rows untouched).
- [Source: server.ts#L383] — `/api/meta` `providerConfigured` — the authoritative AI-available signal the chip degrades off.
- [Source: collections-ui.js#L127] — `renderEnrichmentState(item, descriptor, {providerConfigured})` — the dignified-degradation precedent to mirror.
- [Source: descriptor/render-map.js#L29] — the generic field render map (Inbox renders with no per-board code).
- [Source: docs/bmad/epics-v2.md#L178] — the one assign path (chip → 14.2, not a second mover).
- [Source: db/schema.ts#L26] — `item` table (where an additive `suggestion_override` table / nullable column would sit, NOT a reshape).

## Dev Agent Record
