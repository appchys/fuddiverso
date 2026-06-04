import { NextRequest, NextResponse } from 'next/server'
import { buildGoogleAuthUrl, getMissingGoogleOAuthConfig, requireFinanceAuth } from '@/lib/finance-gmail'

export async function GET(request: NextRequest) {
  try {
    const missing = getMissingGoogleOAuthConfig()
    if (missing.length > 0) {
      return NextResponse.json({
        error: `Faltan variables de entorno: ${missing.join(', ')}`
      }, { status: 500 })
    }

    const context = await requireFinanceAuth(request)
    if (context instanceof NextResponse) return context

    return NextResponse.json({
      authUrl: buildGoogleAuthUrl(context)
    })
  } catch (error: any) {
    console.error('[finance/gmail/connect] Error:', error)
    return NextResponse.json({ error: error.message || 'No se pudo iniciar la conexion con Gmail.' }, { status: 500 })
  }
}
