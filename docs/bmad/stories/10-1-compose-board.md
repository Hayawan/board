# Story 10.1: Compose a board from a description

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Epic 10 — Agentic composer.** The thesis feature — describe a collection and get a finished, opinionated board you accept or refine. Built AFTER the seeded boards (Epics 1–9) prove the taste. *(FR-11, FR-12; UJ-4; C7.)*
>
> **Story 1 of 3 in Epic 10.** Build order: **(1) compose a board from a description ◄ this story** → (2) composer guardrails (validate-and-repair) → (3) generate-fields skill. This story: a `compose-board` skill turns a natural-language description into a Board Descriptor the user previews and accepts/refines — nothing written until accept. *(FR-11; UJ-4.)*

## Story

As a user,
I want to describe what I collect and get a proposed board,
so that I can create an opinionated board without designing a schema.

## Acceptance Criteria

1. **`compose-board` emits a descriptor conforming to the meta-schema (a ZOD schema).**
   **Given** a natural-language description, **When** the `compose-board` skill runs, **Then** the LLM emits a Board Descriptor (name, `ingest_mode`, typed fields over the closed set, `enrichment_prompt`, `view`) conforming to the meta-schema. *(The meta-schema is a **zod** schema — `z.object({...})` whose inferred type is `BoardDescriptor`, reusing 1.2's exported `Field`/`BoardDescriptor` zod — because `ctx.llm.complete(prompt, schema)` takes a zod schema (Story 4.1), NOT a raw JSON-schema object. "JSON-schema for a descriptor" is a documentation phrase; the artifact passed to `complete` is zod.)*

2. **The user previews and accepts/refines; nothing is written until accept.**
   **Given** an emitted descriptor, **When** it's returned, **Then** the user sees a PREVIEW they can accept or refine ("add a 'condition' field") — and **nothing is persisted until accept** (composition is non-destructive by construction).

3. **On accept, the board is created and the next saved item enriches against it.**
   **Given** the user accepts, **When** confirmed, **Then** a board is created (via the `create-board` skill, Story 3.4 — reused, not forked) and the next saved item enriches against the generated descriptor (Story 7.1).

4. **[MANUAL/EVAL] The descriptor has a STANCE (opinionated, not a blank schema).**
   **Given** a description, **When** composed, **Then** the descriptor reflects a point of view — typed fields worth keeping, an enrichment lens, a sensible view — NOT a generic blank-form schema (the taste guardrail — SM-C1). *(This is a prompt-quality property — verify by MANUAL/eval review against the seeded boards, NOT a unit test: a mock provider returns a canned descriptor, so asserting "it has a stance" against your own fixture is circular. SM-C1 is a human-review guard.)*

5. **A test (mock provider) asserts a valid descriptor + persisted-only-on-accept (NOT stance).**
   **Given** a mock `LLMProvider` returning a canned descriptor, **When** `compose-board` runs, **Then** the test asserts a meta-schema-valid descriptor is produced, NOTHING is written before accept, and accept → a board row (via `create-board`). The unit test does NOT assert AC 4's stance (untestable with a mock). No real LLM.

## Tasks / Subtasks

- [ ] **Task 1 — Write the failing compose tests first (TDD)** (AC: 1, 2, 3, 5)
  - [ ] Create `skills/compose-board.test.ts`: mock provider returns a canned valid descriptor; run `compose-board`; assert a meta-schema-valid descriptor is returned AND no board row exists yet (not persisted); then call accept → assert a board row created (via `create-board`). Add: mock returns an invalid descriptor → handled (Story 10.2 guardrails, referenced).
  - [ ] Run; confirm red.
- [ ] **Task 2 — Build the meta-schema (zod) + the compose prompt** (AC: 1, 4)
  - [ ] Create `descriptor/meta-schema.ts` (architecture §6): a **zod** schema for a Board Descriptor — `z.object({ name, ingest_mode: z.enum([...]), fields: z.array(<1.2's fieldSchema over the closed-type union>), enrichment_prompt, view: z.enum(['grid','list']) })`, inferring to `BoardDescriptor`. Reuse 1.2's exported `Field`/`BoardDescriptor` zod (1.2 exports them "for the composer") — do NOT define a second descriptor shape, and do NOT build a raw JSON-schema object (that breaks `complete`'s zod contract).
  - [ ] The compose prompt instructs the LLM to emit an OPINIONATED descriptor (a stance — the taste guardrail). **Carry 1.2's open-vocab decision into the prompt:** the closed set has no "suggested-but-open vocabulary" type, so map open vocabularies (like the prototype's `form`/`domain`) to `text`/`tags` — do NOT emit `enum` for an open vocabulary (it would reject novel values, the fidelity trap 1.2 flagged for Epic 10).
