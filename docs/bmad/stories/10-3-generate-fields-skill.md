# Story 10.3: generate-fields skill (LLM-assisted field suggestion on an existing board)

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Epic 10 — Agentic composer.** Story 3 of 3. Build order: (1) compose a board → (2) composer guardrails → **(3) generate-fields skill ◄ this story**. This story lets a user ask the agent to suggest/add custom fields to an EXISTING board — a lighter cousin of the composer, reusing the LLM provider (Epic 4) and the composer guardrails (Story 10.2). *(FR-19; the founder's "ask the agent to generate custom fields".)*

## Story

As a user refining a board,
I want to ask the agent to suggest/add custom fields to an existing board,
so that I can evolve a board's schema without designing it by hand.

## Acceptance Criteria

1. **`generate-fields` proposes additional typed fields (closed set) to accept/reject.**
   **Given** an existing board descriptor and a natural-language request, **When** the `generate-fields` skill runs, **Then** the LLM proposes additional typed fields (closed type set) the user accepts or rejects; accepted fields are appended to the descriptor.

2. **Guardrails (Story 10.2) reject/repair bad proposals — incl. an existing-key collision (distinct error).**
   **Given** a proposal with out-of-set types, reserved (structural) keys, or a key that **already exists on the board**, **When** validated, **Then** the Story 10.2 guardrails reject/repair it. The existing-key check uses 10.2's `existingKeys` parameter (this skill passes the loaded descriptor's `fields[].key`) — NOT a forked check. An exact match of an existing field is rejected with an "already exists" error, distinct from the reserved-system-key error. Nothing is written until accept.

3. **The descriptor changes only on accept.**
   **Given** a proposal, **When** the user has not accepted, **Then** the board descriptor is unchanged; on accept, the accepted fields are appended (existing items keep working — new fields are empty/enrichable).

4. **A unit test (mock provider) asserts a valid proposal, guardrail rejection, and accept-only change.**
   **Given** a mock provider, **When** the skill runs, **Then** the test asserts: a valid proposal is produced; bad fields (off-list type, duplicate-of-existing key) are rejected by the 10.2 guardrails; the descriptor changes ONLY on accept. No real LLM.

## Tasks / Subtasks

- [ ] **Task 1 — Write the failing generate-fields tests first (TDD)** (AC: 1, 2, 3, 4)
  - [ ] Create `skills/generate-fields.test.ts`: mock provider proposes new fields for an existing descriptor; assert valid fields proposed; assert an off-list type AND a key duplicating an existing field are rejected (10.2 guardrails); assert the descriptor is unchanged until accept, then appended on accept.
  - [ ] Run; confirm red.
