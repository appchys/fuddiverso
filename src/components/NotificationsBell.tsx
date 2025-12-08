'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { db } from '@/lib/firebase'
import { collection, query, where, orderBy, onSnapshot, updateDoc, doc, addDoc, serverTimestamp } from 'firebase/firestore'
import { Order } from '@/types'

interface Notification {
  id: string
  orderId?: string
  type: 'new_order' | 'order_status_change' | 'qr_scan' | 'rating'
  title: string
  message: string
  createdAt: any
  read: boolean
  orderData?: Partial<Order>
  qrCodeName?: string
  scannedCount?: number
  isCompleted?: boolean
  userId?: string
  rating?: number
  review?: string
  clientName?: string
  clientPhone?: string
}

interface NotificationsBellProps {
  businessId: string
  onNewOrder?: (order: Order) => void
}

export default function NotificationsBell({ businessId, onNewOrder }: NotificationsBellProps) {
  const router = useRouter()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [loading, setLoading] = useState(true)
  const audioRef = useRef<HTMLAudioElement>(null)
  const lastProcessedNotificationIdRef = useRef<string | null>(null)

  // Función para reproducir un sonido de notificación usando Web Audio API
  const playNotificationSound = () => {
    try {
      // Verificar que el usuario ha interactuado con la página
      if ((document as any).hidden) {
        return // No reproducir si la pestaña está oculta
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

      // Establecer volumen bajo para no molestar
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

      console.log('[NotificationsBell] Sonido de notificación reproducido')
    } catch (error) {
      // Silenciosamente fallar si Web Audio API no está disponible
      console.debug('[NotificationsBell] No se pudo reproducir sonido:', error)
    }
  }

  // Escuchar notificaciones en tiempo real desde Firebase
  useEffect(() => {
    if (!businessId) return

    let unsubscribe: (() => void) | null = null

    try {
      // Query ordenadas por fecha más reciente primero
      const q = query(
        collection(db, 'businesses', businessId, 'notifications'),
        orderBy('createdAt', 'desc')
      )

      // Listener en tiempo real - cualquier cambio en Firebase se refleja aquí
      unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          const notifs: Notification[] = []
          let hasNewNotification = false

          snapshot.forEach((doc) => {
            const data = doc.data()
            const notif: Notification = {
              id: doc.id,
              ...data,
              // Asegurar que el campo read existe
              read: data.read ?? false,
              createdAt: data.createdAt
            } as Notification

            notifs.push(notif)

            // Detectar si es una notificación nueva (no hemos visto este ID antes)
            if (
              notif.id !== lastProcessedNotificationIdRef.current &&
              !lastProcessedNotificationIdRef.current
            ) {
              hasNewNotification = true
              lastProcessedNotificationIdRef.current = notif.id
            }
          })

          // Actualizar estado con notificaciones de Firebase
          setNotifications(notifs)
          setLoading(false)

          // Reproducir sonido solo si hay una notificación completamente nueva
          if (hasNewNotification) {
            playNotificationSound()
          }
        },
        (error) => {
          // Solo loguear errores importantes
          if ((error as any).code === 'permission-denied') {
            console.debug(
              'No permission to read notifications (expected if user not authenticated)'
            )
          } else {
            console.error('Error listening to notifications:', error)
          }
          setLoading(false)
        }
      )
    } catch (error) {
      console.error('Error setting up notification listener:', error)
      setLoading(false)
    }

    // Cleanup: desuscribirse cuando el componente se desmonta
    return () => {
      if (unsubscribe) {
        unsubscribe()
      }
    }
  }, [businessId])



  // Marcar notificación como leída (se sincroniza en Firebase)
  const markAsRead = async (notificationId: string) => {
    try {
      // Actualizar en Firebase de inmediato
      const notifRef = doc(
        db,
        'businesses',
        businessId,
        'notifications',
        notificationId
      )

      // Usar updateDoc para actualizar solo el campo read
      // El listener onSnapshot detectará este cambio automáticamente
      await updateDoc(notifRef, {
        read: true
      })

      console.log(`[NotificationsBell] Notificación ${notificationId} marcada como leída`)
    } catch (error) {
      console.error(
        `[NotificationsBell] Error marking notification ${notificationId} as read:`,
        error
      )
      // No mostrar error al usuario, continuamos normalmente
    }
  }

  // Marcar todas como leídas (se sincroniza en Firebase)
  const markAllAsRead = async () => {
    try {
      const unreadNotifications = notifications.filter((n) => !n.read)

      if (unreadNotifications.length === 0) {
        return // Nada que hacer
      }

      // Ejecutar todas las actualizaciones en paralelo para mayor rapidez
      const updatePromises = unreadNotifications.map((notif) => markAsRead(notif.id))

      await Promise.all(updatePromises)

      console.log(
        `[NotificationsBell] ${unreadNotifications.length} notificaciones marcadas como leídas`
      )
    } catch (error) {
      console.error('[NotificationsBell] Error marking all as read:', error)
      // No mostrar error al usuario, continuamos normalmente
    }
  }

  // Manejar clic en notificación
  const handleNotificationClick = async (notif: Notification) => {
    // Marcar como leída si aún no lo está
    if (!notif.read) {
      await markAsRead(notif.id)
    }

    // Si es una notificación de QR, navegar a la página de estadísticas
    if (notif.type === 'qr_scan') {
      setShowDropdown(false)
      router.push(`/business/qr-codes?tab=users`)
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
        <div className="fixed md:absolute inset-0 md:inset-auto md:right-0 md:mt-2 md:w-80 bg-white rounded-lg shadow-xl border border-gray-200 z-50 md:max-h-screen md:overflow-hidden flex flex-col md:rounded-lg">
          {/* Header */}
          <div className="p-4 border-b bg-gray-50 flex justify-between items-center sticky top-0">
            <h3 className="font-semibold text-gray-900">Notificaciones</h3>
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="text-xs text-blue-600 hover:text-blue-700 font-medium"
              >
                Marcar todas como leídas
              </button>
            )}
            {/* Botón cerrar solo en mobile */}
            <button
              onClick={() => setShowDropdown(false)}
              className="md:hidden ml-2 text-gray-500 hover:text-gray-700"
            >
              <i className="bi bi-x-lg text-lg"></i>
            </button>
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
                  onClick={() => handleNotificationClick(notif)}
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
                        {notif.type === 'rating' && (
                          <span className="mr-2 text-lg">⭐</span>
                        )}
                        <h4 className={`font-semibold text-sm ${notif.read ? 'text-gray-700' : 'text-gray-900'
                          }`}>
                          {notif.title}
                        </h4>
                      </div>
                      <p className="text-sm text-gray-600 mt-1">{notif.message}</p>

                      {/* Detalles de la orden si está disponible */}
                      {notif.orderData && notif.type === 'new_order' && (
                        <div className="mt-2 text-xs text-gray-600 space-y-1">
                          {notif.orderData.items && notif.orderData.items.length > 0 && (
                            <div>
                              <p className="font-semibold text-gray-700 mb-1">
                                <i className="bi bi-list me-1"></i>
                                Elementos:
                              </p>
                              <ul className="ml-4 space-y-0.5">
                                {notif.orderData.items.map((item: any, idx: number) => (
                                  <li key={idx} className="text-gray-600">
                                    • {item.name} x{item.quantity} - ${(item.price * item.quantity).toFixed(2)}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          <p className="border-t pt-1 mt-1 font-semibold text-gray-700">
                            <strong>Total:</strong> ${notif.orderData.total?.toFixed(2)}
                          </p>
                        </div>
                      )}

                      {/* Detalles del QR si está disponible */}
                      {notif.type === 'qr_scan' && (
                        <div className="mt-2 text-xs text-gray-500 space-y-1">
                          {notif.scannedCount !== undefined && (
                            <p>
                              <i className="bi bi-check-circle me-1"></i>
                              <strong>{notif.scannedCount}</strong> de <strong>5</strong> códigos
                            </p>
                          )}
                          {notif.isCompleted && (
                            <p className="text-green-600 font-medium">
                              <i className="bi bi-star-fill me-1"></i>
                              ¡Colección completada!
                            </p>
                          )}
                        </div>
                      )}

                      {/* Detalles de la calificación si está disponible */}
                      {notif.type === 'rating' && (
                        <div className="mt-2 text-xs text-gray-500 space-y-1">
                          {notif.clientName && <p><strong>Cliente:</strong> {notif.clientName}</p>}
                          {notif.rating && <p><strong>Calificación:</strong> {'⭐'.repeat(notif.rating)} ({notif.rating}/5)</p>}
                          {notif.review && <p><strong>Comentario:</strong> "{notif.review}"</p>}
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
