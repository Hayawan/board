import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyReply } from "fastify";
import fs from "node:fs";
import os from "node:os";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isAnalysisAgentId, type AnalysisAgentId } from "./add.js";
import {
  listCollections,
  getCollection,
  loadCollection,
  mutateCollection,
  type CollectionMeta,
} from "./storage.js";
import { config, ensureDataDir, type Config } from "./config.js";
import { getDb, type DbHandle } from "./db/index.js";
import { enqueueWrite, enqueueTransaction, reconcileInterruptedItems } from "./db/queue.js";
import { eq } from "drizzle-orm";
import { validateDescriptorProposal } from "./descriptor/guardrails.js";
import { patchItemFields, deleteItemWithAssets } from "./db/item-actions.js";
import { listBoardItemsForUi, getItemForUi } from "./db/hydrate.js";
import { renameBoard, deleteBoardCascade } from "./db/board-actions.js";
import { boards as boardsTable } from "./db/schema.js";
import { addItemSkill } from "./skills/add-item.js";
import { refetchItem, reenrichBoardItems } from "./enrichment/refetch.js";
import { createRegistry, registerAllSkills, type SkillRegistry } from "./skills/registry.js";
import { buildCtx, type JobQueue, type LLMProvider, type Logger } from "./skills/types.js";
import { selectProvider, describeProvider } from "./llm/select-provider.js";
import { disabledLlm } from "./skills/types.js";
import { startSseStream } from "./sse.js";
import { registerV1Api, sha256Hex } from "./api/v1.js";
import { buildBookmarklet, TOKEN_PLACEHOLDER } from "./capture-clients/bookmarklet.js";
import { captureRegistry, registerAllCaptureAdapters } from "./capture/adapter.js";
import { INSPIRATION_BOARD_ID, LIBRARY_BOARD_ID, INSPIRATION_DESCRIPTOR, LIBRARY_DESCRIPTOR, seed, updateBoardDescriptor } from "./db/seed.js";
import type { BoardDescriptor } from "./descriptor/types.js";

// Story 7.2: the seeded boards' descriptors, served on /api/collections for the
// frontend's generic field renderer.
const SEED_DESCRIPTORS: Record<string, BoardDescriptor> = {
  [INSPIRATION_BOARD_ID]: INSPIRATION_DESCRIPTOR,
  [LIBRARY_BOARD_ID]: LIBRARY_DESCRIPTOR,
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- Story 2.4: bind posture (localhost default + reverse-proxy guidance) ---

export interface ListenOptions {
  port: number;
  host: string;
}

/** The exact object server.ts passes to app.listen — the testable bind seam. */
export function getListenOptions(cfg: Config = config): ListenOptions {
  return { port: cfg.port, host: cfg.host };
}

const LOCAL_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

/**
 * Log a one-line warning when bound to a non-localhost address (AC 5) — the v1
 * safety net for an operator who exposes the port without reading the README,
 * given there is no built-in auth (reverse-proxy-only, AD7).
 */
export function warnIfExposed(opts: ListenOptions, logger: { warn: (m: string) => void } = console): void {
  if (!LOCAL_HOSTS.has(opts.host)) {
    logger.warn(
      `⚠  board-oss bound to ${opts.host}:${opts.port} — it ships no built-in auth. ` +
        `Ensure a reverse proxy (Caddy/Authelia/Tailscale) or firewall is in front.`,
    );
  }
}
const TAXONOMY_FILE = path.join(__dirname, "taxonomy.json");

interface Bookmark {
  id: string;
  url: string;
  added: string;
  screenshot: string | null;
  title: string;
  meta: {
    audience: string;
    form: string;
    domain: string | null;
    tier: string;
    tone: string[];
    tags: string[];
  };
  design: Record<string, string>;
  reflection: Record<string, string>;
  favorite?: boolean;
  favorite_reason?: string;
  analysis_agent?: AnalysisAgentId;
  analysis_model?: string | null;
}

type PatchBody = {
  reflection?: Record<string, string>;
  favorite?: boolean;
  favorite_reason?: string;
  notes?: string;
};

// --- Shared helpers ---

function resolveCollection(cid: string, reply: FastifyReply): CollectionMeta | null {
  try {
    return getCollection(cid);
  } catch {
    reply.status(400);
    return null;
  }
}

function spawnAddItem(
  opts: { cid: string; url: string; updateId?: string; instructions?: string; analysisAgent?: string },
  reply: FastifyReply
): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const resultDir = fs.mkdtempSync(path.join(os.tmpdir(), "board-result-"));
    const resultFile = path.join(resultDir, "item.json");
    const args = ["tsx", path.join(__dirname, "add.ts"), opts.url, "--collection", opts.cid];
    const env: NodeJS.ProcessEnv = { ...process.env, BOARD_RESULT_FILE: resultFile };
    if (opts.updateId) env.BOARD_UPDATE_ID = opts.updateId;
    if (opts.instructions) env.BOARD_INSTRUCTIONS = opts.instructions;
    if (opts.analysisAgent) env.BOARD_ANALYSIS_AGENT = opts.analysisAgent;

    const proc = spawn("npx", args, { cwd: __dirname, env });
    let stderr = "";
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("close", (code) => {
      try {
        if (code !== 0) {
          reply.status(500);
          resolve({ error: "Failed to process item", detail: stderr });
          return;
        }
        resolve(JSON.parse(fs.readFileSync(resultFile, "utf-8")));
      } catch (err) {
        reply.status(500);
        resolve({ error: "Failed to read result", detail: (err as Error).message });
      } finally {
        fs.rmSync(resultDir, { recursive: true, force: true });
      }
    });
  });
}

