import { NextRequest, NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { createGoogleContact, getContactsConnection } from '@/lib/google-contacts'
import { ensureAdminDb } from '@/lib/firebase-admin'

export async function POST(request: NextRequest) {
  try {
    const connection = await getContactsConnection()
    if (!connection || connection.status !== 'connected') {
      return NextResponse.json({
        success: false,
        message: 'Google Contacts no está conectado.'
      }, { status: 400 })
    }

    const body = await request.json()
    const items: Array<{ id?: string; nombres?: string; name?: string; celular?: string; phone?: string; email?: string; notas?: string }> = body.items || []

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({
        success: true,
        syncedCount: 0,
        failedCount: 0
      })
    }

    // Procesar hasta 15 elementos por lote en paralelo usando Promise.allSettled
    const results = await Promise.allSettled(
      items.map(async (item) => {
        const nombres = item.nombres || item.name || item.celular || item.phone
        const celular = item.celular || item.phone

        if (!celular && !nombres) {
          throw new Error('Faltan datos de teléfono o nombre')
        }

        const res = await createGoogleContact({
          name: nombres || celular || 'Cliente',
          phone: celular || '',
          email: item.email,
          notes: item.notas || 'Cliente de Fuddiverso'
        })

        if (item.id) {
          try {
            const adminDb = ensureAdminDb()
            if (adminDb) {
              await adminDb.collection('clients').doc(item.id).update({
                googleContactSynced: true,
                googleContactSyncedAt: FieldValue.serverTimestamp()
              })
            }
          } catch (e) {
            // Silenciar posible error si el doc ID es diferente
          }
        }

        return res
      })
    )

    let syncedCount = 0
    let failedCount = 0
    const errors: string[] = []

    results.forEach((res, index) => {
      if (res.status === 'fulfilled') {
        syncedCount++
      } else {
        failedCount++
        if (errors.length < 5) {
          const item = items[index]
          const name = item?.nombres || item?.name || item?.celular || 'Cliente'
          errors.push(`${name}: ${res.reason?.message || 'Error al guardar'}`)
        }
      }
    })

    return NextResponse.json({
      success: true,
      syncedCount,
      failedCount,
      errors
    })
  } catch (error: any) {
    console.error('[api/google-contacts/sync-batch] Error:', error)
    return NextResponse.json({
      success: false,
      error: error.message || 'Error en el procesamiento del lote de sincronización.'
    }, { status: 500 })
  }
}
