# war-room v4 — claude code guide

four seats. scoped bash terminals. direct shell execution on the host — no container intermediary.

## what changed from v3

v3 ran commands inside a sandbox container (docker exec).
v4 runs commands directly on the host, scoped per seat identity.

no sandbox to build. no container to manage. just a shell, a scope, and a working directory.

## seat bash scopes

each seat runs bash in `./output/{sessionId}/` with the following scope:

| seat | scope | can do | cannot do |
|------|-------|--------|-----------|
| architect | read-heavy | cat, ls, find, grep, git log, docker inspect, curl | rm -rf, write ops, deploy |
| engineer | full devops | everything in scope | rm -rf /, mkfs, shutdown, reboot |
| psychologist | observational | logs, metrics, health checks, read ops | docker rm/stop, write ops |
| wild-card | experimental | everything in scope | rm -rf /, mkfs, shutdown, reboot |

scope is enforced in `tools/executor.ts → SEAT_SCOPES`. to change a scope, edit the `allowed` and `blocked` arrays.

## architecture

```
war-room-v4/
├── server/src/
│   ├── config.ts             ← seats, personas, tool definitions
│   ├── agent/
│   │   ├── loop.ts           ← plan→act→observe→react loop
│   │   └── session.ts        ← in-memory session store
│   ├── tools/
│   │   └── executor.ts       ← scoped bash, ssh, file, http
│   └── routes/
│       ├── agent.ts          ← SSE stream, session, decision, task
│       ├── output.ts         ← write log + git init
│       └── misc.ts           ← health (with scope info), upload
├── client/index.html
├── output/                   ← per-session working dirs + git repos
├── ssh-keys/                 ← drop .pem files here
├── docker-compose.yml        ← server + nginx, no sandbox service
└── install.sh                ← no sandbox build step
```

## bash execution flow

```
seat calls bash tool
→ executor.checkScope(seat, command)    // allowlist + blocklist
→ if blocked: return scope error        // no shell invoked
→ mkdir output/{sessionId}/            // scoped working dir
→ execAsync(command, { cwd: sessionDir, env: { WAR_ROOM_SEAT, WAR_ROOM_SESSION } })
→ return stdout + stderr (4mb cap, 60s timeout)
```

## ssh

drop `.pem` or `id_rsa` files in `./ssh-keys/`. the engineer seat uses:
```json
{ "tool": "ssh", "host": "1.2.3.4", "user": "ubuntu", "command": "df -h", "key": "prod.pem" }
```
ssh uses `-o BatchMode=yes` — no password prompts. key-based auth only.

## health endpoint

`GET /api/health` now returns seat availability AND scope descriptions:
```json
{
  "status": "ok",
  "seats": { "architect": true, "engineer": false, "psychologist": true, "wildcard": true },
  "scopes": {
    "architect": "read-heavy: inspect, analyze, document",
    "engineer": "full devops: build, deploy, configure, ssh",
    "psychologist": "observational: logs, metrics, user-facing checks",
    "wildcard": "experimental: broad access, document everything"
  }
}
```

## the principle

WHATWILLJOBSDO: no sandbox to spin up. no image to build. install.sh has one fewer step. the engineer runs on the same machine the operator runs on — which is exactly the right place for a devops seat to be.
