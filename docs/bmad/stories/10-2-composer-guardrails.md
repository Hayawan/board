# Story 10.2: Composer guardrails (validate-and-repair)

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Epic 10 — Agentic composer.** Story 2 of 3. Build order: (1) compose a board → **(2) composer guardrails (validate-and-repair) ◄ this story** → (3) generate-fields skill. This story validates the composer's output against the meta-schema with a validate-and-repair loop, so a bad LLM proposal can't create an insane board. *(FR-12, C7, C11.)*

## Story

As the board-oss maintainer,
I want the composer output validated and repaired,
so that a bad LLM proposal can't create an insane board.

## Acceptance Criteria

1. **Validation enforces closed types, a field cap, and no duplicate/reserved keys — reserved = STRUCTURAL columns only.**
   **Given** an emitted descriptor, **When** validated, **Then** field types must be in the closed set `{text,number,date,url,enum,tags,image}`, field count ≤ N (a cap), no duplicate keys, and no field key shadows a **structural** `item` column: `id, board_id, source, status, error_reason, fields, search_blob, analysis_provider, analysis_model, created_at, updated_at`. **Critically: `favorite`, `notes`, and `title` are NOT reserved** — Story 1.2 seeds them as legitimate descriptor fields (the seeded boards declare `favorite`/`notes`/`title` fields). A guardrail that rejects them would reject the product's own seed data. Derive the reserved set from 1.1's structural columns MINUS the user/descriptor fields (`favorite`, `notes`, `title`) — programmatically, not a hand-typed partial list that drifts.

2. **On failure, one repair re-ask runs; else it surfaces as an editable draft.**
   **Given** an invalid descriptor, **When** validation fails, **Then** ONE repair re-ask runs (feed the validation errors back to the LLM for a corrected descriptor); if it still fails, it surfaces as an EDITABLE DRAFT for the user — it does NOT silently write or silently drop.

3. **Nothing is written on failure.**
   **Given** a descriptor that fails validation (even after repair), **When** handled, **Then** nothing is persisted — composition stays non-destructive.