// Shared handler: GET items for a collection
function handleGetItems(cid: string, reply: FastifyReply): Record<string, unknown>[] | { error: string } {
  const col = resolveCollection(cid, reply);
  if (!col) return { error: `Unknown collection: "${cid}"` };
  return loadCollection<Record<string, unknown>>(cid);
}

// Shared handler: add item (spawn)
async function handleAddItem(
  cid: string,
  body: { url?: string; analysisAgent?: string },
  reply: FastifyReply
): Promise<Record<string, unknown>> {
  const col = resolveCollection(cid, reply);
  if (!col) return { error: `Unknown collection: "${cid}"` };
  const { url, analysisAgent } = body;
  if (!url) { reply.status(400); return { error: "url is required" }; }
  if (analysisAgent !== undefined && !isAnalysisAgentId(analysisAgent)) {
    reply.status(400);
    return { error: "invalid analysisAgent" };
  }
  return spawnAddItem({ cid, url, analysisAgent }, reply);
}

// Shared handler: patch item fields (allowlisted)
function handlePatchItem(
  cid: string,
  itemId: string,
  body: PatchBody,
  reply: FastifyReply
): Record<string, unknown> | { error: string } {
  const col = resolveCollection(cid, reply);
  if (!col) return { error: `Unknown collection: "${cid}"` };

  const updated = mutateCollection<Record<string, unknown>, Record<string, unknown> | undefined>(
    col.id,
    (items) => {
      const idx = items.findIndex((b) => b.id === itemId);
      if (idx === -1) return undefined;
      let item = { ...items[idx] };
      // reflection: object-merge; other allowlisted keys: direct set
      if (body.reflection !== undefined) {
        item.reflection = { ...(item.reflection as object ?? {}), ...body.reflection };
      }
      if (body.favorite !== undefined) item.favorite = body.favorite;
      if (body.favorite_reason !== undefined) item.favorite_reason = body.favorite_reason;
      if (body.notes !== undefined) item.notes = body.notes;
      items[idx] = item;
      return items[idx];
    }
  );

  if (!updated) { reply.status(404); return { error: "Not found" }; }
  return updated;
}

