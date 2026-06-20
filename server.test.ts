import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildServer } from "./server.js";
import { BOOKMARKS_FILE, getCollection, loadCollection, saveCollection } from "./storage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LIBRARY_FILE = path.join(__dirname, getCollection("library").dataFile);

const LIBRARY_ITEM = {
  id: "test-lib-001",
  url: "https://example.com/article",
  added: "2025-01-01",
  title: "Test Article",
  summary: "A test summary.",
  topics: ["testing", "server"],
  author: "Tester",
  type: "article",
  key_points: ["Point one", "Point two"],
  notes: "",
  analysis_agent: "claude",
  analysis_model: null,
};

// --- GET /api/collections ---

test("GET /api/collections returns all collections including library", async () => {
  const app = await buildServer();
  const res = await app.inject({ method: "GET", url: "/api/collections" });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body) as any[];
  assert.ok(Array.isArray(body), "should return an array");
  assert.ok(body.some((c) => c.id === "inspiration"), "should include inspiration");
  assert.ok(body.some((c) => c.id === "library"), "should include library");
  assert.ok(body.every((c) => c.id && c.name && c.type && c.view), "each entry should have id/name/type/view");
});

// --- Alias parity ---

test("GET /api/collections/inspiration/items equals GET /api/bookmarks", async () => {
  const app = await buildServer();
  const bookmarks = await app.inject({ method: "GET", url: "/api/bookmarks" });
  const items = await app.inject({ method: "GET", url: "/api/collections/inspiration/items" });
  assert.equal(bookmarks.statusCode, 200);
  assert.equal(items.statusCode, 200);
  assert.deepEqual(JSON.parse(items.body), JSON.parse(bookmarks.body));
});

// --- Library GET / PATCH / DELETE round trip ---

test("GET /api/collections/library/items returns seeded library items", async () => {
  const libSnapshot = fs.readFileSync(LIBRARY_FILE, "utf-8");
  try {
    saveCollection("library", [LIBRARY_ITEM]);
    const app = await buildServer();
    const res = await app.inject({ method: "GET", url: "/api/collections/library/items" });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body) as any[];
    assert.equal(body.length, 1);
    assert.equal(body[0].id, LIBRARY_ITEM.id);
    assert.equal(body[0].title, LIBRARY_ITEM.title);
  } finally {
    fs.writeFileSync(LIBRARY_FILE, libSnapshot);
  }
});

test("PATCH /api/collections/library/items/:id updates notes field", async () => {
  const libSnapshot = fs.readFileSync(LIBRARY_FILE, "utf-8");
  try {
    saveCollection("library", [LIBRARY_ITEM]);
    const app = await buildServer();
    const res = await app.inject({
      method: "PATCH",
      url: `/api/collections/library/items/${LIBRARY_ITEM.id}`,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes: "my research notes" }),
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body) as any;
    assert.equal(body.notes, "my research notes");
    // Verify persisted
    const stored = loadCollection<any>("library");
    assert.equal(stored[0].notes, "my research notes");
  } finally {
    fs.writeFileSync(LIBRARY_FILE, libSnapshot);
  }
});

test("DELETE /api/collections/library/items/:id removes the item (204)", async () => {
  const libSnapshot = fs.readFileSync(LIBRARY_FILE, "utf-8");
  try {
    saveCollection("library", [LIBRARY_ITEM]);
    const app = await buildServer();
    const res = await app.inject({ method: "DELETE", url: `/api/collections/library/items/${LIBRARY_ITEM.id}` });
    assert.equal(res.statusCode, 204);
    const stored = loadCollection<any>("library");
    assert.equal(stored.length, 0);
  } finally {
    fs.writeFileSync(LIBRARY_FILE, libSnapshot);
  }
});

// --- Unknown cid ---

test("GET /api/collections/no-such-cid/items returns 4xx", async () => {
  const app = await buildServer();
  const res = await app.inject({ method: "GET", url: "/api/collections/no-such-cid/items" });
  assert.ok(res.statusCode >= 400, `expected 4xx but got ${res.statusCode}`);
});

test("PATCH /api/collections/no-such-cid/items/x returns 4xx", async () => {
  const app = await buildServer();
  const res = await app.inject({
    method: "PATCH",
    url: "/api/collections/no-such-cid/items/x",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ notes: "x" }),
  });
  assert.ok(res.statusCode >= 400, `expected 4xx but got ${res.statusCode}`);
});

// --- Screenshot guard ---

