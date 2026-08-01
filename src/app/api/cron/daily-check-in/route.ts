import { NextRequest, NextResponse } from 'next/server'
import { ensureAdminDb } from '@/lib/firebase-admin'
import { getTodayDateString } from '@/lib/store-utils'
import { getCheckInUrls, sendTelegramCheckIn, sendEmailCheckIn } from '@/lib/checkin-notifications'
import { Business } from '@/types'

export async function GET(request: NextRequest) {
  return handleCronDailyCheckIn(request)
}

export async function POST(request: NextRequest) {
  return handleCronDailyCheckIn(request)
}

async function handleCronDailyCheckIn(request: NextRequest) {
  const adminDb = ensureAdminDb()
  if (!adminDb) {
    return NextResponse.json({ error: 'Firebase Admin no está configurado.' }, { status: 500 })
  }

  const { searchParams } = new URL(request.url)
  const forceBusinessId = searchParams.get('businessId')
  const todayStr = getTodayDateString(new Date())

  try {
    let query: any = adminDb.collection('businesses').where('requireDailyCheckIn', '==', true)
    
    if (forceBusinessId) {
      const singleDoc = await adminDb.collection('businesses').doc(forceBusinessId).get()
      if (!singleDoc.exists) {
        return NextResponse.json({ error: 'Negocio especificado no encontrado' }, { status: 404 })
      }
      const bizData = { id: singleDoc.id, ...singleDoc.data() } as Business
      const result = await processSingleBusinessCheckIn(adminDb, bizData, todayStr, true)
      return NextResponse.json({ success: true, processed: [result] })
    }

    const snapshot = await query.get()
    const results: any[] = []

    for (const doc of snapshot.docs) {
      const bizData = { id: doc.id, ...doc.data() } as Business
      if (bizData.isActive === false) continue

      const result = await processSingleBusinessCheckIn(adminDb, bizData, todayStr, false)
      results.push(result)
    }

    return NextResponse.json({
      success: true,
      date: todayStr,
      totalConfigured: snapshot.size,
      processedCount: results.length,
      details: results
    })

  } catch (error) {
    console.error('Error en Cron Check-in Diario:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error desconocido' }, { status: 500 })
  }
}

async function processSingleBusinessCheckIn(adminDb: any, business: Business, dateStr: string, force: boolean) {
  const checkInState = business.dailyCheckInState

  // Verificar si ya se envió la notificación hoy (para evitar envíos repetidos en ejecuciones frecuentes)
  if (!force && checkInState?.lastNotificationSentDate === dateStr) {
    return {
      businessId: business.id,
      name: business.name,
      status: 'skipped',
      reason: 'Notificación de check-in ya enviada el día de hoy'
    }
  }

  const now = new Date()
  const dayNamesEn = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  const dayNamesEs = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
  const currentDayEn = dayNamesEn[now.getDay()]
  const currentDayEs = dayNamesEs[now.getDay()]

  const scheduleKeys = Object.keys(business.schedule || {})
  const todayKey = scheduleKeys.find(k => {
    const lower = k.toLowerCase()
    return lower === currentDayEn || lower === currentDayEs
  })

  const todaySchedule = todayKey ? business.schedule[todayKey] : null
  const openingTime = todaySchedule?.open || 'tu hora de apertura'

  // Verificar si falta 15 minutos antes de la hora de apertura (salvo que sea envío forzado)
  if (!force) {
    if (!todaySchedule || !todaySchedule.isOpen || !todaySchedule.open) {
      return {
        businessId: business.id,
        name: business.name,
        status: 'skipped',
        reason: 'La tienda no abre el día de hoy'
      }
    }

    const openTimeClean = todaySchedule.open.trim()
    const parts = openTimeClean.split(':')
    if (parts.length >= 2) {
      const openH = parseInt(parts[0])
      const openM = parseInt(parts[1])
      
      if (!isNaN(openH) && !isNaN(openM)) {
        const openMinutes = openH * 60 + openM
        const currentMinutes = now.getHours() * 60 + now.getMinutes()
        const minsUntilOpening = openMinutes - currentMinutes

        // Enviar 15 minutos antes de abrir (o más tarde si el cron corrió durante la jornada)
        if (minsUntilOpening > 15) {
          return {
            businessId: business.id,
            name: business.name,
            status: 'skipped',
            reason: `Aún no es momento (faltan ${minsUntilOpening} min para abrir a las ${todaySchedule.open}). Se enviará 15 minutos antes.`
          }
        }
      }
    }
  }

  const { openUrl, closeUrl } = getCheckInUrls(business.id, dateStr)

  // Enviar Telegram y Email (15 minutos antes de la hora de apertura)
  const telegramRes = await sendTelegramCheckIn(business, dateStr, openUrl, closeUrl, openingTime)
  const emailRes = await sendEmailCheckIn(business, dateStr, openUrl, closeUrl, openingTime)

  // Registrar fecha de notificación enviada y estado inicial pendiente en dailyCheckInState
  const newCheckInState = {
    date: dateStr,
    status: (checkInState?.date === dateStr ? checkInState.status : 'pending') as 'open' | 'closed' | 'pending',
    lastNotificationSentDate: dateStr,
    updatedAt: new Date().toISOString()
  }

  await adminDb.collection('businesses').doc(business.id).update({
    dailyCheckInState: newCheckInState,
    updatedAt: new Date()
  })

  return {
    businessId: business.id,
    name: business.name,
    status: 'sent',
    telegramSent: telegramRes.success,
    telegramChatCount: telegramRes.sentCount,
    emailSent: emailRes.success
  }
}
