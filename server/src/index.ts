import Fastify from 'fastify'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import { agentRoute } from './routes/agent'
import { outputRoute } from './routes/output'
import { healthRoute, uploadRoute } from './routes/misc'
import { chatRoute } from './routes/chat'
import { config } from './config'
import { mkdir } from 'fs/promises'

const app = Fastify({ logger: true })

await mkdir(config.OUTPUT_DIR, { recursive: true })
await mkdir(config.SSH_KEYS_DIR, { recursive: true })

await app.register(cors, { origin: '*' })
await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } })

app.register(healthRoute)
app.register(uploadRoute)
app.register(agentRoute)
app.register(outputRoute)
app.register(chatRoute)

app.listen({ port: config.PORT, host: '0.0.0.0' }, (err) => {
  if (err) { app.log.error(err); process.exit(1) }
  app.log.info(`war-room v4 — agentic devops — port ${config.PORT}`)
})
