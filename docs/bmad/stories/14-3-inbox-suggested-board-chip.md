# Story 14.3: Scannable Inbox + AI suggested-board chip

Status: review

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

- [x] **Task 1 — Failing suggestion-compute test first (TDD)** (AC: 2, 3, 6)
  - [x] `enrichment/suggest.test.ts`: given an Inbox item + candidate boards + `providerConfigured`, the resolver returns `{suggestedBoardId}` (AI on) or `null` (AI off / error / unknown-or-Inbox pick) AND mutates nothing. Confirmed red.
- [x] **Task 2 — Suggestion compute (read-only)** (AC: 2, 3)
  - [x] `enrichment/suggest.ts` → `suggestBoardForItem(handle, {itemId, llm, providerConfigured})`. Returns null when no provider; else a descriptor-driven LLM pick among candidate boards (Inbox excluded), validated against the candidate allowlist (hallucinated/injected ids → null). READ-ONLY (never writes the item); catches LLM errors → null (degrade, never throw).
- [x] **Task 3 — Chip-render test + the pure renderer** (AC: 1, 2, 3, 5)
  - [x] `descriptor/inbox-suggest.js` (pure, like `render-map.js`): `assignControlMode` (chip iff `providerConfigured && known suggestion`, else picker) + `renderAssignControl` (one-tap chip carrying the suggested board + a change-picker; or a manual picker) + `renderInboxCount` (always a clear count, even zero — no guilt-pile). XSS-safe via `escHtml`. Headless-tested.
- [x] **Task 4 — Wire tap → 14.2 assign** (AC: 2, 3) — **pure layer + endpoint delivered; DOM event glue STAGED** (see Dev Agent Record scope note).
  - [x] The chip/picker emit `data-assign-item`/`data-assign-board`; the override endpoint + the 14.2 assign endpoint exist and are tested. The browser event-wiring that reads those attributes and `fetch`es `POST /api/v1/items/assign` is staged with the SPA cutover (consistent with the 8.x DOM-staging precedent) — declared explicitly below.
- [x] **Task 5 — Override-capture test + the additive store** (AC: 4, 6)
  - [x] New `suggestion_override` table (drizzle + `CREATE TABLE IF NOT EXISTS` in BOOTSTRAP_SQL — additive, existing DBs gain it on boot). `recordAssignmentChoice` writes a row ONLY on a true override (suggestion existed AND chosen ≠ suggested); a confirm or a no-suggestion manual pick records nothing. `POST /api/v1/suggestions/override` route. Item rows untouched.
- [x] **Task 6 — NFR-BC read-only regression** (AC: 6)
  - [x] `suggest.test.ts` (item byte-for-byte unchanged after compute), `suggestion-override.test.ts` (item rows untouched on insert), and the route test (boardId unchanged) all assert read-only/additive. Full suite → **414 pass / 0 fail**.

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

### Agent Model Used

claude-opus-4-8[1m] (BMAD dev-story workflow)

### Debug Log References

- RED → GREEN per piece; full regression: **414 pass / 0 fail**, 66 suites.

### Completion Notes List

