import { Business } from '@/types'
import { getTodayDateString } from '@/lib/store-utils'

/**
 * Genera el token de seguridad para los enlaces de Check-in
 */
export function generateCheckInToken(businessId: string, date: string, action: 'open' | 'close'): string {
  const payload = `${businessId}:${date}:${action}`
  return Buffer.from(payload).toString('base64url')
}

/**
 * Construye los enlaces completos para la acción de Check-in
 */
export function getCheckInUrls(businessId: string, date: string, baseUrl?: string) {
  const host = baseUrl || process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'https://fuddi.app'
  const cleanHost = host.replace(/\/$/, '')
  
  const openToken = generateCheckInToken(businessId, date, 'open')
  const closeToken = generateCheckInToken(businessId, date, 'close')

  const openUrl = `${cleanHost}/api/store/check-in?businessId=${businessId}&action=open&date=${date}&token=${openToken}&source=Correo`
  const closeUrl = `${cleanHost}/api/store/check-in?businessId=${businessId}&action=close&date=${date}&token=${closeToken}&source=Correo`

  return { openUrl, closeUrl }
}

function formatSpanishDate(dateStr?: string): string {
  let dateObj = new Date()
  if (dateStr) {
    const parts = dateStr.split('-')
    if (parts.length === 3) {
      dateObj = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10))
    }
  }
  const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
  const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
  
  const dayName = days[dateObj.getDay()]
  const dayNum = dateObj.getDate()
  const monthName = months[dateObj.getMonth()]

  return `Hoy ${dayName} ${dayNum} de ${monthName}`
}

/**
 * Formatea la fecha para la notificación del Administrador (ej: "hoy viernes 7 de agosto")
 */
export function formatCheckInAdminDate(dateStr?: string): string {
  let dateObj = new Date()
  if (dateStr) {
    const parts = dateStr.split('-')
    if (parts.length === 3) {
      dateObj = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10))
    }
  }
  const days = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
  const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

  const dayName = days[dateObj.getDay()]
  const dayNum = dateObj.getDate()
  const monthName = months[dateObj.getMonth()]

  return `hoy ${dayName} ${dayNum} de ${monthName}`
}

/**
 * Envía la notificación de estado de check-in al Admin por Telegram
 */
export async function sendAdminCheckInNotification(
  storeName: string,
  dateStr: string,
  source: string = 'Telegram',
  action: 'open' | 'closed' | 'desconfirm' = 'open'
): Promise<{ success: boolean }> {
  const botToken = process.env.ADMIN_BOT_TOKEN || process.env.STORE_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN
  if (!botToken) {
    console.warn('[Admin Check-in Notification] No hay token de bot de Telegram configurado.')
    return { success: false }
  }

  let adminChatId = process.env.ADMIN_TELEGRAM_CHAT_ID || process.env.TELEGRAM_ADMIN_CHAT_ID

  // Si no está en env, intentar obtenerlo de Firestore settings/admin_telegram
  if (!adminChatId) {
    try {
      const { ensureAdminDb } = await import('@/lib/firebase-admin')
      const adminDb = ensureAdminDb()
      if (adminDb) {
        const docSnap = await adminDb.collection('settings').doc('admin_telegram').get()
        if (docSnap.exists) {
          adminChatId = docSnap.data()?.chatId
        }
      }
    } catch (err) {
      console.warn('[Admin Check-in Notification] Error obteniendo admin_telegram de Firestore:', err)
    }
  }

  if (!adminChatId) {
    console.warn('[Admin Check-in Notification] No se encontró Chat ID de Admin para enviar la notificación.')
    return { success: false }
  }

  const formattedDate = formatCheckInAdminDate(dateStr)
  let messageText = ''

  if (action === 'open') {
    messageText = `🟢 *${storeName}* ha hecho check-in (Abierto) para ${formattedDate} desde ${source}`
  } else if (action === 'closed') {
    messageText = `🔴 *${storeName}* ha confirmado MANTENER CERRADA la tienda para ${formattedDate} desde ${source}`
  } else if (action === 'desconfirm') {
    messageText = `🔄 *${storeName}* ha DESCONFIRMADO su check-in para ${formattedDate} desde ${source}`
  } else {
    messageText = `ℹ️ *${storeName}* ha actualizado su estado de check-in (${action}) para ${formattedDate} desde ${source}`
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: adminChatId,
        text: messageText,
        parse_mode: 'Markdown'
      })
    })

    if (res.ok) {
      console.log(`[Admin Check-in Notification] Notificación enviada a Admin (${adminChatId}): ${messageText}`)
      return { success: true }
    } else {
      const errJson = await res.json().catch(() => ({}))
      console.error('[Admin Check-in Notification] Error de la API de Telegram:', errJson)
      return { success: false }
    }
  } catch (err) {
    console.error('[Admin Check-in Notification] Excepción al enviar notificación a Admin:', err)
    return { success: false }
  }
}

