import type { FastifyInstance } from 'fastify'
import { pipeline } from 'stream/promises'
import { createWriteStream } from 'fs'
import { readFile, unlink } from 'fs/promises'
import path from 'path'
import os from 'os'
import { MODEL_AVAILABLE } from '../config'
import { getScopeInfo } from '../tools/executor'

const TEXT_EXTS = new Set([
  '.ts','.tsx','.js','.jsx','.py','.rs','.go','.java','.rb','.php',
  '.swift','.kt','.c','.cpp','.h','.cs','.sh','.bash','.zsh',
  '.md','.mdx','.txt','.json','.yaml','.yml','.toml','.env',
  '.html','.css','.scss','.sql','.graphql','.xml','.csv',
])

export async function healthRoute(app: FastifyInstance) {
  app.get('/api/health', async (_req, reply) => {
    reply.send({
      status: 'ok',
      seats: {
        architect:    MODEL_AVAILABLE.claude(),
        engineer:     MODEL_AVAILABLE.kimi(),
        psychologist: MODEL_AVAILABLE.gemini(),
        wildcard:     MODEL_AVAILABLE.gpt(),
      },
      scopes: getScopeInfo(),
    })
  })
}

export async function uploadRoute(app: FastifyInstance) {
  app.post('/api/upload', async (req, reply) => {
    const data = await req.file()
    if (!data) return reply.status(400).send({ error: 'no file' })
    const ext = path.extname(data.filename).toLowerCase()
    const tmp = path.join(os.tmpdir(), `wr-${Date.now()}${ext}`)
    await pipeline(data.file, createWriteStream(tmp))
    const buf = await readFile(tmp)
    await unlink(tmp).catch(() => {})
    if (TEXT_EXTS.has(ext)) return reply.send({ type: 'text', name: data.filename, content: buf.toString('utf-8') })
    if (['.png','.jpg','.jpeg','.gif','.webp'].includes(ext)) return reply.send({ type: 'image', name: data.filename, mime: data.mimetype, base64: buf.toString('base64') })
    if (ext === '.pdf') return reply.send({ type: 'pdf', name: data.filename, base64: buf.toString('base64') })
    if (ext === '.zip') {
      const JSZip = (await import('jszip')).default
      const zip = await JSZip.loadAsync(buf)
      const files: { name: string; content: string }[] = []
      for (const [name, file] of Object.entries(zip.files)) {
        if (!file.dir && TEXT_EXTS.has(path.extname(name).toLowerCase()))
          files.push({ name, content: await file.async('string') })
      }
      return reply.send({ type: 'zip', name: data.filename, files })
    }
    return reply.send({ type: 'binary', name: data.filename, base64: buf.toString('base64') })
  })
}
