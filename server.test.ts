import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildServer, getListenOptions, warnIfExposed } from "./server.js";
import { loadConfig } from "./config.js";
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
  // Story 2.2 (AC 5): inject a temp screenshotsDir so the write never pollutes the
  // real DATA_DIR / app tree.
  const shotDir = fs.mkdtempSync(path.join(os.tmpdir(), "board-oss-shot-"));
  try {
    const testItem = { id: "bm-shot-test", url: "https://example.com", added: "2025-01-01", screenshot: null, title: "T", meta: {}, design: {}, reflection: {}, analysis_agent: "claude", analysis_model: null };
    saveCollection("inspiration", [testItem]);
    const app = await buildServer({ screenshotsDir: shotDir });
    const res = await app.inject({
      method: "POST",
      url: `/api/collections/inspiration/items/${testItem.id}/screenshot`,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dataUrl: "data:image/png;base64,iVBORw0KGgo=" }),
    });
    // Should not be 400 (screenshot guard allows visual collection)
    assert.ok(res.statusCode !== 400 || (res.statusCode === 400 && !JSON.parse(res.body).error.includes("not supported")),
      "inspiration screenshot should not be blocked by visual guard");

    // AC 5 — the file landed under the temp screenshotsDir, NOT the app tree.
    const writtenPath = path.join(shotDir, "bm-shot-test.png");
    assert.ok(fs.existsSync(writtenPath), "screenshot must be written under the injected screenshotsDir");
    assert.ok(!fs.existsSync(path.join(__dirname, "screenshots", "bm-shot-test.png")), "must not write into the app tree");

    // AC 4 — the screenshot is served at /screenshots/<file> (assets don't 404).
    const served = await app.inject({ method: "GET", url: "/screenshots/bm-shot-test.png" });
    assert.equal(served.statusCode, 200, "served screenshot should be 200");
    assert.equal(served.headers["content-type"], "image/png");
    assert.ok(served.rawPayload.length > 0, "served screenshot should have bytes");
  } finally {
    fs.writeFileSync(BOOKMARKS_FILE, bmSnapshot);
    fs.rmSync(shotDir, { recursive: true, force: true });
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

// --- Story 2.4: localhost bind default + reverse-proxy posture ---

test("getListenOptions defaults to 127.0.0.1:3141 (secure default)", () => {
  const opts = getListenOptions(loadConfig({}));
  assert.deepEqual(opts, { host: "127.0.0.1", port: 3141 });
});

test("getListenOptions binds an explicit HOST override", () => {
  assert.equal(getListenOptions(loadConfig({ HOST: "0.0.0.0" })).host, "0.0.0.0");
  // empty/whitespace HOST must NOT bind-all — it falls back to localhost (2.1 AC1)
  assert.equal(getListenOptions(loadConfig({ HOST: "" })).host, "127.0.0.1");
  assert.equal(getListenOptions(loadConfig({ PORT: "8080" })).port, 8080);
});

test("warnIfExposed warns on a non-localhost bind, stays silent on localhost", () => {
  const warns: string[] = [];
  const logger = { warn: (m: string) => warns.push(m) };

  warnIfExposed({ host: "127.0.0.1", port: 3141 }, logger);
  assert.equal(warns.length, 0, "localhost must not warn");

  warnIfExposed({ host: "0.0.0.0", port: 3141 }, logger);
  assert.equal(warns.length, 1, "non-localhost must warn exactly once");
  assert.match(warns[0], /0\.0\.0\.0/);
  assert.match(warns[0], /reverse proxy|firewall/i);

  // ::1 and localhost are also safe
  warnIfExposed({ host: "::1", port: 3141 }, logger);
  warnIfExposed({ host: "localhost", port: 3141 }, logger);
  assert.equal(warns.length, 1, "::1 and localhost must not warn");
});

// --- Story 8.3: SQLite-backed per-item actions (REST) ---

test("PATCH /api/items/:id updates notes (SQLite-backed, injected db)", async () => {
  const { initDb } = await import("./db/index.js");
  const { boards, items } = await import("./db/schema.js");
  const { eq } = await import("drizzle-orm");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "board-oss-itemroute-"));
  const handle = initDb(path.join(dir, "r.db"));
  try {
    handle.db.insert(boards).values({ id: "b", name: "B", view: "list", descriptor: { view: "list", ingest_mode: "url-readable", enrichment_prompt: "", fields: [] } }).run();
    handle.db.insert(items).values({ id: "it", boardId: "b", source: "x" }).run();
    const { assets } = await import("./db/schema.js");
    const shotDir = path.join(dir, "shots");
    fs.mkdirSync(shotDir, { recursive: true });
    const app = await buildServer({ db: handle, screenshotsDir: shotDir });

    // notes PATCH
    const res = await app.inject({ method: "PATCH", url: "/api/items/it", headers: { "content-type": "application/json" }, body: JSON.stringify({ notes: "hi" }) });
    assert.equal(res.statusCode, 200);
    assert.equal(handle.db.select().from(items).where(eq(items.id, "it")).get()?.notes, "hi");

    // favorite toggle via route
    await app.inject({ method: "PATCH", url: "/api/items/it", headers: { "content-type": "application/json" }, body: JSON.stringify({ favorite: true }) });
    assert.equal(handle.db.select().from(items).where(eq(items.id, "it")).get()?.favorite, 1);

    // disallowed field via route — status unchanged
    await app.inject({ method: "PATCH", url: "/api/items/it", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "done" }) });
    assert.equal(handle.db.select().from(items).where(eq(items.id, "it")).get()?.status, "pending");

    // DELETE via route removes the item AND unlinks its asset file (non-grid board)
    handle.db.insert(assets).values({ id: "it-a", itemId: "it", kind: "screenshot", path: "screenshots/it.png" }).run();
    fs.writeFileSync(path.join(shotDir, "it.png"), "PNG");
    const del = await app.inject({ method: "DELETE", url: "/api/items/it" });
    assert.equal(del.statusCode, 204);
    assert.equal(handle.db.select().from(items).where(eq(items.id, "it")).get(), undefined);
    assert.equal(fs.existsSync(path.join(shotDir, "it.png")), false, "asset file unlinked via route DELETE");

    const missing = await app.inject({ method: "PATCH", url: "/api/items/nope", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(missing.statusCode, 404);
  } finally {
    handle.sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- Story 8.5: provider-configured signal ---

test("GET /api/meta reports providerConfigured=false in no-AI mode (disabledLlm)", async () => {
  const app = await buildServer(); // no opts.llm → selectProvider(config) → disabledLlm in test env
  const res = await app.inject({ method: "GET", url: "/api/meta" });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).providerConfigured, false);
});

