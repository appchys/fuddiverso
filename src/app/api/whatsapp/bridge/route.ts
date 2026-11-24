import { NextRequest, NextResponse } from 'next/server'
import { ensureAdminAuth, ensureAdminDb } from '@/lib/firebase-admin'
import {
  ADMIN_WHATSAPP_SESSION_ID,
  getWhatsAppBaileysManager,
} from '@/lib/whatsapp-baileys-manager'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const WORKER_URL = (process.env.WHATSAPP_WORKER_URL || '').trim().replace(/\/+$/, '')
const WORKER_SECRET = (process.env.WHATSAPP_WORKER_SECRET || '').trim()
const ALLOWED_ACTIONS = new Set([
  'connect',
  'pair-code',
  'disconnect',
  'send',
  'react',
  'mark-read',
  'notify-store-order',
  'publish-status',
])
const MAX_MESSAGE_LENGTH = 4000

async function verifyBusinessAccess(
  req: NextRequest,
  businessId: string
): Promise<{ ok: true; uid: string } | { ok: false; response: NextResponse }> {
  const adminAuth = ensureAdminAuth()
  const adminDb = ensureAdminDb()

  // Para la sesión global de WhatsApp del Administrador (/admin)
  if (businessId === ADMIN_WHATSAPP_SESSION_ID) {
    const adminHeader = (req.headers.get('x-fuddi-admin') || '').trim()
    if (adminHeader === 'authenticated') {
      return { ok: true, uid: 'fuddi-admin' }
    }
    const authHeader = req.headers.get('authorization') || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
    if (token && adminAuth) {
      try {
        const decoded = await adminAuth.verifyIdToken(token)
        return { ok: true, uid: String(decoded?.uid || 'fuddi-admin') }
      } catch {
        // continuar a respuesta 401
      }
    }
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Se requiere sesión de Administrador (/admin) para gestionar este WhatsApp' },
        { status: 401 }
      ),
    }
  }

  if (!adminAuth || !adminDb) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Servicio de autenticación no disponible' },
        { status: 500 }
      ),
    }
  }

  const authHeader = req.headers.get('authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
  if (!token) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'No autenticado' }, { status: 401 }),
    }
  }

  let decoded: any
  try {
    decoded = await adminAuth.verifyIdToken(token)
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Sesión inválida o expirada' }, { status: 401 }),
    }
  }

  const uid = String(decoded?.uid || '')
  const email = String(decoded?.email || '').trim().toLowerCase()
  const tokenBusinessId = String(decoded?.businessId || '').trim()

  const bizSnap = await adminDb.collection('businesses').doc(businessId).get()
  if (!bizSnap.exists) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Negocio no encontrado' }, { status: 404 }),
    }
  }

  const biz = bizSnap.data() || {}
  const ownerId = String(biz.ownerId || '')
  const bizEmail = String(biz.email || '').trim().toLowerCase()
  const adminEmails: string[] = Array.isArray(biz.adminEmails)
    ? biz.adminEmails.map((e: any) => String(e || '').trim().toLowerCase())
    : []
  const administrators: any[] = Array.isArray(biz.administrators) ? biz.administrators : []

  const isAuthorized =
    (uid && ownerId && uid === ownerId) ||
    (tokenBusinessId && tokenBusinessId === businessId) ||
    (email && bizEmail && email === bizEmail) ||
    (email && adminEmails.includes(email)) ||
    administrators.some(
      (a) =>
        (uid && a?.uid && String(a.uid) === uid) ||
        (email && a?.email && String(a.email).trim().toLowerCase() === email)
    )

  if (!isAuthorized) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'No tienes permiso para acceder al WhatsApp de esta tienda' },
        { status: 403 }
      ),
    }
  }

  return { ok: true, uid }
}

