import cors from "@fastify/cors";
import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";

// Story 12.1 — the encapsulated `/api/v1` surface: a static bearer-token guard +
// CORS, both scoped to this plugin's routes only. Registering with a prefix gives
// Fastify-level encapsulation: the onRequest hook and CORS added INSIDE this plugin
// cannot reach the root app's routes (SPA, legacy /api/bookmarks, /api/collections,
// /skills). That structural boundary is how NFR-BC is guaranteed, not merely intended.
//
// 12.2 registers the CRUD routes inside this same plugin (behind this guard). 12.1
// ships a trivial GET /api/v1/ping probe so the surface is testable before CRUD lands.

export interface V1Options {
  /** SHA-256 hash (hex) of the configured bearer token, or null when unconfigured. */
  apiTokenHash: string | null;
  /** Allowlisted cross-origin origins; empty = no cross-origin allowed. */
  corsOrigins: string[];
}

/** SHA-256 hex of a string. Exported so the server can hash an injected test token. */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Extract the token from an `Authorization: Bearer <token>` header, or null.
 * The scheme match is case-insensitive (RFC 7235 auth schemes are case-insensitive);
 * the token itself is not whitespace-normalized (an exact-match secret).
 */
function extractBearer(header: string | undefined): string | null {
  if (typeof header !== "string") return null;
  const match = /^Bearer (.+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

/**
 * Constant-time compare of two SHA-256 hex digests. Both are fixed-length (64
 * chars), so the buffers are always equal length — no length-based early exit,
 * no timing oracle. Returns false if either side is missing.
 */
function hashesMatch(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Register the encapsulated `/api/v1` plugin on `app`. The bearer guard + CORS live
 * inside the prefixed child context, so they apply to v1 routes only.
 */
export async function registerV1Api(app: FastifyInstance, opts: V1Options): Promise<void> {
  await app.register(
    async (v1) => {
      // CORS scoped to v1 only. Empty allowlist → `origin: false` (no cross-origin).
      await v1.register(cors, {
        origin: opts.corsOrigins.length > 0 ? opts.corsOrigins : false,
      });

      // Bearer guard. Fail-closed: if no token is configured, the v1 surface rejects
      // everything (you cannot authenticate against an unset secret).
      v1.addHook("onRequest", async (req, reply) => {
        const provided = extractBearer(req.headers.authorization);
        const providedHash = provided ? sha256Hex(provided) : null;
        if (!hashesMatch(providedHash, opts.apiTokenHash)) {
          reply.code(401).send({ error: "Unauthorized" });
          return reply; // short-circuit — the route handler never runs
        }
      });

      // Trivial liveness probe so 12.1 has a guarded target (12.2 adds CRUD here).
      v1.get("/ping", async () => ({ ok: true }));
    },
    { prefix: "/api/v1" },
  );
}