// Shared handler: delete item
function handleDeleteItem(
  cid: string,
  itemId: string,
  reply: FastifyReply,
  screenshotsDir: string
): null | { error: string } {
  const col = resolveCollection(cid, reply);
  if (!col) return { error: `Unknown collection: "${cid}"` };

  const removed = mutateCollection<Record<string, unknown>, Record<string, unknown> | undefined>(
    col.id,
    (items) => {
      const idx = items.findIndex((b) => b.id === itemId);
      if (idx === -1) return undefined;
      return items.splice(idx, 1)[0];
    }
  );

  if (!removed) { reply.status(404); return { error: "Not found" }; }

  // Only clean up screenshot files for visual (grid) collections. Story 2.2:
  // screenshots live under DATA_DIR/screenshots — resolve by basename there.
  if (col.view === "grid" && removed.screenshot) {
    const screenshotPath = path.join(screenshotsDir, path.basename(removed.screenshot as string));
    if (fs.existsSync(screenshotPath)) fs.unlinkSync(screenshotPath);
  }

  reply.status(204);
  return null;
}

// Shared handler: refetch item (spawn)
async function handleRefetchItem(
  cid: string,
  itemId: string,
  body: { instructions?: string; analysisAgent?: string },
  reply: FastifyReply
): Promise<Record<string, unknown>> {
  const col = resolveCollection(cid, reply);
  if (!col) return { error: `Unknown collection: "${cid}"` };
  const { analysisAgent } = body;
  if (analysisAgent !== undefined && !isAnalysisAgentId(analysisAgent)) {
    reply.status(400);
    return { error: "invalid analysisAgent" };
  }
  const item = loadCollection<Record<string, unknown>>(cid).find((b) => b.id === itemId);
  if (!item) { reply.status(404); return { error: "Not found" }; }
  return spawnAddItem({ cid, url: item.url as string, updateId: itemId, instructions: body.instructions, analysisAgent }, reply);
}

// Shared handler: upload screenshot (visual collections only)
function handleScreenshot(
  cid: string,
  itemId: string,
  body: { dataUrl?: string },
  reply: FastifyReply,
  screenshotsDir: string
): Record<string, unknown> | { error: string } | null {
  const col = resolveCollection(cid, reply);
  if (!col) return { error: `Unknown collection: "${cid}"` };

  if (col.view !== "grid") {
    reply.status(400);
    return { error: "screenshots not supported for this collection" };
  }

  const { dataUrl } = body;
  if (!dataUrl) { reply.status(400); return { error: "dataUrl is required" }; }

  const m = /^data:image\/[^;]+;base64,(.+)$/.exec(dataUrl);
  if (!m) { reply.status(400); return { error: "Invalid dataUrl" }; }
  const buf = Buffer.from(m[1], "base64");

  const updated = mutateCollection<Record<string, unknown>, Record<string, unknown> | undefined>(
    col.id,
    (items) => {
      const idx = items.findIndex((b) => b.id === itemId);
      if (idx === -1) return undefined;

      const relPath = (items[idx].screenshot as string | null) ?? `screenshots/${itemId}.png`;
      // Story 2.2: write under DATA_DIR/screenshots (by basename), not the app tree.
      const absPath = path.join(screenshotsDir, path.basename(relPath));
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, buf);

      if (!items[idx].screenshot) {
        items[idx] = { ...items[idx], screenshot: relPath };
      }

      return items[idx];
    }
  );

  if (!updated) { reply.status(404); return { error: "Not found" }; }
  return updated;
}

// --- Server factory ---

export interface BuildServerOptions {
  screenshotsDir?: string;
  /** Skill registry (Story 3.1 seam). Defaults to a fresh registry + registerAllSkills. */
  registry?: SkillRegistry;
  /** ctx collaborators — injectable for hermetic tests; production uses real defaults. */
  db?: DbHandle;
  queue?: JobQueue;
  logger?: Logger;
  llm?: LLMProvider;
  /**
   * Story 12.1 — plaintext bearer token for the `/api/v1` surface. Hashed here;
   * defaults to the configured `config.apiTokenHash`. Pass `null` to force the v1
   * surface fail-closed (no token). Accepting plaintext is a test-ergonomics seam
   * (the AC5 `buildServer({ apiToken })` example) — production reads from config.
   */
  apiToken?: string | null;
  /** Story 12.1 — CORS allowlist for `/api/v1`; defaults to `config.corsOrigins`. */
  corsOrigins?: string[];
}

