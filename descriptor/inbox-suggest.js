// Story 14.3 — the Inbox assign control: a one-tap suggested-board CHIP when the AI is
// available and has a valid suggestion, otherwise a dignified manual board PICKER. PURE
// functions returning HTML markup STRINGS (no DOM) — headless-testable and browser-
// importable (plain .js, no build step), like render-map.js. The DOM glue reads the
// data-attributes and calls the 14.2 assign endpoint (POST /api/v1/items/assign).

import { escHtml } from "./render-map.js";

/**
 * Decide the control mode. A chip requires BOTH a configured provider (the dignified-
 * degradation signal, not field-emptiness) AND a suggestion that names a known board.
 * Otherwise: a manual picker (never an error, never a hidden item).
 */
export function assignControlMode({ providerConfigured, suggestedBoardId, boards }) {
  const known = !!suggestedBoardId && (boards ?? []).some((b) => b.id === suggestedBoardId);
  return providerConfigured && known ? "chip" : "picker";
}

/**
 * Render the Inbox header count (AC5 — no guilt-pile: the bucket is never silent or
 * infinite; a clear count is always shown, even at zero). Pure markup string.
 */
export function renderInboxCount(count) {
  const n = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
  const label = n === 0 ? "Inbox empty" : `${n} item${n === 1 ? "" : "s"} to triage`;
  return `<div class="inbox-count" data-inbox-count="${n}">${escHtml(label)}</div>`;
}

/** A <select> of target boards that calls 14.2 on change (carries the item id). */
function picker(itemId, boards) {
  const options = (boards ?? [])
    .map((b) => `<option value="${escHtml(b.id)}">${escHtml(b.name)}</option>`)
    .join("");
  return (
    `<select class="assign-picker" data-assign-item="${escHtml(itemId)}" aria-label="Assign to board">` +
    `<option value="">Move to…</option>${options}</select>`
  );
}

/**
 * Render the assign control for one Inbox row.
 * - chip mode: a one-tap button carrying the suggested board (data-assign-board) +
 *   a change-picker for the override path.
 * - picker mode: just the manual picker.
 * Always renders a reachable target (no guilt-pile dead-end).
 */
export function renderAssignControl({ itemId, suggestedBoardId, boards, providerConfigured }) {
  const mode = assignControlMode({ providerConfigured, suggestedBoardId, boards });
  if (mode === "chip") {
    const board = boards.find((b) => b.id === suggestedBoardId);
    return (
      `<div class="assign-control assign-control--chip">` +
      `<button type="button" class="assign-chip" ` +
      `data-assign-item="${escHtml(itemId)}" data-assign-board="${escHtml(board.id)}">` +
      `Move to ${escHtml(board.name)}</button>` +
      `<span class="assign-change">${picker(itemId, boards)}</span>` +
      `</div>`
    );
  }
  return `<div class="assign-control assign-control--picker">${picker(itemId, boards)}</div>`;
}
