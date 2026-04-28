# war-room v4

Four-seat agentic devops system. Drop a brief — architect, engineer, psychologist, and wild-card argue their way to a production plan across five phases.

**Seats:**
- `architect` — Claude (Anthropic)
- `engineer` — Kimi (Moonshot)
- `psychologist` — Gemini (Google)
- `wild-card` — GPT-4o (OpenAI)

**Phases:** propose → architect → implement → review → ship

---

## local setup

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
cd server
npm run dev       # runs at localhost:3000
```

**Use the standalone UI:**  
Open `client/index.html` directly in your browser. Full four-seat war-room with SSE streaming.

**Use via kwasikontor.dev locally:**  
In `~/war-site/kwasikontor-dev`, create `.env.local`:
```
VITE_WAR_ROOM_API=http://localhost:3000/api
```
Then `npm run dev` in the website project. Type `warroom` in the terminal.

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

Requires a server with Node 18+ and optionally Docker.

### option 1 — fly.io (free tier)

Fly.io's free tier covers a lightweight Node app like this.

```bash
# install flyctl
curl -L https://fly.io/install.sh | sh

# from the war-room directory
fly launch        # follow prompts — use existing Dockerfile
fly secrets set ANTHROPIC_API_KEY=sk-ant-... OPENAI_API_KEY=... MOONSHOT_API_KEY=... GOOGLE_API_KEY=...
fly deploy
```

Point `warroom.kwasikontor.dev` CNAME at the fly.dev URL it gives you.

### option 2 — VPS (DigitalOcean / Hetzner / Vultr)

Cheapest: Hetzner CX11 (~$4/mo), DigitalOcean Basic ($6/mo).

```bash
# on the VPS — Ubuntu 24.04
git clone git@github.com:kwasikontor45/war-room.git
cd war-room
bash install.sh     # interactive: enter keys, starts via docker compose
```

Then set up nginx + Certbot for SSL on `warroom.kwasikontor.dev`:

```bash
sudo apt install nginx certbot python3-certbot-nginx -y

# /etc/nginx/sites-available/warroom
server {
    listen 80;
    server_name warroom.kwasikontor.dev;
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_buffering off;
    }
}

sudo ln -s /etc/nginx/sites-available/warroom /etc/nginx/sites-enabled/
sudo certbot --nginx -d warroom.kwasikontor.dev
sudo systemctl reload nginx
```

### option 3 — render.com (free tier, cold starts)

Render's free tier spins down after 15 min of inactivity — first request after idle takes ~30s to wake up. Fine for a portfolio demo.

1. Connect the `war-room` GitHub repo at render.com
2. New Web Service → Node → Build: `cd server && npm install` → Start: `cd server && npm start`
3. Add environment variables in the Render dashboard
4. Set custom domain: `warroom.kwasikontor.dev`

---

## connecting to kwasikontor.dev

Once the server is deployed, build the website with the server URL:

```bash
cd ~/war-site/kwasikontor-dev
VITE_WAR_ROOM_API=https://warroom.kwasikontor.dev/api npm run build
```

Or set it permanently in `.env.production`:
```
VITE_WAR_ROOM_API=https://warroom.kwasikontor.dev/api
```

Then push — GitHub Actions deploys the build to GitHub Pages.

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
cd war-room
git pull
cd server && npm install
# restart: npm run dev (local) or fly deploy / docker compose up -d (prod)
```
