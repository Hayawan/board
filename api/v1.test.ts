import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { eq } from "drizzle-orm";
import { buildServer } from "../server.js";
import { items, assets } from "../db/schema.js";

// Story 12.1 — static bearer-token auth for the new /api/v1 surface.
// Hermetic: buildServer({ apiToken, db }) injects a known token + temp seeded DB;
// we never mutate process.env (the config singleton is frozen at load).

async function seededV1App(
  opts: { apiToken?: string; corsOrigins?: string[]; logger?: any } = {},
) {
  const { initDb } = await import("../db/index.js");
  const { seed } = await import("../db/seed.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "board-oss-v1-"));
  const handle = initDb(path.join(dir, "c.db"));
  seed(handle.db);
  const app = await buildServer({
    db: handle,
    apiToken: opts.apiToken ?? "test-token",
    corsOrigins: opts.corsOrigins,
    logger: opts.logger,
    screenshotsDir: dir, // Story 12.2 delete-asset-file tests resolve files here
  });
  return { app, handle, dir };
}

const AUTH = { authorization: "Bearer test-token", "content-type": "application/json" };

// AC 2 — valid token reaches the handler (not 401)
test("12.1: /api/v1/* with a valid bearer token reaches the handler", async () => {
  const { app, handle, dir } = await seededV1App();
  try {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/ping",
      headers: { authorization: "Bearer test-token" },
    });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body), { ok: true });
  } finally {
    handle.sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// AC 2 — missing Authorization header → 401, handler never runs
test("12.1: /api/v1/* with NO Authorization header → 401", async () => {
  const { app, handle, dir } = await seededV1App();
  try {
    const res = await app.inject({ method: "GET", url: "/api/v1/ping" });
    assert.equal(res.statusCode, 401);
  } finally {
    handle.sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// AC 2 — wrong / malformed token → 401
test("12.1: /api/v1/* with a wrong token → 401", async () => {
  const { app, handle, dir } = await seededV1App();
  try {
    const wrong = await app.inject({
      method: "GET",
      url: "/api/v1/ping",
      headers: { authorization: "Bearer wrong-token" },
    });
    assert.equal(wrong.statusCode, 401);
    const malformed = await app.inject({
      method: "GET",
      url: "/api/v1/ping",
      headers: { authorization: "test-token" }, // no "Bearer " scheme
    });
    assert.equal(malformed.statusCode, 401);
  } finally {
    handle.sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// AC 2 — fail-closed: no token configured → the v1 surface rejects everything
test("12.1: with NO token configured the v1 surface fails closed (401)", async () => {
  const { initDb } = await import("../db/index.js");
  const { seed } = await import("../db/seed.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "board-oss-v1-"));
  const handle = initDb(path.join(dir, "c.db"));
  seed(handle.db);
  // apiToken explicitly null → no configured token
  const app = await buildServer({ db: handle, apiToken: null as any });
  try {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/ping",
      headers: { authorization: "Bearer anything" },
    });
    assert.equal(res.statusCode, 401);
  } finally {
    handle.sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// AC 3 (NFR-BC) — existing legacy route serves unchanged with NO Authorization header
test("12.1 (NFR-BC): legacy GET /api/bookmarks still serves with no auth header", async () => {
  const { app, handle, dir } = await seededV1App();
  try {
    const res = await app.inject({ method: "GET", url: "/api/bookmarks" });
    assert.equal(res.statusCode, 200, "legacy route must be unaffected by the v1 guard");
  } finally {
    handle.sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// AC 3 (NFR-BC) — existing SQLite route serves unchanged with NO Authorization header
test("12.1 (NFR-BC): existing /api/collections still serves with no auth header", async () => {
  const { app, handle, dir } = await seededV1App();
  try {
    const res = await app.inject({ method: "GET", url: "/api/collections" });
    assert.equal(res.statusCode, 200, "existing SQLite route must be unaffected by the v1 guard");
  } finally {
    handle.sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// AC 4 — CORS scoped to the configured origin(s) on the v1 surface
test("12.1: CORS allows a configured origin and omits the header for others", async () => {
  const { app, handle, dir } = await seededV1App({ corsOrigins: ["https://ext.example"] });
  try {
    const allowed = await app.inject({
      method: "GET",
      url: "/api/v1/ping",
      headers: { authorization: "Bearer test-token", origin: "https://ext.example" },
    });
    assert.equal(allowed.headers["access-control-allow-origin"], "https://ext.example");

    const denied = await app.inject({
      method: "GET",
      url: "/api/v1/ping",
      headers: { authorization: "Bearer test-token", origin: "https://evil.example" },
    });
    assert.equal(denied.headers["access-control-allow-origin"], undefined);
  } finally {
    handle.sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// AC 4 — legacy/SPA routes get NO CORS headers (unchanged behavior)
test("12.1 (NFR-BC): legacy route emits no CORS header even with an Origin", async () => {
  const { app, handle, dir } = await seededV1App({ corsOrigins: ["https://ext.example"] });
  try {
    const res = await app.inject({
      method: "GET",
      url: "/api/bookmarks",
      headers: { origin: "https://ext.example" },
    });
    assert.equal(res.headers["access-control-allow-origin"], undefined);
  } finally {
    handle.sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// AC 5 — the plaintext token never appears in captured log output, even when the
// resolved config is dumped to the logger (the realistic debug-leak path). This is
// non-vacuous: it would fail if loadConfig retained the plaintext or made the hash
// enumerable such that a config dump echoed the secret.
test("12.1: dumping config to the logger never leaks the plaintext token (or its hash)", async () => {
  const { loadConfig } = await import("../config.js");
  const { inspect } = await import("node:util");
  const lines: string[] = [];
  const capture = (...args: unknown[]) => lines.push(args.map(String).join(" "));
  const logger = { info: capture, warn: capture, error: capture, debug: capture };

  const c = loadConfig({ BOARD_API_TOKEN: "test-token" });
  // Simulate every realistic way an operator/debug path dumps config to logs.
  logger.info(`config: ${JSON.stringify(c)}`);
  logger.info(`config: ${String(c)}`);
  logger.debug(`config: ${inspect(c)}`);

  assert.ok(!lines.some((l) => l.includes("test-token")), "plaintext token must never be logged");
  // The non-reversible hash must also drop out of serialization (non-enumerable).
  assert.ok(
    c.apiTokenHash && !lines.some((l) => l.includes(c.apiTokenHash!)),
    "the token hash must not appear in serialized config either",
  );
});

// AC 2 (edge) — empty bearer token, lowercase scheme, and an injected empty-string
// token all behave correctly.
test("12.1 (edge): empty bearer, lowercase scheme, empty-string injected token", async () => {
  const { app, handle, dir } = await seededV1App();
  try {
    // empty token ("Bearer " with nothing after) → 401
    const empty = await app.inject({
      method: "GET",
      url: "/api/v1/ping",
      headers: { authorization: "Bearer " },
    });
    assert.equal(empty.statusCode, 401, "empty bearer token must be rejected");

    // lowercase scheme is RFC-legal and must be accepted with a valid token
    const lower = await app.inject({
      method: "GET",
      url: "/api/v1/ping",
      headers: { authorization: "bearer test-token" },
    });
    assert.equal(lower.statusCode, 200, "lowercase 'bearer' scheme must be accepted");
  } finally {
    handle.sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// AC 2 (edge) — an injected empty-string apiToken must fail closed (not hash "")
test("12.1 (edge): buildServer({ apiToken: '' }) fails closed", async () => {
  const { initDb } = await import("../db/index.js");
  const { seed } = await import("../db/seed.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "board-oss-v1-"));
  const handle = initDb(path.join(dir, "c.db"));
  seed(handle.db);
  const app = await buildServer({ db: handle, apiToken: "" });
  try {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/ping",
      headers: { authorization: "Bearer " }, // sha256("") would otherwise match an empty-token hash
    });
    assert.equal(res.statusCode, 401);
  } finally {
    handle.sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// AC 4 — OPTIONS preflight must succeed WITHOUT an auth header (CORS runs before the
// bearer guard). This pins the load-bearing registration order: a reorder that lets
// the guard 401 preflight would break the cross-origin PWA/extension clients (Epic 12).
test("12.1: CORS preflight (OPTIONS) succeeds with no auth header for a configured origin", async () => {
  const { app, handle, dir } = await seededV1App({ corsOrigins: ["https://ext.example"] });
  try {
    const res = await app.inject({
      method: "OPTIONS",
      url: "/api/v1/ping",
      headers: {
        origin: "https://ext.example",
        "access-control-request-method": "GET",
      },
    });
    assert.ok(res.statusCode < 400, `preflight must not be rejected, got ${res.statusCode}`);
    assert.equal(res.headers["access-control-allow-origin"], "https://ext.example");
  } finally {
    handle.sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// =====================================================================
// Story 12.2 — CRUD item + board API under /api/v1 (token-authed).
// Auth itself is 12.1's concern; every request here carries a valid token.
// =====================================================================

/** Insert an item row directly with a deterministic created_at (seconds). */
function insertItem(
  handle: any,
  o: { id: string; boardId?: string; status?: string; createdAt: number; source?: string; title?: string; favorite?: number },
) {
  handle.db
    .insert(items)
    .values({
      id: o.id,
      boardId: o.boardId ?? "library",
      status: o.status ?? "ready",
      source: o.source ?? `https://example.com/${o.id}`,
      title: o.title ?? o.id,
      favorite: o.favorite ?? 0,
      createdAt: o.createdAt,
      updatedAt: o.createdAt,
    })
    .run();
}

// AC 1 — create-from-URL returns an optimistic pending item immediately
test("12.2: POST /api/v1/items creates a pending item on an existing board", async () => {
  const { app, handle, dir } = await seededV1App();
  try {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/items",
      headers: AUTH,
      body: JSON.stringify({ url: "https://example.com", boardId: "library" }),
    });
    assert.equal(res.statusCode, 201);
    const body = JSON.parse(res.body);
    assert.equal(body.status, "pending");
    assert.ok(body.id, "created item should have an id");
  } finally {
    handle.sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// AC 1 — missing/blank url → 400 (before the DB is touched)
test("12.2: POST /api/v1/items with a blank url → 400", async () => {
  const { app, handle, dir } = await seededV1App();
  try {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/items",
      headers: AUTH,
      body: JSON.stringify({ url: "   ", boardId: "library" }),
    });
    assert.equal(res.statusCode, 400);
  } finally {
    handle.sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// AC 1 — unknown boardId → 400 (12.2 does NOT default to Inbox)
test("12.2: POST /api/v1/items with an unknown boardId → 400", async () => {
  const { app, handle, dir } = await seededV1App();
  try {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/items",
      headers: AUTH,
      body: JSON.stringify({ url: "https://example.com", boardId: "no-such-board" }),
    });
    assert.equal(res.statusCode, 400);
    // pin the cause: the error names the missing board, not a generic failure
    assert.match(JSON.parse(res.body).error ?? "", /board/i);
  } finally {
    handle.sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// AC 1 — create persists through the SHARED store (not a parallel path). Combined
// with the unknown-board test above (which proves addItemSkill's board-existence
// check runs), this pins that create goes through the shared add-item/writeItem path.
test("12.2: POST /api/v1/items persists the item to the shared store", async () => {
  const { app, handle, dir } = await seededV1App();
  try {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/items",
      headers: AUTH,
      body: JSON.stringify({ url: "https://shared-store.example", boardId: "library" }),
    });
    assert.equal(res.statusCode, 201);
    const id = JSON.parse(res.body).id;
    // the row exists in the SAME items table the rest of the app reads/writes
    const row = handle.db.select().from(items).where(eq(items.id, id)).get();
    assert.ok(row, "created item must be in the shared items table");
    assert.equal(row.boardId, "library");
    assert.equal(row.source, "https://shared-store.example");
    assert.equal(row.status, "pending");
  } finally {
    handle.sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// AC 2 — list: newest-first + board/status/limit/offset/since filters
test("12.2: GET /api/v1/items lists newest-first and honors filters", async () => {
  const { app, handle, dir } = await seededV1App();
  try {
    insertItem(handle, { id: "old", createdAt: 1000, boardId: "library", status: "ready" });
    insertItem(handle, { id: "mid", createdAt: 2000, boardId: "library", status: "pending" });
    insertItem(handle, { id: "new", createdAt: 3000, boardId: "inspiration", status: "ready" });

    // newest-first across all boards
    const all = await app.inject({ method: "GET", url: "/api/v1/items", headers: AUTH });
    assert.equal(all.statusCode, 200);
    const ids = (JSON.parse(all.body) as any[]).map((i) => i.id);
    assert.deepEqual(ids, ["new", "mid", "old"]);

    // board filter
    const lib = await app.inject({ method: "GET", url: "/api/v1/items?board=library", headers: AUTH });
    assert.deepEqual((JSON.parse(lib.body) as any[]).map((i) => i.id), ["mid", "old"]);

    // status filter
    const ready = await app.inject({ method: "GET", url: "/api/v1/items?status=ready", headers: AUTH });
    assert.deepEqual((JSON.parse(ready.body) as any[]).map((i) => i.id), ["new", "old"]);

    // limit + offset
    const page = await app.inject({ method: "GET", url: "/api/v1/items?limit=1&offset=1", headers: AUTH });
    assert.deepEqual((JSON.parse(page.body) as any[]).map((i) => i.id), ["mid"]);

    // since (created_at >= 2500)
    const since = await app.inject({ method: "GET", url: "/api/v1/items?since=2500", headers: AUTH });
    assert.deepEqual((JSON.parse(since.body) as any[]).map((i) => i.id), ["new"]);
  } finally {
    handle.sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// AC 2 (edge) — a malformed numeric param must fall back to defaults, not 500
test("12.2: GET /api/v1/items with junk limit/offset/since falls back (no 500)", async () => {
  const { app, handle, dir } = await seededV1App();
  try {
    insertItem(handle, { id: "a", createdAt: 1000 });
    insertItem(handle, { id: "b", createdAt: 2000 });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/items?limit=abc&offset=xyz&since=nope",
      headers: AUTH,
    });
    assert.equal(res.statusCode, 200, "junk params must not crash the query");
    assert.equal((JSON.parse(res.body) as any[]).length, 2);

    // offset beyond the end → empty page, still 200
    const beyond = await app.inject({ method: "GET", url: "/api/v1/items?offset=999", headers: AUTH });
    assert.equal(beyond.statusCode, 200);
    assert.deepEqual(JSON.parse(beyond.body), []);
  } finally {
    handle.sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// AC 3 (contract) — a bodyless DELETE with a reflexive json content-type still works
test("12.2: DELETE with an empty body + json content-type still returns 204", async () => {
  const { app, handle, dir } = await seededV1App();
  try {
    insertItem(handle, { id: "ct1", createdAt: 1000 });
    const res = await app.inject({
      method: "DELETE",
      url: "/api/v1/items/ct1",
      headers: AUTH, // includes content-type: application/json with no body
    });
    assert.equal(res.statusCode, 204);
  } finally {
    handle.sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// AC 3 — PATCH reuses the 8.3 allowlist (disallowed field unchanged)
test("12.2: PATCH /api/v1/items/:id applies the user-field allowlist", async () => {
  const { app, handle, dir } = await seededV1App();
  try {
    insertItem(handle, { id: "p1", createdAt: 1000, status: "ready" });
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/items/p1",
      headers: AUTH,
      body: JSON.stringify({ notes: "hello", favorite: true, status: "done" }),
    });
    assert.equal(res.statusCode, 200);
    const row = handle.db.select().from(items).where(eq(items.id, "p1")).get();
    assert.equal(row.notes, "hello");
    assert.equal(row.favorite, 1);
    assert.equal(row.status, "ready", "disallowed `status` must be unchanged");
  } finally {
    handle.sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("12.2: PATCH /api/v1/items/:id unknown id → 404", async () => {
  const { app, handle, dir } = await seededV1App();
  try {
    const res = await app.inject({ method: "PATCH", url: "/api/v1/items/nope", headers: AUTH, body: "{}" });
    assert.equal(res.statusCode, 404);
  } finally {
    handle.sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// AC 3 — DELETE reuses deleteItemWithAssets (204 + asset FILE removed, no orphan)
test("12.2: DELETE /api/v1/items/:id returns 204 and unlinks the asset file", async () => {
  const { app, handle, dir } = await seededV1App();
  try {
    insertItem(handle, { id: "d1", createdAt: 1000 });
    const fileName = "d1-shot.png";
    fs.writeFileSync(path.join(dir, fileName), "png-bytes");
    handle.db
      .insert(assets)
      .values({ id: "a-d1", itemId: "d1", kind: "screenshot", path: `screenshots/${fileName}` })
      .run();

    const res = await app.inject({
      method: "DELETE",
      url: "/api/v1/items/d1",
      headers: { authorization: "Bearer test-token" }, // bodyless: no json content-type
    });
    assert.equal(res.statusCode, 204);
    assert.equal(handle.db.select().from(items).where(eq(items.id, "d1")).get(), undefined);
    assert.equal(fs.existsSync(path.join(dir, fileName)), false, "asset file must be unlinked (no orphan)");
  } finally {
    handle.sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("12.2: DELETE /api/v1/items/:id unknown id → 404", async () => {
  const { app, handle, dir } = await seededV1App();
  try {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/v1/items/nope",
      headers: { authorization: "Bearer test-token" },
    });
    assert.equal(res.statusCode, 404);
  } finally {
    handle.sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// AC 4 — board list for targeting ({id,name,view})
test("12.2: GET /api/v1/boards returns {id,name,view} for targeting", async () => {
  const { app, handle, dir } = await seededV1App();
  try {
    const res = await app.inject({ method: "GET", url: "/api/v1/boards", headers: AUTH });
    assert.equal(res.statusCode, 200);
    const boards = JSON.parse(res.body) as any[];
    assert.ok(boards.some((b) => b.id === "library" && b.name && b.view));
    assert.ok(boards.some((b) => b.id === "inspiration"));
    // lean shape — no descriptor
    assert.ok(boards.every((b) => !("descriptor" in b)));
  } finally {
    handle.sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// AC 5 (NFR-BC) — an item created via the legacy/collections path is visible AND
// mutable via /api/v1 (one store, one set of helpers — no parallel write path).
test("12.2 (NFR-BC): an item from the collections path is visible + mutable via v1", async () => {
  const { app, handle, dir } = await seededV1App();
  try {
    // create via the existing collections route (no auth header — legacy surface)
    const created = await app.inject({
      method: "POST",
      url: "/api/collections/library/items",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://shared.example" }),
    });
    assert.equal(created.statusCode, 200);
    const id = JSON.parse(created.body).id;

    // visible via v1 list
    const list = await app.inject({ method: "GET", url: "/api/v1/items?board=library", headers: AUTH });
    assert.ok((JSON.parse(list.body) as any[]).some((i) => i.id === id), "v1 should see the collections-created item");

    // mutable via v1 patch
    const patched = await app.inject({
      method: "PATCH",
      url: `/api/v1/items/${id}`,
      headers: AUTH,
      body: JSON.stringify({ notes: "via v1" }),
    });
    assert.equal(patched.statusCode, 200);
    assert.equal(handle.db.select().from(items).where(eq(items.id, id)).get().notes, "via v1");
  } finally {
    handle.sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
