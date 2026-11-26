import { NextRequest, NextResponse } from 'next/server'
import { sendInstagramDirectMessage } from '@/lib/instagram-messaging'

export const dynamic = 'force-dynamic'

/**
 * POST /api/instagram/send
 * Envía un mensaje directo de Instagram desde la bandeja unificada (Web o Android).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const businessId = String(body?.businessId || '').trim()
    const docId = String(body?.docId || '').trim()
    const recipientId = String(body?.recipientId || '').trim()
    const text = String(body?.text || '').trim()
    const mediaUrl = body?.mediaUrl ? String(body.mediaUrl).trim() : null

    const result = await sendInstagramDirectMessage({
      businessId,
      docId: docId || undefined,
      recipientId,
      text,
      mediaUrl,
    })

    if (!result.ok) {
      return NextResponse.json(result, { status: 400 })
    }
    return NextResponse.json(result)
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'Error al enviar mensaje de Instagram' },
      { status: 500 }
    )
  }
}
