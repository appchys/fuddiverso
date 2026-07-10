'use client'

import { useState, useEffect, useMemo, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { db } from '@/lib/firebase'
import { collection, query, orderBy, onSnapshot, where, doc, updateDoc, Timestamp } from 'firebase/firestore'
import { getAllBusinesses, updateOrderStatus, updateOrder, getDeliveriesByStatus } from '@/lib/database'
import { Order, Business, Delivery } from '@/types'
import { sendWhatsAppToDelivery, sendWhatsAppToCustomer, sendOrderToStore } from '@/components/WhatsAppUtils'

// Helper para parsear fechas de Firestore de forma segura
const toSafeDate = (val: any): Date => {
  if (!val) return new Date()
  if (val instanceof Timestamp) return val.toDate()
  if (typeof val.toDate === 'function') return val.toDate()
  if (val.seconds) return new Date(val.seconds * 1000)
  if (typeof val === 'string') return new Date(val)
  if (val instanceof Date) return val
  return new Date()
}

// Formatear fecha
const formatDate = (dateVal: any) => {
  const d = toSafeDate(dateVal)
  return d.toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' + 
         d.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' })
}

// Helpers para etiquetas de estado
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
    case 'on_way': return 'bg-indigo-100 text-indigo-800 border-indigo-200'
    case 'delivered': return 'bg-slate-100 text-slate-800 border-slate-200'
    case 'cancelled': return 'bg-rose-100 text-rose-800 border-rose-200'
    default: return 'bg-gray-100 text-gray-800 border-gray-200'
  }
}

// Helper para enlaces de WhatsApp
const getWhatsAppLink = (phone?: string, text?: string) => {
  if (!phone) return ''
  let clean = phone.replace(/[^\d]/g, '')
  if (clean.startsWith('0')) {
    clean = '593' + clean.slice(1)
  } else if (!clean.startsWith('593')) {
    clean = '593' + clean
  }
  const textParam = text ? `?text=${encodeURIComponent(text)}` : ''
  return `https://wa.me/${clean}${textParam}`
}

function TMAContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const orderId = searchParams?.get('orderId') || null

  // Autenticación
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [passcode, setPasscode] = useState('')
  const [loginError, setLoginError] = useState('')

  // Datos
  const [order, setOrder] = useState<Order | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [businesses, setBusinesses] = useState<Business[]>([])
  const [deliveries, setDeliveries] = useState<Delivery[]>([])

  // Carga
  const [loadingOrder, setLoadingOrder] = useState(false)
  const [loadingOrders, setLoadingOrders] = useState(false)
  const [loadingBusinesses, setLoadingBusinesses] = useState(false)
  const [loadingDeliveries, setLoadingDeliveries] = useState(false)

  // Acciones
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null)
  const [updatingDelivery, setUpdatingDelivery] = useState(false)
  const [updatingPayment, setUpdatingPayment] = useState(false)
  const [receiptZoom, setReceiptZoom] = useState<string | null>(null)

  // Datos del SDK de Telegram
  const [tgUser, setTgUser] = useState<any>(null)

  // Inicialización de autenticación
  useEffect(() => {
    const auth = localStorage.getItem('adminAuth')
    if (auth === 'authenticated') {
      setIsAuthenticated(true)
    }

    // Inicializar Telegram SDK
    if (typeof window !== 'undefined' && (window as any).Telegram?.WebApp) {
      const tg = (window as any).Telegram.WebApp
      tg.ready()
      tg.expand()
      setTgUser(tg.initDataUnsafe?.user || null)
    }
  }, [])

  // Guardar autenticación
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

  // Cargar Negocios
  useEffect(() => {
    if (!isAuthenticated) return
    setLoadingBusinesses(true)
    getAllBusinesses()
      .then(setBusinesses)
      .catch(err => console.error('Error fetching businesses:', err))
      .finally(() => setLoadingBusinesses(false))
  }, [isAuthenticated])

  // Cargar Deliveries
  useEffect(() => {
    if (!isAuthenticated) return
    setLoadingDeliveries(true)
    getDeliveriesByStatus('activo')
      .then(setDeliveries)
      .catch(err => console.error('Error fetching deliveries:', err))
      .finally(() => setLoadingDeliveries(false))
  }, [isAuthenticated])

  // Suscribirse a orden individual
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

  // Suscribirse a órdenes activas (Lista)
  useEffect(() => {
    if (!isAuthenticated || orderId) {
      setOrders([])
      return
    }

    setLoadingOrders(true)
    const ordersRef = collection(db, 'orders')
    // Cargar órdenes en estados activos (no entregados ni cancelados viejos)
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
        setLoadingOrders(false)
      },
      (err) => {
        console.error('Error fetching active orders snapshot:', err)
        setLoadingOrders(false)
      }
    )

    return () => unsubscribe()
  }, [isAuthenticated, orderId])

  // Mapear negocio a su objeto
  const orderBusiness = useMemo(() => {
    if (!order || !businesses.length) return null
    return businesses.find(b => b.id === order.businessId) || null
  }, [order, businesses])

  // Mapear repartidor a su objeto
  const orderDelivery = useMemo(() => {
    if (!order?.delivery?.assignedDelivery || !deliveries.length) return null
    return deliveries.find(d => d.id === order.delivery.assignedDelivery) || null
  }, [order, deliveries])

  // Cambiar el estado del pedido
  const handleUpdateStatus = async (newStatus: Order['status']) => {
    if (!orderId || !order) return
    try {
      setUpdatingStatus(newStatus)
      await updateOrderStatus(orderId, newStatus)
    } catch (err) {
      console.error('Error actualizando estado:', err)
      alert('Error al actualizar el estado del pedido')
    } finally {
      setUpdatingStatus(null)
    }
  }

  // Asignar Repartidor
  const handleAssignDelivery = async (deliveryId: string) => {
    if (!orderId) return
    try {
      setUpdatingDelivery(true)
      await updateOrder(orderId, {
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

  // Actualizar Pago
  const handleUpdatePaymentStatus = async (status: 'paid' | 'rejected' | 'validating' | 'pending') => {
    if (!orderId || !order) return
    try {
      setUpdatingPayment(true)
      const updatedPayment = {
        ...(order.payment || {}),
        paymentStatus: status
      }
      await updateOrder(orderId, { payment: updatedPayment } as any)
    } catch (err) {
      console.error('Error actualizando pago:', err)
      alert('Error al actualizar el estado de pago')
    } finally {
      setUpdatingPayment(false)
    }
  }

  // Limpiar autenticación / Cerrar sesión
  const handleLogout = () => {
    localStorage.removeItem('adminAuth')
    setIsAuthenticated(false)
  }

  // 1. Pantalla de Autenticación
  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-6 bg-gradient-to-br from-slate-900 to-slate-800 text-white">
        <div className="w-full max-w-sm p-8 bg-slate-800/80 backdrop-blur-md rounded-3xl border border-slate-700/50 shadow-2xl">
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 bg-gradient-to-tr from-blue-500 to-cyan-400 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/20 mb-4 animate-bounce">
              <i className="bi bi-shield-lock-fill text-3xl text-white"></i>
            </div>
            <h1 className="text-2xl font-black tracking-tight text-center">Fuddi Admin Bot</h1>
            <p className="text-xs text-slate-400 mt-2 text-center uppercase tracking-widest">Mini App Acceso</p>
          </div>

          <form onSubmit={handleLoginSubmit} className="space-y-6">
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                Contraseña de Administrador
              </label>
              <input
                type="password"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                placeholder="Ingresa el código"
                className="w-full px-4 py-3.5 bg-slate-900/60 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                required
              />
            </div>

            {loginError && (
              <p className="text-sm font-semibold text-rose-400 text-center">{loginError}</p>
            )}

            <button
              type="submit"
              className="w-full py-4 bg-gradient-to-r from-blue-600 to-blue-500 text-white font-bold rounded-xl shadow-lg shadow-blue-600/25 hover:from-blue-500 hover:to-blue-400 active:scale-[0.98] transition-all"
            >
              Autenticar
            </button>
          </form>
        </div>
      </div>
    )
  }

  // 2. Pantalla Detalle de un Pedido Específico
  if (orderId) {
    if (loadingOrder) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
          <p className="text-sm font-bold text-slate-500">Cargando pedido...</p>
        </div>
      )
    }

    if (!order) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen p-6 bg-slate-50 text-center">
          <div className="w-16 h-16 bg-rose-100 rounded-2xl flex items-center justify-center text-rose-600 mb-4">
            <i className="bi bi-exclamation-triangle-fill text-3xl"></i>
          </div>
          <h2 className="text-xl font-bold text-slate-800">Pedido no encontrado</h2>
          <p className="text-sm text-slate-500 mt-2 max-w-xs">
            El pedido con ID `{orderId}` no existe o fue eliminado de la base de datos.
          </p>
          <button
            onClick={() => router.push('/tma')}
            className="mt-6 px-6 py-3 bg-blue-600 text-white font-bold rounded-xl shadow-md hover:bg-blue-700 transition-colors"
          >
            Ver todos los pedidos
          </button>
        </div>
      )
    }

    return (
      <div className="pb-16 bg-slate-50 min-h-screen">
        {/* Header Fijo */}
        <header className="sticky top-0 z-30 bg-slate-900 text-white px-4 py-3 flex items-center justify-between shadow-md">
          <button
            onClick={() => router.push('/tma')}
            className="w-10 h-10 flex items-center justify-center bg-slate-800 rounded-xl hover:bg-slate-700 transition-colors"
          >
            <i className="bi bi-chevron-left text-lg"></i>
          </button>
          <div className="text-center">
            <h1 className="text-sm font-black tracking-tight uppercase">Pedido #{orderId.substring(0, 6)}</h1>
            <p className="text-[10px] text-slate-400 font-semibold">{formatDate(order.createdAt)}</p>
          </div>
          <span className={`px-3 py-1 rounded-full text-xs font-black border uppercase ${getStatusColor(order.status)}`}>
            {getStatusText(order.status)}
          </span>
        </header>

        <div className="p-4 space-y-4 max-w-md mx-auto">
          {/* Card Tienda */}
          <div className="bg-white p-4 rounded-3xl shadow-sm border border-slate-100">
            <div className="flex items-center justify-between mb-3 pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 bg-orange-100 text-orange-600 rounded-xl flex items-center justify-center">
                  <i className="bi bi-shop text-xl"></i>
                </div>
                <div>
                  <h3 className="font-bold text-slate-800 text-sm">{orderBusiness?.name || 'Tienda no vinculada'}</h3>
                  <p className="text-xs text-slate-400">Restaurante / Negocio</p>
                </div>
              </div>
              {orderBusiness?.phone && (
                <div className="flex gap-2">
                  <a
                    href={`tel:${orderBusiness.phone}`}
                    className="w-8 h-8 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center hover:bg-slate-200 transition-colors"
                  >
                    <i className="bi bi-telephone-fill text-xs"></i>
                  </a>
                  <button
                    onClick={() => {
                      if (order && orderBusiness) {
                        sendOrderToStore(order, orderBusiness)
                      }
                    }}
                    className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center hover:bg-emerald-200 transition-colors"
                  >
                    <i className="bi bi-whatsapp text-sm"></i>
                  </button>
                </div>
              )}
            </div>
            {orderBusiness?.address && (
              <p className="text-xs text-slate-500 flex items-start gap-1.5">
                <i className="bi bi-geo-alt text-slate-400 mt-0.5"></i>
                <span>{orderBusiness.address}</span>
              </p>
            )}
          </div>

          {/* Card Cliente */}
          <div className="bg-white p-4 rounded-3xl shadow-sm border border-slate-100 space-y-3">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center">
                  <i className="bi bi-person text-xl"></i>
                </div>
                <div>
                  <h3 className="font-bold text-slate-800 text-sm">{order.customer?.name || 'Cliente'}</h3>
                  <p className="text-xs text-slate-400">Datos de Envío</p>
                </div>
              </div>
              {order.customer?.phone && (
                <div className="flex gap-2">
                  <a
                    href={`tel:${order.customer.phone}`}
                    className="w-8 h-8 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center hover:bg-slate-200 transition-colors"
                  >
                    <i className="bi bi-telephone-fill text-xs"></i>
                  </a>
                  <button
                    onClick={() => {
                      if (order) {
                        sendWhatsAppToCustomer(order)
                      }
                    }}
                    className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center hover:bg-emerald-200 transition-colors"
                  >
                    <i className="bi bi-whatsapp text-sm"></i>
                  </button>
                </div>
              )}
            </div>

            <div className="space-y-2.5 text-xs text-slate-600">
              <div className="flex items-start gap-2">
                <span className="font-bold text-slate-400 min-w-[70px]">Entrega:</span>
                <span className="font-bold uppercase tracking-wider text-slate-800 bg-slate-100 px-2 py-0.5 rounded">
                  {order.delivery?.type === 'pickup' ? 'Retiro en Local' : 'Envío a Domicilio'}
                </span>
              </div>

              {order.delivery?.type === 'delivery' && (
                <>
                  <div className="flex items-start gap-2">
                    <span className="font-bold text-slate-400 min-w-[70px]">Dirección:</span>
                    <span className="text-slate-800">{order.delivery?.references || 'Sin dirección ingresada'}</span>
                  </div>
                  {order.delivery?.sector && (
                    <div className="flex items-start gap-2">
                      <span className="font-bold text-slate-400 min-w-[70px]">Sector/Zona:</span>
                      <span className="text-slate-800 font-semibold">{order.delivery.sector}</span>
                    </div>
                  )}
                  {order.delivery?.latlong && (
                    <div className="flex items-start gap-2">
                      <span className="font-bold text-slate-400 min-w-[70px]">Mapa GPS:</span>
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
                      <span className="font-bold text-slate-400">Foto Fachada/Ubicación:</span>
                      <img
                        src={order.delivery.photo}
                        alt="Fachada"
                        className="w-full max-h-32 object-cover rounded-xl border cursor-pointer hover:opacity-90"
                        onClick={() => setReceiptZoom(order.delivery.photo || null)}
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Card Items Pedido */}
          <div className="bg-white p-4 rounded-3xl shadow-sm border border-slate-100 space-y-3">
            <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
              <i className="bi bi-bag-check text-blue-500"></i> Productos
            </h3>
            <div className="divide-y divide-slate-100">
              {order.items?.map((item, idx) => (
                <div key={idx} className="py-2.5 flex items-start justify-between text-xs gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded min-w-[20px] text-center">
                        {item.quantity}x
                      </span>
                      <span className="font-bold text-slate-800">{item.product?.name || item.name}</span>
                    </div>
                    {item.variant && (
                      <p className="text-[10px] text-slate-400 ml-7 mt-0.5">Variante: {item.variant}</p>
                    )}
                    {item.selectedOptions && item.selectedOptions.length > 0 && (
                      <div className="ml-7 mt-1 text-[10px] text-slate-500 space-y-0.5 bg-slate-50 p-1.5 rounded-lg">
                        {item.selectedOptions.map((optGroup, oIdx) => (
                          <div key={oIdx}>
                            <span className="font-semibold text-slate-600">{optGroup.groupName}: </span>
                            <span>{optGroup.selections.map(s => s.name).join(', ')}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <span className="font-bold text-slate-800">${(item.subtotal || 0).toFixed(2)}</span>
                </div>
              ))}
            </div>

            {/* Totales */}
            <div className="border-t border-slate-100 pt-3 space-y-2 text-xs">
              <div className="flex justify-between text-slate-500">
                <span>Subtotal:</span>
                <span>${(order.subtotal || order.total - (order.delivery?.deliveryCost || 0)).toFixed(2)}</span>
              </div>
              {order.delivery?.deliveryCost !== undefined && (
                <div className="flex justify-between text-slate-500">
                  <span>Costo Envío:</span>
                  <span>${order.delivery.deliveryCost.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm font-black text-slate-800 border-t border-slate-100 pt-2">
                <span>Total:</span>
                <span className="text-blue-600">${order.total.toFixed(2)}</span>
              </div>
            </div>

            {order.notas && (
              <div className="bg-amber-50 border border-amber-100 p-3 rounded-2xl text-xs text-amber-900 mt-2">
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
            <div className="bg-white p-4 rounded-3xl shadow-sm border border-slate-100 space-y-3">
              <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                <i className="bi bi-scooter text-blue-500"></i> Repartidor Asignado
              </h3>

              {updatingDelivery ? (
                <div className="py-4 text-center text-xs text-slate-500">
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600 mx-auto mb-2"></div>
                  Actualizando repartidor...
                </div>
              ) : (
                <div className="space-y-3">
                  <select
                    value={order.delivery?.assignedDelivery || ''}
                    onChange={(e) => handleAssignDelivery(e.target.value)}
                    className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-blue-500 text-slate-700"
                  >
                    <option value="">-- Sin Asignar (Repartidor Libre) --</option>
                    {deliveries.map(d => (
                      <option key={d.id} value={d.id}>
                        {d.nombres} ({d.celular})
                      </option>
                    ))}
                  </select>

                  {orderDelivery && (
                    <div className="bg-slate-50 p-3 rounded-2xl flex items-center justify-between text-xs">
                      <div>
                        <p className="font-bold text-slate-800">{orderDelivery.nombres}</p>
                        <p className="text-[10px] text-slate-500">Cel: {orderDelivery.celular}</p>
                      </div>
                      <div className="flex gap-2">
                        <a
                          href={`tel:${orderDelivery.celular}`}
                          className="w-7 h-7 rounded-lg bg-white shadow-sm border border-slate-200 text-slate-700 flex items-center justify-center hover:bg-slate-100"
                        >
                          <i className="bi bi-telephone-fill text-[10px]"></i>
                        </a>
                        <button
                          onClick={() => {
                            if (order && orderBusiness) {
                              sendWhatsAppToDelivery(order, deliveries, orderBusiness)
                            }
                          }}
                          className="w-7 h-7 rounded-lg bg-white shadow-sm border border-slate-200 text-emerald-600 flex items-center justify-center hover:bg-slate-100"
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
          <div className="bg-white p-4 rounded-3xl shadow-sm border border-slate-100 space-y-3">
            <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
              <i className="bi bi-credit-card text-blue-500"></i> Estado de Pago
            </h3>

            <div className="flex justify-between items-center bg-slate-50 p-3 rounded-2xl text-xs">
              <div>
                <span className="text-slate-500">Método: </span>
                <span className="font-bold uppercase tracking-wider text-slate-700">
                  {order.payment?.method === 'cash' ? 'Efectivo' : order.payment?.method === 'transfer' ? 'Transferencia' : 'Mixto'}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500">Pago: </span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase border ${
                  order.payment?.paymentStatus === 'paid' ? 'bg-emerald-100 text-emerald-800 border-emerald-200' :
                  order.payment?.paymentStatus === 'validating' ? 'bg-amber-100 text-amber-800 border-amber-200' :
                  order.payment?.paymentStatus === 'rejected' ? 'bg-rose-100 text-rose-800 border-rose-200' :
                  'bg-slate-100 text-slate-800 border-slate-200'
                }`}>
                  {order.payment?.paymentStatus === 'paid' ? 'Aprobado' :
                   order.payment?.paymentStatus === 'validating' ? 'Validando' :
                   order.payment?.paymentStatus === 'rejected' ? 'Rechazado' : 'Pendiente'}
                </span>
              </div>
            </div>

            {order.payment?.receiptImageUrl && (
              <div className="space-y-2">
                <p className="text-xs font-bold text-slate-500">Comprobante de Transferencia:</p>
                <img
                  src={order.payment.receiptImageUrl}
                  alt="Comprobante"
                  className="w-full max-h-48 object-cover rounded-2xl border cursor-pointer hover:opacity-90 shadow-sm"
                  onClick={() => setReceiptZoom(order.payment.receiptImageUrl || null)}
                />
              </div>
            )}

            {updatingPayment ? (
              <div className="py-2 text-center text-xs text-slate-500">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600 mx-auto mb-2"></div>
                Actualizando pago...
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  onClick={() => handleUpdatePaymentStatus('paid')}
                  disabled={order.payment?.paymentStatus === 'paid'}
                  className="py-2.5 px-3 bg-emerald-600 text-white font-bold rounded-xl text-xs shadow-md shadow-emerald-600/10 hover:bg-emerald-700 active:scale-[0.98] transition-all disabled:opacity-50 disabled:pointer-events-none"
                >
                  <i className="bi bi-patch-check-fill mr-1"></i> Aprobar Pago
                </button>
                <button
                  onClick={() => handleUpdatePaymentStatus('rejected')}
                  disabled={order.payment?.paymentStatus === 'rejected'}
                  className="py-2.5 px-3 bg-rose-600 text-white font-bold rounded-xl text-xs shadow-md shadow-rose-600/10 hover:bg-rose-700 active:scale-[0.98] transition-all disabled:opacity-50 disabled:pointer-events-none"
                >
                  <i className="bi bi-x-circle-fill mr-1"></i> Rechazar Pago
                </button>
              </div>
            )}
          </div>

          {/* Card Gestión de Estado de Orden */}
          <div className="bg-slate-900 text-white p-5 rounded-3xl shadow-lg shadow-slate-950/20 space-y-4">
            <h3 className="font-bold text-sm flex items-center gap-2">
              <i className="bi bi-gear-fill text-blue-400"></i> Acciones del Pedido
            </h3>

            {updatingStatus ? (
              <div className="py-4 text-center text-xs text-slate-400">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-400 mx-auto mb-2"></div>
                Actualizando estado a: {getStatusText(updatingStatus)}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {/* Botón Aceptar/Confirmar si está pendiente */}
                {['pending', 'borrador'].includes(order.status) && (
                  <button
                    onClick={() => handleUpdateStatus('confirmed')}
                    className="w-full py-3 bg-blue-600 hover:bg-blue-500 font-bold rounded-xl text-xs tracking-wide shadow-lg shadow-blue-900/40 active:scale-[0.98] transition-all uppercase"
                  >
                    Confirmar / Aceptar Pedido
                  </button>
                )}

                {/* Ciclo del negocio */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => handleUpdateStatus('preparing')}
                    disabled={order.status === 'preparing'}
                    className="py-2.5 px-2 bg-slate-800 hover:bg-slate-700 disabled:bg-purple-900/60 disabled:text-purple-200 border border-slate-700 disabled:border-transparent rounded-xl text-xs font-bold transition-all"
                  >
                    👨‍🍳 Preparando
                  </button>
                  <button
                    onClick={() => handleUpdateStatus('ready')}
                    disabled={order.status === 'ready'}
                    className="py-2.5 px-2 bg-slate-800 hover:bg-slate-700 disabled:bg-emerald-900/60 disabled:text-emerald-200 border border-slate-700 disabled:border-transparent rounded-xl text-xs font-bold transition-all"
                  >
                    📦 Listo
                  </button>
                  <button
                    onClick={() => handleUpdateStatus('on_way')}
                    disabled={order.status === 'on_way'}
                    className="py-2.5 px-2 bg-slate-800 hover:bg-slate-700 disabled:bg-indigo-900/60 disabled:text-indigo-200 border border-slate-700 disabled:border-transparent rounded-xl text-xs font-bold transition-all"
                  >
                    🛵 En camino
                  </button>
                  <button
                    onClick={() => handleUpdateStatus('delivered')}
                    disabled={order.status === 'delivered'}
                    className="py-2.5 px-2 bg-slate-800 hover:bg-slate-700 disabled:bg-slate-800/80 disabled:text-slate-500 border border-slate-700 disabled:border-transparent rounded-xl text-xs font-bold transition-all"
                  >
                    🏁 Entregado
                  </button>
                </div>

                {/* Botón Cancelar/Descartar */}
                {order.status !== 'cancelled' && (
                  <button
                    onClick={() => {
                      if (confirm('¿Estás seguro de cancelar/descartar este pedido?')) {
                        handleUpdateStatus('cancelled')
                      }
                    }}
                    className="w-full py-2.5 bg-rose-950/40 hover:bg-rose-950/60 text-rose-300 font-bold border border-rose-900/60 rounded-xl text-xs tracking-wide active:scale-[0.98] transition-all mt-1"
                  >
                    ❌ Cancelar / Descartar Pedido
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Modal de Zoom Recibo */}
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

  // 3. Pantalla Lista de Pedidos Activos (Dashboard General)
  return (
    <div className="bg-slate-50 min-h-screen">
      <header className="sticky top-0 z-30 bg-slate-900 text-white px-4 py-3 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center shadow-md shadow-blue-500/20">
            <i className="bi bi-activity text-white text-sm"></i>
          </div>
          <h1 className="text-base font-black tracking-tight uppercase">Dashboard TMA</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleLogout}
            className="px-3 py-1.5 bg-slate-800 hover:bg-rose-900/30 text-rose-400 hover:text-rose-300 text-xs font-bold rounded-xl border border-slate-700/50 transition-colors"
          >
            Cerrar
          </button>
        </div>
      </header>

      <div className="p-4 max-w-md mx-auto space-y-4">
        {/* Banner de saludo */}
        {tgUser && (
          <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white p-4 rounded-3xl shadow-md flex items-center gap-3">
            <div className="w-10 h-10 bg-white/10 rounded-full flex items-center justify-center text-lg">
              <i className="bi bi-telegram"></i>
            </div>
            <div>
              <p className="text-xs font-semibold text-blue-200 leading-none">Telegram Admin</p>
              <h2 className="text-sm font-bold mt-1">¡Hola, {tgUser.first_name || 'Admin'}!</h2>
            </div>
          </div>
        )}

        <div className="flex justify-between items-center">
          <h3 className="font-black text-slate-800 text-sm uppercase tracking-wide">Pedidos Activos</h3>
          <span className="bg-slate-200 text-slate-700 text-xs px-2.5 py-0.5 rounded-full font-bold">
            {orders.length} órdenes
          </span>
        </div>

        {loadingOrders ? (
          <div className="py-12 text-center text-slate-500 text-xs">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-3"></div>
            Cargando pedidos activos...
          </div>
        ) : orders.length === 0 ? (
          <div className="py-12 bg-white rounded-3xl border border-slate-100 text-center p-6 shadow-sm">
            <div className="w-12 h-12 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center mx-auto mb-3">
              <i className="bi bi-inbox text-xl"></i>
            </div>
            <p className="font-bold text-slate-800 text-sm">No hay pedidos activos</p>
            <p className="text-xs text-slate-400 mt-1 max-w-[200px] mx-auto">
              Todos los pedidos han sido entregados o cancelados.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {orders.map((ord) => {
              const biz = businesses.find(b => b.id === ord.businessId)
              const itemsCount = ord.items?.reduce((acc, it) => acc + (it.quantity || 1), 0) || 0
              return (
                <div
                  key={ord.id}
                  onClick={() => router.push(`/tma?orderId=${ord.id}`)}
                  className="bg-white p-4 rounded-3xl border border-slate-100 hover:border-blue-500/30 active:scale-[0.99] transition-all shadow-sm cursor-pointer block relative"
                >
                  <div className="flex justify-between items-start gap-2 mb-2">
                    <div>
                      <h4 className="font-black text-slate-800 text-sm">{biz?.name || 'Negocio'}</h4>
                      <p className="text-[10px] text-slate-400 font-semibold">{formatDate(ord.createdAt)}</p>
                    </div>
                    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black border uppercase ${getStatusColor(ord.status)}`}>
                      {getStatusText(ord.status)}
                    </span>
                  </div>

                  <div className="text-xs text-slate-600 space-y-1 mt-2.5 pb-2.5 border-b border-slate-50">
                    <p className="flex items-center gap-1.5">
                      <i className="bi bi-person text-slate-400"></i>
                      <span>{ord.customer?.name || 'Cliente'}</span>
                    </p>
                    <p className="flex items-center gap-1.5">
                      <i className="bi bi-bicycle text-slate-400"></i>
                      <span className="font-semibold text-slate-700">
                        {ord.delivery?.type === 'pickup' ? 'Retiro en Local' : `Envío a domicilio (${ord.delivery?.sector || 'S/S'})`}
                      </span>
                    </p>
                  </div>

                  <div className="flex justify-between items-center pt-2 text-xs">
                    <span className="text-slate-400 font-semibold">{itemsCount} productos</span>
                    <span className="font-black text-blue-600 text-sm">${ord.total.toFixed(2)}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export default function TMAPage() {
  return (
    <Suspense fallback={
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
        <p className="text-sm font-bold text-slate-500">Cargando...</p>
      </div>
    }>
      <TMAContent />
    </Suspense>
  )
}
