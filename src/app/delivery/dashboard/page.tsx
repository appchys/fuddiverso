'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useDeliveryAuth } from '@/contexts/DeliveryAuthContext'
import { getOrdersByDelivery, updateOrderStatus, getDeliveryById } from '@/lib/database'
import { Order, Delivery } from '@/types'

export default function DeliveryDashboard() {
  const router = useRouter()
  const { user, deliveryId, isAuthenticated, authLoading, logout } = useDeliveryAuth()
  const [orders, setOrders] = useState<Order[]>([])
  const [delivery, setDelivery] = useState<Delivery | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
  const [showOrderModal, setShowOrderModal] = useState(false)
  const [filter, setFilter] = useState<'all' | 'active' | 'completed'>('active')

  // Resúmenes para el delivery logueado (ingresos por método y ganancia por envíos)
  // Filtro de fecha para el resumen (por defecto: hoy)
  const [summaryRange, setSummaryRange] = useState<'today' | 'yesterday' | '7d' | 'all' | 'custom'>('today')
  const [customStartDate, setCustomStartDate] = useState('')
  const [customEndDate, setCustomEndDate] = useState('')

  const getRange = () => {
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000)
    if (summaryRange === 'today') return { start: todayStart, end: todayEnd }
    if (summaryRange === 'yesterday') {
      const yStart = new Date(todayStart)
      yStart.setDate(todayStart.getDate() - 1)
      const yEnd = new Date(todayStart)
      return { start: yStart, end: yEnd }
    }
    if (summaryRange === '7d') {
      const start = new Date(todayStart)
      start.setDate(todayStart.getDate() - 7)
      return { start, end: now }
    }
    if (summaryRange === 'custom') {
      const start = customStartDate ? new Date(customStartDate) : todayStart
      const end = customEndDate ? new Date(new Date(customEndDate).getTime() + 24*60*60*1000) : now
      return { start, end }
    }
    return { start: new Date(0), end: now }
  }

  const { start: rangeStart, end: rangeEnd } = getRange()

  const deliveredByMe = orders.filter(o => {
    if (!(o.status === 'delivered' && o.delivery?.assignedDelivery === deliveryId)) return false
    // Usar deliveredAt (o statusHistory.deliveredAt) para el rango
    const deliveredAtSource: any = (o as any).deliveredAt || (o as any)?.statusHistory?.deliveredAt || o.updatedAt
    const deliveredAtDate = deliveredAtSource instanceof Date
      ? deliveredAtSource
      : (deliveredAtSource?.toDate ? deliveredAtSource.toDate() : new Date(deliveredAtSource))
    return deliveredAtDate >= rangeStart && deliveredAtDate <= rangeEnd
  })

  const summaryCash = deliveredByMe.reduce((sum, o) => {
    if (o.payment?.method === 'cash') return sum + o.total
    if (o.payment?.method === 'mixed') return sum + ((o.payment as any)?.cashAmount || 0)
    return sum
  }, 0)
  const summaryTransfer = deliveredByMe.reduce((sum, o) => {
    if (o.payment?.method === 'transfer') return sum + o.total
    if (o.payment?.method === 'mixed') return sum + ((o.payment as any)?.transferAmount || 0)
    return sum
  }, 0)
  const summaryEarnings = deliveredByMe.reduce((sum, o) => {
    if (o.delivery?.type === 'delivery') return sum + (o.delivery?.deliveryCost || 0)
    return sum
  }, 0)

  // Protección de ruta
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.replace('/delivery/login')
    }
  }, [authLoading, isAuthenticated, router])

  // Cargar datos del delivery y pedidos
  useEffect(() => {
    if (!deliveryId) {
      console.log('[Dashboard] No deliveryId found')
      return
    }

    console.log('[Dashboard] Loading data for deliveryId:', deliveryId)

    const loadData = async () => {
      try {
        const [deliveryData, ordersData] = await Promise.all([
          getDeliveryById(deliveryId),
          getOrdersByDelivery(deliveryId)
        ])
        
        console.log('[Dashboard] Delivery data:', deliveryData)
        console.log('[Dashboard] Orders found:', ordersData.length)
        console.log('[Dashboard] Orders data:', ordersData)
        
        setDelivery(deliveryData)
        setOrders(ordersData)
      } catch (error) {
        console.error('Error loading data:', error)
      } finally {
        setLoading(false)
      }
    }

    loadData()

    // Recargar pedidos cada 30 segundos
    const interval = setInterval(async () => {
      try {
        const ordersData = await getOrdersByDelivery(deliveryId)
        setOrders(ordersData)
      } catch (error) {
        console.error('Error reloading orders:', error)
      }
    }, 30000)

    return () => clearInterval(interval)
  }, [deliveryId])

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

  const handleLogout = () => {
    logout()
    router.push('/delivery/login')
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
      cancelled: 'bg-red-100 text-red-800 border-red-200'
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
      cancelled: 'Cancelado'
    }
    return texts[status] || status
  }

  const filteredOrders = orders.filter(order => {
    if (filter === 'active') {
      return order.status !== 'delivered' && order.status !== 'cancelled'
    }
    if (filter === 'completed') {
      return order.status === 'delivered' || order.status === 'cancelled'
    }
    return true
  })

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
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm sticky top-0 z-10">
        <div className="px-4 py-3 sm:py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 sm:w-12 sm:h-12 bg-blue-100 rounded-full flex items-center justify-center">
                {user?.photoURL ? (
                  <img 
                    src={user.photoURL} 
                    alt="Profile" 
                    className="w-full h-full rounded-full object-cover"
                  />
                ) : (
                  <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                )}
              </div>
              <div>
                <h1 className="text-base sm:text-lg font-semibold text-gray-900">
                  {delivery?.nombres || user?.displayName || 'Delivery'}
                </h1>
                <p className="text-xs sm:text-sm text-gray-500">Panel de entregas</p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
              title="Cerrar sesión"
            >
              <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {/* Resumen del Delivery (cobros y ganancias) */}
      <div className="bg-white border-b">
        <div className="px-4 py-3 space-y-3">
          {/* Filtros de rango */}
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => setSummaryRange('today')} className={`px-3 py-1.5 rounded text-sm ${summaryRange==='today'?'bg-blue-600 text-white':'bg-gray-100 text-gray-700'}`}>Hoy</button>
            <button onClick={() => setSummaryRange('yesterday')} className={`px-3 py-1.5 rounded text-sm ${summaryRange==='yesterday'?'bg-blue-600 text-white':'bg-gray-100 text-gray-700'}`}>Ayer</button>
            <button onClick={() => setSummaryRange('7d')} className={`px-3 py-1.5 rounded text-sm ${summaryRange==='7d'?'bg-blue-600 text-white':'bg-gray-100 text-gray-700'}`}>7 días</button>
            <button onClick={() => setSummaryRange('all')} className={`px-3 py-1.5 rounded text-sm ${summaryRange==='all'?'bg-blue-600 text-white':'bg-gray-100 text-gray-700'}`}>Todo</button>
            <button onClick={() => setSummaryRange('custom')} className={`px-3 py-1.5 rounded text-sm ${summaryRange==='custom'?'bg-blue-600 text-white':'bg-gray-100 text-gray-700'}`}>Personalizado</button>
            {summaryRange === 'custom' && (
              <div className="flex items-center gap-2">
                <input type="date" value={customStartDate} onChange={e=>setCustomStartDate(e.target.value)} className="px-2 py-1 border rounded" />
                <span className="text-gray-500 text-sm">a</span>
                <input type="date" value={customEndDate} onChange={e=>setCustomEndDate(e.target.value)} className="px-2 py-1 border rounded" />
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-3 rounded-lg border bg-green-50">
              <p className="text-xs text-gray-600">Cobrado en efectivo</p>
              <p className="text-lg font-bold text-green-700">${summaryCash.toFixed(2)}</p>
            </div>
            <div className="p-3 rounded-lg border bg-blue-50">
              <p className="text-xs text-gray-600">Cobrado por transferencia</p>
              <p className="text-lg font-bold text-blue-700">${summaryTransfer.toFixed(2)}</p>
            </div>
            <div className="p-3 rounded-lg border bg-purple-50">
              <p className="text-xs text-gray-600">Ganancia por delivery</p>
              <p className="text-lg font-bold text-purple-700">${summaryEarnings.toFixed(2)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white border-b sticky top-[60px] sm:top-[68px] z-10">
        <div className="px-4 py-3">
          <div className="flex gap-2 overflow-x-auto">
            <button
              onClick={() => setFilter('active')}
              className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                filter === 'active'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              Activos ({orders.filter(o => o.status !== 'delivered' && o.status !== 'cancelled').length})
            </button>
            <button
              onClick={() => setFilter('completed')}
              className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                filter === 'completed'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              Completados ({orders.filter(o => o.status === 'delivered' || o.status === 'cancelled').length})
            </button>
            <button
              onClick={() => setFilter('all')}
              className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                filter === 'all'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              Todos ({orders.length})
            </button>
          </div>
        </div>
      </div>

      {/* Lista de pedidos */}
      <div className="p-4 pb-20">
        {filteredOrders.length === 0 ? (
          <div className="text-center py-12">
            <svg className="w-16 h-16 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
            </svg>
            <p className="text-gray-600 font-medium">No hay pedidos</p>
            <p className="text-sm text-gray-500 mt-1">Los pedidos asignados aparecerán aquí</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredOrders.map((order) => (
              <div
                key={order.id}
                onClick={() => openOrderDetails(order)}
                className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 hover:shadow-md transition-shadow cursor-pointer"
              >
                {/* Header del pedido */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium border ${getStatusColor(order.status)}`}>
                        {getStatusText(order.status)}
                      </span>
                    </div>
                    {/* Mostrar hora destacada siempre en azul */}
                    <p className="text-lg font-semibold text-blue-600">
                      🕐 {order.timing?.scheduledTime
                        ? order.timing.scheduledTime
                        : new Date(order.createdAt).toLocaleString('es-EC', {
                            hour: '2-digit',
                            minute: '2-digit'
                          })
                      }
                    </p>
                  </div>
                  <div className="text-right">
                    {/* Solo mostrar total si NO es transferencia */}
                    {order.payment?.method !== 'transfer' && (
                      <p className="text-lg font-bold text-gray-900">${order.total.toFixed(2)}</p>
                    )}
                    {order.payment?.method === 'transfer' && (
                      <p className="text-sm text-gray-500">Pagado</p>
                    )}
                  </div>
                </div>

                {/* Cliente */}
                <div className="mb-2 pb-2 border-b border-gray-100">
                  <div className="flex items-center gap-2 text-sm mb-1">
                    <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                    <span className="font-medium text-gray-900">{order.customer.name}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                    </svg>
                    <a 
                      href={`https://wa.me/593${order.customer.phone.slice(1)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-blue-600 hover:underline"
                    >
                      {order.customer.phone}
                    </a>
                    <a
                      href={`tel:${order.customer.phone}`}
                      onClick={(e) => e.stopPropagation()}
                      className="ml-1 p-1 text-green-600 hover:bg-green-50 rounded transition-colors"
                      title="Llamar"
                    >
                      <i className="bi bi-telephone-fill text-sm"></i>
                    </a>
                  </div>
                </div>

                {/* Dirección */}
                {order.delivery.type === 'delivery' && (
                  <div className="mb-2">
                    <div className="flex items-start gap-2 text-sm">
                      <svg className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      <span className="text-gray-700 flex-1">{order.delivery.references || 'Sin referencia'}</span>
                    </div>
                    {(order.delivery.latlong || order.delivery.mapLocation) && (
                      <a
                        href={order.delivery.latlong 
                          ? `https://www.google.com/maps/place/${order.delivery.latlong.replace(/\s+/g, '')}`
                          : `https://www.google.com/maps/place/${order.delivery.mapLocation?.lat},${order.delivery.mapLocation?.lng}`
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="ml-6 text-xs text-blue-600 hover:underline inline-flex items-center gap-1 mt-1"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                        Ver en mapa
                      </a>
                    )}
                  </div>
                )}

                {/* Productos */}
                <div className="text-sm text-gray-600 mb-2">
                  <p className="font-medium text-gray-700 mb-1">Productos:</p>
                  <ul className="space-y-0.5">
                    {order.items.slice(0, 2).map((item, idx) => (
                      <li key={idx} className="text-xs">
                        • {item.quantity}x {item.product?.name || 'Producto'}
                      </li>
                    ))}
                    {order.items.length > 2 && (
                      <li className="text-xs text-gray-500">
                        + {order.items.length - 2} más...
                      </li>
                    )}
                  </ul>
                </div>

                {/* Botón de marcar como entregado - solo ícono */}
                {order.status !== 'delivered' && order.status !== 'cancelled' && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleStatusChange(order.id, 'delivered')
                    }}
                    className="w-full py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center justify-center"
                    title="Marcar como Entregado"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal de detalles del pedido */}
      {showOrderModal && selectedOrder && (
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
                    {selectedOrder.status === 'ready' && (
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
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
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
                  {(selectedOrder.delivery.latlong || selectedOrder.delivery.mapLocation) && (
                    <a
                      href={selectedOrder.delivery.latlong 
                        ? `https://www.google.com/maps/place/${selectedOrder.delivery.latlong.replace(/\s+/g, '')}`
                        : `https://www.google.com/maps/place/${selectedOrder.delivery.mapLocation?.lat},${selectedOrder.delivery.mapLocation?.lng}`
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      Abrir en Google Maps
                    </a>
                  )}
                </div>
              )}

              {/* Productos */}
              <div className="border rounded-lg p-4">
                <h3 className="font-semibold text-gray-900 mb-3">Productos</h3>
                <ul className="space-y-2">
                  {selectedOrder.items.map((item, idx) => (
                    <li key={idx} className="flex justify-between text-sm">
                      <span className="text-gray-700">
                        {item.quantity}x {item.product?.name || 'Producto'}
                      </span>
                      <span className="font-medium text-gray-900">
                        ${((item.product?.price || 0) * item.quantity).toFixed(2)}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="mt-3 pt-3 border-t">
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-600">Subtotal:</span>
                    <span className="font-medium">${(selectedOrder.subtotal || selectedOrder.total - (selectedOrder.delivery.deliveryCost || 0)).toFixed(2)}</span>
                  </div>
                  {selectedOrder.delivery.type === 'delivery' && (
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-600">Envío:</span>
                      <span className="font-medium">${(selectedOrder.delivery.deliveryCost || 0).toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-base font-semibold mt-2">
                    <span>Total:</span>
                    <span className="text-blue-600">${selectedOrder.total.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* Método de pago */}
              <div className="border rounded-lg p-4">
                <h3 className="font-semibold text-gray-900 mb-2">Método de Pago</h3>
                <p className="text-sm text-gray-700">
                  {selectedOrder.payment?.method === 'cash' && '💵 Efectivo'}
                  {selectedOrder.payment?.method === 'transfer' && '💳 Transferencia'}
                  {selectedOrder.payment?.method === 'mixed' && '💰 Pago Mixto'}
                </p>
                {selectedOrder.payment?.method === 'mixed' && (
                  <div className="mt-2 text-sm text-gray-600">
                    <p>Efectivo: ${(selectedOrder.payment as any).cashAmount?.toFixed(2) || '0.00'}</p>
                    <p>Transferencia: ${(selectedOrder.payment as any).transferAmount?.toFixed(2) || '0.00'}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
