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

// library.json / bookmarks.json are gitignored personal-capture files (absent in
// CI). snapshotFile tolerates a missing file (returns null); restoreFile puts the
// original contents back, or removes a file the test created — keeping the tree clean.
function snapshotFile(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf-8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}
function restoreFile(file: string, snap: string | null): void {
  if (snap === null) fs.rmSync(file, { force: true });
  else fs.writeFileSync(file, snap);
}

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

test("GET /api/collections returns all collections including library (SQLite)", async () => {
  const { app, handle, dir } = await seededSqliteApp();
  try {
    const res = await app.inject({ method: "GET", url: "/api/collections" });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body) as any[];
    assert.ok(Array.isArray(body), "should return an array");
    assert.ok(body.some((c) => c.id === "inspiration"), "should include inspiration");
    assert.ok(body.some((c) => c.id === "library"), "should include library");
    assert.ok(body.every((c) => c.id && c.name && c.type && c.view), "each entry should have id/name/type/view");
  } finally {
    handle.sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- SQLite cutover: the collection item routes are now SQLite-backed (hydrated for
// the UI). These replace the old flat-JSON-contract tests for the same routes. ---

async function seededSqliteApp() {
  const { initDb } = await import("./db/index.js");
  const { seed } = await import("./db/seed.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "board-oss-cut-"));
  const handle = initDb(path.join(dir, "c.db"));
  seed(handle.db);
  const app = await buildServer({ db: handle });
  return { app, handle, dir };
}

test("GET /api/collections/:cid/items returns SQLite items hydrated for the UI", async () => {
  const { writeItem } = await import("./db/queue.js");
  const { app, handle, dir } = await seededSqliteApp();
  try {
    await writeItem(handle, { id: "lib-1", boardId: "library", source: "https://x", title: "T", fields: { summary: "S", topics: ["a"] } });
    const res = await app.inject({ method: "GET", url: "/api/collections/library/items" });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body) as any[];
    assert.equal(body.length, 1);
    assert.equal(body[0].id, "lib-1");
    assert.equal(body[0].title, "T");
    assert.equal(body[0].summary, "S"); // flat field hydrated to top level
    assert.deepEqual(body[0].topics, ["a"]);
  } finally {
    handle.sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("PATCH /api/collections/:cid/items/:id updates notes (SQLite)", async () => {
  const { writeItem } = await import("./db/queue.js");
  const { app, handle, dir } = await seededSqliteApp();
  try {
    await writeItem(handle, { id: "lib-2", boardId: "library", source: "https://x", title: "T" });
    const res = await app.inject({ method: "PATCH", url: "/api/collections/library/items/lib-2", headers: { "content-type": "application/json" }, body: JSON.stringify({ notes: "my research notes" }) });
    assert.equal(res.statusCode, 200);
    assert.equal((JSON.parse(res.body) as any).notes, "my research notes");
  } finally {
    handle.sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("DELETE /api/collections/:cid/items/:id removes the item (204, SQLite)", async () => {
  const { writeItem } = await import("./db/queue.js");
  const { eq } = await import("drizzle-orm");
  const { items } = await import("./db/schema.js");
  const { app, handle, dir } = await seededSqliteApp();
  try {
    await writeItem(handle, { id: "lib-3", boardId: "library", source: "https://x", title: "T" });
    const res = await app.inject({ method: "DELETE", url: "/api/collections/library/items/lib-3" });
    assert.equal(res.statusCode, 204);
    assert.equal(handle.db.select().from(items).where(eq(items.id, "lib-3")).get(), undefined);
  } finally {
    handle.sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- Unknown cid ---

test("GET /api/collections/no-such-cid/items returns an empty list (unknown board)", async () => {
  const { app, handle, dir } = await seededSqliteApp();
  try {
    const res = await app.inject({ method: "GET", url: "/api/collections/no-such-cid/items" });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body), []);
  } finally {
    handle.sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("PATCH /api/collections/:cid/items/:id returns 404 for an unknown item (SQLite)", async () => {
  const { app, handle, dir } = await seededSqliteApp();
  try {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/collections/no-such-cid/items/x",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes: "x" }),
    });
    assert.equal(res.statusCode, 404);
  } finally {
    handle.sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- Screenshot guard ---

test("POST /api/collections/library/items/:id/screenshot returns 400 for non-visual collection", async () => {
  const libSnapshot = snapshotFile(LIBRARY_FILE);
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
    restoreFile(LIBRARY_FILE, libSnapshot);
  }
});

test("POST /api/collections/inspiration/items/:id/screenshot passes visual guard", async () => {
  const bmSnapshot = snapshotFile(BOOKMARKS_FILE);
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
    restoreFile(BOOKMARKS_FILE, bmSnapshot);
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

test("POST /api/collections/:cid/items accepts a url + creates a pending item (SQLite)", async () => {
  const { app, handle, dir } = await seededSqliteApp();
  try {
    // analysisAgent is a prototype concept the SQLite path ignores (provider is configured
    // server-side) — it must NOT 400; the item is created pending.
    const res = await app.inject({ method: "POST", url: "/api/collections/inspiration/items", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: "https://example.com", analysisAgent: "gpt" }) });
    assert.equal(res.statusCode, 200);
    assert.equal((JSON.parse(res.body) as any).status, "pending");
  } finally {
    handle.sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("POST /api/collections/no-such-cid/items returns 4xx for unknown collection (SQLite)", async () => {
  const { app, handle, dir } = await seededSqliteApp();
  try {
    const res = await app.inject({ method: "POST", url: "/api/collections/no-such-cid/items", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: "https://example.com" }) });
    assert.ok(res.statusCode >= 400, `unknown board should 4xx, got ${res.statusCode}`);
  } finally {
    handle.sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- Legacy alias: PATCH /api/bookmarks/:id ---

test("PATCH /api/bookmarks/:id (alias) updates favorite field and preserves other fields", async () => {
  const bmSnapshot = snapshotFile(BOOKMARKS_FILE);
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
    restoreFile(BOOKMARKS_FILE, bmSnapshot);
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
  // Boot seeds the boards (server.ts entrypoint); a seeded db models that fresh-boot state.
  const { app, handle, dir } = await seededSqliteApp();
  try {
    const cols = await app.inject({ method: "GET", url: "/api/collections" });
    assert.equal(cols.statusCode, 200);
    const ids = JSON.parse(cols.body).map((c: { id: string }) => c.id);
    assert.ok(ids.includes("inspiration") && ids.includes("library"), "seeded boards present on first run");
    const meta = await app.inject({ method: "GET", url: "/api/meta" });
    assert.equal(JSON.parse(meta.body).providerConfigured, false, "no-AI by default (nudge will show)");
    const index = await app.inject({ method: "GET", url: "/" });
    assert.equal(index.statusCode, 200, "the app serves the board UI");
  } finally {
    handle.sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
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

// --- Story 11.1: /healthz liveness ---

test("GET /healthz is a pure 200 liveness probe (no DB, no pollution)", async () => {
  const app = await buildServer(); // no opts.db → if /healthz touched the DB it would open ./data
  const res = await app.inject({ method: "GET", url: "/healthz" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true });
});

// --- Story 11.2 review BLOCKER regression: boot must seed boards (zero-config first-run) ---

test("a seeded DB lets add-item succeed (first-run capture path, no 'unknown board' 500)", async () => {
  const { initDb } = await import("./db/index.js");
  const { seed } = await import("./db/seed.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "board-oss-seedboot-"));
  const handle = initDb(path.join(dir, "s.db"));
  try {
    seed(handle.db); // what the boot entrypoint now does on a fresh DATA_DIR
    const app = await buildServer({ db: handle });
    const res = await app.inject({ method: "POST", url: "/skills/add-item", headers: { "content-type": "application/json" }, body: JSON.stringify({ boardId: "inspiration", source: "https://example.com" }) });
    assert.equal(res.statusCode, 200, "add-item must NOT 500 on a seeded board");
    assert.equal(JSON.parse(res.body).status, "pending");
  } finally {
    handle.sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- Edit-board routes (rename / delete) ---

test("PATCH /api/boards/:id renames; DELETE /api/boards/:id cascades", async () => {
  const { createBoardSkill } = await import("./skills/create-board.js");
  const { buildCtx } = await import("./skills/types.js");
  const { enqueueWrite } = await import("./db/queue.js");
  const { boards } = await import("./db/schema.js");
  const { eq } = await import("drizzle-orm");
  const { app, handle, dir } = await seededSqliteApp();
  try {
    await createBoardSkill.run(
      { id: "wines", name: "Wines", descriptor: { view: "grid", ingest_mode: "url-screenshot", enrichment_prompt: "", fields: [] } },
      buildCtx({ db: handle, queue: { enqueueWrite }, logger: console })
    );
    const r = await app.inject({ method: "PATCH", url: "/api/boards/wines", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Fine Wines" }) });
    assert.equal(r.statusCode, 200);
    assert.equal(handle.db.select().from(boards).where(eq(boards.id, "wines")).get()?.name, "Fine Wines");
    assert.equal((await app.inject({ method: "PATCH", url: "/api/boards/wines", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "  " }) })).statusCode, 400);
    assert.equal((await app.inject({ method: "PATCH", url: "/api/boards/ghost", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "x" }) })).statusCode, 404);
    const d = await app.inject({ method: "DELETE", url: "/api/boards/wines" });
    assert.equal(d.statusCode, 200);
    assert.equal(handle.db.select().from(boards).where(eq(boards.id, "wines")).get(), undefined);
    assert.equal((await app.inject({ method: "DELETE", url: "/api/boards/ghost" })).statusCode, 404);
  } finally {
    handle.sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- PATCH /api/boards/:id descriptor update (board field editor) ---

test("PATCH /api/boards/:id updates the descriptor (valid) and 400s on invalid", async () => {
  const { insertBoard } = await import("./db/seed.js");
  const { boards } = await import("./db/schema.js");
  const { eq } = await import("drizzle-orm");
  const { app, handle, dir } = await seededSqliteApp();
  try {
    insertBoard(handle.db, { id: "games", name: "Games", descriptor: { view: "grid", ingest_mode: "url-screenshot", enrichment_prompt: "", fields: [] } });
    const good = { view: "list", ingest_mode: "url-readable", enrichment_prompt: "Catalog it.", fields: [{ key: "rating", label: "Rating", type: "number", enrichable: true, description: "1-10" }] };
    const r = await app.inject({ method: "PATCH", url: "/api/boards/games", headers: { "content-type": "application/json" }, body: JSON.stringify({ descriptor: good }) });
    assert.equal(r.statusCode, 200);
    const stored = handle.db.select().from(boards).where(eq(boards.id, "games")).get();
    assert.equal((stored?.descriptor as any).fields[0].description, "1-10");
    assert.equal(stored?.view, "list", "view column synced from descriptor");
    // invalid: off-list field type → 400, descriptor unchanged
    const bad = { ...good, fields: [{ key: "x", label: "X", type: "boolean" }] };
    const b = await app.inject({ method: "PATCH", url: "/api/boards/games", headers: { "content-type": "application/json" }, body: JSON.stringify({ descriptor: bad }) });
    assert.equal(b.statusCode, 400);
    assert.equal((handle.db.select().from(boards).where(eq(boards.id, "games")).get()?.descriptor as any).fields.length, 1, "unchanged after invalid");
    // guardrails parity with the composer: a key shadowing a system column → 400
    const reserved = { ...good, fields: [{ key: "notes", label: "Notes", type: "text", enrichable: true }] };
    assert.equal((await app.inject({ method: "PATCH", url: "/api/boards/games", headers: { "content-type": "application/json" }, body: JSON.stringify({ descriptor: reserved }) })).statusCode, 400, "reserved system-column key rejected");
    // duplicate keys → 400
    const dup = { ...good, fields: [{ key: "dupe", label: "A", type: "text" }, { key: "dupe", label: "B", type: "text" }] };
    assert.equal((await app.inject({ method: "PATCH", url: "/api/boards/games", headers: { "content-type": "application/json" }, body: JSON.stringify({ descriptor: dup }) })).statusCode, 400, "duplicate key rejected");
  } finally {
    handle.sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- POST /api/boards/:id/reenrich (batch re-run AI) ---

test("POST /api/boards/:id/reenrich queues all items; 404 for unknown board", async () => {
  const { insertBoard } = await import("./db/seed.js");
  const { writeItem } = await import("./db/queue.js");
  const { app, handle, dir } = await seededSqliteApp();
  try {
    // no enrichable fields → enrichment is a fast no-op (deterministic, no LLM)
    insertBoard(handle.db, { id: "rb", name: "RB", descriptor: { view: "grid", ingest_mode: "url-screenshot", enrichment_prompt: "", fields: [] } });
    await writeItem(handle, { id: "r1", boardId: "rb", source: "https://a", title: "A" });
    await writeItem(handle, { id: "r2", boardId: "rb", source: "https://b", title: "B" });
    const r = await app.inject({ method: "POST", url: "/api/boards/rb/reenrich" });
    assert.equal(r.statusCode, 200);
    assert.equal(JSON.parse(r.body).queued, 2);
    assert.equal((await app.inject({ method: "POST", url: "/api/boards/ghost/reenrich" })).statusCode, 404);
    await new Promise((res) => setTimeout(res, 60)); // let fire-and-forget no-op jobs drain before close
  } finally {
    handle.sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
