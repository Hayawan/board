import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildBookmarklet, TOKEN_PLACEHOLDER } from "./bookmarklet.js";
import { buildServer } from "../server.js";

// Story 13.2 — bookmarklet capture client.

// AC 1/2/5 — the payload is a valid javascript: bookmarklet hitting the authed endpoint
test("13.2: buildBookmarklet targets the authed /api/v1/items with url+title, no nav", () => {
  const bm = buildBookmarklet({ instanceUrl: "https://board.example", token: "tok-123" });
  assert.ok(bm.startsWith("javascript:"), "must be a javascript: bookmarklet");
  assert.ok(bm.includes("https://board.example/api/v1/items"), "posts to the instance's authed endpoint");
  assert.ok(bm.includes("Bearer "), "carries a Bearer token");
  assert.ok(bm.includes("tok-123"), "embeds the configured token");
  assert.ok(bm.includes("location.href"), "sends the current tab URL");
  assert.ok(bm.includes("document.title"), "sends the current tab title");
  assert.ok(bm.includes("'POST'") || bm.includes('"POST"'), "uses POST");
  // must NOT navigate the user away (no full-page redirect / window.location assignment)
  assert.ok(!/location\s*=/.test(bm) && !/location\.assign/.test(bm) && !/location\.replace/.test(bm),
    "must not navigate the page away");
});

// AC 1 — trailing slash on the instance URL is normalized (no double slash)
test("13.2: buildBookmarklet normalizes a trailing slash on the instance URL", () => {
  const bm = buildBookmarklet({ instanceUrl: "https://board.example/", token: "t" });
  assert.ok(bm.includes("https://board.example/api/v1/items"));
  assert.ok(!bm.includes("board.example//api/v1/items"));
});

// AC 1/4 — the help surface is served and renders the bookmarklet template (placeholder
// token, no plaintext from the server), without altering existing routes.
test("13.2: GET /bookmarklet serves the help page with the placeholder template", async () => {
  const { initDb } = await import("../db/index.js");
  const { seed } = await import("../db/seed.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "board-oss-bm-"));
  const handle = initDb(path.join(dir, "c.db"));
  seed(handle.db);
  const app = await buildServer({ db: handle, apiToken: "test-token" });
  try {
    const res = await app.inject({ method: "GET", url: "/bookmarklet" });
    assert.equal(res.statusCode, 200);
    assert.match(res.headers["content-type"] ?? "", /text\/html/);
    assert.ok(res.body.includes("/api/v1/items"), "page contains the authed endpoint");
    assert.ok(res.body.includes(TOKEN_PLACEHOLDER), "page ships a placeholder, never a server-held token");

    // existing route unaffected
    const cols = await app.inject({ method: "GET", url: "/api/collections" });
    assert.equal(cols.statusCode, 200);
  } finally {
    handle.sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// SECURITY (review fix) — a malicious Host header must NOT break out of the HTML or
// the <script> (reflected XSS). The Host is attacker-controllable behind some proxies.
test("13.2: GET /bookmarklet escapes a malicious Host header (no XSS breakout)", async () => {
  const { initDb } = await import("../db/index.js");
  const { seed } = await import("../db/seed.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "board-oss-bm-"));
  const handle = initDb(path.join(dir, "c.db"));
  seed(handle.db);
  const app = await buildServer({ db: handle, apiToken: "test-token" });
  try {
    const res = await app.inject({
      method: "GET",
      url: "/bookmarklet",
      headers: { host: `evil"></script><script>alert(1)</script><x y="` },
    });
    assert.equal(res.statusCode, 200);
    // the raw injected </script> must not appear unescaped (would terminate the block)
    assert.ok(!res.body.includes("</script><script>alert(1)"), "must not allow a </script> breakout");
    // and the raw attribute-breakout quote sequence must be escaped in the HTML context
    assert.ok(!res.body.includes(`evil"></script>`), "raw Host must be escaped in HTML");
  } finally {
    handle.sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
