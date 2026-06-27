import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Story 13.4 — contract tests for the pure browser-extension API client. Two layers:
//  (1) fake-fetch tests pin the URL / Bearer header / body shape cheaply, and
//  (2) an inject-backed round-trip routes the client's fetch into a real buildServer,
//      proving the calls satisfy the LIVE /api/v1 contract (not just a mock we authored
//      — e.g. assign's body is {itemIds:[id], boardId}, which a mock could get wrong).
import { createBoardClient, reviewAction } from "./api-client.js";

// A fake fetch that records the last call and returns a canned JSON response.
function recordingFetch(response: unknown = {}, status = 200) {
  const calls: Array<{ url: string; method: string; headers: any; body: any }> = [];
  const fetchFn = async (url: string, opts: any = {}) => {
    calls.push({ url, method: opts.method ?? "GET", headers: opts.headers ?? {}, body: opts.body });
    return {
      ok: status < 400,
      status,
      json: async () => response,
    };
  };
  // The client only needs a fetch-shaped callable; cast the minimal stand-in to the
  // global fetch type at the injection seam (the test asserts behavior, not types).
  return { fetchFn: fetchFn as unknown as typeof fetch, calls };
}

// AC 1/5 — save() POSTs the current tab to the authed /api/v1/items with NO board.
test("13.4: save() POSTs the current tab to authed /api/v1/items with no board", async () => {
  const { fetchFn, calls } = recordingFetch({ id: "i1", status: "pending" }, 201);
  const client = createBoardClient({ baseUrl: "https://board.example/", token: "tok-9", fetch: fetchFn });

  await client.save({ url: "https://shared.example/x", title: "X" });

  assert.equal(calls.length, 1);
  const c = calls[0];
  assert.equal(c.url, "https://board.example/api/v1/items", "hits the authed create endpoint (trailing slash normalized)");
  assert.equal(c.method, "POST");
  assert.equal(c.headers.Authorization, "Bearer tok-9", "carries the Bearer token");
  const body = JSON.parse(c.body);
  assert.equal(body.url, "https://shared.example/x");
  assert.equal(body.title, "X");
  assert.ok(!("boardId" in body), "sends no board → Inbox default (Story 13.1)");
});

// AC 1/5 — listRecent() GETs the authed list, Inbox-scoped, passing limit + since, and
// does NOT reorder the server's newest-first response (real ordering is the server's
// job, proven in v1.test.ts / db tests — the client is a faithful passthrough).
test("13.4: listRecent() GETs authed /api/v1/items with board+limit+since, preserving order", async () => {
  const server = [{ id: "c" }, { id: "b" }, { id: "a" }]; // newest-first, as the server returns
  const { fetchFn, calls } = recordingFetch(server);
  const client = createBoardClient({ baseUrl: "https://board.example", token: "t", fetch: fetchFn });

  const out = await client.listRecent(5, 1234);

  const u = new URL(calls[0].url);
  assert.equal(u.pathname, "/api/v1/items");
  assert.equal(u.searchParams.get("board"), "inbox", "review lane is Inbox-scoped");
  assert.equal(u.searchParams.get("limit"), "5");
  assert.equal(u.searchParams.get("since"), "1234", "since is passed through as a real param");
  assert.equal(calls[0].headers.Authorization, "Bearer t");
  assert.deepEqual(out.map((i: any) => i.id), ["c", "b", "a"], "client does not reorder the server's list");
});

// AC 2 — assign() POSTs the ONE assign verb with the batch body {itemIds:[id], boardId}.
test("13.4: assign() POSTs /api/v1/items/assign with {itemIds:[id], boardId}", async () => {
  const { fetchFn, calls } = recordingFetch({ assigned: 1 });
  const client = createBoardClient({ baseUrl: "https://board.example", token: "t", fetch: fetchFn });

  await client.assign("item-7", "library");

  assert.equal(calls[0].url, "https://board.example/api/v1/items/assign");
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].headers.Authorization, "Bearer t");
  assert.deepEqual(JSON.parse(calls[0].body), { itemIds: ["item-7"], boardId: "library" });
});

