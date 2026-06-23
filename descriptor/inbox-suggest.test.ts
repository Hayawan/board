import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { assignControlMode, renderAssignControl, renderInboxCount } from './inbox-suggest.js';

// Story 14.3 — the pure chip/picker renderer + mode resolver (markup strings, no DOM).

const BOARDS = [
  { id: 'inspiration', name: 'Inspiration' },
  { id: 'library', name: 'Library' },
];

describe('Story 14.3 — assignControlMode (AC2/AC3)', () => {
  it('is a chip only when a provider is configured AND a valid suggestion exists', () => {
    assert.equal(assignControlMode({ providerConfigured: true, suggestedBoardId: 'library', boards: BOARDS }), 'chip');
  });
  it('degrades to a picker when no provider is configured (keys off the provider signal)', () => {
    assert.equal(assignControlMode({ providerConfigured: false, suggestedBoardId: 'library', boards: BOARDS }), 'picker');
  });
  it('degrades to a picker when the suggestion is null or not a known board', () => {
    assert.equal(assignControlMode({ providerConfigured: true, suggestedBoardId: null, boards: BOARDS }), 'picker');
    assert.equal(assignControlMode({ providerConfigured: true, suggestedBoardId: 'ghost', boards: BOARDS }), 'picker');
  });
});

describe('Story 14.3 — renderAssignControl (AC1/AC2/AC3/AC5)', () => {
  it('renders a one-tap chip carrying the suggested board + a change-picker', () => {
    const html = renderAssignControl({ itemId: 'i1', suggestedBoardId: 'library', boards: BOARDS, providerConfigured: true });
    assert.match(html, /data-assign-item="i1"/);
    assert.match(html, /data-assign-board="library"/, 'chip carries the suggested board for the one-tap assign');
    assert.match(html, /Library/, 'names the suggested board');
    // a change-picker is still reachable (override path)
    assert.match(html, /<select/);
  });

  it('renders a manual board picker (no chip) when degraded', () => {
    const html = renderAssignControl({ itemId: 'i2', suggestedBoardId: null, boards: BOARDS, providerConfigured: false });
    assert.doesNotMatch(html, /data-assign-board="/, 'no auto-suggest chip when degraded');
    assert.match(html, /<select[^>]*data-assign-item="i2"/);
    assert.match(html, /Inspiration/);
    assert.match(html, /Library/);
  });

  it('escapes board names (untrusted) — no XSS', () => {
    const html = renderAssignControl({
      itemId: 'i3', suggestedBoardId: 'x', providerConfigured: true,
      boards: [{ id: 'x', name: '<img src=x onerror=alert(1)>' }],
    });
    assert.doesNotMatch(html, /<img src=x onerror=alert\(1\)>/, 'board name must be HTML-escaped');
  });

  it('never renders an empty/dead control — a target is always reachable', () => {
    const html = renderAssignControl({ itemId: 'i4', suggestedBoardId: null, boards: BOARDS, providerConfigured: true });
    assert.match(html, /<select/, 'a manual picker is always present (no guilt-pile dead-end)');
  });
});

describe('Story 14.3 — renderInboxCount (AC5, no guilt-pile)', () => {
  it('always shows a clear count (incl. zero), never a silent/infinite bucket', () => {
    assert.match(renderInboxCount(0), /Inbox empty/);
    assert.match(renderInboxCount(1), /1 item to triage/);
    assert.match(renderInboxCount(7), /7 items to triage/);
    assert.match(renderInboxCount(3), /data-inbox-count="3"/);
    // garbage → 0, never NaN/undefined
    assert.match(renderInboxCount(NaN), /data-inbox-count="0"/);
  });
});
