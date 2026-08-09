import { NextRequest, NextResponse } from 'next/server'
import { buildGoogleContactsAuthUrl, getMissingContactsOAuthConfig } from '@/lib/google-contacts'

export async function GET(request: NextRequest) {
  try {
    const missing = getMissingContactsOAuthConfig()
    if (missing.length > 0) {
      return NextResponse.json({
        error: `Faltan las siguientes variables de entorno para Google Contacts: ${missing.join(', ')}`
      }, { status: 400 })
    }

    const host = request.headers.get('x-forwarded-host') || request.headers.get('host')
    const proto = request.headers.get('x-forwarded-proto') || (request.nextUrl.protocol ? request.nextUrl.protocol.replace(':', '') : 'https')
    const origin = host ? `${proto}://${host}` : request.nextUrl.origin
    const redirectUri = `${origin.replace(/\/$/, '')}/api/google-contacts/callback`

    const authUrl = buildGoogleContactsAuthUrl({
      requestedAt: Date.now(),
      redirectUri
    }, redirectUri)

    return NextResponse.redirect(authUrl)
  } catch (error: any) {
    console.error('[api/google-contacts/connect] Error:', error)
    return NextResponse.json({ error: error.message || 'Error al iniciar OAuth con Google Contacts' }, { status: 500 })
  }
}
