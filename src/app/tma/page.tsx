'use client'

import { useState, useEffect, useMemo, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { db } from '@/lib/firebase'
import { collection, query, orderBy, onSnapshot, where, doc, updateDoc, Timestamp } from 'firebase/firestore'
import { getAllBusinesses, updateOrderStatus, updateOrder, getDeliveriesByStatus } from '@/lib/database'
import { Order, Business, Delivery } from '@/types'
import { sendWhatsAppToDelivery, sendWhatsAppToCustomer, sendOrderToStore } from '@/components/WhatsAppUtils'
import { printOrder } from '@/lib/print-utils'

// Helper to parse Firestore dates safely
const toSafeDate = (val: any): Date => {
  if (!val) return new Date()
  if (val instanceof Timestamp) return val.toDate()
  if (typeof val.toDate === 'function') return val.toDate()
  if (val.seconds) return new Date(val.seconds * 1000)
  if (typeof val === 'string') return new Date(val)
  if (val instanceof Date) return val
  return new Date()
}

// Format date
const formatDate = (dateVal: any) => {
  const d = toSafeDate(dateVal)
  return d.toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' + 
         d.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit', hour12: false })
}

const formatTimeOnly = (dateVal: any): string => {
  const d = toSafeDate(dateVal)
  return d.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit', hour12: false })
}

// Helpers for status tags
const getStatusText = (status: string) => {
  switch (status) {
    case 'pending': return 'Pendiente'
    case 'borrador': return 'Borrador'
    case 'confirmed': return 'Confirmado'
    case 'preparing': return 'Preparando'
    case 'ready': return 'Listo'
    case 'on_way': return 'En camino'
    case 'delivered': return 'Entregado'
    case 'cancelled': return 'Cancelado'
    default: return status
  }
}

const getStatusColor = (status: string) => {
  switch (status) {
    case 'pending': return 'bg-amber-100 text-amber-800 border-amber-200'
    case 'borrador': return 'bg-orange-100 text-orange-800 border-orange-200'
    case 'confirmed': return 'bg-blue-100 text-blue-800 border-blue-200'
    case 'preparing': return 'bg-purple-100 text-purple-800 border-purple-200'
    case 'ready': return 'bg-emerald-100 text-emerald-800 border-emerald-200'
    case 'on_way': return 'bg-cyan-100 text-cyan-800 border-cyan-200'
    case 'delivered': return 'bg-slate-100 text-slate-800 border-slate-200'
    case 'cancelled': return 'bg-rose-100 text-rose-800 border-rose-200'
    default: return 'bg-gray-100 text-gray-800 border-gray-200'
  }
}

function TMAContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const orderId = searchParams?.get('orderId') || null

  // Authentication
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [passcode, setPasscode] = useState('')
  const [loginError, setLoginError] = useState('')

  // Data
  const [order, setOrder] = useState<Order | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [businesses, setBusinesses] = useState<Business[]>([])
  const [deliveries, setDeliveries] = useState<Delivery[]>([])

  // Loading
  const [loadingOrder, setLoadingOrder] = useState(false)
  const [loadingOrders, setLoadingOrders] = useState(false)
  const [loadingBusinesses, setLoadingBusinesses] = useState(false)
  const [loadingDeliveries, setLoadingDeliveries] = useState(false)

  // Actions
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null)
  const [updatingDelivery, setUpdatingDelivery] = useState(false)
  const [updatingPayment, setUpdatingPayment] = useState(false)
  const [receiptZoom, setReceiptZoom] = useState<string | null>(null)

  // Interactive Stock State
  const [stockVal, setStockVal] = useState(-43)
  const [stockProduct, setStockProduct] = useState('Aros de cebolla')

  // Collapsible list status groups
  const [expandedStatuses, setExpandedStatuses] = useState<Record<string, boolean>>({
    pending: true,
    borrador: true,
    confirmed: true,
    preparing: true,
    ready: true,
    on_way: true
  })

  // Collapsible order cards list (holds orderIds that are expanded)
  const [expandedOrderCards, setExpandedOrderCards] = useState<Record<string, boolean>>({})

  // Telegram SDK Data
  const [tgUser, setTgUser] = useState<any>(null)

  // Init Authentication Check
  useEffect(() => {
    const auth = localStorage.getItem('adminAuth')
    if (auth === 'authenticated') {
      setIsAuthenticated(true)
    }

    // Init Telegram SDK
    if (typeof window !== 'undefined' && (window as any).Telegram?.WebApp) {
      const tg = (window as any).Telegram.WebApp
      tg.ready()
      tg.expand()
      setTgUser(tg.initDataUnsafe?.user || null)
    }
  }, [])

  // Login handler
  const handleLoginSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (passcode === 'admin123') {
      localStorage.setItem('adminAuth', 'authenticated')
      setIsAuthenticated(true)
      setLoginError('')
    } else {
      setLoginError('Contraseña incorrecta')
    }
  }

  // Load Businesses
  useEffect(() => {
    if (!isAuthenticated) return
    setLoadingBusinesses(true)
    getAllBusinesses()
      .then(setBusinesses)
      .catch(err => console.error('Error fetching businesses:', err))
      .finally(() => setLoadingBusinesses(false))
  }, [isAuthenticated])

  // Load Deliveries
  useEffect(() => {
    if (!isAuthenticated) return
    setLoadingDeliveries(true)
    getDeliveriesByStatus('activo')
      .then(setDeliveries)
      .catch(err => console.error('Error fetching deliveries:', err))
      .finally(() => setLoadingDeliveries(false))
  }, [isAuthenticated])

  // Individual Order Snapshot
  useEffect(() => {
    if (!isAuthenticated || !orderId) {
      setOrder(null)
      return
    }

    setLoadingOrder(true)
    const docRef = doc(db, 'orders', orderId)
    const unsubscribe = onSnapshot(
      docRef,
      (docSnap) => {
        if (docSnap.exists()) {
          setOrder({ id: docSnap.id, ...docSnap.data() } as Order)
        } else {
          setOrder(null)
        }
        setLoadingOrder(false)
      },
      (err) => {
        console.error('Error fetching order snapshot:', err)
        setLoadingOrder(false)
      }
    )

    return () => unsubscribe()
  }, [isAuthenticated, orderId])

  // Active Orders Snapshot (Dashboard List)
  useEffect(() => {
    if (!isAuthenticated || orderId) {
      setOrders([])
      return
    }

    setLoadingOrders(true)
    const ordersRef = collection(db, 'orders')
    const q = query(
      ordersRef,
      where('status', 'in', ['pending', 'borrador', 'confirmed', 'preparing', 'ready', 'on_way']),
      orderBy('createdAt', 'desc')
    )

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Order))
        setOrders(list)
        // Auto expand order cards initially
        const initialExp: Record<string, boolean> = {}
        list.forEach(o => {
          initialExp[o.id] = true // default expanded
        })
        setExpandedOrderCards(initialExp)
        setLoadingOrders(false)
      },
      (err) => {
        console.error('Error fetching active orders snapshot:', err)
        setLoadingOrders(false)
      }
    )

    return () => unsubscribe()
  }, [isAuthenticated, orderId])

  // Group active orders by status
  const groupedOrders = useMemo(() => {
    const buckets: Record<string, Order[]> = {
      borrador: [],
      pending: [],
      confirmed: [],
      preparing: [],
      ready: [],
      on_way: []
    }
    orders.forEach(o => {
      if (buckets[o.status]) {
        buckets[o.status].push(o)
      } else {
        buckets.pending.push(o)
      }
    })
    return buckets
  }, [orders])

  // Mapping business to single order
  const orderBusiness = useMemo(() => {
    if (!order || !businesses.length) return null
    return businesses.find(b => b.id === order.businessId) || null
  }, [order, businesses])

  // Mapping rider to single order
  const orderDelivery = useMemo(() => {
    if (!order?.delivery?.assignedDelivery || !deliveries.length) return null
    return deliveries.find(d => d.id === order.delivery.assignedDelivery) || null
  }, [order, deliveries])

  // Update order status function
  const handleUpdateStatus = async (targetOrderId: string, newStatus: Order['status']) => {
    try {
      setUpdatingStatus(newStatus)
      await updateOrderStatus(targetOrderId, newStatus)
    } catch (err) {
      console.error('Error actualizando estado:', err)
      alert('Error al actualizar el estado del pedido')
    } finally {
      setUpdatingStatus(null)
    }
  }

  // Assign Delivery Rider
  const handleAssignDelivery = async (targetOrderId: string, deliveryId: string) => {
    try {
      setUpdatingDelivery(true)
      await updateOrder(targetOrderId, {
        'delivery.assignedDelivery': deliveryId || null,
        'delivery.status': deliveryId ? 'assigned' : 'pending'
      } as any)
    } catch (err) {
      console.error('Error asignando delivery:', err)
      alert('Error al asignar el repartidor')
    } finally {
      setUpdatingDelivery(false)
    }
  }

  // Update payment status
  const handleUpdatePaymentStatus = async (targetOrderId: string, status: 'paid' | 'rejected' | 'validating' | 'pending') => {
    try {
      setUpdatingPayment(true)
      const ord = orders.find(o => o.id === targetOrderId) || order
      if (!ord) return
      const updatedPayment = {
        ...(ord.payment || {}),
        paymentStatus: status
      }
      await updateOrder(targetOrderId, { payment: updatedPayment } as any)
    } catch (err) {
      console.error('Error actualizando pago:', err)
      alert('Error al actualizar el estado de pago')
    } finally {
      setUpdatingPayment(false)
    }
  }

  // Handle printer ticket
  const handlePrintTicket = async (ord: Order) => {
    const biz = businesses.find(b => b.id === ord.businessId)
    try {
      await printOrder({
        order: ord as any,
        businessName: biz?.name || 'Fuddi Store',
        businessLogo: (biz as any)?.logoUrl || (biz as any)?.logo
      })
    } catch (err: any) {
      alert(err.message || 'Error al imprimir ticket')
    }
  }

  // Logout
  const handleLogout = () => {
    localStorage.removeItem('adminAuth')
    setIsAuthenticated(false)
  }

  // Stats Calculations
  const visitasCount = useMemo(() => {
    const names = new Set(orders.map(o => o.customer?.name).filter(Boolean))
    return Math.max(names.size, 20)
  }, [orders])

  const totalEarnings = useMemo(() => {
    return orders.reduce((sum, o) => sum + (o.total || 0), 0)
  }, [orders])

  const toggleStatusGroup = (statusKey: string) => {
    setExpandedStatuses(prev => ({
      ...prev,
      [statusKey]: !prev[statusKey]
    }))
  }

  const toggleOrderCard = (orderIdKey: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setExpandedOrderCards(prev => ({
      ...prev,
      [orderIdKey]: !prev[orderIdKey]
    }))
  }

  // 1. Password Access Screen
  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-6 bg-gray-50 text-gray-900 font-sans">
        <div className="w-full max-w-sm p-8 bg-white rounded-3xl border border-gray-100 shadow-xl">
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center shadow-md mb-4 text-red-600">
              <i className="bi bi-shield-lock-fill text-3xl"></i>
            </div>
            <h1 className="text-2xl font-black tracking-tight text-center text-red-600">Fuddi Admin</h1>
            <p className="text-[10px] text-gray-400 mt-2 text-center uppercase tracking-widest font-black">Acceso Seguro</p>
          </div>

          <form onSubmit={handleLoginSubmit} className="space-y-6">
            <div>
              <label className="block text-[10px] font-black text-gray-400 uppercase tracking-wider mb-2">
                Contraseña de Administrador
              </label>
              <input
                type="password"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                placeholder="Ingresa el código"
                className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500 font-bold"
                required
              />
            </div>

            {loginError && (
              <p className="text-xs font-bold text-red-600 text-center">{loginError}</p>
            )}

            <button
              type="submit"
              className="w-full py-4 bg-red-600 text-white font-black rounded-xl shadow-lg shadow-red-600/20 hover:bg-red-700 active:scale-[0.98] transition-all text-sm uppercase tracking-wider"
            >
              Iniciar Sesión
            </button>
          </form>
        </div>
      </div>
    )
  }

  // 2. Individual Order Details Screen (Style upgraded to Premium Theme)
  if (orderId) {
    if (loadingOrder) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600 mb-4"></div>
          <p className="text-sm font-bold text-gray-500">Cargando pedido...</p>
        </div>
      )
    }

    if (!order) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen p-6 bg-gray-50 text-center font-sans">
          <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center text-red-600 mb-4">
            <i className="bi bi-exclamation-triangle-fill text-3xl"></i>
          </div>
          <h2 className="text-xl font-bold text-gray-800">Pedido no encontrado</h2>
          <p className="text-xs text-gray-500 mt-2 max-w-xs leading-relaxed">
            El pedido con ID `{orderId}` no existe o fue eliminado de la base de datos.
          </p>
          <button
            onClick={() => router.push('/tma')}
            className="mt-6 px-6 py-3.5 bg-red-600 text-white font-black rounded-xl shadow-lg shadow-red-600/25 hover:bg-red-700 active:scale-[0.98] transition-all text-xs uppercase tracking-wider"
          >
            Ver todos los pedidos
          </button>
        </div>
      )
    }

    return (
      <div className="pb-20 bg-gray-50 min-h-screen text-gray-900 font-sans">
        {/* Premium Header */}
        <header className="sticky top-0 z-30 bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between shadow-sm">
          <button
            onClick={() => router.push('/tma')}
            className="w-10 h-10 flex items-center justify-center bg-gray-50 border border-gray-100 rounded-xl hover:bg-gray-100 text-gray-600 transition-colors"
          >
            <i className="bi bi-chevron-left text-lg"></i>
          </button>
          <div className="text-center">
            <h1 className="text-xs font-black tracking-tight uppercase text-gray-800">Pedido #{orderId.substring(0, 6)}</h1>
            <p className="text-[9px] text-gray-400 font-bold">{formatDate(order.createdAt)}</p>
          </div>
          <span className={`px-3 py-1 rounded-full text-[10px] font-black border uppercase tracking-wider ${getStatusColor(order.status)}`}>
            {getStatusText(order.status)}
          </span>
        </header>

        <div className="p-4 space-y-4 max-w-md mx-auto animate-fadeIn">
          {/* Card Tienda */}
          <div className="bg-white p-4 rounded-3xl shadow-sm border border-gray-100/80">
            <div className="flex items-center justify-between mb-3 pb-3 border-b border-gray-50">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center shadow-sm">
                  <i className="bi bi-shop text-xl"></i>
                </div>
                <div>
                  <h3 className="font-bold text-gray-800 text-sm">{orderBusiness?.name || 'Tienda no vinculada'}</h3>
                  <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">Restaurante / Negocio</p>
                </div>
              </div>
              {orderBusiness?.phone && (
                <div className="flex gap-2">
                  <a
                    href={`tel:${orderBusiness.phone}`}
                    className="w-8 h-8 rounded-lg bg-gray-50 border border-gray-100 text-gray-600 flex items-center justify-center hover:bg-gray-100"
                  >
                    <i className="bi bi-telephone-fill text-xs"></i>
                  </a>
                  <button
                    onClick={() => {
                      if (order && orderBusiness) {
                        sendOrderToStore(order, orderBusiness)
                      }
                    }}
                    className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center hover:bg-emerald-100"
                  >
                    <i className="bi bi-whatsapp text-sm"></i>
                  </button>
                </div>
              )}
            </div>
            {orderBusiness?.address && (
              <p className="text-xs text-gray-500 flex items-start gap-1.5 leading-relaxed">
                <i className="bi bi-geo-alt text-gray-400 mt-0.5"></i>
                <span>{orderBusiness.address}</span>
              </p>
            )}
          </div>

          {/* Card Cliente */}
          <div className="bg-white p-4 rounded-3xl shadow-sm border border-gray-100/80 space-y-3">
            <div className="flex items-center justify-between pb-3 border-b border-gray-50">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center shadow-sm">
                  <i className="bi bi-person text-xl"></i>
                </div>
                <div>
                  <h3 className="font-bold text-gray-800 text-sm">{order.customer?.name || 'Cliente'}</h3>
                  <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">Datos de Envío</p>
                </div>
              </div>
              {order.customer?.phone && (
                <div className="flex gap-2">
                  <a
                    href={`tel:${order.customer.phone}`}
                    className="w-8 h-8 rounded-lg bg-gray-50 border border-gray-100 text-gray-600 flex items-center justify-center hover:bg-gray-100"
                  >
                    <i className="bi bi-telephone-fill text-xs"></i>
                  </a>
                  <button
                    onClick={() => {
                      if (order) {
                        sendWhatsAppToCustomer(order)
                      }
                    }}
                    className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center hover:bg-emerald-100"
                  >
                    <i className="bi bi-whatsapp text-sm"></i>
                  </button>
                </div>
              )}
            </div>

            <div className="space-y-2.5 text-xs text-gray-600">
              <div className="flex items-start gap-2">
                <span className="font-bold text-gray-400 min-w-[70px]">Entrega:</span>
                <span className="font-black text-[9px] uppercase tracking-wider text-slate-700 bg-gray-100 px-2 py-0.5 rounded">
                  {order.delivery?.type === 'pickup' ? 'Retiro en Local' : 'Envío a Domicilio'}
                </span>
              </div>

              {order.delivery?.type === 'delivery' && (
                <>
                  <div className="flex items-start gap-2">
                    <span className="font-bold text-gray-400 min-w-[70px]">Dirección:</span>
                    <span className="text-gray-800 leading-relaxed">{order.delivery?.references || 'Sin dirección ingresada'}</span>
                  </div>
                  {order.delivery?.sector && (
                    <div className="flex items-start gap-2">
                      <span className="font-bold text-gray-400 min-w-[70px]">Sector/Zona:</span>
                      <span className="text-gray-800 font-bold">{order.delivery.sector}</span>
                    </div>
                  )}
                  {order.delivery?.latlong && (
                    <div className="flex items-start gap-2">
                      <span className="font-bold text-gray-400 min-w-[70px]">Mapa GPS:</span>
                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${order.delivery.latlong}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-600 font-bold hover:underline inline-flex items-center gap-1"
                      >
                        <i className="bi bi-map-fill"></i> Ver en Google Maps
                      </a>
                    </div>
                  )}
                  {order.delivery?.photo && (
                    <div className="flex flex-col gap-1.5 pt-1.5">
                      <span className="font-bold text-gray-400">Foto Fachada:</span>
                      <img
                        src={order.delivery.photo}
                        alt="Fachada"
                        className="w-full max-h-32 object-cover rounded-2xl border border-gray-100 cursor-pointer hover:opacity-90 transition-opacity"
                        onClick={() => setReceiptZoom(order.delivery.photo || null)}
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Card Items Pedido */}
          <div className="bg-white p-4 rounded-3xl shadow-sm border border-gray-100/80 space-y-3">
            <h3 className="font-bold text-gray-800 text-sm flex items-center gap-2 pb-2 border-b border-gray-50">
              <i className="bi bi-bag-check-fill text-red-500"></i> Productos
            </h3>
            <div className="divide-y divide-gray-50">
              {order.items?.map((item, idx) => (
                <div key={idx} className="py-2.5 flex items-start justify-between text-xs gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-black text-red-600 bg-red-50 px-1.5 py-0.5 rounded text-[10px] min-w-[20px] text-center">
                        {item.quantity}x
                      </span>
                      <span className="font-bold text-gray-800">{item.product?.name || item.name}</span>
                    </div>
                    {item.variant && (
                      <p className="text-[10px] text-gray-400 ml-7 mt-0.5">Variante: {item.variant}</p>
                    )}
                    {item.selectedOptions && item.selectedOptions.length > 0 && (
                      <div className="ml-7 mt-1 text-[10px] text-gray-500 space-y-0.5 bg-gray-50 p-1.5 rounded-lg">
                        {item.selectedOptions.map((optGroup, oIdx) => (
                          <div key={oIdx}>
                            <span className="font-semibold text-gray-600">{optGroup.groupName}: </span>
                            <span>{optGroup.selections.map(s => s.name).join(', ')}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <span className="font-bold text-gray-800">${(item.subtotal || 0).toFixed(2)}</span>
                </div>
              ))}
            </div>

            {/* Totales */}
            <div className="border-t border-gray-100 pt-3 space-y-2 text-xs">
              <div className="flex justify-between text-gray-500">
                <span>Subtotal:</span>
                <span>${(order.subtotal || order.total - (order.delivery?.deliveryCost || 0)).toFixed(2)}</span>
              </div>
              {order.delivery?.deliveryCost !== undefined && (
                <div className="flex justify-between text-gray-500">
                  <span>Costo Envío:</span>
                  <span>${order.delivery.deliveryCost.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm font-black text-gray-800 border-t border-gray-100 pt-2">
                <span>Total:</span>
                <span className="text-red-600 font-black">${order.total.toFixed(2)}</span>
              </div>
            </div>

            {order.notas && (
              <div className="bg-amber-50 border border-amber-100/50 p-3 rounded-2xl text-xs text-amber-900 mt-2">
                <span className="font-bold block mb-1">Notas del pedido:</span>
                <p className="italic">"{order.notas}"</p>
                {order.notaImageUrl && (
                  <img
                    src={order.notaImageUrl}
                    alt="Nota adjunta"
                    className="w-full max-h-32 object-cover rounded-xl mt-2 border cursor-pointer"
                    onClick={() => setReceiptZoom(order.notaImageUrl || null)}
                  />
                )}
              </div>
            )}
          </div>

          {/* Card Asignar Repartidor */}
          {order.delivery?.type === 'delivery' && (
            <div className="bg-white p-4 rounded-3xl shadow-sm border border-gray-100/80 space-y-3">
              <h3 className="font-bold text-gray-800 text-sm flex items-center gap-2 pb-2 border-b border-gray-50">
                <i className="bi bi-scooter text-red-500"></i> Repartidor Asignado
              </h3>

              {updatingDelivery ? (
                <div className="py-4 text-center text-xs text-gray-400">
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-red-600 mx-auto mb-2"></div>
                  Actualizando repartidor...
                </div>
              ) : (
                <div className="space-y-3">
                  <select
                    value={order.delivery?.assignedDelivery || ''}
                    onChange={(e) => handleAssignDelivery(order.id, e.target.value)}
                    className="w-full px-3 py-2.5 bg-gray-50 border border-gray-100 rounded-xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-red-500 text-gray-700 font-bold"
                  >
                    <option value="">-- Sin Asignar (Repartidor Libre) --</option>
                    {deliveries.map(d => (
                      <option key={d.id} value={d.id}>
                        {d.nombres} ({d.celular})
                      </option>
                    ))}
                  </select>

                  {orderDelivery && (
                    <div className="bg-gray-50 p-3 rounded-2xl flex items-center justify-between text-xs">
                      <div>
                        <p className="font-bold text-gray-800">{orderDelivery.nombres}</p>
                        <p className="text-[10px] text-gray-400 font-bold">Cel: {orderDelivery.celular}</p>
                      </div>
                      <div className="flex gap-2">
                        <a
                          href={`tel:${orderDelivery.celular}`}
                          className="w-7 h-7 rounded-lg bg-white shadow-sm border border-gray-200 text-gray-600 flex items-center justify-center hover:bg-gray-100"
                        >
                          <i className="bi bi-telephone-fill text-[10px]"></i>
                        </a>
                        <button
                          onClick={() => {
                            if (order && orderBusiness) {
                              sendWhatsAppToDelivery(order, deliveries, orderBusiness)
                            }
                          }}
                          className="w-7 h-7 rounded-lg bg-white shadow-sm border border-gray-200 text-emerald-600 flex items-center justify-center hover:bg-gray-100"
                        >
                          <i className="bi bi-whatsapp text-sm"></i>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Card Gestión de Pago */}
          <div className="bg-white p-4 rounded-3xl shadow-sm border border-gray-100/80 space-y-3">
            <h3 className="font-bold text-gray-800 text-sm flex items-center gap-2 pb-2 border-b border-gray-50">
              <i className="bi bi-credit-card-fill text-red-500"></i> Estado de Pago
            </h3>

            <div className="flex justify-between items-center bg-gray-50 p-3 rounded-2xl text-xs">
              <div>
                <span className="text-gray-400 font-bold">Método: </span>
                <span className="font-black uppercase tracking-wider text-gray-700">
                  {order.payment?.method === 'cash' ? 'Efectivo' : order.payment?.method === 'transfer' ? 'Transferencia' : 'Mixto'}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-gray-400 font-bold">Pago: </span>
                <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase border ${
                  order.payment?.paymentStatus === 'paid' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' :
                  order.payment?.paymentStatus === 'validating' ? 'bg-amber-50 text-amber-700 border-amber-100' :
                  order.payment?.paymentStatus === 'rejected' ? 'bg-rose-50 text-rose-700 border-rose-100' :
                  'bg-gray-100 text-gray-700 border-gray-200'
                }`}>
                  {order.payment?.paymentStatus === 'paid' ? 'Aprobado' :
                   order.payment?.paymentStatus === 'validating' ? 'Validando' :
                   order.payment?.paymentStatus === 'rejected' ? 'Rechazado' : 'Pendiente'}
                </span>
              </div>
            </div>

            {order.payment?.receiptImageUrl && (
              <div className="space-y-2 pt-2">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Comprobante de Transferencia:</p>
                <img
                  src={order.payment.receiptImageUrl}
                  alt="Comprobante"
                  className="w-full max-h-48 object-cover rounded-2xl border border-gray-100 cursor-pointer hover:opacity-90 shadow-sm"
                  onClick={() => setReceiptZoom(order.payment.receiptImageUrl || null)}
                />
              </div>
            )}

            {updatingPayment ? (
              <div className="py-2 text-center text-xs text-gray-400">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-red-600 mx-auto mb-2"></div>
                Actualizando pago...
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  onClick={() => handleUpdatePaymentStatus(order.id, 'paid')}
                  disabled={order.payment?.paymentStatus === 'paid'}
                  className="py-3 px-3 bg-emerald-600 text-white font-black rounded-xl text-xs hover:bg-emerald-700 active:scale-[0.98] transition-all disabled:opacity-50 disabled:pointer-events-none uppercase tracking-wider"
                >
                  Aprobar Pago
                </button>
                <button
                  onClick={() => handleUpdatePaymentStatus(order.id, 'rejected')}
                  disabled={order.payment?.paymentStatus === 'rejected'}
                  className="py-3 px-3 bg-red-600 text-white font-black rounded-xl text-xs hover:bg-red-700 active:scale-[0.98] transition-all disabled:opacity-50 disabled:pointer-events-none uppercase tracking-wider"
                >
                  Rechazar Pago
                </button>
              </div>
            )}
          </div>

          {/* Card Gestión de Estado de Orden */}
          <div className="bg-slate-900 text-white p-5 rounded-3xl shadow-lg shadow-slate-950/20 space-y-4">
            <h3 className="font-bold text-sm flex items-center gap-2 pb-2 border-b border-slate-800">
              <i className="bi bi-gear-fill text-red-500"></i> Acciones del Pedido
            </h3>

            {updatingStatus ? (
              <div className="py-4 text-center text-xs text-slate-400">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-red-500 mx-auto mb-2"></div>
                Actualizando estado a: {getStatusText(updatingStatus)}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {['pending', 'borrador'].includes(order.status) && (
                  <button
                    onClick={() => handleUpdateStatus(order.id, 'confirmed')}
                    className="w-full py-3.5 bg-red-600 hover:bg-red-700 text-white font-black rounded-xl text-xs tracking-wider shadow-lg shadow-red-900/35 active:scale-[0.98] transition-all uppercase"
                  >
                    Confirmar / Aceptar Pedido
                  </button>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => handleUpdateStatus(order.id, 'preparing')}
                    disabled={order.status === 'preparing'}
                    className="py-3 px-2 bg-slate-800 hover:bg-slate-700 disabled:bg-purple-900/60 disabled:text-purple-200 border border-slate-700 disabled:border-transparent rounded-xl text-xs font-bold transition-all"
                  >
                    👨‍🍳 Preparando
                  </button>
                  <button
                    onClick={() => handleUpdateStatus(order.id, 'ready')}
                    disabled={order.status === 'ready'}
                    className="py-3 px-2 bg-slate-800 hover:bg-slate-700 disabled:bg-emerald-900/60 disabled:text-emerald-200 border border-slate-700 disabled:border-transparent rounded-xl text-xs font-bold transition-all"
                  >
                    📦 Listo
                  </button>
                  <button
                    onClick={() => handleUpdateStatus(order.id, 'on_way')}
                    disabled={order.status === 'on_way'}
                    className="py-3 px-2 bg-slate-800 hover:bg-slate-700 disabled:bg-indigo-900/60 disabled:text-indigo-200 border border-slate-700 disabled:border-transparent rounded-xl text-xs font-bold transition-all"
                  >
                    🛵 En camino
                  </button>
                  <button
                    onClick={() => handleUpdateStatus(order.id, 'delivered')}
                    disabled={order.status === 'delivered'}
                    className="py-3 px-2 bg-slate-800 hover:bg-slate-700 disabled:bg-slate-800/80 disabled:text-slate-500 border border-slate-700 disabled:border-transparent rounded-xl text-xs font-bold transition-all"
                  >
                    🏁 Entregado
                  </button>
                </div>

                {order.status !== 'cancelled' && (
                  <button
                    onClick={() => {
                      if (confirm('¿Estás seguro de cancelar/descartar este pedido?')) {
                        handleUpdateStatus(order.id, 'cancelled')
                      }
                    }}
                    className="w-full py-3 bg-red-950/40 hover:bg-red-950/60 text-red-300 font-bold border border-red-900/60 rounded-xl text-xs tracking-wider active:scale-[0.98] transition-all mt-1 uppercase"
                  >
                    ❌ Cancelar / Descartar Pedido
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Zoom Receipt Modal */}
        {receiptZoom && (
          <div
            className="fixed inset-0 z-50 bg-black/95 backdrop-blur flex items-center justify-center p-4"
            onClick={() => setReceiptZoom(null)}
          >
            <div className="absolute top-4 right-4 text-white text-3xl cursor-pointer">
              <i className="bi bi-x-lg"></i>
            </div>
            <img
              src={receiptZoom}
              alt="Zoomed"
              className="max-w-full max-h-[85vh] object-contain rounded-2xl"
            />
          </div>
        )}
      </div>
    )
  }

  // 3. Main Dashboard List (Upgraded to Reference Image Aesthetic)
  return (
    <div className="bg-gray-50 min-h-screen text-gray-900 font-sans pb-20 relative">
      {/* Reference Image Header Layout */}
      <header className="sticky top-0 z-30 bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-2">
          <button className="w-8 h-8 flex items-center justify-center text-gray-500 rounded-lg hover:bg-gray-50">
            <i className="bi bi-list text-xl"></i>
          </button>
          <span className="text-2xl font-black tracking-tighter text-red-600 font-sans">Fuddi</span>
        </div>

        <div className="flex items-center gap-2">
          {/* Status icon/clock indicator inside green box */}
          <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center border border-emerald-100" title="En línea">
            <i className="bi bi-clock-fill text-base"></i>
          </div>

          <div className="px-3 py-2 bg-gray-50 border border-gray-100 rounded-xl text-xs font-bold text-gray-600">
            30m
          </div>

          <button className="w-10 h-10 bg-gray-50 border border-gray-100 rounded-xl flex items-center justify-center text-gray-500 hover:bg-gray-100">
            <i className="bi bi-bell text-base"></i>
          </button>

          {/* User Profile dropdown */}
          <div className="flex items-center gap-1.5 p-1 bg-red-50 rounded-full border border-red-100 pr-3 shadow-sm select-none">
            <div className="w-8 h-8 rounded-full bg-red-600 text-white flex items-center justify-center font-bold text-xs uppercase shadow-sm">
              {tgUser?.first_name ? tgUser.first_name.substring(0, 1) : 'A'}
            </div>
            <span className="text-[10px] font-black text-red-800 tracking-wide uppercase max-w-[55px] truncate">
              {tgUser?.first_name ? tgUser.first_name.split(' ')[0] : 'Admin'}
            </span>
            <i className="bi bi-chevron-down text-[10px] text-red-700 ml-0.5"></i>
          </div>

          <button 
            onClick={handleLogout}
            className="p-1 text-red-700 hover:text-red-900 hover:bg-red-50 rounded-lg transition-colors"
            title="Cerrar sesión"
          >
            <i className="bi bi-box-arrow-right text-base"></i>
          </button>
        </div>
      </header>

      <div className="p-4 max-w-md mx-auto space-y-4 animate-fadeIn">
        {/* Banner with user info if logged via Telegram */}
        {tgUser && (
          <div className="bg-gradient-to-r from-red-600 to-rose-600 text-white p-4 rounded-3xl shadow-md shadow-red-600/10 flex items-center gap-3">
            <div className="w-10 h-10 bg-white/10 rounded-full flex items-center justify-center text-lg">
              <i className="bi bi-telegram"></i>
            </div>
            <div>
              <p className="text-[9px] font-bold text-red-100 uppercase tracking-widest leading-none">Fuddi Bot Administrador</p>
              <h2 className="text-sm font-bold mt-1">¡Hola, {tgUser.first_name || 'Admin'}!</h2>
            </div>
          </div>
        )}

        {/* Stats Card - matching reference image */}
        <div className="bg-white rounded-3xl border border-gray-100 p-4 shadow-sm">
          <div className="grid grid-cols-3 gap-2 divide-x divide-gray-100 text-center">
            
            {/* Column 1: VISITAS */}
            <div className="flex flex-col items-center justify-between">
              <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">Visitas</span>
              <div className="flex items-center gap-1.5 mt-1">
                <i className="bi bi-people-fill text-gray-400 text-xs"></i>
                <span className="text-xl font-black text-gray-800 leading-none">{visitasCount}</span>
              </div>
            </div>

            {/* Column 2: STOCK (Interactive counter) */}
            <div className="flex flex-col items-center justify-between px-1">
              <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">Stock</span>
              <div className="flex items-center justify-center gap-1 mt-1">
                <button 
                  onClick={() => setStockVal(prev => prev - 1)}
                  className="w-5 h-5 bg-gray-50 border border-gray-100 text-gray-500 rounded-full flex items-center justify-center hover:bg-gray-100 active:scale-90 transition-all"
                >
                  <i className="bi bi-chevron-left text-[8px]"></i>
                </button>
                <span className="text-base font-black text-red-600 leading-none">{stockVal}</span>
                <button 
                  onClick={() => setStockVal(prev => prev + 1)}
                  className="w-5 h-5 bg-gray-50 border border-gray-100 text-gray-500 rounded-full flex items-center justify-center hover:bg-gray-100 active:scale-90 transition-all"
                >
                  <i className="bi bi-chevron-right text-[8px]"></i>
                </button>
              </div>
              <span className="text-[8px] text-gray-400 font-bold block leading-none truncate max-w-[80px] mt-0.5">{stockProduct}</span>
            </div>

            {/* Column 3: GANANCIAS */}
            <div className="flex flex-col items-center justify-between">
              <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">Ventas Activas</span>
              <div className="flex flex-col items-center justify-center mt-1">
                <span className="text-lg font-black text-emerald-600 leading-none">${totalEarnings.toFixed(2)}</span>
                <span className="text-[8px] text-gray-400 font-bold leading-none mt-1">PÚBLICO: ${(totalEarnings * 1.15).toFixed(2)}</span>
              </div>
            </div>

          </div>
        </div>

        {/* Orders list by status grouping - matching reference image */}
        {loadingOrders ? (
          <div className="py-12 text-center text-gray-500 text-xs">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-600 mx-auto mb-3"></div>
            Cargando pedidos...
          </div>
        ) : orders.length === 0 ? (
          <div className="py-12 bg-white rounded-3xl border border-gray-100 text-center p-6 shadow-sm">
            <div className="w-12 h-12 bg-gray-50 text-gray-400 rounded-full flex items-center justify-center mx-auto mb-3">
              <i className="bi bi-inbox text-xl"></i>
            </div>
            <p className="font-bold text-gray-800 text-sm">No hay pedidos activos</p>
            <p className="text-xs text-gray-400 mt-1 max-w-[200px] mx-auto">
              Todos los pedidos han sido gestionados, entregados o cancelados.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {Object.entries(groupedOrders).map(([statusKey, list]) => {
              if (list.length === 0) return null
              
              const isExpanded = expandedStatuses[statusKey] !== false
              let dotColor = 'bg-gray-400'
              let statusTitle = getStatusText(statusKey)

              if (statusKey === 'borrador') dotColor = 'bg-orange-500'
              else if (statusKey === 'pending') dotColor = 'bg-amber-500'
              else if (statusKey === 'confirmed') dotColor = 'bg-blue-500'
              else if (statusKey === 'preparing') dotColor = 'bg-purple-500'
              else if (statusKey === 'ready') dotColor = 'bg-emerald-500'
              else if (statusKey === 'on_way') dotColor = 'bg-cyan-500'

              return (
                <div key={statusKey} className="space-y-2.5">
                  {/* Collapsible Header Group */}
                  <div 
                    onClick={() => toggleStatusGroup(statusKey)}
                    className="flex items-center justify-between py-2 px-1 cursor-pointer select-none"
                  >
                    <div className="flex items-center gap-2">
                      <span className={`w-3 h-3 rounded-full ${dotColor}`}></span>
                      <span className="font-bold text-gray-800 text-base">{statusTitle}</span>
                      <span className="bg-gray-100 text-gray-600 text-xs px-2.5 py-0.5 rounded-full font-black">
                        {list.length}
                      </span>
                    </div>
                    <i className={`bi ${isExpanded ? 'bi-chevron-up' : 'bi-chevron-down'} text-gray-400 text-xs`}></i>
                  </div>

                  {/* Grouped orders items */}
                  {isExpanded && (
                    <div className="space-y-3">
                      {list.map((ord) => {
                        const biz = businesses.find(b => b.id === ord.businessId)
                        const itemsCount = ord.items?.reduce((acc, it) => acc + (it.quantity || 1), 0) || 0
                        const isCardExpanded = expandedOrderCards[ord.id] !== false
                        
                        // Find assigned delivery name
                        const assignedRiderObj = deliveries.find(d => d.id === ord.delivery?.assignedDelivery)
                        const riderName = assignedRiderObj?.nombres || null

                        return (
                          <div 
                            key={ord.id}
                            className="bg-white border border-pink-100/80 rounded-3xl overflow-hidden shadow-sm hover:shadow-md transition-shadow relative"
                          >
                            {/* Card Header section - grey header styling */}
                            <div className="bg-gray-50/70 border-b border-gray-100 p-4">
                              <div className="flex justify-between items-start">
                                <div>
                                  <h4 className="font-bold text-gray-800 text-base">{ord.customer?.name || 'Cliente sin nombre'}</h4>
                                  
                                  <div className="flex items-center gap-2 mt-1.5 text-gray-500">
                                    <button 
                                      onClick={(e) => toggleOrderCard(ord.id, e)}
                                      className="flex items-center gap-1 text-xs hover:text-red-600 transition-colors font-bold"
                                    >
                                      <i className={`bi ${isCardExpanded ? 'bi-chevron-up' : 'bi-chevron-down'} text-[10px]`}></i>
                                      <i className="bi bi-clock text-[11px] ml-1"></i>
                                      <span>{formatTimeOnly(ord.createdAt)}</span>
                                    </button>
                                  </div>
                                </div>

                                <div className="flex flex-col items-end gap-1.5">
                                  {/* Three dot button and Pedido Listo link */}
                                  <div className="flex items-center gap-2">
                                    {['confirmed', 'preparing'].includes(ord.status) && (
                                      <button 
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          handleUpdateStatus(ord.id, 'ready')
                                        }}
                                        className="text-xs font-black text-indigo-600 hover:text-indigo-800 uppercase tracking-wide cursor-pointer"
                                      >
                                        ¿Pedido listo?
                                      </button>
                                    )}
                                    <button 
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        router.push(`/tma?orderId=${ord.id}`)
                                      }}
                                      className="text-gray-400 hover:text-gray-600 w-6 h-6 flex items-center justify-center rounded-lg hover:bg-gray-100"
                                    >
                                      <i className="bi bi-three-dots-vertical"></i>
                                    </button>
                                  </div>

                                  {/* Business identifier tag */}
                                  <span className="text-[8px] font-black tracking-wider uppercase text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded leading-none">
                                    {biz?.name || 'Tienda'}
                                  </span>
                                </div>
                              </div>

                              {/* Repartidor Pill if assigned */}
                              {riderName && (
                                <div className="mt-2.5">
                                  <span className="bg-emerald-50 text-emerald-700 text-[10px] px-2.5 py-0.5 rounded-full border border-emerald-100/60 font-bold inline-flex items-center gap-1.5">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                                    {riderName}
                                  </span>
                                </div>
                              )}
                            </div>

                            {/* Card Body - Expandable details */}
                            {isCardExpanded && (
                              <div className="p-4 space-y-3.5">
                                
                                {/* Dirección row */}
                                <div className="flex items-start justify-between text-xs text-gray-600 gap-2 border-b border-gray-50 pb-2">
                                  <div className="flex items-start gap-1.5">
                                    <i className="bi bi-geo-alt-fill text-gray-400 mt-0.5"></i>
                                    <span className="leading-relaxed">
                                      {ord.delivery?.type === 'pickup' 
                                        ? 'Retiro en local' 
                                        : (ord.delivery?.references || 'Sin dirección ingresada')}
                                    </span>
                                  </div>
                                  <i className="bi bi-chevron-down text-gray-400 mt-1 text-[10px]"></i>
                                </div>

                                {/* Items list section */}
                                <div className="space-y-2">
                                  {ord.items?.map((item, idx) => (
                                    <div key={idx} className="flex justify-between items-center text-xs">
                                      <div className="flex items-center gap-2">
                                        <span className="font-black text-gray-700">{item.quantity}x</span>
                                        <span className="text-gray-600">{item.product?.name || item.name}</span>
                                      </div>
                                      <span className="font-bold text-gray-500">${(item.subtotal || 0).toFixed(2)}</span>
                                    </div>
                                  ))}
                                </div>

                                {/* Payment details container - pink rounded box */}
                                <div className="bg-rose-50/70 border border-rose-100/60 rounded-2xl p-3 flex justify-between items-center">
                                  <div className="flex items-center gap-2.5">
                                    <div className="w-8 h-8 bg-red-100/60 text-red-600 rounded-xl flex items-center justify-center">
                                      <i className="bi bi-bank text-sm"></i>
                                    </div>
                                    <div className="flex flex-col">
                                      <div className="flex items-center gap-1.5">
                                        <span className="text-sm font-black text-gray-800">${ord.total.toFixed(2)}</span>
                                        <button 
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            router.push(`/tma?orderId=${ord.id}`)
                                          }}
                                          className="text-gray-400 hover:text-red-600 flex items-center"
                                        >
                                          <i className="bi bi-pencil-square text-[10px]"></i>
                                        </button>
                                      </div>
                                      <span className="text-[8px] text-gray-400 font-black uppercase tracking-wider">
                                        PÚBLICO: ${(ord.total * 1.15).toFixed(2)}
                                      </span>
                                    </div>
                                  </div>

                                  {/* Print Action Icon */}
                                  <button 
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      handlePrintTicket(ord)
                                    }}
                                    className="w-8 h-8 rounded-xl bg-white border border-gray-100 shadow-sm text-gray-400 hover:text-gray-700 flex items-center justify-center transition-colors active:scale-95"
                                    title="Imprimir Ticket"
                                  >
                                    <i className="bi bi-printer text-base"></i>
                                  </button>
                                </div>

                                {/* Footer actions buttons */}
                                <div className="grid grid-cols-2 gap-2 pt-1 border-t border-gray-50">
                                  <button 
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      sendWhatsAppToCustomer(ord)
                                    }}
                                    className="bg-emerald-50 text-emerald-700 border border-emerald-100/80 font-black py-2.5 rounded-xl flex items-center justify-center gap-2 text-xs hover:bg-emerald-100 transition-colors active:scale-98"
                                  >
                                    <i className="bi bi-whatsapp"></i>
                                    Enviar comprobante
                                  </button>
                                  <button 
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      router.push(`/tma?orderId=${ord.id}`)
                                    }}
                                    className="bg-blue-50 text-blue-700 border border-blue-100/80 font-black py-2.5 rounded-xl flex items-center justify-center gap-2 text-xs hover:bg-blue-100 transition-colors active:scale-98"
                                  >
                                    <i className="bi bi-pencil"></i>
                                    Editar
                                  </button>
                                </div>

                              </div>
                            )}

                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Floating Action Button (FAB) for quick adding new orders - matching reference style */}
      <button 
        onClick={() => router.push('/admin/dashboard')}
        className="fixed bottom-6 right-6 w-14 h-14 bg-red-600 hover:bg-red-700 text-white rounded-full flex items-center justify-center shadow-xl shadow-red-600/35 transition-all active:scale-95 hover:rotate-90 z-40"
        title="Panel de Administración"
      >
        <i className="bi bi-plus-lg text-2xl"></i>
      </button>

    </div>
  )
}

export default function TMAPage() {
  return (
    <Suspense fallback={
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600 mb-4"></div>
        <p className="text-sm font-bold text-gray-500">Cargando...</p>
      </div>
    }>
      <TMAContent />
    </Suspense>
  )
}
