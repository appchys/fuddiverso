import { NextRequest, NextResponse } from 'next/server'
import { createGoogleContact, getContactsConnection } from '@/lib/google-contacts'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { nombres, celular, email, notas } = body

    if (!celular && !nombres) {
      return NextResponse.json({ error: 'Nombres y celular son requeridos.' }, { status: 400 })
    }

    const connection = await getContactsConnection()
    if (!connection || connection.status !== 'connected') {
      return NextResponse.json({
        success: false,
        synced: false,
        message: 'Google Contacts no está conectado aún.'
      })
    }

    const result = await createGoogleContact({
      name: nombres || celular,
      phone: celular,
      email,
      notes: notas || 'Cliente de Fuddiverso'
    })

    return NextResponse.json({
      success: true,
      synced: true,
      resourceName: result.resourceName
    })
  } catch (error: any) {
    console.error('[api/google-contacts/sync-client] Error al sincronizar cliente:', error)
    return NextResponse.json({
      success: false,
      synced: false,
      error: error.message || 'Error al guardar contacto en Google Contacts'
    }, { status: 500 })
  }
}
