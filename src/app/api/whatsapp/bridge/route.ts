import { NextRequest, NextResponse } from 'next/server'
import { getWhatsAppBaileysManager } from '@/lib/whatsapp-baileys-manager'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  try {
    const businessId = req.nextUrl.searchParams.get('businessId')?.trim() || ''
    const hold = req.nextUrl.searchParams.get('hold') === 'true'
    if (!businessId) {
      return NextResponse.json({ error: 'businessId es requerido' }, { status: 400 })
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

      const result = await manager.sendOutgoingMessage(businessId, docId, phone, text, replyId)
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
