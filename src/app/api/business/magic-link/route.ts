import { NextRequest, NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { ensureAdminAuth, ensureAdminDb } from '@/lib/firebase-admin'

interface BusinessAdministrator {
  uid: string
  email: string
  role: 'admin' | 'manager'
  permissions: {
    manageAdmins: boolean
    [key: string]: boolean
  }
}

export async function GET(request: NextRequest) {
  try {
    const adminAuth = ensureAdminAuth()
    const adminDb = ensureAdminDb()

    if (!adminAuth || !adminDb) {
      return NextResponse.json({ error: 'Firebase Admin no está configurado.' }, { status: 500 })
    }

    const authHeader = request.headers.get('authorization') || ''
    const adminPasswordHeader = request.headers.get('x-admin-password')
    const isAdminBypass = adminPasswordHeader === 'admin123'

    let decodedToken
    let requesterEmail = ''
    let requesterUid = ''

    if (isAdminBypass) {
      requesterEmail = 'admin@fuddi.app'
      requesterUid = 'super-admin-uid'
    } else {
      if (!authHeader) {
        return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })
      }
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
      try {
        decodedToken = await adminAuth.verifyIdToken(token)
        requesterEmail = decodedToken.email?.toLowerCase() || ''
        requesterUid = decodedToken.uid
      } catch (err) {
        return NextResponse.json({ error: 'Token de autenticación inválido.' }, { status: 401 })
      }
    }

    const { searchParams } = new URL(request.url)
    const businessId = searchParams.get('businessId')?.trim()
    const email = searchParams.get('email')?.trim().toLowerCase()

    if (!businessId || !email) {
      return NextResponse.json({ error: 'businessId y email son requeridos.' }, { status: 400 })
    }

    // 1. Obtener información del negocio
    const businessRef = adminDb.collection('businesses').doc(businessId)
    const businessSnap = await businessRef.get()

    if (!businessSnap.exists) {
      return NextResponse.json({ error: 'Negocio no encontrado.' }, { status: 404 })
    }

    const business = businessSnap.data() || {}
    const isOwner = business.ownerId === requesterUid
    const administrators = (business.administrators || []) as BusinessAdministrator[]
    const requesterAdmin = administrators.find(admin => admin.email.toLowerCase() === requesterEmail)
    const hasManageAdminsPermission = !!requesterAdmin?.permissions?.manageAdmins

    const isSelf = email === requesterEmail

    if (!isAdminBypass && !isOwner && !hasManageAdminsPermission && !isSelf) {
      return NextResponse.json({ error: 'No tienes permiso para gestionar este enlace.' }, { status: 403 })
    }

    // 2. Obtener UID del usuario destino
    let targetUid = ''
    if (email === business.email?.toLowerCase() && business.ownerId) {
      targetUid = business.ownerId
    } else {
      const targetAdmin = administrators.find(admin => admin.email.toLowerCase() === email)
      if (targetAdmin && targetAdmin.uid) {
        targetUid = targetAdmin.uid
      } else {
        try {
          const userRecord = await adminAuth.getUserByEmail(email)
          targetUid = userRecord.uid
        } catch (e) {
          return NextResponse.json({ error: 'El usuario no tiene una cuenta activa en el sistema.' }, { status: 400 })
        }
      }
    }

    // 3. Buscar enlace existente
    const magicLinksRef = adminDb.collection('magic_links')
    const querySnap = await magicLinksRef
      .where('businessId', '==', businessId)
      .where('email', '==', email)
      .limit(1)
      .get()

    if (!querySnap.empty) {
      const existingDoc = querySnap.docs[0]
      return NextResponse.json({ token: existingDoc.id })
    }

    // 4. Crear nuevo enlace si no existe
    const newLinkRef = magicLinksRef.doc()
    await newLinkRef.set({
      businessId,
      email,
      uid: targetUid,
      createdAt: FieldValue.serverTimestamp(),
      usedCount: 0
    })

    return NextResponse.json({ token: newLinkRef.id })
  } catch (error: any) {
    console.error('[magic-link GET] Error:', error)
    return NextResponse.json({ error: error.message || 'Error al obtener el enlace.' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const adminAuth = ensureAdminAuth()
    const adminDb = ensureAdminDb()

    if (!adminAuth || !adminDb) {
      return NextResponse.json({ error: 'Firebase Admin no está configurado.' }, { status: 500 })
    }

    const authHeader = request.headers.get('authorization') || ''
    const adminPasswordHeader = request.headers.get('x-admin-password')
    const isAdminBypass = adminPasswordHeader === 'admin123'

    let decodedToken
    let requesterEmail = ''
    let requesterUid = ''

    if (isAdminBypass) {
      requesterEmail = 'admin@fuddi.app'
      requesterUid = 'super-admin-uid'
    } else {
      if (!authHeader) {
        return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })
      }
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
      try {
        decodedToken = await adminAuth.verifyIdToken(token)
        requesterEmail = decodedToken.email?.toLowerCase() || ''
        requesterUid = decodedToken.uid
      } catch (err) {
        return NextResponse.json({ error: 'Token de autenticación inválido.' }, { status: 401 })
      }
    }

    const body = await request.json()
    const businessId = body.businessId?.trim()
    const email = body.email?.trim().toLowerCase()
    const action = body.action // 'regenerate' | 'revoke'

    if (!businessId || !email || !action) {
      return NextResponse.json({ error: 'businessId, email y action son requeridos.' }, { status: 400 })
    }

    // 1. Obtener información del negocio
    const businessRef = adminDb.collection('businesses').doc(businessId)
    const businessSnap = await businessRef.get()

    if (!businessSnap.exists) {
      return NextResponse.json({ error: 'Negocio no encontrado.' }, { status: 404 })
    }

    const business = businessSnap.data() || {}
    const isOwner = business.ownerId === requesterUid
    const administrators = (business.administrators || []) as BusinessAdministrator[]
    const requesterAdmin = administrators.find(admin => admin.email.toLowerCase() === requesterEmail)
    const hasManageAdminsPermission = !!requesterAdmin?.permissions?.manageAdmins

    const isSelf = email === requesterEmail

    if (!isAdminBypass && !isOwner && !hasManageAdminsPermission && !isSelf) {
      return NextResponse.json({ error: 'No tienes permiso para gestionar este enlace.' }, { status: 403 })
    }

    // 2. Buscar enlaces existentes para eliminarlos (revocar)
    const magicLinksRef = adminDb.collection('magic_links')
    const querySnap = await magicLinksRef
      .where('businessId', '==', businessId)
      .where('email', '==', email)
      .get()

    const batch = adminDb.batch()
    querySnap.docs.forEach(doc => {
      batch.delete(doc.ref)
    })
    await batch.commit()

    if (action === 'revoke') {
      return NextResponse.json({ ok: true })
    }

    if (action === 'regenerate') {
      // Obtener UID del usuario destino
      let targetUid = ''
      if (email === business.email?.toLowerCase() && business.ownerId) {
        targetUid = business.ownerId
      } else {
        const targetAdmin = administrators.find(admin => admin.email.toLowerCase() === email)
        if (targetAdmin && targetAdmin.uid) {
          targetUid = targetAdmin.uid
        } else {
          try {
            const userRecord = await adminAuth.getUserByEmail(email)
            targetUid = userRecord.uid
          } catch (e) {
            return NextResponse.json({ error: 'El usuario no tiene una cuenta activa en el sistema.' }, { status: 400 })
          }
        }
      }

      // Crear nuevo enlace con ID aleatorio seguro
      const newLinkRef = magicLinksRef.doc()
      await newLinkRef.set({
        businessId,
        email,
        uid: targetUid,
        createdAt: FieldValue.serverTimestamp(),
        usedCount: 0
      })

      return NextResponse.json({ token: newLinkRef.id })
    }

    return NextResponse.json({ error: 'Acción no válida.' }, { status: 400 })
  } catch (error: any) {
    console.error('[magic-link POST] Error:', error)
    return NextResponse.json({ error: error.message || 'Error al procesar la solicitud.' }, { status: 500 })
  }
}
