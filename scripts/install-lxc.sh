#!/usr/bin/env bash
#
# board-oss one-command install for a Debian LXC (Story 11.1, community-scripts.org
# norms). Run as root on a fresh Debian container, from the repo root:
#
#     sudo bash scripts/install-lxc.sh
#
# Installs Node LTS + chromium, creates a non-root service user, installs the app to
# /opt/board-oss with a persistent DATA_DIR at /var/lib/board-oss, installs + starts
# the systemd unit, and waits for /healthz. Idempotent where practical.
set -euo pipefail

APP_USER="${APP_USER:-boardoss}"
APP_DIR="${APP_DIR:-/opt/board-oss}"
DATA_DIR="${DATA_DIR:-/var/lib/board-oss}"
PORT="${PORT:-8080}"
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [ "$(id -u)" -ne 0 ]; then echo "Run as root (sudo)." >&2; exit 1; fi

echo "==> Installing Node LTS + chromium"
apt-get update -y
# Debian's `chromium` package (NOT Ubuntu's snap `chromium-browser`) declares its own
# lib deps, so a bare install suffices for headless launch.
apt-get install -y curl ca-certificates chromium
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -
  apt-get install -y nodejs
fi
# better-sqlite3 ships prebuilds for glibc Linux / Node LTS (usually no compile). If a
# from-source build IS needed, uncomment: apt-get install -y build-essential python3

echo "==> Creating non-root service user: $APP_USER"
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"

echo "==> Installing app to $APP_DIR"
mkdir -p "$APP_DIR"
if [ "$SRC_DIR" != "$APP_DIR" ]; then
  # copy the repo (excluding any local data/ and node_modules) into the app dir
  tar --exclude=./node_modules --exclude=./data --exclude=./.git -C "$SRC_DIR" -cf - . | tar -C "$APP_DIR" -xf -
fi
cd "$APP_DIR"
npm ci --omit=dev

echo "==> Persistent DATA_DIR: $DATA_DIR"
mkdir -p "$DATA_DIR"
chown -R "$APP_USER:$APP_USER" "$APP_DIR" "$DATA_DIR"

echo "==> Installing + starting the systemd unit"
install -m 644 "$APP_DIR/deploy/board-oss.service" /etc/systemd/system/board-oss.service
# Substitute the tunables into the installed unit so PORT/DATA_DIR/APP_DIR overrides
# actually take effect (otherwise the unit's hardcoded defaults diverge from the
# script's poll → a false "unhealthy" at the end). The unit's defaults are the
# substitution anchors; sed is global so DATA_DIR also updates HOME/XDG/ReadWritePaths.
UNIT=/etc/systemd/system/board-oss.service
sed -i \
  -e "s#/opt/board-oss#${APP_DIR}#g" \
  -e "s#/var/lib/board-oss#${DATA_DIR}#g" \
  -e "s#PORT=8080#PORT=${PORT}#g" \
  "$UNIT"
systemctl daemon-reload
systemctl enable --now board-oss

echo "==> Waiting for /healthz on 127.0.0.1:${PORT}"
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${PORT}/healthz" >/dev/null 2>&1; then
    echo "✅ board-oss is up. Put a reverse proxy (Caddy/Authelia/Tailscale) in front of 127.0.0.1:${PORT}."
    exit 0
  fi
  sleep 1
done
echo "❌ board-oss did not become healthy; check: journalctl -u board-oss -n 50" >&2
exit 1