/**
 * Envía la notificación de Check-in por Telegram
 */
export async function sendTelegramCheckIn(
  business: Business,
  date: string,
  openUrl: string,
  closeUrl: string,
  openingTime?: string
): Promise<{ success: boolean; sentCount: number }> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  if (!botToken) {
    console.warn('[Telegram Check-in] TELEGRAM_BOT_TOKEN no está configurado en las variables de entorno.')
    return { success: false, sentCount: 0 }
  }

  // Recopilar IDs de chat de Telegram asignados al negocio
  const chatIds = new Set<string>()
  if (business.telegramChatIds && Array.isArray(business.telegramChatIds)) {
    business.telegramChatIds.forEach(id => id && chatIds.add(id))
  }
  if (business.telegramChatId) {
    chatIds.add(business.telegramChatId)
  }

  if (chatIds.size === 0) {
    console.log(`[Telegram Check-in] La tienda "${business.name}" (${business.id}) no tiene chats de Telegram vinculados.`)
    return { success: false, sentCount: 0 }
  }

  const storeName = business.name || 'tu tienda'
  const formattedDate = formatSpanishDate(date)
  const openingLabel = openingTime ? `abres de las ${openingTime}` : 'abres hoy'
  const messageText = `☀️ *${storeName}, ¿Listo para abrir?*\n\n${formattedDate} ${openingLabel}, confirma tu apertura para empezar a recibir pedidos!`

  let successCount = 0

  for (const chatId of Array.from(chatIds)) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: messageText,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '🟢 Abrir Tienda', url: openUrl },
                { text: '🔴 Mantener Cerrada', url: closeUrl }
              ]
            ]
          }
        })
      })

      if (res.ok) {
        successCount++
      } else {
        const errJson = await res.json().catch(() => ({}))
        console.error(`[Telegram Check-in] Error al enviar a chat ${chatId}:`, errJson)
      }
    } catch (err) {
      console.error(`[Telegram Check-in] Excepción al enviar a chat ${chatId}:`, err)
    }
  }

  return { success: successCount > 0, sentCount: successCount }
}

/**
 * Envía la notificación de Check-in por Correo Electrónico
 */
