import { NextResponse } from 'next/server'
import { getContactsConnection, getMissingContactsOAuthConfig } from '@/lib/google-contacts'

export async function GET() {
  try {
    const missing = getMissingContactsOAuthConfig()
    const connection = await getContactsConnection()

    return NextResponse.json({
      configured: missing.length === 0,
      missingConfig: missing,
      connected: connection?.status === 'connected',
      connectedEmail: connection?.connectedEmail || null,
      updatedAt: connection?.updatedAt || null
    })
  } catch (error: any) {
    console.error('[api/google-contacts/status] Error:', error)
    return NextResponse.json({
      configured: false,
      connected: false,
      error: error.message || 'Error al consultar estado de Google Contacts'
    }, { status: 500 })
  }
}
