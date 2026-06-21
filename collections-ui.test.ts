import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveActiveCollection,
  itemsUrl,
  itemUrl,
  addUrl,
  refetchUrl,
  screenshotUrl,
  skillsUrl,
  eventsUrl,
  collectionChrome,
  libraryHaystack,
  matchesLibraryFilters,
  topicCounts,
  selectView,
  itemFieldEntries,
  buildFilters,
  matchesFilters,
  applySseEvent,
  renderEnrichmentState,
} from "./collections-ui.js";

const COLLECTIONS = [
  { id: "inspiration", name: "Inspiration", type: "inspiration", view: "grid", dataFile: "bookmarks.json" },
  { id: "library", name: "Library", type: "library", view: "list", dataFile: "library.json" },
];

// --- resolveActiveCollection ---

test("resolveActiveCollection returns stored valid id", () => {
  assert.equal(resolveActiveCollection("library", COLLECTIONS), "library");
  assert.equal(resolveActiveCollection("inspiration", COLLECTIONS), "inspiration");
});

test("resolveActiveCollection falls back to inspiration when stored id is null/undefined/empty", () => {
  assert.equal(resolveActiveCollection(null, COLLECTIONS), "inspiration");
  assert.equal(resolveActiveCollection(undefined, COLLECTIONS), "inspiration");
  assert.equal(resolveActiveCollection("", COLLECTIONS), "inspiration");
});

test("resolveActiveCollection falls back to inspiration when stored id not in manifest", () => {
  assert.equal(resolveActiveCollection("deleted-collection", COLLECTIONS), "inspiration");
  assert.equal(resolveActiveCollection("old-cid", COLLECTIONS), "inspiration");
});

test("resolveActiveCollection returns inspiration when collections is empty", () => {
  assert.equal(resolveActiveCollection("library", []), "inspiration");
});

// --- URL builders ---

test("itemsUrl builds correct path", () => {
  assert.equal(itemsUrl("inspiration"), "/api/collections/inspiration/items");
  assert.equal(itemsUrl("library"), "/api/collections/library/items");
});

test("skillsUrl builds the generic skill route path", () => {
  assert.equal(skillsUrl("import-bookmarks"), "/skills/import-bookmarks");
});

test("eventsUrl builds the SSE path, optionally board-scoped", () => {
  assert.equal(eventsUrl(), "/events");
  assert.equal(eventsUrl("library"), "/events?boardId=library");
});

test("itemUrl builds correct path", () => {
  assert.equal(itemUrl("inspiration", "bm-001"), "/api/collections/inspiration/items/bm-001");
  assert.equal(itemUrl("library", "lib-abc"), "/api/collections/library/items/lib-abc");
});

test("addUrl builds correct path (same as itemsUrl)", () => {
  assert.equal(addUrl("inspiration"), "/api/collections/inspiration/items");
  assert.equal(addUrl("library"), "/api/collections/library/items");
});

test("refetchUrl builds correct path", () => {
  assert.equal(refetchUrl("inspiration", "bm-001"), "/api/collections/inspiration/items/bm-001/refetch");
  assert.equal(refetchUrl("library", "lib-abc"), "/api/collections/library/items/lib-abc/refetch");
});

test("screenshotUrl builds correct path", () => {
  assert.equal(screenshotUrl("inspiration", "bm-001"), "/api/collections/inspiration/items/bm-001/screenshot");
});

// --- collectionChrome ---

test("collectionChrome returns full chrome for inspiration (grid/inspiration type)", () => {
  const chrome = collectionChrome(COLLECTIONS[0]); // inspiration
  assert.equal(chrome.facets, true, "inspiration should show facet filters");
  assert.equal(chrome.tiers, true, "inspiration should show tier filters");
  assert.equal(chrome.tagCloud, true, "inspiration should show tag cloud");
  assert.equal(chrome.viewToggle, true, "inspiration should show view toggle");
  assert.equal(chrome.screenshot, true, "inspiration (grid) should support screenshots");
});

