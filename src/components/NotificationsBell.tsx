'use client'

import { useState, useEffect, useRef } from 'react'
import { db } from '@/lib/firebase'
import { collection, query, where, orderBy, onSnapshot, updateDoc, doc } from 'firebase/firestore'
import { Order } from '@/types'

interface Notification {
  id: string
  orderId?: string
  type: 'new_order' | 'order_status_change' | 'qr_scan'
  title: string
  message: string
  createdAt: any
  read: boolean
  orderData?: Partial<Order>
  qrCodeName?: string
  scannedCount?: number
  isCompleted?: boolean
  userId?: string
}

interface NotificationsBellProps {
  businessId: string
  onNewOrder?: (order: Order) => void
}

export default function NotificationsBell({ businessId, onNewOrder }: NotificationsBellProps) {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [loading, setLoading] = useState(true)
  const audioRef = useRef<HTMLAudioElement>(null)
  const hasPlayedRef = useRef<Set<string>>(new Set())

  // Funci\u00f3n para reproducir un sonido de notificaci\u00f3n usando Web Audio API
  const playNotificationSound = () => {
    try {
      // Verificar que el usuario ha interactuado con la p\u00e1gina
      if ((document as any).hidden) {
        return // No reproducir si la pesta\u00f1a est\u00e1 oculta
      }

      // Solo intentar crear AudioContext si es seguro
      if (typeof window === 'undefined' || !window.AudioContext) {
        return
      }

      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
      
      // Reanudar el contexto de audio si está en estado suspendido
      if (audioContext.state === 'suspended') {
        audioContext.resume().catch(() => {
          // Ignorar si no se puede reanudar
        })
        return
      }

      const now = audioContext.currentTime

      // Crear un sonido beep simple (2 tonos)
      const osc1 = audioContext.createOscillator()
      const osc2 = audioContext.createOscillator()
      const gain = audioContext.createGain()

      osc1.connect(gain)
      osc2.connect(gain)
      gain.connect(audioContext.destination)

      // Establecer volumen bajo
      gain.gain.setValueAtTime(0.1, now)

      // Primer tono (800 Hz, 100ms)
      osc1.frequency.setValueAtTime(800, now)
      osc1.frequency.setValueAtTime(800, now + 0.1)

      osc1.start(now)
      osc1.stop(now + 0.1)

      // Segundo tono (1000 Hz, 100ms)
      osc2.frequency.setValueAtTime(1000, now + 0.1)
      osc2.frequency.setValueAtTime(1000, now + 0.2)

      osc2.start(now + 0.1)
      osc2.stop(now + 0.2)

      // Silenciar después del sonido
      gain.gain.setValueAtTime(0.1, now + 0.2)
      gain.gain.setValueAtTime(0, now + 0.21)
    } catch (error) {
      // Silenciosamente fallar si Web Audio API no está disponible
      // No loguear, ya que esto es esperado en navegadores/contextos donde no está permitido
    }
  }

  // Reproducir sonido cuando hay nueva notificación
  useEffect(() => {
    if (!businessId) return

    try {
      const q = query(
        collection(db, 'businesses', businessId, 'notifications'),
        orderBy('createdAt', 'desc')
      )

      const unsubscribe = onSnapshot(q, (snapshot) => {
        const notifs: Notification[] = []
        snapshot.forEach((doc) => {
          notifs.push({
            id: doc.id,
            ...doc.data()
          } as Notification)
        })
        setNotifications(notifs)
        setLoading(false)
      }, (error) => {
        // Solo loguear errores de permisos, no warnings
        if ((error as any).code === 'permission-denied') {
          console.debug('No permission to read notifications (expected if user not authenticated)')
        } else {
          console.error('Error listening to notifications:', error)
        }
        setLoading(false)
      })

      return () => unsubscribe()
    } catch (error) {
      console.error('Error setting up notification listener:', error)
      setLoading(false)
    }
  }, [businessId])

  // Escuchar nuevas órdenes creadas por clientes
  useEffect(() => {
    if (!businessId) return

    try {
      const q = query(
        collection(db, 'orders'),
        where('businessId', '==', businessId),
        where('createdByAdmin', '==', false),
        orderBy('createdAt', 'desc')
      )

      const unsubscribe = onSnapshot(q, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
          if (change.type === 'added') {
            const order = { id: change.doc.id, ...change.doc.data() } as Order

            // Solo procesar si no lo hemos visto antes
            if (!hasPlayedRef.current.has(order.id)) {
              hasPlayedRef.current.add(order.id)

              // Crear notificación
              createOrderNotification(order)

              // Reproducir sonido (solo si se puede)
              if (audioRef.current) {
                audioRef.current.play().catch(() => {
                  // El navegador puede bloquear reproducción automática
                })
              }

              // Mostrar notificación del navegador
              if ('Notification' in window && Notification.permission === 'granted') {
                try {
                  new Notification(`Nueva orden #${order.id.slice(0, 6)}`, {
                    body: `${order.customer?.name} ha creado una nueva orden`,
                    tag: `order-${order.id}`,
                  })
                } catch (error) {
                  console.debug('Error showing browser notification:', error)
                }
              }

              // Llamar callback si existe
              if (onNewOrder) {
                onNewOrder(order)
              }
            }
          }
        })
      }, (error) => {
        if ((error as any).code === 'permission-denied') {
          console.debug('No permission to read orders (expected if user not authenticated)')
        } else {
          console.error('Error listening to new orders:', error)
        }
      })

      return () => unsubscribe()
    } catch (error) {
      console.error('Error setting up order listener:', error)
    }
  }, [businessId, onNewOrder])

  // Crear notificación en Firestore
  const createOrderNotification = async (order: Order) => {
    try {
      // Agregar a la subcolección de notificaciones
      const notifData = {
        orderId: order.id,
        type: 'new_order' as const,
        title: `Nueva orden #${order.id.slice(0, 6)}`,
        message: `${order.customer?.name} ha creado una nueva orden`,
        createdAt: new Date(),
        read: false,
        orderData: {
          id: order.id,
          customer: order.customer,
          items: order.items,
          total: order.total,
          status: order.status
        }
      }

      // Guardar en Firestore
      await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessId,
          ...notifData
        })
      }).catch(err => console.error('Error saving notification:', err))
    } catch (error) {
      console.error('Error creating notification:', error)
    }
  }

  // Marcar notificación como leída
  const markAsRead = async (notificationId: string) => {
    try {
      const notifRef = doc(db, 'businesses', businessId, 'notifications', notificationId)
      await updateDoc(notifRef, { read: true })
    } catch (error) {
      console.error('Error marking notification as read:', error)
    }
  }

  // Marcar todas como leídas
  const markAllAsRead = async () => {
    try {
      for (const notif of notifications.filter(n => !n.read)) {
        await markAsRead(notif.id)
      }
    } catch (error) {
      console.error('Error marking all as read:', error)
    }
  }

  const unreadCount = notifications.filter(n => !n.read).length

  return (
    <div className="relative">
      {/* Elemento de audio silencioso para reproducir el sonido de notificación */}
      <audio 
        ref={audioRef}
        preload="auto"
        crossOrigin="anonymous"
        style={{ display: 'none' }}
      >
        <source src="/notification-sound.mp3" type="audio/mpeg" />
      </audio>

      {/* Botón de campana */}
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        className="relative p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
        title="Notificaciones"
      >
        <i className="bi bi-bell text-lg"></i>
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown de notificaciones */}
      {showDropdown && (
        <div className="absolute right-0 mt-2 w-80 bg-white rounded-lg shadow-xl border border-gray-200 z-50 max-h-96 overflow-hidden flex flex-col">
          {/* Header */}
          <div className="p-4 border-b bg-gray-50 flex justify-between items-center">
            <h3 className="font-semibold text-gray-900">Notificaciones</h3>
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="text-xs text-blue-600 hover:text-blue-700 font-medium"
              >
                Marcar todas como leídas
              </button>
            )}
          </div>

          {/* Contenido */}
          {loading ? (
            <div className="p-4 text-center text-gray-500">
              <i className="bi bi-hourglass-split text-lg animate-spin"></i>
              <p className="text-sm mt-2">Cargando...</p>
            </div>
          ) : notifications.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <i className="bi bi-bell-slash text-3xl mb-2 block text-gray-300"></i>
              <p className="text-sm">No hay notificaciones</p>
            </div>
          ) : (
            <div className="overflow-y-auto flex-1">
              {notifications.map((notif) => (
                <div
                  key={notif.id}
                  onClick={() => !notif.read && markAsRead(notif.id)}
                  className={`p-4 border-b cursor-pointer transition-colors hover:bg-gray-50 ${
                    notif.read ? 'bg-white' : 'bg-blue-50'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center">
                        {notif.type === 'new_order' && (
                          <i className="bi bi-bag-check text-green-600 mr-2"></i>
                        )}
                        {notif.type === 'qr_scan' && (
                          <i className={`bi text-blue-600 mr-2 ${notif.isCompleted ? 'bi-check-circle-fill text-green-600' : 'bi-qr-code'}`}></i>
                        )}
                        <h4 className={`font-semibold text-sm ${
                          notif.read ? 'text-gray-700' : 'text-gray-900'
                        }`}>
                          {notif.title}
                        </h4>
                      </div>
                      <p className="text-sm text-gray-600 mt-1">{notif.message}</p>

                      {/* Detalles de la orden si está disponible */}
                      {notif.orderData && (
                        <div className="mt-2 text-xs text-gray-500 space-y-1">
                          <p><strong>Total:</strong> ${notif.orderData.total?.toFixed(2)}</p>
                          <p><strong>Productos:</strong> {notif.orderData.items?.length || 0}</p>
                        </div>
                      )}

                      {/* Detalles del QR si está disponible */}
                      {notif.type === 'qr_scan' && (
                        <div className="mt-2 text-xs text-gray-500 space-y-1">
                          {notif.qrCodeName && <p><strong>Código:</strong> {notif.qrCodeName}</p>}
                          {notif.scannedCount !== undefined && <p><strong>Progreso:</strong> {notif.scannedCount}/5</p>}
                          {notif.isCompleted && <p className="text-green-600"><strong>✓ Colección completada</strong></p>}
                        </div>
                      )}

                      <p className="text-xs text-gray-400 mt-2">
                        {formatTimeAgo(notif.createdAt)}
                      </p>
                    </div>

                    {!notif.read && (
                      <div className="ml-2 w-2 h-2 bg-blue-600 rounded-full flex-shrink-0 mt-1"></div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Footer */}
          {notifications.length > 0 && (
            <div className="p-3 border-t bg-gray-50 text-center">
              <button className="text-sm text-blue-600 hover:text-blue-700 font-medium">
                Ver todas las notificaciones
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Función auxiliar para formatear tiempo relativo
function formatTimeAgo(date: any): string {
  if (!date) return ''

  let timestamp: number
  if (date.toMillis) {
    // Firestore Timestamp
    timestamp = date.toMillis()
  } else if (date instanceof Date) {
    timestamp = date.getTime()
  } else if (typeof date === 'number') {
    timestamp = date
  } else {
    return ''
  }

  const now = new Date().getTime()
  const diff = now - timestamp

  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (seconds < 60) return 'Hace unos segundos'
  if (minutes < 60) return `Hace ${minutes}m`
  if (hours < 24) return `Hace ${hours}h`
  if (days < 7) return `Hace ${days}d`

  const dateObj = new Date(timestamp)
  return dateObj.toLocaleDateString('es-EC')
}
