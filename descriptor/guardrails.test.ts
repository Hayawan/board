import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { validateDescriptorProposal, validateAndRepair, FIELD_CAP, type ProposalError } from './guardrails.js';
import { INSPIRATION_DESCRIPTOR, LIBRARY_DESCRIPTOR } from '../db/seed.js';

const validDescriptor = (fields: unknown[] = [{ key: 'region', label: 'Region', type: 'text', enrichable: true }]) => ({
  fields,
  enrichment_prompt: 'x',
  view: 'grid',
  ingest_mode: 'url-screenshot',
});

describe('composer guardrails — validateDescriptorProposal (Story 10.2)', () => {
  // AC1/AC4 — closed types
  it('rejects an off-list field type', () => {
    const r = validateDescriptorProposal(validDescriptor([{ key: 'when', label: 'When', type: 'datetime' }]));
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.code === 'structural'));
  });

  // AC1/AC4 — field cap
  it('rejects more than the field cap', () => {
    const many = Array.from({ length: FIELD_CAP + 1 }, (_, i) => ({ key: `f${i}`, label: `F${i}`, type: 'text' }));
    const r = validateDescriptorProposal(validDescriptor(many));
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.code === 'field-cap'));
  });

  // AC1/AC4 — reserved STRUCTURAL keys
  it('rejects a field key shadowing a structural system column', () => {
    for (const key of ['id', 'status', 'board_id', 'search_blob']) {
      const r = validateDescriptorProposal(validDescriptor([{ key, label: key, type: 'text' }]));
      assert.equal(r.ok, false, `${key} must be reserved`);
      assert.ok(r.errors.some((e) => e.code === 'reserved-system-key'));
    }
  });

  // DEVIATION from AC1 wording: per the Story 1.2 contract, title/notes/favorite ARE
  // system columns (not descriptor fields) → reserved. (favorite_reason is a field.)
  it('rejects title/notes/favorite as field keys (they are system columns, 1.2 contract)', () => {
    for (const key of ['title', 'notes', 'favorite']) {
      const r = validateDescriptorProposal(validDescriptor([{ key, label: key, type: 'text' }]));
      assert.equal(r.ok, false, `${key} is a system column → reserved`);
      assert.ok(r.errors.some((e) => e.code === 'reserved-system-key'));
    }
  });

  // AC1/AC4 — duplicate keys
  it('rejects duplicate field keys', () => {
    const r = validateDescriptorProposal(validDescriptor([
      { key: 'dup', label: 'A', type: 'text' },
      { key: 'dup', label: 'B', type: 'text' },
    ]));
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.code === 'duplicate-key'));
  });

  // AC4 — structurally-wrong object (NOT raw malformed JSON)
  it('rejects a structurally-wrong object (fields not an array)', () => {
    assert.equal(validateDescriptorProposal({ fields: 'nope', enrichment_prompt: 'x', view: 'grid', ingest_mode: 'url-readable' }).ok, false);
    assert.equal(validateDescriptorProposal({}).ok, false);
    assert.equal(validateDescriptorProposal(null).ok, false);
  });

  // AC10.3 seam — existingKeys
  it('rejects a key already on the board (existingKeys seam for 10.3)', () => {
    const r = validateDescriptorProposal(validDescriptor([{ key: 'region', label: 'Region', type: 'text' }]), { existingKeys: ['region'] });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.code === 'already-exists-on-board'));
  });

  // AC5 seed-round-trip — favorite_reason passes; the REAL seeded descriptors validate
  it('accepts favorite_reason + the real seeded descriptors (seed round-trip)', () => {
    assert.equal(validateDescriptorProposal(validDescriptor([{ key: 'favorite_reason', label: 'Why', type: 'text', enrichable: false }])).ok, true);
    assert.equal(validateDescriptorProposal(INSPIRATION_DESCRIPTOR).ok, true, 'seeded Inspiration descriptor validates');
    assert.equal(validateDescriptorProposal(LIBRARY_DESCRIPTOR).ok, true, 'seeded Library descriptor validates');
  });
});

describe('composer guardrails — validateAndRepair (Story 10.2)', () => {
  const good = validDescriptor();
  const bad = validDescriptor([{ key: 'id', label: 'Id', type: 'text' }]); // reserved

  // AC2/AC5 — first valid → no repair (one call)
  it('valid first proposal → ok, proposes once', async () => {
    let calls = 0;
    const out = await validateAndRepair(async () => { calls++; return { name: 'B', descriptor: good }; });
    assert.equal(out.ok, true);
    assert.equal(calls, 1, 'no repair when first is valid');
  });

  // AC2/AC5 — invalid then valid → exactly one repair (two calls)
  it('invalid then valid → repaired, proposes exactly twice', async () => {
    let calls = 0;
    const out = await validateAndRepair(async (errors?: ProposalError[]) => {
      calls++;
      return calls === 1 ? { name: 'B', descriptor: bad } : { name: 'B', descriptor: good };
    });
    assert.equal(out.ok, true);
    assert.equal(calls, 2, 'initial + exactly one repair');
    assert.ok(out.descriptor);
  });

  // AC2/AC3/AC5 — invalid twice → editable draft, NOT a 3rd call, nothing persisted
  it('invalid after repair → editable draft, bounded at two calls, no write', async () => {
    let calls = 0;
    const out = await validateAndRepair(async () => { calls++; return { name: 'B', descriptor: bad }; });
    assert.equal(out.ok, false, 'terminal failure');
    assert.equal(calls, 2, 'bounded: initial + one repair, NOT a third call');
    assert.ok(out.draft, 'surfaced as an editable draft');
    assert.ok(out.errors && out.errors.length > 0, 'errors returned for the user to fix');
    // validateAndRepair itself persists nothing (it has no DB handle) — non-destructive by construction.
  });
});
