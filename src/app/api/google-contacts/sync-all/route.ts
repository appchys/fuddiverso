import { NextResponse } from 'next/server'
import { createGoogleContact, getContactsConnection } from '@/lib/google-contacts'
import { ensureAdminDb } from '@/lib/firebase-admin'

export async function POST() {
  try {
    const connection = await getContactsConnection()
    if (!connection || connection.status !== 'connected') {
      return NextResponse.json({
        success: false,
        message: 'Google Contacts no está conectado. Primero debes vincular tu cuenta de Google.'
      }, { status: 400 })
    }

    const adminDb = ensureAdminDb()
    if (!adminDb) {
      return NextResponse.json({ error: 'Base de datos no disponible.' }, { status: 500 })
    }

    const snapshot = await adminDb.collection('clients').get()
    if (snapshot.empty) {
      return NextResponse.json({
        success: true,
        total: 0,
        syncedCount: 0,
        message: 'No hay clientes registrados para sincronizar.'
      })
    }

    const clients = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }))

    let syncedCount = 0
    let failedCount = 0
    const errors: string[] = []

    for (const client of clients) {
      const nombres = (client as any).nombres || (client as any).name || (client as any).celular
      const celular = (client as any).celular || (client as any).phone

      if (!celular && !nombres) continue

      try {
        await createGoogleContact({
          name: nombres || celular,
          phone: celular,
          email: (client as any).email,
          notes: (client as any).notas || 'Cliente de Fuddiverso'
        })
        syncedCount++

        // Pequeña pausa para no sobrepasar límites de tasa de la API de Google
        await new Promise(resolve => setTimeout(resolve, 200))
      } catch (err: any) {
        failedCount++
        if (errors.length < 5) {
          errors.push(`${nombres || celular}: ${err.message}`)
        }
      }
    }

    return NextResponse.json({
      success: true,
      total: clients.length,
      syncedCount,
      failedCount,
      errors
    })
  } catch (error: any) {
    console.error('[api/google-contacts/sync-all] Error:', error)
    return NextResponse.json({
      success: false,
      error: error.message || 'Error durante la sincronización masiva.'
    }, { status: 500 })
  }
}
