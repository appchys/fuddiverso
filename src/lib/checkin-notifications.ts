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

  const openUrl = `${cleanHost}/api/store/check-in?businessId=${businessId}&action=open&date=${date}&token=${openToken}`
  const closeUrl = `${cleanHost}/api/store/check-in?businessId=${businessId}&action=close&date=${date}&token=${closeToken}`

  return { openUrl, closeUrl }
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

  const timeLabel = openingTime ? `a las *${openingTime}*` : 'hoy'
  const messageText = `☀️ *¿Listo para abrir? Confirma para empezar a recibir pedidos en ${business.name}*\n\n¡Abres en 15 minutos! 👋 (${timeLabel})\nEs momento de confirmar la apertura de tu tienda para el día de hoy (*${date}*).`

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
                { text: '🟢 Abrir Tienda', callback_data: `checkin_open|${business.id}|${date}` },
                { text: '🔴 Mantener Cerrada', callback_data: `checkin_close|${business.id}|${date}` }
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

  const openingLabel = openingTime ? `a las ${openingTime}` : 'hoy'
  const subject = `¿Listo para abrir? Confirma para empezar a recibir pedidos en ${business.name}`
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #f4f6f9; color: #1e293b; margin: 0; padding: 20px; }
        .container { max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 20px; padding: 32px; border: 1px solid #e2e8f0; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
        .badge { display: inline-block; background: #e0e7ff; color: #3730a3; font-weight: bold; font-size: 12px; padding: 4px 12px; border-radius: 9999px; text-transform: uppercase; margin-bottom: 16px; }
        h1 { font-size: 24px; font-weight: 900; margin: 0 0 8px 0; color: #0f172a; }
        p { font-size: 15px; color: #64748b; line-height: 1.6; margin: 0 0 24px 0; }
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
        <h1>⏰ ¡Abres en 15 minutos, ${business.name}!</h1>
        <p>Tu tienda está programada para abrir ${openingLabel}. Por favor confirma si abrirás hoy para comenzar a recibir pedidos:</p>
        
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 20px 0;">
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
