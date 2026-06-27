# board-oss container image (Story 11.2).
#
# Debian-slim / glibc base for BOTH stages — NOT Alpine/musl: better-sqlite3's
# compiled .node + system chromium on musl is an ABI/build minefield, and a
# glibc-builder / musl-runtime mismatch makes the native module fail to load.
# Multi-stage: a fat builder resolves deps (incl. any better-sqlite3 from-source
# fallback); a slim runtime carries node_modules + the app + apt chromium.

# ---- builder ----------------------------------------------------------------
FROM node:22-bookworm-slim AS builder
WORKDIR /app
# Build deps only here (better-sqlite3 ships glibc prebuilds, so this is usually a
# no-op fetch; present so a from-source fallback still succeeds in the builder).
RUN apt-get update && apt-get install -y --no-install-recommends python3 build-essential \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# Runtime deps only (tsx + typescript are runtime deps — Story 11.1 — so the app runs
# via `node --import tsx src/server.ts` with no build step).
RUN npm ci --omit=dev

# ---- runtime ----------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

# System chromium (Debian package — declares its own lib deps) + curl for HEALTHCHECK.
RUN apt-get update && apt-get install -y --no-install-recommends chromium curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/node_modules ./node_modules
COPY . .

# Env (Epic 2 seam). HOST=0.0.0.0 is the ONE acceptable place to bind broadly: the
# container boundary is the isolation and the host/reverse-proxy controls the published
# port. Story 2.4's boot warning STILL FIRES by design (do NOT suppress it — it warns
# the operator who publishes the port without a proxy).
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    DATA_DIR=/data \
    CHROME_PATH=/usr/bin/chromium \
    HOME=/home/boardoss \
    XDG_CONFIG_HOME=/home/boardoss/.config \
    XDG_CACHE_HOME=/home/boardoss/.cache

# Non-root user with a writable $HOME (headless chromium needs a writable user-data-dir
# or it crashes with a profile-lock error) and a chowned /data volume. root +
# --no-sandbox is the genuinely dangerous combo (NFR-3) — so we run non-root.
RUN useradd --system --create-home --home-dir /home/boardoss boardoss \
  && mkdir -p /data \
  && chown -R boardoss:boardoss /data /home/boardoss /app

USER boardoss
VOLUME /data
EXPOSE 8080

# Liveness probe (Story 11.1 /healthz — pure, no DB).
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/healthz" || exit 1

# Chromium-in-container uses the no-sandbox launch args already set in Story 6.2
# (--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage) — no --privileged
# / SYS_ADMIN needed.
CMD ["node", "--import", "tsx", "src/server.ts"]
