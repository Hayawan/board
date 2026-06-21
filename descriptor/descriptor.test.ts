import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateDescriptor,
  enrichableTargets,
  FIELD_TYPES,
  SYSTEM_COLUMNS,
  type BoardDescriptor,
} from './types.js';

// Story 1.2 — descriptor schema over the closed field-type set. Pure unit tests,
// no DB.

const validDescriptor: BoardDescriptor = {
  fields: [
    { key: 'summary', label: 'Summary', type: 'text', enrichable: true },
    { key: 'topics', label: 'Topics', type: 'tags', enrichable: true },
    { key: 'type', label: 'Type', type: 'enum', values: ['article', 'video'], enrichable: true },
    { key: 'rating', label: 'Rating', type: 'number' },
  ],
  enrichment_prompt: 'Catalog the resource.',
  view: 'list',
  ingest_mode: 'url-readable',
};

describe('descriptor schema (Story 1.2)', () => {
  // AC 1
  it('accepts a valid descriptor over the closed field-type set', () => {
    const d = validateDescriptor(validDescriptor);
    assert.equal(d.fields.length, 4);
    assert.equal(d.view, 'list');
    assert.equal(d.ingest_mode, 'url-readable');
  });

  // Per-field description (AI hint + visible help) — additive, optional.
  it('accepts an optional per-field description and preserves it', () => {
    const d = validateDescriptor({
      ...validDescriptor,
      fields: [{ key: 'rating', label: 'Rating', type: 'number', enrichable: true, description: 'BGG-style 1-10 score' }],
    });
    assert.equal(d.fields[0].description, 'BGG-style 1-10 score');
  });

  it('still accepts a field with no description', () => {
    const d = validateDescriptor(validDescriptor);
    assert.equal(d.fields[3].description, undefined);
  });

  it('exposes exactly the closed field-type set', () => {
    assert.deepEqual(
      [...FIELD_TYPES].sort(),
      ['date', 'enum', 'image', 'number', 'tags', 'text', 'url'],
    );
  });

  // AC 2 — out-of-set type rejected with a clear, field-identifying message
  it('rejects an out-of-set field type with a field-identifying error', () => {
    const bad = {
      ...validDescriptor,
      fields: [{ key: 'when', label: 'When', type: 'datetime' }],
    };
    assert.throws(
      () => validateDescriptor(bad),
      (err: Error) => {
        assert.match(err.message, /when/); // identifies the offending field
        assert.match(err.message, /datetime|type/i);
        return true;
      },
    );
  });

  it('rejects type "object" / "any" escape hatches', () => {
    for (const t of ['object', 'any', 'boolean']) {
      assert.throws(() =>
        validateDescriptor({ ...validDescriptor, fields: [{ key: 'x', label: 'X', type: t }] }),
      );
    }
  });

  // AC 1 — enum carries its allowed values
  it('requires enum fields to declare non-empty values', () => {
    assert.throws(
      () => validateDescriptor({ ...validDescriptor, fields: [{ key: 'k', label: 'K', type: 'enum' }] }),
      /enum|values/i,
    );
    assert.throws(() =>
      validateDescriptor({ ...validDescriptor, fields: [{ key: 'k', label: 'K', type: 'enum', values: [] }] }),
    );
  });

  // Point-4 consensus — opaque dotted keys, max one dot, lowercase grammar
  it('accepts a single-dot grouped key but rejects bad key grammar', () => {
    assert.doesNotThrow(() =>
      validateDescriptor({ ...validDescriptor, fields: [{ key: 'meta.audience', label: 'A', type: 'text' }] }),
    );
    for (const k of ['meta.sub.audience', 'Meta.Audience', 'has space', 'trailing.']) {
      assert.throws(
        () => validateDescriptor({ ...validDescriptor, fields: [{ key: k, label: 'X', type: 'text' }] }),
        new RegExp('key'),
      );
    }
  });

  // Point-3 consensus — system columns are reserved; enrichableTargets is the source of truth
  it('exposes SYSTEM_COLUMNS including favorite/notes/title', () => {
    for (const c of ['favorite', 'notes', 'title', 'status', 'created_at']) {
      assert.ok(SYSTEM_COLUMNS.has(c), `SYSTEM_COLUMNS missing ${c}`);
    }
  });

  it('enrichableTargets returns only enrichable:true field keys', () => {
    const targets = enrichableTargets(validateDescriptor(validDescriptor));
    assert.deepEqual(targets.sort(), ['summary', 'topics', 'type']); // rating has no enrichable flag
  });
});
