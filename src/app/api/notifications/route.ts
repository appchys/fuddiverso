import { NextRequest, NextResponse } from 'next/server'
import { collection, Timestamp } from 'firebase/firestore'
import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore'
import { getMessaging } from 'firebase-admin/messaging'
import * as fs from 'fs'
import * as path from 'path'

// Inicializar Firebase Admin si aún no está inicializado
let adminDb: any
let adminAppInstance: any
try {
  let serviceAccount: any = null

  // Primero intentar desde la variable de entorno
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    try {
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)
    } catch (e) {
      console.warn('[Firebase Admin] Error al parsear JSON desde .env:', e)
    }
  }

  // Si no funcionó, intentar leer desde el archivo
  if (!serviceAccount) {
    try {
      const credentialsPath = path.join(
        process.cwd(),
        'multitienda-69778-firebase-adminsdk-fbsvc-496524456f.json'
      )
      if (fs.existsSync(credentialsPath)) {
        const credentials = fs.readFileSync(credentialsPath, 'utf-8')
        serviceAccount = JSON.parse(credentials)
      }
    } catch (e) {
      console.warn('[Firebase Admin] Error al leer archivo de credenciales:', e)
    }
  }

  const existingApp = getApps().find((app: any) => app.name === 'notifications')

  if (existingApp) {
    adminAppInstance = existingApp
    adminDb = getAdminFirestore(existingApp)
  } else if (serviceAccount && serviceAccount.type) {
    adminAppInstance = initializeApp({
      credential: cert(serviceAccount)
    }, 'notifications')
    adminDb = getAdminFirestore(adminAppInstance)
  } else {
    console.warn('[Firebase Admin] No se pudo cargar serviceAccount')
  }
} catch (error) {
  console.error('[Firebase Admin] Error initializing Firebase Admin:', error)
}

function sanitizeTopicName(raw: string): string {
  return String(raw || '').trim().replace(/[^a-zA-Z0-9-_.~%]/g, '_')
}

async function sendHighPriorityFcmForStoreOrder(params: {
  businessId: string
  orderId?: string
  title?: string
  message?: string
  orderData?: any
}) {
  if (!adminAppInstance || !adminDb) return

  const { businessId, orderId, title, message, orderData } = params
  const messaging = getMessaging(adminAppInstance)

  const customerName = orderData?.customer?.name || 'Cliente'
  const totalAmount = typeof orderData?.total === 'number' ? orderData.total.toFixed(2) : (orderData?.total || '0.00')
  const itemCount = Array.isArray(orderData?.items)
    ? orderData.items.reduce((acc: number, it: any) => acc + (Number(it?.quantity) || 1), 0)
    : 0

  const finalTitle = title || '¡Nuevo Pedido Recibido! 🛍️'
  const finalBody = message || `Cliente: ${customerName}${itemCount > 0 ? ` • ${itemCount} producto(s)` : ''} • Total: $${totalAmount}`

  const dataPayload: Record<string, string> = {
    type: 'new_order',
    businessId: String(businessId),
    orderId: String(orderId || ''),
    title: String(finalTitle),
    body: String(finalBody),
    message: String(finalBody)
  }

  const androidConfig: any = {
    priority: 'high',
    ttl: 3600 * 1000,
    notification: {
      channelId: 'fuddi_tienda_orders_alert_channel',
      sound: 'default',
      priority: 'max',
      defaultVibrateTimings: true,
      defaultSound: true,
      visibility: 'public',
      tag: orderId ? `order_${orderId}` : undefined
    }
  }

  // 1. Enviar al topic de la tienda (store_<businessId>)
  const topic = `store_${sanitizeTopicName(businessId)}`
  try {
    await messaging.send({
      topic,
      notification: {
        title: finalTitle,
        body: finalBody
      },
      data: dataPayload,
      android: androidConfig
    })
  } catch (topicErr) {
    console.warn(`[FCM] Error enviando al topic ${topic}:`, topicErr)
  }

  // 2. Enviar directamente a los fcmTokens guardados en el documento de la tienda
  try {
    const bizDoc = await adminDb.collection('businesses').doc(businessId).get()
    if (bizDoc.exists) {
      const bizData = bizDoc.data() || {}
      const tokens: string[] = Array.isArray(bizData.fcmTokens)
        ? bizData.fcmTokens.filter((t: any) => typeof t === 'string' && t.trim().length > 0)
        : []

      if (tokens.length > 0) {
        await messaging.sendEachForMulticast({
          tokens,
          notification: {
            title: finalTitle,
            body: finalBody
          },
          data: dataPayload,
          android: androidConfig
        })
      }
    }
  } catch (tokenErr) {
    console.warn(`[FCM] Error enviando a tokens de la tienda ${businessId}:`, tokenErr)
  }
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
      console.warn('[POST /api/notifications] businessId es requerido')
      return NextResponse.json(
        { error: 'businessId is required' },
        { status: 400 }
      )
    }

    // Guardar en Firestore usando Firebase Admin SDK
    if (adminDb) {
      if (type === 'new_order' || !type) {
        await sendHighPriorityFcmForStoreOrder({
          businessId,
          orderId,
          title,
          message,
          orderData
        })
        return NextResponse.json(
          { success: true, message: 'FCM push notification sent for new_order' },
          { status: 200 }
        )
      }

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

      console.log('[POST /api/notifications] Guardando notificación en Firestore:', {
        businessId,
        type,
        path: `businesses/${businessId}/notifications`
      })

      await adminDb.collection('businesses').doc(businessId)
        .collection('notifications').add(notification)
      return NextResponse.json(
        { success: true, message: 'Notification saved' },
        { status: 201 }
      )
    } else {
      console.warn('[POST /api/notifications] Firebase Admin no inicializado')
      return NextResponse.json(
        { success: true, message: 'Notification processed (not saved to DB)' },
        { status: 201 }
      )
    }
  } catch (error) {
    console.error('[POST /api/notifications] Error saving notification:', error)
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
