import { NextRequest, NextResponse } from 'next/server'
import { ensureAdminDb } from '@/lib/firebase-admin'

export async function GET(request: NextRequest) {
  return handleCheckIn(request)
}

export async function POST(request: NextRequest) {
  return handleCheckIn(request)
}

async function handleCheckIn(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  let businessId = searchParams.get('businessId')
  let action = searchParams.get('action') // 'open' | 'close'
  let date = searchParams.get('date') // YYYY-MM-DD
  let token = searchParams.get('token')

  // Support JSON payload in POST if searchParams are missing
  if (request.method === 'POST' && (!businessId || !action)) {
    try {
      const body = await request.json()
      businessId = businessId || body.businessId
      action = action || body.action
      date = date || body.date
      token = token || body.token
    } catch {
      // Ignore JSON parse errors
    }
  }

  const dashboardUrl = new URL('/business/dashboard', request.url)

  if (!businessId || !action || !date || !token || (action !== 'open' && action !== 'close')) {
    dashboardUrl.searchParams.set('checkin_error', 'invalid_params')
    return NextResponse.redirect(dashboardUrl)
  }

  // Token validation
  const expectedTokenPayload = `${businessId}:${date}:${action}`
  const decodedToken = Buffer.from(token, 'base64url').toString('utf-8')
  if (decodedToken !== expectedTokenPayload && token !== Buffer.from(expectedTokenPayload).toString('base64')) {
    dashboardUrl.searchParams.set('checkin_error', 'invalid_token')
    return NextResponse.redirect(dashboardUrl)
  }

  const adminDb = ensureAdminDb()
  if (!adminDb) {
    dashboardUrl.searchParams.set('checkin_error', 'db_error')
    return NextResponse.redirect(dashboardUrl)
  }

  try {
    const businessRef = adminDb.collection('businesses').doc(businessId)
    const docSnap = await businessRef.get()

    if (!docSnap.exists) {
      dashboardUrl.searchParams.set('checkin_error', 'not_found')
      return NextResponse.redirect(dashboardUrl)
    }

    const businessData = docSnap.data()
    const targetStatus = action === 'open' ? 'open' : 'closed'

    // Actualizar estado de check-in en el negocio manteniendo lastNotificationSentDate
    const updatePayload: Record<string, any> = {
      dailyCheckInState: {
        ...businessData?.dailyCheckInState,
        date,
        status: targetStatus,
        respondedAt: new Date().toISOString(),
        lastNotificationSentDate: businessData?.dailyCheckInState?.lastNotificationSentDate || date
      },
      updatedAt: new Date()
    }

    // Si abrieron manualmente la tienda vía check-in, limpiar cualquier manualStoreStatus que la mantuviera cerrada
    if (targetStatus === 'open' && businessData?.manualStoreStatus === 'closed') {
      updatePayload.manualStoreStatus = null
      updatePayload.manualStatusExpiry = null
    }

    await businessRef.update(updatePayload)

    dashboardUrl.searchParams.set('checkin', targetStatus)
    return NextResponse.redirect(dashboardUrl)
  } catch (error) {
    console.error('Error al procesar check-in diario:', error)
    dashboardUrl.searchParams.set('checkin_error', 'update_failed')
    return NextResponse.redirect(dashboardUrl)
  }
}