- [ ] **Task 2 — Implement the `generate-fields` skill (propose; accept = descriptor UPDATE)** (AC: 1, 3)
  - [ ] `skills/generate-fields.ts`: `run({ boardId, request }, ctx)` → load the existing descriptor → `ctx.llm.complete(prompt, fieldsSchema)` proposing ADDITIONAL fields → return the proposal (not persisted). **The prompt must propose OPINIONATED fields worth keeping for THIS board's lens** (the taste guardrail / SM-C1) — not a generic "add any field" list.
  - [ ] **Accept = a descriptor UPDATE, not a create.** `create-board` (3.4) only INSERTs a new board — it has NO update path. Appending fields to an existing board needs an `update-board-descriptor` primitive (name it; it doesn't exist in 3.4 — this story introduces it, or extends create-board to upsert; decide + document). Don't mis-cite `create-board` for an update.
- [ ] **Task 3 — Run proposals through the Story 10.2 guardrails (via the `existingKeys` seam)** (AC: 2)
  - [ ] Call 10.2's `validateDescriptorProposal(proposal, { existingKeys: descriptor.fields.map(f => f.key) })` — the existing keys go through 10.2's parameter, NOT a forked check (wrap-not-fork). Inherits 10.2's CORRECTED reserved set (structural columns only; `favorite`/`notes`/`title` allowed). Validate-and-repair (one re-ask) then editable-draft.
- [ ] **Task 4 — Accept appends; existing items keep working** (AC: 3)
  - [ ] On accept, append the fields to the descriptor. Existing items simply have those fields empty (the generic renderer, Story 7.2, handles missing field values); the next enrichment (Story 7.1) can fill enrichable new fields. No migration of existing items needed (schema-as-data — the field just exists now).
- [ ] **Task 5 — Wire tests + verify green** (AC: 4)
  - [ ] Add the test to the `test` script; run `npm test`; confirm green + existing suites unaffected.

## Dev Notes

### What this story changes vs preserves (read before coding)

- **NEW `skills/generate-fields.ts`** — architecture §6 lists `generate-fields.ts` as a v1 skill. The "lighter cousin" of the composer: it proposes FIELDS for an existing board, not a whole board.
- **Reuses the LLM provider (Epic 4) + the composer guardrails (Story 10.2).** This is why it's placed in Epic 10 (the epics.md note says so explicitly) — it leans on 10.2's validate-and-repair. Don't fork the guardrails.
- **Realizes the founder's "ask the agent to generate custom fields" (FR-19, the epics.md note).** Distinct from `compose-board` (whole board from scratch) — this evolves an existing board's schema.
- **Append-only, schema-as-data (no migration).** Adding a field to a descriptor doesn't migrate existing items — they just have that field empty. The generic renderer (7.2) and enrichment (7.1) handle it. This is the AD9 payoff: schema changes are data changes.

### Why this design (anti-pattern prevention)

- **Reuse 10.2 guardrails (closed types, cap, reserved + EXISTING keys).** A generated field must pass the same guardrails as a composed board — plus it can't duplicate an existing board field key (which would shadow/collide). Don't fork the guardrails. [Source: docs/bmad/stories/10-2-composer-guardrails.md]
- **Nothing written until accept (FR-12 spirit).** Same non-destructive rule as the composer — the proposal is previewed; only accept appends. [Source: docs/bmad/PRD.md#FR-12]
- **Append-only, no item migration (AD9).** Don't migrate existing items when a field is added — schema-as-data means the field just exists; items render it empty until enriched. A migration step would defeat the whole model. [Source: docs/bmad/architecture.md#9-AD9]
- **Still a STANCE, not a blank-field-adder (taste guardrail).** Even field-adding should be opinionated (suggest fields worth keeping for this board's lens), not a generic "add any field" form — same SM-C1 spirit as the composer. [Source: docs/bmad/PRD.md#7 SM-C1]

### Project Structure Notes

- `skills/generate-fields.ts` (+ test). Reuses LLMProvider (Epic 4), guardrails (10.2), descriptor (1.2), create-board/descriptor-update. UI accept/reject in `index.html`.
- ESM `.js` specifiers; `node:test`; mock provider; add the test to the `test` script.

### Testing standards

- Mock provider; assert valid proposal, guardrail rejection (off-list + duplicate-existing-key), accept-only change.
- The "descriptor unchanged until accept" + "off-list/duplicate rejected" assertions are load-bearing.
- Existing suites green.

### References

- [Source: docs/bmad/PRD.md#FR-19] — skill registry; `generate-fields` as a v1 skill.
- [Source: docs/bmad/epics.md#Story-10.3] — generate-fields; the founder's "ask the agent to generate custom fields"; reuses Epic 4 + Story 10.2.
- [Source: docs/bmad/architecture.md#4.1] — `generate-fields` in the v1 skill list.
- [Source: docs/bmad/architecture.md#9-AD9] — schema-as-data; append-only, no migration.
- [Source: docs/bmad/stories/10-2-composer-guardrails.md] — the guardrails reused (+ existing-key check).
- [Source: docs/bmad/stories/1-2-board-descriptor-seeded-boards.md] — the descriptor appended to.
- [Source: docs/bmad/stories/7-1-descriptor-driven-enrichment-worker.md], [Source: docs/bmad/stories/7-2-generic-field-renderer.md] — enrichment + rendering of the new fields.

## Dev Agent Record

### Agent Model Used

_(to be filled by dev agent)_

### Debug Log References

### Completion Notes List

### File List