test("collectionChrome hides inspiration-specific controls for library (list/library type)", () => {
  const chrome = collectionChrome(COLLECTIONS[1]); // library
  assert.equal(chrome.facets, false, "library should hide facet filters");
  assert.equal(chrome.tiers, false, "library should hide tier filters");
  assert.equal(chrome.tagCloud, false, "library should hide tag cloud");
  assert.equal(chrome.screenshot, false, "library (list) should not support screenshots");
});

test("collectionChrome keeps viewToggle true for any collection", () => {
  assert.equal(collectionChrome(COLLECTIONS[0]).viewToggle, true);
  assert.equal(collectionChrome(COLLECTIONS[1]).viewToggle, true);
});

// --- Library view helpers ---

const LIBRARY_ITEM = {
  id: "lib-001",
  url: "https://arxiv.org/abs/2401.00001",
  added: "2025-06-01",
  title: "Attention Mechanisms in Transformers",
  summary: "A survey of attention mechanisms used in modern transformer architectures.",
  topics: ["attention", "transformers", "nlp"],
  author: "Jane Doe",
  type: "paper",
  key_points: ["Self-attention scales quadratically", "Flash attention reduces memory"],
  notes: "",
  analysis_agent: "claude",
  analysis_model: null,
};

test("libraryHaystack returns lowercased string covering title, summary, topics, author", () => {
  const hay = libraryHaystack(LIBRARY_ITEM);
  assert.ok(typeof hay === "string", "should return a string");
  assert.ok(hay.includes("attention mechanisms"), "should include title");
  assert.ok(hay.includes("survey"), "should include summary word");
  assert.ok(hay.includes("transformers"), "should include topic");
  assert.ok(hay.includes("jane doe"), "should include author");
  assert.ok(hay === hay.toLowerCase(), "should be all lowercase");
});

test("libraryHaystack handles missing optional fields gracefully", () => {
  const item = { ...LIBRARY_ITEM, author: null, topics: [] };
  assert.doesNotThrow(() => libraryHaystack(item));
  const hay = libraryHaystack(item);
  assert.ok(hay.includes("attention"), "still includes title");
});

test("matchesLibraryFilters: no filters → all items match", () => {
  assert.ok(matchesLibraryFilters(LIBRARY_ITEM, { q: "", topic: "", type: "" }));
  assert.ok(matchesLibraryFilters(LIBRARY_ITEM, {}));
});

test("matchesLibraryFilters: q matches title/summary/topic/author", () => {
  assert.ok(matchesLibraryFilters(LIBRARY_ITEM, { q: "attention" }));
  assert.ok(matchesLibraryFilters(LIBRARY_ITEM, { q: "survey" }));
  assert.ok(matchesLibraryFilters(LIBRARY_ITEM, { q: "jane" }));
  assert.ok(!matchesLibraryFilters(LIBRARY_ITEM, { q: "completely-unrelated-xyz" }));
});

test("matchesLibraryFilters: topic filter matches exact topic", () => {
  assert.ok(matchesLibraryFilters(LIBRARY_ITEM, { topic: "transformers" }));
  assert.ok(!matchesLibraryFilters(LIBRARY_ITEM, { topic: "vision" }));
});

test("matchesLibraryFilters: type filter matches item type", () => {
  assert.ok(matchesLibraryFilters(LIBRARY_ITEM, { type: "paper" }));
  assert.ok(!matchesLibraryFilters(LIBRARY_ITEM, { type: "article" }));
});

test("matchesLibraryFilters: multiple filters AND together", () => {
  assert.ok(matchesLibraryFilters(LIBRARY_ITEM, { q: "attention", topic: "nlp", type: "paper" }));
  assert.ok(!matchesLibraryFilters(LIBRARY_ITEM, { q: "attention", type: "video" }));
});

test("topicCounts returns frequency map of all topics across items", () => {
  const items = [
    { ...LIBRARY_ITEM, topics: ["ai", "nlp"] },
    { ...LIBRARY_ITEM, id: "lib-002", topics: ["ai", "vision"] },
  ];
  const counts = topicCounts(items);
  assert.equal(counts["ai"], 2);
  assert.equal(counts["nlp"], 1);
  assert.equal(counts["vision"], 1);
  assert.ok(!("transformers" in counts));
});

