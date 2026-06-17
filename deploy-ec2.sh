#!/usr/bin/env bash
set -Eeuo pipefail

# Safe EC2 bootstrap/deploy script for Safety Auth.
# This script installs host dependencies and starts only the app stack:
# safety-auth, safety-web, nginx, postgres, redis.
#
# Required before running:
#   export SOURCE_REPO_URL="git@github.com:THtruelove-bai/Safety-project.git"
#   export SOURCE_BRANCH="phu"                              # optional
#   export APP_DIR="/opt/safety-project"                       # optional
#   export TAILSCALE_AUTHKEY="tskey-..."                       # optional
#   export WAZUH_MANAGER="<kali-tailscale-ip-or-hostname>"      # optional
#
# The script intentionally does not remove Docker volumes or application data.

APP_DIR="${APP_DIR:-/opt/safety-project}"
SOURCE_REPO_URL="${SOURCE_REPO_URL:-git@github.com:THtruelove-bai/Safety-project.git}"
SOURCE_BRANCH="${SOURCE_BRANCH:-phu}"
WAZUH_MANAGER="${WAZUH_MANAGER:-}"
TAILSCALE_AUTHKEY="${TAILSCALE_AUTHKEY:-}"

log() {
  printf '\n[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"
}

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    echo "Run this script as root or with sudo." >&2
    exit 1
  fi
}

install_base_packages() {
  log "Installing base packages"
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y \
    ca-certificates \
    curl \
    gnupg \
    git \
    lsb-release \
    rsync \
    unzip
}

install_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    log "Docker and Docker Compose plugin already installed"
    return
  fi

  log "Installing Docker Engine and Docker Compose plugin"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg

  . /etc/os-release
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list

  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y \
    docker-ce \
    docker-ce-cli \
    containerd.io \
    docker-buildx-plugin \
    docker-compose-plugin

  systemctl enable --now docker
}

install_tailscale() {
  if command -v tailscale >/dev/null 2>&1; then
    log "Tailscale already installed"
  else
    log "Installing Tailscale"
    curl -fsSL https://tailscale.com/install.sh | sh
  fi

  systemctl enable --now tailscaled

  if [ -n "$TAILSCALE_AUTHKEY" ]; then
    log "Bringing Tailscale up with auth key"
    tailscale up --authkey "$TAILSCALE_AUTHKEY" --hostname "${TAILSCALE_HOSTNAME:-safety-ec2}" --ssh
  else
    log "TAILSCALE_AUTHKEY not set. Run manually later: tailscale up --ssh"
  fi
}

install_wazuh_agent() {
  if dpkg -s wazuh-agent >/dev/null 2>&1; then
    log "Wazuh Agent already installed"
  else
    log "Installing Wazuh Agent"
    curl -sO https://packages.wazuh.com/4.x/apt/pool/main/w/wazuh-agent/wazuh-agent_4.12.0-1_amd64.deb
    if [ -n "$WAZUH_MANAGER" ]; then
      WAZUH_MANAGER="$WAZUH_MANAGER" dpkg -i ./wazuh-agent_4.12.0-1_amd64.deb
    else
      dpkg -i ./wazuh-agent_4.12.0-1_amd64.deb || apt-get -f install -y
      log "WAZUH_MANAGER not set. Configure /var/ossec/etc/ossec.conf with the Kali Tailscale IP before enabling logs."
    fi
    rm -f ./wazuh-agent_4.12.0-1_amd64.deb
  fi

  systemctl daemon-reload
  systemctl enable wazuh-agent
  if [ -n "$WAZUH_MANAGER" ]; then
    systemctl restart wazuh-agent
  fi
}

sync_source() {
  log "Preparing source in $APP_DIR"
  if [ -d "$APP_DIR/.git" ]; then
    git -C "$APP_DIR" fetch --all --prune
    git -C "$APP_DIR" checkout "$SOURCE_BRANCH"
    git -C "$APP_DIR" pull --ff-only origin "$SOURCE_BRANCH"
  else
    mkdir -p "$(dirname "$APP_DIR")"
    git clone --branch "$SOURCE_BRANCH" "$SOURCE_REPO_URL" "$APP_DIR"
  fi

  if [ ! -f "$APP_DIR/.env" ]; then
    echo "Missing $APP_DIR/.env. Copy the production .env before starting containers." >&2
    exit 1
  fi
}

start_stack() {
  log "Building and starting Safety app containers"
  cd "$APP_DIR"
  docker compose pull postgres redis nginx || true
  docker compose build safety-auth
  docker compose up -d postgres redis safety-auth safety-web nginx
  docker compose ps
}

main() {
  require_root
  install_base_packages
  install_docker
  install_tailscale
  install_wazuh_agent
  sync_source
  start_stack
  log "Deployment command completed"
}

main "$@"
