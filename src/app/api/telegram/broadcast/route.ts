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

  if (serviceAccount?.type && !existingApp) {
    const adminApp = initializeApp({
      credential: cert(serviceAccount)
    }, 'telegram-broadcast')
    adminDb = getFirestore(adminApp)
  }

  customerBotToken = process.env.CUSTOMER_BOT_TOKEN || process.env.NEXT_PUBLIC_CUSTOMER_BOT_TOKEN
  return adminDb
}

async function sendTelegramMessage(chatId: string, message: string) {
  if (!customerBotToken) {
    throw new Error('CUSTOMER_BOT_TOKEN no configurado')
  }

  const response = await fetch(`https://api.telegram.org/bot${customerBotToken}/sendMessage`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    })
  })

  const data = await response.json().catch(() => null)
  if (!response.ok || !data?.ok) {
    throw new Error(data?.description || `HTTP ${response.status}`)
  }

  return data
}

export async function POST(request: NextRequest) {
  try {
    const { message } = await request.json()

    if (!message || typeof message !== 'string' || !message.trim()) {
      return NextResponse.json({ error: 'Mensaje requerido' }, { status: 400 })
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

    let successful = 0
    let failed = 0
    const errors: Array<{ clientId?: string; chatId?: string; clientName?: string; error: string }> = []

    await Promise.allSettled(clients.map(async (client: any) => {
      const chatId = String(client.telegramChatId)
      const clientName = client.nombres || client.name || 'Cliente'

      try {
        await sendTelegramMessage(chatId, message.trim())
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
        totalRecipients: clients.length,
        successful,
        failed,
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
