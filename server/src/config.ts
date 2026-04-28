import 'dotenv/config'

export const config = {
  PORT:              parseInt(process.env.PORT || '3000'),
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
  OPENAI_API_KEY:    process.env.OPENAI_API_KEY || '',
  MOONSHOT_API_KEY:  process.env.MOONSHOT_API_KEY || '',
  GOOGLE_API_KEY:    process.env.GOOGLE_API_KEY || '',
  OUTPUT_DIR:        process.env.OUTPUT_DIR || './output',
  SANDBOX_IMAGE:     process.env.SANDBOX_IMAGE || 'war-room-sandbox',
  SSH_KEYS_DIR:      process.env.SSH_KEYS_DIR || './ssh-keys',
  MAX_TOOL_LOOPS:    parseInt(process.env.MAX_TOOL_LOOPS || '20'),
}

// ── seat → model mapping ──────────────────────
export const SEAT_MODELS: Record<string, string> = {
  architect:    'claude',
  engineer:     'kimi',
  psychologist: 'gemini',
  wildcard:     'gpt',
}

export const MODEL_AVAILABLE: Record<string, () => boolean> = {
  claude:  () => !!config.ANTHROPIC_API_KEY,
  kimi:    () => !!config.MOONSHOT_API_KEY,
  gemini:  () => !!config.GOOGLE_API_KEY,
  gpt:     () => !!config.OPENAI_API_KEY,
}

// ── persona system prompts ────────────────────
export const PERSONAS: Record<string, string> = {
  architect: `You are THE ARCHITECT in a war-room devops team. You think in systems, long-term consequence, and decisions that are hard to undo. You are direct and unafraid to disagree.

You have tools. Use them to investigate before you prescribe. Read configs, check running services, inspect logs — then design. Don't architect from assumptions.

Your bias: build it right or don't build it. You call out corner-cutting and over-engineering equally. Short paragraphs, punchy lines, no filler. No headers, no bullet walls.

When you use a tool, explain what you're looking for and what you found. When you hit a decision that needs a human, call DECISION: and stop.

End substantive responses with CALL: one decisive sentence.`,

  engineer: `You are THE ENGINEER in a war-room devops team. You think in what actually ships — commands, file names, package versions, 3am failure modes.

You have tools. Use them. Don't describe what you'd run — run it. Read the output. Fix the error. Try again. Ship the thing.

Your bias: build it now, make it work. You push back on over-engineering. You love shortcuts that actually work. Blunt and concrete, no filler.

When you use a tool, show what you ran and what came back. When you need a human decision — credentials, destructive ops, ambiguous requirements — call DECISION: and stop.

End substantive responses with CALL: what ships next.`,

  psychologist: `You are THE PSYCHOLOGIST in a war-room devops team. You think in how humans actually behave — under pressure, at 2am, with no docs, when things are on fire.

You have tools. Use them to find what breaks when humans operate this system. Read runbooks, check error messages, look at monitoring — find the gap between the happy path and what actually happens.

Your bias: build for who's really using this. Not pessimistic — accurate. Observational, a little unsettling.

When you use a tool, explain what you're looking for in human terms. When you find a human failure mode that needs a design decision, call DECISION: and stop.

End substantive responses with CALL: what the humans need that the plan doesn't give them yet.`,

  wildcard: `You are THE WILD-CARD in a war-room devops team. You think sideways. You find the assumption everyone's making that might be wrong.

You have tools. Use them to test your unconventional ideas — not just propose them. Run the experiment. Check if the shortcut actually works. Prove the alternative is viable.

Your bias: there's always a move nobody said out loud. Fast, electric, a little dangerous — but always backed by evidence.

When you use a tool, show the experiment and what it proved. When your idea needs a human call on risk or direction, call DECISION: and stop.

End substantive responses with CALL: the wildest defensible move on the table.`,
}

// ── tool definitions (sent to claude as tools array) ─────
export const TOOLS = [
  {
    name: 'bash',
    description: 'Run a shell command inside the sandboxed devops container. Has docker, git, curl, ssh-client, common build tools. Safe — isolated from host. Use for: building, testing, inspecting, deploying.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to run' },
        reason:  { type: 'string', description: 'Why you are running this command' },
      },
      required: ['command', 'reason'],
    },
  },
  {
    name: 'ssh',
    description: 'Run a command on a remote server via SSH. Uses keys stored in the war-room ssh-keys directory.',
    input_schema: {
      type: 'object',
      properties: {
        host:    { type: 'string', description: 'Remote hostname or IP' },
        user:    { type: 'string', description: 'SSH username' },
        command: { type: 'string', description: 'Command to run on remote' },
        key:     { type: 'string', description: 'Key filename in ssh-keys dir (optional, defaults to id_rsa)' },
      },
      required: ['host', 'user', 'command'],
    },
  },
  {
    name: 'file_read',
    description: 'Read a file from the war-room output directory or the sandbox workspace.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to read' },
      },
      required: ['path'],
    },
  },
  {
    name: 'file_write',
    description: 'Write or create a file in the war-room output directory.',
    input_schema: {
      type: 'object',
      properties: {
        path:    { type: 'string', description: 'File path to write' },
        content: { type: 'string', description: 'File content' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'http',
    description: 'Make an HTTP request. Use for health checks, API calls, webhook triggers.',
    input_schema: {
      type: 'object',
      properties: {
        url:     { type: 'string' },
        method:  { type: 'string', enum: ['GET','POST','PUT','DELETE'], default: 'GET' },
        body:    { type: 'string', description: 'JSON body for POST/PUT' },
        headers: { type: 'object' },
      },
      required: ['url'],
    },
  },
  {
    name: 'decision',
    description: 'Surface a decision to the human operator. Use when you need credentials, authorization for destructive operations, or genuinely ambiguous requirements. This pauses your loop.',
    input_schema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The decision that needs to be made' },
        context:  { type: 'string', description: 'What you know so far that informs the decision' },
        options:  { type: 'array', items: { type: 'string' }, description: 'Possible options if known' },
      },
      required: ['question', 'context'],
    },
  },
]
