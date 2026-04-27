import { NextRequest, NextResponse } from 'next/server'
import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import * as fs from 'fs'
import * as path from 'path'

let adminDb: any = null
let customerBotToken: string | undefined

function ensureAdminDb() {
  if (adminDb) return adminDb

  let serviceAccount: any = null

  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    try {
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)
    } catch (error) {
      console.warn('[Telegram Broadcast] Error al parsear FIREBASE_SERVICE_ACCOUNT_KEY:', error)
    }
  }

  if (!serviceAccount) {
    try {
      const credentialsPath = path.join(
        process.cwd(),
        'multitienda-69778-firebase-adminsdk-fbsvc-496524456f.json'
      )
      if (fs.existsSync(credentialsPath)) {
        serviceAccount = JSON.parse(fs.readFileSync(credentialsPath, 'utf-8'))
      }
    } catch (error) {
      console.warn('[Telegram Broadcast] No se pudieron leer las credenciales admin:', error)
    }
  }

  const existingApp = getApps().find((app) => app.name === 'telegram-broadcast')

  if (existingApp) {
    adminDb = getFirestore(existingApp)
  } else if (serviceAccount?.type) {
    const adminApp = initializeApp({
      credential: cert(serviceAccount)
    }, 'telegram-broadcast')
    adminDb = getFirestore(adminApp)
  }

  customerBotToken = process.env.CUSTOMER_BOT_TOKEN || process.env.NEXT_PUBLIC_CUSTOMER_BOT_TOKEN
  return adminDb
}

async function sendTelegramMessage(
  chatId: string,
  message: string,
  replyMarkup?: {
    inline_keyboard: Array<Array<{
      text: string
      url: string
    }>>
  }
) {
  if (!customerBotToken) {
    throw new Error('CUSTOMER_BOT_TOKEN no configurado')
  }

  const payload: any = {
    chat_id: chatId,
    text: message,
    parse_mode: 'HTML',
    disable_web_page_preview: true
  }

  if (replyMarkup) {
    payload.reply_markup = replyMarkup
  }

  const response = await fetch(`https://api.telegram.org/bot${customerBotToken}/sendMessage`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  })

  const data = await response.json().catch(() => null)
  if (!response.ok || !data?.ok) {
    throw new Error(data?.description || `HTTP ${response.status}`)
  }

  return data
}

export async function POST(request: NextRequest) {
  try {
    const { message, button, scheduledAt } = await request.json()

    if (!message || typeof message !== 'string' || !message.trim()) {
      return NextResponse.json({ error: 'Mensaje requerido' }, { status: 400 })
    }

    let replyMarkup: {
      inline_keyboard: Array<Array<{
        text: string
        url: string
      }>>
    } | undefined

    if (button != null) {
      const buttonText = typeof button?.text === 'string' ? button.text.trim() : ''
      const buttonUrl = typeof button?.url === 'string' ? button.url.trim() : ''

      if (!buttonText || !buttonUrl) {
        return NextResponse.json(
          { error: 'Si configuras un botón, debes indicar texto y URL' },
          { status: 400 }
        )
      }

      try {
        const parsedUrl = new URL(buttonUrl)
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
          throw new Error('La URL debe usar http o https')
        }
      } catch {
        return NextResponse.json(
          { error: 'La URL del botón no es válida' },
          { status: 400 }
        )
      }

      replyMarkup = {
        inline_keyboard: [[
          {
            text: buttonText,
            url: buttonUrl
          }
        ]]
      }
    }

    const db = ensureAdminDb()
    if (!db) {
      return NextResponse.json(
        { error: 'Firebase Admin no inicializado' },
        { status: 500 }
      )
    }

    const snapshot = await db.collection('clients').get()
    const clients = snapshot.docs
      .map((doc: any) => ({ id: doc.id, ...doc.data() }))
      .filter((client: any) => client.telegramChatId)

    if (clients.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'Sin clientes con Telegram vinculado',
        stats: { total: 0, successful: 0, failed: 0 },
        errors: []
      }, { status: 200 })
    }

    // Si tiene scheduledAt, solo guardar en la base de datos
    if (scheduledAt) {
      const scheduledDate = new Date(scheduledAt)
      if (isNaN(scheduledDate.getTime())) {
        return NextResponse.json({ error: 'Fecha programada inválida' }, { status: 400 })
      }

      try {
        await db.collection('telegramBroadcasts').add({
          message: message.trim(),
          button: button || null, // Guardamos el botón en la BD para reconstruirlo al enviar
          totalRecipients: clients.length,
          status: 'pending',
          scheduledAt: scheduledDate.toISOString(),
          createdAt: FieldValue.serverTimestamp(),
        })

        return NextResponse.json({
          success: true,
          message: `Broadcast programado para ${scheduledDate.toLocaleString()}`,
          stats: { total: clients.length, successful: 0, failed: 0 },
          errors: []
        }, { status: 200 })
      } catch (error) {
        console.error('[Telegram Broadcast] Error programando:', error)
        return NextResponse.json(
          { error: 'No se pudo programar el broadcast' },
          { status: 500 }
        )
      }
    }

    let successful = 0
    let failed = 0
    const errors: Array<{ clientId?: string; chatId?: string; clientName?: string; error: string }> = []

    await Promise.allSettled(clients.map(async (client: any) => {
      const chatId = String(client.telegramChatId)
      const clientName = client.nombres || client.name || 'Cliente'

      try {
        await sendTelegramMessage(chatId, message.trim(), replyMarkup)
        successful += 1
      } catch (error) {
        failed += 1
        errors.push({
          clientId: client.id,
          chatId,
          clientName,
          error: error instanceof Error ? error.message : 'Error desconocido'
        })
      }
    }))

    try {
      await db.collection('telegramBroadcasts').add({
        message: message.trim(),
        button: button || null,
        totalRecipients: clients.length,
        successful,
        failed,
        status: 'completed',
        createdAt: FieldValue.serverTimestamp(),
        timestamp: new Date().toISOString(),
        errors: errors.slice(0, 10)
      })
    } catch (error) {
      console.warn('[Telegram Broadcast] No se pudo guardar el log del broadcast:', error)
    }

    return NextResponse.json({
      success: true,
      message: `Broadcast completado. ${successful}/${clients.length} mensajes enviados exitosamente.`,
      stats: {
        total: clients.length,
        successful,
        failed
      },
      errors
    }, { status: 200 })
  } catch (error) {
    console.error('[Telegram Broadcast] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error desconocido' },
      { status: 500 }
    )
  }
}
