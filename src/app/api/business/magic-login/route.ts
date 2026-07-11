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

    let body
    try {
      body = await request.json()
    } catch (e) {
      return NextResponse.json({ error: 'Cuerpo de petición no válido.' }, { status: 400 })
    }

    const token = body.token?.trim()
    if (!token) {
      return NextResponse.json({ error: 'El token es requerido.' }, { status: 400 })
    }

    // 1. Buscar el token en Firestore
    const linkRef = adminDb.collection('magic_links').doc(token)
    const linkSnap = await linkRef.get()

    if (!linkSnap.exists) {
      return NextResponse.json(
        { error: 'El enlace de acceso rápido no es válido, ha sido revocado o ya no existe.' },
        { status: 401 }
      )
    }

    const data = linkSnap.data() || {}
    
    // Verificar si tiene fecha de expiración y ya pasó
    if (data.expiresAt) {
      const expiresAtDate = data.expiresAt.toDate()
      if (expiresAtDate < new Date()) {
        return NextResponse.json(
          { error: 'Este enlace de acceso rápido ha expirado.' },
          { status: 401 }
        )
      }
    }

    const { businessId, email, uid } = data

    if (!businessId || !email || !uid) {
      return NextResponse.json(
        { error: 'El enlace de acceso rápido está incompleto o corrupto.' },
        { status: 500 }
      )
    }

    // 2. Generar el Custom Token de Firebase Auth para este UID
    const customToken = await adminAuth.createCustomToken(uid, {
      businessId,
      email,
      role: 'magic_link_user'
    })

    // 3. Actualizar estadísticas de uso del enlace
    await linkRef.update({
      usedCount: FieldValue.increment(1),
      lastUsedAt: FieldValue.serverTimestamp()
    })

    // 4. Obtener información de visualización adicional de Firebase Auth (como displayName) si está disponible
    let displayName = ''
    try {
      const userRecord = await adminAuth.getUser(uid)
      displayName = userRecord.displayName || ''
    } catch (err) {
      console.warn(`[magic-login] No se pudo obtener el displayName para uid: ${uid}`)
    }

    return NextResponse.json({
      ok: true,
      customToken,
      businessId,
      uid,
      email,
      displayName
    })
  } catch (error: any) {
    console.error('[magic-login] Error:', error)
    return NextResponse.json(
      { error: error.message || 'Error durante la autenticación de acceso rápido.' },
      { status: 500 }
    )
  }
}
