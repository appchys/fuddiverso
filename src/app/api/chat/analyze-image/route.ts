import { NextRequest, NextResponse } from 'next/server'
import { ensureAdminAuth, ensureAdminDb } from '@/lib/firebase-admin'
import { processChatImageReceiptForBusiness } from '@/lib/ai-receipt-validator'

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
        { error: 'No tienes permiso para analizar imágenes de esta tienda' },
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
    const imageUrl = String(body?.imageUrl || '').trim()
    const channel: 'whatsapp' | 'instagram' =
      body?.channel === 'instagram' ? 'instagram' : 'whatsapp'
    const force = Boolean(body?.force)

    if (!businessId || !docId || !imageUrl) {
      return NextResponse.json(
        { error: 'businessId, docId e imageUrl son requeridos' },
        { status: 400 }
      )
    }

    const authCheck = await verifyBusinessAccess(req, businessId)
    if (!authCheck.ok) return authCheck.response

    const adminDb = ensureAdminDb()
    let convData: Record<string, any> = {}
    if (adminDb) {
      const convSnap = await adminDb
        .collection('businesses')
        .doc(businessId)
        .collection('whatsappPending')
        .doc(docId)
        .get()
        .catch(() => null)

      if (convSnap?.exists) {
        convData = convSnap.data() || {}
        if (!force) {
          const prevHistory: any[] = Array.isArray(convData.chatHistory) ? convData.chatHistory : []
          const existingEntry = prevHistory.find(
            (e) => e?.mediaUrl && String(e.mediaUrl).trim() === imageUrl
          )
          if (existingEntry?.imageClassification) {
            return NextResponse.json({
              ok: true,
              cached: true,
              classification: existingEntry.imageClassification,
              validation: existingEntry.receiptValidation || null,
              linkedOrderId: existingEntry.linkedOrderId || null,
            })
          }
        }
      }
    }

    const customerPhone =
      String(body?.customerPhone || convData?.phone || convData?.rawPhone || '').trim() || undefined
    const customerClientId =
      String(body?.customerClientId || convData?.fuddiClientId || '').trim() || undefined

    const res = await processChatImageReceiptForBusiness({
      businessId,
      docId,
      imageUrl,
      channel,
      customerPhone,
      customerClientId,
      existingPreorderState: convData?.preorderState || null,
    })

    if (!res) {
      return NextResponse.json(
        { error: 'No se pudo analizar la imagen en este momento.' },
        { status: 502 }
      )
    }

    return NextResponse.json({
      ok: true,
      cached: false,
      classification: res.classification || null,
      validation: res.validation || null,
      linkedOrderId: res.linkedOrderId || null,
    })
  } catch (err: any) {
    console.error('[API /api/chat/analyze-image] Error:', err)
    return NextResponse.json(
      { error: err?.message || 'Error interno analizando la imagen' },
      { status: 500 }
    )
  }
}
