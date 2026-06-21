# Story 7.2: Generic field renderer (field-type → component)

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Epic 7 — Dynamic enrichment & rendering.** Story 2 of 3. Build order: (1) enrichment worker → **(2) generic field renderer ◄ this story** → (3) re-enrich/refetch. This story makes item cards render ANY descriptor's fields via a field-type→component map over the closed set — so boards display without per-board frontend code, replacing the prototype's two hardcoded modals. *(FR-3.)*

## Story

As a user,
I want item cards to render any descriptor's fields,
so that boards display without per-board frontend code.

## Acceptance Criteria

1. **Each field renders via a pure field-type → component map returning a STRING (not a DOM node).**
   **Given** an item + descriptor, **When** rendered, **Then** each field renders via a map keyed by the closed field type (`text`/`number`/`date`/`url`/`enum`/`tags`) → a `renderFn(field, value) → string` (HTML markup string, NOT a live `document.createElement` node) — so it's headless-testable in `node:test` (no DOM), and there is no per-board branching. *(`image`-type rendering is for asset-backed display — see AC 3 on assets.)*

2. **An unknown type degrades safely.**
   **Given** a field whose type isn't in the map, **When** rendered, **Then** it degrades to a quiet text fallback — no throw, no crashed card.

3. **The two seeded boards render via the same map; assets render separately; card field-set is decided.**
   **Given** Inspiration (grid) and Library (list), **When** rendered, **Then** both go through the one render-map. Decisions to pin: (a) **assets (screenshots) render separately from descriptor fields** — the Inspiration screenshot is an `asset` row (Story 1.2 does NOT seed an `image` descriptor field), so the card renders the asset thumbnail + the descriptor's text/tags/enum fields, NOT via an `image` *field*; (b) **card = all descriptor fields for v1** (the descriptor `{key,label,type,enrichable}` carries no display-location hint; a curated card subset would require a descriptor display-hint, which is a closed-shape change owned by 1.2/Epic 10 — out of scope here; accept "card shows all fields" for v1 and say so). Removing the bespoke modals (`openModal`/`openLibraryModal`/`DESIGN_FIELDS`) is verified by a **review-time grep** (AC 3 is a code-absence check, not the AC 4 unit test).

4. **A test asserts the pure render-map + the pure field-iteration (DOM glue is out of unit-test scope).**
   **Given** a sample descriptor with one field per closed type, **When** the pure `renderMap[type](field, value)` and `renderFields(descriptor, item)` run, **Then** the test asserts each type's markup string (e.g. `url` → contains `<a`, `tags` → chips, `enum` → badge) + the unknown-type fallback + the ordered field list. *(The `index.html` DOM wiring — `el.innerHTML = renderFields(...)` + the generic save/PATCH handler — is NOT unit-tested in node:test; it's covered by the existing suite / manual check. Scope AC 4 honestly to the pure layer.)*

## Tasks / Subtasks

- [ ] **Task 1 — Write the failing render-map tests first (TDD)** (AC: 1, 2, 4)
  - [ ] Create `descriptor/render-map.test.ts`: a descriptor with one field per closed type → assert each maps to its component (the render fn produces the expected element/markup); an unknown type → safe fallback (no throw).
  - [ ] Run; confirm red.
- [ ] **Task 2 — Implement the pure render-map + field-iteration (return strings)** (AC: 1, 2, 4)
  - [ ] Create `descriptor/render-map.ts` (architecture §6): a map `{ text, number, date, url, enum, tags } → renderFn(field, value) → string` (HTML markup string). text → `<p>`, url → `<a>`, tags → chips, enum → badge, etc. Default/unknown → text fallback. **Return strings, not DOM nodes** (headless-testable). Also export a pure `renderFields(descriptor, item) → ordered render-output array/string` — this is the iteration logic, pulled into the pure layer so it's tested (not buried in DOM glue).
  - [ ] Render `image`/asset-backed display via a separate `renderAsset(asset)` (the screenshot is an asset row, not a descriptor field — see AC 3).
- [ ] **Task 3 — Drive the frontend card/modal from the render-map (acknowledge the DOM + save-handler rewrite)** (AC: 3)
  - [ ] Replace the prototype's bespoke rendering with descriptor-driven: the detail modal + card body call `renderFields(descriptor, item)` (the thin DOM glue is `el.innerHTML = ...`). Remove `DESIGN_FIELDS` (`index.html:1281-1291`), `openModal` (`index.html:1846`, ~85 lines), `openLibraryModal` (`index.html:1698`, ~50 lines), and the per-collection branches.
  - [ ] **This is a non-trivial DOM rewrite, not "thin glue" — be honest about scope.** The hardcoded save handlers `saveReflection` (`index.html:1933`) and `saveLibraryNotes` (`index.html:1749`) are bound to specific element IDs and PATCH specific fields. Replace them with ONE generic editable-field → `PATCH` dispatch (which field is editable comes from the descriptor — e.g. `enrichable:false` text fields are editable). This save-handler generalization is part of this task and is covered by manual/existing-suite testing, not the AC-4 pure unit test.
  - [ ] Layout (grid/list) still keys off `descriptor.view`; fields within render generically. Keep vanilla-JS (architecture §2 — framework deferred to Story 8.4). No framework here.
