'use client'

import { useState, useEffect } from 'react'
import { getAllBusinesses, updateOrderStatus, updateOrder, getDeliveriesByStatus } from '@/lib/database'
import { Order, Business } from '@/types'
import { db } from '@/lib/firebase'
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore'
import OrderSidebar from '@/components/OrderSidebar'

export default function OrderManagement() {
  const [orders, setOrders] = useState<Order[]>([])
  const [businesses, setBusinesses] = useState<Business[]>([])
  const [deliveries, setDeliveries] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState({
    status: 'all',
    business: 'all',
    search: ''
  })
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'amount'>('newest')
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null)
  const [updatingDelivery, setUpdatingDelivery] = useState<string | null>(null)

  // Estados para sidebar de orden
  const [isOrderSidebarOpen, setIsOrderSidebarOpen] = useState(false)
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null)
  const [statusMenuOrderId, setStatusMenuOrderId] = useState<string | null>(null)

  // Estados para validación de pagos
  const [showEditPaymentModal, setShowEditPaymentModal] = useState(false)
  const [showReceiptPreviewModal, setShowReceiptPreviewModal] = useState(false)
  const [paymentEditingOrder, setPaymentEditingOrder] = useState<Order | null>(null)
  const [editPaymentData, setEditPaymentData] = useState({
    method: 'cash' as 'cash' | 'transfer' | 'mixed',
    cashAmount: 0,
    transferAmount: 0,
    paymentStatus: 'pending' as 'pending' | 'validating' | 'paid' | 'rejected'
  })

  useEffect(() => {
    // Cargar negocios y deliveries una vez
    const loadInitialData = async () => {
      try {
        const [allBusinesses, allDeliveries] = await Promise.all([
          getAllBusinesses(),
          getDeliveriesByStatus('activo')
        ])
        const validBusinesses = allBusinesses.filter(business =>
          business && business.id && business.name
        )
        setBusinesses(validBusinesses)
        setDeliveries(allDeliveries)
      } catch (error) {
        console.error('Error loading initial data:', error)
      }
    }
    loadInitialData()

    // Suscripción en tiempo real a órdenes
    const ordersRef = collection(db, 'orders')
    const q = query(ordersRef, orderBy('createdAt', 'desc'))

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const ordersData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Order[]

      // Filtrar datos válidos
      const validOrders = ordersData.filter(order =>
        order &&
        order.id &&
        order.customer &&
        order.customer.name &&
        typeof order.total === 'number'
      )

      setOrders(validOrders)
      setLoading(false)
    }, (error) => {
      console.error('Error en suscripción de órdenes:', error)
      setLoading(false)
    })

    return () => unsubscribe()
  }, [])

  const loadData = async () => {
    // Función vacía para mantener compatibilidad con botón Actualizar
    // Los datos se actualizan automáticamente via onSnapshot
  }

  const handleStatusUpdate = async (orderId: string, newStatus: Order['status']) => {
    try {
      setUpdatingStatus(orderId)
      await updateOrderStatus(orderId, newStatus)

      // Actualizar estado local
      setOrders(prevOrders =>
        prevOrders.map(order =>
          order.id === orderId ? { ...order, status: newStatus } : order
        )
      )
    } catch (error) {
      console.error('Error updating status:', error)
      alert('Error al actualizar el estado del pedido')
    } finally {
      setUpdatingStatus(null)
    }
  }

  const handleDeliveryUpdate = async (orderId: string, deliveryId: string | null) => {
    try {
      setUpdatingDelivery(orderId)
      await updateOrder(orderId, {
        'delivery.assignedDelivery': deliveryId
      } as any)

      // Actualizar estado local
      setOrders(prevOrders =>
        prevOrders.map(order =>
          order.id === orderId
            ? { ...order, delivery: { ...order.delivery, assignedDelivery: deliveryId || undefined } as any }
            : order
        )
      )
    } catch (error) {
      console.error('Error updating delivery:', error)
      alert('Error al actualizar el repartidor')
    } finally {
      setUpdatingDelivery(null)
    }
  }

  // Funciones para Pago
  const handleEditPayment = (order: Order) => {
    setPaymentEditingOrder(order)
    setEditPaymentData({
      method: order.payment?.method || 'cash',
      cashAmount: order.payment?.cashAmount || 0,
      transferAmount: order.payment?.transferAmount || 0,
      paymentStatus: order.payment?.paymentStatus || (order.payment?.method === 'transfer' ? 'paid' : 'pending')
    })
    setShowEditPaymentModal(true)
  }

  const handleSavePaymentEdit = async () => {
    if (!paymentEditingOrder) return

    try {
      let paymentUpdate: any = {
        method: editPaymentData.method,
        paymentStatus: editPaymentData.paymentStatus || 'pending'
      }

      if (editPaymentData.method === 'mixed') {
        paymentUpdate.cashAmount = editPaymentData.cashAmount
        paymentUpdate.transferAmount = editPaymentData.transferAmount
      }

      await updateOrder(paymentEditingOrder.id, {
        payment: {
          ...paymentEditingOrder.payment,
          ...paymentUpdate
        }
      } as any)

      // Actualizar la lista local
      setOrders(orders.map(order =>
        order.id === paymentEditingOrder.id
          ? { ...order, payment: { ...order.payment, ...paymentUpdate } as any }
          : order
      ))

      setShowEditPaymentModal(false)
      setPaymentEditingOrder(null)
    } catch (error) {
      console.error('Error updating payment:', error)
      alert('Error al actualizar el pago')
    }
  }

  const handleValidatePayment = async (orderId: string) => {
    try {
      if (!paymentEditingOrder) return

      let paymentUpdate: any = {
        method: editPaymentData.method,
        paymentStatus: 'paid' as const
      }

      if (editPaymentData.method === 'mixed') {
        paymentUpdate.cashAmount = editPaymentData.cashAmount
        paymentUpdate.transferAmount = editPaymentData.transferAmount
      }

      const updatedPayment = {
        ...paymentEditingOrder.payment,
        ...paymentUpdate
      }

      await updateOrder(orderId, {
        payment: updatedPayment
      } as any)

      // Actualizar estado local
      setOrders(orders.map(order =>
        order.id === orderId
          ? { ...order, payment: updatedPayment as any }
          : order
      ))

      setShowReceiptPreviewModal(false)
      setShowEditPaymentModal(false)
      setPaymentEditingOrder(null)
    } catch (error) {
      console.error('Error validating payment:', error)
      alert('Error al validar el pago')
    }
  }

  const handleRejectPayment = async (orderId: string) => {
    try {
      if (!paymentEditingOrder) return

      const updatedPayment = {
        ...paymentEditingOrder.payment,
        paymentStatus: 'rejected' as const
      }

      await updateOrder(orderId, {
        payment: updatedPayment
      } as any)

      // Actualizar estado local
      setOrders(orders.map(order =>
        order.id === orderId ? {
          ...order,
          payment: updatedPayment as any
        } : order
      ))

      setShowReceiptPreviewModal(false)
      setShowEditPaymentModal(false)
      setPaymentEditingOrder(null)
    } catch (error) {
      console.error('Error rejecting payment:', error)
      alert('Error al rechazar el pago')
    }
  }

  const handleOpenOrderSidebar = (orderId: string) => {
    setSelectedOrderId(orderId)
    setIsOrderSidebarOpen(true)
  }

  const getTimeElapsed = (createdAt: Date) => {
    try {
      if (!createdAt) return '0m'

      const now = new Date()
      const createdDate = new Date(createdAt)
      const diffMs = now.getTime() - createdDate.getTime()

      if (isNaN(diffMs)) return '0m'

      const diffMinutes = Math.floor(diffMs / (1000 * 60))
      const diffHours = Math.floor(diffMinutes / 60)
      const diffDays = Math.floor(diffHours / 24)

      if (diffDays > 0) return `${diffDays}d ${diffHours % 24}h`
      if (diffHours > 0) return `${diffHours}h ${diffMinutes % 60}m`
      return `${Math.max(0, diffMinutes)}m`
    } catch (e) {
      return '0m'
    }
  }

  // Obtener hora/fecha programada del pedido
  const getScheduledTime = (order: Order) => {
    try {
      if (order.timing?.type === 'scheduled' && order.timing?.scheduledDate) {
        const date = order.timing.scheduledDate instanceof Date
          ? order.timing.scheduledDate
          : new Date((order.timing.scheduledDate as any).seconds * 1000)

        const today = new Date()
        const isToday = date.toDateString() === today.toDateString()
        const time = order.timing.scheduledTime || date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })

        if (isToday) return `Hoy ${time}`
        return `${date.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })} ${time}`
      }
      return 'Ahora'
    } catch (e) {
      return 'Ahora'
    }
  }

  const getTimeRemaining = (order: Order) => {
    try {
      if (!order.timing || order.timing.type !== 'scheduled' || !order.timing.scheduledDate) {
        return null // Para pedidos inmediatos usaremos el tiempo transcurrido
      }

      const now = new Date()
      const targetDate = order.timing.scheduledDate instanceof Date
        ? new Date(order.timing.scheduledDate)
        : new Date((order.timing.scheduledDate as any).seconds * 1000)

      if (order.timing.scheduledTime) {
        const [hours, minutes] = order.timing.scheduledTime.split(':').map(Number)
        targetDate.setHours(hours, minutes, 0, 0)
      }

      const diffMs = targetDate.getTime() - now.getTime()
      const diffMinutes = Math.round(diffMs / (1000 * 60))

      const absMinutes = Math.abs(diffMinutes)
      const h = Math.floor(absMinutes / 60)
      const m = absMinutes % 60

      if (diffMinutes > 0) {
        if (h > 0) return { text: `en ${h}h ${m}m`, color: 'text-blue-600' }
        return { text: `en ${m}m`, color: 'text-green-600' }
      } else if (diffMinutes < -5) {
        if (h > 0) return { text: `${h}h ${m}m tarde`, color: 'text-red-600' }
        return { text: `${m}m tarde`, color: 'text-red-600' }
      } else {
        return { text: 'ahora', color: 'text-orange-600' }
      }
    } catch (e) {
      return null
    }
  }

  const getStatusColor = (status: Order['status']) => {
    switch (status) {
      case 'pending': return 'bg-yellow-100 text-yellow-800 border-yellow-200'
      case 'confirmed': return 'bg-blue-100 text-blue-800 border-blue-200'
      case 'preparing': return 'bg-orange-100 text-orange-800 border-orange-200'
      case 'ready': return 'bg-green-100 text-green-800 border-green-200'
      case 'delivered': return 'bg-gray-100 text-gray-800 border-gray-200'
      case 'cancelled': return 'bg-red-100 text-red-800 border-red-200'
      default: return 'bg-gray-100 text-gray-800 border-gray-200'
    }
  }

  const getStatusText = (status: Order['status']) => {
    switch (status) {
      case 'pending': return 'Pendiente'
      case 'confirmed': return 'Confirmado'
      case 'preparing': return 'Preparando'
      case 'ready': return 'Listo'
      case 'delivered': return 'Entregado'
      case 'cancelled': return 'Cancelado'
      default: return status
    }
  }

  const filteredOrders = orders.filter(order => {
    // Validación básica del pedido
    if (!order || !order.customer || !order.customer.name) return false

    const business = businesses.find(b => b?.id === order?.businessId)

    // Por defecto, excluir órdenes entregadas (mostrar solo activas)
    // Las canceladas SÍ se muestran para monitoreo
    if (filters.status === 'all' && order.status === 'delivered') return false

    // Filtro por estado específico
    if (filters.status !== 'all' && order.status !== filters.status) return false

    // Filtro por negocio
    if (filters.business !== 'all' && order.businessId !== filters.business) return false

    // Filtro por búsqueda
    if (filters.search) {
      const searchTerm = filters.search.toLowerCase()
      return (
        (order.customer?.name || '').toLowerCase().includes(searchTerm) ||
        (order.customer?.phone || '').includes(searchTerm) ||
        (business?.name || '').toLowerCase().includes(searchTerm) ||
        (order.id || '').toLowerCase().includes(searchTerm)
      )
    }

    return true
  }).sort((a, b) => {
    switch (sortBy) {
      case 'newest':
        try {
          return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
        } catch (e) {
          return 0
        }
      case 'oldest':
        try {
          return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime()
        } catch (e) {
          return 0
        }
      case 'amount':
        return (b.total || 0) - (a.total || 0)
      default:
        return 0
    }
  })

  const pendingOrdersCount = orders.filter(order => order.status === 'pending').length

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header Compacto */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl md:text-3xl font-bold text-gray-900 truncate">Pedidos</h1>
          <div className="flex items-center gap-2 mt-1">
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-yellow-100 text-yellow-800">
              {pendingOrdersCount} pendientes
            </span>
            <span className="text-xs text-gray-500">{orders.length} total</span>
          </div>
        </div>
        <button
          onClick={loadData}
          className="shrink-0 inline-flex items-center justify-center w-10 h-10 md:w-auto md:h-auto md:px-4 md:py-2 border border-gray-300 rounded-xl md:rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 active:bg-gray-100"
        >
          <i className="bi bi-arrow-clockwise md:mr-2"></i>
          <span className="hidden md:inline">Actualizar</span>
        </button>
      </div>

      {/* Filtros - Compactos en móvil */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {/* Barra de búsqueda siempre visible */}
        <div className="p-3 md:p-4 border-b border-gray-100">
          <div className="relative">
            <input
              type="text"
              placeholder="Buscar cliente, teléfono..."
              value={filters.search}
              onChange={(e) => setFilters({ ...filters, search: e.target.value })}
              className="w-full pl-10 pr-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-gray-50"
            />
            <i className="bi bi-search absolute left-3.5 top-3 text-gray-400"></i>
          </div>
        </div>

        {/* Filtros en pills horizontales */}
        <div className="flex gap-2 p-3 overflow-x-auto scrollbar-hide">
          <select
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            className="shrink-0 px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white appearance-none cursor-pointer"
          >
            <option value="all">Activas (sin entregar)</option>
            <option value="pending">Pendiente</option>
            <option value="confirmed">Confirmado</option>
            <option value="preparing">Preparando</option>
            <option value="ready">Listo</option>
            <option value="delivered">Entregado</option>
            <option value="cancelled">Cancelado</option>
          </select>

          <select
            value={filters.business}
            onChange={(e) => setFilters({ ...filters, business: e.target.value })}
            className="shrink-0 px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white appearance-none cursor-pointer"
          >
            <option value="all">Tienda: Todas</option>
            {businesses.map(business => (
              <option key={business.id} value={business.id}>
                {business.name}
              </option>
            ))}
          </select>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="shrink-0 px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white appearance-none cursor-pointer"
          >
            <option value="newest">Más recientes</option>
            <option value="oldest">Más antiguos</option>
            <option value="amount">Mayor monto</option>
          </select>
        </div>
      </div>


      {/* Lista de Pedidos */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">

        {/* Vista Móvil - Cards */}
        <div className="md:hidden divide-y divide-gray-100">
          {filteredOrders.map((order) => {
            const business = businesses.find(b => b.id === order.businessId)
            const timeElapsed = getTimeElapsed(order.createdAt)

            const statusConfig: Record<string, { bg: string; text: string; border: string }> = {
              pending: { bg: 'bg-yellow-50', text: 'text-yellow-700', border: 'border-yellow-200' },
              confirmed: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
              preparing: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200' },
              ready: { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200' },
              delivered: { bg: 'bg-gray-50', text: 'text-gray-600', border: 'border-gray-200' },
              cancelled: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200' },
              on_way: { bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200' }
            }
            const statusStyle = statusConfig[order.status] || statusConfig.pending

            return (
              <div key={order.id} className={`p-4 ${order.status === 'pending' ? 'bg-yellow-50/30' : ''}`}>
                {/* Header de la tarjeta */}
                <div className="flex items-start justify-between gap-3 mb-3">
                  {/* Logo tienda + info cliente */}
                  <div className="flex items-start gap-2.5 flex-1 min-w-0">
                    {/* Logo circular de la tienda */}
                    <div className="w-9 h-9 rounded-full bg-gray-100 overflow-hidden shrink-0 border border-gray-200">
                      {business?.image ? (
                        <img src={business.image} alt={business.name || ''} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <i className="bi bi-shop text-gray-400 text-sm"></i>
                        </div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-sm font-bold text-gray-900 truncate">
                          {order.customer?.name || 'Sin nombre'}
                        </span>

                        {/* Indicador de Estado con Menú Desplegable */}
                        <div className="relative">
                          <button
                            onClick={() => setStatusMenuOrderId(statusMenuOrderId === order.id ? null : order.id)}
                            className={`inline-flex items-center px-2 py-0.5 text-[10px] font-bold rounded-full ${statusStyle.bg} ${statusStyle.text} border ${statusStyle.border} active:scale-95 transition-all`}
                          >
                            {getStatusText(order.status)}
                            {!['delivered', 'cancelled'].includes(order.status) && (
                              <i className="bi bi-chevron-down ms-1"></i>
                            )}
                          </button>

                          {/* Menú Desplegable */}
                          {statusMenuOrderId === order.id && !['delivered', 'cancelled'].includes(order.status) && (
                            <>
                              <div
                                className="fixed inset-0 z-40"
                                onClick={() => setStatusMenuOrderId(null)}
                              ></div>
                              <div className="absolute left-0 mt-1 w-32 bg-white rounded-xl shadow-xl border border-gray-100 py-1.5 z-50 animate-in fade-in zoom-in duration-200 origin-top-left">
                                <button
                                  onClick={() => {
                                    handleStatusUpdate(order.id!, 'delivered')
                                    setStatusMenuOrderId(null)
                                  }}
                                  className="w-full text-left px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                                >
                                  <i className="bi bi-check2-circle text-green-600"></i>
                                  Entregado
                                </button>
                                <button
                                  onClick={() => {
                                    handleStatusUpdate(order.id!, 'cancelled')
                                    setStatusMenuOrderId(null)
                                  }}
                                  className="w-full text-left px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 flex items-center gap-2 border-t border-gray-50"
                                >
                                  <i className="bi bi-x-circle"></i>
                                  Cancelar
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-gray-500">
                        <i className="bi bi-clock text-[10px]"></i>
                        <span className="font-medium">{getScheduledTime(order)}</span>
                        <span className="text-gray-300">•</span>
                        <span className="truncate">{business?.name || 'N/A'}</span>
                      </div>
                    </div>
                  </div>
                  {/* Total y Botón Ver */}
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <div className="text-lg font-bold text-gray-900">${(order.total || 0).toFixed(2)}</div>
                      {(() => {
                        const remaining = getTimeRemaining(order);
                        if (remaining) {
                          return (
                            <div className={`text-[11px] font-bold uppercase tracking-wider ${remaining.color}`}>
                              {remaining.text}
                            </div>
                          );
                        }
                        return (
                          <div className={`text-[11px] font-medium ${timeElapsed.includes('d') || parseInt(timeElapsed) > 60 ? 'text-red-600' :
                            timeElapsed.includes('h') ? 'text-orange-600' : 'text-green-600'
                            }`}>
                            hace {timeElapsed}
                          </div>
                        );
                      })()}
                    </div>
                    <button
                      onClick={() => handleOpenOrderSidebar(order.id!)}
                      className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center text-blue-600 active:scale-95 transition-all shadow-sm border border-blue-100"
                      title="Ver Detalle"
                    >
                      <i className="bi bi-eye text-lg"></i>
                    </button>
                  </div>
                </div>

                {/* Dirección y Mapa (Nuevo) */}
                {order.delivery?.type === 'delivery' && (
                  <div className="mb-3 space-y-2">
                    <div className="flex items-start gap-2 text-xs">
                      <i className="bi bi-geo-alt-fill text-red-500 mt-0.5"></i>
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-gray-900 leading-tight">
                          {order.delivery.references || 'Sin dirección registrada'}
                        </p>
                      </div>
                    </div>

                    {order.delivery.latlong && (
                      <div className="relative w-full h-24 rounded-xl overflow-hidden border border-gray-100 shadow-sm">
                        <img
                          src={`https://maps.googleapis.com/maps/api/staticmap?center=${order.delivery.latlong}&zoom=15&size=400x120&scale=2&maptype=roadmap&markers=color:red%7C${order.delivery.latlong}&key=AIzaSyAgOiLYPpzxlUHkX3lCmp5KK4UF7wx7zMs`}
                          alt="Ubicación de entrega"
                          className="w-full h-full object-cover"
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Info de Pago - Simplificada */}
                <div className="flex items-center gap-3 mb-3 text-xs text-gray-500">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${order.payment?.method === 'transfer' ? 'bg-blue-100 text-blue-700' :
                    order.payment?.method === 'mixed' ? 'bg-purple-100 text-purple-700' :
                      'bg-green-100 text-green-700'
                    }`}>
                    <i className={`bi ${order.payment?.method === 'transfer' ? 'bi-credit-card' :
                      order.payment?.method === 'mixed' ? 'bi-cash-coin' : 'bi-cash'} me-1`}></i>
                    {order.payment?.method === 'transfer' ? 'Transf.' :
                      order.payment?.method === 'mixed' ? 'Mixto' : 'Efectivo'}
                  </span>
                  {(order.payment?.method === 'transfer' || order.payment?.method === 'mixed') && (
                    <button
                      onClick={() => handleEditPayment(order)}
                      className={`p-1 rounded-md ${order.payment?.paymentStatus === 'paid' ? 'text-green-600' :
                        order.payment?.paymentStatus === 'validating' ? 'text-yellow-600 animate-pulse' :
                          'text-blue-600'
                        }`}
                    >
                      <i className={`bi ${order.payment?.paymentStatus === 'paid' ? 'bi-patch-check-fill' :
                        order.payment?.paymentStatus === 'validating' ? 'bi-hourglass-split' : 'bi-wallet2'}`}></i>
                    </button>
                  )}
                </div>

                {/* Selector de Delivery - Primario */}
                {order.delivery?.type === 'delivery' && (
                  <div className="mb-3">
                    <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1 block">
                      <i className="bi bi-bicycle me-1"></i>Repartidor
                    </label>
                    <select
                      value={order.delivery?.assignedDelivery || ''}
                      onChange={(e) => handleDeliveryUpdate(order.id!, e.target.value || null)}
                      disabled={updatingDelivery === order.id}
                      className={`w-full px-3 py-2.5 text-sm border-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white font-medium transition-all ${order.delivery?.assignedDelivery
                        ? 'border-green-300 text-green-800'
                        : 'border-orange-300 text-orange-700'
                        } ${updatingDelivery === order.id ? 'opacity-50' : ''}`}
                    >
                      <option value="">Sin asignar</option>
                      {deliveries.map(d => (
                        <option key={d.id} value={d.id}>
                          {d.nombres || d.name || 'Repartidor'}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Vista Desktop - Tabla */}
        <div className="hidden md:block overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Pedido</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Cliente</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tienda</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Ubicación</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Monto</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Pago</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tiempo</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Estado</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Acciones</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredOrders.map((order) => {
                const business = businesses.find(b => b.id === order.businessId)
                const timeElapsed = getTimeElapsed(order.createdAt)

                return (
                  <tr key={order.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">#{order.id?.slice(-6)}</div>
                      <div className="text-sm text-gray-500">
                        {order.createdAt ? new Date(order.createdAt).toLocaleDateString('es-ES', {
                          day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
                        }) : 'Sin fecha'}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">{order.customer?.name || 'Sin nombre'}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="w-8 h-8 bg-gray-200 rounded-lg overflow-hidden mr-3">
                          {business?.image ? (
                            <img src={business.image} alt={business.name || 'Negocio'} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full bg-gray-200 flex items-center justify-center">
                              <i className="bi bi-shop text-xs text-gray-400"></i>
                            </div>
                          )}
                        </div>
                        <div className="text-sm font-medium text-gray-900">{business?.name || 'N/A'}</div>
                      </div>
                    </td>
                    <td className="px-6 py-4 min-w-[200px]">
                      {order.delivery?.type === 'delivery' ? (
                        <div className="space-y-1">
                          <div className="text-xs font-bold text-gray-900 truncate max-w-[180px]" title={order.delivery.references}>
                            {order.delivery.references || 'Sin dirección'}
                          </div>
                          {order.delivery.latlong && (
                            <div className="w-32 h-16 rounded-lg overflow-hidden border border-gray-100 shadow-sm">
                              <img
                                src={`https://maps.googleapis.com/maps/api/staticmap?center=${order.delivery.latlong}&zoom=14&size=200x100&scale=2&markers=color:red%7C${order.delivery.latlong}&key=AIzaSyAgOiLYPpzxlUHkX3lCmp5KK4UF7wx7zMs`}
                                alt="Ubicación"
                                className="w-full h-full object-cover"
                              />
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs font-medium text-orange-600 bg-orange-50 px-2 py-1 rounded-md">
                          Retiro en tienda
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-semibold text-gray-900">${(order.total || 0).toFixed(2)}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center space-x-2">
                        <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${order.payment?.method === 'transfer' ? 'bg-blue-100 text-blue-800' :
                          order.payment?.method === 'mixed' ? 'bg-purple-100 text-purple-800' : 'bg-green-100 text-green-800'
                          }`}>
                          <i className={`bi ${order.payment?.method === 'transfer' ? 'bi-credit-card' :
                            order.payment?.method === 'mixed' ? 'bi-cash-coin' : 'bi-cash'} me-1.5`}></i>
                          {order.payment?.method === 'transfer' ? 'Transf.' :
                            order.payment?.method === 'mixed' ? 'Mixto' : 'Efectivo'}
                        </span>
                        {(order.payment?.method === 'transfer' || order.payment?.method === 'mixed') && (
                          <button
                            onClick={() => handleEditPayment(order)}
                            className={`p-1 rounded-md hover:bg-gray-100 transition-colors ${order.payment?.paymentStatus === 'paid' ? 'text-green-600' :
                              order.payment?.paymentStatus === 'validating' ? 'text-yellow-600 animate-pulse' :
                                order.payment?.paymentStatus === 'rejected' ? 'text-red-600' : 'text-blue-600'
                              }`}
                            title="Verificar/Editar Pago"
                          >
                            <i className={`bi ${order.payment?.paymentStatus === 'paid' ? 'bi-patch-check-fill' :
                              order.payment?.paymentStatus === 'validating' ? 'bi-hourglass-split' : 'bi-wallet2'} text-lg`}></i>
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {(() => {
                        const remaining = getTimeRemaining(order);
                        if (remaining) {
                          return (
                            <div className={`text-sm font-bold uppercase tracking-wider ${remaining.color}`}>
                              {remaining.text}
                            </div>
                          );
                        }
                        return (
                          <div className={`text-sm font-medium ${timeElapsed.includes('d') || parseInt(timeElapsed) > 60 ? 'text-red-600' :
                            timeElapsed.includes('h') ? 'text-orange-600' : 'text-green-600'
                            }`}>
                            {timeElapsed}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="relative">
                        <button
                          onClick={() => setStatusMenuOrderId(statusMenuOrderId === order.id ? null : order.id)}
                          className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full border ${getStatusColor(order.status)} active:scale-95 transition-all items-center gap-1`}
                        >
                          {getStatusText(order.status)}
                          {!['delivered', 'cancelled'].includes(order.status) && (
                            <i className="bi bi-chevron-down text-[10px]"></i>
                          )}
                        </button>

                        {/* Menú Desplegable Desktop */}
                        {statusMenuOrderId === order.id && !['delivered', 'cancelled'].includes(order.status) && (
                          <>
                            <div
                              className="fixed inset-0 z-40"
                              onClick={() => setStatusMenuOrderId(null)}
                            ></div>
                            <div className="absolute left-0 mt-1 w-32 bg-white rounded-xl shadow-xl border border-gray-100 py-1.5 z-50 animate-in fade-in zoom-in duration-200 origin-top-left">
                              <button
                                onClick={() => {
                                  handleStatusUpdate(order.id!, 'delivered')
                                  setStatusMenuOrderId(null)
                                }}
                                className="w-full text-left px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                              >
                                <i className="bi bi-check2-circle text-green-600"></i>
                                Entregado
                              </button>
                              <button
                                onClick={() => {
                                  handleStatusUpdate(order.id!, 'cancelled')
                                  setStatusMenuOrderId(null)
                                }}
                                className="w-full text-left px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 flex items-center gap-2 border-t border-gray-50"
                              >
                                <i className="bi bi-x-circle"></i>
                                Cancelar
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <button
                          onClick={() => handleOpenOrderSidebar(order.id!)}
                          className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center text-blue-600 hover:bg-blue-100 transition-colors"
                          title="Ver Detalle"
                        >
                          <i className="bi bi-eye"></i>
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {filteredOrders.length === 0 && (
          <div className="text-center py-12">
            <i className="bi bi-inbox text-4xl text-gray-400 mb-4"></i>
            <p className="text-gray-500">No se encontraron pedidos</p>
          </div>
        )}

        {/* Modal de Edición de Método de Pago */}
        {showEditPaymentModal && paymentEditingOrder && (
          <div
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 overflow-y-auto"
            onClick={() => setShowEditPaymentModal(false)}
          >
            <div
              className="bg-white rounded-xl max-w-md w-full shadow-2xl my-8 max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6">
                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-bold text-gray-900">
                    <i className="bi bi-credit-card me-2 text-blue-600"></i>
                    Gestionar Pago
                  </h2>
                  <button
                    onClick={() => setShowEditPaymentModal(false)}
                    className="text-gray-400 hover:text-gray-600 text-2xl transition-colors"
                  >
                    <i className="bi bi-x-lg text-lg"></i>
                  </button>
                </div>

                {/* Información del pedido */}
                <div className="mb-6 p-4 bg-gray-50 rounded-xl flex justify-between items-start border border-gray-100">
                  <div>
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Cliente</p>
                    <p className="text-base font-bold text-gray-900">
                      {paymentEditingOrder?.customer?.name || 'Cliente sin nombre'}
                    </p>
                    <p className="text-sm text-gray-600 mt-2">
                      Total: <span className="font-bold text-blue-600">
                        ${(paymentEditingOrder?.total || 0).toFixed(2)}
                      </span>
                    </p>
                  </div>

                  {/* Mostrar comprobante si existe */}
                  {paymentEditingOrder?.payment?.receiptImageUrl && (
                    <div className="ml-4">
                      <button
                        type="button"
                        onClick={() => setShowReceiptPreviewModal(true)}
                        className="block relative group"
                        title="Ver comprobante completo"
                      >
                        <img
                          src={paymentEditingOrder.payment.receiptImageUrl}
                          alt="Comprobante"
                          className="w-20 h-20 object-cover rounded-lg border border-gray-200 shadow-sm transition-transform group-hover:scale-105"
                        />
                        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-0 group-hover:bg-opacity-20 transition-all rounded-lg">
                          <i className="bi bi-zoom-in text-white opacity-0 group-hover:opacity-100 drop-shadow-md"></i>
                        </div>
                      </button>
                      <p className="text-[10px] text-gray-500 mt-1 text-center font-medium">Click para ampliar</p>
                    </div>
                  )}
                </div>

                {/* Selección de método de pago */}
                <div className="space-y-4 mb-6">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-3">
                      Método de Pago
                    </label>
                    <div className="grid grid-cols-1 gap-2">
                      {[
                        { id: 'cash', label: 'Efectivo', icon: 'bi-cash', color: 'text-green-600', bg: 'hover:bg-green-50' },
                        { id: 'transfer', label: 'Transferencia', icon: 'bi-credit-card', color: 'text-blue-600', bg: 'hover:bg-blue-50' },
                        { id: 'mixed', label: 'Mixto', icon: 'bi-cash-coin', color: 'text-purple-600', bg: 'hover:bg-purple-50' }
                      ].map((m) => (
                        <label
                          key={m.id}
                          className={`flex items-center p-3 border rounded-xl cursor-pointer transition-all ${editPaymentData.method === m.id
                            ? 'border-blue-500 bg-blue-50/50 ring-1 ring-blue-500'
                            : 'border-gray-200 hover:bg-gray-50'
                            }`}
                        >
                          <input
                            type="radio"
                            name="paymentMethod"
                            value={m.id}
                            checked={editPaymentData.method === m.id}
                            onChange={(e) => setEditPaymentData({
                              ...editPaymentData,
                              method: e.target.value as any,
                              cashAmount: 0,
                              transferAmount: 0,
                              paymentStatus: m.id === 'transfer' ? 'paid' : 'pending'
                            })}
                            className="h-4 w-4 text-blue-600 focus:ring-blue-500"
                          />
                          <span className="ml-3 font-medium text-gray-700 flex items-center">
                            <i className={`bi ${m.icon} me-2 ${m.color}`}></i>
                            {m.label}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Selector de estado de pago */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      Estado Actual
                    </label>
                    <select
                      value={editPaymentData.paymentStatus}
                      onChange={(e) => setEditPaymentData({
                        ...editPaymentData,
                        paymentStatus: e.target.value as any
                      })}
                      className="w-full px-4 py-2 bg-white border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm font-medium"
                    >
                      <option value="pending">⏳ Pendiente</option>
                      <option value="validating">🕵️ Validando</option>
                      <option value="paid">✅ Pagado</option>
                      <option value="rejected">❌ Rechazado</option>
                    </select>
                  </div>

                  {/* Montos para pago mixto */}
                  {editPaymentData.method === 'mixed' && (
                    <div className="p-4 bg-blue-50 rounded-xl border border-blue-100">
                      <h4 className="text-xs font-bold text-blue-800 uppercase tracking-widest mb-3">
                        Distribución Mixta
                      </h4>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-bold text-gray-500 mb-1 ml-1">EFECTIVO</label>
                          <div className="relative">
                            <span className="absolute left-3 top-2 text-gray-400 text-xs">$</span>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={editPaymentData.cashAmount}
                              onChange={(e) => {
                                const cash = parseFloat(e.target.value) || 0
                                const transfer = (paymentEditingOrder?.total || 0) - cash
                                setEditPaymentData({
                                  ...editPaymentData,
                                  cashAmount: cash,
                                  transferAmount: Math.max(0, transfer)
                                })
                              }}
                              className="w-full pl-6 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-1 focus:ring-blue-500 appearance-none"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-gray-500 mb-1 ml-1">TRANSF.</label>
                          <div className="relative">
                            <span className="absolute left-3 top-2 text-gray-400 text-xs">$</span>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={editPaymentData.transferAmount}
                              onChange={(e) => {
                                const transfer = parseFloat(e.target.value) || 0
                                const cash = (paymentEditingOrder?.total || 0) - transfer
                                setEditPaymentData({
                                  ...editPaymentData,
                                  transferAmount: transfer,
                                  cashAmount: Math.max(0, cash)
                                })
                              }}
                              className="w-full pl-6 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-1 focus:ring-blue-500 appearance-none"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Botones de acción */}
                <div className="flex flex-col space-y-2">
                  <button
                    onClick={handleSavePaymentEdit}
                    disabled={editPaymentData.method === 'mixed' &&
                      Math.abs(((editPaymentData.cashAmount || 0) + (editPaymentData.transferAmount || 0)) - (paymentEditingOrder?.total || 0)) > 0.01
                    }
                    className="w-full bg-blue-600 text-white font-bold py-3 px-4 rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:bg-gray-400 transition-all shadow-lg shadow-blue-200"
                  >
                    Guardar Cambios
                  </button>
                  <button
                    onClick={() => setShowEditPaymentModal(false)}
                    className="w-full bg-gray-50 text-gray-600 font-semibold py-3 px-4 rounded-xl hover:bg-gray-100 transition-all"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Modal de Previsualización de Comprobante */}
        {showReceiptPreviewModal && paymentEditingOrder?.payment?.receiptImageUrl && (
          <div
            className="fixed inset-0 bg-black/95 flex items-center justify-center z-[70] p-4 backdrop-blur-sm"
            onClick={() => setShowReceiptPreviewModal(false)}
          >
            <div
              className="relative max-w-4xl w-full h-[90vh] flex flex-col bg-white rounded-2xl overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="p-4 border-b flex items-center justify-between bg-gray-50/80">
                <div>
                  <h3 className="font-bold text-gray-900 flex items-center">
                    <i className="bi bi-file-earmark-image me-2 text-blue-600"></i>
                    Comprobante de Pago
                  </h3>
                  <p className="text-xs text-gray-500 font-medium">
                    {paymentEditingOrder?.customer?.name} • <span className="text-blue-600">${(paymentEditingOrder?.total || 0).toFixed(2)}</span>
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleRejectPayment(paymentEditingOrder.id)}
                    className="px-4 py-2 bg-red-50 text-red-600 rounded-xl hover:bg-red-100 transition-colors font-bold text-sm flex items-center gap-2 border border-red-100"
                  >
                    <i className="bi bi-x-circle-fill"></i>
                    Rechazar
                  </button>
                  <button
                    onClick={() => handleValidatePayment(paymentEditingOrder.id)}
                    className="px-4 py-2 bg-green-600 text-white rounded-xl hover:bg-green-700 transition-all font-bold text-sm flex items-center gap-2 shadow-lg shadow-green-200"
                  >
                    <i className="bi bi-patch-check-fill"></i>
                    Validar Pago
                  </button>
                  <button
                    onClick={() => setShowReceiptPreviewModal(false)}
                    className="p-2 text-gray-400 hover:text-gray-600 transition-colors ml-2"
                  >
                    <i className="bi bi-x-lg text-xl"></i>
                  </button>
                </div>
              </div>

              {/* Imagen */}
              <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-gray-100/50">
                <img
                  src={paymentEditingOrder.payment.receiptImageUrl}
                  alt="Comprobante completo"
                  className="max-w-full max-h-full object-contain rounded-lg shadow-inner"
                />
              </div>

              {/* Footer */}
              <div className="p-3 bg-gray-50/50 text-center border-t border-gray-100">
                <p className="text-[11px] text-gray-400 font-medium italic">
                  Al validar, el pago se marcará como confirmado y se guardarán los cambios automáticamente.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Sidebar de Detalle de Orden */}
        <OrderSidebar
          isOpen={isOrderSidebarOpen}
          onClose={() => setIsOrderSidebarOpen(false)}
          orderId={selectedOrderId}
        />
      </div>
    </div>
  )
}
