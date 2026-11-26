import { NextRequest, NextResponse } from 'next/server'
import {
  processIncomingInstagramWebhook,
  verifyInstagramWebhookSignature,
} from '@/lib/instagram-messaging'

export const dynamic = 'force-dynamic'

/**
 * GET /api/instagram/webhook
 * Verificación inicial del Webhook requerida por Meta for Developers.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  const expectedToken =
    process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN?.trim() || 'fuddi_instagram_verify_token'

  if (mode === 'subscribe' && token === expectedToken && challenge) {
    return new NextResponse(challenge, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })
  }

  return NextResponse.json({ error: 'Verification failed' }, { status: 403 })
}

/**
 * POST /api/instagram/webhook
 * Recibe mensajes entrantes de Instagram DM en tiempo real.
 */
export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text()
    const signature = req.headers.get('x-hub-signature-256')

    if (!verifyInstagramWebhookSignature(rawBody, signature)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
    }

    const payload = JSON.parse(rawBody || '{}')
    const result = await processIncomingInstagramWebhook(payload)
    return NextResponse.json({ ok: true, processed: result.processed })
  } catch (err: any) {
    console.error('[Instagram Webhook] Error:', err)
    return NextResponse.json({ ok: false, error: err?.message || 'Error' }, { status: 500 })
  }
}
