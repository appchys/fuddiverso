import http from 'node:http'
import crypto from 'node:crypto'
import { URL } from 'node:url'
import { getWhatsAppBaileysManager } from '@/lib/whatsapp-baileys-manager'

const PORT = Number(process.env.PORT || 3005)
const HOST = process.env.HOST || '127.0.0.1'
const WORKER_SECRET = String(process.env.WHATSAPP_WORKER_SECRET || '').trim()

if (!WORKER_SECRET || WORKER_SECRET.length < 32) {
  console.error('[Baileys Worker] FATAL: WHATSAPP_WORKER_SECRET debe estar configurado (>= 32 caracteres).')
  process.exit(1)
}

function isAuthorized(req: http.IncomingMessage): boolean {
  const provided = String(req.headers['x-worker-secret'] || '').trim()
  if (!provided) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(WORKER_SECRET)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

function sendJson(res: http.ServerResponse, statusCode: number, data: unknown) {
  const body = JSON.stringify(data)
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  res.end(body)
}

function readJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    req.on('data', (chunk: Buffer) => {
      total += chunk.length
      if (total > 512 * 1024) {
        reject(new Error('Body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8').trim()
        resolve(raw ? JSON.parse(raw) : {})
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

const manager = getWhatsAppBaileysManager()

const server = http.createServer(async (req, res) => {
  try {
    const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
    const pathname = reqUrl.pathname

    if (req.method === 'GET' && pathname === '/health') {
      if (!isAuthorized(req)) {
        return sendJson(res, 200, { ok: true })
      }
      return sendJson(res, 200, {
        ok: true,
        uptimeSec: Math.round(process.uptime()),
        version: manager.version,
        sessions: manager.getActiveSessionsSummary(),
      })
    }

    if (!isAuthorized(req)) {
      return sendJson(res, 401, { error: 'Unauthorized' })
    }

    if (pathname === '/bridge' || pathname === '/api/whatsapp/bridge') {
      if (req.method === 'GET') {
        const businessId = reqUrl.searchParams.get('businessId')?.trim() || ''
        const hold = reqUrl.searchParams.get('hold') === 'true'
        if (!businessId) {
          return sendJson(res, 400, { error: 'businessId es requerido' })
        }
        const state = await manager.getStateAsync(businessId, hold ? 8000 : 0)
        return sendJson(res, 200, state)
      }

      if (req.method === 'POST') {
        const body = await readJsonBody(req)
        const action = String(body?.action || '').trim()
        const businessId = String(body?.businessId || '').trim()

        if (!businessId) {
          return sendJson(res, 400, { error: 'businessId es requerido' })
        }

        if (action === 'connect' || action === 'pair-code') {
          const pairingPhone = String(body?.pairingPhone || '').trim()
          const state = await manager.connect(businessId, {
            pairingPhone: pairingPhone || undefined,
            waitMs: 12000,
          })
          return sendJson(res, 200, state)
        }

        if (action === 'disconnect') {
          const logout = body?.logout !== false
          const state = await manager.disconnect(businessId, logout)
          return sendJson(res, 200, state)
        }

        if (action === 'send') {
          const docId = String(body?.docId || '').trim()
          const phone = String(body?.phone || '').trim()
          const text = String(body?.text || '').trim()
          const replyId = String(body?.replyId || `web_${Date.now()}`).trim()
          const linkPreview =
            body && Object.prototype.hasOwnProperty.call(body, 'linkPreview')
              ? body.linkPreview
              : undefined

          const result = await manager.sendOutgoingMessage(
            businessId,
            docId,
            phone,
            text,
            replyId,
            linkPreview
          )
          return sendJson(res, 200, result)
        }

        if (action === 'react') {
          const docId = String(body?.docId || '').trim()
          const phone = String(body?.phone || '').trim()
          const messageId = String(body?.messageId || '').trim()
          const fromMe = Boolean(body?.fromMe)
          const emoji = String(body?.emoji || '').trim()

          const result = await manager.sendReaction(
            businessId,
            docId,
            phone,
            messageId,
            fromMe,
            emoji
          )
          return sendJson(res, 200, result)
        }

        return sendJson(res, 400, { error: 'Acción no soportada' })
      }
    }

    return sendJson(res, 404, { error: 'Not Found' })
  } catch (err: any) {
    console.error('[Baileys Worker] Error HTTP:', err)
    return sendJson(res, 500, {
      error: err?.message || 'Error interno en worker de WhatsApp',
    })
  }
})

server.listen(PORT, HOST, async () => {
  console.log(`[Baileys Worker] Escuchando en http://${HOST}:${PORT} (v${manager.version})`)
  const autoConnected = await manager.autoConnectRegisteredBusinesses()
  console.log(
    `[Baileys Worker] Negocios auto-conectados al iniciar (${autoConnected.length}): ${autoConnected.join(', ') || 'ninguno'}`
  )
})

// Watchdog cada 60s para recuperar sesiones caídas por errores de red transitorios
const watchdog = setInterval(() => {
  void manager.reconnectIdleSessions()
}, 60_000)

function shutdown(signal: string) {
  console.log(`[Baileys Worker] Recibido ${signal}, cerrando limpiamente...`)
  clearInterval(watchdog)
  try {
    manager.shutdownForUpgrade()
  } catch {
    // Ignorar
  }
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 5000).unref()
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
