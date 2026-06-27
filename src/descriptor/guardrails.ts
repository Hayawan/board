import { BoardDescriptorSchema, SYSTEM_COLUMNS, type BoardDescriptor } from './types.js';

// Story 10.2 — composer guardrails: validate a COMPOSED descriptor against the
// meta-schema + structural rules, with a bounded validate-and-repair loop, so a bad
// LLM proposal can never create an insane board or pollute the DB (FR-12, C7, C11).

// Field-count cap (insane-board / mild-DoS guard). Set ABOVE the 20-field Inspiration
// exemplar (the taste benchmark) so a composed board can be as rich, while still
// bounding a 500-field proposal.
export const FIELD_CAP = 24;

// Empty-state copy caps: a stance headline stays a headline, the body stays one line.
export const EMPTY_STATE_HEAD_CAP = 60;
export const EMPTY_STATE_BODY_CAP = 200;

// Reserved field keys = the structural/system `item` columns (Story 1.1) a descriptor
// field key must never shadow.
//
// DEVIATION FROM STORY AC1 (documented + intentional): 10.2's AC1 says to EXCLUDE
// `favorite`/`notes`/`title` from the reserved set, assuming Story 1.2 seeds them AS
// descriptor fields. The ACTUAL Story 1.2 (party-mode consensus, settled / "do not
// relitigate") makes `title`/`notes`/`favorite` SYSTEM COLUMNS — NEVER descriptor
// fields; the real user descriptor field is `favorite_reason`. So the authoritative
// reserved set is the FULL `SYSTEM_COLUMNS` (which already includes title/notes/
// favorite). `favorite_reason` is not a system column → it passes. The story's
// "seed-round-trip (favorite/notes/title field must PASS)" is superseded; the correct
// round-trip is "the real seeded descriptors validate + favorite_reason passes".
export const RESERVED_FIELD_KEYS: ReadonlySet<string> = SYSTEM_COLUMNS;

export interface ProposalError {
  code: 'structural' | 'field-cap' | 'duplicate-key' | 'reserved-system-key' | 'already-exists-on-board';
  message: string;
  field?: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ProposalError[];
  descriptor?: BoardDescriptor;
}

/**
 * Validate a composed descriptor. Enforces: structural shape + closed field types
 * (reusing Story 1.2's BoardDescriptorSchema — z.enum(FIELD_TYPES) rejects off-list
 * types), a field-count cap, no duplicate keys, no key shadowing a system column, and
 * no key already on the board (`existingKeys`, the Story 10.3 seam). Returns structured
 * errors (distinguishing reserved-system-key from already-exists-on-board) for the
 * repair re-ask. NEVER throws — invalid input returns ok:false.
 */
export function validateDescriptorProposal(
  proposal: unknown,
  opts: { existingKeys?: string[] } = {},
): ValidationResult {
  // Structural + closed-type gate (zod). A structurally-wrong object (fields not an
  // array / missing keys / off-list type) fails here.
  const parsed = BoardDescriptorSchema.safeParse(proposal);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => ({
        code: 'structural' as const,
        message: i.message,
        field: i.path.join('.') || undefined,
      })),
    };
  }

  const descriptor = parsed.data;

  // Normalize the optional empty-state copy: trim, cap to keep it a glance-able
  // headline + one line (the LLM occasionally over-writes), and DROP the whole block
  // if either half is empty after trimming — a blank head/body is worse than the
  // generic fallback voice. Not an error (copy is best-effort), so no repair re-ask.
  if (descriptor.empty_state) {
    const head = descriptor.empty_state.head.trim().slice(0, EMPTY_STATE_HEAD_CAP);
    const body = descriptor.empty_state.body.trim().slice(0, EMPTY_STATE_BODY_CAP);
    if (head && body) descriptor.empty_state = { head, body };
    else delete descriptor.empty_state;
  }

  const errors: ProposalError[] = [];

  // Cap the RESULTING board: proposed fields + any existing keys (Story 10.3 passes
  // the board's current keys, so generate-fields can't blow the cap by appending).
  // compose-board passes no existingKeys → this is just the proposed count.
  const existingKeys = opts.existingKeys ?? [];
  const totalCount = descriptor.fields.length + existingKeys.length;
  if (totalCount > FIELD_CAP) {
    errors.push({ code: 'field-cap', message: `too many fields: ${totalCount} (max ${FIELD_CAP})` });
  }

  const existing = new Set(existingKeys);
  const seen = new Set<string>();
  for (const f of descriptor.fields) {
    if (seen.has(f.key)) {
      errors.push({ code: 'duplicate-key', message: `duplicate field key "${f.key}"`, field: f.key });
    }
    seen.add(f.key);
    if (RESERVED_FIELD_KEYS.has(f.key)) {
      errors.push({ code: 'reserved-system-key', message: `field key "${f.key}" shadows a system column`, field: f.key });
    }
    if (existing.has(f.key)) {
      errors.push({ code: 'already-exists-on-board', message: `field key "${f.key}" already exists on the board`, field: f.key });
    }
  }

  return errors.length ? { ok: false, errors } : { ok: true, errors: [], descriptor };
}

