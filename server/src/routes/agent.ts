import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'crypto'
import { runAgent } from '../agent/loop'
import { createSession, getSession, updateSession } from '../agent/session'

const PHASES = ['propose','architect','implement','review','ship']

const PHASE_PROMPTS: Record<string, string> = {
  propose:   'You are convening. Read the brief. Pitch your role — what you own, why, what you will deliver phase by phase. Investigate anything you need to understand the project. End with CALL.',
  architect: 'Architecture phase. Investigate the environment if needed — check what is running, what tools are available, what constraints exist. Design your component. Name what the others will get wrong if you do not speak up. End with CALL.',
  implement: 'Implementation phase. Do not describe — do. Use your tools to scaffold, build, test, install. Show the work. If you write a file, write it. If you run a command, run it. End with CALL: what shipped.',
  review:    'Review phase. Use your tools to verify — run tests, check health, read logs, inspect configs. Find what breaks before production does. End with CALL: the one thing that would make you refuse to sign off.',
  ship:      'Ship phase. Deployment, monitoring, handoff. Use your tools to verify the deployment path is real. Write the runbook. Set up the alert. End with CALL: what breaks in production that nobody has talked about yet.',
}

export async function agentRoute(app: FastifyInstance) {

  // ── POST /api/session — create session, return id ──
  app.post<{ Body: { projectName: string; brief: string } }>('/api/session', async (req, reply) => {
    const { projectName, brief } = req.body
    const id = randomUUID()
    createSession(id, projectName, brief)
    return reply.send({ sessionId: id })
  })

  // ── GET /api/run?sessionId=&phase=&seat= — SSE agent stream ──
  app.get<{ Querystring: { sessionId: string; phase: string; seat: string } }>(
    '/api/run',
    async (req, reply) => {
      const { sessionId, phase, seat } = req.query
      const session = getSession(sessionId)
      if (!session) return reply.status(404).send({ error: 'session not found' })

      reply.raw.setHeader('Content-Type', 'text/event-stream')
      reply.raw.setHeader('Cache-Control', 'no-cache')
      reply.raw.setHeader('Connection', 'keep-alive')
      reply.raw.setHeader('X-Accel-Buffering', 'no')
      reply.raw.flushHeaders()

      const send = (event: string, data: any) => {
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
      }

      const prompt = PHASE_PROMPTS[phase] || 'Contribute your perspective for this phase.'

      try {
        const result = await runAgent(
          { seat, phase, prompt, brief: session.brief, sessionId },
          (event) => send(event.type, { seat: event.seat, ...event.data })
        )

        // check if paused for decision
        if (result.startsWith('{"__paused":')) {
          const paused = JSON.parse(result)
          const existing = session.paused || {}
          updateSession(sessionId, { paused: { ...existing, [seat]: { messages: paused.messages, fullText: paused.fullText, toolUseId: paused.toolUseId } } })
          send('paused', { seat, question: 'awaiting decision' })
        } else {
          // extract CALL line
          const callMatch = result.match(/CALL:\s*(.+)/i)
          const callText = callMatch ? callMatch[1].trim() : ''
          const bodyText = result.replace(/CALL:\s*.+/i, '').trim()

          const existing = session.outputs[phase] || {}
          updateSession(sessionId, {
            outputs: { ...session.outputs, [phase]: { ...existing, [seat]: { text: bodyText, call: callText } } }
          })
        }
      } catch (e: any) {
        send('error', { seat, message: e.message })
      }

      reply.raw.end()
    }
  )

  // ── POST /api/decision — resume paused agent ──
  app.post<{ Body: { sessionId: string; seat: string; answer: string } }>(
    '/api/decision',
    async (req, reply) => {
      const { sessionId, seat, answer } = req.body
      const session = getSession(sessionId)
      if (!session) return reply.status(404).send({ error: 'session not found' })

      const paused = session.paused?.[seat]
      if (!paused) return reply.status(400).send({ error: 'no paused agent for that seat' })

      // inject the human answer as a tool result and resume
      const resumeMessages = [
        ...paused.messages,
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: paused.toolUseId, content: `Human decision: ${answer}` }],
        },
      ]

      reply.send({ status: 'resuming' })

      // resume async
      runAgent(
        { seat, phase: session.phase, prompt: '', brief: session.brief, sessionId, history: resumeMessages },
        () => {}
      ).then(result => {
        const callMatch = result.match(/CALL:\s*(.+)/i)
        const callText = callMatch ? callMatch[1].trim() : ''
        const bodyText = result.replace(/CALL:\s*.+/i, '').trim()
        const existing = session.outputs[session.phase] || {}
        const newPaused = { ...session.paused }
        delete newPaused[seat]
        updateSession(sessionId, {
          outputs: { ...session.outputs, [session.phase]: { ...existing, [seat]: { text: bodyText, call: callText } } },
          paused: newPaused,
        })
      })
    }
  )

  // ── POST /api/task — ad-hoc task for a seat outside phases ──
  app.post<{ Body: { sessionId: string; seat: string; task: string } }>(
    '/api/task',
    async (req, reply) => {
      const { sessionId, seat, task } = req.body
      const session = getSession(sessionId)
      if (!session) return reply.status(404).send({ error: 'session not found' })

      reply.raw.setHeader('Content-Type', 'text/event-stream')
      reply.raw.setHeader('Cache-Control', 'no-cache')
      reply.raw.setHeader('Connection', 'keep-alive')
      reply.raw.flushHeaders()

      const send = (event: string, data: any) => {
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
      }

      try {
        await runAgent(
          { seat, phase: 'task', prompt: task, brief: session.brief, sessionId },
          (event) => send(event.type, { seat: event.seat, ...event.data })
        )
      } catch (e: any) {
        send('error', { seat, message: e.message })
      }

      reply.raw.end()
    }
  )

  // ── DELETE /api/session — cleanup ──
  app.delete<{ Querystring: { sessionId: string } }>('/api/session', async (req, reply) => {
    reply.send({ ok: true })
  })
}
