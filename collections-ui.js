// Pure collection-UI helpers. No DOM, no window references — importable by node:test.

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