export interface RepairOutcome {
  ok: boolean;
  name?: string;
  descriptor?: BoardDescriptor;
  /** On terminal failure: the best-effort proposal surfaced as an EDITABLE DRAFT. */
  draft?: { name: string; descriptor: unknown };
  errors?: ProposalError[];
}

/** Generic outcome of {@link boundedRepair}: the validated `value` on ok, else `draft`. */
export interface BoundedRepairResult<T, V, E = ProposalError> {
  ok: boolean;
  /** The validator's canonical value on success. */
  value?: V;
  /** The last (still-invalid) proposal, surfaced as an editable draft. */
  draft?: T;
  errors?: E[];
}

/**
 * Generic bounded validate-and-repair (Story 15.2 — extracted from validateAndRepair so
 * the composer can reuse the SAME ≤1-repair discipline for a non-descriptor proposal).
 * `propose(errors?)` is called once, then ONCE MORE with the validation errors if the
 * first fails (exactly one repair, not a loop). `validate` returns `{ok, value?, errors?}`.
 * The error type `E` is generic (the composer carries its own codes, not the descriptor
 * `ProposalError` union). On terminal failure → the last proposal as an editable draft.
 * NEVER persists.
 */
export async function boundedRepair<T, V = T, E = ProposalError>(
  propose: (errors?: E[]) => Promise<T>,
  validate: (candidate: T) => { ok: boolean; value?: V; errors?: E[] },
): Promise<BoundedRepairResult<T, V, E>> {
  const first = await propose();
  let result = validate(first);
  if (result.ok) return { ok: true, value: result.value };

  const repaired = await propose(result.errors);
  result = validate(repaired);
  if (result.ok) return { ok: true, value: result.value };

  return { ok: false, draft: repaired, errors: result.errors };
}

/**
 * Bounded validate-and-repair for board DESCRIPTORS (shared by compose-board 10.1 +
 * generate-fields 10.3). A thin wrapper over {@link boundedRepair} whose validator is
 * `validateDescriptorProposal`. Exactly ONE repair; editable draft on terminal failure;
 * NEVER persists. Behavior/return shape preserved verbatim for its existing callers.
 */
export async function validateAndRepair(
  propose: (errors?: ProposalError[]) => Promise<{ name: string; descriptor: unknown }>,
  opts: { existingKeys?: string[] } = {},
): Promise<RepairOutcome> {
  const r = await boundedRepair<{ name: string; descriptor: unknown }, { name: string; descriptor: BoardDescriptor }>(
    propose,
    (cand) => {
      const res = validateDescriptorProposal(cand.descriptor, opts);
      return res.ok ? { ok: true, value: { name: cand.name, descriptor: res.descriptor! } } : { ok: false, errors: res.errors };
    },
  );
  if (r.ok) return { ok: true, name: r.value!.name, descriptor: r.value!.descriptor };
  return { ok: false, draft: r.draft, errors: r.errors };
}