test("POST /api/collections/library/items/:id/screenshot returns 400 for non-visual collection", async () => {
  const libSnapshot = fs.readFileSync(LIBRARY_FILE, "utf-8");
  try {
    saveCollection("library", [LIBRARY_ITEM]);
    const app = await buildServer();
    const res = await app.inject({
      method: "POST",
      url: `/api/collections/library/items/${LIBRARY_ITEM.id}/screenshot`,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dataUrl: "data:image/png;base64,abc" }),
    });
    assert.equal(res.statusCode, 400);
    const body = JSON.parse(res.body) as any;
    assert.ok(body.error.includes("screenshot"), "error message should mention screenshot");
  } finally {
    fs.writeFileSync(LIBRARY_FILE, libSnapshot);
  }
});

test("POST /api/collections/inspiration/items/:id/screenshot passes visual guard", async () => {
  const bmSnapshot = fs.readFileSync(BOOKMARKS_FILE, "utf-8");
  try {
    const testItem = { id: "bm-shot-test", url: "https://example.com", added: "2025-01-01", screenshot: null, title: "T", meta: {}, design: {}, reflection: {}, analysis_agent: "claude", analysis_model: null };
    saveCollection("inspiration", [testItem]);
    const app = await buildServer();
    const res = await app.inject({
      method: "POST",
      url: `/api/collections/inspiration/items/${testItem.id}/screenshot`,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dataUrl: "data:image/png;base64,iVBORw0KGgo=" }),
    });
    // Should not be 400 (screenshot guard allows visual collection)
    assert.ok(res.statusCode !== 400 || (res.statusCode === 400 && !JSON.parse(res.body).error.includes("not supported")),
      "inspiration screenshot should not be blocked by visual guard");
  } finally {
    fs.writeFileSync(BOOKMARKS_FILE, bmSnapshot);
  }
});

// --- POST validation (no spawn) ---

test("POST /api/collections/inspiration/items returns 400 for missing url", async () => {
  const app = await buildServer();
  const res = await app.inject({
    method: "POST",
    url: "/api/collections/inspiration/items",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(res.statusCode, 400);
});

test("POST /api/collections/inspiration/items returns 400 for invalid analysisAgent", async () => {
  const app = await buildServer();
  const res = await app.inject({
    method: "POST",
    url: "/api/collections/inspiration/items",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "https://example.com", analysisAgent: "gpt" }),
  });
  assert.equal(res.statusCode, 400);
});

test("POST /api/collections/no-such-cid/items returns 4xx for unknown collection", async () => {
  const app = await buildServer();
  const res = await app.inject({
    method: "POST",
    url: "/api/collections/no-such-cid/items",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "https://example.com" }),
  });
  assert.ok(res.statusCode >= 400);
});

// --- Legacy alias: PATCH /api/bookmarks/:id ---

test("PATCH /api/bookmarks/:id (alias) updates favorite field and preserves other fields", async () => {
  const bmSnapshot = fs.readFileSync(BOOKMARKS_FILE, "utf-8");
  try {
    const testItem = { id: "bm-alias-test", url: "https://example.com", added: "2025-01-01", screenshot: null, title: "Test", meta: { audience: "consumer", form: "app", domain: null, tags: [], tier: "reference", tone: [] }, design: { steal_this: "x", above_fold: "x", nav_pattern: "x", whitespace: "x", color_story: "x", design_system_score: "bespoke" }, reflection: { five_second_message: "x", apply_to_naruki: "keep me" }, favorite: false, analysis_agent: "claude", analysis_model: null };
    saveCollection("inspiration", [testItem]);
    const app = await buildServer();
    const res = await app.inject({
      method: "PATCH",
      url: `/api/bookmarks/${testItem.id}`,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ favorite: true }),
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body) as any;
    assert.equal(body.favorite, true);
    assert.equal(body.reflection.apply_to_naruki, "keep me", "other fields must not be clobbered");
  } finally {
    fs.writeFileSync(BOOKMARKS_FILE, bmSnapshot);
  }
});

// --- Legacy POST /api/add validation ---

test("POST /api/add returns 400 for missing url", async () => {
  const app = await buildServer();
  const res = await app.inject({
    method: "POST",
    url: "/api/add",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(res.statusCode, 400);
});

test("POST /api/add returns 400 for invalid analysisAgent", async () => {
  const app = await buildServer();
  const res = await app.inject({
    method: "POST",
    url: "/api/add",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "https://example.com", analysisAgent: "gpt" }),
  });
  assert.equal(res.statusCode, 400);
});
