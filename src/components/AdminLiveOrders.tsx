'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { getAllBusinesses, updateOrderStatus, updateOrder, getDeliveriesByStatus, getProductsByBusiness } from '@/lib/database'
import { Order, Business, Product, Delivery } from '@/types'
import { db } from '@/lib/firebase'
import { collection, query, orderBy, onSnapshot, limit, Timestamp } from 'firebase/firestore'
import { sendWhatsAppToDelivery, sendWhatsAppToCustomer, getNextStatus, sendOrderToStore } from '@/components/WhatsAppUtils'
import { normalizeEcuadorianPhone } from '@/lib/validation'
import dynamic from 'next/dynamic'
import type { CheckoutSession } from '@/components/LiveCheckoutsPanel'
import { GOOGLE_MAPS_API_KEY } from '@/components/GoogleMap'

const ManualOrderSidebar = dynamic(() => import('@/components/ManualOrderSidebar'), { ssr: false })
const LiveCheckoutsPanel = dynamic(() => import('@/components/LiveCheckoutsPanel').then(m => m.LiveCheckoutsPanel), { ssr: false })
const PaymentManagementModals = dynamic(() => import('@/components/PaymentManagementModals'), { ssr: false })
const OrderSidebar = dynamic(() => import('@/components/OrderSidebar'), { ssr: false })

const ORDER_SNAPSHOT_LIMIT = 300

// ── Helpers ──────────────────────────────────────────────────
const toSafeDate = (val: any): Date => {
  if (!val) return new Date()
  if (val instanceof Timestamp) return val.toDate()
  if (typeof val.toDate === 'function') return val.toDate()
  if (val.seconds) return new Date(val.seconds * 1000)
  if (typeof val === 'string') {
    const m = val.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    return new Date(val)
  }
  if (val instanceof Date) return val
  return new Date()
}

const getStatusText = (status: string) => {
  switch (status) {
    case 'pending': return 'Pendiente'
    case 'borrador': return 'Borrador'
    case 'confirmed': return 'Confirmado'
    case 'preparing': return 'Preparando'
    case 'ready': return 'Listo para entrega'
    case 'on_way': return 'En camino'
    case 'delivered': return 'Entregado'
    case 'cancelled': return 'Descartado'
    default: return status
  }
}

const getStatusColor = (status: string) => {
  switch (status) {
    case 'pending': return 'bg-yellow-100 text-yellow-800'
    case 'borrador': return 'bg-orange-100 text-orange-800'
    case 'confirmed': return 'bg-blue-100 text-blue-800'
    case 'preparing': return 'bg-purple-100 text-purple-800'
    case 'ready': return 'bg-green-100 text-green-800'
    case 'on_way': return 'bg-indigo-100 text-indigo-800'
    case 'delivered': return 'bg-gray-100 text-gray-800'
    case 'cancelled': return 'bg-red-100 text-red-800'
    default: return 'bg-gray-100 text-gray-800'
  }
}

const getOrderDisplayTime = (order: Order) => {
  try {
    if (order.timing?.scheduledTime) return order.timing.scheduledTime
    const date = toSafeDate(order.createdAt)
    return date.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' })
  } catch { return '--:--' }
}

const isActiveDashboardOrder = (order: Order) =>
  ['borrador', 'pending', 'confirmed', 'preparing', 'ready', 'on_way'].includes(order.status)

const isPreviousActiveOrder = (order: Order) => {
  if (!isActiveDashboardOrder(order)) return false
  const today = new Date()
  const orderDate = order.timing?.type === 'scheduled' && order.timing.scheduledDate
    ? toSafeDate(order.timing.scheduledDate)
    : toSafeDate(order.createdAt)
  return orderDate.getFullYear() !== today.getFullYear()
    || orderDate.getMonth() !== today.getMonth()
    || orderDate.getDate() !== today.getDate()
}

const getActionIcon = (status: string) => {
  switch (status) {
    case 'preparing': return 'bi-fire text-purple-500'
    case 'ready': return 'bi-check2 text-green-600'
    case 'on_way': return 'bi-bicycle text-indigo-500'
    case 'delivered': return 'bi-stars text-purple-500'
    default: return 'bi-arrow-right'
  }
}

const getActionText = (status: string) => {
  switch (status) {
    case 'confirmed': return 'Confirmar'
    case 'preparing': return 'Preparando'
    case 'ready': return 'Listo para la entrega'
    case 'on_way': return 'En camino'
    case 'delivered': return 'Entregado'
    default: return getStatusText(status)
  }
}

const formatPhoneForWhatsApp = (phone?: string) => {
  const n = normalizeEcuadorianPhone(phone || '')
  if (!n) return ''
  return n.startsWith('0') ? `593${n.slice(1)}` : n
}

const getDeliveryCoordinates = (order: Order | null) => {
  if (!order?.delivery) return null
  if (typeof order.delivery.mapLocation?.lat === 'number' && typeof order.delivery.mapLocation?.lng === 'number') {
    return { lat: order.delivery.mapLocation.lat, lng: order.delivery.mapLocation.lng }
  }
  const latlong = order.delivery.latlong
  if (!latlong || latlong.startsWith('pluscode:')) return null
  const [lat, lng] = latlong.split(',').map(v => Number(v.trim()))
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null
  return { lat, lng }
}

const getDeliveryZone = (order: Order | null) => {
  const d = order?.delivery as any
  return d?.sector || d?.address || d?.zoneName || d?.coverageZoneName || 'No especificado'
}

