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
import { enqueueWrite } from "./db/queue.js";
import { createRegistry, registerAllSkills, type SkillRegistry } from "./skills/registry.js";
import { buildCtx, type JobQueue, type LLMProvider, type Logger } from "./skills/types.js";
import { selectProvider } from "./llm/select-provider.js";

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
    async (req, reply) => handleDeleteItem(req.params.cid, req.params.id, reply, screenshotsDir)
  );

  app.post<{ Params: { cid: string; id: string }; Body: { instructions?: string; analysisAgent?: string } }>(
    "/api/collections/:cid/items/:id/refetch",
    async (req, reply) => handleRefetchItem(req.params.cid, req.params.id, req.body, reply)
  );

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

  return app;
}

// Entrypoint guard — only listen when run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  ensureDataDir(); // Story 2.2: create DATA_DIR + screenshots on real boot (AC 2)
  const app = await buildServer();
  // Story 2.4: bind is config-driven; default HOST (2.1) is 127.0.0.1 (secure
  // default — only an explicit non-empty HOST exposes it).
  const listenOpts = getListenOptions();
  warnIfExposed(listenOpts);
  await app.listen(listenOpts);
  console.log(`🎨  Board running at http://${listenOpts.host}:${listenOpts.port}`);
}
