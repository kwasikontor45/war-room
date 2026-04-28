# war-room v4

Four-seat agentic devops system. Drop a brief — architect, engineer, psychologist, and wild-card argue their way to a production plan across five phases.

**Seats:**
- `architect` — Claude (Anthropic)
- `engineer` — Kimi (Moonshot)
- `psychologist` — Gemini (Google)
- `wild-card` — GPT-4o (OpenAI)

**Phases:** propose → architect → implement → review → ship

**Live server:** `https://war-room-kwasikontor.fly.dev`

---

## local setup

**Quick start with the manager script:**
```bash
git clone git@github.com:kwasikontor45/war-room.git ~/war-room
cd ~/war-room
./war-room.sh install
./war-room.sh start
```

**Or manual setup:**
```bash
git clone git@github.com:kwasikontor45/war-room.git
cd war-room
npm install --prefix server
cp server/.env.example server/.env
```

Fill in `server/.env` with your API keys:
```
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-proj-...
MOONSHOT_API_KEY=sk-...
GOOGLE_API_KEY=AIza...
```

Any seat without a key goes offline gracefully — you can run with just one.

**Start the server:**
```bash
cd server && npm run dev       # runs at localhost:3000
# or use the manager: ./war-room.sh start
```

**Use the standalone UI:**
Open `client/index.html` directly in your browser. Full four-seat war-room with SSE streaming.

**Use via kwasikontor.dev locally:**
In `~/kwasikontor-dev` (or `~/war-site/kwasikontor-dev`), create `.env.local`:
```
VITE_WAR_ROOM_API=http://localhost:3000/api
```
Then `npm run dev` in the website project. Type `warroom` in the terminal.

> **Directory clarity:**
> - `~/war-room/` → **this repo** — the server & local client
> - `~/kwasikontor-dev/` → **your terminal website** — connects to the war-room API
> - `~/war-site/` → **frontend components** — copies of `App.jsx` and `WarRoom.jsx` (not a git repo)

---

## api endpoints

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/health` | seat availability + scope info |
| POST | `/api/session` | create session |
| GET | `/api/run` | SSE stream — run a phase for a seat |
| POST | `/api/task` | ad-hoc task outside phases |
| POST | `/api/decision` | resume paused agent after human decision |
| POST | `/api/output` | write session log to disk |
| POST | `/api/upload` | attach files to a session |
| POST | `/api/chat` | simple chat — used by kwasikontor.dev |

---

## production deployment

### fly.io (live — free tier)

Already deployed at `https://war-room-kwasikontor.fly.dev`.

To redeploy from scratch on a new account:

```bash
# install flyctl
curl -L https://fly.io/install.sh | sh
export PATH="$HOME/.fly/bin:$PATH"

fly auth login

# from war-room-v4/
fly launch --no-deploy --copy-config   # creates the app, keep existing fly.toml
fly secrets set \
  ANTHROPIC_API_KEY=sk-ant-... \
  OPENAI_API_KEY=sk-proj-... \
  MOONSHOT_API_KEY=sk-... \
  GOOGLE_API_KEY=AIza...
fly deploy
```

The Dockerfile uses `tsx` to run TypeScript directly — no compile step. The `fly.toml` is already in the repo.

**To update after code changes:**
```bash
fly deploy
```

### VPS (DigitalOcean / Hetzner / Vultr)

Cheapest: Hetzner CX11 (~$4/mo), DigitalOcean Basic ($6/mo).

```bash
# on the VPS — Ubuntu 24.04
git clone git@github.com:kwasikontor45/war-room.git
cd war-room/server
npm install
cp .env.example .env   # fill in keys
npm run dev            # or use pm2 / systemd for persistence
```

For SSL, put nginx in front:
```nginx
server {
    listen 80;
    server_name your-domain.com;
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_buffering off;
    }
}
```
Then `sudo certbot --nginx -d your-domain.com`.

### render.com (free tier, cold starts)

Render's free tier spins down after 15 min of inactivity — first request takes ~30s to wake.

1. Connect the `war-room` GitHub repo at render.com
2. New Web Service → Node
   - Build: `cd server && npm install`
   - Start: `npx tsx src/index.ts`
3. Add environment variables in the Render dashboard
4. Optionally set a custom domain

---

## connecting to kwasikontor.dev

The website (`github.com/kwasikontor45/kwasikontor-dev`, hosted on Netlify) already points at the live Fly server via `.env.production`:
```
VITE_WAR_ROOM_API=https://war-room-kwasikontor.fly.dev/api
```

If you redeploy the server at a different URL, update `.env.production` in the website repo and push — Netlify rebuilds automatically.

For local dev of the website against a local server, create `.env.local` (gitignored):
```
VITE_WAR_ROOM_API=http://localhost:3000/api
```

---

## env vars

| Variable | Required | Default |
|---|---|---|
| `ANTHROPIC_API_KEY` | for architect seat | — |
| `OPENAI_API_KEY` | for wild-card seat | — |
| `MOONSHOT_API_KEY` | for engineer seat | — |
| `GOOGLE_API_KEY` | for psychologist seat | — |
| `PORT` | no | `3000` |
| `OUTPUT_DIR` | no | `./output` |
| `SSH_KEYS_DIR` | no | `./ssh-keys` |
| `MAX_TOOL_LOOPS` | no | `20` |

---

## seat scopes (bash execution)

Each seat runs bash directly on the host, scoped by allowlist + blocklist:

| Seat | Scope |
|---|---|
| architect | read-only: cat, ls, find, grep, git log, docker inspect, curl |
| engineer | full devops — everything except `rm -rf /`, mkfs, shutdown |
| psychologist | observational: logs, metrics, health checks, read ops |
| wild-card | experimental — same limits as engineer |

To change a scope: edit `SEAT_SCOPES` in `server/src/tools/executor.ts`.

---

## update

```bash
cd ~/war-room
git pull
./war-room.sh update   # or manually: cd server && npm install
# local: npm run dev
# fly:   fly deploy
```
