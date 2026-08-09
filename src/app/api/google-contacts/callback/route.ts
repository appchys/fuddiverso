import { NextRequest, NextResponse } from 'next/server'
import { exchangeCodeForContactsTokens, parseContactsOAuthState, saveContactsConnection, TARGET_CENTRAL_EMAIL } from '@/lib/google-contacts'

export async function GET(request: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000'
  const redirectBase = `${appUrl.replace(/\/$/, '')}/admin/dashboard`

  try {
    const code = request.nextUrl.searchParams.get('code')
    const state = request.nextUrl.searchParams.get('state')
    const oauthError = request.nextUrl.searchParams.get('error')

    if (oauthError) {
      const targetUrl = new URL(redirectBase)
      targetUrl.searchParams.set('contacts', 'error')
      targetUrl.searchParams.set('message', oauthError)
      return NextResponse.redirect(targetUrl)
    }

    if (!code || !state) {
      const targetUrl = new URL(redirectBase)
      targetUrl.searchParams.set('contacts', 'error')
      targetUrl.searchParams.set('message', 'Parametros insuficientes en la respuesta de Google')
      return NextResponse.redirect(targetUrl)
    }

    const stateData = parseContactsOAuthState(state)
    if (!stateData) {
      const targetUrl = new URL(redirectBase)
      targetUrl.searchParams.set('contacts', 'error')
      targetUrl.searchParams.set('message', 'Estado de seguridad de OAuth invalido o expirado')
      return NextResponse.redirect(targetUrl)
    }

    const usedRedirectUri = stateData.redirectUri

    const tokens = await exchangeCodeForContactsTokens(code, usedRedirectUri)
    if (!tokens.refresh_token) {
      const targetUrl = new URL(redirectBase)
      targetUrl.searchParams.set('contacts', 'error')
      targetUrl.searchParams.set('message', 'No se recibio un permiso persistente (Refresh Token) de Google. Intenta revocar permisos y conectar de nuevo.')
      return NextResponse.redirect(targetUrl)
    }

    // Save token for Google Contacts
    await saveContactsConnection(tokens.refresh_token, tokens.userEmail || TARGET_CENTRAL_EMAIL)

    const finalBase = usedRedirectUri ? usedRedirectUri.replace('/api/google-contacts/callback', '/admin/dashboard') : redirectBase
    const targetUrl = new URL(finalBase)
    targetUrl.searchParams.set('contacts', 'connected')
    return NextResponse.redirect(targetUrl)
  } catch (error: any) {
    console.error('[api/google-contacts/callback] Error:', error)
    const targetUrl = new URL(redirectBase)
    targetUrl.searchParams.set('contacts', 'error')
    targetUrl.searchParams.set('message', error.message || 'Error al completar la vinculacion con Google Contacts')
    return NextResponse.redirect(targetUrl)
  }
}
