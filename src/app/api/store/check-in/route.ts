import { NextRequest, NextResponse } from 'next/server'
import { ensureAdminDb } from '@/lib/firebase-admin'
import { sendAdminCheckInNotification } from '@/lib/checkin-notifications'

export async function GET(request: NextRequest) {
  return handleCheckIn(request)
}

export async function POST(request: NextRequest) {
  return handleCheckIn(request)
}

async function handleCheckIn(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  let businessId = searchParams.get('businessId')
  let action = searchParams.get('action') // 'open' | 'close' | 'closed' | 'desconfirm'
  let date = searchParams.get('date') // YYYY-MM-DD
  let token = searchParams.get('token')
  let source = searchParams.get('source')

  const isJsonRequest = request.headers.get('accept')?.includes('application/json') || 
                        request.headers.get('content-type')?.includes('application/json') ||
                        source === 'Dashboard'

  // Support JSON payload in POST if searchParams are missing
  if (request.method === 'POST' && (!businessId || !action)) {
    try {
      const body = await request.json()
      businessId = businessId || body.businessId
      action = action || body.action
      date = date || body.date
      token = token || body.token
      source = source || body.source
    } catch {
      // Ignore JSON parse errors
    }
  }

  if (!source) {
    source = 'Correo'
  }

  const dashboardUrl = new URL('/business/dashboard', request.url)

  const normalizedAction = action === 'closed' ? 'close' : action

  if (!businessId || !normalizedAction || !date || (normalizedAction !== 'open' && normalizedAction !== 'close' && normalizedAction !== 'desconfirm')) {
    if (isJsonRequest) {
      return NextResponse.json({ success: false, error: 'Parámetros inválidos' }, { status: 400 })
    }
    dashboardUrl.searchParams.set('checkin_error', 'invalid_params')
    return NextResponse.redirect(dashboardUrl)
  }

  // Token validation (si viene de Dashboard o token provisto)
  if (token) {
    const expectedTokenPayload = `${businessId}:${date}:${normalizedAction}`
    const decodedToken = Buffer.from(token, 'base64url').toString('utf-8')
    const decodedBase64 = Buffer.from(token, 'base64').toString('utf-8')
    
    if (decodedToken !== expectedTokenPayload && decodedBase64 !== expectedTokenPayload && token !== Buffer.from(expectedTokenPayload).toString('base64')) {
      if (isJsonRequest) {
        return NextResponse.json({ success: false, error: 'Token inválido' }, { status: 403 })
      }
      dashboardUrl.searchParams.set('checkin_error', 'invalid_token')
      return NextResponse.redirect(dashboardUrl)
    }
  } else if (source !== 'Dashboard') {
    if (isJsonRequest) {
      return NextResponse.json({ success: false, error: 'Token requerido' }, { status: 403 })
    }
    dashboardUrl.searchParams.set('checkin_error', 'invalid_token')
    return NextResponse.redirect(dashboardUrl)
  }

  const adminDb = ensureAdminDb()
  if (!adminDb) {
    if (isJsonRequest) {
      return NextResponse.json({ success: false, error: 'Error de base de datos' }, { status: 500 })
    }
    dashboardUrl.searchParams.set('checkin_error', 'db_error')
    return NextResponse.redirect(dashboardUrl)
  }

  try {
    const businessRef = adminDb.collection('businesses').doc(businessId)
    const docSnap = await businessRef.get()

    if (!docSnap.exists) {
      if (isJsonRequest) {
        return NextResponse.json({ success: false, error: 'Negocio no encontrado' }, { status: 404 })
      }
      dashboardUrl.searchParams.set('checkin_error', 'not_found')
      return NextResponse.redirect(dashboardUrl)
    }

    const businessData = docSnap.data()
    const targetStatus: 'open' | 'closed' | 'pending' = 
      normalizedAction === 'open' ? 'open' : (normalizedAction === 'close' ? 'closed' : 'pending')
    const adminAction: 'open' | 'closed' | 'desconfirm' = 
      normalizedAction === 'open' ? 'open' : (normalizedAction === 'close' ? 'closed' : 'desconfirm')

    // Actualizar estado de check-in en el negocio manteniendo lastNotificationSentDate
    const updatePayload: Record<string, any> = {
      dailyCheckInState: {
        ...businessData?.dailyCheckInState,
        date,
        status: targetStatus,
        respondedAt: targetStatus === 'pending' ? null : new Date().toISOString(),
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

    // Notificar al Admin por Telegram para todas las acciones (open, closed, desconfirm)
    try {
      await sendAdminCheckInNotification(businessData?.name || businessId, date, source, adminAction)
    } catch (adminNotifErr) {
      console.error('Error al enviar notificación de check-in a admin:', adminNotifErr)
    }

    if (isJsonRequest) {
      return NextResponse.json({ success: true, status: targetStatus, action: adminAction })
    }

    dashboardUrl.searchParams.set('checkin', targetStatus)
    return NextResponse.redirect(dashboardUrl)
  } catch (error) {
    console.error('Error al procesar check-in diario:', error)
    if (isJsonRequest) {
      return NextResponse.json({ success: false, error: 'Fallo en actualización' }, { status: 500 })
    }
    dashboardUrl.searchParams.set('checkin_error', 'update_failed')
    return NextResponse.redirect(dashboardUrl)
  }
}

