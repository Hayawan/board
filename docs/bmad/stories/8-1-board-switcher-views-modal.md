# Story 8.1: Board switcher, views & detail modal

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Epic 8 — Boards experience.** The browseable product — sidebar switcher, grid/list views, detail modal, filters, per-item actions, optimistic save, and the degraded + first-run states. *(FR-13, FR-14, FR-15, FR-18; UJ-1, UJ-2, UJ-3.)*
>
> **Story 1 of 6 in Epic 8.** Build order: **(1) board switcher, views & detail modal ◄ this story** → (2) filters → (3) per-item actions → (4) optimistic save → (5) degraded state → (6) warm first-run. This story is the browse shell: switch boards, see grid/list views per descriptor, open an item's detail (rendered generically via Story 7.2). *(FR-13.)*

## Story

As a user,
I want to switch boards, see grid/list views, and open item details,
so that I can browse my collections.

## Acceptance Criteria

1. **A board switcher lists boards.**
   **Given** ≥1 board, **When** I load the UI, **Then** a switcher lists the boards and lets me select one (persisting the active board, e.g. localStorage).

2. **A pure `selectView(descriptor)` drives layout (the testable proxy for "data-driven, not hardcoded").**
   **Given** a descriptor, **When** `selectView(descriptor)` runs, **Then** it returns `'grid'|'list'` from `descriptor.view` — Inspiration→grid, Library→list. *(This is the unit-testable form of AC 4's "no per-board branch" — you can't assert the absence of an `if`, so assert this pure fn over both seeded descriptors instead.)*

3. **Opening an item shows capture + enriched + user fields, with keyboard dismissal.**
   **Given** an item, **When** I open its detail, **Then** the (single, generic) modal shows the item's fields rendered via Story 7.2's render-map — capture + enriched + user fields — plus its asset; **and the modal is keyboard-dismissible (Esc) and returns focus to the opened card.**

