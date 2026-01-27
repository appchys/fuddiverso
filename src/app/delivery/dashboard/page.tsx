'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useDeliveryAuth } from '@/contexts/DeliveryAuthContext'
import { getOrdersByDelivery, updateOrderStatus, getDeliveryById } from '@/lib/database'
import { Order, Delivery } from '@/types'
import { Timestamp, collection, query, where, onSnapshot } from 'firebase/firestore'
import { GOOGLE_MAPS_API_KEY } from '@/components/GoogleMap'

function DeliveryDashboardContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, deliveryId, isAuthenticated, authLoading, logout } = useDeliveryAuth()
  const [orders, setOrders] = useState<Order[]>([])
  const [delivery, setDelivery] = useState<Delivery | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
  const [showOrderModal, setShowOrderModal] = useState(false)
  const [expandedOrderIds, setExpandedOrderIds] = useState<Set<string>>(new Set())
  const [expandedSummary, setExpandedSummary] = useState<'none' | 'cash' | 'transfer' | 'earnings'>('none')
  const [, setTimeRefresh] = useState(0) // Para forzar re-render del tiempo cada minuto
  const [deliveryLocation, setDeliveryLocation] = useState<{ lat: number; lng: number } | null>(null)
  const [selectedImage, setSelectedImage] = useState<string | null>(null)
  const [notification, setNotification] = useState<{ show: boolean; message: string; type: 'success' | 'info' }>({ show: false, message: '', type: 'success' })

  const toggleOrderExpansion = (orderId: string) => {
    setExpandedOrderIds(prev => {
      const newSet = new Set(prev)
      if (newSet.has(orderId)) {
        newSet.delete(orderId)
      } else {
        newSet.add(orderId)
      }
      return newSet
    })
  }

  const getTodayRange = () => {
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000 - 1)
    return { start: todayStart, end: todayEnd }
  }

  const { start: rangeStart, end: rangeEnd } = getTodayRange()

  // Función para obtener la fecha del pedido (prioridad: timing.scheduledDate, fallback: createdAt)
  const getOrderDate = (order: Order): Date => {
    // 1. Primero verificar si hay una fecha programada
    if (order.timing?.scheduledDate && order.timing.type === 'scheduled') {
      const ts = order.timing.scheduledDate;
      // Manejar tanto Timestamp de Firestore como Date
      const date = ts instanceof Date ? ts : new Date(ts.seconds * 1000 + (ts.nanoseconds || 0) / 1_000_000);

      // Debug log opcional (remueve en prod)
      if (process.env.NODE_ENV === 'development') {

      }
      return date;
    }

    // 2. Si no hay fecha programada, usar createdAt
    const createdAt = order.createdAt;

    // Si ya es un objeto Date, devolverlo directamente
    if (createdAt instanceof Date) {
      return createdAt;
    }

    // Si es un Timestamp de Firestore (tiene método toDate)
    if (createdAt && typeof createdAt === 'object' && 'toDate' in createdAt && typeof (createdAt as any).toDate === 'function') {
      return (createdAt as any).toDate();
    }

    // Si es un string o cualquier otro formato, intentar crear una fecha
    try {
      return new Date(createdAt as string);
    } catch (e) {
      console.error('Error al analizar la fecha:', e);
      return new Date(); // Fallback a la fecha actual
    }
  }

  // Función para calcular el tiempo restante hasta la hora de entrega
  const getTimeRemaining = (order: Order): { display: string; isExpired: boolean } => {
    if (!order.timing?.scheduledTime) {
      return { display: '--', isExpired: false }
    }

    // Obtener la hora de entrega programada (string: "17:08")
    const [hours, minutes] = order.timing.scheduledTime.split(':').map(Number)

    // Obtener la hora actual en UTC
    let now = new Date()

    // Si la orden ya fue entregada, usamos la hora de entrega para "congelar" el contador
    if (order.status === 'delivered' && order.statusHistory?.deliveredAt) {
      const deliveredAt = order.statusHistory.deliveredAt
      if (deliveredAt instanceof Timestamp) {
        now = deliveredAt.toDate()
      } else if (deliveredAt instanceof Date) {
        now = deliveredAt
      }
      // Nota: Si es string u otro, se queda con new Date() por defecto
    }

    // Calcular la hora actual en Ecuador (UTC-5)
    const nowEcuadorMs = now.getTime() - (5 * 60 * 60 * 1000)
    const nowEcuadorDate = new Date(nowEcuadorMs)

    // Obtener la fecha de hoy en Ecuador usando UTC methods
    const yearEcuador = nowEcuadorDate.getUTCFullYear()
    const monthEcuador = nowEcuadorDate.getUTCMonth()
    const dayEcuador = nowEcuadorDate.getUTCDate()

    // Crear la fecha de entrega para hoy en Ecuador (en UTC)
    const deliveryEcuadorMs = Date.UTC(yearEcuador, monthEcuador, dayEcuador, hours, minutes, 0)

    // Convertir de vuelta a UTC sumando 5 horas
    const deliveryTimeUTC = new Date(deliveryEcuadorMs + (5 * 60 * 60 * 1000))

    // Calcular diferencia en milisegundos
    const diff = deliveryTimeUTC.getTime() - now.getTime()

    if (diff < 0) {
      const absDiff = Math.abs(diff)
      const totalMinutes = Math.floor(absDiff / 60000)
      const h = Math.floor(totalMinutes / 60)
      const m = totalMinutes % 60

      const display = h > 0 ? `-${h}h ${m}m` : `-${m}m`
      return { display, isExpired: true }
    }

    // Convertir a horas y minutos
    const totalMinutes = Math.floor(diff / 60000)
    const h = Math.floor(totalMinutes / 60)
    const m = totalMinutes % 60

    if (h > 0) {
      return { display: `${h}h ${m}m`, isExpired: false }
    } else {
      return { display: `${m}m`, isExpired: false }
    }
  }

  // AJUSTADO PARA TIMING: Filtrar por getOrderDate
  const filterOrdersByDate = (ordersToFilter: Order[]) => {
    return ordersToFilter.filter(order => {
      const orderDate = getOrderDate(order)
      return orderDate >= rangeStart && orderDate <= rangeEnd
    })
  }

  // Pedidos filtrados por fecha de programación (aplicado antes del filtro de estado)
  const ordersByDate = filterOrdersByDate(orders)

  // AJUSTADO PARA TIMING: Filtrar deliveredByMe por getOrderDate (no por deliveredAt ni createdAt)
  // Ingresos/ganancias se atribuyen a la fecha programada del pedido
  const deliveredByMe = orders.filter(o => {
    if (!(o.status === 'delivered' && o.delivery?.assignedDelivery === deliveryId)) return false
    const orderDate = getOrderDate(o)
    // Debug log opcional
    if (process.env.NODE_ENV === 'development') {

    }
    return orderDate >= rangeStart && orderDate <= rangeEnd
  })

  // Cálculos de resumen desglosados (Activos vs Entregados)
  const calculateCategorySummary = (ordersList: Order[], method?: 'cash' | 'transfer' | 'mixed' | 'earnings') => {
    return ordersList.reduce((sum, o) => {
      if (method === 'earnings') {
        return sum + (o.delivery?.deliveryCost || 0)
      }
      if (o.payment?.method === method) return sum + o.total
      if (o.payment?.method === 'mixed') {
        if (method === 'cash') return sum + (o.payment.cashAmount || 0)
        if (method === 'transfer') return sum + (o.payment.transferAmount || 0)
      }
      return sum
    }, 0)
  }

  const activeByMe = ordersByDate.filter(o => o.status !== 'delivered' && o.status !== 'cancelled' && o.delivery?.assignedDelivery === deliveryId)
  const deliveredByMeInRange = ordersByDate.filter(o => o.status === 'delivered' && o.delivery?.assignedDelivery === deliveryId)

  // Efectivo
  const summaryCashActive = calculateCategorySummary(activeByMe, 'cash')
  const summaryCashDelivered = calculateCategorySummary(deliveredByMeInRange, 'cash')
  const summaryCashTotal = summaryCashActive + summaryCashDelivered

  // Transferencia
  const summaryTransferActive = calculateCategorySummary(activeByMe, 'transfer')
  const summaryTransferDelivered = calculateCategorySummary(deliveredByMeInRange, 'transfer')
  const summaryTransferTotal = summaryTransferActive + summaryTransferDelivered

  // Ganancias
  const summaryEarningsActive = calculateCategorySummary(activeByMe, 'earnings')
  const summaryEarningsDelivered = calculateCategorySummary(deliveredByMeInRange, 'earnings')
  const summaryEarningsTotal = summaryEarningsActive + summaryEarningsDelivered

  const showNotification = (message: string, type: 'success' | 'info' = 'success') => {
    setNotification({ show: true, message, type })
    setTimeout(() => setNotification(prev => ({ ...prev, show: false })), 5000)
  }

  // Detectar acciones desde la URL (procedentes del email de asignación)
  useEffect(() => {
    const action = searchParams.get('action')
    const orderId = searchParams.get('orderId')

    if (action && orderId) {
      if (action === 'confirm') {
        showNotification(`✅ ¡Pedido #${orderId} confirmado con éxito!`, 'success')
      } else if (action === 'discard') {
        showNotification(`ℹ️ Pedido #${orderId} descartado.`, 'info')
      }

      // Limpiar los parámetros de la URL para evitar que la notificación se muestre de nuevo al refrescar
      const newUrl = window.location.pathname
      window.history.replaceState({}, '', newUrl)
    }
  }, [searchParams])

  // Protección de ruta
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.replace('/delivery/login')
    }
  }, [authLoading, isAuthenticated, router])

  // Cargar datos del delivery y pedidos
  useEffect(() => {
    if (!deliveryId) {

      return
    }

    // Listener en tiempo real para pedidos
    let unsubscribeOrders: (() => void) | null = null;
    let isMounted = true;

    const loadDelivery = async () => {
      try {
        const deliveryData = await getDeliveryById(deliveryId)
        if (isMounted) setDelivery(deliveryData)
      } catch (error) {
        console.error('Error loading delivery:', error)
      }
    }

    loadDelivery()

    // Importar la instancia de db y usar los métodos Firestore ya importados
    import('@/lib/firebase').then(({ db }) => {
      const ordersRef = collection(db, 'orders')
      const q = query(ordersRef, where('delivery.assignedDelivery', '==', deliveryId))
      unsubscribeOrders = onSnapshot(q, (snapshot: any) => {
        const ordersData = snapshot.docs.map((doc: any) => {
          const data = doc.data()
          // Log detallado para debugging
          if (process.env.NODE_ENV === 'development') {
            console.log('[Dashboard] Raw Firestore doc data:', {
              orderId: doc.id,
              deliveryObject: data.delivery,
              deliveryType: data.delivery?.type,
              deliveryPhoto: data.delivery?.photo,
              deliveryLatlong: data.delivery?.latlong,
              fullDeliveryKeys: data.delivery ? Object.keys(data.delivery) : 'no delivery object'
            })
          }
          return { id: doc.id, ...data }
        })
        if (isMounted) setOrders(ordersData)
        setLoading(false)
      }, (error: any) => {
        console.error('Error en listener de pedidos:', error)
        setLoading(false)
      })
    })

    return () => {
      isMounted = false;
      if (unsubscribeOrders) unsubscribeOrders()
    }
  }, [deliveryId])

  // Refrescar el tiempo restante cada minuto
  useEffect(() => {
    const interval = setInterval(() => {
      setTimeRefresh(prev => prev + 1)
    }, 60000) // Cada minuto
    return () => clearInterval(interval)
  }, [])

  // Tracking de ubicación del delivery
  useEffect(() => {
    if (!deliveryId) return

    // Verificar si hay pedidos activos "en camino"
    const hasActiveOrders = orders.some(o =>
      o.status === 'on_way' && o.delivery?.assignedDelivery === deliveryId
    )

    if (!hasActiveOrders) {
      // Si no hay pedidos activos, limpiar ubicación
      setDeliveryLocation(null)
      return
    }

    // Función para actualizar ubicación
    const updateLocation = () => {
      if ('geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition(
          async (position) => {
            const location = {
              lat: position.coords.latitude,
              lng: position.coords.longitude
            }
            setDeliveryLocation(location)

            // Guardar en Firebase
            try {
              const { db } = await import('@/lib/firebase')
              const { doc, updateDoc, Timestamp } = await import('firebase/firestore')
              const deliveryRef = doc(db, 'deliveries', deliveryId)
              await updateDoc(deliveryRef, {
                currentLocation: location,
                lastLocationUpdate: Timestamp.now()
              })
            } catch (error) {
              console.error('Error updating delivery location:', error)
            }
          },
          (error) => {
            console.error('Error getting location:', error)
          },
          {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
          }
        )
      }
    }

    // Actualizar inmediatamente
    updateLocation()

    // Actualizar cada 30 segundos
    const interval = setInterval(updateLocation, 30000)

    return () => clearInterval(interval)
  }, [deliveryId, orders])

  const handleStatusChange = async (orderId: string, newStatus: Order['status']) => {
    try {
      await updateOrderStatus(orderId, newStatus)
      setOrders(orders.map(order =>
        order.id === orderId ? { ...order, status: newStatus } : order
      ))

      // Cerrar modal si está abierto
      if (selectedOrder?.id === orderId) {
        setSelectedOrder({ ...selectedOrder, status: newStatus })
      }
    } catch (error) {
      console.error('Error updating status:', error)
      alert('Error al actualizar el estado del pedido')
    }
  }

  const openOrderDetails = (order: Order) => {
    setSelectedOrder(order)
    setShowOrderModal(true)
  }

  const getStatusColor = (status: Order['status']) => {
    const colors = {
      pending: 'bg-yellow-100 text-yellow-800 border-yellow-200',
      confirmed: 'bg-blue-100 text-blue-800 border-blue-200',
      preparing: 'bg-purple-100 text-purple-800 border-purple-200',
      ready: 'bg-green-100 text-green-800 border-green-200',
      delivered: 'bg-gray-100 text-gray-800 border-gray-200',
      cancelled: 'bg-red-100 text-red-800 border-red-200',
      on_way: 'bg-cyan-100 text-cyan-800 border-cyan-200'
    }
    return colors[status] || colors.pending
  }

  const getStatusText = (status: Order['status']) => {
    const texts = {
      pending: 'Pendiente',
      confirmed: 'Confirmado',
      preparing: 'Preparando',
      ready: 'Listo',
      delivered: 'Entregado',
      cancelled: 'Cancelado',
      on_way: 'En camino'
    }
    return texts[status] || status
  }

  // Agrupamiento de pedidos por visibilidad (Activos / Entregados)
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set(['Entregados']))

  const toggleCategoryCollapse = (status: string) => {
    const newCollapsed = new Set(collapsedCategories)
    if (newCollapsed.has(status)) {
      newCollapsed.delete(status)
    } else {
      newCollapsed.add(status)
    }
    setCollapsedCategories(newCollapsed)
  }

  const groupOrdersByDisplay = (ordersToGroup: Order[]) => {
    const groups: Record<string, Order[]> = {
      'Activos': [],
      'Entregados': []
    }

    ordersToGroup.forEach(order => {
      if (order.status === 'delivered') {
        groups['Entregados'].push(order)
      } else if (order.status !== 'cancelled') {
        groups['Activos'].push(order)
      }
    })

    // Ordenar cada grupo por hora programada
    Object.keys(groups).forEach(group => {
      groups[group].sort((a, b) => {
        const dateA = getOrderDate(a).getTime()
        const dateB = getOrderDate(b).getTime()
        return dateA - dateB
      })
    })

    return groups
  }

  const groupedOrders = groupOrdersByDisplay(ordersByDate)
  const displayGroups = ['Activos', 'Entregados']

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Cargando...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-transparent">
      {/* Resumen del Delivery (cobros y ganancias) */}
      <div className="bg-white border-b">
        <div className="px-4 py-3">
          <div className="grid grid-cols-3 gap-2">
            {[
              { id: 'cash', label: 'Efectivo', total: summaryCashTotal, active: summaryCashActive, delivered: summaryCashDelivered, color: 'green' },
              { id: 'transfer', label: 'Transf.', total: summaryTransferTotal, active: summaryTransferActive, delivered: summaryTransferDelivered, color: 'blue' },
              { id: 'earnings', label: 'Ganancia', total: summaryEarningsTotal, active: summaryEarningsActive, delivered: summaryEarningsDelivered, color: 'purple' }
            ].map(card => (
              <button
                key={card.id}
                onClick={() => setExpandedSummary(prev => prev === card.id ? 'none' : card.id as any)}
                className={`p-1.5 rounded-xl border transition-all flex flex-col items-center text-center ${expandedSummary === card.id
                  ? `ring-1 ring-${card.color}-500 bg-${card.color}-50 border-${card.color}-200`
                  : `bg-${card.color}-50/30 border-transparent`
                  }`}
              >
                <p className="text-[9px] text-gray-500 font-bold uppercase tracking-tighter mb-0.5">{card.label}</p>
                <p className={`text-sm font-black text-${card.color}-700 leading-none`}>${card.total.toFixed(2)}</p>

                {expandedSummary === card.id && (
                  <div className="mt-1.5 pt-1.5 border-t border-gray-200 w-full animate-fadeIn">
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center justify-between px-1">
                        <span className="text-[10px]">🔥</span>
                        <span className="text-[10px] font-bold text-gray-700">${card.active.toFixed(2)}</span>
                      </div>
                      <div className="flex items-center justify-between px-1">
                        <span className="text-[10px]">📦</span>
                        <span className={`text-[10px] font-black text-${card.color}-600`}>${card.delivered.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Lista de pedidos agrupados */}
      <div className="p-4 pb-20 space-y-6">
        {
          orders.length === 0 ? (
            <div className="text-center py-12">
              <svg className="w-16 h-16 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
              </svg>
              <p className="text-gray-600 font-medium">No hay pedidos para hoy</p>
              <p className="text-sm text-gray-500 mt-1">
                Los pedidos programados para hoy aparecerán aquí
              </p>
            </div>
          ) : (
            displayGroups.map(groupName => {
              const groupOrders = groupedOrders[groupName]
              if (groupOrders.length === 0) return null

              const isCollapsed = collapsedCategories.has(groupName)

              return (
                <div key={groupName} className="space-y-3">
                  <button
                    onClick={() => toggleCategoryCollapse(groupName)}
                    className="w-full flex items-center justify-between py-2 px-1 border-b border-gray-200"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-lg">
                        {groupName === 'Activos' ? '🔥' : '📦'}
                      </span>
                      <h3 className="font-bold text-gray-900 uppercase tracking-wider text-[10px]">
                        {groupName} ({groupOrders.length})
                      </h3>
                    </div>
                    <svg className={`w-4 h-4 text-gray-400 transition-transform ${isCollapsed ? '' : 'rotate-180'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {!isCollapsed && (
                    <div className="space-y-3">
                      {groupOrders.map((order) => {
                        const isExpanded = expandedOrderIds.has(order.id);

                        return (
                          <div
                            key={order.id}
                            className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition-all animate-fadeIn"
                          >
                            {/* Header del pedido (Clickable) */}
                            <div
                              onClick={() => toggleOrderExpansion(order.id)}
                              className={`p-4 sm:p-5 cursor-pointer flex items-center justify-between transition-colors ${isExpanded ? 'bg-gray-50' : 'bg-white'}`}
                            >
                              <div className="flex items-center gap-3 flex-1 min-w-0">
                                {/* Icono REMOVIDO por solicitud */}


                                {/* Hora y Cliente */}
                                <div className="flex-1 min-w-0">
                                  {(() => {
                                    const timeRemaining = getTimeRemaining(order)
                                    return (
                                      <>
                                        <p className={`text-2xl font-bold leading-none ${timeRemaining.isExpired ? 'text-red-600' : order.timing?.type === 'scheduled' ? 'text-blue-600' : 'text-gray-900'}`}>
                                          {timeRemaining.display}
                                        </p>
                                        <p className="text-xs text-gray-500 font-medium mt-1">
                                          {order.timing?.scheduledTime
                                            ? order.timing.scheduledTime
                                            : new Date(getOrderDate(order)).toLocaleString('es-EC', {
                                              hour: '2-digit',
                                              minute: '2-digit'
                                            })
                                          }
                                        </p>
                                      </>
                                    )
                                  })()}
                                  <div className="mt-2">
                                    <p className="text-sm font-semibold text-gray-900 leading-tight truncate">{order.customer.name}</p>
                                    <p className="text-xs text-gray-500 font-medium line-clamp-1">{order.delivery.references || 'Sin referencia'}</p>
                                  </div>
                                </div>
                              </div>

                              <div className="flex flex-col items-end gap-2">
                                <div className="text-right">
                                  {order.payment?.method !== 'transfer' && (
                                    <p className="text-xl font-bold text-green-600 tracking-tight flex items-center justify-end gap-1">
                                      <span className="text-lg">💵</span>
                                      ${order.total.toFixed(2)}
                                    </p>
                                  )}
                                  {order.payment?.method === 'transfer' && (
                                    <div className="flex flex-col items-end">
                                      <span className="text-2xl" title="Pagado por Transferencia">🏦</span>
                                    </div>
                                  )}
                                </div>

                                {/* Botón "En camino" - Visible en header */}
                                {order.status !== 'on_way' && order.status !== 'delivered' && order.status !== 'cancelled' && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      handleStatusChange(order.id, 'on_way')
                                    }}
                                    className="px-3 py-1.5 bg-blue-600 text-white rounded-xl font-bold text-xs hover:bg-blue-700 transition-all active:scale-95 flex items-center gap-1.5 shadow-md"
                                  >
                                    <i className="bi bi-bicycle text-sm"></i>
                                    En camino
                                  </button>
                                )}

                                <i className={`bi bi-chevron-down text-gray-300 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}></i>
                              </div>
                            </div>

                            {/* Cuerpo Expansible (Contenido) */}
                            {isExpanded && (
                              <div className="px-4 pb-5 sm:px-5 sm:pb-6 animate-slideDown">
                                <div className="h-px bg-gray-100 mb-5"></div>

                                {/* Dirección y Mapa */}
                                {order.delivery.type === 'delivery' && (
                                  <div className="mb-5">
                                    {(() => {
                                      if (process.env.NODE_ENV === 'development') {
                                        console.log('[Dashboard] Order delivery data:', {
                                          orderId: order.id,
                                          deliveryType: order.delivery.type,
                                          hasLatlong: !!order.delivery.latlong,
                                          hasPhoto: !!order.delivery.photo,
                                          photoValue: order.delivery.photo,
                                          references: order.delivery.references
                                        });
                                      }
                                      return null;
                                    })()}
                                    <div className="flex items-start gap-3 text-sm mb-3 px-1">
                                      <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center text-red-500 flex-shrink-0">
                                        <i className="bi bi-geo-alt-fill"></i>
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <p className="text-gray-900 font-semibold leading-tight">{order.delivery.references || 'Sin referencia'}</p>
                                      </div>
                                    </div>

                                    {/* Mapa Estático con Controles y Foto */}
                                    {(order.delivery.latlong || (order.delivery.mapLocation?.lat && order.delivery.mapLocation?.lng)) && (
                                      <div className="flex gap-2 mb-5 h-32">
                                        {/* Mapa - 2/3 si hay foto, 100% si no */}
                                        <div
                                          onClick={() => {
                                            const destination = order.delivery.latlong
                                              ? order.delivery.latlong.replace(/\s+/g, '')
                                              : `${order.delivery.mapLocation?.lat},${order.delivery.mapLocation?.lng}`;
                                            window.open(`https://www.google.com/maps/dir/?api=1&destination=${destination}`, '_blank');
                                          }}
                                          className={`relative rounded-2xl overflow-hidden border border-gray-100 group/map cursor-pointer ${order.delivery.photo ? 'w-2/3' : 'w-full'}`}
                                        >
                                          {(() => {
                                            const coords = order.delivery.latlong
                                              ? order.delivery.latlong.replace(/\s+/g, '')
                                              : `${order.delivery.mapLocation?.lat},${order.delivery.mapLocation?.lng}`;

                                            return (
                                              <img
                                                src={`https://maps.googleapis.com/maps/api/staticmap?center=${coords}&zoom=15&size=600x200&scale=2&maptype=roadmap&markers=color:red%7C${coords}&key=${GOOGLE_MAPS_API_KEY}`}
                                                alt="Ubicación de entrega"
                                                className="w-full h-full object-cover group-hover/map:opacity-90 transition-opacity duration-300"
                                              />
                                            );
                                          })()}

                                          {/* Overlay "Trazar ruta" al hacer hover (opcional visual cue) */}
                                          <div className="absolute inset-0 bg-black/5 opacity-0 group-hover/map:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                                            <span className="bg-white/90 text-gray-800 text-xs font-bold px-2 py-1 rounded-lg shadow-sm">
                                              Trazar ruta
                                            </span>
                                          </div>

                                          {/* Controles Flotantes Verticales */}
                                          <div className="absolute top-2 right-2 flex flex-col gap-2">
                                            <a
                                              href={order.delivery.latlong
                                                ? `https://www.google.com/maps/place/${order.delivery.latlong.replace(/\s+/g, '')}`
                                                : `https://www.google.com/maps/place/${order.delivery.mapLocation?.lat},${order.delivery.mapLocation?.lng}`
                                              }
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              onClick={(e) => e.stopPropagation()}
                                              className="w-8 h-8 bg-white rounded-full shadow-lg flex items-center justify-center text-gray-700 hover:text-blue-600 transition-all active:scale-95"
                                              title="Ver en Google Maps"
                                            >
                                              <i className="bi bi-box-arrow-up-right text-xs"></i>
                                            </a>
                                            <a
                                              href={order.delivery.latlong
                                                ? `https://www.google.com/maps/dir/?api=1&destination=${order.delivery.latlong.replace(/\s+/g, '')}`
                                                : `https://www.google.com/maps/dir/?api=1&destination=${order.delivery.mapLocation?.lat},${order.delivery.mapLocation?.lng}`
                                              }
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              onClick={(e) => e.stopPropagation()}
                                              className="w-8 h-8 bg-white rounded-full shadow-lg flex items-center justify-center text-blue-600 hover:bg-blue-50 transition-all active:scale-95"
                                              title="Trazar ruta"
                                            >
                                              <i className="bi bi-cursor-fill text-xs"></i>
                                            </a>
                                          </div>
                                        </div>

                                        {/* Foto de ubicación - 1/3 */}
                                        {order.delivery.photo && (
                                          <div
                                            className="w-1/3 rounded-2xl overflow-hidden border border-gray-100 relative cursor-pointer group/photo"
                                            onClick={() => setSelectedImage(order.delivery.photo || null)}
                                          >
                                            <img
                                              src={order.delivery.photo}
                                              alt="Referencia visual"
                                              className="w-full h-full object-cover group-hover/photo:scale-105 transition-transform duration-500"
                                            />
                                            <div className="absolute inset-0 bg-black/0 group-hover/photo:bg-black/10 transition-colors flex items-center justify-center">
                                              <i className="bi bi-arrows-fullscreen text-white opacity-0 group-hover/photo:opacity-100 drop-shadow-md transition-opacity"></i>
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                )}

                                {/* Resumen del pedido */}
                                <div className="mb-6 p-4 bg-gray-50 rounded-2xl border border-gray-100">
                                  <div className="flex items-center gap-2 mb-3">
                                    <i className="bi bi-bag-check text-xs text-gray-400"></i>
                                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Productos del pedido</p>
                                  </div>
                                  <ul className="space-y-2">
                                    {order.items.map((item, idx) => (
                                      <li key={idx} className="text-sm text-gray-700 flex items-start gap-2">
                                        <span className="w-6 h-6 flex-shrink-0 flex items-center justify-center bg-white border border-gray-200 rounded-lg text-[10px] font-bold">{item.quantity}</span>
                                        <div className="flex-1">
                                          <p className="font-semibold leading-tight">{(item as any).name || (item.product as any)?.name || 'Producto'}</p>
                                          <p className="text-[10px] text-gray-500">Subtotal: ${((item as any).price * item.quantity).toFixed(2)}</p>
                                        </div>
                                      </li>
                                    ))}
                                  </ul>
                                </div>

                                {/* Acciones */}
                                <div className="flex gap-2">
                                  <a
                                    href={`https://wa.me/593${order.customer.phone.slice(1)}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="flex-1 flex items-center justify-center gap-2 py-3.5 bg-white border-2 border-green-500 text-green-600 rounded-2xl font-bold text-sm hover:bg-green-50 transition-all active:scale-95 shadow-sm"
                                  >
                                    <i className="bi bi-whatsapp text-lg"></i>
                                    WHATSAPP
                                  </a>

                                  <a
                                    href={`tel:${order.customer.phone}`}
                                    onClick={(e) => e.stopPropagation()}
                                    className="w-14 flex items-center justify-center bg-white border-2 border-blue-500 text-blue-600 rounded-2xl hover:bg-blue-50 transition-all active:scale-95 shadow-sm"
                                    title="Llamar"
                                  >
                                    <i className="bi bi-telephone-fill text-lg"></i>
                                  </a>

                                  {order.status !== 'on_way' && order.status !== 'delivered' && order.status !== 'cancelled' && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        handleStatusChange(order.id, 'on_way')
                                      }}
                                      className="flex-[2] py-3.5 bg-blue-600 text-white rounded-2xl font-bold text-sm hover:bg-blue-700 transition-all active:scale-95 flex items-center justify-center gap-2 shadow-lg"
                                    >
                                      <i className="bi bi-bicycle text-lg"></i>
                                      EN CAMINO
                                    </button>
                                  )}

                                  {order.status === 'on_way' && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        handleStatusChange(order.id, 'delivered')
                                      }}
                                      className="flex-[2] py-3.5 bg-gray-900 text-white rounded-2xl font-bold text-sm hover:bg-black transition-all active:scale-95 flex items-center justify-center gap-2 shadow-lg"
                                    >
                                      <i className="bi bi-check2-circle text-lg"></i>
                                      ENTREGADO
                                    </button>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )
            })
          )
        }
      </div >

      {/* Modal de detalles del pedido - Sin cambios mayores */}
      {
        showOrderModal && selectedOrder && (
          <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
            <div className="bg-white w-full sm:max-w-2xl sm:rounded-lg max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl">
              {/* Header del modal */}
              <div className="sticky top-0 bg-white border-b px-4 py-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">Detalles del Pedido</h2>
                <button
                  onClick={() => setShowOrderModal(false)}
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="p-4 space-y-4">
                {/* Estado y acciones */}
                <div className="bg-gray-50 rounded-lg p-4">
                  <p className="text-sm font-medium text-gray-700 mb-3">Estado actual:</p>
                  <span className={`inline-block px-3 py-1.5 rounded-full text-sm font-medium border ${getStatusColor(selectedOrder.status)}`}>
                    {getStatusText(selectedOrder.status)}
                  </span>

                  {selectedOrder.status !== 'delivered' && selectedOrder.status !== 'cancelled' && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {selectedOrder.status !== 'on_way' && (
                        <button
                          onClick={() => handleStatusChange(selectedOrder.id, 'on_way')}
                          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                        >
                          Marcar como En camino
                        </button>
                      )}
                      {selectedOrder.status === 'on_way' && (
                        <button
                          onClick={() => handleStatusChange(selectedOrder.id, 'delivered')}
                          className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors"
                        >
                          Marcar como Entregado
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Información del cliente */}
                <div className="border rounded-lg p-4">
                  <h3 className="font-semibold text-gray-900 mb-3">Cliente</h3>
                  <div className="space-y-2 text-sm">
                    <p><span className="text-gray-600">Nombre:</span> <span className="font-medium">{selectedOrder.customer.name}</span></p>
                    <p><span className="text-gray-600">Teléfono:</span> <a href={`tel:${selectedOrder.customer.phone}`} className="font-medium text-blue-600 hover:underline">{selectedOrder.customer.phone}</a></p>
                    <a
                      href={`https://wa.me/593${selectedOrder.customer.phone.slice(1)}?text=Hola, soy tu delivery. Estoy en camino con tu pedido.`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-lg text-sm font-medium hover:bg-green-600 transition-colors mt-2"
                    >
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                      </svg>
                      Enviar WhatsApp
                    </a>
                  </div>
                </div>

                {/* Dirección de entrega */}
                {selectedOrder.delivery.type === 'delivery' && (
                  <div className="border rounded-lg p-4">
                    <h3 className="font-semibold text-gray-900 mb-3">Dirección de Entrega</h3>
                    <p className="text-sm text-gray-700 mb-2">{selectedOrder.delivery.references || 'Sin referencia'}</p>

                    {/* Mapa y Foto en Modal de Detalles (opcional, por ahora solo texto o lo que ya estaba) */}
                  </div>
                )}
              </div>
            </div>
            {/* Notificación sutil (Toast) será movida abajo */}
          </div>
        )
      }

      {/* Lightbox Modal de Imagen */}
      {selectedImage && (
        <div
          className="fixed inset-0 bg-black/90 z-[60] flex items-center justify-center p-4 animate-fadeIn"
          onClick={() => setSelectedImage(null)}
        >
          <button
            className="absolute top-4 right-4 text-white hover:text-gray-300 p-2"
            onClick={() => setSelectedImage(null)}
          >
            <i className="bi bi-x-lg text-2xl"></i>
          </button>
          <img
            src={selectedImage}
            alt="Detalle"
            className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl animate-scaleIn"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
      {/* Notificación sutil (Toast) */}
      {notification.show && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[100] w-[calc(100%-2rem)] max-w-xs animate-[slideDown_0.3s_ease-out]">
          <div className={`backdrop-blur-xl border border-white/10 rounded-2xl px-5 py-3.5 shadow-xl flex items-center gap-3 ${notification.type === 'success' ? 'bg-emerald-600/95 text-white' : 'bg-gray-800/95 text-white'
            }`}>
            <div className="flex-1">
              <p className="font-bold text-sm leading-tight text-center">
                {notification.message}
              </p>
            </div>
          </div>
          <style jsx>{`
            @keyframes slideDown {
              from { transform: translate(-50%, -20px); opacity: 0; }
              to { transform: translate(-50%, 0); opacity: 1; }
            }
          `}</style>
        </div>
      )}
    </div>
  )
}

export default function DeliveryDashboard() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Cargando dashboard...</p>
        </div>
      </div>
    }>
      <DeliveryDashboardContent />
    </Suspense>
  )
}