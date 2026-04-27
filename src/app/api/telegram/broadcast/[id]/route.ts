import { NextRequest, NextResponse } from 'next/server'
import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import * as fs from 'fs'
import * as path from 'path'

let adminDb: any = null

function ensureAdminDb() {
  if (adminDb) return adminDb

  let serviceAccount: any = null

  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    try {
      let keyString = process.env.FIREBASE_SERVICE_ACCOUNT_KEY
      if (keyString.includes('\\n')) {
        keyString = keyString.replace(/\\n/g, '\n')
      }
      serviceAccount = JSON.parse(keyString)
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

  return adminDb
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = ensureAdminDb()
    if (!db) {
      return NextResponse.json(
        { error: 'Firebase Admin no inicializado' },
        { status: 500 }
      )
    }

    if (!id) {
      return NextResponse.json({ error: 'ID requerido' }, { status: 400 })
    }

    const docRef = db.collection('telegramBroadcasts').doc(id)
    const docSnap = await docRef.get()

    if (!docSnap.exists) {
      return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    }

    if (docSnap.data().status !== 'pending') {
      return NextResponse.json({ error: 'Solo se pueden eliminar broadcasts pendientes' }, { status: 400 })
    }

    await docRef.delete()

    return NextResponse.json({ success: true, message: 'Broadcast eliminado' }, { status: 200 })
  } catch (error) {
    console.error('[Telegram Broadcast] Error eliminando:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error desconocido' },
      { status: 500 }
    )
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = ensureAdminDb()
    if (!db) {
      return NextResponse.json(
        { error: 'Firebase Admin no inicializado' },
        { status: 500 }
      )
    }

    if (!id) {
      return NextResponse.json({ error: 'ID requerido' }, { status: 400 })
    }

    const data = await request.json()
    const { message, button, scheduledAt } = data

    if (!message || typeof message !== 'string' || !message.trim()) {
      return NextResponse.json({ error: 'Mensaje requerido' }, { status: 400 })
    }

    const docRef = db.collection('telegramBroadcasts').doc(id)
    const docSnap = await docRef.get()

    if (!docSnap.exists) {
      return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    }

    if (docSnap.data().status !== 'pending') {
      return NextResponse.json({ error: 'Solo se pueden editar broadcasts pendientes' }, { status: 400 })
    }

    let scheduledDateString = docSnap.data().scheduledAt
    if (scheduledAt) {
      const scheduledDate = new Date(scheduledAt)
      if (isNaN(scheduledDate.getTime())) {
        return NextResponse.json({ error: 'Fecha programada inválida' }, { status: 400 })
      }
      scheduledDateString = scheduledDate.toISOString()
    }

    await docRef.update({
      message: message.trim(),
      button: button || null,
      scheduledAt: scheduledDateString
    })

    return NextResponse.json({ success: true, message: 'Broadcast actualizado' }, { status: 200 })
  } catch (error) {
    console.error('[Telegram Broadcast] Error actualizando:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error desconocido' },
      { status: 500 }
    )
  }
}
