// Story 7.2 — the generic field renderer: a field-type → component map over the
// CLOSED set, so ANY descriptor's fields render with NO per-board frontend code
// (FR-3/AD9). PURE functions returning HTML markup STRINGS (no DOM) — headless
// unit-testable AND browser-importable (plain .js, like collections-ui.js; the
// project has no build step). The frontend's only job is `el.innerHTML = ...`.
// `image`/assets render separately (a screenshot is an asset row, not a field).

/** Escape HTML text content — field values (enriched/captured) are UNTRUSTED. */
function escHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const renderText = (_f, v) => `<p class="field-text">${escHtml(v)}</p>`;

/** The closed-set render map: field type → markup. Unknown types use the text fallback. */
export const renderMap = {
  text: renderText,
  number: (_f, v) => `<span class="field-number">${escHtml(v)}</span>`,
  date: (_f, v) => `<time class="field-date">${escHtml(v)}</time>`,
  url: (_f, v) =>
    `<a class="field-url" href="${escHtml(v)}" target="_blank" rel="noopener noreferrer">${escHtml(v)}</a>`,
  enum: (_f, v) => `<span class="field-badge badge">${escHtml(v)}</span>`,
  tags: (_f, v) => {
    const arr = Array.isArray(v) ? v : [v];
    return arr.map((t) => `<span class="field-tag chip">${escHtml(t)}</span>`).join("");
  },
  image: (_f, v) => `<img class="field-image" src="${escHtml(v)}" alt="" loading="lazy">`,
};

/** Render one field's value to markup, degrading unknown types to a quiet text fallback. */
export function renderField(field, value) {
  const fn = renderMap[field.type] ?? renderText;
  return fn(field, value);
}

function hasValue(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/**
 * Render an item's descriptor fields IN DESCRIPTOR ORDER, including only fields that
 * have a value. Returns `{ key, label, html }[]` (the iteration logic lives in this
 * pure layer so it's tested, not buried in DOM glue). v1: the card shows all
 * descriptor fields (no display-location hint in the closed shape — story AC3).
 */
export function renderFields(descriptor, item) {
  const fields = (item && item.fields) || {};
  const out = [];
  for (const field of descriptor.fields) {
    const value = fields[field.key];
    if (!hasValue(value)) continue;
    out.push({ key: field.key, label: field.label, html: renderField(field, value) });
  }
  return out;
}

/** Render an asset (screenshot/image) — separate from descriptor fields (AC3). */
export function renderAsset(asset) {
  const src = asset.path.startsWith("/") ? escHtml(asset.path) : `/${escHtml(asset.path)}`;
  return `<img class="item-asset" src="${src}" alt="${escHtml(asset.kind)}" loading="lazy">`;
}