export async function buildServer(opts: BuildServerOptions = {}) {
  // Story 2.2: screenshots resolve from DATA_DIR (config.screenshotsDir); tests
  // inject a temp dir so they never pollute the real data dir. The dir is created
  // at real boot via ensureDataDir() (the entrypoint), and handleScreenshot mkdirs
  // its write target — buildServer itself does not create dirs (so opt-less tests
  // don't materialize ./data).
  const screenshotsDir = opts.screenshotsDir ?? config.screenshotsDir;

  const app = Fastify({ logger: false, bodyLimit: 20 * 1024 * 1024 });

  await app.register(fastifyStatic, {
    root: __dirname,
    prefix: "/",
    index: false,
    serve: true,
  });

  // Screenshots now live OUTSIDE __dirname (under DATA_DIR), so the static root no
  // longer serves them. Stream them from screenshotsDir at the /screenshots/ prefix
  // the frontend still requests. A plain route (not a 2nd @fastify/static) avoids
  // the decorateReply double-registration crash and lets us guard path traversal.
  app.get<{ Params: { "*": string } }>("/screenshots/*", async (req, reply) => {
    const rel = path.basename(req.params["*"]); // basename → no traversal
    const abs = path.join(screenshotsDir, rel);
    if (!fs.existsSync(abs)) { reply.status(404); return { error: "Not found" }; }
    const ext = path.extname(abs).toLowerCase();
    const type =
      ext === ".png" ? "image/png" :
      ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" :
      ext === ".webp" ? "image/webp" : "application/octet-stream";
    reply.type(type);
    return reply.send(fs.createReadStream(abs));
  });

  // Story 5.3: live status stream (native SSE; poll fallback is the items API).
  // Optional ?boardId= scopes events to one board (the UI shows one at a time).
  app.get<{ Querystring: { boardId?: string } }>("/events", async (req, reply) => {
    startSseStream(req, reply, undefined, { boardId: req.query.boardId });
  });

  // Story 8.3: per-item curation actions on the SQLite store (board-agnostic, item
  // -scoped). PATCH only user-owned fields (notes/favorite/enrichable:false); DELETE
  // removes the item + asset rows + asset files. (REST, not skills — the v1 skill
  // list excludes these.) ctx.db is built lazily so opt-less callers never open the DB.
  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    "/api/items/:id",
    async (req, reply) => {
      const handle = opts.db ?? getDb();
      const updated = await patchItemFields(handle, req.params.id, (req.body ?? {}) as Record<string, unknown>);
      if (!updated) { reply.status(404); return { error: "Not found" }; }
      return updated;
    }
  );
  app.delete<{ Params: { id: string } }>("/api/items/:id", async (req, reply) => {
    const handle = opts.db ?? getDb();
    const res = await deleteItemWithAssets(handle, req.params.id, screenshotsDir);
    if (!res.deleted) { reply.status(404); return { error: "Not found" }; }
    reply.status(204);
    return null;
  });

  // Story 8.5/8.6: the authoritative provider-configured signal (Story 4.4) — true
  // when a real LLM transport is selected, false in no-AI mode. The frontend keys
  // the "enrichment disabled" dignified state + the first-run nudge off THIS, never
  // off field-emptiness (an enabled box can legitimately return empty).
  // `provider` is the configured provider's identity (or null) so the UI can label the
  // add button and list ONLY what's wired up — never a phantom agent. Derived from the
  // same config selectProvider used, so it can't disagree with `providerConfigured`.
  app.get("/api/meta", async () => ({
    providerConfigured: llm !== disabledLlm,
    provider: llm === disabledLlm ? null : describeProvider(config),
  }));

  // Board edit actions (the "Edit board" modal). Creation is via the compose-board /
  // create-board skills; these cover rename + delete-with-cascade.
  app.patch<{ Params: { id: string }; Body: { name?: string; descriptor?: unknown } }>(
    "/api/boards/:id",
    async (req, reply) => {
      const handle = opts.db ?? getDb();
      const hasName = typeof req.body?.name === "string";
      const hasDescriptor = req.body?.descriptor !== undefined;
      if (!hasName && !hasDescriptor) { reply.status(400); return { error: "name or descriptor required" }; }
      try {
        // Descriptor first. Run the SAME composer guardrails as create/compose
        // (reserved system-column keys, duplicate keys, field cap) — validateDescriptor
        // alone only checks closed types, which would let the editor create a `notes`/
        // `title` field that collides with a system column. Then persist (single-writer).
        if (hasDescriptor) {
          const check = validateDescriptorProposal(req.body!.descriptor, {});
          if (!check.ok) {
            reply.status(400);
            return { error: check.errors.map((e) => e.message).join("; "), errors: check.errors };
          }
          try {
            await enqueueTransaction(handle, () =>
              updateBoardDescriptor(handle.db, req.params.id, req.body!.descriptor as BoardDescriptor)
            );
          } catch (err) {
            const msg = (err as Error).message;
            reply.status(/unknown board/i.test(msg) ? 404 : 400);
            return { error: msg };
          }
        }
        if (hasName) {
          const name = (req.body!.name ?? "").trim();
          if (!name) { reply.status(400); return { error: "name is required" }; }
          await renameBoard(handle, req.params.id, name);
        }
        const b = handle.db.select().from(boardsTable).where(eq(boardsTable.id, req.params.id)).get();
        return { id: b?.id, name: b?.name, view: b?.view, descriptor: b?.descriptor };
      } catch (err) {
        reply.status(404);
        return { error: (err as Error).message };
      }
    }
  );
  app.delete<{ Params: { id: string } }>("/api/boards/:id", async (req, reply) => {
    const res = await deleteBoardCascade(opts.db ?? getDb(), req.params.id, screenshotsDir);
    if (!res.deleted) { reply.status(404); return { error: "Not found" }; }
    return res;
  });

  // Batch re-run AI over a board's items (after editing fields). Enrich-only (no
  // re-capture); fire-and-forget — SSE (Story 5.3) drives the live per-item updates.
  app.post<{ Params: { id: string } }>("/api/boards/:id/reenrich", async (req, reply) => {
    const handle = opts.db ?? getDb();
    const board = handle.db.select().from(boardsTable).where(eq(boardsTable.id, req.params.id)).get();
    if (!board) { reply.status(404); return { error: "Not found" }; }
    const { queued } = reenrichBoardItems(handle, { boardId: req.params.id, llm, registry: captureRegistry });
    return { queued };
  });

  // Story 11.1: PURE LIVENESS probe — a cheap 200 with NO DB check (a DB-reachable
  // check would make it a readiness probe that flaps during a WAL checkpoint / long
  // write → systemd restart loop). A DB-reachable check, if ever wanted, is a separate
  // /readyz. Used by the systemd unit + the container healthcheck (Story 11.2).
  app.get("/healthz", async () => ({ ok: true }));

  app.get("/", async (_req, reply) => reply.sendFile("index.html"));

  // Story 13.2 — the bookmarklet help surface. Read-only: it serves a small page that
  // builds a draggable `javascript:` bookmarklet client-side. The instance URL is
  // derived from the request (works behind a reverse proxy); the token is NEVER
  // supplied by the server (12.1 holds only the hash) — the page ships a placeholder
  // the operator replaces with their own BOARD_API_TOKEN in the browser.
  app.get("/bookmarklet", async (req, reply) => {
    // SECURITY: `Host` is attacker-controllable. Escape it for the HTML context and
    // embed all script-side strings with `<` → < so a malicious Host can neither
    // break out of <code> nor terminate the <script> via "</script>" (JSON.stringify
    // alone does NOT escape "/"). trustProxy is off, so req.protocol is socket-derived.
    const htmlEscape = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    const scriptJson = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");
    const host = req.headers.host ?? `${config.host}:${config.port}`;
    const instanceUrl = `${req.protocol}://${host}`;
    const template = buildBookmarklet({ instanceUrl, token: TOKEN_PLACEHOLDER });
    const tokenConfigured = config.apiTokenHash !== null;
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Board — Save bookmarklet</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:640px;margin:3rem auto;padding:0 1rem;color:#222}
input{width:100%;padding:.5rem;font:inherit;border:1px solid #ccc;border-radius:6px;box-sizing:border-box}
a.bm{display:inline-block;margin:1rem 0;padding:.6rem 1rem;background:#222;color:#fff;border-radius:8px;text-decoration:none}
code{background:#f3f3f3;padding:.1rem .3rem;border-radius:4px}.muted{color:#777;font-size:13px}</style>
</head><body>
<h1>Save to Board</h1>
<p>Paste your <code>BOARD_API_TOKEN</code>, then drag the button to your bookmarks bar. Clicking it on any page saves that tab to your Inbox.</p>
<input id="tok" type="text" placeholder="BOARD_API_TOKEN" autocomplete="off" spellcheck="false">
<p><a class="bm" id="bm" href="#">📥 Save to Board</a></p>
<p class="muted">Instance: <code>${htmlEscape(instanceUrl)}</code> · Server token configured: ${tokenConfigured ? "yes" : "no — set BOARD_API_TOKEN"}</p>
<p class="muted">Your token is filled in entirely in your browser; it is never sent to or stored by this page.</p>
<script>
var TEMPLATE=${scriptJson(template)},PH=${scriptJson(TOKEN_PLACEHOLDER)};
var a=document.getElementById('bm'),t=document.getElementById('tok');
function upd(){a.href=TEMPLATE.split(PH).join(t.value||PH);}
t.addEventListener('input',upd);upd();
</script>
</body></html>`;
    reply.type("text/html");
    return html;
  });

  // --- Collections manifest (SQLite-backed cutover) ---
  // Lists the SQLite board rows so composed boards (create-board) appear and deleted
  // boards disappear. `type` is derived (seeded ids keep their identity; composed
  // boards map by view) to pick the frontend's renderer + chrome. The seeded boards
  // exist because boot seeds them (server.ts entrypoint); tests inject a seeded db.
  app.get("/api/collections", async () => {
    const handle = opts.db ?? getDb();
    return handle.db.select().from(boardsTable).all().map((b) => ({
      id: b.id,
      name: b.name,
      view: b.view,
      type:
        b.id === INSPIRATION_BOARD_ID ? "inspiration"
        : b.id === LIBRARY_BOARD_ID ? "library"
        : b.view === "grid" ? "inspiration" : "library",
      descriptor: b.descriptor,
    }));
  });

  // --- Taxonomy (Inspiration vocabulary; unchanged) ---
  app.get("/api/taxonomy", async () =>
    JSON.parse(fs.readFileSync(TAXONOMY_FILE, "utf-8"))
  );

  // --- Collection-scoped item routes ---

  // Story 8.x CUTOVER: these are now SQLite-backed (the running app reads/writes the
  // SQLite store via the skills + item-actions built in Epics 1–10), presented to the
  // unchanged frontend renderers through the hydration adapter (db/hydrate). The
  // flat-JSON storage path is retired from the UI's data plane.

  app.get<{ Params: { cid: string } }>(
    "/api/collections/:cid/items",
    async (req) => listBoardItemsForUi(opts.db ?? getDb(), req.params.cid)
  );

  app.post<{ Params: { cid: string }; Body: { url?: string; analysisAgent?: string } }>(
    "/api/collections/:cid/items",
    async (req, reply) => {
      const url = (req.body?.url ?? "").trim();
      if (!url) { reply.status(400); return { error: "url is required" }; } // before getDb (no pollution)
      const handle = opts.db ?? getDb();
      const ctx = buildCtx({ db: handle, queue, logger, llm, boardId: req.params.cid });
      try {
        // add-item creates the pending item + (fire-and-forget) enqueues capture+enrich.
        const { itemId } = await addItemSkill.run({ boardId: req.params.cid, source: url }, ctx);
        // Return the optimistic pending item; SSE (Story 5.3) drives the live fill.
        return getItemForUi(handle, itemId) ?? { id: itemId, url, status: "pending" };
      } catch (err) {
        reply.status(400);
        return { error: (err as Error).message };
      }
    }
  );

  app.patch<{ Params: { cid: string; id: string }; Body: PatchBody }>(
    "/api/collections/:cid/items/:id",
    async (req, reply) => {
      const handle = opts.db ?? getDb();
      const updated = await patchItemFields(handle, req.params.id, (req.body ?? {}) as Record<string, unknown>);
      if (!updated) { reply.status(404); return { error: "Not found" }; }
      return getItemForUi(handle, req.params.id);
    }
  );

  app.delete<{ Params: { cid: string; id: string } }>(
    "/api/collections/:cid/items/:id",
    async (req, reply) => {
      const handle = opts.db ?? getDb();
      const res = await deleteItemWithAssets(handle, req.params.id, screenshotsDir);
      if (!res.deleted) { reply.status(404); return { error: "Not found" }; }
      reply.status(204);
      return null;
    }
  );

  app.post<{ Params: { cid: string; id: string }; Body: { instructions?: string; analysisAgent?: string } }>(
    "/api/collections/:cid/items/:id/refetch",
    async (req) => {
      const handle = opts.db ?? getDb();
      // Fire-and-forget refetch (capture+enrich); SSE drives the live update. Guarded
      // so an unknown-item rejection can't crash the worker (Story 7.3 review).
      void refetchItem(handle, { itemId: req.params.id, registry: captureRegistry, llm, screenshotsDir })
        .catch((e) => logger.error(`refetch "${req.params.id}" failed to start: ${(e as Error).message}`));
      return getItemForUi(handle, req.params.id) ?? { id: req.params.id, status: "processing" };
    }
  );

  // Manual screenshot upload stays on the legacy handler for now (the upload-asset
  // skill is the SQLite path; wiring the UI's replace-screenshot to it is a follow-up).
  app.post<{ Params: { cid: string; id: string }; Body: { dataUrl?: string } }>(
    "/api/collections/:cid/items/:id/screenshot",
    async (req, reply) => handleScreenshot(req.params.cid, req.params.id, req.body, reply, screenshotsDir)
  );

  // --- Legacy aliases (delegate to collection handlers with cid="inspiration") ---

  app.get("/api/bookmarks", async () => loadCollection<Bookmark>("inspiration"));

  app.post<{ Body: { url?: string; analysisAgent?: string } }>(
    "/api/add",
    async (req, reply) => handleAddItem("inspiration", req.body, reply)
  );

  app.patch<{ Params: { id: string }; Body: PatchBody }>(
    "/api/bookmarks/:id",
    async (req, reply) => handlePatchItem("inspiration", req.params.id, req.body, reply)
  );

  app.delete<{ Params: { id: string } }>(
    "/api/bookmarks/:id",
    async (req, reply) => handleDeleteItem("inspiration", req.params.id, reply, screenshotsDir)
  );

  app.post<{ Params: { id: string }; Body: { instructions?: string; analysisAgent?: string } }>(
    "/api/refetch/:id",
    async (req, reply) => handleRefetchItem("inspiration", req.params.id, req.body, reply)
  );

  app.post<{ Params: { id: string }; Body: { dataUrl?: string } }>(
    "/api/bookmarks/:id/screenshot",
    async (req, reply) => handleScreenshot("inspiration", req.params.id, req.body, reply, screenshotsDir)
  );

  // --- Story 3.2: the ONE generic skill-invocation route (AD11/FR-19) ---
  // Adding a capability = registering a Skill, not adding a bespoke route.
  const registry = opts.registry ?? (() => {
    const r = createRegistry();
    registerAllSkills(r);
    return r;
  })();
  const logger: Logger = opts.logger ?? console;
  const queue: JobQueue = opts.queue ?? { enqueueWrite };
  // Story 4.4: pick the transport from config (or disabledLlm = no-AI default).
  const llm: LLMProvider = opts.llm ?? selectProvider(config);

  app.post<{ Params: { name: string }; Body: unknown }>(
    "/skills/:name",
    async (req, reply) => {
      const skill = registry.get(req.params.name);
      if (!skill) {
        reply.status(404);
        return { error: `Unknown skill: "${req.params.name}"` };
      }

      // Input validation = 400 (client error); run is NOT called on failure.
      const parsedInput = skill.inputSchema.safeParse(req.body);
      if (!parsedInput.success) {
        reply.status(400);
        return { error: "Invalid skill input", issues: parsedInput.error.issues };
      }

      // ctx is built lazily here (per request) so opt-less buildServer() callers
      // that never hit /skills never open the real DB.
      // Only accept a real string boardId; a null/numeric/missing value → undefined
      // (don't coerce `null` to the string "null").
      const rawBoardId =
        req.body && typeof req.body === "object"
          ? (req.body as { boardId?: unknown }).boardId
          : undefined;
      const boardId = typeof rawBoardId === "string" && rawBoardId.length > 0 ? rawBoardId : undefined;
      const ctx = buildCtx({ db: opts.db ?? getDb(), queue, logger, llm, boardId });

      let result: unknown;
      try {
        result = await skill.run(parsedInput.data, ctx);
      } catch (err) {
        // Skill bug / runtime failure = 500. Log server-side; never leak the
        // stack/message to the client body.
        logger.error(`skill "${skill.name}" threw: ${(err as Error).message}`);
        reply.status(500);
        return { error: "Skill execution failed" };
      }

      // Output validation = 500 (the skill is broken, distinct from the 400 case).
      const parsedOutput = skill.outputSchema.safeParse(result);
      if (!parsedOutput.success) {
        logger.error(`skill "${skill.name}" produced invalid output`);
        reply.status(500);
        return { error: "Skill produced invalid output" };
      }
      return parsedOutput.data;
    }
  );

  // Story 12.1 — the encapsulated /api/v1 surface (bearer guard + CORS). Registered
  // as a prefixed plugin so its hook/CORS apply ONLY to v1 routes (NFR-BC). The token
  // is injectable for hermetic tests; production defaults to the configured hash.
  // undefined → use the configured hash; any falsy-but-defined value ("" or null) →
  // fail-closed null; otherwise hash the injected plaintext.
  const apiTokenHash =
    opts.apiToken === undefined
      ? config.apiTokenHash
      : opts.apiToken
        ? sha256Hex(opts.apiToken)
        : null;
  await registerV1Api(app, {
    apiTokenHash,
    corsOrigins: opts.corsOrigins ?? config.corsOrigins,
    // Story 12.2 — CRUD collaborators. resolveDb is lazy (opts.db ?? getDb()) so
    // opt-less callers/tests never open the real DB; queue/logger/llm are the same
    // instances the rest of the app uses (one store, one set of helpers — NFR-BC).
    resolveDb: () => opts.db ?? getDb(),
    queue,
    logger,
    llm,
    screenshotsDir,
  });

  return app;
}

// Entrypoint guard — only listen when run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  ensureDataDir(); // Story 2.2: create DATA_DIR + screenshots on real boot (AC 2)
  // Story 1.2/8.6: idempotently seed the boards on EVERY boot so a fresh DATA_DIR
  // (container / LXC first-run) has the Inspiration + Library boards — without this,
  // zero-config first-run (UJ-3/SM-1) and any add-item/capture 500 with "unknown board".
  seed(getDb().db);
  // Story 5.2: sweep items orphaned in `processing` by a crash/OOM before serving.
  reconcileInterruptedItems(getDb());
  // Story 6.1: register capture adapters (6.2–6.4 populate the registry).
  registerAllCaptureAdapters(captureRegistry);
  const app = await buildServer();
  // Story 2.4: bind is config-driven; default HOST (2.1) is 127.0.0.1 (secure
  // default — only an explicit non-empty HOST exposes it).
  const listenOpts = getListenOptions();
  warnIfExposed(listenOpts);
  await app.listen(listenOpts);
  console.log(`🎨  Board running at http://${listenOpts.host}:${listenOpts.port}`);
}
