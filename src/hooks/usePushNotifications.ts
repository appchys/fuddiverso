import { useState, useEffect } from 'react'

interface PushNotificationOptions {
  title: string
  body: string
  icon?: string
  url?: string
  orderId?: string
}

export const usePushNotifications = () => {
  const [permission, setPermission] = useState<NotificationPermission>('default')
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null)
  const [subscription, setSubscription] = useState<PushSubscription | null>(null)

  // Detectar compatibilidad más específica
  const isSupported = typeof window !== 'undefined' && 
    'Notification' in window && 
    'serviceWorker' in navigator && 
    'PushManager' in window

  // Detectar iOS (Safari no soporta notificaciones push)
  const isIOS = typeof window !== 'undefined' && 
    /iPad|iPhone|iPod/.test(navigator.userAgent)

  const isCompatible = isSupported && !isIOS

  useEffect(() => {
    // Solo ejecutar en el cliente
    if (typeof window === 'undefined') return

    if ('Notification' in window) {
      setPermission(Notification.permission)
    }

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js')
        .then((reg) => {
          setRegistration(reg)
          return reg.pushManager.getSubscription()
        })
        .then((sub) => {
          if (sub) {
            setSubscription(sub)
          }
        })
        .catch((error) => {
          console.error('Error registrando Service Worker:', error)
        })
    }
  }, [])

  const requestPermission = async (): Promise<boolean> => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return false
    }

    try {
      const permission = await Notification.requestPermission()
      setPermission(permission)
      return permission === 'granted'
    } catch (error) {
      console.error('Error solicitando permisos de notificación:', error)
      return false
    }
  }

  const subscribe = async (): Promise<PushSubscription | null> => {
    if (!registration || permission !== 'granted') {
      return null
    }

    try {
      // Clave pública VAPID - deberías generar tu propia clave
      const vapidPublicKey = 'BMJnkcUIu3RGgL2h3dStbAOo6Gqs2UF2M9n2dQkVV0pnHPl-4l4kVXZPNjMGfvvXOaZQ2D2rNJ0HqI8X8_nwBLo'
      
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource
      })

      setSubscription(subscription)
      return subscription
    } catch (error) {
      console.error('Error suscribiéndose a push notifications:', error)
      return null
    }
  }

  const showNotification = (options: PushNotificationOptions) => {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') {
      return
    }

    if (!('serviceWorker' in navigator) || permission !== 'granted') {
      // Fallback a notificación del navegador
      if (permission === 'granted' && 'Notification' in window) {
        new Notification(options.title, {
          body: options.body,
          icon: options.icon || '/icon-192x192.png'
        })
      }
      return
    }

    // Enviar notificación a través del Service Worker
    if (registration) {
      registration.showNotification(options.title, {
        body: options.body,
        icon: options.icon || '/icon-192x192.png',
        badge: '/icon-192x192.png',
        data: {
          url: options.url || '/business/dashboard',
          orderId: options.orderId
        },
        actions: [
          {
            action: 'view',
            title: 'Ver pedido'
          },
          {
            action: 'close',
            title: 'Cerrar'
          }
        ],
        requireInteraction: true,
        tag: 'new-order'
      } as NotificationOptions)
    }
  }

  return {
    permission,
    subscription,
    requestPermission,
    subscribe,
    showNotification,
    isSupported: isCompatible,
    isIOS,
    needsUserAction: permission === 'default' && isCompatible
  }
}

// Función auxiliar para convertir clave VAPID
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  if (typeof window === 'undefined') {
    return new Uint8Array()
  }

  const padding = '='.repeat((4 - base64String.length % 4) % 4)
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/')

  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}
