import { NextRequest, NextResponse } from 'next/server'
import { ensureAdminDb } from '@/lib/firebase-admin'

export const dynamic = 'force-dynamic'

/**
 * GET /api/instagram/callback
 * Recibe el código OAuth de Instagram, obtiene el token de larga duración y vincula la cuenta a la tienda.
 */
export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url)
  const code = searchParams.get('code')
  const stateRaw = searchParams.get('state')
  const errorReason = searchParams.get('error_description') || searchParams.get('error')

  const dashboardUrl = `${origin}/business/dashboard`

  if (errorReason || !code || !stateRaw) {
    return NextResponse.redirect(
      `${dashboardUrl}?ig_error=${encodeURIComponent(errorReason || 'Autorización cancelada')}`
    )
  }

  let businessId = ''
  try {
    const parsed = JSON.parse(Buffer.from(stateRaw, 'base64url').toString('utf8'))
    businessId = String(parsed?.businessId || '').trim()
  } catch {
    return NextResponse.redirect(`${dashboardUrl}?ig_error=Estado+OAuth+invalido`)
  }

  const appId = process.env.INSTAGRAM_APP_ID?.trim()
  const appSecret = process.env.INSTAGRAM_APP_SECRET?.trim()
  const redirectUri =
    process.env.INSTAGRAM_REDIRECT_URI?.trim() || `${origin}/api/instagram/callback`

  if (!appId || !appSecret || !businessId) {
    return NextResponse.redirect(`${dashboardUrl}?ig_error=Faltan+credenciales+de+Instagram`)
  }

  try {
    // 1. Intercambiar code por short-lived token
    const form = new URLSearchParams()
    form.set('client_id', appId)
    form.set('client_secret', appSecret)
    form.set('grant_type', 'authorization_code')
    form.set('redirect_uri', redirectUri)
    form.set('code', code)

    const tokenRes = await fetch('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      body: form,
    })
    const tokenData = await tokenRes.json().catch(() => ({}))
    if (!tokenRes.ok || !tokenData?.access_token) {
      throw new Error(tokenData?.error_message || 'No se pudo obtener el token de Instagram')
    }

    let finalToken = String(tokenData.access_token)
    let expiresInSec = 3600

    // 2. Intercambiar por long-lived token (60 días)
    try {
      const longUrl = new URL('https://graph.instagram.com/access_token')
      longUrl.searchParams.set('grant_type', 'ig_exchange_token')
      longUrl.searchParams.set('client_secret', appSecret)
      longUrl.searchParams.set('access_token', finalToken)
      const longRes = await fetch(longUrl.toString())
      const longData = await longRes.json().catch(() => ({}))
      if (longRes.ok && longData?.access_token) {
        finalToken = String(longData.access_token)
        expiresInSec = Number(longData.expires_in || 5184000)
      }
    } catch {
      // Conservar short-lived si falla el intercambio
    }

    // 3. Obtener ID profesional y @username
    const meRes = await fetch(
      `https://graph.instagram.com/v21.0/me?fields=id,user_id,username&access_token=${encodeURIComponent(
        finalToken
      )}`
    )
    const meData = await meRes.json().catch(() => ({}))
    const igUserId = String(meData?.user_id || '').trim()
    const igScopedId = String(meData?.id || tokenData?.user_id || '').trim()
    const igAccountId = igUserId || igScopedId
    const igUsername = String(meData?.username || '').trim()

    // 4. Suscribir la cuenta de Instagram al webhook de mensajes (obligatorio en Meta para recibir DMs)
    try {
      const subRes = await fetch(
        `https://graph.instagram.com/v21.0/me/subscribed_apps?subscribed_fields=messages&access_token=${encodeURIComponent(
          finalToken
        )}`,
        { method: 'POST' }
      )
      const subData = await subRes.json().catch(() => ({}))
      console.log('[Instagram OAuth] subscribed_apps:', subRes.status, JSON.stringify(subData))
    } catch (subErr) {
      console.warn('[Instagram OAuth] Error en subscribed_apps:', subErr)
    }

    const db = ensureAdminDb()
    if (!db || !igAccountId) {
      throw new Error('No se pudo guardar la vinculación de Instagram')
    }

    const nowMs = Date.now()
    const indexIds = Array.from(new Set([igUserId, igScopedId].filter(Boolean)))
    await Promise.all([
      db
        .collection('businesses')
        .doc(businessId)
        .collection('instagramConnection')
        .doc('status')
        .set(
          {
            status: 'connected',
            instagramAccountId: igAccountId,
            instagramScopedId: igScopedId || null,
            instagramUsername: igUsername || null,
            accessToken: finalToken,
            tokenExpiresAtMillis: nowMs + expiresInSec * 1000,
            updatedAtMillis: nowMs,
          },
          { merge: true }
        ),
      ...indexIds.map((idxId) =>
        db.collection('instagramAccountsIndex').doc(idxId).set(
          {
            businessId,
            instagramUsername: igUsername || null,
            updatedAtMillis: nowMs,
          },
          { merge: true }
        )
      ),
    ])

    return NextResponse.redirect(`${dashboardUrl}?ig_connected=1`)
  } catch (err: any) {
    return NextResponse.redirect(
      `${dashboardUrl}?ig_error=${encodeURIComponent(err?.message || 'Error al vincular Instagram')}`
    )
  }
}