test("topicCounts returns empty object for empty items array", () => {
  assert.deepEqual(topicCounts([]), {});
});

// --- Story 8.1: descriptor-driven view + generic field iteration ---

test("selectView returns the descriptor's view (grid/list)", () => {
  assert.equal(selectView({ view: "grid" }), "grid");
  assert.equal(selectView({ view: "list" }), "list");
  assert.equal(selectView(undefined), "grid"); // safe fallback
  assert.equal(selectView({ view: "weird" }), "grid");
});

test("itemFieldEntries resolves SQLite-shape (flat fields) values in descriptor order", () => {
  const descriptor = { view: "list", fields: [
    { key: "summary", label: "Summary", type: "text" },
    { key: "topics", label: "Topics", type: "tags" },
    { key: "missing", label: "Missing", type: "text" },
  ] };
  const item = { fields: { summary: "S", topics: ["a"], missing: "" } };
  const entries = itemFieldEntries(item, descriptor);
  assert.deepEqual(entries.map((e) => e.field.key), ["summary", "topics"]); // empty + absent skipped
  assert.equal(entries[0].value, "S");
});

test("itemFieldEntries bridges the flat-JSON nested shape via dotted keys", () => {
  const descriptor = { view: "grid", fields: [
    { key: "meta.audience", label: "Audience", type: "enum" },
    { key: "design.steal_this", label: "Steal", type: "text" },
    { key: "favorite_reason", label: "Why", type: "text" },
  ] };
  const item = { meta: { audience: "b2b" }, design: { steal_this: "x" }, favorite_reason: "good" };
  const entries = itemFieldEntries(item, descriptor);
  assert.deepEqual(entries.map((e) => [e.field.key, e.value]), [
    ["meta.audience", "b2b"],
    ["design.steal_this", "x"],
    ["favorite_reason", "good"],
  ]);
});

// --- Story 8.2: descriptor-driven filters ---

const FILTER_DESCRIPTOR = { view: "list", fields: [
  { key: "type", label: "Type", type: "enum", values: ["article", "video"] },
  { key: "topics", label: "Topics", type: "tags" },
  { key: "summary", label: "Summary", type: "text" },   // not filterable
  { key: "rank", label: "Rank", type: "number" },        // not filterable
] };

test("buildFilters derives filters from enum/tags fields only (synthetic descriptor)", () => {
  const filters = buildFilters(FILTER_DESCRIPTOR);
  assert.deepEqual(filters.map((f) => f.key), ["type", "topics"]); // text/number excluded
  assert.equal(filters.find((f) => f.key === "type").type, "enum");
  assert.deepEqual(filters.find((f) => f.key === "type").values, ["article", "video"]);
  assert.equal(buildFilters(undefined).length, 0);
});

test("matchesFilters: enum equality + tags includes, AND across filters, empty passes all", () => {
  const item = { fields: { type: "article", topics: ["ai", "rag"] } };
  assert.ok(matchesFilters(item, {}, FILTER_DESCRIPTOR), "empty filter passes all");
  assert.ok(matchesFilters(item, { type: "article" }, FILTER_DESCRIPTOR));
  assert.ok(!matchesFilters(item, { type: "video" }, FILTER_DESCRIPTOR), "wrong enum excluded");
  assert.ok(matchesFilters(item, { topics: "rag" }, FILTER_DESCRIPTOR), "tag present");
  assert.ok(!matchesFilters(item, { topics: "vision" }, FILTER_DESCRIPTOR), "tag absent excluded");
  assert.ok(matchesFilters(item, { type: "article", topics: "ai" }, FILTER_DESCRIPTOR), "AND both match");
  assert.ok(!matchesFilters(item, { type: "article", topics: "vision" }, FILTER_DESCRIPTOR), "AND one fails");
});

