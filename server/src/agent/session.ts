export interface Session {
  id: string
  projectName: string
  brief: string
  phase: string
  decisions: Record<string, string>
  outputs: Record<string, Record<string, { text: string; call: string }>>
  paused: Record<string, { messages: any[]; fullText: string; toolUseId: string }>
  createdAt: Date
}

const sessions = new Map<string, Session>()

export function createSession(id: string, projectName: string, brief: string): Session {
  const session: Session = {
    id, projectName, brief,
    phase: 'propose',
    decisions: {},
    outputs: {},
    paused: {},
    createdAt: new Date(),
  }
  sessions.set(id, session)
  return session
}

export function getSession(id: string): Session | undefined {
  return sessions.get(id)
}

export function updateSession(id: string, updates: Partial<Session>) {
  const s = sessions.get(id)
  if (s) sessions.set(id, { ...s, ...updates })
}

// clean up sessions older than 24h
setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000
  for (const [id, s] of sessions) {
    if (s.createdAt.getTime() < cutoff) sessions.delete(id)
  }
}, 60 * 60 * 1000)
