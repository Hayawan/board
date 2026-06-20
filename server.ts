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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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
  reply: FastifyReply
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

  // Only clean up screenshot files for visual (grid) collections
  if (col.view === "grid" && removed.screenshot) {
    const screenshotPath = path.join(__dirname, removed.screenshot as string);
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
  reply: FastifyReply
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
      const absPath = path.join(__dirname, relPath);
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

export async function buildServer() {
  const app = Fastify({ logger: false, bodyLimit: 20 * 1024 * 1024 });

  await app.register(fastifyStatic, {
    root: __dirname,
    prefix: "/",
    index: false,
    serve: true,
  });

  app.get("/", async (_req, reply) => reply.sendFile("index.html"));

  // --- Collections manifest ---
  app.get("/api/collections", async () => listCollections());

  // --- Taxonomy (Inspiration vocabulary; unchanged) ---
  app.get("/api/taxonomy", async () =>
    JSON.parse(fs.readFileSync(TAXONOMY_FILE, "utf-8"))
  );

  // --- Collection-scoped item routes ---

  app.get<{ Params: { cid: string } }>(
    "/api/collections/:cid/items",
    async (req, reply) => handleGetItems(req.params.cid, reply)
  );

  app.post<{ Params: { cid: string }; Body: { url?: string; analysisAgent?: string } }>(
    "/api/collections/:cid/items",
    async (req, reply) => handleAddItem(req.params.cid, req.body, reply)
  );

  app.patch<{ Params: { cid: string; id: string }; Body: PatchBody }>(
    "/api/collections/:cid/items/:id",
    async (req, reply) => handlePatchItem(req.params.cid, req.params.id, req.body, reply)
  );

  app.delete<{ Params: { cid: string; id: string } }>(
    "/api/collections/:cid/items/:id",
    async (req, reply) => handleDeleteItem(req.params.cid, req.params.id, reply)
  );

  app.post<{ Params: { cid: string; id: string }; Body: { instructions?: string; analysisAgent?: string } }>(
    "/api/collections/:cid/items/:id/refetch",
    async (req, reply) => handleRefetchItem(req.params.cid, req.params.id, req.body, reply)
  );

  app.post<{ Params: { cid: string; id: string }; Body: { dataUrl?: string } }>(
    "/api/collections/:cid/items/:id/screenshot",
    async (req, reply) => handleScreenshot(req.params.cid, req.params.id, req.body, reply)
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
    async (req, reply) => handleDeleteItem("inspiration", req.params.id, reply)
  );

  app.post<{ Params: { id: string }; Body: { instructions?: string; analysisAgent?: string } }>(
    "/api/refetch/:id",
    async (req, reply) => handleRefetchItem("inspiration", req.params.id, req.body, reply)
  );

  app.post<{ Params: { id: string }; Body: { dataUrl?: string } }>(
    "/api/bookmarks/:id/screenshot",
    async (req, reply) => handleScreenshot("inspiration", req.params.id, req.body, reply)
  );

  return app;
}

// Entrypoint guard — only listen when run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await buildServer();
  await app.listen({ port: 3141, host: "127.0.0.1" });
  console.log("🎨  Board running at http://localhost:3141");
}
