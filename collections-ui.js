// Pure collection-UI helpers. No DOM, no window references — importable by node:test.
import { escHtml } from "./descriptor/render-map.js";

export function resolveActiveCollection(storedId, collections) {
  if (!storedId) return "inspiration";
  const found = collections.find((c) => c.id === storedId);
  return found ? found.id : "inspiration";
}

export const itemsUrl = (cid) => `/api/collections/${cid}/items`;
export const itemUrl = (cid, id) => `/api/collections/${cid}/items/${id}`;
export const addUrl = (cid) => `/api/collections/${cid}/items`;
export const refetchUrl = (cid, id) => `/api/collections/${cid}/items/${id}/refetch`;
export const screenshotUrl = (cid, id) => `/api/collections/${cid}/items/${id}/screenshot`;
// Story 3.2: client seam for the generic skill route (no UI behavior change yet).
export const skillsUrl = (name) => `/skills/${name}`;
// Story 5.3: live status stream (optionally scoped to a board). Poll fallback = itemsUrl.
export const eventsUrl = (cid) => (cid ? `/events?boardId=${encodeURIComponent(cid)}` : "/events");

// Story 8.1: layout is descriptor-driven — view comes from descriptor.view, not a
// per-board branch (FR-13/FR-3). Falls back to grid for a missing/odd descriptor.
export function selectView(descriptor) {
  return descriptor && descriptor.view === "list" ? "list" : "grid";
}

// Read a field value from an item by descriptor key, bridging BOTH data shapes:
// the SQLite item model (flat `item.fields[key]`, dotted keys) and the prototype
// flat-JSON item (nested, e.g. key "meta.audience" → item.meta.audience; or a
// top-level "summary"/"favorite_reason"). Returns undefined if absent.
function getFieldValue(item, key) {
  if (item && item.fields && Object.prototype.hasOwnProperty.call(item.fields, key)) {
    return item.fields[key];
  }
  // dotted-path lookup into the (possibly nested) item
  let cur = item;
  for (const part of key.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[part];
  }
  return cur;
}