- ✅ **Scope honesty (read this first — staged DOM boundary, per the 8.x precedent):** This story delivers + tests the **pure + backend layer**: the read-only suggestion resolver (`enrichment/suggest.ts`), the additive override store (`suggestion_override` table + `recordAssignmentChoice`), the pure chip/picker/count renderer (`descriptor/inbox-suggest.js`), and the two `/api/v1` routes (suggestion read, override capture). The **browser event-glue is STAGED with the flat-JSON→SQLite SPA cutover** (Chrome offline → can't browser-verify), exactly as Stories 8.2/8.3/8.5/8.6 staged their DOM wiring: (a) the tap/select handler that reads `data-assign-item`/`data-assign-board` and `fetch`es `POST /api/v1/items/assign` (Task 4 / AC2 one-tap-move), (b) mounting `renderAssignControl` + `renderInboxCount` into the Inbox list, and (c) calling `POST /api/v1/suggestions/override` on a true override. The pure renderer emits the correct attributes/payload and the endpoints are tested; the glue is the only deferred part.
- **Read-only + additive (NFR-BC) verified.** Computing a suggestion never writes the item (deepEqual before/after); the override store is a new table (no reshape of item/board); only an explicit assign (14.2) moves an item. Nothing auto-files.
- **Dignified degradation off `providerConfigured`** (not field-emptiness): no provider → suggestion null → manual picker; an AI box that can't compute → still the picker, never an error. Mirrors `renderEnrichmentState`.
- **One assign path (D8):** the chip/picker target 14.2's assign endpoint; this story adds no second mover. The override route records signal only — it does NOT move.
- **Prompt-injection neutralized** by the candidate-id allowlist: even a jailbroken LLM can only pick an existing non-Inbox board, or it's rejected → null.

**Party-mode review (Winston security / Quinn QA) — Quinn flagged CHANGES-REQUESTED for an honesty gap (not the code); addressed before commit:**
- ✅ [High, Quinn] **Staged DOM glue was undeclared.** Unlike the 8.x precedent, the Dev Agent Record didn't admit the tap→assign wiring is staged, so a reader could think AC2's one-tap-move was wired. Added the explicit scope-honesty note above.
- ✅ [Med, Quinn] **AC5 count had no impl/test.** Added a pure `renderInboxCount` (clear count incl. zero, NaN-safe) + tests — the no-guilt-pile count now lives in the testable layer.
- ✅ [Med, Quinn] **AC1 was assert-by-reuse.** Added a route test proving the Inbox serves its items through the generic hydrator (`/api/collections/inbox/items`) — no per-board code.
- ✅ [Low, Winston] Documented that the board name/descriptor in the suggest prompt is author-controlled (trusted), distinct from the untrusted item content; the candidate-id allowlist guards regardless.
- ✅ [Low, Winston] Documented that `chosen_board_id` is intentionally NOT FK-constrained (the override is historical signal that should survive a board deletion; `item_id` keeps its FK).
- 📝 [Nit, accepted] The override route relies on the `item_id` FK to reject a bad item (would surface as a 500, not 400) — signal-only edge case, left as-is.

### File List

- `enrichment/suggest.ts` (new) — read-only `suggestBoardForItem` (descriptor-driven LLM pick; degrades to null; candidate-id allowlist).
- `enrichment/suggest.test.ts` (new) — 5 tests (AI pick, no-provider null, error/unknown null, never-Inbox, read-only).
- `db/suggestion-override.ts` (new) — `recordAssignmentChoice` (true-override-only) + `listOverrides`.
- `db/suggestion-override.test.ts` (new) — 4 tests (records override, confirm/no-suggestion record nothing, item untouched).
- `db/schema.ts` (modified) — additive `suggestionOverrides` table (`chosen_board_id` intentionally un-FK'd).
- `db/index.ts` (modified) — `CREATE TABLE IF NOT EXISTS suggestion_override` in BOOTSTRAP_SQL (additive).
- `descriptor/inbox-suggest.js` (new) — pure `assignControlMode` + `renderAssignControl` + `renderInboxCount`.
- `descriptor/inbox-suggest.test.ts` (new) — mode/chip/picker/escaping/count tests.
- `api/v1.ts` (modified) — `GET /items/:id/suggestion` (read-only) + `POST /suggestions/override` routes.
- `api/v1.test.ts` (modified) — AC1 generic-hydrator test, suggestion null/AI-pick, override true/confirm/400.
- `package.json` (modified) — registered the 3 new test files.

### Change Log

- 2026-06-23 — Story 14.3: read-only AI board-suggestion resolver + additive override store + pure chip/picker/count renderer + `/api/v1` suggestion & override routes. Degrades off `providerConfigured`; one assign path (chip → 14.2); NFR-BC read-only/additive verified. DOM event-glue staged (8.x precedent). 414 pass / 0 fail.
- 2026-06-23 — Addressed party-mode review (Quinn CHANGES-REQUESTED, honesty gap): added the explicit staged-DOM scope note, a `renderInboxCount` impl+test (AC5), and an AC1 generic-hydrator route test; documented the author-controlled prompt context + the un-FK'd chosen_board_id.
