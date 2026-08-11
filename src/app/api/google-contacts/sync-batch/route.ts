import { NextRequest, NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { createGoogleContact, getContactsConnection } from '@/lib/google-contacts'
import { ensureAdminDb } from '@/lib/firebase-admin'

function getPhoneVariants(phone?: string): string[] {
  if (!phone) return []
  const cleaned = phone.replace(/[^\d]/g, '')
  const variants = new Set<string>()
  variants.add(phone.trim())
  if (cleaned) variants.add(cleaned)

  if (cleaned.startsWith('09') && cleaned.length === 10) {
    variants.add(cleaned) // 0959669449
    variants.add('+593' + cleaned.substring(1)) // +593959669449
    variants.add('593' + cleaned.substring(1)) // 593959669449
    variants.add(cleaned.substring(1)) // 959669449
  } else if (cleaned.startsWith('5939') && cleaned.length === 12) {
    const local = '0' + cleaned.substring(3)
    variants.add(local)
    variants.add('+' + cleaned)
    variants.add(cleaned)
  } else if (cleaned.startsWith('9') && cleaned.length === 9) {
    variants.add('0' + cleaned)
    variants.add('+593' + cleaned)
    variants.add('593' + cleaned)
  }

  return Array.from(variants).filter(Boolean)
}

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

    // Procesar elementos del lote secuencialmente con pausas para evitar Rate Limits (429/403)
    const results: Array<{ status: 'fulfilled' | 'rejected'; value?: any; reason?: any }> = []

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, 150))
      }

      try {
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

        // Persistir el estado de sincronizado en Firestore
        const adminDb = ensureAdminDb()
        if (adminDb) {
          try {
            if (item.id) {
              await adminDb.collection('clients').doc(item.id).set({
                googleContactSynced: true,
                googleContactSyncedAt: FieldValue.serverTimestamp()
              }, { merge: true })
            }

            const phoneVariants = getPhoneVariants(celular)
            if (phoneVariants.length > 0) {
              const [snapCelular, snapPhone] = await Promise.all([
                adminDb.collection('clients').where('celular', 'in', phoneVariants.slice(0, 10)).get(),
                adminDb.collection('clients').where('phone', 'in', phoneVariants.slice(0, 10)).get()
              ])

              const matchedDocs = [...snapCelular.docs, ...snapPhone.docs]

              if (matchedDocs.length > 0) {
                for (const docSnapshot of matchedDocs) {
                  await docSnapshot.ref.set({
                    googleContactSynced: true,
                    googleContactSyncedAt: FieldValue.serverTimestamp()
                  }, { merge: true })
                }
              } else if (!item.id && celular) {
                // Crear un nuevo registro de cliente en la colección 'clients' si no existía ningún documento
                await adminDb.collection('clients').add({
                  nombres: nombres || celular,
                  celular: celular,
                  email: item.email || null,
                  googleContactSynced: true,
                  googleContactSyncedAt: FieldValue.serverTimestamp(),
                  fecha_de_registro: new Date().toISOString()
                })
              }
            }
          } catch (e) {
            console.warn('[sync-batch] Error al actualizar Firestore:', e)
          }
        }

        results.push({ status: 'fulfilled', value: res })
      } catch (err: any) {
        const name = item?.nombres || item?.name || item?.celular || item?.phone || 'Desconocido'
        console.error(`❌ [sync-batch] Error al procesar contacto '${name}' (${item.celular || item.phone}):`, err)
        results.push({ status: 'rejected', reason: err })
      }
    }

    let syncedCount = 0
    let failedCount = 0
    const errors: string[] = []

    results.forEach((res, index) => {
      if (res.status === 'fulfilled') {
        syncedCount++
      } else {
        failedCount++
        const item = items[index]
        const name = item?.nombres || item?.name || item?.celular || item?.phone || 'Cliente'
        const errMsg = res.reason?.message || 'Error desconocido'
        errors.push(`${name} (${item?.celular || item?.phone || 'Sin tel'}): ${errMsg}`)
      }
    })

    console.log(`[sync-batch] Resultado del lote: ${syncedCount} sincronizados, ${failedCount} fallidos.`)

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