test("matchesFilters bridges the nested flat-JSON shape", () => {
  const insp = { meta: { audience: "b2b", tags: ["dark-theme"] } };
  const d = { view: "grid", fields: [
    { key: "meta.audience", label: "Audience", type: "enum", values: ["b2b"] },
    { key: "meta.tags", label: "Tags", type: "tags" },
  ] };
  assert.ok(matchesFilters(insp, { "meta.audience": "b2b" }, d));
  assert.ok(matchesFilters(insp, { "meta.tags": "dark-theme" }, d));
  assert.ok(!matchesFilters(insp, { "meta.audience": "consumer" }, d));
});

// --- Story 8.4: optimistic-save card update from SSE events ---

test("applySseEvent fills the card on a done event (fields from payload)", () => {
  const card = { id: "i1", status: "processing", fields: { a: 1 } };
  const next = applySseEvent(card, { itemId: "i1", status: "done", fields: { b: 2 } });
  assert.equal(next.status, "done");
  assert.deepEqual(next.fields, { a: 1, b: 2 }, "fields merged from the SSE payload (no refetch)");
});

test("applySseEvent sets error state on an error event", () => {
  const card = { id: "i1", status: "processing", fields: {} };
  const next = applySseEvent(card, { itemId: "i1", status: "error", error_reason: "timed out" });
  assert.equal(next.status, "error");
  assert.equal(next.errorReason, "timed out");
});

test("applySseEvent ignores an event for a different card (returns same ref)", () => {
  const card = { id: "i1", status: "processing" };
  const next = applySseEvent(card, { itemId: "other", status: "done" });
  assert.equal(next, card, "event for another card must not mutate this one");
});

// --- Story 8.5: dignified degraded / disabled / error state ---

const ENRICH_DESCRIPTOR = { view: "grid", fields: [
  { key: "summary", label: "Summary", type: "text", enrichable: true },
  { key: "notes", label: "Notes", type: "text", enrichable: false },
] };

test("renderEnrichmentState: no provider + done + empty → 'Enrichment disabled'", () => {
  const html = renderEnrichmentState({ id: "i", status: "done", fields: {} }, ENRICH_DESCRIPTOR, { providerConfigured: false });
  assert.match(html, /Enrichment disabled/);
  assert.doesNotMatch(html, /No analysis/);
});

test("renderEnrichmentState: provider ON + done + empty → neutral 'No analysis' (NOT disabled)", () => {
  const html = renderEnrichmentState({ id: "i", status: "done", fields: {} }, ENRICH_DESCRIPTOR, { providerConfigured: true });
  assert.match(html, /No analysis/);
  assert.doesNotMatch(html, /disabled/i);
});

test("renderEnrichmentState: error with an UNSAFE reason → Retry present, sentinel ABSENT", () => {
  const html = renderEnrichmentState({ id: "i", status: "error", errorReason: "SENTINEL_STACK_xyz" }, ENRICH_DESCRIPTOR, { providerConfigured: true });
  assert.match(html, /Retry analysis/);
  assert.doesNotMatch(html, /SENTINEL_STACK_xyz/, "raw/unsafe reason must never appear in markup");
});

test("renderEnrichmentState: error with a SAFE reason → the safe reason is shown", () => {
  const html = renderEnrichmentState({ id: "i", status: "error", errorReason: "timed out" }, ENRICH_DESCRIPTOR, { providerConfigured: true });
  assert.match(html, /timed out/);
  assert.match(html, /Retry analysis/);
});

test("renderEnrichmentState: populated done → no placeholder (empty string)", () => {
  const html = renderEnrichmentState({ id: "i", status: "done", fields: { summary: "real analysis" } }, ENRICH_DESCRIPTOR, { providerConfigured: false });
  assert.equal(html, "");
});

test("renderEnrichmentState: 'interrupted' (boot-reconcile reason) is shown, not genericized", () => {
  const html = renderEnrichmentState({ id: "i", status: "error", errorReason: "interrupted" }, ENRICH_DESCRIPTOR, { providerConfigured: true });
  assert.match(html, /interrupted/);
  assert.doesNotMatch(html, /Couldn't analyze/);
});