test("GET /api/meta reports providerConfigured=true when an llm is injected", async () => {
  const app = await buildServer({ llm: { complete: async () => ({}) } as never });
  const res = await app.inject({ method: "GET", url: "/api/meta" });
  assert.equal(JSON.parse(res.body).providerConfigured, true);
});

// --- Story 8.6: warm zero-config first-run boot ---

test("first-run boot: serves with no LLM config + seeded boards present", async () => {
  const app = await buildServer(); // no llm, no opts → no-AI first-run
  const cols = await app.inject({ method: "GET", url: "/api/collections" });
  assert.equal(cols.statusCode, 200);
  const ids = JSON.parse(cols.body).map((c: { id: string }) => c.id);
  assert.ok(ids.includes("inspiration") && ids.includes("library"), "seeded boards present on first run");
  const meta = await app.inject({ method: "GET", url: "/api/meta" });
  assert.equal(JSON.parse(meta.body).providerConfigured, false, "no-AI by default (nudge will show)");
  const index = await app.inject({ method: "GET", url: "/" });
  assert.equal(index.statusCode, 200, "the app serves the board UI");
});

// --- Story 9.1: search skill route ---

test("POST /skills/search returns board-scoped FTS hits", async () => {
  const { initDb } = await import("./db/index.js");
  const { boards } = await import("./db/schema.js");
  const { writeItem } = await import("./db/queue.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "board-oss-searchroute-"));
  const handle = initDb(path.join(dir, "s.db"));
  try {
    handle.db.insert(boards).values({ id: "a", name: "A", view: "list", descriptor: { view: "list", ingest_mode: "url-readable", enrichment_prompt: "", fields: [] } }).run();
    await writeItem(handle, { id: "it", boardId: "a", source: "x", title: "zqxwv distinctive" });
    const app = await buildServer({ db: handle });
    const res = await app.inject({ method: "POST", url: "/skills/search", headers: { "content-type": "application/json" }, body: JSON.stringify({ boardId: "a", q: "zqxwv" }) });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.items.some((i: { id: string }) => i.id === "it"), "FTS hit returned via the skill route");
    // malformed query → no 500
    const bad = await app.inject({ method: "POST", url: "/skills/search", headers: { "content-type": "application/json" }, body: JSON.stringify({ boardId: "a", q: 'foo"bar' }) });
    assert.equal(bad.statusCode, 200);
  } finally {
    handle.sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
