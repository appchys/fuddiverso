'use client'

import { useState, useEffect } from 'react'
import { getAllBusinesses, updateOrderStatus, updateOrder, getDeliveriesByStatus } from '@/lib/database'
import { Order, Business } from '@/types'
import { db } from '@/lib/firebase'
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore'
import OrderSidebar from '@/components/OrderSidebar'
import { sendWhatsAppToDelivery } from '@/components/WhatsAppUtils'

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
  const [expandedMaps, setExpandedMaps] = useState<Record<string, boolean>>({})
  const [isPickupExpanded, setIsPickupExpanded] = useState(false)
  const [showSearchBar, setShowSearchBar] = useState(false)

  const toggleMap = (orderId: string) => {
    setExpandedMaps(prev => ({
      ...prev,
      [orderId]: !prev[orderId]
    }))
  }

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
          order.id === orderId ? {
            ...order,
            status: newStatus,
            deliveredAt: newStatus === 'delivered' ? new Date() : order.deliveredAt,
            statusHistory: {
              ...order.statusHistory,
              deliveredAt: newStatus === 'delivered' ? new Date() : order.statusHistory?.deliveredAt
            }
          } : order
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

  const handleSendWhatsAppToDelivery = async (order: Order) => {
    const business = businesses.find(b => b.id === order.businessId)

    // Actualizar localmente inmediatamente
    setOrders(prevOrders =>
      prevOrders.map(o => o.id === order.id ? { ...o, waSentToDelivery: true } : o)
    );

    // Actualizar en DB
    updateOrder(order.id, { waSentToDelivery: true }).catch(err => {
      console.error('Error updating waSentToDelivery:', err);
    });

    await sendWhatsAppToDelivery(
      { ...order, waSentToDelivery: true },
      deliveries,
      business || null
    );
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

  const getTimeElapsed = (order: Order) => {
    try {
      const createdAt = order.createdAt
      if (!createdAt) return '0m'

      const createdDate = createdAt instanceof Date ? createdAt : new Date((createdAt as any).seconds * 1000)

      let endDate = new Date()
      if (order.status === 'delivered') {
        const deliveredAt = order.deliveredAt || order.statusHistory?.deliveredAt
        if (deliveredAt) {
          endDate = deliveredAt instanceof Date ? deliveredAt : new Date((deliveredAt as any).seconds * 1000)
        }
      }

      const diffMs = endDate.getTime() - createdDate.getTime()

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
      if (order.timing?.scheduledDate) {
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
      if (!order.timing || !order.timing.scheduledDate) {
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

    // Solo mostrar órdenes de hoy
    const today = new Date().toDateString()
    const orderDate = order.timing?.scheduledDate
      ? (order.timing.scheduledDate instanceof Date ? order.timing.scheduledDate : new Date((order.timing.scheduledDate as any).seconds * 1000))
      : (order.createdAt instanceof Date ? order.createdAt : new Date((order.createdAt as any).seconds * 1000))

    if (orderDate.toDateString() !== today) return false

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

  const deliveryOrders = filteredOrders.filter(order => order.delivery?.type !== 'pickup')
  const pickupOrders = filteredOrders.filter(order => order.delivery?.type === 'pickup')

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return (
    <div className="px-2 md:px-0">
      <div className="flex items-center justify-between gap-4 mb-8">
        <div className="min-w-0">
          <h1 className="text-3xl sm:text-4xl font-black text-gray-900 tracking-tight leading-tight">Gestión de Pedidos</h1>
          <div className="flex items-center gap-3 mt-2">
            <span className="inline-flex items-center px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-amber-100 text-amber-700 border border-amber-200">
              {pendingOrdersCount} pendientes
            </span>
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{orders.length} pedidos totales</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSearchBar(!showSearchBar)}
            className={`shrink-0 inline-flex items-center justify-center w-10 h-10 border rounded-xl shadow-sm text-sm font-medium transition-all ${showSearchBar
              ? 'bg-blue-50 text-blue-600 border-blue-200 ring-2 ring-blue-500/20'
              : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            title="Buscar"
          >
            <i className={`bi ${showSearchBar ? 'bi-search-heart-fill' : 'bi-search'}`}></i>
          </button>
          <button
            onClick={loadData}
            className="shrink-0 inline-flex items-center justify-center w-10 h-10 md:w-auto md:h-auto md:px-4 md:py-2 border border-gray-300 rounded-xl md:rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 active:bg-gray-100"
          >
            <i className="bi bi-arrow-clockwise md:mr-2"></i>
            <span className="hidden md:inline">Actualizar</span>
          </button>
        </div>
      </div>

      {/* Filtros Premium */}
      <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
        {/* Barra de búsqueda */}
        {showSearchBar && (
          <div className="p-4 border-b border-gray-50 bg-gray-50/30 animate-in slide-in-from-top duration-200">
            <div className="relative group">
              <input
                type="text"
                autoFocus
                placeholder="Buscar por cliente, teléfono o #pedido..."
                value={filters.search}
                onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                className="w-full pl-11 pr-4 py-3 text-sm font-medium border-2 border-transparent bg-white rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 shadow-sm transition-all group-hover:border-gray-200"
              />
              <i className="bi bi-search absolute left-4 top-3.5 text-gray-400 group-focus-within:text-blue-500 transition-colors"></i>
            </div>
          </div>
        )}

        {/* Filtros Rápidos */}
        <div className="flex gap-2 p-4 overflow-x-auto scrollbar-hide bg-white">
          <div className="shrink-0 flex items-center gap-2">
            <div className="relative">
              <select
                value={filters.status}
                onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                className="pl-9 pr-8 py-2 text-xs font-bold border-2 border-gray-100 rounded-xl focus:outline-none focus:border-blue-500 bg-gray-100 transition-all hover:bg-white appearance-none cursor-pointer"
              >
                <option value="all">Todas las activas</option>
                <option value="pending">⏳ Pendientes</option>
                <option value="confirmed">✅ Confirmadas</option>
                <option value="preparing">🔥 Preparando</option>
                <option value="ready">🛍️ Listas</option>
                <option value="delivered">🏠 Entregadas</option>
                <option value="cancelled">❌ Canceladas</option>
              </select>
              <i className="bi bi-funnel absolute left-3 top-2 text-gray-400"></i>
              <i className="bi bi-chevron-down absolute right-3 top-2 text-gray-400 pointer-events-none"></i>
            </div>

            <div className="relative">
              <select
                value={filters.business}
                onChange={(e) => setFilters({ ...filters, business: e.target.value })}
                className="pl-9 pr-8 py-2 text-xs font-bold border-2 border-gray-100 rounded-xl focus:outline-none focus:border-blue-500 bg-gray-100 transition-all hover:bg-white appearance-none cursor-pointer"
              >
                <option value="all">Todas las tiendas</option>
                {businesses.map(business => (
                  <option key={business.id} value={business.id}>
                    🏪 {business.name}
                  </option>
                ))}
              </select>
              <i className="bi bi-shop absolute left-3 top-2 text-gray-400"></i>
              <i className="bi bi-chevron-down absolute right-3 top-2 text-gray-400 pointer-events-none"></i>
            </div>

            <div className="relative">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="pl-9 pr-8 py-2 text-xs font-bold border-2 border-gray-100 rounded-xl focus:outline-none focus:border-blue-500 bg-gray-100 transition-all hover:bg-white appearance-none cursor-pointer"
              >
                <option value="newest">Más recientes</option>
                <option value="oldest">Más antiguos</option>
                <option value="amount">Monto mayor</option>
              </select>
              <i className="bi bi-sort-down absolute left-3 top-2 text-gray-400"></i>
              <i className="bi bi-chevron-down absolute right-3 top-2 text-gray-400 pointer-events-none"></i>
            </div>
          </div>
        </div>
      </div>


      {/* Vista Móvil - Cards Rediseñadas */}
      <div className="md:hidden space-y-4 p-4 bg-gray-50/50">
        {deliveryOrders.map((order) => {
          const business = businesses.find(b => b.id === order.businessId)
          const timeElapsed = getTimeElapsed(order)
          const remaining = getTimeRemaining(order)

          const statusConfig: Record<string, { bg: string; text: string; border: string; icon: string }> = {
            pending: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', icon: 'bi-clock-history' },
            confirmed: { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200', icon: 'bi-check2-circle' },
            preparing: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200', icon: 'bi-fire' },
            ready: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', icon: 'bi-bag-check' },
            delivered: { bg: 'bg-gray-50', text: 'text-gray-600', border: 'border-gray-200', icon: 'bi-house-check' },
            cancelled: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', icon: 'bi-x-circle' },
            on_way: { bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200', icon: 'bi-bicycle' }
          }
          const statusStyle = statusConfig[order.status] || statusConfig.pending

          return (
            <div
              key={order.id}
              className={`bg-white rounded-2xl border-l-[6px] border shadow-md overflow-hidden transition-all hover:shadow-xl ${order.status === 'pending' ? 'border-l-amber-400 border-gray-100' :
                order.status === 'confirmed' ? 'border-l-green-400 border-gray-100' :
                  order.status === 'preparing' ? 'border-l-orange-400 border-gray-100' :
                    order.status === 'ready' ? 'border-l-emerald-400 border-gray-100' :
                      order.status === 'delivered' ? 'border-l-gray-400 border-gray-100' :
                        order.status === 'cancelled' ? 'border-l-red-400 border-gray-100' :
                          'border-l-indigo-400 border-gray-100'
                }`}
            >
              {/* Header: Status & ID */}
              <div className="px-4 py-3 border-b border-gray-50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleSendWhatsAppToDelivery(order)
                    }}
                    className={`w-8 h-8 flex items-center justify-center rounded-lg transition-all border shadow-sm shrink-0 ${order.waSentToDelivery
                      ? 'bg-green-50 text-green-600 border-green-200'
                      : 'bg-white text-gray-400 border-gray-100'
                      }`}
                    title="Notificar WhatsApp"
                  >
                    <i className="bi bi-whatsapp text-xs"></i>
                  </button>

                  <button
                    onClick={() => handleEditPayment(order)}
                    className={`w-8 h-8 flex items-center justify-center rounded-lg transition-all border shadow-sm shrink-0 ${order.payment?.paymentStatus === 'paid'
                      ? 'bg-green-50 text-green-600 border-green-200'
                      : 'bg-white text-gray-400 border-gray-100'
                      }`}
                    title="Gestionar Pago"
                  >
                    <i className={`bi ${order.payment?.method === 'transfer' ? 'bi-bank' : 'bi-cash-stack'} text-xs`}></i>
                  </button>
                </div>
                <div className="text-right">
                  {remaining ? (
                    <div className={`text-[10px] font-black uppercase tracking-widest ${remaining.color}`}>
                      {remaining.text}
                    </div>
                  ) : (
                    <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                      Hace {timeElapsed}
                    </div>
                  )}
                  <div className="text-[10px] font-black text-gray-900 mt-1 uppercase">
                    {order.timing?.scheduledTime || 'Inmediato'}
                  </div>
                </div>
              </div>

              <div className="p-4">
                {/* Business & Customer */}
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 rounded-xl bg-gray-50 overflow-hidden border border-gray-100 flex-shrink-0">
                    {business?.image ? (
                      <img src={business.image} alt={business.name || ''} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gray-50 text-gray-200 text-xl">
                        <i className="bi bi-shop"></i>
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 mb-1">
                      <h3 className="text-sm font-bold text-gray-900 leading-tight truncate">
                        {order.customer?.name || 'Sin nombre'}
                      </h3>
                      <span
                        className={`inline-flex items-center justify-center w-4 h-4 rounded-full ${order.createdByAdmin ? 'bg-purple-100 text-purple-600' : 'bg-blue-100 text-blue-600'
                          }`}
                        title={order.createdByAdmin ? 'Pedido creado por la tienda (manual)' : 'Pedido creado por el cliente (automático)'}
                      >
                        <i className={`bi ${order.createdByAdmin ? 'bi-person-badge' : 'bi-phone'} text-[8px]`}></i>
                      </span>
                    </div>
                    <p className="text-xs text-gray-600 line-clamp-1">
                      {business?.name || 'Sin tienda'}
                    </p>
                  </div>

                  <div className="relative shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setStatusMenuOrderId(statusMenuOrderId === order.id ? null : order.id!)
                      }}
                      className={`w-10 h-10 flex items-center justify-center text-lg rounded-xl border transition-all active:scale-90 ${statusStyle.bg} ${statusStyle.text} ${statusStyle.border}`}
                    >
                      <i className={`bi ${statusStyle.icon}`}></i>
                    </button>

                    {/* Dropdown de Estados Minimal */}
                    {statusMenuOrderId === order.id && !['delivered', 'cancelled'].includes(order.status) && (
                      <>
                        <div
                          className="fixed inset-0 z-40"
                          onClick={(e) => {
                            e.stopPropagation()
                            setStatusMenuOrderId(null)
                          }}
                        />
                        <div
                          className="absolute right-0 mt-2 w-48 bg-white rounded-2xl shadow-xl border border-gray-100 py-2 z-50 animate-in fade-in zoom-in-95 duration-200"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            onClick={() => {
                              handleStatusUpdate(order.id!, 'delivered')
                              setStatusMenuOrderId(null)
                            }}
                            className="w-full px-4 py-2.5 text-left text-xs font-bold text-green-600 hover:bg-green-50 flex items-center gap-3 transition-colors"
                          >
                            <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center">
                              <i className="bi bi-check2-circle text-lg"></i>
                            </div>
                            <span>MARCAR ENTREGADO</span>
                          </button>
                          <button
                            onClick={() => {
                              handleStatusUpdate(order.id!, 'cancelled')
                              setStatusMenuOrderId(null)
                            }}
                            className="w-full px-4 py-2.5 text-left text-xs font-bold text-red-600 hover:bg-red-50 flex items-center gap-3 transition-colors mt-1"
                          >
                            <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center">
                              <i className="bi bi-x-lg"></i>
                            </div>
                            <span>CANCELAR PEDIDO</span>
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>


                {/* Dirección & Mapa */}
                {order.delivery?.type === 'delivery' && (
                  <div className="mb-4">
                    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                      <div
                        className="p-3 cursor-pointer active:bg-gray-50 flex items-center justify-between gap-2"
                        onClick={() => toggleMap(order.id!)}
                      >
                        <div className="flex items-start gap-2 min-w-0">
                          <i className="bi bi-geo-alt-fill text-red-500 mt-0.5"></i>
                          <p className="text-xs text-gray-600 line-clamp-1 italic">
                            {order.delivery.references || 'Sin dirección registrada'}
                          </p>
                        </div>
                        <div className={`w-6 h-6 rounded-lg bg-gray-50 flex items-center justify-center text-gray-400 transition-transform duration-300 ${expandedMaps[order.id!] ? 'rotate-180 text-blue-600 bg-blue-50' : ''}`}>
                          <i className="bi bi-chevron-down text-[10px]"></i>
                        </div>
                      </div>

                      {expandedMaps[order.id!] && order.delivery.latlong && (
                        <div
                          className="h-48 w-full bg-cover bg-center border-t border-gray-50 animate-in slide-in-from-top-2 duration-300"
                          style={{
                            backgroundImage: `url('https://maps.googleapis.com/maps/api/staticmap?center=${order.delivery.latlong}&zoom=15&size=400x200&scale=2&maptype=roadmap&markers=color:red%7C${order.delivery.latlong}&key=AIzaSyAgOiLYPpzxlUHkX3lCmp5KK4UF7wx7zMs')`
                          }}
                        ></div>
                      )}
                    </div>
                  </div>
                )}

                {/* Delivery Select & Total */}
                <div className="flex items-end gap-3">
                  <div className="flex-1">
                    {order.delivery?.type === 'delivery' && (
                      <>
                        <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5 block">
                          Repartidor Asignado
                        </label>
                        <div className="relative">
                          <select
                            value={order.delivery?.assignedDelivery || ''}
                            onChange={(e) => handleDeliveryUpdate(order.id!, e.target.value || null)}
                            disabled={updatingDelivery === order.id}
                            className={`w-full appearance-none pl-3 pr-8 py-2.5 text-xs font-bold rounded-xl border-2 transition-all outline-none ${order.delivery?.assignedDelivery
                              ? 'bg-green-50/50 border-green-200 text-green-700'
                              : 'bg-orange-50/50 border-orange-200 text-orange-700'
                              } ${updatingDelivery === order.id ? 'opacity-50' : ''}`}
                          >
                            <option value="">Sin asignar</option>
                            {deliveries.map(d => (
                              <option key={d.id} value={d.id}>
                                {d.nombres || d.name || 'Repartidor'}
                              </option>
                            ))}
                          </select>
                          <i className="bi bi-chevron-down absolute right-3 top-2.5 text-current opacity-50"></i>
                        </div>
                      </>
                    )}
                  </div>
                  <div className="shrink-0 pb-0.5">
                    <button
                      onClick={() => handleOpenOrderSidebar(order.id!)}
                      className="w-10 h-10 flex items-center justify-center bg-white text-gray-400 rounded-xl hover:text-blue-600 active:bg-blue-50 transition-all border border-gray-100 shadow-sm"
                      title="Ver Detalle"
                    >
                      <i className="bi bi-arrows-angle-expand text-lg"></i>
                    </button>
                  </div>
                </div>
              </div>

            </div>
          )
        })}

        {/* Sección de Retiros en Tienda */}
        {pickupOrders.length > 0 && (
          <div className="mt-8">
            <button
              onClick={() => setIsPickupExpanded(!isPickupExpanded)}
              className="w-full flex items-center justify-between p-4 bg-white rounded-2xl border border-gray-100 shadow-sm active:scale-[0.99] transition-all mb-4"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600">
                  <i className="bi bi-shop text-xl"></i>
                </div>
                <div className="text-left">
                  <h3 className="text-sm font-black text-gray-900 uppercase tracking-tight">Retiros en tienda</h3>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{pickupOrders.length} pedidos listos para retiro</p>
                </div>
              </div>
              <div className={`w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center text-gray-400 transition-transform duration-300 ${isPickupExpanded ? 'rotate-180 text-blue-600 bg-blue-50' : ''}`}>
                <i className="bi bi-chevron-down"></i>
              </div>
            </button>

            {isPickupExpanded && (
              <div className="space-y-4 animate-in slide-in-from-top-2 duration-300">
                {pickupOrders.map((order) => {
                  const business = businesses.find(b => b.id === order.businessId)
                  const timeElapsed = getTimeElapsed(order)
                  const remaining = getTimeRemaining(order)

                  const statusConfig: Record<string, { bg: string; text: string; border: string; icon: string }> = {
                    pending: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', icon: 'bi-clock-history' },
                    confirmed: { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200', icon: 'bi-check2-circle' },
                    preparing: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200', icon: 'bi-fire' },
                    ready: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', icon: 'bi-bag-check' },
                    delivered: { bg: 'bg-gray-50', text: 'text-gray-600', border: 'border-gray-200', icon: 'bi-house-check' },
                    cancelled: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', icon: 'bi-x-circle' },
                    on_way: { bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200', icon: 'bi-bicycle' }
                  }
                  const statusStyle = statusConfig[order.status] || statusConfig.pending

                  return (
                    <div
                      key={order.id}
                      className={`bg-white rounded-2xl border-l-[6px] border shadow-md overflow-hidden transition-all hover:shadow-xl ${order.status === 'pending' ? 'border-l-amber-400 border-gray-100' :
                        order.status === 'confirmed' ? 'border-l-green-400 border-gray-100' :
                          order.status === 'preparing' ? 'border-l-orange-400 border-gray-100' :
                            order.status === 'ready' ? 'border-l-emerald-400 border-gray-100' :
                              order.status === 'delivered' ? 'border-l-gray-400 border-gray-100' :
                                order.status === 'cancelled' ? 'border-l-red-400 border-gray-100' :
                                  'border-l-indigo-400 border-gray-100'
                        }`}
                    >
                      {/* Header: Status & ID */}
                      <div className="px-4 py-3 border-b border-gray-50 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleSendWhatsAppToDelivery(order)
                            }}
                            className={`w-8 h-8 flex items-center justify-center rounded-lg transition-all border shadow-sm shrink-0 ${order.waSentToDelivery
                              ? 'bg-green-50 text-green-600 border-green-200'
                              : 'bg-white text-gray-400 border-gray-100'
                              }`}
                            title="Notificar WhatsApp"
                          >
                            <i className="bi bi-whatsapp text-xs"></i>
                          </button>

                          <button
                            onClick={() => handleEditPayment(order)}
                            className={`w-8 h-8 flex items-center justify-center rounded-lg transition-all border shadow-sm shrink-0 ${order.payment?.paymentStatus === 'paid'
                              ? 'bg-green-50 text-green-600 border-green-200'
                              : 'bg-white text-gray-400 border-gray-100'
                              }`}
                            title="Gestionar Pago"
                          >
                            <i className={`bi ${order.payment?.method === 'transfer' ? 'bi-bank' : 'bi-cash-stack'} text-xs`}></i>
                          </button>
                        </div>
                        <div className="text-right">
                          {remaining ? (
                            <div className={`text-[10px] font-black uppercase tracking-widest ${remaining.color}`}>
                              {remaining.text}
                            </div>
                          ) : (
                            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                              Hace {timeElapsed}
                            </div>
                          )}
                          <div className="text-[10px] font-black text-gray-900 mt-1 uppercase">
                            {order.timing?.scheduledTime || 'Inmediato'}
                          </div>
                        </div>
                      </div>

                      <div className="p-4">
                        {/* Business & Customer */}
                        <div className="flex items-center gap-3 mb-4">
                          <div className="w-12 h-12 rounded-xl bg-gray-50 overflow-hidden border border-gray-100 flex-shrink-0">
                            {business?.image ? (
                              <img src={business.image} alt={business.name || ''} className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center bg-gray-50 text-gray-200 text-xl">
                                <i className="bi bi-shop"></i>
                              </div>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 mb-1">
                              <h3 className="text-sm font-bold text-gray-900 leading-tight truncate">
                                {order.customer?.name || 'Sin nombre'}
                              </h3>
                              <span
                                className={`inline-flex items-center justify-center w-4 h-4 rounded-full ${order.createdByAdmin ? 'bg-purple-100 text-purple-600' : 'bg-blue-100 text-blue-600'
                                  }`}
                                title={order.createdByAdmin ? 'Pedido creado por la tienda (manual)' : 'Pedido creado por el cliente (automático)'}
                              >
                                <i className={`bi ${order.createdByAdmin ? 'bi-person-badge' : 'bi-phone'} text-[8px]`}></i>
                              </span>
                            </div>
                            <p className="text-xs text-gray-600 line-clamp-1">
                              {business?.name || 'Sin tienda'}
                            </p>
                          </div>

                          <div className="relative shrink-0">
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                setStatusMenuOrderId(statusMenuOrderId === order.id ? null : order.id!)
                              }}
                              className={`w-10 h-10 flex items-center justify-center text-lg rounded-xl border transition-all active:scale-90 ${statusStyle.bg} ${statusStyle.text} ${statusStyle.border}`}
                            >
                              <i className={`bi ${statusStyle.icon}`}></i>
                            </button>

                            {/* Dropdown de Estados Minimal */}
                            {statusMenuOrderId === order.id && !['delivered', 'cancelled'].includes(order.status) && (
                              <>
                                <div
                                  className="fixed inset-0 z-40"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setStatusMenuOrderId(null)
                                  }}
                                />
                                <div
                                  className="absolute right-0 mt-2 w-48 bg-white rounded-2xl shadow-xl border border-gray-100 py-2 z-50 animate-in fade-in zoom-in-95 duration-200"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <button
                                    onClick={() => {
                                      handleStatusUpdate(order.id!, 'delivered')
                                      setStatusMenuOrderId(null)
                                    }}
                                    className="w-full px-4 py-2.5 text-left text-xs font-bold text-green-600 hover:bg-green-50 flex items-center gap-3 transition-colors"
                                  >
                                    <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center">
                                      <i className="bi bi-check2-circle text-lg"></i>
                                    </div>
                                    <span>MARCAR ENTREGADO</span>
                                  </button>
                                  <button
                                    onClick={() => {
                                      handleStatusUpdate(order.id!, 'cancelled')
                                      setStatusMenuOrderId(null)
                                    }}
                                    className="w-full px-4 py-2.5 text-left text-xs font-bold text-red-600 hover:bg-red-50 flex items-center gap-3 transition-colors mt-1"
                                  >
                                    <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center">
                                      <i className="bi bi-x-lg"></i>
                                    </div>
                                    <span>CANCELAR PEDIDO</span>
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Pickups don't show map, but can show references if any */}
                        {order.delivery.references && (
                          <div className="mb-4">
                            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden p-3">
                              <div className="flex items-start gap-2">
                                <i className="bi bi-info-circle text-blue-500 mt-0.5"></i>
                                <p className="text-xs text-gray-600 italic">
                                  {order.delivery.references}
                                </p>
                              </div>
                            </div>
                          </div>
                        )}

                        <div className="flex items-end justify-between gap-3">
                          <div className="bg-blue-50/50 px-3 py-1.5 rounded-lg border border-blue-100">
                            <span className="text-[10px] font-black text-blue-600 uppercase tracking-widest flex items-center gap-1.5">
                              <i className="bi bi-shop"></i>
                              Retiro en tienda
                            </span>
                          </div>
                          <div className="shrink-0">
                            <button
                              onClick={() => handleOpenOrderSidebar(order.id!)}
                              className="w-10 h-10 flex items-center justify-center bg-white text-gray-400 rounded-xl hover:text-blue-600 active:bg-blue-50 transition-all border border-gray-100 shadow-sm"
                              title="Ver Detalle"
                            >
                              <i className="bi bi-arrows-angle-expand text-lg"></i>
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Vista Desktop - Tabla */}
      <div className="hidden md:block bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
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
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-medium text-gray-900">{order.customer?.name || 'Sin nombre'}</div>
                        {/* Indicador Manual/Automático */}
                        <span
                          className={`inline-flex items-center justify-center w-5 h-5 rounded-full ${order.createdByAdmin ? 'bg-purple-100 text-purple-600' : 'bg-blue-100 text-blue-600'
                            }`}
                          title={order.createdByAdmin ? 'Pedido creado por la tienda (manual)' : 'Pedido creado por el cliente (automático)'}
                        >
                          <i className={`bi ${order.createdByAdmin ? 'bi-person-badge' : 'bi-phone'} text-[10px]`}></i>
                        </span>
                      </div>
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
                        {/* Botón de pago estilo dashboard */}
                        <button
                          onClick={() => handleEditPayment(order)}
                          className={`${(() => {
                            const status = order.payment?.paymentStatus
                            if (status === 'paid') return 'text-green-600 hover:text-green-800 hover:bg-green-50'
                            if (status === 'validating') return 'text-orange-600 hover:text-orange-800 hover:bg-orange-50'
                            return 'text-gray-600 hover:text-gray-800 hover:bg-gray-50'
                          })()} p-1.5 rounded transition-colors`}
                          title={order.payment?.paymentStatus === 'paid' ? 'Pago validado' :
                            order.payment?.paymentStatus === 'validating' ? 'Validando pago' : 'Verificar pago'}
                        >
                          <i className={`bi ${order.payment?.method === 'transfer' ? 'bi-bank' : order.payment?.method === 'cash' ? 'bi-coin' : 'bi-cash-coin'} text-lg`}></i>
                        </button>
                        {((order.delivery?.type === 'delivery' && order.delivery?.assignedDelivery) || (order.delivery?.type === 'pickup' && business?.phone)) && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleSendWhatsAppToDelivery(order)
                            }}
                            className={`${order.waSentToDelivery ? 'text-green-600 hover:text-green-800 hover:bg-green-50' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'} p-1 rounded-md transition-all`}
                            title={order.waSentToDelivery ? 'Notificación enviada' : 'Notify Delivery/Store'}
                          >
                            <i className="bi bi-whatsapp text-lg"></i>
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
                          className="p-1 text-gray-400 hover:text-blue-600 transition-colors"
                          title="Ver Detalle"
                        >
                          <i className="bi bi-code text-lg"></i>
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
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
                        src={paymentEditingOrder?.payment?.receiptImageUrl}
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
                  onClick={() => paymentEditingOrder && handleRejectPayment(paymentEditingOrder.id)}
                  className="px-4 py-2 bg-red-50 text-red-600 rounded-xl hover:bg-red-100 transition-colors font-bold text-sm flex items-center gap-2 border border-red-100"
                >
                  <i className="bi bi-x-circle-fill"></i>
                  Rechazar
                </button>
                <button
                  onClick={() => paymentEditingOrder && handleValidatePayment(paymentEditingOrder.id)}
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
                src={paymentEditingOrder?.payment?.receiptImageUrl}
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
        orderId={selectedOrderId || null}
      />
    </div>
  )
}