4. **Adversarial inputs are rejected/repaired (off-list types, 500 fields, reserved/duplicate keys, structurally-wrong object).**
   **Given** adversarial proposals — off-list field types, 500 fields, reserved (structural) keys, duplicate keys, and a **structurally-wrong object** (`fields` not an array / missing required keys) — **When** validated, **Then** the guardrails reject/repair each and NEVER write on failure. *(Note: "malformed JSON" can't reach the validator — `ctx.llm.complete<T>(prompt, schema)` returns an already-`schema.parse`'d `T` (Story 4.1), so a JSON/parse failure throws inside the provider as a `ZodError` before the skill sees it. The validator's adversarial input is a structurally-wrong OBJECT, not a raw malformed string. Also assert a `favorite`/`notes`/`title` field PASSES — the seed-round-trip, AC 1.)*

5. **Adversarial tests assert reject/repair + bounded-by-call-count + never-write.**
   **Given** the adversarial inputs (AC 4) + a mock provider, **When** the guardrails run, **Then** the test asserts each is rejected or repaired; **the repair is bounded by call-count** — on the repair-succeeds path `mockProvider.completeCallCount === 2` (initial + exactly one repair), and on the terminal-failure path the provider is NOT called a third time (`=== 2`, then editable-draft); and no board row is written on terminal failure. Plus: a descriptor with `favorite`/`notes`/`title` fields PASSES (seed-round-trip).

## Tasks / Subtasks

- [ ] **Task 1 — Write the failing adversarial guardrail tests first (TDD)** (AC: 1, 2, 3, 4, 5)
  - [ ] Create `descriptor/guardrails.test.ts`: feed descriptors with (a) an off-list type (`datetime`), (b) 500 fields, (c) a reserved STRUCTURAL key (`id`/`status`), (d) a duplicate key, (e) a **structurally-wrong object** (`fields` not an array / missing required keys — NOT raw malformed JSON, which can't reach the validator per AC 4); PLUS (f) a `favorite`/`notes`/`title` field that must PASS (seed-round-trip). Assert each (a-e) rejected; ONE repair re-ask fires (`completeCallCount === 2`) and succeeds; a still-invalid descriptor → editable draft + NO board row written (and provider NOT called a 3rd time).
  - [ ] Run; confirm red for the right reason.
- [ ] **Task 2 — Implement the meta-schema validator (with an `existingKeys` param for 10.3)** (AC: 1)
  - [ ] `validateDescriptorProposal(proposal, { existingKeys = [] })`: enforce closed types (reuse Story 1.2's check), a field-count cap (N — pick + document, e.g. ≤ 20), no duplicate keys, and no key shadowing a **structural** `item` column. Define `RESERVED_FIELD_KEYS` programmatically = 1.1's structural columns (`id, board_id, source, status, error_reason, fields, search_blob, analysis_provider, analysis_model, created_at, updated_at`) **MINUS `favorite`/`notes`/`title`** (those are real descriptor fields, 1.2). Also reject keys in the passed `existingKeys` (Story 10.3 passes the board's current field keys here — the seam, so 10.3 doesn't fork the check). Return structured errors for the repair re-ask, distinguishing "reserved-system-key" from "already-exists-on-board".
- [ ] **Task 3 — Implement validate-and-repair** (AC: 2, 3)
  - [ ] On validation failure: feed the structured errors back to the LLM ONCE (`ctx.llm.complete` with a repair prompt incl. the errors) → re-validate. If the repair passes, proceed; if it still fails (or the provider is disabled/errors), surface the (best-effort) descriptor as an EDITABLE DRAFT for the user — never write, never silently drop. Exactly ONE repair attempt (not a loop — bound it).
- [ ] **Task 4 — Wire into compose-board (10.1) and generate-fields (10.3)** (AC: 3)
  - [ ] The guardrails are the validation layer for BOTH `compose-board` (10.1) and `generate-fields` (10.3). Wire them so both go through validate-and-repair before anything persists.
- [ ] **Task 5 — Wire tests + verify green** (AC: 5)
  - [ ] Add the test to the `test` script; run `npm test`; confirm green + existing suites unaffected.

## Dev Notes

### What this story changes vs preserves (read before coding)

- **NEW `descriptor/guardrails.ts` (or extends `meta-schema.ts`)** — the validate-and-repair layer. Built with Story 10.1 (10.1 proposes, 10.2 makes it safe).
- **Reuses Story 1.2's closed-type check + Story 1.1's system columns.** The closed type set (1.2) and the reserved/system column names (1.1: id/status/error_reason/favorite/created_at/etc.) are the validation inputs — don't redefine them.
- **This is the C11 (closed set) + C7 (validate-and-repair) enforcement point for generated boards.** Story 1.2 enforced closed types for the SEEDED descriptors; this story enforces them (plus cap + reserved keys) for COMPOSED descriptors.

### Why this design (anti-pattern prevention)

- **Validate-and-repair, bounded to ONE re-ask (C7).** The LLM will sometimes emit garbage; one repair re-ask (feeding the errors back) fixes most. But it must be BOUNDED — not an infinite repair loop (cost, latency, the model may never converge). One attempt, then an editable draft. [Source: docs/bmad/PRD.md#FR-12, #Constraints C7, docs/bmad/architecture.md#4.4]
- **Never write on failure (FR-12).** A failed/insane proposal must never reach the DB. Surface it as an editable draft the user fixes, or reject — but never persist. This is the "composition is non-destructive by construction" guarantee. [Source: docs/bmad/PRD.md#FR-12]
- **Reserved/system keys rejected.** A composed field named `id` or `status` would collide with system columns (Story 1.1) and corrupt the item model. Reject reserved keys explicitly. [Source: docs/bmad/stories/1-1-sqlite-drizzle-schema.md]
- **Field cap (DoS / insane-board guard).** A proposal with 500 fields is unusable (and a mild DoS). Cap field count. The counter-metric SM-C1 (low configurable knobs) is the spirit — a board has a handful of meaningful fields, not 500. [Source: docs/bmad/epics.md#Story-10.2, docs/bmad/PRD.md#7 SM-C1]
- **Adversarial tests are the deliverable.** This is a guardrail story — the test suite IS the value (off-list types, 500 fields, reserved keys, malformed JSON). A guardrail without adversarial tests is unproven. [Source: docs/bmad/epics.md#Story-10.2]

### Project Structure Notes

- `descriptor/guardrails.ts` (or in `meta-schema.ts`) + adversarial test. Reuses 1.2 closed types + 1.1 system columns. Wired into 10.1 + 10.3.
- ESM `.js` specifiers; `node:test`; mock provider for the repair re-ask; add the test to the `test` script.

### Testing standards

- Adversarial fixtures: off-list type, 500 fields, reserved key, duplicate key, malformed JSON.
- Assert: each rejected/repaired; ONE repair re-ask fires (not a loop); editable-draft fallback; NO board row on terminal failure.
- The "never write on failure" assertion is the load-bearing FR-12/C7 guarantee.
- Existing suites green.

### References

- [Source: docs/bmad/PRD.md#FR-12] — composer guardrails; validate-and-repair; closed types, field cap, no duplicate/reserved keys; non-destructive.
- [Source: docs/bmad/PRD.md#Constraints C7] — composer validate-and-repair.
- [Source: docs/bmad/architecture.md#4.4] — composer meta-schema; validate-and-repair; closed types; field cap; reserved-key rejection.
- [Source: docs/bmad/PRD.md#7 SM-C1] — low configurable schema knobs (the field-cap spirit).
- [Source: docs/bmad/stories/1-1-sqlite-drizzle-schema.md] — system/reserved column names to reject.
- [Source: docs/bmad/stories/1-2-board-descriptor-seeded-boards.md] — the closed-type check reused here.
- [Source: docs/bmad/stories/10-1-compose-board.md] — the composer this validates.
- [Source: docs/bmad/stories/10-3-generate-fields-skill.md] — the other consumer of these guardrails.

## Dev Agent Record

### Agent Model Used

_(to be filled by dev agent)_

### Debug Log References

### Completion Notes List

### File List