- [ ] **Task 3 — Implement the `compose-board` skill (propose, don't persist)** (AC: 1, 2)
  - [ ] `skills/compose-board.ts`: `run({ description }, ctx)` → `ctx.llm.complete(composePrompt, metaSchema)` → returns the proposed descriptor (validated against the meta-schema, Story 10.2). **Does NOT write anything** — it returns the proposal for preview. A separate accept step persists.
- [ ] **Task 4 — Implement accept → create-board (reuse 3.4)** (AC: 3)
  - [ ] On accept, call the `create-board` skill (Story 3.4 — the persistence primitive) with the (possibly user-refined) descriptor. Do NOT fork board-insert logic — `create-board` already validates + inserts. The next saved item enriches against it (Story 7.1, descriptor-driven).
- [ ] **Task 5 — The preview/refine UI (UJ-4)** (AC: 2)
  - [ ] A "New board" flow: type the description → see the proposed board (name, fields, lens, view) as a PREVIEW → accept or refine (edit/add a field, re-ask). Never a blank schema form. (The refine loop ties to Story 10.2's editable-draft fallback.)
- [ ] **Task 6 — Wire tests + verify green** (AC: 5)
  - [ ] Add the test to the `test` script; run `npm test`; confirm green + existing suites unaffected.

## Dev Notes

### What this story changes vs preserves (read before coding)

- **NEW `skills/compose-board.ts` + `descriptor/meta-schema.ts`** (architecture §6). The thesis feature — built last (after Epics 1–9) because it needs the descriptor (1.2), the LLMProvider (Epic 4), enrichment (7.1), create-board (3.4), and the seeded boards to prove the taste.
- **The meta-schema is the descriptor's generator-facing form (Story 1.2).** 1.2 built the descriptor's own zod schema; the meta-schema is "the schema FOR generating a descriptor" — closed types, the ingest_mode/view enums. Reuse 1.2's schema; don't define a second descriptor shape.
- **Reuses `create-board` (3.4) on accept — wrap-not-fork.** 3.4's `create-board` takes a validated descriptor and inserts it. compose-board generates the descriptor; create-board persists it. Two clean halves (NL→descriptor vs descriptor→board).
- **Depends on Story 10.2 (guardrails) for validation.** This story emits + previews; 10.2 hardens the validate-and-repair. Sequence: 10.1 proposes, 10.2 makes the proposal safe. (10.1 can reference 10.2's validator; build them together.)

### Why this design (anti-pattern prevention)

- **Nothing persisted until accept (FR-11/FR-12/C7).** Composition is non-destructive BY CONSTRUCTION — the skill returns a proposal; only the explicit accept writes. A compose that creates the board immediately would let a bad proposal pollute the user's boards. [Source: docs/bmad/PRD.md#FR-11, #FR-12]
- **A STANCE, not a blank form (the taste guardrail / SM-C1).** This is the product-defining line: the composer must output an opinionated board (fields worth keeping, a lens, a view) — if it degenerates into a schema-form filler, it collapses into "a worse Notion" (the permanently-rejected trap). The prompt must push for opinion. The counter-metric SM-C1 (configurable schema knobs in the UI should stay LOW) guards this. [Source: docs/bmad/PRD.md#4.4, #Constraints taste-guardrail, SM-C1]
- **Reuse create-board (3.4), don't fork.** Same wrap-not-fork rule as 3.3/the importer. One board-insert path. [Source: docs/bmad/stories/3-4-core-skills-add-item-create-board-tag.md]
- **Preview-and-refine, never a blank schema builder (FR-12 out-of-scope).** A raw user-facing blank-form schema builder is permanently rejected. The UI is: describe → opinionated proposal → accept/nudge. [Source: docs/bmad/PRD.md#FR-12 Out of Scope, #5 Non-Goals]

### Project Structure Notes

- `skills/compose-board.ts`, `descriptor/meta-schema.ts` (+ tests). Reuses `create-board` (3.4), descriptor schema (1.2), LLMProvider (Epic 4), guardrails (10.2). UI in `index.html`.
- ESM `.js` specifiers; `node:test`; mock provider; add the test to the `test` script.

### Testing standards

- Mock provider returns a canned descriptor; assert meta-schema-valid + not-persisted-until-accept + accept→board-row.
- The "nothing written before accept" assertion is the load-bearing FR-12/C7 guarantee.
- Existing suites green.

### References

- [Source: docs/bmad/PRD.md#FR-11] — compose a board from a description; emit a descriptor; preview accept/refine; nothing written until accept.
- [Source: docs/bmad/PRD.md#2.3 UJ-4] — Hayawan composes a board by describing it (the thesis journey).
- [Source: docs/bmad/PRD.md#Constraints] — the taste guardrail (the composer must output a board with a stance).
- [Source: docs/bmad/PRD.md#7 SM-C1] — keep configurable schema knobs low (the counter-metric).
- [Source: docs/bmad/architecture.md#4.4] — composer meta-schema; validate-and-repair; closed types.
- [Source: docs/bmad/architecture.md#3-AD10] — agentic composer, v1 launch feature, built after the seeded boards.
- [Source: docs/bmad/stories/1-2-board-descriptor-seeded-boards.md] — the descriptor schema the meta-schema reuses.
- [Source: docs/bmad/stories/3-4-core-skills-add-item-create-board-tag.md] — `create-board` reused on accept.
- [Source: docs/bmad/stories/10-2-composer-guardrails.md] — the validate-and-repair this builds with.

## Dev Agent Record

### Agent Model Used

_(to be filled by dev agent)_

### Debug Log References

### Completion Notes List

### File List
