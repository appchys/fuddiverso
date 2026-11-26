import { NextRequest, NextResponse } from 'next/server'
import { ensureAdminDb } from '@/lib/firebase-admin'

export const dynamic = 'force-dynamic'

/**
 * GET /api/instagram/connect?businessId=...
 * Redirige al OAuth de Instagram Login (Meta for Developers).
 */
export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url)
  const businessId = searchParams.get('businessId')?.trim()
  if (!businessId) {
    return NextResponse.json({ error: 'Falta businessId' }, { status: 400 })
  }

  const appId = process.env.INSTAGRAM_APP_ID?.trim()
  if (!appId) {
    return NextResponse.json(
      {
        error:
          'Falta configurar INSTAGRAM_APP_ID en las variables de entorno. Puedes usar la conexión manual con token mientras configuras tu App en Meta.',
      },
      { status: 503 }
    )
  }

  const redirectUri =
    process.env.INSTAGRAM_REDIRECT_URI?.trim() || `${origin}/api/instagram/callback`
  const state = Buffer.from(JSON.stringify({ businessId })).toString('base64url')

  const authUrl = new URL('https://www.instagram.com/oauth/authorize')
  authUrl.searchParams.set('enable_fb_login', '0')
  authUrl.searchParams.set('force_authentication', '1')
  authUrl.searchParams.set('client_id', appId)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set(
    'scope',
    'instagram_business_basic,instagram_business_manage_messages'
  )
  authUrl.searchParams.set('state', state)

  return NextResponse.redirect(authUrl.toString())
}

/**
 * POST /api/instagram/connect
 * Permite conectar manualmente con un Access Token de Instagram o desconectar la cuenta.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const businessId = String(body?.businessId || '').trim()
    const action = String(body?.action || 'connect_manual').trim()

    if (!businessId) {
      return NextResponse.json({ ok: false, error: 'Falta businessId' }, { status: 400 })
    }

    const db = ensureAdminDb()
    if (!db) {
      return NextResponse.json({ ok: false, error: 'Base de datos no disponible' }, { status: 500 })
    }

    const connRef = db
      .collection('businesses')
      .doc(businessId)
      .collection('instagramConnection')
      .doc('status')

    if (action === 'disconnect') {
      const prevSnap = await connRef.get().catch(() => null)
      const prevIgId = String(prevSnap?.data()?.instagramAccountId || '').trim()
      if (prevIgId) {
        await db.collection('instagramAccountsIndex').doc(prevIgId).delete().catch(() => {})
      }
      await connRef.set(
        {
          status: 'disconnected',
          instagramAccountId: null,
          instagramUsername: null,
          accessToken: null,
          updatedAtMillis: Date.now(),
        },
        { merge: true }
      )
      return NextResponse.json({ ok: true })
    }

    if (action === 'resubscribe') {
      const prevSnap = await connRef.get().catch(() => null)
      const prevData = prevSnap?.data() || {}
      const token = String(prevData.accessToken || '').trim()
      if (!token) {
        return NextResponse.json({ ok: false, error: 'No hay token guardado para suscribir.' }, { status: 400 })
      }
      const meRes = await fetch(
        `https://graph.instagram.com/v21.0/me?fields=id,user_id,username&access_token=${encodeURIComponent(token)}`,
        { cache: 'no-store' }
      )
      const meData = await meRes.json().catch(() => ({}))
      const subRes = await fetch(
        `https://graph.instagram.com/v21.0/me/subscribed_apps?subscribed_fields=messages&access_token=${encodeURIComponent(token)}`,
        { method: 'POST' }
      )
      const subData = await subRes.json().catch(() => ({}))
      const indexIds = Array.from(
        new Set([String(meData?.user_id || '').trim(), String(meData?.id || '').trim(), String(prevData.instagramAccountId || '').trim()].filter(Boolean))
      )
      const nowMs = Date.now()
      await Promise.all(
        indexIds.map((idxId) =>
          db.collection('instagramAccountsIndex').doc(idxId).set(
            {
              businessId,
              instagramUsername: meData?.username || prevData.instagramUsername || null,
              updatedAtMillis: nowMs,
            },
            { merge: true }
          )
        )
      )
      return NextResponse.json({
        ok: subRes.ok,
        subscribed: subData,
        indexedIds: indexIds,
        error: subRes.ok ? undefined : subData?.error?.message || 'Error al suscribir webhooks',
      })
    }

    const accessToken = String(body?.accessToken || '').trim()
    if (!accessToken) {
      return NextResponse.json(
        { ok: false, error: 'Debes pegar el Access Token de Instagram' },
        { status: 400 }
      )
    }

    // Validar token contra Graph API
    let igAccountId = String(body?.instagramAccountId || '').trim()
    let igUsername = String(body?.instagramUsername || '').trim().replace(/^@/, '')

    try {
      const meRes = await fetch(
        `https://graph.instagram.com/v21.0/me?fields=id,user_id,username&access_token=${encodeURIComponent(
          accessToken
        )}`,
        { cache: 'no-store' }
      )
      const meData = await meRes.json().catch(() => ({}))
      if (!meRes.ok) {
        return NextResponse.json(
          {
            ok: false,
            error: meData?.error?.message || 'Token de Instagram inválido o expirado',
          },
          { status: 400 }
        )
      }
      igAccountId = String(meData?.user_id || meData?.id || igAccountId).trim()
      igUsername = String(meData?.username || igUsername).trim()
    } catch (err: any) {
      return NextResponse.json(
        { ok: false, error: err?.message || 'No se pudo validar el token con Instagram' },
        { status: 400 }
      )
    }

    if (!igAccountId) {
      return NextResponse.json(
        { ok: false, error: 'No se pudo obtener el ID de la cuenta de Instagram' },
        { status: 400 }
      )
    }

    const nowMs = Date.now()
    await Promise.all([
      connRef.set(
        {
          status: 'connected',
          instagramAccountId: igAccountId,
          instagramUsername: igUsername || null,
          accessToken,
          updatedAtMillis: nowMs,
        },
        { merge: true }
      ),
      db.collection('instagramAccountsIndex').doc(igAccountId).set(
        {
          businessId,
          instagramUsername: igUsername || null,
          updatedAtMillis: nowMs,
        },
        { merge: true }
      ),
    ])

    return NextResponse.json({
      ok: true,
      instagramAccountId: igAccountId,
      instagramUsername: igUsername || null,
    })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || 'Error' }, { status: 500 })
  }
}
