'use client'

import { useState, useEffect, useMemo, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { db } from '@/lib/firebase'
import { collection, query, onSnapshot, where, doc, updateDoc, getDocs, arrayUnion, Timestamp } from 'firebase/firestore'
import { getDeliveryById, getAllBusinesses, updateOrderStatus } from '@/lib/database'
import { Order, Delivery, Business } from '@/types'
import { GOOGLE_MAPS_API_KEY } from '@/components/GoogleMap'

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

// Check if date is today in user's local timezone
const isToday = (dateVal: any): boolean => {
  if (!dateVal) return false
  const date = toSafeDate(dateVal)
  const today = new Date()
  return date.getDate() === today.getDate() &&
         date.getMonth() === today.getMonth() &&
         date.getFullYear() === today.getFullYear()
}

// Format date to local ECU time
const formatTimeOnly = (dateVal: any): string => {
  const d = toSafeDate(dateVal)
  return d.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit', hour12: false })
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

function TMADeliveryContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const orderIdFromUrl = searchParams?.get('orderId') || null

  // Authentication
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [passcode, setPasscode] = useState('')
  const [loginError, setLoginError] = useState('')
  const [selectedRiderId, setSelectedRiderId] = useState('')
  const [allRiders, setAllRiders] = useState<Delivery[]>([])

  // Current Rider & Data
  const [rider, setRider] = useState<Delivery | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [businesses, setBusinesses] = useState<Business[]>([])
  const [loading, setLoading] = useState(true)

  // UI state
  const [activeTab, setActiveTab] = useState<'today' | 'history'>('today')
  const [expandedOrderIds, setExpandedOrderIds] = useState<Set<string>>(new Set())
  const [activeStoreMenuId, setActiveStoreMenuId] = useState<string | null>(null)
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set(['EntregadosHoy', 'Historial']))
  const [receiptZoom, setReceiptZoom] = useState<string | null>(null)
  const [showClaimModal, setShowClaimModal] = useState(false)
  const [claimOrderId, setClaimOrderId] = useState('')
  const [claimError, setClaimError] = useState('')

  // Telegram SDK Info
  const [tgUser, setTgUser] = useState<any>(null)
  const [tgChecked, setTgChecked] = useState(false)

  // Initialize Telegram WebApp SDK
  useEffect(() => {
    if (typeof window !== 'undefined' && (window as any).Telegram?.WebApp) {
      const tg = (window as any).Telegram.WebApp
      tg.ready()
      tg.expand()
      const user = tg.initDataUnsafe?.user || null
      setTgUser(user)
      setTgChecked(true)
    } else {
      setTgChecked(true)
    }
  }, [])

  // Load all available delivery riders for manual login selection
  useEffect(() => {
    const fetchRiders = async () => {
      try {
        const querySnapshot = await getDocs(collection(db, 'deliveries'))
        const list = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Delivery))
        setAllRiders(list.filter(r => r.estado === 'activo'))
      } catch (err) {
        console.error('Error fetching riders:', err)
      }
    }
    fetchRiders()
  }, [])

  // Automatic Authentication using Telegram User ID
  useEffect(() => {
    if (!tgChecked || isAuthenticated) return

    const tryAutoLogin = async () => {
      // 1. Check local storage first
      const savedId = localStorage.getItem('tmaDeliveryId')
      if (savedId) {
        try {
          const rData = await getDeliveryById(savedId)
          if (rData && rData.estado === 'activo') {
            setRider(rData)
            setIsAuthenticated(true)
            setLoading(false)
            return
          }
        } catch (e) {
          console.error('Error reading saved rider:', e)
        }
      }

      // 2. Try matching Telegram User ID (chatId in recoveries)
      if (tgUser?.id) {
        try {
          const q = query(
            collection(db, 'deliveries'),
            where('telegramChatId', '==', tgUser.id.toString())
          )
          const snap = await getDocs(q)
          if (!snap.empty) {
            const docSnap = snap.docs[0]
            const rData = { id: docSnap.id, ...docSnap.data() } as Delivery
            setRider(rData)
            localStorage.setItem('tmaDeliveryId', docSnap.id)
            setIsAuthenticated(true)
            setLoading(false)
            return
          }
        } catch (err) {
          console.error('Error in auto login match:', err)
        }
      }
      setLoading(false)
    }

    tryAutoLogin()
  }, [tgUser, tgChecked, isAuthenticated])

  // Handle Manual Password Login
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedRiderId) {
      setLoginError('Selecciona un repartidor')
      return
    }

    // Passcode simulation
    if (passcode === 'delivery123' || passcode === 'admin123') {
      try {
        const rData = await getDeliveryById(selectedRiderId)
        if (rData) {
          // If we have a telegram user, link their account automatically on first passcode login
          if (tgUser?.id) {
            const riderRef = doc(db, 'deliveries', selectedRiderId)
            await updateDoc(riderRef, { telegramChatId: tgUser.id.toString() })
            rData.telegramChatId = tgUser.id.toString()
          }

          setRider(rData)
          localStorage.setItem('tmaDeliveryId', selectedRiderId)
          setIsAuthenticated(true)
          setLoginError('')
        }
      } catch (err) {
        setLoginError('Error al recuperar perfil')
      }
    } else {
      setLoginError('Contraseña de acceso incorrecta')
    }
  }

  const handleLogout = () => {
    localStorage.removeItem('tmaDeliveryId')
    setRider(null)
    setIsAuthenticated(false)
  }



  // Load Businesses
  useEffect(() => {
    if (!isAuthenticated) return
    getAllBusinesses()
      .then(setBusinesses)
      .catch(err => console.error('Error loading businesses:', err))
  }, [isAuthenticated])

  // Subscribe to Orders (Assigned + Available)
  useEffect(() => {
    if (!isAuthenticated || !rider) return

    const ordersRef = collection(db, 'orders')
    
    const q = query(
      ordersRef,
      where('delivery.type', '==', 'delivery')
    )

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const allOrders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Order))
      
      const filtered = allOrders.filter(o => {
        const isAssignedToMe = o.delivery?.assignedDelivery === rider.id
        const isAvailable = !o.delivery?.assignedDelivery && ['pending', 'preparing', 'ready', 'confirmed'].includes(o.status)
        const isNotRejectedByMe = !o.delivery?.rejectedBy?.includes(rider.id)
        
        return isAssignedToMe || (isAvailable && isNotRejectedByMe)
      })

      filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      
      setOrders(filtered)
      setLoading(false)
    }, (err) => {
      console.error('Error in snapshot:', err)
      setLoading(false)
    })

    return () => unsubscribe()
  }, [isAuthenticated, rider])

  // Automatically expand order from URL if present
  useEffect(() => {
    if (orderIdFromUrl && orders.length > 0) {
      setExpandedOrderIds(new Set([orderIdFromUrl]))
      setTimeout(() => {
        const el = document.getElementById(`order-${orderIdFromUrl}`)
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 500)
    }
  }, [orderIdFromUrl, orders])

  const toggleOrderExpansion = (orderId: string) => {
    setExpandedOrderIds(prev => {
      const copy = new Set(prev)
      if (copy.has(orderId)) copy.delete(orderId)
      else copy.add(orderId)
      return copy
    })
  }

  const toggleCategoryCollapse = (category: string) => {
    setCollapsedCategories(prev => {
      const copy = new Set(prev)
      if (copy.has(category)) copy.delete(category)
      else copy.add(category)
      return copy
    })
  }

  // Delivery Actions
  const handleTakeOrder = async (orderId: string) => {
    if (!rider) return
    try {
      const orderRef = doc(db, 'orders', orderId)
      await updateDoc(orderRef, {
        'delivery.assignedDelivery': rider.id,
        'delivery.acceptanceStatus': 'accepted'
      })
    } catch (err) {
      console.error('Error claiming order:', err)
      alert('Error al reclamar el pedido')
    }
  }

  const handleAcceptOrder = async (orderId: string) => {
    try {
      const orderRef = doc(db, 'orders', orderId)
      await updateDoc(orderRef, {
        'delivery.acceptanceStatus': 'accepted'
      })
    } catch (err) {
      console.error('Error accepting order:', err)
    }
  }

  const handleRejectOrder = async (orderId: string) => {
    if (!rider) return
    if (!confirm('¿Estás seguro de rechazar este pedido?')) return
    try {
      const orderRef = doc(db, 'orders', orderId)
      await updateDoc(orderRef, {
        'delivery.assignedDelivery': null,
        'delivery.acceptanceStatus': 'pending',
        'delivery.rejectedBy': arrayUnion(rider.id)
      })
    } catch (err) {
      console.error('Error rejecting order:', err)
    }
  }

  const handleUpdateStatus = async (orderId: string, newStatus: Order['status']) => {
    try {
      await updateOrderStatus(orderId, newStatus)
      if (newStatus === 'delivered') {
        const orderRef = doc(db, 'orders', orderId)
        await updateDoc(orderRef, {
          deliveredAt: new Date(),
          'statusHistory.deliveredAt': new Date()
        })
      }
    } catch (err) {
      console.error('Error updating status:', err)
      alert('Error al actualizar el estado')
    }
  }

  // Send Whatsapp notifications
  const sendOnWayWhatsApp = (order: Order) => {
    const phone = order.customer?.phone
    if (!phone) return
    let clean = phone.replace(/[^\d]/g, '')
    if (clean.startsWith('0')) clean = '593' + clean.slice(1)
    else if (!clean.startsWith('593')) clean = '593' + clean

    const business = businesses.find(b => b.id === order.businessId)
    const storeName = business?.name || 'Fuddi Store'
    const text = `Hola, soy el repartidor de ${storeName}. Estoy en camino con tu pedido 🛵`
    window.open(`https://wa.me/${clean}?text=${encodeURIComponent(text)}`, '_blank')
  }

  const handleClaimSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setClaimError('')
    if (!claimOrderId || claimOrderId.trim().length < 4) {
      setClaimError('Ingresa un código de pedido válido')
      return
    }

    try {
      const q = query(collection(db, 'orders'))
      const snap = await getDocs(q)
      const foundDoc = snap.docs.find(doc => doc.id.toLowerCase().includes(claimOrderId.trim().toLowerCase()))
      
      if (foundDoc && rider) {
        const orderRef = doc(db, 'orders', foundDoc.id)
        await updateDoc(orderRef, {
          'delivery.assignedDelivery': rider.id,
          'delivery.acceptanceStatus': 'accepted'
        })
        setExpandedOrderIds(new Set([foundDoc.id]))
        setClaimOrderId('')
        setShowClaimModal(false)
      } else {
        setClaimError('No se encontró ningún pedido activo con ese código')
      }
    } catch (err) {
      setClaimError('Error al buscar el pedido')
    }
  }

  // Grouping & Statistics calculations
  const grouped = useMemo(() => {
    const list = {
      Disponibles: [] as Order[],
      Activos: [] as Order[],
      EntregadosHoy: [] as Order[],
      Historial: [] as Order[]
    }

    if (!rider) return list

    orders.forEach(o => {
      if (o.status === 'delivered' && o.delivery?.assignedDelivery === rider.id) {
        const orderDate = o.deliveredAt || o.statusHistory?.deliveredAt || o.createdAt
        if (isToday(orderDate)) {
          list.EntregadosHoy.push(o)
        } else {
          list.Historial.push(o)
        }
      } else if (o.delivery?.assignedDelivery === rider.id) {
        list.Activos.push(o)
      } else if (!o.delivery?.assignedDelivery) {
        list.Disponibles.push(o)
      }
    })

    return list
  }, [orders, rider])

  const stats = useMemo(() => {
    const ganadoHoy = grouped.EntregadosHoy.reduce((sum, o) => sum + (o.delivery?.deliveryCost || 0), 0)
    const ganadoTotal = [...grouped.EntregadosHoy, ...grouped.Historial].reduce((sum, o) => sum + (o.delivery?.deliveryCost || 0), 0)
    const activeCost = grouped.Activos.reduce((sum, o) => sum + (o.delivery?.deliveryCost || 0), 0)
    
    return {
      activos: grouped.Activos.length,
      entregadosHoy: grouped.EntregadosHoy.length,
      entregadosTotal: grouped.EntregadosHoy.length + grouped.Historial.length,
      ganadoHoy,
      ganadoTotal,
      activeCost
    }
  }, [grouped])

  if (loading && !isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600 mb-4"></div>
        <p className="text-sm font-bold text-gray-500">Cargando Fuddi Repartos...</p>
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-6 bg-gray-50 text-gray-900">
        <div className="w-full max-w-sm p-8 bg-white rounded-3xl border border-gray-100 shadow-xl">
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center shadow-md mb-4 text-red-600">
              <i className="bi bi-bicycle text-4xl"></i>
            </div>
            <h1 className="text-2xl font-black tracking-tight text-center text-red-600">Fuddi Delivery</h1>
            <p className="text-xs text-gray-400 mt-2 text-center uppercase tracking-widest font-bold">Mini App Repartidor</p>
          </div>

          <form onSubmit={handleLoginSubmit} className="space-y-6">
            <div>
              <label className="block text-[10px] font-black text-gray-400 uppercase tracking-wider mb-2">
                Selecciona tu Nombre
              </label>
              <select
                value={selectedRiderId}
                onChange={(e) => setSelectedRiderId(e.target.value)}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-red-500 text-gray-700"
                required
              >
                <option value="">-- Elige un Repartidor --</option>
                {allRiders.map(r => (
                  <option key={r.id} value={r.id}>{r.nombres}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-black text-gray-400 uppercase tracking-wider mb-2">
                Contraseña de Reparto
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

  return (
    <div className="bg-gray-50 min-h-screen text-gray-900 pb-20 relative animate-fadeIn">
      
      <header className="sticky top-0 z-30 bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-2">
          <button className="w-8 h-8 flex items-center justify-center text-gray-500 rounded-lg hover:bg-gray-50">
            <i className="bi bi-list text-xl"></i>
          </button>
          <span className="text-xl sm:text-2xl font-poetsen text-[#ab1919]">Fuddi</span>
        </div>

        <div className="flex items-center gap-2">
          <div className="px-3 py-2 bg-gray-50 border border-gray-100 rounded-xl text-xs font-bold text-gray-600">
            30m
          </div>

          <button className="w-10 h-10 bg-gray-50 border border-gray-100 rounded-xl flex items-center justify-center text-gray-500 hover:bg-gray-100">
            <i className="bi bi-bell"></i>
          </button>

          <div className="flex items-center gap-1.5 p-1 bg-rose-50 rounded-full border border-rose-100 pr-3 shadow-sm select-none">
            {rider?.fotoUrl ? (
              <img src={rider.fotoUrl} alt={rider.nombres} className="w-8 h-8 rounded-full object-cover" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-red-600 text-white flex items-center justify-center font-bold text-xs">
                {rider?.nombres.substring(0, 1)}
              </div>
            )}
            <span className="text-[10px] font-black text-red-800 tracking-wide uppercase max-w-[50px] truncate">{rider?.nombres.split(' ')[0]}</span>
            <button onClick={handleLogout} className="text-red-700 hover:text-red-900 ml-1" title="Cerrar sesión">
              <i className="bi bi-box-arrow-right text-xs"></i>
            </button>
          </div>
        </div>
      </header>

      <div className="p-4 max-w-md mx-auto space-y-4">
        
        <div className="bg-white rounded-3xl border border-gray-100 p-4 shadow-sm">
          <div className="grid grid-cols-3 gap-2 divide-x divide-gray-100 text-center">
            
            <div className="flex flex-col items-center">
              <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">Activos</span>
              <div className="flex items-center gap-1.5 mt-1">
                <i className="bi bi-bicycle text-red-500 text-sm"></i>
                <span className="text-xl font-black text-gray-800 leading-none">{stats.activos}</span>
              </div>
            </div>

            <div className="flex flex-col items-center">
              <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">
                {activeTab === 'today' ? 'Entregas Hoy' : 'Total Entregas'}
              </span>
              <div className="flex items-center gap-1.5 mt-1">
                <i className="bi bi-check-circle-fill text-gray-400 text-sm"></i>
                <span className="text-xl font-black text-gray-800 leading-none">
                  {activeTab === 'today' ? stats.entregadosHoy : stats.entregadosTotal}
                </span>
              </div>
            </div>

            <div className="flex flex-col items-center">
              <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">
                {activeTab === 'today' ? 'Ganado Hoy' : 'Ganado Total'}
              </span>
              <span className="text-xl font-black text-emerald-600 mt-1 leading-none">
                ${(activeTab === 'today' ? stats.ganadoHoy : stats.ganadoTotal).toFixed(2)}
              </span>
              {activeTab === 'today' && (
                <span className="text-[8px] font-bold text-gray-400 uppercase tracking-tighter mt-1">Activo: ${stats.activeCost.toFixed(2)}</span>
              )}
            </div>

          </div>
        </div>

        {/* Tabs UI */}
        <div className="flex bg-gray-100 p-1 rounded-2xl border border-gray-200/65 shadow-sm">
          <button
            onClick={() => setActiveTab('today')}
            className={`flex-1 py-2 text-xs font-black uppercase tracking-wider rounded-xl transition-all duration-200 flex items-center justify-center gap-2 ${
              activeTab === 'today'
                ? 'bg-white text-red-600 shadow-sm border border-gray-100'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <i className="bi bi-calendar-event"></i>
            Pedidos de Hoy
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`flex-1 py-2 text-xs font-black uppercase tracking-wider rounded-xl transition-all duration-200 flex items-center justify-center gap-2 ${
              activeTab === 'history'
                ? 'bg-white text-red-600 shadow-sm border border-gray-100'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <i className="bi bi-clock-history"></i>
            Historial ({grouped.Historial.length})
          </button>
        </div>

        {(activeTab === 'today'
          ? ([
              { id: 'Disponibles', label: 'Disponibles', orders: grouped.Disponibles, color: 'bg-emerald-500' },
              { id: 'Activos', label: 'Activos', orders: grouped.Activos, color: 'bg-cyan-500' },
              { id: 'EntregadosHoy', label: 'Entregados Hoy', orders: grouped.EntregadosHoy, color: 'bg-gray-400' }
            ] as const)
          : ([
              { id: 'Historial', label: 'Historial de Entregas', orders: grouped.Historial, color: 'bg-gray-400' }
            ] as const)
        ).map(cat => {
          const catOrders = cat.orders
          const isCollapsed = collapsedCategories.has(cat.id)

          return (
            <div key={cat.id} className="space-y-3">
              
              <button
                onClick={() => toggleCategoryCollapse(cat.id)}
                className="w-full flex items-center justify-between py-2.5 px-1 border-b border-gray-200"
              >
                <div className="flex items-center gap-2">
                  <span className={`w-3 h-3 rounded-full ${cat.color}`}></span>
                  <h3 className="font-black text-gray-800 uppercase tracking-wider text-xs">
                    {cat.label}
                  </h3>
                  <span className="bg-gray-200 text-gray-700 text-[10px] font-black px-2 py-0.5 rounded-full">
                    {catOrders.length}
                  </span>
                </div>
                <i className={`bi bi-chevron-down text-gray-400 transition-transform duration-300 ${isCollapsed ? '' : 'rotate-180'}`}></i>
              </button>

              {!isCollapsed && (
                <div className="space-y-3.5">
                  {catOrders.length === 0 ? (
                    <div className="py-8 bg-white rounded-3xl border border-gray-100 text-center text-gray-400 text-xs">
                      <i className="bi bi-inbox text-2xl block mb-2 text-gray-300"></i>
                      No hay pedidos en esta sección.
                    </div>
                  ) : (
                    catOrders.map(order => {
                      const isExpanded = expandedOrderIds.has(order.id)
                      const business = businesses.find(b => b.id === order.businessId)
                      const itemsText = order.items?.map(it => `${it.quantity}x ${it.variant || it.name}`).join(', ') || 'Sin productos'
                      
                      return (
                        <div
                          id={`order-${order.id}`}
                          key={order.id}
                          className={`bg-white rounded-3xl border border-gray-100 shadow-sm hover:shadow-md transition-all duration-300 relative ${
                            activeStoreMenuId === order.id ? 'z-30' : 'z-10'
                          }`}
                        >
                          
                          <div
                            onClick={() => toggleOrderExpansion(order.id)}
                            className="p-4 cursor-pointer flex items-center justify-between"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <h4 className="font-black text-gray-900 text-sm truncate">
                                  {order.customer?.name || 'Cliente'}
                                </h4>
                                <i className={`bi ${isExpanded ? 'bi-chevron-up' : 'bi-chevron-down'} text-xs text-gray-400`}></i>
                              </div>
                              
                              <div className="flex items-center gap-1.5 mt-1 text-gray-400 text-xs">
                                <i className="bi bi-clock animate-pulse text-red-500"></i>
                                <span className="font-bold text-gray-600">{order.timing?.scheduledTime || formatTimeOnly(order.createdAt)}</span>
                                
                                {order.status === 'ready' && (
                                  <span className="text-[10px] font-black text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded border border-purple-100">
                                    ¿Pedido listo?
                                  </span>
                                )}
                              </div>

                              <div className="text-sm font-bold text-gray-500 mt-2 truncate">
                                {itemsText}
                              </div>

                              <div className="mt-2.5 inline-flex items-center gap-1 px-2.5 py-0.5 bg-emerald-50 text-emerald-700 rounded-full text-[10px] font-bold border border-emerald-100">
                                {business?.name || 'Fuddi Store'}
                              </div>
                            </div>

                            <div className="flex flex-col items-end gap-2.5">
                              <span className="font-black text-red-600 text-sm">${order.total.toFixed(2)}</span>
                              
                              {!order.delivery?.assignedDelivery ? (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleTakeOrder(order.id)
                                  }}
                                  className="px-3 py-1.5 bg-red-600 text-white rounded-xl text-[10px] font-black shadow-md shadow-red-600/10 uppercase tracking-wider"
                                >
                                  Tomar
                                </button>
                              ) : (
                                <div className="flex items-center gap-1.5">
                                  {order.delivery.acceptanceStatus === 'pending' && (
                                    <>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          handleAcceptOrder(order.id)
                                        }}
                                        className="px-2 py-1 bg-emerald-600 text-white rounded-xl text-[10px] font-black"
                                      >
                                        Aceptar
                                      </button>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          handleRejectOrder(order.id)
                                        }}
                                        className="px-2 py-1 bg-rose-50 text-rose-700 rounded-xl text-[10px] font-black border border-rose-200"
                                      >
                                        Rechazar
                                      </button>
                                    </>
                                  )}

                                  {order.delivery.acceptanceStatus === 'accepted' && order.status !== 'delivered' && (
                                    <>
                                      {order.status !== 'on_way' ? (
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            handleUpdateStatus(order.id, 'on_way')
                                          }}
                                          className="px-3 py-1.5 bg-cyan-600 text-white rounded-xl text-[10px] font-black shadow-md shadow-cyan-600/10 uppercase"
                                        >
                                          🛵 En camino
                                        </button>
                                      ) : (
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            handleUpdateStatus(order.id, 'delivered')
                                          }}
                                          className="px-3 py-1.5 bg-emerald-600 text-white rounded-xl text-[10px] font-black shadow-md shadow-emerald-600/10 uppercase"
                                        >
                                          🏁 Entregar
                                        </button>
                                      )}
                                    </>
                                  )}
                                </div>
                              )}

                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setActiveStoreMenuId(activeStoreMenuId === order.id ? null : order.id)
                                }}
                                className="w-7 h-7 rounded-lg bg-gray-50 border border-gray-100 flex items-center justify-center text-gray-500 hover:bg-gray-100"
                              >
                                <i className="bi bi-three-dots"></i>
                              </button>
                            </div>
                          </div>

                          {activeStoreMenuId === order.id && (
                            <>
                              <div className="fixed inset-0 z-40" onClick={() => setActiveStoreMenuId(null)}></div>
                              <div className="absolute right-4 bottom-12 z-50 bg-white rounded-2xl shadow-xl border border-gray-100 w-44 overflow-hidden animate-fadeIn">
                                <div className="p-1.5 space-y-0.5">
                                  <button
                                    onClick={() => {
                                      sendOnWayWhatsApp(order)
                                      setActiveStoreMenuId(null)
                                    }}
                                    className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 rounded-xl text-xs text-gray-700 font-bold"
                                  >
                                    <i className="bi bi-whatsapp text-emerald-500"></i> Avisar por WhatsApp
                                  </button>
                                  <a
                                    href={`tel:${order.customer?.phone}`}
                                    onClick={() => setActiveStoreMenuId(null)}
                                    className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 rounded-xl text-xs text-gray-700 font-bold font-sans"
                                  >
                                    <i className="bi bi-telephone text-blue-500"></i> Llamar Cliente
                                  </a>
                                  {business?.phone && (
                                    <a
                                      href={`tel:${business.phone}`}
                                      onClick={() => setActiveStoreMenuId(null)}
                                      className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 rounded-xl text-xs text-gray-700 font-bold font-sans"
                                    >
                                      <i className="bi bi-shop text-amber-500"></i> Llamar Tienda
                                    </a>
                                  )}
                                </div>
                              </div>
                            </>
                          )}

                          {isExpanded && (
                            <div className="px-4 pb-5 border-t border-gray-50 pt-4 bg-gray-50/50 space-y-4 rounded-b-3xl">
                              
                              <div className="text-xs text-gray-600">
                                <span className="font-bold text-gray-400 block mb-1">Dirección / Referencias:</span>
                                <p className="font-semibold text-gray-800 bg-white p-3 rounded-2xl border border-gray-100">
                                  {order.delivery?.references || 'Sin referencias'}
                                </p>
                              </div>

                              {order.delivery?.latlong && (
                                <div
                                  onClick={() => {
                                    window.open(`https://www.google.com/maps/dir/?api=1&destination=${order.delivery.latlong}`, '_blank')
                                  }}
                                  className="rounded-2xl overflow-hidden border border-gray-200 cursor-pointer hover:opacity-95 transition-opacity h-32 relative"
                                >
                                  <img
                                    src={`https://maps.googleapis.com/maps/api/staticmap?center=${order.delivery.latlong.replace(/\s+/g, '')}&zoom=15&size=500x200&scale=2&markers=color:red%7C${order.delivery.latlong.replace(/\s+/g, '')}&key=${GOOGLE_MAPS_API_KEY}`}
                                    alt="Ubicación"
                                    className="w-full h-full object-cover"
                                  />
                                  <div className="absolute bottom-2 right-2 bg-white/95 px-2 py-1 rounded-lg text-[9px] font-black text-gray-700 shadow-sm flex items-center gap-1">
                                    <i className="bi bi-cursor-fill text-red-500"></i> Trazar Ruta
                                  </div>
                                </div>
                              )}

                              {order.delivery?.photo && (
                                <div className="space-y-1">
                                  <span className="text-[10px] font-black text-gray-400 uppercase">Foto Ubicación</span>
                                  <img
                                    src={order.delivery.photo}
                                    alt="Fachada"
                                    className="w-full max-h-32 object-cover rounded-2xl border cursor-pointer hover:opacity-90 transition-opacity"
                                    onClick={() => setReceiptZoom(order.delivery.photo || null)}
                                  />
                                </div>
                              )}

                              <div className="bg-white p-3.5 rounded-2xl border border-gray-100 space-y-2">
                                <h5 className="text-[10px] font-black text-gray-400 uppercase tracking-wider flex items-center gap-1">
                                  <i className="bi bi-bag"></i> Desglose del pedido
                                </h5>
                                <div className="divide-y divide-gray-50 text-xs">
                                  {order.items?.map((item, idx) => (
                                    <div key={idx} className="py-2 flex justify-between">
                                      <span className="font-semibold text-gray-800">
                                        <span className="font-black text-red-600 mr-1.5">{item.quantity}x</span>
                                        {item.variant || item.name}
                                      </span>
                                      <span className="font-bold text-gray-600">${(item.subtotal || 0).toFixed(2)}</span>
                                    </div>
                                  ))}
                                </div>
                                <div className="border-t border-gray-50 pt-2 flex justify-between text-xs font-black text-gray-800">
                                  <span>Envío:</span>
                                  <span>${(order.delivery?.deliveryCost || 0).toFixed(2)}</span>
                                </div>
                                <div className="flex justify-between text-sm font-black text-red-600">
                                  <span>Total a pagar:</span>
                                  <span>${order.total.toFixed(2)}</span>
                                </div>
                              </div>

                              <div className="bg-white p-3.5 rounded-2xl border border-gray-100 text-xs flex justify-between items-center">
                                <div>
                                  <span className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Método de Pago</span>
                                  <span className="font-black text-gray-800 block mt-0.5">
                                    {order.payment?.method === 'cash' ? '💵 Efectivo' : order.payment?.method === 'transfer' ? '🏦 Transferencia' : '💳 Pago Mixto'}
                                  </span>
                                </div>
                                {order.payment?.method === 'cash' && (
                                  <div className="text-right">
                                    <span className="text-[10px] font-black text-gray-400 uppercase tracking-wider">A cobrar:</span>
                                    <span className="font-black text-emerald-600 block text-sm mt-0.5">${order.total.toFixed(2)}</span>
                                  </div>
                                )}
                                {order.payment?.method === 'mixed' && (
                                  <div className="text-right">
                                    <span className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Cobrar Efectivo:</span>
                                    <span className="font-black text-emerald-600 block text-sm mt-0.5">${(order.payment as any).cashAmount?.toFixed(2) || '0.00'}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}

                        </div>
                      )
                    })
                  )}
                </div>
              )}

            </div>
          )
        })}

      </div>

      <button
        onClick={() => setShowClaimModal(true)}
        className="fixed bottom-6 right-6 w-14 h-14 bg-red-600 text-white rounded-full flex items-center justify-center shadow-lg hover:bg-red-700 active:scale-95 transition-all duration-300 z-40 border-2 border-white"
        title="Buscar/Reclamar Pedido"
      >
        <i className="bi bi-plus-lg text-2xl"></i>
      </button>

      {receiptZoom && (
        <div
          className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center p-4"
          onClick={() => setReceiptZoom(null)}
        >
          <img src={receiptZoom} alt="Zoom" className="max-w-full max-h-[85vh] object-contain rounded-2xl shadow-2xl" />
        </div>
      )}

      {showClaimModal && (
        <div className="fixed inset-0 bg-black/45 z-50 flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-white rounded-3xl w-full max-w-sm overflow-hidden border border-gray-100 shadow-2xl">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-gray-50">
              <h3 className="font-black text-sm uppercase tracking-wider text-gray-800">Cargar Pedido por Código</h3>
              <button
                onClick={() => {
                  setShowClaimModal(false)
                  setClaimError('')
                }}
                className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-300 transition-colors"
              >
                <i className="bi bi-x-lg text-xs"></i>
              </button>
            </div>
            <form onSubmit={handleClaimSubmit} className="p-5 space-y-4">
              <p className="text-xs text-gray-500 font-medium">
                Ingresa los últimos dígitos del código del pedido para asignártelo y gestionarlo desde aquí.
              </p>
              <div>
                <input
                  type="text"
                  value={claimOrderId}
                  onChange={(e) => setClaimOrderId(e.target.value)}
                  placeholder="Ej: d7c5bf"
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl text-sm font-bold placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500 uppercase"
                  required
                />
              </div>
              {claimError && <p className="text-xs font-bold text-red-600 text-center">{claimError}</p>}
              <button
                type="submit"
                className="w-full py-3 bg-red-600 text-white font-black rounded-xl text-xs uppercase tracking-wider shadow-md hover:bg-red-700 active:scale-95 transition-all"
              >
                Asignar y Abrir
              </button>
            </form>
          </div>
        </div>
      )}

    </div>
  )
}

export default function TMADeliveryPage() {
  return (
    <Suspense fallback={
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600 mb-4"></div>
        <p className="text-sm font-bold text-gray-500">Cargando...</p>
      </div>
    }>
      <TMADeliveryContent />
    </Suspense>
  )
}
