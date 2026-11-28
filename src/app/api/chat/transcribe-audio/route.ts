import { NextRequest, NextResponse } from 'next/server'
import { ensureAdminAuth, ensureAdminDb } from '@/lib/firebase-admin'
import { processChatAudioTranscriptionForBusiness } from '@/lib/ai-audio-transcriber'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

async function verifyBusinessAccess(
  req: NextRequest,
  businessId: string
): Promise<{ ok: true; uid: string } | { ok: false; response: NextResponse }> {
  const adminAuth = ensureAdminAuth()
  const adminDb = ensureAdminDb()

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
        { error: 'No tienes permiso para transcribir audios de esta tienda' },
        { status: 403 }
      ),
    }
  }

  return { ok: true, uid }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const businessId = String(body?.businessId || '').trim()
    const docId = String(body?.docId || '').trim()
    const messageId = typeof body?.messageId === 'string' ? body.messageId.trim() : undefined
    const audioUrl = String(body?.audioUrl || '').trim()
    const force = Boolean(body?.force)

    if (!businessId || !docId || !audioUrl) {
      return NextResponse.json(
        { error: 'businessId, docId y audioUrl son requeridos' },
        { status: 400 }
      )
    }

    const authCheck = await verifyBusinessAccess(req, businessId)
    if (!authCheck.ok) return authCheck.response

    const result = await processChatAudioTranscriptionForBusiness({
      businessId,
      docId,
      audioUrl,
      messageId,
      force,
    })

    if (!result?.transcription) {
      return NextResponse.json(
        {
          error:
            'No se pudo transcribir el audio en este momento. Verifica la configuración de IA o intenta nuevamente.',
        },
        { status: 502 }
      )
    }

    return NextResponse.json({
      ok: true,
      transcription: result.transcription,
      cached: Boolean(result.cached),
    })
  } catch (err: any) {
    console.error('[API /api/chat/transcribe-audio] Error:', err)
    return NextResponse.json(
      { error: err?.message || 'Error interno transcribiendo el audio' },
      { status: 500 }
    )
  }
}
