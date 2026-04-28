#!/usr/bin/env bash
set -e
CYAN='\033[0;36m';BOLD='\033[1m';GREEN='\033[0;32m';YELLOW='\033[1;33m';RED='\033[0;31m';RESET='\033[0m'
log()  { echo -e "  ${GREEN}✓${RESET}  $1"; }
warn() { echo -e "  ${YELLOW}⚠${RESET}  $1"; }
err()  { echo -e "  ${RED}✗${RESET}  $1"; exit 1; }
ask()  { echo -e -n "  ${CYAN}?${RESET}  $1: "; }

echo -e "\n${CYAN}${BOLD}  WAR-ROOM v4${RESET}  four seats. scoped bash. real devops.\n"

command -v docker >/dev/null 2>&1 || err "docker not found — https://docs.docker.com/engine/install"
log "docker: $(docker --version | cut -d' ' -f3 | tr -d ',')"

echo -e "\n${BOLD}  api keys${RESET}  (leave blank to skip any seat)\n"
ENV="./server/.env"; cp ./server/.env.example "$ENV"

ask "anthropic  →  architect  (claude)";   read -rs K; echo; [ -n "$K" ] && sed -i "s|ANTHROPIC_API_KEY=|ANTHROPIC_API_KEY=$K|" "$ENV" && log "architect ready" || warn "architect offline"
ask "moonshot   →  engineer   (kimi)";     read -rs K; echo; [ -n "$K" ] && sed -i "s|MOONSHOT_API_KEY=|MOONSHOT_API_KEY=$K|" "$ENV" && log "engineer ready" || warn "engineer offline"
ask "google     →  psychologist (gemini)"; read -rs K; echo; [ -n "$K" ] && sed -i "s|GOOGLE_API_KEY=|GOOGLE_API_KEY=$K|" "$ENV" && log "psychologist ready" || warn "psychologist offline"
ask "openai     →  wild-card  (chatgpt)";  read -rs K; echo; [ -n "$K" ] && sed -i "s|OPENAI_API_KEY=|OPENAI_API_KEY=$K|" "$ENV" && log "wild-card ready" || warn "wild-card offline"

echo ""; ask "port [3000]"; read P; PORT=${P:-3000}; sed -i "s|PORT=3000|PORT=$PORT|" "$ENV"

mkdir -p ./output ./ssh-keys

echo -e "\n${BOLD}  building…${RESET}"
docker compose build --quiet
log "build complete"

docker compose up -d
log "war-room running"

sleep 2
HEALTH=$(curl -sf http://localhost:$PORT/api/health 2>/dev/null || echo "unreachable")
echo -e "  health: $HEALTH"

echo -e "\n  ${CYAN}${BOLD}war-room v4 is live${RESET}"
echo -e "  client     →  http://localhost:8080"
echo -e "  server     →  http://localhost:$PORT"
echo -e "  output     →  ./output/  (git repos, one per session)"
echo -e "  ssh keys   →  ./ssh-keys/  (drop .pem files here)"
echo -e ""
echo -e "  seat scopes:"
echo -e "  ${GREEN}architect${RESET}    read-only: inspect, analyze, document"
echo -e "  ${CYAN}engineer${RESET}     full devops: build, deploy, ssh, docker"
echo -e "  ${YELLOW}psychologist${RESET} observational: logs, metrics, health checks"
echo -e "  ${GREEN}wild-card${RESET}   experimental: broad access, document everything"
echo -e ""
echo -e "  ${YELLOW}stop:${RESET}      docker compose down"
echo -e "  ${YELLOW}update:${RESET}    git pull && docker compose build && docker compose up -d\n"
