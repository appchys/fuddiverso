import { NextRequest, NextResponse } from 'next/server'
import { getWhatsAppBaileysManager } from '@/lib/whatsapp-baileys-manager'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const WORKER_URL = (process.env.WHATSAPP_WORKER_URL || '').trim().replace(/\/+$/, '')
const WORKER_SECRET = (process.env.WHATSAPP_WORKER_SECRET || '').trim()

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

    return NextResponse.json({ error: 'Acción no soportada' }, { status: 400 })
  } catch (err: any) {
    console.error('[API /api/whatsapp/bridge] Error:', err)
    return NextResponse.json(
      { error: err?.message || 'Error interno en el puente de WhatsApp' },
      { status: 500 }
    )
  }
}