// ── Main Component ──────────────────────────────────────────
export default function AdminLiveOrders() {
  const [orders, setOrders] = useState<Order[]>([])
  const [businesses, setBusinesses] = useState<Business[]>([])
  const [deliveries, setDeliveries] = useState<Delivery[]>([])
  const [loading, setLoading] = useState(true)

  // Filters
  const [filterBusiness, setFilterBusiness] = useState<string>('all')
  const [filterSearch, setFilterSearch] = useState('')
  const [showSearchBar, setShowSearchBar] = useState(false)

  // Order sidebar
  const [isOrderSidebarOpen, setIsOrderSidebarOpen] = useState(false)
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null)

  // Manual order sidebar
  const [isEditSidebarOpen, setIsEditSidebarOpen] = useState(false)
  const [editOrder, setEditOrder] = useState<Order | null>(null)
  const [editBusiness, setEditBusiness] = useState<Business | null>(null)
  const [editProducts, setEditProducts] = useState<Product[]>([])
  const [manualSidebarMode, setManualSidebarMode] = useState<'create' | 'edit'>('create')
  const [loadingManualProducts, setLoadingManualProducts] = useState(false)

  // Payment
  const [paymentModalOpen, setPaymentModalOpen] = useState(false)
  const [selectedOrderForPayment, setSelectedOrderForPayment] = useState<Order | null>(null)

  // Customer contact modal
  const [customerContactModalOpen, setCustomerContactModalOpen] = useState(false)
  const [selectedOrderForCustomerContact, setSelectedOrderForCustomerContact] = useState<Order | null>(null)

  // Delivery status modal
  const [deliveryStatusModalOpen, setDeliveryStatusModalOpen] = useState(false)
  const [selectedOrderForStatusModal, setSelectedOrderForStatusModal] = useState<Order | null>(null)

  // Live checkouts
  const [liveCheckoutCount, setLiveCheckoutCount] = useState(0)

  // ── Data Loading ─────────────────────────────────────────
  useEffect(() => {
    const loadInitial = async () => {
      try {
        const [allBiz, allDel] = await Promise.all([
          getAllBusinesses(),
          getDeliveriesByStatus('activo')
        ])
        setBusinesses(allBiz.filter(b => b && b.id && b.name))
        setDeliveries(allDel)
      } catch (e) { console.error('Error loading initial data:', e) }
    }
    loadInitial()

    // Real-time order listener
    const ordersRef = collection(db, 'orders')
    const q = query(ordersRef, orderBy('createdAt', 'desc'), limit(ORDER_SNAPSHOT_LIMIT))
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Order[]
      setOrders(data.filter(o => o && o.id && o.customer && o.customer.name && typeof o.total === 'number'))
      setLoading(false)
    }, (err) => { console.error('Error en suscripción:', err); setLoading(false) })

    return () => unsubscribe()
  }, [])

  // ── Filtered & sorted orders (today only) ────────────────
  const filteredOrders = useMemo(() => {
    const today = new Date().toDateString()
    return orders.filter(order => {
      const orderDate = order.timing?.scheduledDate
        ? toSafeDate(order.timing.scheduledDate)
        : toSafeDate(order.createdAt)
      // Show today's orders + any active orders from previous days
      const isToday = orderDate.toDateString() === today
      const isActiveFromBefore = isActiveDashboardOrder(order) && !isToday
      if (!isToday && !isActiveFromBefore) return false

      if (filterBusiness !== 'all' && order.businessId !== filterBusiness) return false
      if (filterSearch) {
        const s = filterSearch.toLowerCase()
        const biz = businesses.find(b => b.id === order.businessId)
        return (order.customer?.name || '').toLowerCase().includes(s)
          || (order.customer?.phone || '').includes(s)
          || (biz?.name || '').toLowerCase().includes(s)
          || (order.id || '').toLowerCase().includes(s)
      }
      return true
    }).sort((a, b) => {
      const getTime = (o: Order) => {
        if (o.timing?.scheduledDate) {
          const d = toSafeDate(o.timing.scheduledDate)
          if (o.timing.scheduledTime) {
            const [h, m] = o.timing.scheduledTime.split(':').map(Number)
            d.setHours(h, m, 0, 0)
          }
          return d.getTime()
        }
        return toSafeDate(o.createdAt).getTime()
      }
      return getTime(a) - getTime(b)
    })
  }, [orders, businesses, filterBusiness, filterSearch])

  // ── Stats ────────────────────────────────────────────────
  const pendingCount = useMemo(() => filteredOrders.filter(o => o.status === 'pending').length, [filteredOrders])
  const activeCount = useMemo(() => filteredOrders.filter(o => isActiveDashboardOrder(o)).length, [filteredOrders])
  const totalSales = useMemo(() => filteredOrders.filter(o => !['cancelled'].includes(o.status)).reduce((acc, o) => acc + (o.total || 0), 0), [filteredOrders])

  // ── Handlers ─────────────────────────────────────────────
  const handleStatusChange = async (orderId: string, newStatus: Order['status'], reason?: string) => {
    try {
      await updateOrderStatus(orderId, newStatus)
      setOrders(prev => prev.map(o => o.id === orderId ? {
        ...o, status: newStatus,
        ...(newStatus === 'delivered' ? { deliveredAt: new Date() } : {}),
        ...(newStatus === 'cancelled' && reason ? { cancelReason: reason } : {})
      } : o))
    } catch (e) { console.error('Error updating status:', e); alert('Error al actualizar estado') }
  }

  const handleDeliveryAssignment = async (orderId: string, deliveryId: string) => {
    try {
      await updateOrder(orderId, { 'delivery.assignedDelivery': deliveryId } as any)
      setOrders(prev => prev.map(o => o.id === orderId
        ? { ...o, delivery: { ...o.delivery, assignedDelivery: deliveryId || undefined } as any }
        : o))
    } catch (e) { console.error('Error updating delivery:', e); alert('Error al asignar delivery') }
  }

  const handlePaymentClick = (order: Order) => {
    setSelectedOrderForPayment(order)
    setPaymentModalOpen(true)
  }

  const handleSendWhatsAppToDelivery = async (order: Order) => {
    const biz = businesses.find(b => b.id === order.businessId)
    setOrders(prev => prev.map(o => o.id === order.id ? { ...o, waSentToDelivery: true } : o))
    updateOrder(order.id, { waSentToDelivery: true } as any).catch(() => {})
    await sendWhatsAppToDelivery({ ...order, waSentToDelivery: true }, deliveries, biz || null)
  }

  const handleSendWhatsAppToStore = (order: Order) => {
    const biz = businesses.find(b => b.id === order.businessId)
    if (biz) sendOrderToStore(order, biz)
  }

  const handleDeleteOrder = async (orderId: string) => {
    if (!confirm('¿Seguro que deseas eliminar este pedido?')) return
    try {
      const { deleteOrder } = await import('@/lib/database')
      await deleteOrder(orderId)
      setOrders(prev => prev.filter(o => o.id !== orderId))
    } catch (e) { console.error('Error deleting:', e); alert('Error al eliminar') }
  }

  const handlePrint = (order: Order, silent?: boolean) => {
    // Print functionality placeholder
    if (!silent) window.print()
  }

  const handleManualOrderBusinessChange = useCallback(async (businessId: string) => {
    if (!businessId) { setEditBusiness(null); setEditProducts([]); return }
    const biz = businesses.find(b => b.id === businessId) || null
    setEditBusiness(biz)
    setLoadingManualProducts(true)
    try {
      const prods = await getProductsByBusiness(businessId)
      setEditProducts(prods)
    } catch (e) { console.error('Error loading products:', e) }
    finally { setLoadingManualProducts(false) }
  }, [businesses])

  const handleEditOrder = async (order: Order) => {
    try {
      const biz = businesses.find(b => b.id === order.businessId) || null
      setEditBusiness(biz)
      if (order.businessId) {
        const prods = await getProductsByBusiness(order.businessId)
        setEditProducts(prods)
      }
      setEditOrder(order)
      setManualSidebarMode('edit')
      setIsEditSidebarOpen(true)
    } catch (e) { console.error('Error loading edit data:', e) }
  }

  const handleOpenCreateManualOrder = async () => {
    setEditOrder(null)
    setManualSidebarMode('create')
    setIsEditSidebarOpen(true)
    if (filterBusiness !== 'all') {
      await handleManualOrderBusinessChange(filterBusiness)
    } else { setEditBusiness(null); setEditProducts([]) }
  }

  const handleOpenManualOrderFromCheckout = async (session: CheckoutSession) => {
    try {
      const biz = businesses.find(b => b.id === session.businessId) || null
      setEditBusiness(biz)
      if (session.businessId) setEditProducts(await getProductsByBusiness(session.businessId))
      const tempOrder: any = {
        id: `checkout-${session.id}`,
        businessId: session.businessId,
        customer: session.customerData,
        delivery: { type: session.deliveryData.type, address: session.deliveryData.address, references: session.deliveryData.references, deliveryCost: parseFloat(session.deliveryData.tarifa || '0'), latlong: session.deliveryData.latlong },
        timing: session.timingData,
        payment: { ...session.paymentData, paymentStatus: 'pending' },
        items: session.cartItems,
        total: session.cartItems?.reduce((acc, item) => acc + ((item.price || item.product?.price || 0) * item.quantity), 0) + parseFloat(session.deliveryData?.tarifa || '0'),
        status: 'pending', createdAt: new Date(), checkoutSessionId: session.id, _isFromCheckout: true
      }
      setEditOrder(tempOrder)
      setManualSidebarMode('edit')
      setIsEditSidebarOpen(true)
    } catch (e) { console.error('Error loading checkout:', e) }
  }

  const handleOrderUpdatedFromPaymentModal = () => {
    // onSnapshot will refresh data automatically
  }

  // ── Loading State ────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600"></div>
      </div>
    )
  }

  return (
    <div className="px-2 md:px-0">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        {/* Stats badges */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-amber-100 text-amber-700 border border-amber-200">
            {pendingCount} pendientes
          </span>
          <span className="inline-flex items-center px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-blue-100 text-blue-700 border border-blue-200">
            {activeCount} activos
          </span>
          {liveCheckoutCount > 0 && (
            <span className="inline-flex items-center px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-purple-100 text-purple-700 border border-purple-200 animate-pulse">
              {liveCheckoutCount} en vivo
            </span>
          )}
          <span className="inline-flex items-center px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-emerald-100 text-emerald-700 border border-emerald-200">
            ${totalSales.toFixed(2)}
          </span>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 sm:w-56">
            <select
              value={filterBusiness}
              onChange={(e) => setFilterBusiness(e.target.value)}
              className="w-full pl-9 pr-8 py-2 text-xs font-bold border border-gray-300 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-red-500 bg-white appearance-none cursor-pointer"
            >
              <option value="all">Todas las tiendas</option>
              {businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <i className="bi bi-shop absolute left-3 top-2 text-gray-400 pointer-events-none"></i>
            <i className="bi bi-chevron-down absolute right-3 top-2 text-gray-400 pointer-events-none"></i>
          </div>
          <button
            onClick={() => setShowSearchBar(!showSearchBar)}
            className={`shrink-0 w-9 h-9 flex items-center justify-center border rounded-xl shadow-sm text-sm transition-all ${showSearchBar ? 'bg-red-50 text-red-600 border-red-200' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
          >
            <i className={`bi ${showSearchBar ? 'bi-search-heart-fill' : 'bi-search'}`}></i>
          </button>
          <button
            onClick={handleOpenCreateManualOrder}
            className="shrink-0 w-9 h-9 flex items-center justify-center border border-red-600 rounded-xl shadow-sm text-white bg-red-600 hover:bg-red-700"
            title="Nuevo pedido"
          >
            <i className="bi bi-plus-lg"></i>
          </button>
        </div>
      </div>

      {/* Search bar */}
      {showSearchBar && (
        <div className="mb-4 animate-in slide-in-from-top-2 duration-200">
          <div className="relative">
            <input
              type="text"
              autoFocus
              placeholder="Buscar por cliente, teléfono, tienda..."
              value={filterSearch}
              onChange={(e) => setFilterSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 text-sm font-medium border border-gray-200 bg-white rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 shadow-sm"
            />
            <i className="bi bi-search absolute left-3.5 top-3 text-gray-400"></i>
          </div>
        </div>
      )}

      {/* Live Checkouts */}
      <LiveCheckoutsPanel
        businessId=""
        orders={filteredOrders}
        onCountChange={setLiveCheckoutCount}
        onOpenManualOrder={handleOpenManualOrderFromCheckout}
      />

      {/* Orders Grid */}
      {filteredOrders.length === 0 ? (
        <div className="text-center py-16">
          <i className="bi bi-inbox text-5xl text-gray-300 mb-4 block"></i>
          <p className="text-gray-500 font-medium">No hay pedidos para mostrar</p>
          <p className="text-gray-400 text-sm mt-1">Los pedidos aparecerán aquí en tiempo real</p>
        </div>
      ) : (
        <div className="p-2 sm:p-4 space-y-6">
          <div className="flex flex-col lg:flex-row gap-6 items-start">
            {/* Column 1: Borrador + Pendiente */}
            <div className="w-full lg:flex-1 lg:min-w-0 space-y-6">
              <OrderStatusColumn
                statuses={['borrador', 'pending']}
                orders={filteredOrders}
                businesses={businesses}
                availableDeliveries={deliveries}
                handleStatusChange={handleStatusChange}
                handleDeliveryAssignment={handleDeliveryAssignment}
                handlePaymentClick={handlePaymentClick}
                handleSendWhatsAppToDelivery={handleSendWhatsAppToDelivery}
                handleSendWhatsAppToStore={handleSendWhatsAppToStore}
                handlePrint={handlePrint}
                setSelectedOrderForStatusModal={setSelectedOrderForStatusModal}
                setDeliveryStatusModalOpen={setDeliveryStatusModalOpen}
                setSelectedOrderForEdit={(o: Order) => handleEditOrder(o)}
                handleDeleteOrder={handleDeleteOrder}
                setSelectedOrderForCustomerContact={setSelectedOrderForCustomerContact}
                setCustomerContactModalOpen={setCustomerContactModalOpen}
              />
            </div>

            {/* Column 2: Confirmed */}
            <div className="w-full lg:flex-1 lg:min-w-0 space-y-6">
              <OrderStatusColumn
                statuses={['confirmed']}
                orders={filteredOrders}
                businesses={businesses}
                availableDeliveries={deliveries}
                handleStatusChange={handleStatusChange}
                handleDeliveryAssignment={handleDeliveryAssignment}
                handlePaymentClick={handlePaymentClick}
                handleSendWhatsAppToDelivery={handleSendWhatsAppToDelivery}
                handleSendWhatsAppToStore={handleSendWhatsAppToStore}
                handlePrint={handlePrint}
                setSelectedOrderForStatusModal={setSelectedOrderForStatusModal}
                setDeliveryStatusModalOpen={setDeliveryStatusModalOpen}
                setSelectedOrderForEdit={(o: Order) => handleEditOrder(o)}
                handleDeleteOrder={handleDeleteOrder}
                setSelectedOrderForCustomerContact={setSelectedOrderForCustomerContact}
                setCustomerContactModalOpen={setCustomerContactModalOpen}
              />
            </div>

            {/* Column 3: Preparing, Ready, On Way, Delivered, Cancelled */}
            <div className="w-full lg:flex-1 lg:min-w-0 space-y-6">
              <OrderStatusColumn
                statuses={['preparing', 'ready', 'on_way', 'delivered', 'cancelled']}
                orders={filteredOrders}
                businesses={businesses}
                availableDeliveries={deliveries}
                handleStatusChange={handleStatusChange}
                handleDeliveryAssignment={handleDeliveryAssignment}
                handlePaymentClick={handlePaymentClick}
                handleSendWhatsAppToDelivery={handleSendWhatsAppToDelivery}
                handleSendWhatsAppToStore={handleSendWhatsAppToStore}
                handlePrint={handlePrint}
                setSelectedOrderForStatusModal={setSelectedOrderForStatusModal}
                setDeliveryStatusModalOpen={setDeliveryStatusModalOpen}
                setSelectedOrderForEdit={(o: Order) => handleEditOrder(o)}
                handleDeleteOrder={handleDeleteOrder}
                setSelectedOrderForCustomerContact={setSelectedOrderForCustomerContact}
                setCustomerContactModalOpen={setCustomerContactModalOpen}
              />
            </div>
          </div>
        </div>
      )}

      {/* Customer Contact Modal */}
      <CustomerContactModal
        isOpen={customerContactModalOpen}
        onClose={() => { setCustomerContactModalOpen(false); setSelectedOrderForCustomerContact(null) }}
        order={selectedOrderForCustomerContact}
      />

      {/* Delivery Status Modal */}
      <DeliveryStatusModal
        isOpen={deliveryStatusModalOpen}
        onClose={() => { setDeliveryStatusModalOpen(false); setSelectedOrderForStatusModal(null) }}
        order={selectedOrderForStatusModal}
        deliveryAgent={deliveries.find(d => d.id === selectedOrderForStatusModal?.delivery?.assignedDelivery)}
        availableDeliveries={deliveries}
        canChangeDelivery={true}
        onDeliveryAssign={handleDeliveryAssignment}
        onWhatsApp={() => { if (selectedOrderForStatusModal) handleSendWhatsAppToDelivery(selectedOrderForStatusModal) }}
      />

      {/* Payment Modal */}
      <PaymentManagementModals
        isOpen={paymentModalOpen}
        onClose={() => { setPaymentModalOpen(false); setSelectedOrderForPayment(null) }}
        order={selectedOrderForPayment}
        onOrderUpdated={handleOrderUpdatedFromPaymentModal}
      />

      {/* Order Detail Sidebar */}
      <OrderSidebar
        isOpen={isOrderSidebarOpen}
        onClose={() => setIsOrderSidebarOpen(false)}
        orderId={selectedOrderId || null}
      />

      {/* Manual Order Sidebar */}
      <ManualOrderSidebar
        isOpen={isEditSidebarOpen}
        onClose={() => { setIsEditSidebarOpen(false); setEditOrder(null); setManualSidebarMode('create') }}
        business={editBusiness}
        products={editProducts}
        onOrderCreated={() => { setIsEditSidebarOpen(false); setEditOrder(null) }}
        businesses={businesses}
        onBusinessChange={handleManualOrderBusinessChange}
        loadingBusinessProducts={loadingManualProducts}
        mode={manualSidebarMode}
        editOrder={editOrder}
        onOrderUpdated={() => { setIsEditSidebarOpen(false); setEditOrder(null) }}
      />
    </div>
  )
}

// ── CollapsibleSection ─────────────────────────────────────
function CollapsibleSection({ title, count, status, children, defaultExpanded = true }: {
  title: string, count: number | string, status: string, children: React.ReactNode, defaultExpanded?: boolean
}) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)

  const getDotColor = (s: string) => {
    switch (s) {
      case 'pending': return 'bg-yellow-500 shadow-yellow-200'
      case 'borrador': return 'bg-orange-400 shadow-orange-200'
      case 'confirmed': return 'bg-blue-500 shadow-blue-200'
      case 'preparing': return 'bg-purple-500 shadow-purple-200'
      case 'ready': return 'bg-green-500 shadow-green-200'
      case 'on_way': return 'bg-indigo-500 shadow-indigo-200'
      case 'delivered': return 'bg-gray-500 shadow-gray-200'
      case 'cancelled': return 'bg-red-500 shadow-red-200'
      default: return 'bg-gray-400'
    }
  }

  return (
    <div className="mb-4 overflow-visible rounded-xl bg-transparent">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex justify-between items-center bg-gray-100 hover:bg-gray-200 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className={`w-3 h-3 rounded-full shadow-sm ${getDotColor(status)}`}></span>
          <h3 className="font-bold text-gray-800 text-lg">{title}</h3>
          <span className="bg-gray-200 border border-gray-300 text-gray-700 text-xs font-bold px-2.5 py-0.5 rounded-full">{count}</span>
        </div>
        <i className={`bi bi-chevron-${isExpanded ? 'up' : 'down'} text-gray-400 transition-transform duration-200`}></i>
      </button>
      {isExpanded && (
        <div className="p-4 space-y-3 bg-gray-100 animate-in slide-in-from-top-2 duration-200">
          {children}
        </div>
      )}
    </div>
  )
}

// ── OrderStatusColumn ──────────────────────────────────────
function OrderStatusColumn({ statuses, orders, businesses, availableDeliveries, handleStatusChange, handleDeliveryAssignment, handlePaymentClick, handleSendWhatsAppToDelivery, handleSendWhatsAppToStore, handlePrint, setSelectedOrderForStatusModal, setDeliveryStatusModalOpen, setSelectedOrderForEdit, handleDeleteOrder, setSelectedOrderForCustomerContact, setCustomerContactModalOpen }: any) {
  return (
    <>
      {statuses.map((status: string) => {
        const statusOrders = orders.filter((o: any) => o.status === status)
        if (statusOrders.length === 0) return null

        return (
          <CollapsibleSection
            key={status}
            title={getStatusText(status)}
            count={statusOrders.length}
            status={status}
            defaultExpanded={!['delivered', 'cancelled'].includes(status)}
          >
            {statusOrders.map((order: any) => (
              <AdminOrderCard
                key={order.id}
                order={order}
                businesses={businesses}
                availableDeliveries={availableDeliveries}
                onStatusChange={handleStatusChange}
                onDeliveryAssign={handleDeliveryAssignment}
                onPaymentEdit={() => handlePaymentClick(order)}
                onWhatsAppDelivery={() => handleSendWhatsAppToDelivery(order)}
                onWhatsAppStore={() => handleSendWhatsAppToStore(order)}
                onPrint={(silent?: boolean) => handlePrint(order, silent)}
                onDeliveryStatusClick={(o: any) => { setSelectedOrderForStatusModal(o); setDeliveryStatusModalOpen(true) }}
                onEdit={() => setSelectedOrderForEdit(order)}
                onDelete={() => handleDeleteOrder(order.id)}
                onCustomerClick={() => { setSelectedOrderForCustomerContact(order); setCustomerContactModalOpen(true) }}
              />
            ))}
          </CollapsibleSection>
        )
      })}
    </>
  )
}

// ── AdminOrderCard (Business Dashboard style + store badge) ─
function AdminOrderCard({ order, businesses, availableDeliveries, onStatusChange, onDeliveryAssign, onPaymentEdit, onWhatsAppDelivery, onWhatsAppStore, onPrint, onDeliveryStatusClick, onEdit, onDelete, onCustomerClick }: {
  order: Order, businesses: Business[], availableDeliveries: Delivery[],
  onStatusChange: (id: string, status: Order['status'], reason?: string) => void,
  onDeliveryAssign: (id: string, deliveryId: string) => void,
  onPaymentEdit: () => void, onWhatsAppDelivery: () => void, onWhatsAppStore: () => void,
  onPrint: (silent?: boolean) => void, onDeliveryStatusClick: (order: Order) => void,
  onEdit: () => void, onDelete: () => void, onCustomerClick: () => void
}) {
  const nextStatus = getNextStatus(order.status)
  const isDelivery = order.delivery?.type === 'delivery'
  const isPickup = order.delivery?.type === 'pickup'
  const [isExpanded, setIsExpanded] = useState(false)
  const [statusMenuOpen, setStatusMenuOpen] = useState(false)
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false)
  const [discardReason, setDiscardReason] = useState('')
  const [deliveryInfoExpanded, setDeliveryInfoExpanded] = useState(false)
  const statusMenuRef = useRef<HTMLDivElement>(null)
  const whatsappMenuRef = useRef<HTMLDivElement>(null)
  const [whatsappMenuOpen, setWhatsappMenuOpen] = useState(false)

  useEffect(() => {
    if (!whatsappMenuOpen) return
    const handler = (e: MouseEvent) => {
      if (!whatsappMenuRef.current?.contains(e.target as Node)) {
        setWhatsappMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [whatsappMenuOpen])

  const business = businesses.find((b: Business) => b.id === order.businessId)
  const assignedDelivery = availableDeliveries.find(d => d.id === order.delivery?.assignedDelivery)
  const deliveryLabel = order.delivery?.assignedDelivery
    ? assignedDelivery?.nombres || 'Delivery asignado'
    : 'Buscando delivery'
  const deliveryLabelClass = !order.delivery?.assignedDelivery
    ? 'bg-gray-100 text-gray-600 border-gray-200'
    : order.delivery?.acceptanceStatus === 'accepted'
      ? 'bg-green-100 text-green-700 border-green-200'
      : 'bg-yellow-100 text-yellow-800 border-yellow-200'
  const fulfillmentLabel = isPickup ? 'Retiro en tienda' : deliveryLabel
  const fulfillmentLabelClass = isPickup ? 'bg-blue-100 text-blue-700 border-blue-200' : deliveryLabelClass

  const deliveryCoordinates = getDeliveryCoordinates(order)
  const deliveryZone = getDeliveryZone(order)
  const deliveryCost = order.delivery?.deliveryCost || 0
  const deliveryMapsUrl = deliveryCoordinates ? `https://www.google.com/maps/search/?api=1&query=${deliveryCoordinates.lat},${deliveryCoordinates.lng}` : undefined
  const deliveryMapImageUrl = deliveryCoordinates ? `https://maps.googleapis.com/maps/api/staticmap?center=${deliveryCoordinates.lat},${deliveryCoordinates.lng}&zoom=16&size=600x180&scale=2&maptype=roadmap&markers=color:red%7C${deliveryCoordinates.lat},${deliveryCoordinates.lng}&key=${GOOGLE_MAPS_API_KEY}` : undefined

  const sortedItems = [...(order.items || [])].sort((a: any, b: any) => {
    const pA = (a.price || a.product?.price || 0) * a.quantity
    const pB = (b.price || b.product?.price || 0) * b.quantity
    if (pA === 0 && pB !== 0) return 1
    if (pA !== 0 && pB === 0) return -1
    return 0
  })

  useEffect(() => {
    if (confirmDiscardOpen) document.body.style.overflow = 'hidden'
    else document.body.style.overflow = ''
    return () => { document.body.style.overflow = '' }
  }, [confirmDiscardOpen])

  useEffect(() => {
    if (!statusMenuOpen) return
    const handler = (e: MouseEvent) => {
      if (!statusMenuRef.current?.contains(e.target as Node)) setStatusMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [statusMenuOpen])

  const primaryActionStatus = order.status === 'confirmed' ? null : nextStatus
  const primaryActionLabel = primaryActionStatus ? getActionText(primaryActionStatus) : ''

  return (
    <div className={`bg-white rounded-xl shadow-sm border border-gray-100 transition-all ${statusMenuOpen ? 'relative z-30' : ''}`}>
      {/* Discard Confirmation Modal */}
      {confirmDiscardOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" onClick={(e) => e.stopPropagation()}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => { setConfirmDiscardOpen(false); setDiscardReason('') }} />
          <div className="relative bg-white w-full max-w-sm rounded-2xl shadow-2xl p-6 flex flex-col items-center text-center">
            <div className="w-16 h-16 bg-red-50 text-red-600 rounded-full flex items-center justify-center mb-4">
              <i className="bi bi-trash3 text-2xl"></i>
            </div>
            <h4 className="text-xl font-bold text-gray-900 mb-2">¿Descartar pedido?</h4>
            <p className="text-sm text-gray-500 mb-6 px-2">Se marcará como descartado. Selecciona el motivo.</p>
            <div className="w-full mb-6">
              <select value={discardReason} onChange={(e) => setDiscardReason(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl py-3 px-4 text-sm outline-none focus:ring-2 focus:ring-red-100 font-medium">
                <option value="">Selecciona un motivo...</option>
                <option value="Cliente no responde">Cliente no responde</option>
                <option value="Sin stock de productos">Sin stock de productos</option>
                <option value="Fuera de zona de cobertura">Fuera de zona de cobertura</option>
                <option value="Pedido duplicado">Pedido duplicado</option>
                <option value="Fallo en el pago">Fallo en el pago</option>
                <option value="Otro">Otro motivo</option>
              </select>
            </div>
            <div className="flex gap-3 w-full">
              <button onClick={() => { setConfirmDiscardOpen(false); setDiscardReason('') }}
                className="flex-1 py-3 text-sm font-bold text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200">Cancelar</button>
              <button onClick={() => { onStatusChange(order.id, 'cancelled', discardReason || 'Sin motivo'); setConfirmDiscardOpen(false); setDiscardReason(''); setStatusMenuOpen(false) }}
                className="flex-1 py-3 text-sm font-bold text-white bg-red-600 rounded-xl hover:bg-red-700 disabled:opacity-50" disabled={!discardReason}>Confirmar</button>
            </div>
          </div>
        </div>
      )}

      {/* Card Header */}
      <div
        className={`px-4 py-3 border-b cursor-pointer transition-colors ${isExpanded ? 'border-gray-200 bg-gray-200 hover:bg-gray-200' : 'border-gray-50 bg-gray-50/50 hover:bg-gray-100'}`}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {/* Row 1: Customer + Store + Actions */}
        <div className="flex justify-between items-center mb-2">
          <div className="flex items-start gap-3">
            <div className="flex flex-col items-center shrink-0 mt-1">
              <i className={`bi bi-chevron-${isExpanded ? 'up' : 'down'} text-gray-400 text-xs`}></i>
              {!order.createdByAdmin && (
                <i className="bi bi-phone text-blue-500 text-[10px] mt-0.5" title="Pedido del cliente (Checkout)"></i>
              )}
            </div>
            <div className="flex flex-col">
              <span className="text-sm sm:text-base font-bold text-gray-900 flex items-center gap-2">
                {order.customer?.name || "Cliente"}
              </span>
              <div className="flex items-center gap-2 mt-0.5">
                <i className={`bi ${order.timing?.type === 'scheduled' ? 'bi-clock' : 'bi-lightning-fill'} ${order.timing?.type === 'scheduled' ? 'text-blue-600' : 'text-yellow-500'}`}></i>
                <span className="font-mono text-sm sm:font-medium text-gray-600">{getOrderDisplayTime(order)}</span>
                {isPreviousActiveOrder(order) && (
                  <span className="inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold leading-none bg-amber-100 text-amber-800 border border-amber-200">Pendiente anterior</span>
                )}
              </div>
            </div>
          </div>

          <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
            {/* Advance Status */}
            {primaryActionStatus && (
              <button
                onClick={() => {
                  if (primaryActionStatus === 'confirmed') { onStatusChange(order.id, 'confirmed'); setTimeout(() => onPrint(true), 500) }
                  else onStatusChange(order.id, primaryActionStatus)
                }}
                className={`flex items-center gap-1 rounded-lg transition-colors ${primaryActionStatus === 'confirmed'
                  ? 'px-3 py-1.5 text-xs font-bold bg-green-600 text-white hover:bg-green-700 shadow-sm'
                  : 'p-1.5 text-lg hover:bg-white hover:shadow-md'}`}
                title={primaryActionLabel}
              >
                {primaryActionStatus === 'confirmed' ? (
                  <><span>{primaryActionLabel}</span><i className="bi bi-check2-circle"></i></>
                ) : (
                  <i className={`bi ${getActionIcon(primaryActionStatus)}`}></i>
                )}
              </button>
            )}
            {/* Discard for pending */}
            {order.status === 'pending' && (
              <button onClick={() => setConfirmDiscardOpen(true)}
                className="p-1.5 text-lg text-gray-400 bg-gray-50 border border-gray-100 rounded-lg hover:bg-gray-100 shadow-sm">
                <i className="bi bi-x-lg"></i>
              </button>
            )}
            {/* Status menu */}
            {order.status !== 'pending' && (
              <div className="relative" ref={statusMenuRef}>
                <button onClick={() => setStatusMenuOpen(!statusMenuOpen)}
                  className={`p-1.5 text-lg rounded-lg transition-all hover:bg-gray-100 ${statusMenuOpen ? 'bg-gray-100' : ''}`}>
                  <i className="bi bi-three-dots-vertical"></i>
                </button>
                {statusMenuOpen && (
                  <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-xl shadow-xl border border-gray-100 z-20 py-1 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
                    {['preparing', 'ready', 'on_way', 'delivered'].filter(s => s !== order.status).map(s => (
                      <button key={s} onClick={() => { onStatusChange(order.id, s as any); setStatusMenuOpen(false) }}
                        className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 transition-colors flex items-center gap-2">
                        <i className={`bi ${getActionIcon(s)}`}></i> {getActionText(s)}
                      </button>
                    ))}
                    <button onClick={() => setConfirmDiscardOpen(true)}
                      className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 transition-colors flex items-center gap-2 border-t border-gray-50 mt-1">
                      <i className="bi bi-x-circle text-gray-500"></i> Descartado
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Store Badge */}
        {business && (
          <div className="flex items-center gap-2 mb-2">
            <div className="w-5 h-5 rounded-full overflow-hidden bg-gray-200 flex-shrink-0">
              {business.image ? <img src={business.image} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center"><i className="bi bi-shop text-[8px] text-gray-400"></i></div>}
            </div>
            <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider truncate">{business.name}</span>
          </div>
        )}

        {/* Collapsed items preview */}
        {!isExpanded && (
          <div className="flex flex-col gap-0.5">
            {sortedItems.map((item: any, idx) => (
              <div key={idx} className="text-lg sm:text-sm leading-tight text-gray-600">
                {item.quantity}x {item.variant || item.product?.name || item.name}
              </div>
            ))}
          </div>
        )}

        {/* Fulfillment label */}
        {(isDelivery || isPickup) && (
          <div className="mt-2 flex justify-end" onClick={(e) => e.stopPropagation()}>
            <button type="button"
              onClick={() => { if (isDelivery && order.delivery?.assignedDelivery) onDeliveryStatusClick(order) }}
              className={`flex h-[20px] min-h-[20px] max-h-[20px] w-36 items-center justify-center truncate rounded-[3px] border px-2 py-0 text-[11px] font-semibold leading-none shadow-[inset_0_0_0_1px_rgba(255,255,255,0.35)] transition-colors ${fulfillmentLabelClass} ${isDelivery && order.delivery?.assignedDelivery ? 'cursor-pointer hover:brightness-95' : 'cursor-default'}`}
            >
              {fulfillmentLabel}
            </button>
          </div>
        )}
      </div>

      {/* Expanded Card Body */}
      {isExpanded && (
        <div className="p-4 bg-white animate-in slide-in-from-top-2 duration-200">
          {/* Delivery Info */}
          {isDelivery && (
            <div className="space-y-2 mb-4">
              <button type="button" onClick={(e) => { e.stopPropagation(); setDeliveryInfoExpanded(p => !p) }}
                className="group flex w-full items-start gap-1.5 rounded-lg px-2 py-1.5 text-left text-sm text-gray-600 transition-colors hover:bg-red-50 hover:text-red-700">
                <i className="bi bi-geo-alt-fill mt-0.5 flex-shrink-0 text-gray-400 group-hover:text-red-500"></i>
                <span className="line-clamp-2">{order.delivery?.references || (order.delivery as any)?.reference || "Ubicación"}</span>
                <i className={`bi bi-chevron-${deliveryInfoExpanded ? 'up' : 'down'} mt-0.5 flex-shrink-0 text-[11px] text-gray-300`}></i>
              </button>
              {deliveryInfoExpanded && (
                <div className="ml-2 overflow-hidden rounded-xl border border-red-100 bg-red-50/50 animate-in slide-in-from-top-1 duration-150">
                  {deliveryMapImageUrl && deliveryMapsUrl ? (
                    <a href={deliveryMapsUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="block">
                      <img src={deliveryMapImageUrl} alt="Mapa" className="h-36 w-full object-cover" loading="lazy" />
                    </a>
                  ) : (
                    <div className="flex h-24 items-center justify-center gap-2 text-sm font-medium text-gray-500">
                      <i className="bi bi-map text-gray-300"></i> Sin coordenadas
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2 p-3 text-sm">
                    <div><p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Zona</p><p className="font-semibold text-gray-900">{deliveryZone}</p></div>
                    <div className="text-right"><p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Envío</p><p className="font-semibold text-gray-900">${deliveryCost.toFixed(2)}</p></div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Notes */}
          {order.notas && order.notas.trim() && (
            <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <div className="flex items-start gap-2">
                <i className="bi bi-sticky text-amber-600 mt-0.5 flex-shrink-0"></i>
                <div className="flex-1">
                  <p className="text-sm font-medium text-amber-800 mb-1">Notas</p>
                  <p className="text-sm text-amber-700 whitespace-pre-wrap">{order.notas}</p>
                </div>
              </div>
            </div>
          )}

          {order.notaImageUrl && (
            <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <div className="flex items-start gap-2">
                <i className="bi bi-image text-amber-600 mt-0.5 flex-shrink-0"></i>
                <div className="flex-1">
                  <p className="text-sm font-medium text-amber-800 mb-2">Imagen de nota</p>
                  <img src={order.notaImageUrl} alt="Nota" className="max-h-48 w-full object-contain rounded-md border border-amber-200 bg-white" />
                </div>
              </div>
            </div>
          )}

          {/* Items */}
          <div className="space-y-2 mb-4">
            {order.items?.map((item: any, idx: number) => (
              <div key={idx} className="flex justify-between text-base">
                <span className="text-gray-700">
                  <span className="font-medium text-gray-900">{item.quantity}x</span> {item.variant || item.product?.name || item.name}
                </span>
                <div className="flex flex-col items-end">
                  <span className="text-emerald-600 font-bold text-sm">
                    ${((item.storeReceives || (item.price && item.commission ? item.price - item.commission : (item.product?.basePrice || item.product?.price || item.price || 0))) * item.quantity).toFixed(2)}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-dashed border-gray-200 my-3"></div>

          {/* Total & Payment */}
          <div className="flex justify-between items-center mb-4">
            <div className="flex items-center gap-2">
              <button onClick={onPaymentEdit}
                className={`flex items-center gap-1.5 px-2 py-1 rounded text-sm font-medium transition-colors ${order.payment?.paymentStatus === 'paid' ? 'bg-green-100 text-green-700' : order.payment?.paymentStatus === 'validating' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>
                <i className={`bi ${order.payment?.method === 'transfer' ? 'bi-bank' : order.payment?.method === 'mixed' ? 'bi-cash-coin' : 'bi-cash'}`}></i>
                <div className="flex flex-col items-start leading-tight">
                  <span className="text-emerald-600 font-black">${(order.items?.reduce((acc, item) => acc + ((item.storeReceives || (item.price && item.commission ? item.price - item.commission : (item.product?.basePrice || item.product?.price || item.price || 0))) * item.quantity), 0) || order.total || 0).toFixed(2)}</span>
                  {((order.total || 0) > (order.items?.reduce((acc, item) => acc + ((item.storeReceives || (item.price && item.commission ? item.price - item.commission : (item.product?.basePrice || item.product?.price || item.price || 0))) * item.quantity), 0) || order.total || 0)) && (
                    <span className="text-[9px] text-gray-400 font-bold uppercase tracking-tighter">Público: ${(order.total || 0).toFixed(2)}</span>
                  )}
                </div>
                <i className="bi bi-pencil-square text-xs opacity-50 ml-1"></i>
              </button>
            </div>
            <button onClick={() => onPrint()} className="p-2 text-gray-400 hover:text-gray-600">
              <i className="bi bi-printer"></i>
            </button>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-4 border-t border-gray-100">
            {/* WhatsApp Dropdown Button */}
            <div className="relative" ref={whatsappMenuRef}>
              <button
                onClick={() => setWhatsappMenuOpen(!whatsappMenuOpen)}
                className="flex items-center justify-center p-2.5 text-green-600 bg-green-50 rounded-lg hover:bg-green-100 transition-colors"
                title="Opciones de WhatsApp"
              >
                <i className="bi bi-whatsapp text-lg"></i>
              </button>
              {whatsappMenuOpen && (
                <div className="absolute left-0 bottom-full mb-2 w-48 bg-white rounded-xl shadow-xl border border-gray-100 z-50 py-1 overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-150">
                  <button
                    onClick={() => { onCustomerClick(); setWhatsappMenuOpen(false); }}
                    className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 flex items-center gap-2 text-gray-700 font-medium"
                  >
                    <i className="bi bi-person text-green-600"></i> Cliente (Comprobante)
                  </button>
                  <button
                    onClick={() => { onWhatsAppStore(); setWhatsappMenuOpen(false); }}
                    className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 flex items-center gap-2 text-gray-700 font-medium"
                  >
                    <i className="bi bi-shop text-purple-600"></i> A la Tienda
                  </button>
                  {isDelivery && (
                    <button
                      onClick={() => { onWhatsAppDelivery(); setWhatsappMenuOpen(false); }}
                      className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 flex items-center gap-2 text-gray-700 font-medium"
                    >
                      <i className="bi bi-bicycle text-indigo-600"></i> Al Delivery
                    </button>
                  )}
                </div>
              )}
            </div>

            <button onClick={onEdit}
              className="flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors">
              <i className="bi bi-pencil"></i> Editar
            </button>
            <button onClick={onDelete}
              className="flex items-center justify-center p-2 text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors">
              <i className="bi bi-trash"></i>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── CustomerContactModal ───────────────────────────────────
function CustomerContactModal({ isOpen, onClose, order }: { isOpen: boolean, onClose: () => void, order: Order | null }) {
  if (!isOpen || !order) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onMouseDown={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-200" onMouseDown={(e) => e.stopPropagation()}>
        <div className="p-6">
          <div className="flex justify-between items-start mb-6">
            <div><h3 className="text-xl font-bold text-gray-900">Contactar Cliente</h3><p className="text-sm text-gray-500 mt-1">{order.customer?.name}</p></div>
            <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg text-gray-400"><i className="bi bi-x-lg"></i></button>
          </div>
          <div className="space-y-3">
            <button onClick={() => { sendWhatsAppToCustomer(order); onClose() }}
              className="w-full flex items-center justify-center gap-3 py-4 bg-green-600 text-white rounded-xl font-bold hover:bg-green-700 transition-colors shadow-lg shadow-green-200">
              <i className="bi bi-whatsapp text-xl"></i> Enviar WhatsApp
            </button>
            <a href={`tel:${order.customer?.phone}`} onClick={onClose}
              className="w-full flex items-center justify-center gap-3 py-4 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-colors shadow-lg shadow-blue-200">
              <i className="bi bi-telephone-fill text-xl"></i> Llamar por teléfono
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── DeliveryStatusModal ────────────────────────────────────
function DeliveryStatusModal({ isOpen, onClose, order, deliveryAgent, availableDeliveries, canChangeDelivery, onDeliveryAssign, onWhatsApp }: {
  isOpen: boolean, onClose: () => void, order: Order | null, deliveryAgent?: Delivery,
  availableDeliveries: Delivery[], canChangeDelivery: boolean,
  onDeliveryAssign: (id: string, deliveryId: string) => void | Promise<void>, onWhatsApp: () => void
}) {
  if (!isOpen || !order) return null
  const status = order.delivery?.acceptanceStatus
  const agentCardClass = status === 'accepted' ? 'bg-green-50 border-green-200' : 'bg-yellow-50 border-yellow-200'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onMouseDown={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl animate-in fade-in zoom-in duration-200" onMouseDown={(e) => e.stopPropagation()}>
        <div className="p-6">
          <div className="flex justify-between items-start mb-6">
            <h3 className="text-xl font-bold text-gray-900">Estado del Delivery</h3>
            <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg text-gray-400"><i className="bi bi-x-lg"></i></button>
          </div>
          <div className="space-y-6">
            <div className={`flex items-center gap-4 p-4 rounded-xl border ${agentCardClass}`}>
              <div className={`w-12 h-12 rounded-full flex items-center justify-center ${status === 'accepted' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                <i className="bi bi-person-fill text-2xl"></i>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-gray-500 font-medium">Repartidor Asignado</p>
                {canChangeDelivery ? (
                  <select value={order.delivery?.assignedDelivery || ''} onChange={(e) => onDeliveryAssign(order.id, e.target.value)}
                    className="mt-1 w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm font-bold text-gray-900 outline-none focus:ring-2 focus:ring-red-100">
                    <option value="">Asignar repartidor...</option>
                    {availableDeliveries.map(d => <option key={d.id} value={d.id}>{d.nombres}</option>)}
                  </select>
                ) : (
                  <p className="text-lg font-bold text-gray-900 truncate">{deliveryAgent?.nombres || 'No identificado'}</p>
                )}
                <div className="mt-2 flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${status === 'accepted' ? 'bg-green-500' : status === 'rejected' ? 'bg-red-500' : 'bg-yellow-500 animate-pulse'}`} />
                  <span className="text-sm font-bold text-gray-900">
                    {status === 'accepted' ? 'Confirmado' : status === 'rejected' ? 'Rechazado' : 'Esperando confirmacion'}
                  </span>
                </div>
              </div>
            </div>
            <button onClick={onWhatsApp}
              className="w-full flex items-center justify-center gap-2 py-3.5 bg-green-600 text-white rounded-xl font-bold hover:bg-green-700 shadow-lg shadow-green-200">
              <i className="bi bi-whatsapp text-xl"></i> Notificar por WhatsApp
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
