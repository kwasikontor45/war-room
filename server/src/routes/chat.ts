import type { FastifyInstance } from 'fastify'
import { config, PERSONAS, TOOLS, SEAT_MODELS, MODEL_AVAILABLE } from '../config'

export async function chatRoute(app: FastifyInstance) {
  app.post<{
    Body: { seat: string; messages: { role: string; content: string }[]; phase?: string; proposal?: string }
  }>('/api/chat', async (req, reply) => {
    const { seat, messages, phase, proposal } = req.body
    if (!seat || !messages?.length) return reply.status(400).send({ error: 'seat and messages required' })

    const model = SEAT_MODELS[seat] || 'claude'

    if (!MODEL_AVAILABLE[model]?.()) {
      return reply.status(503).send({ error: `${seat} offline — no API key configured` })
    }

    const system = [
      PERSONAS[seat] || '',
      proposal ? `PROJECT BRIEF:\n${proposal}` : '',
      phase    ? `CURRENT PHASE: ${phase}` : '',
    ].filter(Boolean).join('\n\n')

    try {
      const reply_text = await callModel(model, messages, system)
      return reply.send({ reply: reply_text })
    } catch (e: any) {
      return reply.status(500).send({ error: `[${seat} / ${model}] ${e.message}` })
    }
  })
}

async function callModel(model: string, messages: any[], system: string): Promise<string> {
  switch (model) {
    case 'claude':  return callClaude(messages, system)
    case 'kimi':    return callOpenAICompat(messages, system, 'https://api.moonshot.ai/v1/chat/completions', 'moonshot-v1-8k', config.MOONSHOT_API_KEY)
    case 'gemini':  return callGemini(messages, system)
    case 'gpt':     return callOpenAICompat(messages, system, 'https://api.openai.com/v1/chat/completions', 'gpt-4o', config.OPENAI_API_KEY)
    default: throw new Error(`unknown model: ${model}`)
  }
}

async function callClaude(messages: any[], system: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': config.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1024, system, messages }),
  })
  const d = await res.json() as any
  if (!res.ok) throw new Error(d.error?.message || 'claude error')
  return d.content?.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('') || ''
}

async function callOpenAICompat(messages: any[], system: string, url: string, model: string, key: string): Promise<string> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({ model, max_tokens: 1024, messages: [{ role: 'system', content: system }, ...messages] }),
  })
  const d = await res.json() as any
  if (!res.ok) throw new Error(d.error?.message || `${model} error`)
  return d.choices?.[0]?.message?.content || ''
}

async function callGemini(messages: any[], system: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${config.GOOGLE_API_KEY}`
  const contents = messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }))
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ system_instruction: { parts: [{ text: system }] }, contents, generationConfig: { maxOutputTokens: 1024 } }),
  })
  const d = await res.json() as any
  if (!res.ok) throw new Error(d.error?.message || 'gemini error')
  return d.candidates?.[0]?.content?.parts?.filter((p: any) => p.text).map((p: any) => p.text).join('') || ''
}