async function proxyToWorker(
  method: 'GET' | 'POST',
  queryString: string,
  body?: unknown
): Promise<NextResponse> {
  const targetUrl = `${WORKER_URL}/bridge${queryString ? `?${queryString}` : ''}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 35_000)

  try {
    const headers: Record<string, string> = {}
    if (WORKER_SECRET) {
      headers['x-worker-secret'] = WORKER_SECRET
    }
    if (method === 'POST') {
      headers['Content-Type'] = 'application/json'
    }

    const res = await fetch(targetUrl, {
      method,
      headers,
      body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
      cache: 'no-store',
      signal: controller.signal,
    })

    const text = await res.text()
    try {
      const json = text ? JSON.parse(text) : {}
      return NextResponse.json(json, { status: res.status })
    } catch {
      return NextResponse.json(
        { error: text || `Respuesta inesperada del worker (${res.status})` },
        { status: res.status }
      )
    }
  } catch (err: any) {
    console.error(`[API ${method} /api/whatsapp/bridge] Error conectando al worker:`, err)
    return NextResponse.json(
      { error: err?.message || 'No se pudo conectar con el servidor de WhatsApp' },
      { status: 502 }
    )
  } finally {
    clearTimeout(timer)
  }
}

export async function GET(req: NextRequest) {
  try {
    const businessId = req.nextUrl.searchParams.get('businessId')?.trim() || ''
    const hold = req.nextUrl.searchParams.get('hold') === 'true'
    if (!businessId) {
      return NextResponse.json({ error: 'businessId es requerido' }, { status: 400 })
    }

    const authCheck = await verifyBusinessAccess(req, businessId)
    if (!authCheck.ok) return authCheck.response

    if (WORKER_URL) {
      return await proxyToWorker('GET', req.nextUrl.searchParams.toString())
    }

    const manager = getWhatsAppBaileysManager()
    const state = await manager.getStateAsync(businessId, hold ? 8000 : 0)
    return NextResponse.json(state)
  } catch (err: any) {
    console.error('[API GET /api/whatsapp/bridge] Error:', err)
    return NextResponse.json(
      { error: err?.message || 'Error consultando estado de WhatsApp' },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const action = String(body?.action || '').trim()
    const businessId = String(body?.businessId || '').trim()

    if (!businessId) {
      return NextResponse.json({ error: 'businessId es requerido' }, { status: 400 })
    }

    if (!ALLOWED_ACTIONS.has(action)) {
      return NextResponse.json({ error: 'Acción no soportada' }, { status: 400 })
    }

    const authCheck = await verifyBusinessAccess(req, businessId)
    if (!authCheck.ok) return authCheck.response

    if (action === 'send') {
      const text = String(body?.text || '').trim()
      if (!text || text.length > MAX_MESSAGE_LENGTH) {
        return NextResponse.json(
          { error: `El mensaje debe tener entre 1 y ${MAX_MESSAGE_LENGTH} caracteres` },
          { status: 400 }
        )
      }
    }

    if (action === 'publish-status') {
      const text = String(body?.text || '').trim()
      if (!text || text.length > 700) {
        return NextResponse.json(
          { error: 'El estado debe tener entre 1 y 700 caracteres' },
          { status: 400 }
        )
      }
    }

    if (WORKER_URL) {
      return await proxyToWorker('POST', '', body)
    }

    const manager = getWhatsAppBaileysManager()

    if (action === 'connect' || action === 'pair-code') {
      const pairingPhone = String(body?.pairingPhone || '').trim()
      const state = await manager.connect(businessId, {
        pairingPhone: pairingPhone || undefined,
        waitMs: 12000,
      })
      return NextResponse.json(state)
    }

    if (action === 'disconnect') {
      const logout = body?.logout !== false
      const state = await manager.disconnect(businessId, logout)
      return NextResponse.json(state)
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
      return NextResponse.json(result)
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
      return NextResponse.json(result)
    }

    if (action === 'mark-read') {
      const docId = String(body?.docId || '').trim()
      const phone = String(body?.phone || '').trim()
      const messageIds = Array.isArray(body?.messageIds)
        ? body.messageIds.map((id: any) => String(id || '').trim()).filter(Boolean)
        : undefined

      const result = await manager.markConversationAsRead(
        businessId,
        docId,
        phone,
        messageIds
      )
      return NextResponse.json(result)
    }

    if (action === 'notify-store-order') {
      const targetBusinessId = String(body?.targetBusinessId || body?.businessId || '').trim()
      const orderId = String(body?.orderId || '').trim()
      const orderData = body?.orderData && typeof body.orderData === 'object' ? body.orderData : undefined
      const result = await manager.notifyStoreNewOrderViaAdminWhatsApp({
        businessId: targetBusinessId,
        orderId,
        orderData,
      })
      return NextResponse.json(result)
    }

    if (action === 'publish-status') {
      const text = String(body?.text || '').trim()
      const url = String(body?.url || '').trim() || undefined
      const backgroundColor = String(body?.backgroundColor || '').trim() || undefined
      const font = typeof body?.font === 'number' ? body.font : undefined
      const linkPreview =
        body && Object.prototype.hasOwnProperty.call(body, 'linkPreview')
          ? body.linkPreview
          : undefined

      const result = await manager.publishStatus(businessId, {
        text,
        url,
        linkPreview,
        backgroundColor,
        font,
      })
      return NextResponse.json(result)
    }

    return NextResponse.json({ error: 'Acción no soportada' }, { status: 400 })
  } catch (err: any) {
    console.error('[API /api/whatsapp/bridge] Error:', err)
    return NextResponse.json(
      { error: err?.message || 'Error interno en el puente de WhatsApp' },
      { status: 500 }
    )
  }
}
