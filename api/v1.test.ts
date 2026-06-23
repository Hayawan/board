import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServer } from "../server.js";

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
  });
  return { app, handle, dir };
}

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
