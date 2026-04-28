#!/usr/bin/env bash
# war-room.sh — local installer & manager for war-room v4
# Usage: ./war-room.sh [install|start|stop|restart|status|logs|update|uninstall]
#
# This script stays OUT of the git repo (add it to .gitignore if you copy it elsewhere).
# The actual project lives at: https://github.com/kwasikontor45/war-room

set -e

REPO_URL="git@github.com:kwasikontor45/war-room.git"
INSTALL_DIR="${HOME}/war-room"
COMPOSE="docker compose"

CYAN='\033[0;36m'; BOLD='\033[1m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; RESET='\033[0m'
log()  { echo -e "  ${GREEN}✓${RESET}  $1"; }
warn() { echo -e "  ${YELLOW}⚠${RESET}  $1"; }
err()  { echo -e "  ${RED}✗${RESET}  $1"; exit 1; }
ask()  { echo -e -n "  ${CYAN}?${RESET}  $1: "; }

# ── helpers ───────────────────────────────────

check_docker() {
  command -v docker >/dev/null 2>&1 || err "docker not found — install from https://docs.docker.com/engine/install"
  command -v git >/dev/null 2>&1  || err "git not found — install git first"
}

env_path() { echo "${INSTALL_DIR}/server/.env"; }

ensure_installed() {
  [ -d "${INSTALL_DIR}/.git" ] || err "war-room not installed. Run: ./war-room.sh install"
}

# ── commands ──────────────────────────────────

cmd_install() {
  echo -e "\n${CYAN}${BOLD}  WAR-ROOM v4${RESET}  installer\n"
  check_docker

  if [ -d "${INSTALL_DIR}/.git" ]; then
    warn "war-room already exists at ${INSTALL_DIR}"
    ask "Re-install from GitHub? This keeps server/.env but resets code. [y/N]"
    read -r CONFIRM
    if [[ "$CONFIRM" =~ ^[Yy]$ ]]; then
      cd "${INSTALL_DIR}"
      git fetch origin
      git reset --hard origin/main
      log "code reset to origin/main"
    else
      log "skipping clone"
    fi
  else
    log "cloning ${REPO_URL} → ${INSTALL_DIR}"
    git clone "${REPO_URL}" "${INSTALL_DIR}"
    log "clone complete"
  fi

  cd "${INSTALL_DIR}"

  # create .env if missing
  ENV_FILE=$(env_path)
  if [ ! -f "$ENV_FILE" ]; then
    cp server/.env.example "$ENV_FILE"
    log "created server/.env from example"
  else
    log "server/.env already exists (preserved)"
  fi

  # prompt for keys if .env is fresh
  if [ -f "$ENV_FILE" ] && ! grep -qE '^ANTHROPIC_API_KEY=.|^OPENAI_API_KEY=.|^MOONSHOT_API_KEY=.' "$ENV_FILE"; then
    echo -e "\n${BOLD}  api keys${RESET}  (leave blank to skip any seat)\n"
    ask "anthropic  →  architect  (claude)";   read -rs K; echo; [ -n "$K" ] && sed -i "s|ANTHROPIC_API_KEY=|ANTHROPIC_API_KEY=$K|" "$ENV_FILE" && log "architect ready"    || warn "architect offline"
    ask "moonshot   →  engineer   (kimi)";     read -rs K; echo; [ -n "$K" ] && sed -i "s|MOONSHOT_API_KEY=|MOONSHOT_API_KEY=$K|" "$ENV_FILE" && log "engineer ready"     || warn "engineer offline"
    ask "google     →  psychologist (gemini)"; read -rs K; echo; [ -n "$K" ] && sed -i "s|GOOGLE_API_KEY=|GOOGLE_API_KEY=$K|" "$ENV_FILE" && log "psychologist ready" || warn "psychologist offline"
    ask "openai     →  wild-card  (chatgpt)";  read -rs K; echo; [ -n "$K" ] && sed -i "s|OPENAI_API_KEY=|OPENAI_API_KEY=$K|" "$ENV_FILE" && log "wild-card ready"    || warn "wild-card offline"
  fi

  # docker setup
  mkdir -p server/output server/ssh-keys
  echo -e "\n${BOLD}  building…${RESET}"
  ${COMPOSE} build --quiet 2>/dev/null || docker-compose build --quiet
  log "build complete"

  echo -e "\n  ${CYAN}${BOLD}war-room v4 installed${RESET}"
  echo -e "  directory  →  ${INSTALL_DIR}"
  echo -e "  env file   →  ${INSTALL_DIR}/server/.env"
  echo -e "  start      →  ./war-room.sh start"
  echo -e "  uninstall  →  ./war-room.sh uninstall\n"
}

cmd_start() {
  ensure_installed
  cd "${INSTALL_DIR}"
  ${COMPOSE} up -d 2>/dev/null || docker-compose up -d
  log "war-room started"
  sleep 1
  cmd_status
}

cmd_stop() {
  ensure_installed
  cd "${INSTALL_DIR}"
  ${COMPOSE} down 2>/dev/null || docker-compose down
  log "war-room stopped"
}

cmd_restart() {
  cmd_stop
  cmd_start
}

cmd_status() {
  ensure_installed
  cd "${INSTALL_DIR}"

  echo -e "\n${BOLD}  containers${RESET}"
  ${COMPOSE} ps 2>/dev/null || docker-compose ps || true

  echo -e "\n${BOLD}  seats configured${RESET}"
  ENV_FILE=$(env_path)
  for key in ANTHROPIC_API_KEY MOONSHOT_API_KEY GOOGLE_API_KEY OPENAI_API_KEY; do
    val=$(grep "^${key}=" "$ENV_FILE" 2>/dev/null | cut -d= -f2-)
    label="${key%_API_KEY}"
    if [ -n "$val" ]; then
      log "${label}: configured"
    else
      warn "${label}: NOT SET"
    fi
  done

  echo -e "\n${BOLD}  endpoints${RESET}"
  echo -e "  client  →  http://localhost:8080"
  echo -e "  server  →  http://localhost:3000"
  echo -e "  health  →  http://localhost:3000/api/health\n"
}

cmd_logs() {
  ensure_installed
  cd "${INSTALL_DIR}"
  ${COMPOSE} logs -f 2>/dev/null || docker-compose logs -f
}

cmd_update() {
  ensure_installed
  cd "${INSTALL_DIR}"
  log "pulling latest from GitHub…"
  git pull origin main
  log "rebuilding…"
  ${COMPOSE} build --quiet 2>/dev/null || docker-compose build --quiet
  log "restart to apply updates: ./war-room.sh restart"
}

cmd_uninstall() {
  if [ ! -d "${INSTALL_DIR}/.git" ]; then
    warn "nothing to uninstall at ${INSTALL_DIR}"
    return
  fi

  echo -e "\n${RED}${BOLD}  UNINSTALL WAR-ROOM${RESET}\n"
  warn "This will remove:"
  echo "    - docker containers & images"
  echo "    - server output files"
  echo "    - the entire ${INSTALL_DIR} directory"
  echo ""
  ask "Type 'DELETE' to confirm"
  read -r CONFIRM
  [ "$CONFIRM" = "DELETE" ] || { log "cancelled"; exit 0; }

  cd "${INSTALL_DIR}"
  ${COMPOSE} down --volumes --rmi all 2>/dev/null || docker-compose down --volumes --rmi all || true
  cd "${HOME}"
  rm -rf "${INSTALL_DIR}"
  log "war-room removed"
}

cmd_help() {
  echo -e "\n${CYAN}${BOLD}  war-room.sh${RESET}  local manager\n"
  echo "  install      clone repo, create .env, build docker"
  echo "  start        launch containers"
  echo "  stop         stop containers"
  echo "  restart      stop + start"
  echo "  status       show containers & configured seats"
  echo "  logs         tail docker logs"
  echo "  update       pull latest code & rebuild"
  echo "  uninstall    DELETE everything (irreversible)"
  echo ""
}

# ── main ──────────────────────────────────────

case "${1:-help}" in
  install)    cmd_install ;;
  start)      cmd_start ;;
  stop)       cmd_stop ;;
  restart)    cmd_restart ;;
  status)     cmd_status ;;
  logs)       cmd_logs ;;
  update)     cmd_update ;;
  uninstall)  cmd_uninstall ;;
  *)          cmd_help ;;
esac
