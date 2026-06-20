import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveActiveCollection,
  itemsUrl,
  itemUrl,
  addUrl,
  refetchUrl,
  screenshotUrl,
  collectionChrome,
  libraryHaystack,
  matchesLibraryFilters,
  topicCounts,
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