export async function sendEmailCheckIn(
  business: Business,
  date: string,
  openUrl: string,
  closeUrl: string,
  openingTime?: string
): Promise<{ success: boolean }> {
  const resendApiKey = process.env.RESEND_API_KEY
  
  // Recopilar correos del negocio
  const emails = new Set<string>()
  if (business.email) emails.add(business.email.trim().toLowerCase())
  if (business.adminEmails && Array.isArray(business.adminEmails)) {
    business.adminEmails.forEach(e => e && emails.add(e.trim().toLowerCase()))
  }
  if (business.administrators && Array.isArray(business.administrators)) {
    business.administrators.forEach(a => a.email && emails.add(a.email.trim().toLowerCase()))
  }

  const recipientList = Array.from(emails).filter(Boolean)

  if (recipientList.length === 0) {
    console.log(`[Email Check-in] La tienda "${business.name}" (${business.id}) no tiene correos electrónicos configurados.`)
    return { success: false }
  }

  const storeName = business.name || 'tu tienda'
  const formattedDate = formatSpanishDate(date)
  const openingLabel = openingTime ? `abres de las ${openingTime}` : 'abres hoy'
  const subject = `☀️ ${storeName}, ¿Listo para abrir?`
  const bodyText = `${formattedDate} ${openingLabel}, confirma tu apertura para empezar a recibir pedidos!`

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #f4f6f9; color: #1e293b; margin: 0; padding: 20px; }
        .container { max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 20px; padding: 32px; border: 1px solid #e2e8f0; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
        .badge { display: inline-block; background: #e0e7ff; color: #3730a3; font-weight: bold; font-size: 12px; padding: 4px 12px; border-radius: 9999px; text-transform: uppercase; margin-bottom: 16px; }
        h1 { font-size: 24px; font-weight: 900; margin: 0 0 12px 0; color: #0f172a; }
        p { font-size: 15px; color: #475569; line-height: 1.6; margin: 0 0 24px 0; }
        .button-group { display: flex; gap: 12px; margin-top: 24px; margin-bottom: 24px; }
        .btn { flex: 1; text-align: center; padding: 14px 20px; border-radius: 14px; font-weight: bold; text-decoration: none; font-size: 15px; display: inline-block; }
        .btn-open { background-color: #10b981; color: #ffffff; }
        .btn-close { background-color: #ef4444; color: #ffffff; }
        .footer { font-size: 12px; color: #94a3b8; text-align: center; margin-top: 32px; border-top: 1px solid #f1f5f9; padding-top: 16px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="badge">Check-in Diario • ${date}</div>
        <h1>☀️ ${storeName}, ¿Listo para abrir?</h1>
        <p>${bodyText}</p>
        
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 24px 0;">
          <tr>
            <td align="center" style="padding-right: 8px;">
              <a href="${openUrl}" class="btn btn-open" style="background:#10b981; color:#ffffff; padding:14px 24px; border-radius:12px; font-weight:bold; text-decoration:none; display:inline-block; width:80%;">🟢 Abrir Tienda</a>
            </td>
            <td align="center" style="padding-left: 8px;">
              <a href="${closeUrl}" class="btn btn-close" style="background:#ef4444; color:#ffffff; padding:14px 24px; border-radius:12px; font-weight:bold; text-decoration:none; display:inline-block; width:80%;">🔴 Mantener Cerrada</a>
            </td>
          </tr>
        </table>

        <p style="font-size:13px; color:#94a3b8;">Si no confirmas la apertura, tu tienda permanecerá cerrada para proteger la atención a tus clientes.</p>

        <div class="footer">
          Fuddi • Sistema de Check-in Diario para Negocios
        </div>
      </div>
    </body>
    </html>
  `

  if (resendApiKey) {
    try {
      const { Resend } = await import('resend')
      const resend = new Resend(resendApiKey)

      const fromEmail = process.env.RESEND_FROM_EMAIL || 'Fuddi Check-in <notificaciones@fuddi.app>'
      await resend.emails.send({
        from: fromEmail,
        to: recipientList,
        subject,
        html: htmlContent
      })

      console.log(`[Email Check-in] Correo enviado exitosamente a ${recipientList.join(', ')}`)
      return { success: true }
    } catch (error) {
      console.error('[Email Check-in] Error al enviar con Resend:', error)
    }
  } else {
    console.warn(`[Email Check-in] RESEND_API_KEY no configurado. Notificación preparada para ${recipientList.join(', ')}`)
  }

  return { success: false }
}

/**
 * Envía el resumen diario por Telegram al Admin a las 7:00 PM con los negocios que:
 * 1. Hicieron check-in (abiertos)
 * 2. NO hicieron check-in (cerrados o pendientes)
 * 3. Tienen activado check-in automático (no requieren confirmación manual)
 */
export async function sendDailyCheckInSummaryReport(
  dateStr?: string
): Promise<{ success: boolean; summaryText?: string }> {
  const targetDate = dateStr || getTodayDateString(new Date())
  
  const botToken = process.env.ADMIN_BOT_TOKEN || process.env.STORE_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN
  if (!botToken) {
    console.warn('[Check-in Summary] No hay bot token configurado.')
    return { success: false }
  }

  let adminChatId = process.env.ADMIN_TELEGRAM_CHAT_ID || process.env.TELEGRAM_ADMIN_CHAT_ID

  const { ensureAdminDb } = await import('@/lib/firebase-admin')
  const adminDb = ensureAdminDb()

  if (!adminDb) {
    console.error('[Check-in Summary] No se pudo obtener la instancia de Firebase Admin.')
    return { success: false }
  }

  if (!adminChatId) {
    try {
      const docSnap = await adminDb.collection('settings').doc('admin_telegram').get()
      if (docSnap.exists) {
        adminChatId = docSnap.data()?.chatId
      }
    } catch (err) {
      console.warn('[Check-in Summary] Error leyendo admin_telegram settings:', err)
    }
  }

  if (!adminChatId) {
    console.warn('[Check-in Summary] No hay Chat ID de Admin para enviar el resumen.')
    return { success: false }
  }

  try {
    const snapshot = await adminDb.collection('businesses').get()
    
    const checkedIn: string[] = []
    const notCheckedIn: { name: string; reason: string }[] = []
    const automaticCheckIn: string[] = []

    snapshot.docs.forEach(doc => {
      const biz = doc.data()
      if (biz.isActive === false) return

      const name = biz.name || doc.id
      const requiresManual = biz.requireDailyCheckIn === true

      if (!requiresManual) {
        automaticCheckIn.push(name)
      } else {
        const state = biz.dailyCheckInState
        if (state?.date === targetDate && state?.status === 'open') {
          checkedIn.push(name)
        } else if (state?.date === targetDate && state?.status === 'closed') {
          notCheckedIn.push({ name, reason: 'Confirmó Cerrada' })
        } else {
          notCheckedIn.push({ name, reason: 'Sin respuesta' })
        }
      }
    })

    const formattedDate = formatCheckInAdminDate(targetDate)
    
    let text = `📋 *Resumen de Check-in Diario - ${formattedDate}*\n\n`

    text += `🟢 *Hicieron Check-in (${checkedIn.length})*:\n`
    if (checkedIn.length > 0) {
      checkedIn.forEach(name => {
        text += `• ${name}\n`
      })
    } else {
      text += `_(Ninguno)_\n`
    }
    text += `\n`

    text += `🔴 *NO hicieron Check-in (${notCheckedIn.length})*:\n`
    if (notCheckedIn.length > 0) {
      notCheckedIn.forEach(item => {
        text += `• ${item.name} _(${item.reason})_\n`
      })
    } else {
      text += `_(Ninguno)_\n`
    }
    text += `\n`

    text += `⚡ *Check-in Automático Activado (${automaticCheckIn.length})*:\n`
    if (automaticCheckIn.length > 0) {
      automaticCheckIn.forEach(name => {
        text += `• ${name}\n`
      })
    } else {
      text += `_(Ninguno)_\n`
    }

    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: adminChatId,
        text,
        parse_mode: 'Markdown'
      })
    })

    if (res.ok) {
      console.log(`[Check-in Summary] Resumen diario enviado exitosamente a Admin (${adminChatId})`)
      return { success: true, summaryText: text }
    } else {
      const errJson = await res.json().catch(() => ({}))
      console.error('[Check-in Summary] Error enviando reporte por Telegram:', errJson)
      return { success: false }
    }

  } catch (error) {
    console.error('[Check-in Summary] Excepción al generar resumen diario:', error)
    return { success: false }
  }
}

