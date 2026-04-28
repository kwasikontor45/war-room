import { exec } from 'child_process'
import { promisify } from 'util'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import os from 'os'
import { config } from '../config'

const execAsync = promisify(exec)

// ── seat bash scopes ──────────────────────────
// direct shell, no container.
// scope enforced by allowlist + blocklist per seat identity.

const SEAT_SCOPES: Record<string, {
  cwd: string
  allowed: RegExp[]
  blocked: RegExp[]
  description: string
}> = {
  architect: {
    cwd: path.resolve(config.OUTPUT_DIR),
    description: 'read-heavy: inspect, analyze, document',
    allowed: [
      /^(cat|ls|find|tree|grep|rg|wc|head|tail|echo|pwd|df|du|stat|file|which|env|printenv|curl|wget|ping|dig|nslookup|ps|netstat|ss|lsof|docker\s+(ps|images|inspect|logs|stats|network|volume)|git\s+(log|status|diff|show|branch|remote|describe|clone)|jq|yq|awk|sed|sort|uniq|cut|tr|xargs)/,
    ],
    blocked: [/rm\s+-rf/, /dd\s+/, /mkfs/, /fdisk/, /shutdown/, /reboot/, /passwd/],
  },
  engineer: {
    cwd: path.resolve(config.OUTPUT_DIR),
    description: 'full devops: build, deploy, configure, ssh',
    allowed: [/.*/],
    blocked: [/rm\s+-rf\s+\/(?!workspace|home)/, /mkfs/, /fdisk/, /shutdown/, /reboot/, /passwd\s+root/],
  },
  psychologist: {
    cwd: path.resolve(config.OUTPUT_DIR),
    description: 'observational: logs, metrics, user-facing checks',
    allowed: [
      /^(cat|ls|find|grep|rg|wc|head|tail|echo|curl|wget|ping|dig|ps|netstat|ss|lsof|docker\s+(ps|logs|stats)|git\s+(log|status)|jq|yq|awk|sed|sort|uniq|cut|tr)/,
    ],
    blocked: [/rm\s+-rf/, /dd\s+/, /mkfs/, /fdisk/, /shutdown/, /reboot/, /passwd/, /docker\s+(rm|rmi|stop|kill)/],
  },
  wildcard: {
    cwd: path.resolve(config.OUTPUT_DIR),
    description: 'experimental: broad access, document everything',
    allowed: [/.*/],
    blocked: [/rm\s+-rf\s+\/(?!workspace|home)/, /mkfs/, /fdisk/, /shutdown/, /reboot/, /passwd\s+root/],
  },
}

function checkScope(seat: string, command: string): { ok: boolean; reason?: string } {
  const scope = SEAT_SCOPES[seat]
  if (!scope) return { ok: false, reason: `unknown seat: ${seat}` }
  for (const pat of scope.blocked) {
    if (pat.test(command)) return { ok: false, reason: `blocked by ${seat} scope: ${pat}` }
  }
  const ok = scope.allowed.some(pat => pat.test(command.trim()))
  if (!ok) return { ok: false, reason: `not in ${seat} scope — use decision tool to request elevated access` }
  return { ok: true }
}

export async function runBash(seat: string, command: string, sessionId: string): Promise<string> {
  const check = checkScope(seat, command)
  if (!check.ok) return `[scope error] ${check.reason}`
  const scope = SEAT_SCOPES[seat]
  const sessionDir = path.join(scope.cwd, sessionId)
  await mkdir(sessionDir, { recursive: true })
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: sessionDir,
      timeout: 60_000,
      env: { ...process.env, HOME: os.homedir(), WAR_ROOM_SEAT: seat, WAR_ROOM_SESSION: sessionId },
      maxBuffer: 1024 * 1024 * 4,
    })
    return [stdout, stderr].filter(Boolean).join('\n').trim() || '(no output)'
  } catch (e: any) {
    return [e.stdout, e.stderr, e.message].filter(Boolean).join('\n').trim() || 'command failed'
  }
}

export async function runSsh(host: string, user: string, command: string, keyFile = 'id_rsa'): Promise<string> {
  const keyPath = path.join(path.resolve(config.SSH_KEYS_DIR), keyFile)
  if (!existsSync(keyPath)) return `[ssh error] key not found: ${keyFile} — drop it in ./ssh-keys/`
  const safe = command.replace(/'/g, "'\\''")
  try {
    const { stdout, stderr } = await execAsync(
      `ssh -i "${keyPath}" -o StrictHostKeyChecking=no -o ConnectTimeout=10 -o BatchMode=yes "${user}@${host}" '${safe}'`,
      { timeout: 30_000 }
    )
    return [stdout, stderr].filter(Boolean).join('\n').trim() || '(no output)'
  } catch (e: any) {
    return [e.stdout, e.stderr, e.message].filter(Boolean).join('\n').trim() || 'ssh failed'
  }
}

export async function runFileRead(filePath: string, sessionId: string): Promise<string> {
  const resolved = filePath.startsWith('/') ? filePath : path.join(path.resolve(config.OUTPUT_DIR), sessionId, filePath)
  try { return (await readFile(resolved, 'utf-8')).slice(0, 10_000) }
  catch (e: any) { return `[file error] ${e.message}` }
}

export async function runFileWrite(filePath: string, content: string, sessionId: string): Promise<string> {
  const resolved = filePath.startsWith('/') ? filePath : path.join(path.resolve(config.OUTPUT_DIR), sessionId, filePath)
  await mkdir(path.dirname(resolved), { recursive: true })
  await writeFile(resolved, content, 'utf-8')
  return `written: ${resolved}`
}

export async function runHttp(url: string, method = 'GET', body?: string, headers?: Record<string, string>): Promise<string> {
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body && method !== 'GET' ? body : undefined,
      signal: AbortSignal.timeout(15_000),
    })
    return `${res.status} ${res.statusText}\n${(await res.text()).slice(0, 4_000)}`
  } catch (e: any) { return `[http error] ${e.message}` }
}

export async function executeTool(
  toolName: string,
  input: Record<string, any>,
  seat: string,
  sessionId: string,
  emit: (event: string, data: any) => void
): Promise<string> {
  emit('tool-start', { tool: toolName, input })
  let result: string
  try {
    switch (toolName) {
      case 'bash':      result = await runBash(seat, input.command, sessionId); break
      case 'ssh':       result = await runSsh(input.host, input.user, input.command, input.key); break
      case 'file_read': result = await runFileRead(input.path, sessionId); break
      case 'file_write':result = await runFileWrite(input.path, input.content, sessionId); break
      case 'http':      result = await runHttp(input.url, input.method, input.body, input.headers); break
      case 'decision':
        result = JSON.stringify({ status:'awaiting-human', question:input.question, context:input.context, options:input.options||[] })
        break
      default: result = `unknown tool: ${toolName}`
    }
  } catch (e: any) { result = `error: ${e.message}` }
  emit('tool-done', { tool: toolName, result: result.slice(0, 3_000) })
  return result
}

export function getScopeInfo() {
  return Object.fromEntries(Object.entries(SEAT_SCOPES).map(([s, v]) => [s, v.description]))
}