// AC 2 — reviewAction(): a real suggestion → one-tap chip; no suggestion → manual picker.
test("13.4: reviewAction() shows a chip for a suggestion, falls back to manual when none", () => {
  assert.deepEqual(reviewAction({ suggestedBoardId: "library" }), { mode: "chip", boardId: "library" });
  assert.deepEqual(reviewAction({ suggestedBoardId: null }), { mode: "manual" });
  assert.deepEqual(reviewAction(null), { mode: "manual" }, "no provider / no result → manual, never a dead end");
});

// AC 1/2/4 — INJECT-BACKED ROUND-TRIP: route the client's fetch into a real buildServer
// and prove the calls satisfy the LIVE contract (not a self-authored mock). save() lands
// in the Inbox; assign() actually moves board_id. This is what makes the mocks above
// trustworthy (e.g. it would catch a wrong assign body shape — the real route 400s).
test("13.4 (contract): save→Inbox and assign→move work against a real buildServer", async () => {
  const { buildServer } = await import("../server.js");
  const { initDb } = await import("../db/index.js");
  const { seed } = await import("../db/seed.js");
  const { items } = await import("../db/schema.js");
  const { eq } = await import("drizzle-orm");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "board-oss-ext-"));
  const handle = initDb(path.join(dir, "c.db"));
  seed(handle.db);
  const app = await buildServer({ db: handle, apiToken: "test-token", screenshotsDir: dir });
  // Adapt app.inject() into a fetch-shaped function the client can call.
  const fetchAdapter = async (url: string, opts: any = {}) => {
    const res = await app.inject({ method: opts.method ?? "GET", url, headers: opts.headers, payload: opts.body });
    return { ok: res.statusCode < 400, status: res.statusCode, json: async () => JSON.parse(res.body) };
  };
  const client = createBoardClient({ baseUrl: "", token: "test-token", fetch: fetchAdapter as unknown as typeof fetch });
  try {
    // save() → an Inbox item exists (AC1, → Inbox via the live omitted-board default).
    const saved = await client.save({ url: "https://ext.example/a", title: "A" });
    assert.ok(saved.id, "save returned a created item id");
    assert.equal(handle.db.select().from(items).where(eq(items.id, saved.id)).get()!.boardId, "inbox");

    // assign() → board_id actually moved to the target (AC2, the one assign verb).
    const result = await client.assign(saved.id, "library");
    assert.deepEqual(result.assigned, [saved.id], "the live assign endpoint accepted the batch body and moved the item");
    assert.equal(handle.db.select().from(items).where(eq(items.id, saved.id)).get()!.boardId, "library");
  } finally {
    handle.sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// AC 2 — getSuggestion() GETs the authed read-only suggestion endpoint (14.3) and
// surfaces its {suggestedBoardId} shape (the input reviewAction consumes).
test("13.4: getSuggestion() GETs authed /api/v1/items/:id/suggestion", async () => {
  const { fetchFn, calls } = recordingFetch({ suggestedBoardId: "library" });
  const client = createBoardClient({ baseUrl: "https://board.example", token: "t", fetch: fetchFn });

  const out = await client.getSuggestion("it em/7"); // id is path-encoded

  assert.equal(calls[0].url, "https://board.example/api/v1/items/it%20em%2F7/suggestion");
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].headers.Authorization, "Bearer t");
  assert.deepEqual(out, { suggestedBoardId: "library" });
});

// AC 2 — listBoards() GETs the authed board list (feeds the manual picker fallback).
test("13.4: listBoards() GETs authed /api/v1/boards", async () => {
  const { fetchFn, calls } = recordingFetch([{ id: "library", name: "Library" }]);
  const client = createBoardClient({ baseUrl: "https://board.example", token: "t", fetch: fetchFn });

  const out = await client.listBoards();

  assert.equal(calls[0].url, "https://board.example/api/v1/boards");
  assert.equal(calls[0].headers.Authorization, "Bearer t");
  assert.deepEqual(out, [{ id: "library", name: "Library" }]);
});
