import { NextRequest, NextResponse } from 'next/server'
import { exchangeCodeForTokens, parseOAuthState, saveGmailConnection } from '@/lib/finance-gmail'

export async function GET(request: NextRequest) {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || request.nextUrl.origin).replace(/\/$/, '')
  const dashboardUrl = new URL('/business/dashboard', appUrl)
  dashboardUrl.searchParams.set('tab', 'finance')

  try {
    const code = request.nextUrl.searchParams.get('code')
    const state = request.nextUrl.searchParams.get('state')
    const error = request.nextUrl.searchParams.get('error')

    if (error) {
      dashboardUrl.searchParams.set('gmail', 'error')
      dashboardUrl.searchParams.set('message', error)
      return NextResponse.redirect(dashboardUrl)
    }

    if (!code || !state) {
      dashboardUrl.searchParams.set('gmail', 'error')
      dashboardUrl.searchParams.set('message', 'missing_code')
      return NextResponse.redirect(dashboardUrl)
    }

    const context = parseOAuthState(state)
    if (!context) {
      dashboardUrl.searchParams.set('gmail', 'error')
      dashboardUrl.searchParams.set('message', 'invalid_state')
      return NextResponse.redirect(dashboardUrl)
    }

    const tokens = await exchangeCodeForTokens(code)
    await saveGmailConnection(context, tokens)

    dashboardUrl.searchParams.set('gmail', 'connected')
    return NextResponse.redirect(dashboardUrl)
  } catch (error: any) {
    console.error('[finance/gmail/callback] Error:', error)
    dashboardUrl.searchParams.set('gmail', 'error')
    dashboardUrl.searchParams.set('message', error.message || 'callback_error')
    return NextResponse.redirect(dashboardUrl)
  }
}
