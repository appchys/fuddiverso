import { NextRequest, NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { ensureAdminAuth, ensureAdminDb } from '@/lib/firebase-admin'

export async function POST(request: NextRequest) {
  try {
    const adminAuth = ensureAdminAuth()
    const adminDb = ensureAdminDb()

    if (!adminAuth || !adminDb) {
      return NextResponse.json({ error: 'Firebase Admin no está configurado.' }, { status: 500 })
    }

    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''

    if (!token) {
      return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })
    }

    // Verify token
    let decodedToken;
    try {
      decodedToken = await adminAuth.verifyIdToken(token)
    } catch (err: any) {
      console.error('❌ Error validando token en API Broadcast:', err.message)
      return NextResponse.json({ error: 'Token inválido o expirado.' }, { status: 401 })
    }

    const body = await request.json()
    const { message, button, scheduledAt } = body

    if (!message || typeof message !== 'string' || !message.trim()) {
      return NextResponse.json({ error: 'El mensaje es requerido.' }, { status: 400 })
    }

    // If scheduledAt is provided and is in the future, save to Firestore as pending
    if (scheduledAt) {
      const scheduledDate = new Date(scheduledAt)
      if (isNaN(scheduledDate.getTime())) {
        return NextResponse.json({ error: 'Fecha programada inválida.' }, { status: 400 })
      }
      
      if (scheduledDate <= new Date()) {
        return NextResponse.json({ error: 'La fecha programada debe estar en el futuro.' }, { status: 400 })
      }

      const docRef = await adminDb.collection('telegramBroadcasts').add({
        message: message.trim(),
        button: button || null,
        status: 'pending',
        scheduledAt: scheduledDate.toISOString(),
        createdAt: FieldValue.serverTimestamp()
      })

      return NextResponse.json({
        success: true,
        message: 'Broadcast programado exitosamente.',
        id: docRef.id
      })
    }

    // If not scheduled, send immediately via Cloud Function
    const cfResponse = await fetch('https://us-central1-multitienda-69778.cloudfunctions.net/sendTelegramBroadcast', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ message, button })
    })

    if (!cfResponse.ok) {
      const errorText = await cfResponse.text()
      try {
        const errorJson = JSON.parse(errorText)
        return NextResponse.json({ error: errorJson.error || errorJson.message || 'Error en Cloud Function' }, { status: cfResponse.status })
      } catch {
        return NextResponse.json({ error: `Error en Cloud Function: ${errorText}` }, { status: cfResponse.status })
      }
    }

    const result = await cfResponse.json()
    return NextResponse.json(result)

  } catch (error) {
    console.error('[Telegram Broadcast] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error desconocido' },
      { status: 500 }
    )
  }
}