4. **Both seeded boards browse via ONE unified code path (this story owns the unification).**
   **Given** Inspiration and Library, **When** browsed, **Then** both use one switcher + the `selectView`-driven layout + ONE generic detail modal. *(Scope note: the prototype has THREE renderers (`renderGrid` 1562, `renderList` 1597, `renderLibraryList` 1637) and TWO modals (`openModal`, `openLibraryModal`). Collapsing the inspiration-vs-library list split into one list renderer + one modal is THIS story's DOM work — not silently 7.2's. This is a non-trivial reconciliation; scope it honestly. Verified manually for both boards — mark AC 4's browse-check as a MANUAL verification.)*

## Tasks / Subtasks

- [ ] **Task 1 — Reuse/adapt the prototype's switcher + view + modal** (AC: 1, 2, 3)
  - [ ] The prototype already has most of this (recon): `renderSwitcher` (`index.html:1364`), `setActiveCollection` (`index.html:1381`, persists to localStorage), the `render()` dispatch (`index.html:1550`), `renderGrid`/`renderList`/`renderLibraryList`. v1 evolves these to be descriptor-driven (Story 7.2) rather than per-collection-hardcoded. The detail modal is the Story 7.2 generic renderer (replacing `openModal`/`openLibraryModal`).
- [ ] **Task 2 — Make the view choice descriptor-driven + unify the list renderers/modals** (AC: 2, 4)
  - [ ] Add a pure `selectView(descriptor) → 'grid'|'list'` (testable); `render()` keys layout off it, not `activeCol.type === 'inspiration'` (the prototype's branch, `index.html:1550`). Fields within render via Story 7.2's `renderFields`.
  - [ ] **Collapse the three renderers → grid + one list, and the two modals → one generic modal.** `renderList` (inspiration `.list-card`→`openModal`) and `renderLibraryList` (library `.lib-card`→`openLibraryModal`) are distinct markup/modal today; v1 has one list renderer + one descriptor-driven modal (Story 7.2). Decide the unified list-card markup; this reconciliation is in scope here.
- [ ] **Task 3 — Serve descriptors so the frontend can render** (AC: 2, 3)
  - [ ] Ensure `/api/collections` (or a board endpoint) returns each board's descriptor (Story 7.2 Task 4 does this — depend on it). The switcher + view + modal all read the descriptor.
- [ ] **Task 4 — Verify both boards browse via the generic path** (AC: 4)
  - [ ] Manually verify Inspiration (grid) and Library (list) both switch, render, and open details with no per-board branch. (Frontend; cover the pure helpers via `collections-ui.test.ts`-style tests.)
- [ ] **Task 5 — Wire any pure-helper tests + verify green** (AC: 4)
  - [ ] Add/extend pure-helper tests (e.g. `collections-ui.js` `resolveActiveCollection`, `collectionChrome`); run `npm test`; confirm green.

## Dev Notes

### What this story changes vs preserves (read before coding)

- **Evolves the prototype's existing browse UI (recon).** The prototype HAS a working switcher + grid/list + modals — but per-collection-hardcoded. This epic generalizes it: the switcher stays (`renderSwitcher` 1364), the view keys off `descriptor.view`, and the modal is Story 7.2's generic renderer. This is the "experience" epic where the two seeded boards finally browse cleanly through one code path.
- **Note: the prototype's "sidebar" is actually a header button row** (recon: `renderSwitcher` builds `.coll-btn` into `.header-row-left`, not a true left sidebar). The epic/PRD say "sidebar." Decide: keep the header-row switcher (less work, ships the value) or build a real sidebar. The AC says "switcher lists boards" — either satisfies it; document the choice. (Recommend: keep the header row for v1 unless the founder wants the sidebar.)
- **Depends on Story 7.2 (generic renderer + descriptor served).** This story is the shell around 7.2's field rendering.
- **Optimistic save, live status, filters, actions, degraded/first-run are the OTHER stories (8.2-8.6)** — this story is browse + view + detail only. Don't pull them in.

### Why this design (anti-pattern prevention)

- **Descriptor-driven view, no per-board branch (FR-13/FR-3).** `if (type === 'inspiration')` in `render()` is exactly what schema-as-data eliminates — a composed board (Epic 10) must browse with no code. Key off `descriptor.view`. [Source: docs/bmad/PRD.md#FR-13, docs/bmad/architecture.md#4.4]
- **Reuse the shipping prototype UI (assumption §6).** The PRD is explicit that the prototype's frontend is reused (3× cheaper than re-platforming). Don't rewrite the switcher/modal from scratch — evolve them. [Source: docs/bmad/PRD.md#9 Assumptions]
- **Keep vanilla-JS.** No framework (architecture §2; the framework question is Story 8.4's if optimistic-save forces it). [Source: docs/bmad/architecture.md#2]

### Project Structure Notes

- Frontend in `index.html` (evolving `renderSwitcher`/`render`/modals); pure helpers in `collections-ui.js`. Descriptor from `/api/collections` (7.2).
- ESM `.js` specifiers; `node:test` for pure helpers; add tests to the `test` script.

### Testing standards

- Pure helpers (`resolveActiveCollection`, `collectionChrome`, view selection) are node:test-importable (the `collections-ui.test.ts` precedent) — test those; DOM glue is manual/existing-suite.
- Existing suites green.

### References

- [Source: docs/bmad/PRD.md#FR-13] — browse & detail; switch boards, view in the board's view, detail modal.
- [Source: index.html#1364,#1381,#1550] — `renderSwitcher`, `setActiveCollection`, `render()` dispatch to evolve.
- [Source: collections-ui.js#3,#15] — `resolveActiveCollection`, `collectionChrome` pure helpers.
- [Source: docs/bmad/stories/7-2-generic-field-renderer.md] — the generic detail renderer + descriptor served.
- [Source: docs/bmad/architecture.md#4.4] — descriptor.view drives layout.

## Dev Agent Record

### Agent Model Used

_(to be filled by dev agent)_

### Debug Log References

### Completion Notes List

### File List
