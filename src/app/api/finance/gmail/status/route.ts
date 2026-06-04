import { NextRequest, NextResponse } from 'next/server'
import { getGmailConnection, getMissingGoogleOAuthConfig, requireFinanceAuth } from '@/lib/finance-gmail'

export async function GET(request: NextRequest) {
  try {
    const context = await requireFinanceAuth(request)
    if (context instanceof NextResponse) return context

    const connection = await getGmailConnection(context.businessId)
    const scopes = Array.isArray(connection?.scopes) ? connection.scopes : []
    const canLabelMessages = scopes.includes('https://www.googleapis.com/auth/gmail.modify')

    return NextResponse.json({
      connected: connection?.status === 'connected',
      configured: getMissingGoogleOAuthConfig().length === 0,
      canLabelMessages,
      missingConfig: getMissingGoogleOAuthConfig(),
      connectedEmail: connection?.connectedEmail || null,
      updatedAt: connection?.updatedAt || null,
      lastImportAt: connection?.lastImportAt || null,
      lastImportCount: connection?.lastImportCount || 0
    })
  } catch (error: any) {
    console.error('[finance/gmail/status] Error:', error)
    return NextResponse.json({ error: error.message || 'No se pudo consultar Gmail.' }, { status: 500 })
  }
}
