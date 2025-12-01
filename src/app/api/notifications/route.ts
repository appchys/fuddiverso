import { NextRequest, NextResponse } from 'next/server'
import { getFirestore, collection, addDoc, Timestamp } from 'firebase/firestore'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore'

// Inicializar Firebase Admin si aún no está inicializado
let adminDb: any
try {
  const serviceAccount = JSON.parse(
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY || '{}'
  )
  
  if (serviceAccount.type) {
    const adminApp = initializeApp({
      credential: cert(serviceAccount)
    }, 'notifications')
    adminDb = getAdminFirestore(adminApp)
  }
} catch (error) {
  console.error('Error initializing Firebase Admin:', error)
}

export async function POST(request: NextRequest) {
  try {
    const data = await request.json()
    const { 
      businessId, 
      orderId, 
      type, 
      title, 
      message, 
      orderData,
      // Nuevos campos para notificaciones QR
      qrCodeId,
      qrCodeName,
      userId,
      scannedCount,
      isCompleted
    } = data

    if (!businessId) {
      return NextResponse.json(
        { error: 'businessId is required' },
        { status: 400 }
      )
    }

    // Guardar en Firestore usando Firebase Admin SDK
    if (adminDb) {
      const notification: any = {
        orderId: orderId || null,
        type: type || 'new_order',
        title,
        message,
        orderData: orderData || {},
        read: false,
        createdAt: Timestamp.now()
      }

      // Agregar campos específicos para notificaciones QR
      if (type === 'qr_scan') {
        notification.qrCodeId = qrCodeId || null
        notification.qrCodeName = qrCodeName || null
        notification.userId = userId || null
        notification.scannedCount = scannedCount || 0
        notification.isCompleted = isCompleted || false
      }

      await adminDb.collection('businesses').doc(businessId)
        .collection('notifications').add(notification)

      return NextResponse.json(
        { success: true, message: 'Notification saved' },
        { status: 201 }
      )
    } else {
      console.warn('Firebase Admin not initialized, notification not saved to database')
      return NextResponse.json(
        { success: true, message: 'Notification processed (not saved to DB)' },
        { status: 201 }
      )
    }
  } catch (error) {
    console.error('Error saving notification:', error)
    return NextResponse.json(
      { error: 'Failed to save notification' },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const businessId = searchParams.get('businessId')

    if (!businessId) {
      return NextResponse.json(
        { error: 'businessId is required' },
        { status: 400 }
      )
    }

    if (adminDb) {
      const notificationsRef = collection(
        adminDb,
        'businesses',
        businessId,
        'notifications'
      )

      const snapshot = await adminDb.collection('businesses').doc(businessId)
        .collection('notifications')
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get()

      const notifications = snapshot.docs.map((doc: any) => ({
        id: doc.id,
        ...doc.data()
      }))

      return NextResponse.json({ notifications }, { status: 200 })
    } else {
      return NextResponse.json({ notifications: [] }, { status: 200 })
    }
  } catch (error) {
    console.error('Error fetching notifications:', error)
    return NextResponse.json(
      { error: 'Failed to fetch notifications' },
      { status: 500 }
    )
  }
}
