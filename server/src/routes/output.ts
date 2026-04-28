import type { FastifyInstance } from 'fastify'
import { writeFile, mkdir } from 'fs/promises'
import { execSync } from 'child_process'
import path from 'path'
import { config } from '../config'
import { getSession } from '../agent/session'

const PHASES = ['propose','architect','implement','review','ship']
const SEAT_LABELS: Record<string,string> = { architect:'ARCHITECT', engineer:'ENGINEER', psychologist:'PSYCHOLOGIST', wildcard:'WILD-CARD' }
const SEATS = ['architect','engineer','psychologist','wildcard']

export async function outputRoute(app: FastifyInstance) {
  app.post<{ Body: { sessionId: string } }>('/api/output', async (req, reply) => {
    const session = getSession(req.body.sessionId)
    if (!session) return reply.status(404).send({ error: 'session not found' })

    const slug = session.projectName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    const ts = new Date().toISOString().split('T')[0]
    const outDir = path.join(path.resolve(config.OUTPUT_DIR), `${slug}-${ts}`)

    // per-phase per-seat files
    for (const phase of PHASES) {
      const phDir = path.join(outDir, phase)
      await mkdir(phDir, { recursive: true })
      for (const seat of SEATS) {
        const out = session.outputs[phase]?.[seat]
        if (!out) continue
        await writeFile(
          path.join(phDir, `${seat}.md`),
          `# ${SEAT_LABELS[seat]} — ${phase}\n\n${out.text}\n\n**CALL:** ${out.call}\n`
        )
      }
    }

    // assembled war-room log
    const lines = [
      `# war-room log — ${session.projectName}`,
      `_${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}_`,
      '', '---', '', '## brief', '', session.brief, '', '---', '',
    ]
    for (const phase of PHASES) {
      lines.push(`## ${phase}`, '')
      for (const seat of SEATS) {
        const out = session.outputs[phase]?.[seat]
        if (!out) continue
        lines.push(`**${SEAT_LABELS[seat]}**`, '', out.text, '')
        if (out.call) lines.push(`> CALL: ${out.call}`, '')
      }
      if (session.decisions[phase]) lines.push(`> **DECISION:** ${session.decisions[phase]}`, '')
      lines.push('---', '')
    }
    await writeFile(path.join(outDir, 'README.md'), lines.join('\n'))

    // git init
    try {
      execSync(`git init && git add . && git commit -m "war-room: ${slug} — ${ts}"`, { cwd: outDir, stdio: 'pipe' })
    } catch {}

    return reply.send({ outDir, slug, ts })
  })
}
