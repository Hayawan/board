import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { renderField, renderFields, renderAsset, isSafeUrl } from './render-map.js';
import type { BoardDescriptor, Field } from './types.js';

const f = (key: string, type: Field['type'], extra: Partial<Field> = {}): Field => ({
  key,
  label: key,
  type,
  ...extra,
});

describe('render-map (Story 7.2)', () => {
  // AC 1 — each closed type renders to an HTML markup STRING
  it('renders each closed field type to markup', () => {
    assert.match(renderField(f('t', 'text'), 'hello'), /hello/);
    assert.match(renderField(f('n', 'number'), 42), /42/);
    assert.match(renderField(f('u', 'url'), 'https://x.example'), /<a /);
    assert.match(renderField(f('u', 'url'), 'https://x.example'), /href="https:\/\/x\.example"/);
    assert.match(renderField(f('e', 'enum', { values: ['a'] }), 'a'), /badge/);
    const tags = renderField(f('tg', 'tags'), ['ai', 'rag']);
    assert.match(tags, /chip/);
    assert.match(tags, /ai/);
    assert.match(tags, /rag/);
    assert.match(renderField(f('d', 'date'), '2025-01-01'), /2025-01-01/);
  });

  // AC 2 — unknown type degrades to a quiet text fallback (no throw)
  it('falls back to text for an unknown field type', () => {
    const out = renderField({ key: 'x', label: 'x', type: 'datetime' as Field['type'] }, 'value');
    assert.match(out, /value/);
  });

  // SECURITY — values are HTML-escaped (enriched/captured content is untrusted)
  it('escapes HTML in field values', () => {
    const out = renderField(f('t', 'text'), '<script>alert(1)</script>');
    assert.doesNotMatch(out, /<script>/);
    assert.match(out, /&lt;script&gt;/);
    const url = renderField(f('u', 'url'), 'https://x"onerror=');
    assert.doesNotMatch(url, /"onerror=/); // attribute-escaped
  });

  // SECURITY — javascript:/data: URL schemes are neutralized (escaping alone doesn't)
  it('does not render an <a href> for an unsafe URL scheme', () => {
    const js = renderField(f('u', 'url'), 'javascript:alert(1)');
    assert.doesNotMatch(js, /href=/, 'javascript: scheme must not become a link');
    assert.match(js, /alert/); // still shown as escaped text
    const data = renderField(f('u', 'url'), 'data:text/html,<script>1</script>');
    assert.doesNotMatch(data, /href=/);
    // safe schemes still link
    assert.match(renderField(f('u', 'url'), 'https://ok.example'), /<a /);
    assert.match(renderField(f('u', 'url'), '/relative/path'), /<a /);
    // unsafe image src is dropped
    assert.equal(renderField(f('i', 'image'), 'javascript:alert(1)'), '');
  });

  // AC 4 — renderFields iterates the descriptor in order, only present values
  it('renders descriptor fields in order, skipping empty values', () => {
    const descriptor: BoardDescriptor = {
      view: 'list',
      ingest_mode: 'url-readable',
      enrichment_prompt: '',
      fields: [
        f('summary', 'text'),
        f('topics', 'tags'),
        f('author', 'text'),
        f('missing', 'text'),
      ],
    };
    const item = { fields: { summary: 'S', topics: ['x'], author: '' } };
    const out = renderFields(descriptor, item);
    assert.deepEqual(out.map((r) => r.key), ['summary', 'topics']); // author empty + missing absent skipped
    assert.match(out[0].html, /S/);
    assert.match(out[1].html, /chip/);
  });

  // isSafeUrl is exported + used by the modal's hand-rolled link (Story 8.1 review)
  it('isSafeUrl allows http(s)/mailto/relative, blocks javascript:/data:', () => {
    assert.equal(isSafeUrl('https://x.example'), true);
    assert.equal(isSafeUrl('http://x'), true);
    assert.equal(isSafeUrl('mailto:a@b.com'), true);
    assert.equal(isSafeUrl('/relative'), true);
    assert.equal(isSafeUrl('javascript:alert(1)'), false);
    assert.equal(isSafeUrl('data:text/html,x'), false);
  });

  // AC 3 — assets render separately from descriptor fields
  it('renders an asset (screenshot) as an image element', () => {
    const html = renderAsset({ kind: 'screenshot', path: 'screenshots/x.png' });
    assert.match(html, /<img /);
    assert.match(html, /src="\/screenshots\/x\.png"/);
  });
});