- [ ] **Task 4 — Serve the descriptor to the frontend** (AC: 1)
  - [ ] The frontend needs each board's descriptor to render. Expose it (e.g. include it in `GET /api/collections` or a board-descriptor endpoint) so the renderer has the field list + types. (The prototype's `/api/collections` returns the manifest, `server.ts:259` — extend it with the descriptor.)
- [ ] **Task 5 — Wire tests + verify green** (AC: 4)
  - [ ] Add the test to the `test` script; run `npm test`; confirm green + existing suites unaffected.

## Dev Notes

### What this story changes vs preserves (read before coding)

- **NEW `descriptor/render-map.ts`** (architecture §6: "field-type → component (frontend)"). The pure map is the testable core; the frontend wires it into the modal/card.
- **Replaces the prototype's hardcoded rendering (recon).** The prototype has TWO bespoke modals — `openModal` (inspiration, `index.html:1846`, hardcoded design grid from `DESIGN_FIELDS` `index.html:1281-1291` + 3 hardcoded reflection textareas) and `openLibraryModal` (`index.html:1698`, hardcoded summary/key_points/notes) — plus per-collection render branches (`renderGrid` 1562, `renderLibraryList` 1637). v1 replaces the *field rendering* with the descriptor-driven map; the grid-vs-list layout choice stays (keyed off `descriptor.view`).
- **The closed field-type set (Story 1.2) is what makes this finite.** Exactly 7 types → exactly 7 render components + a fallback. This is why C11 (closed set) is load-bearing for rendering.
- **Vanilla-JS preserved (architecture §2).** Don't pull in React/Vue — the render-map is plain functions producing DOM/markup. The framework question is deferred to Story 8.4 (optimistic save) and only if forced.

### Why this design (anti-pattern prevention)

- **One map, no per-board code (FR-3/AD9).** A new composed board (Epic 10) must render with zero frontend changes. A `if (board === 'inspiration')` branch anywhere in rendering breaks that. Iterate the descriptor, dispatch by field type. [Source: docs/bmad/PRD.md#FR-3, docs/bmad/architecture.md#4.4]
- **Safe degrade on unknown type.** Even though the closed set should prevent it, a defensive fallback means a bad descriptor field renders as text, not a blank/crashed card. Never let one field break the whole card. [Source: docs/bmad/epics.md#Story-7.2]
- **Pure render functions, testable headless.** `renderFn(field, value) → markup` with no DOM globals is unit-testable in `node:test` (assert the returned string/structure). Don't bury rendering in DOM-manipulation that needs a browser to test. [Source: docs/bmad/PRD.md#NFR-5]
- **Layout (view) vs field rendering are separate concerns.** `descriptor.view` (grid/list) picks the layout; the render-map fills fields within it. Don't conflate — a grid board and a list board share the same field renderers. [Source: docs/bmad/architecture.md#4.4]

### Project Structure Notes

- `descriptor/render-map.ts` (pure) + `.test.ts`; frontend wiring in `index.html` (replacing the bespoke modals). Descriptor served via `/api/collections` (extend `server.ts:259`).
- ESM `.js` specifiers; `node:test`; add the test to the `test` script.

### Testing standards

- Test the pure render-map (field+value → markup) headless — one field per closed type + the unknown fallback. No browser needed.
- The frontend wiring (DOM) is harder to unit-test in `node:test`; cover the logic via the pure map + keep the DOM glue thin. (collections-ui.js-style pure helpers are the precedent — `collections-ui.js` is node:test-importable, recon.)
- Existing suites green (the existing `collections-ui.test.ts` covers the helper layer).

### References

- [Source: docs/bmad/architecture.md#4.4-schema-as-data-descriptor] — dynamic rendering: field-type→component map over the closed set.
- [Source: docs/bmad/PRD.md#FR-3] — dynamic rendering; no per-board frontend code.
- [Source: docs/bmad/architecture.md#6-source-tree] — `descriptor/render-map.ts`.
- [Source: index.html#1281-1291] — `DESIGN_FIELDS` constant to remove.
- [Source: index.html#1698,#1846] — the two hardcoded modals (`openLibraryModal`, `openModal`) to replace.
- [Source: index.html#1562,#1637] — `renderGrid`/`renderLibraryList` (layout stays, field-rendering generalizes).
- [Source: server.ts#259] — `/api/collections` to extend with the descriptor.
- [Source: docs/bmad/stories/1-2-board-descriptor-seeded-boards.md] — the closed field-type set + descriptors driving rendering.

## Dev Agent Record

### Agent Model Used

_(to be filled by dev agent)_

### Debug Log References

### Completion Notes List

### File List
