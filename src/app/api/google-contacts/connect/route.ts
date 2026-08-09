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

    const authUrl = buildGoogleContactsAuthUrl({
      requestedAt: Date.now()
    })

    return NextResponse.redirect(authUrl)
  } catch (error: any) {
    console.error('[api/google-contacts/connect] Error:', error)
    return NextResponse.json({ error: error.message || 'Error al iniciar OAuth con Google Contacts' }, { status: 500 })
  }
}