function hasValue(v) {
  if (v === undefined || v === null) return false;
  if (typeof v === "string") return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

// Story 8.1: pure field iteration for the generic detail modal — descriptor order,
// present values only, each resolved via the shape bridge. Returns `{ field, value }[]`
// for the renderer (Story 7.2 render-map) to turn into markup.
export function itemFieldEntries(item, descriptor) {
  if (!descriptor || !Array.isArray(descriptor.fields)) return [];
  const out = [];
  for (const field of descriptor.fields) {
    const value = getFieldValue(item, field.key);
    if (!hasValue(value)) continue;
    out.push({ field, value });
  }
  return out;
}

// Story 8.2: filters are DESCRIPTOR-DRIVEN — derived from the board's enum/tags
// fields (FR-14/FR-3), so a composed board filters with no code. Returns
// `[{ key, label, type }]` for each filterable field. NOTE: free-text `q` is NOT a
// filter here — full-text search is Story 9.1 (server FTS5); don't reintroduce a
// second client text search.
export function buildFilters(descriptor) {
  if (!descriptor || !Array.isArray(descriptor.fields)) return [];
  return descriptor.fields
    .filter((f) => f.type === "enum" || f.type === "tags")
    .map((f) => ({ key: f.key, label: f.label, type: f.type, values: f.values || null }));
}

// Pure filter predicate: an item matches when, for EVERY active filter, its value
// for that field (resolved via the shape bridge) matches — enum: equality; tags:
// array-includes. An empty filter set passes all. (AND across filters.)
export function matchesFilters(item, activeFilters, descriptor) {
  if (!activeFilters) return true;
  const byKey = new Map((descriptor && descriptor.fields ? descriptor.fields : []).map((f) => [f.key, f]));
  for (const [key, sel] of Object.entries(activeFilters)) {
    if (sel == null || sel === "") continue; // inactive filter
    const field = byKey.get(key);
    if (!field) continue;
    const value = getFieldValue(item, key);
    if (field.type === "tags") {
      if (!Array.isArray(value) || !value.includes(sel)) return false;
    } else if (value !== sel) {
      return false;
    }
  }
  return true;
}

// Story 8.4: pure card-update for optimistic save. Given the card the user already
// owns and an SSE `status` event (Story 5.3), compute the card's NEXT state — fields
// filled on `done` (from the event payload, no refetch), errorReason on `error`. The
// caller mutates the SAME card node in place (never re-keys/re-sorts — UJ-1). Returns
// the card unchanged if the event isn't for this card (id mismatch).
export function applySseEvent(card, event) {
  if (!card || !event || card.id !== event.itemId) return card;
  const next = { ...card, status: event.status };
  if (event.fields && typeof event.fields === "object") {
    next.fields = { ...(card.fields || {}), ...event.fields };
  }
  if (event.error_reason !== undefined) next.errorReason = event.error_reason;
  return next;
}

// Story 8.5: the dignified degraded/disabled/error state for an item's enriched
// section (UJ-2/FR-9 — never raw error text, disabled ≠ failed). Pure: (item,
// descriptor, {providerConfigured}) → markup string for the enriched-section state
// (empty string when enriched fields exist and should just render normally).
//
// The set of user-safe error reasons Story 5.2 (cleanErrorReason) can produce. Any
// OTHER error_reason value (raw/stack/sentinel) is NOT shown — it falls back to a
// generic message, so internals can never leak to the card (the UJ-2 guarantee).
const SAFE_ERROR_REASONS = new Set([
  "could not reach the AI provider",
  "AI returned invalid output",
  "timed out",
  "processing failed",
  "interrupted", // reconcileInterruptedItems (boot sweep of stuck `processing`)
]);

export function renderEnrichmentState(item, descriptor, opts = {}) {
  if (!item) return "";
  const providerConfigured = !!opts.providerConfigured;

  if (item.status === "error") {
    const raw = item.errorReason ?? item.error_reason ?? "";
    const safe = SAFE_ERROR_REASONS.has(raw) ? raw : "Couldn't analyze this item";
    return (
      `<div class="enrich-state enrich-error">` +
      `<span class="enrich-reason">${escHtml(safe)}</span>` +
      `<button class="retry-analysis" data-id="${escHtml(item.id ?? "")}">Retry analysis</button>` +
      `</div>`
    );
  }
  // Only `done` gets a degraded placeholder; pending/processing show the live shimmer.
  if (item.status && item.status !== "done") return "";

  const enrichableKeys = (descriptor && descriptor.fields ? descriptor.fields : [])
    .filter((f) => f.enrichable)
    .map((f) => f.key);
  const hasEnriched = enrichableKeys.some((k) => hasValue(getFieldValue(item, k)));
  if (hasEnriched) return ""; // real analysis present → render fields, no placeholder

  // Empty enriched fields: disabled (no provider) vs neutral (provider on, returned
  // empty). Drive off the PROVIDER signal, not emptiness — an enabled box can return empty.
  return providerConfigured
    ? `<div class="enrich-state enrich-empty">No analysis</div>`
    : `<div class="enrich-state enrich-disabled">Enrichment disabled</div>`;
}

export function collectionChrome(collection) {
  const isInspiration = collection.type === "inspiration";
  const isGrid = collection.view === "grid";
  return {
    facets: isInspiration,
    tiers: isInspiration,
    tagCloud: isInspiration,
    viewToggle: true,
    screenshot: isGrid,
    refetch: true,
  };
}

// --- Library view helpers ---

export function libraryHaystack(item) {
  return [
    item.title,
    item.summary,
    ...(item.topics || []),
    item.author,
  ].filter(Boolean).join(" ").toLowerCase();
}

export function matchesLibraryFilters(item, { q = "", topic = "", type = "" } = {}) {
  if (type && item.type !== type) return false;
  if (topic && !(item.topics || []).includes(topic)) return false;
  if (q && !libraryHaystack(item).includes(q.toLowerCase())) return false;
  return true;
}

export function topicCounts(items) {
  const counts = {};
  for (const item of items) {
    for (const t of item.topics || []) {
      counts[t] = (counts[t] || 0) + 1;
    }
  }
  return counts;
}
