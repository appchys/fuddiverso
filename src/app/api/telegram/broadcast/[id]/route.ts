import { NextRequest, NextResponse } from 'next/server'
import { ensureAdminAuth, ensureAdminDb } from '@/lib/firebase-admin'

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const adminAuth = ensureAdminAuth()
    const db = ensureAdminDb()
    if (!adminAuth || !db) {
      return NextResponse.json(
        { error: 'Firebase Admin no inicializado' },
        { status: 500 }
      )
    }

    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''

    if (!token) {
      return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })
    }

    try {
      await adminAuth.verifyIdToken(token)
    } catch (err: any) {
      return NextResponse.json({ error: 'Token inválido o expirado.' }, { status: 401 })
    }

    if (!id) {
      return NextResponse.json({ error: 'ID requerido' }, { status: 400 })
    }

    const docRef = db.collection('telegramBroadcasts').doc(id)
    const docSnap = await docRef.get()

    if (!docSnap.exists) {
      return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
    }

    const docData = docSnap.data()
    if (!docData || docData.status !== 'pending') {
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
    const adminAuth = ensureAdminAuth()
    const db = ensureAdminDb()
    if (!adminAuth || !db) {
      return NextResponse.json(
        { error: 'Firebase Admin no inicializado' },
        { status: 500 }
      )
    }

    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''

    if (!token) {
      return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })
    }

    try {
      await adminAuth.verifyIdToken(token)
    } catch (err: any) {
      return NextResponse.json({ error: 'Token inválido o expirado.' }, { status: 401 })
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

    const docData = docSnap.data()
    if (!docData || docData.status !== 'pending') {
      return NextResponse.json({ error: 'Solo se pueden editar broadcasts pendientes' }, { status: 400 })
    }

    let scheduledDateString = docData.scheduledAt
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
