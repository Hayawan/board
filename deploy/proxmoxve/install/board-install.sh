#!/usr/bin/env bash

# Copyright (c) 2021-2026 community-scripts ORG
# Author: Hayawan (Hayawan)
# License: MIT | https://github.com/community-scripts/ProxmoxVED/raw/main/LICENSE
# Source: https://github.com/Hayawan/board

source /dev/stdin <<<"$FUNCTIONS_FILE_PATH"
color
verb_ip6
catch_errors
setting_up_container
network_check
update_os

msg_info "Installing Dependencies"
$STD apt install -y \
  build-essential \
  python3 \
  chromium
msg_ok "Installed Dependencies"

NODE_VERSION="22" setup_nodejs

fetch_and_deploy_gh_release "board" "Hayawan/board" "tarball"

msg_info "Installing Board"
cd /opt/board
$STD npm ci --omit=dev
mkdir -p /opt/board/data
msg_ok "Installed Board"

msg_info "Creating Configuration"
cat <<EOF >/opt/board/.env
PORT=3141
HOST=0.0.0.0
DATA_DIR=/opt/board/data
# Board runs fully WITHOUT AI by default. To enable enrichment, set ONE provider
# below and restart the service (systemctl restart board):
#   Local coding CLI:  LLM_AGENT=claude        # or codex
#   OpenAI-compatible: LLM_BASE_URL=https://api.openai.com/v1
#                      LLM_MODEL=gpt-4o
#                      LLM_API_KEY=sk-...
EOF
msg_ok "Created Configuration"

msg_info "Creating Service"
cat <<EOF >/etc/systemd/system/board.service
[Unit]
Description=Board Service
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/board
EnvironmentFile=/opt/board/.env
ExecStart=/usr/bin/env node --import tsx src/server.ts
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
systemctl enable -q --now board
msg_ok "Created Service"

motd_ssh
customize
cleanup_lxc
