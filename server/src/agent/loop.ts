import { config, PERSONAS, TOOLS, SEAT_MODELS, MODEL_AVAILABLE } from '../config'
import { executeTool } from "../tools/executor"

export interface AgentEvent {
  type: 'thinking' | 'tool-start' | 'tool-done' | 'text' | 'decision' | 'done' | 'error'
  seat: string
  data: any
}

export interface AgentTask {
  seat: string
  phase: string
  prompt: string
  brief: string
  sessionId: string
  history?: { role: string; content: any }[]
}

// ── main agent loop ───────────────────────────
export async function runAgent(
  task: AgentTask,
  emit: (event: AgentEvent) => void
): Promise<string> {
  const { seat, phase, prompt, brief, sessionId } = task
  const model = SEAT_MODELS[seat] || 'claude'

  if (!MODEL_AVAILABLE[model]?.()) {
    emit({ type: 'text', seat, data: { text: `[${seat} offline — no API key configured]`, accumulated: '' } })
    emit({ type: 'done', seat, data: { text: '' } })
    return ''
  }

  const system = `${PERSONAS[seat]}\n\nPROJECT BRIEF:\n${brief}\n\nCURRENT PHASE: ${phase}`

  const messages: { role: string; content: any }[] = [
    ...(task.history || []),
    { role: 'user', content: prompt },
  ]

  let fullText = ''
  let loops = 0

  while (loops < config.MAX_TOOL_LOOPS) {
    loops++

    emit({ type: 'thinking', seat, data: { loop: loops } })

    let response: { text: string; toolUses: { id: string; name: string; input: any }[] }

    try {
      response = await callModel(model, messages, system)
    } catch (e: any) {
      emit({ type: 'error', seat, data: { message: e.message } })
      return fullText || 'error: ' + e.message
    }

    if (response.text) {
      fullText += (fullText ? '\n' : '') + response.text
      emit({ type: 'text', seat, data: { text: response.text, accumulated: fullText } })
    }

    // no tool calls → done
    if (!response.toolUses.length) {
      emit({ type: 'done', seat, data: { text: fullText } })
      return fullText
    }

    // add assistant turn
    const assistantContent: any[] = []
    if (response.text) assistantContent.push({ type: 'text', text: response.text })
    response.toolUses.forEach(t => assistantContent.push({ type: 'tool_use', id: t.id, name: t.name, input: t.input }))
    messages.push({ role: 'assistant', content: assistantContent })

    // execute tools
    const toolResults: any[] = []
    for (const tool of response.toolUses) {
      // decision tool → surface to human and pause
      if (tool.name === 'decision') {
        emit({ type: 'decision', seat, data: { ...tool.input, toolUseId: tool.id } })
        // return partial — the route will resume when human answers
        return JSON.stringify({ __paused: true, messages, fullText, toolUseId: tool.id })
      }

      const result = await executeTool(
        tool.name,
        tool.input,
        seat,
        sessionId,
        (ev, d) => emit({ type: ev as any, seat, data: d })
      )

      toolResults.push({
        type: 'tool_result',
        tool_use_id: tool.id,
        content: result,
      })
    }

    messages.push({ role: 'user', content: toolResults })
  }

  emit({ type: 'done', seat, data: { text: fullText } })
  return fullText
}

// ── model callers ─────────────────────────────
async function callModel(
  model: string,
  messages: any[],
  system: string
): Promise<{ text: string; toolUses: { id: string; name: string; input: any }[] }> {
  switch (model) {
    case 'claude':  return callClaude(messages, system)
    case 'kimi':    return callOpenAICompat(messages, system, 'https://api.moonshot.ai/v1/chat/completions', 'moonshot-v1-8k', config.MOONSHOT_API_KEY)
    case 'gemini':  return callGemini(messages, system)
    case 'gpt':     return callOpenAICompat(messages, system, 'https://api.openai.com/v1/chat/completions', 'gpt-4o', config.OPENAI_API_KEY)
    default: throw new Error(`unknown model: ${model}`)
  }
}

async function callClaude(messages: any[], system: string) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system,
      tools: TOOLS,
      messages,
    }),
  })
  const d = await res.json() as any
  if (!res.ok) throw new Error(d.error?.message || 'claude api error')

  const text = d.content?.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('') || ''
  const toolUses = d.content?.filter((b: any) => b.type === 'tool_use').map((b: any) => ({
    id: b.id, name: b.name, input: b.input,
  })) || []

  return { text, toolUses }
}

// openai-compatible (kimi + gpt) — tool use via function calling
async function callOpenAICompat(messages: any[], system: string, url: string, model: string, key: string) {
  const functions = TOOLS.map(t => ({
    name: t.name,
    description: t.description,
    parameters: t.input_schema,
  }))

  const oaiMessages = [
    { role: 'system', content: system },
    ...messages.map(m => {
      // convert anthropic tool_result → openai tool message
      if (Array.isArray(m.content)) {
        const toolResults = m.content.filter((c: any) => c.type === 'tool_result')
        if (toolResults.length) {
          return toolResults.map((tr: any) => ({
            role: 'tool',
            tool_call_id: tr.tool_use_id,
            content: tr.content,
          }))
        }
        const toolUses = m.content.filter((c: any) => c.type === 'tool_use')
        if (toolUses.length) {
          return {
            role: 'assistant',
            content: m.content.find((c: any) => c.type === 'text')?.text || '',
            tool_calls: toolUses.map((tu: any) => ({
              id: tu.id,
              type: 'function',
              function: { name: tu.name, arguments: JSON.stringify(tu.input) },
            })),
          }
        }
      }
      return m
    }).flat(),
  ]

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({ model, max_tokens: 4096, messages: oaiMessages, tools: functions.map(f => ({ type: 'function', function: f })) }),
  })
  const d = await res.json() as any
  if (!res.ok) throw new Error(d.error?.message || `${model} error`)

  const msg = d.choices?.[0]?.message
  const text = msg?.content || ''
  const toolUses = (msg?.tool_calls || []).map((tc: any) => ({
    id: tc.id,
    name: tc.function.name,
    input: JSON.parse(tc.function.arguments || '{}'),
  }))
  return { text, toolUses }
}

async function callGemini(messages: any[], system: string) {
  // gemini function calling
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${config.GOOGLE_API_KEY}`
  const tools = [{ function_declarations: TOOLS.map(t => ({ name: t.name, description: t.description, parameters: t.input_schema })) }]

  const contents = messages.map(m => {
    if (Array.isArray(m.content)) {
      const tr = m.content.find((c: any) => c.type === 'tool_result')
      if (tr) return { role: 'user', parts: [{ function_response: { name: tr.tool_use_id, response: { result: tr.content } } }] }
      const tu = m.content.find((c: any) => c.type === 'tool_use')
      if (tu) return { role: 'model', parts: [{ function_call: { name: tu.name, args: tu.input } }] }
    }
    return { role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }
  })

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ system_instruction: { parts: [{ text: system }] }, contents, tools, generationConfig: { maxOutputTokens: 4096 } }),
  })
  const d = await res.json() as any
  if (!res.ok) throw new Error(d.error?.message || 'gemini error')

  const parts = d.candidates?.[0]?.content?.parts || []
  const text = parts.filter((p: any) => p.text).map((p: any) => p.text).join('') || ''
  const toolUses = parts.filter((p: any) => p.function_call).map((p: any, i: number) => ({
    id: `gemini-tool-${Date.now()}-${i}`,
    name: p.function_call.name,
    input: p.function_call.args || {},
  }))
  return { text, toolUses }
}
