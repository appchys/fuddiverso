'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { Flame, Clock, CheckCircle2, PackageCheck, Bike, AlertCircle, XCircle, ArrowRight, Edit3, Info, Store } from 'lucide-react'
import { getOrdersByClient, getBusiness, getUserReferrals, getAllUserCredits } from '@/lib/database'
import OrderSidebar from '@/components/OrderSidebar'
import { ClientRecommendationsSidebar } from '@/components/UserSidebar'
import ReferralModal from '@/components/ReferralModal'
import FuddieIcon from '@/components/FuddieIcon'

function getPaymentBadgeConfig(paymentStatus?: string) {
  switch (paymentStatus) {
    case 'paid':
      return { label: 'Pagado', className: 'bg-emerald-50 text-emerald-700 border-emerald-200/80', icon: CheckCircle2 }
    case 'validating':
      return { label: 'Validando pago', className: 'bg-amber-50 text-amber-700 border-amber-200/80', icon: Clock }
    case 'rejected':
      return { label: 'Pago rechazado', className: 'bg-red-50 text-red-700 border-red-200/80', icon: XCircle }
    case 'pending':
    default:
      return { label: 'Pago pendiente', className: 'bg-orange-50 text-orange-700 border-orange-200/80', icon: AlertCircle }
  }
}

function getOrderStatusBadgeConfig(status: string) {
  switch (status) {
    case 'pending':
      return { label: 'Pendiente', className: 'bg-yellow-50 text-yellow-700 border-yellow-200', icon: Clock }
    case 'borrador':
      return { label: 'Borrador', className: 'bg-slate-50 text-slate-700 border-slate-200', icon: Edit3 }
    case 'confirmed':
      return { label: 'Confirmado', className: 'bg-blue-50 text-blue-700 border-blue-200', icon: CheckCircle2 }
    case 'preparing':
      return { label: 'Preparando', className: 'bg-amber-50 text-amber-700 border-amber-200', icon: Flame }
    case 'ready':
      return { label: 'Listo', className: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: PackageCheck }
    case 'on_way':
      return { label: 'En camino', className: 'bg-indigo-50 text-indigo-700 border-indigo-200', icon: Bike }
    case 'delivered':
      return { label: 'Entregado', className: 'bg-emerald-100 text-emerald-800 border-emerald-300', icon: CheckCircle2 }
    case 'cancelled':
      return { label: 'Cancelado', className: 'bg-red-50 text-red-700 border-red-200', icon: XCircle }
    default:
      return { label: status, className: 'bg-gray-50 text-gray-700 border-gray-200', icon: Info }
  }
}

export default function BottomNavigation() {
  const pathname = usePathname() ?? ''
  const { user } = useAuth()
  
  const isBusinessRoute = pathname.startsWith('/business')
  const isDeliveryRoute = pathname.startsWith('/delivery')
  const isCheckoutRoute = pathname === '/checkout'
  const isAdminRoute = pathname.startsWith('/admin')
  const isOrderRoute = pathname.startsWith('/o/')
  const isPedidosRoute = pathname.startsWith('/pedidos')
  const isTmaRoute = pathname.startsWith('/tma')

  const showNav = !isBusinessRoute && !isDeliveryRoute && !isCheckoutRoute && !isAdminRoute && !isOrderRoute && !isPedidosRoute && !isTmaRoute

  const [activeUrl, setActiveUrl] = useState('')
  const [showOrdersSheet, setShowOrdersSheet] = useState(false)
  const [activeOrders, setActiveOrders] = useState<any[]>([])
  const [loadingOrders, setLoadingOrders] = useState(false)
  
  const [isOrderSidebarOpen, setIsOrderSidebarOpen] = useState(false)
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null)

  // ESTADOS Y CÁLCULO DE RECOMENDACIONES
  const [showRecommendationsSidebar, setShowRecommendationsSidebar] = useState(false)
  const [clientReferrals, setClientReferrals] = useState<any[]>([])
  const [walletBalance, setWalletBalance] = useState({ referralCredits: 0, manualBalance: 0 })
  const [referralStats, setReferralStats] = useState({ totalClicks: 0, totalSales: 0, totalCredits: 0 })
  const [loadingRecommendations, setLoadingRecommendations] = useState(false)

  const [referralModalOpen, setReferralModalOpen] = useState(false)
  const [selectedReferralProduct, setSelectedReferralProduct] = useState<any>(null)
  const [selectedReferralLink, setSelectedReferralLink] = useState('')
  const [selectedReferralBusinessName, setSelectedReferralBusinessName] = useState('')

  const loadRecommendations = useCallback(async () => {
    if (!user) return
    setLoadingRecommendations(true)
    try {
      const [referralsById, referralsByPhone, creditsById, creditsByPhone] = await Promise.all([
        getUserReferrals(user.id),
        user.celular ? getUserReferrals(user.celular) : Promise.resolve([]),
        getAllUserCredits(user.id),
        user.celular ? getAllUserCredits(user.celular) : Promise.resolve([])
      ])

      const combinedReferrals = [...referralsById]
      referralsByPhone.forEach(ref => {
        if (!combinedReferrals.some(r => r.id === ref.id)) {
          combinedReferrals.push(ref)
        }
      })

      const combinedCredits = [...creditsById]
      creditsByPhone.forEach(credit => {
        if (combinedCredits.some(c => c.id === credit.id)) return
        const index = combinedCredits.findIndex(c => c.businessId === credit.businessId)
        if (index === -1) {
          combinedCredits.push(credit)
        } else {
          combinedCredits[index].availableCredits = (combinedCredits[index].availableCredits || 0) + (credit.availableCredits || 0)
          combinedCredits[index].balance = (combinedCredits[index].balance || 0) + (credit.balance || 0)
        }
      })

      combinedReferrals.sort((a, b) => {
        const earningsA = (a.conversions || 0) * 0.25
        const earningsB = (b.conversions || 0) * 0.25
        if (earningsB !== earningsA) return earningsB - earningsA
        const dateA = a.createdAt?.toDate ? a.createdAt.toDate() : a.createdAt ? new Date(a.createdAt) : new Date(0)
        const dateB = b.createdAt?.toDate ? b.createdAt.toDate() : b.createdAt ? new Date(b.createdAt) : new Date(0)
        return dateB.getTime() - dateA.getTime()
      })

      const referralCredits = combinedCredits.reduce((sum, c) => sum + (c.availableCredits || 0), 0)
      const manualBalance = combinedCredits.reduce((sum, c) => sum + (c.balance || 0), 0)

      setClientReferrals(combinedReferrals)
      setWalletBalance({ referralCredits, manualBalance })
      setReferralStats({
        totalClicks: combinedReferrals.reduce((sum, r) => sum + (r.clicks || 0), 0),
        totalSales: combinedReferrals.reduce((sum, r) => sum + (r.conversions || 0), 0),
        totalCredits: referralCredits + manualBalance
      })
    } catch (e) {
      console.error('Error loading recommendations in bottom nav:', e)
    } finally {
      setLoadingRecommendations(false)
    }
  }, [user])

  useEffect(() => {
    if (showRecommendationsSidebar && user) {
      loadRecommendations()
    }
  }, [showRecommendationsSidebar, user, loadRecommendations])

  const handleReferralClick = (referral: any) => {
    setSelectedReferralProduct(referral.product)
    setSelectedReferralLink(referral.referralLink || '')
    setSelectedReferralBusinessName(referral.businessName || '')
    setReferralModalOpen(true)
  }

  const formatNotificationDate = (value: any) => {
    if (!value) return ''
    const date = value?.toDate ? value.toDate() : new Date(value)
    return date.toLocaleDateString('es-EC', { day: '2-digit', month: 'short' })
  }

  useEffect(() => {
    setActiveUrl(window.location.pathname + window.location.search)
  }, [pathname])

  // Lógica de active orders (migrada de ActiveOrdersBubble)
  useEffect(() => {
    if (user?.celular && showNav) {
      setLoadingOrders(true)
      const fetchOrders = async () => {
        try {
          const orders = await getOrdersByClient(user.celular)
          const active = orders.filter((o: any) =>
            !['delivered', 'cancelled', 'borrador'].includes(o.status)
          )

          const enriched = await Promise.all(active.map(async (o: any) => {
            const biz = await getBusiness(o.businessId)
            return { ...o, businessName: biz?.name, businessImage: biz?.image }
          }))

          setActiveOrders(enriched)
        } catch (error) {
          console.error('Error fetching active orders for bottom nav:', error)
        } finally {
          setLoadingOrders(false)
        }
      }

      fetchOrders()
      const interval = setInterval(fetchOrders, 15000) 
      return () => clearInterval(interval)
    } else {
      setActiveOrders([])
    }
  }, [user, showNav])

  if (!showNav) return null

  const isActive = (path: string, exact: boolean = false) => {
    if (exact) {
      return activeUrl === path || (path === '/' && activeUrl === '')
    }
    return activeUrl.includes(path)
  }

  const getStatusInfo = (status: string) => {
    switch(status) {
      case 'pending': return { text: 'Pendiente', icon: 'bi-clock', color: 'bg-orange-100 text-orange-700', dot: 'bg-orange-500' }
      case 'confirmed': return { text: 'Confirmado', icon: 'bi-check-circle', color: 'bg-blue-100 text-blue-700', dot: 'bg-blue-500' }
      case 'preparing': return { text: 'Preparando', icon: 'bi-fire', color: 'bg-yellow-100 text-yellow-700', dot: 'bg-yellow-500' }
      case 'ready': return { text: 'Listo', icon: 'bi-bag-check', color: 'bg-green-100 text-green-700', dot: 'bg-green-500' }
      case 'assigned': return { text: 'En Camino', icon: 'bi-bicycle', color: 'bg-indigo-100 text-indigo-700', dot: 'bg-indigo-500' }
      case 'delivering': return { text: 'Cerca', icon: 'bi-geo-alt', color: 'bg-purple-100 text-purple-700', dot: 'bg-purple-500' }
      default: return { text: 'Activo', icon: 'bi-info-circle', color: 'bg-gray-100 text-gray-700', dot: 'bg-gray-500' }
    }
  }

  return (
    <>
      <div className="pb-16" /> 

      {/* MODAL BOTTOM SHEET DE PEDIDOS */}
      {showOrdersSheet && (
        <div className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm flex flex-col justify-end">
          <div 
            className="flex-1" 
            onClick={() => setShowOrdersSheet(false)} 
          />
          <div className="bg-gray-50 rounded-t-3xl p-5 pb-6 shadow-2xl animate-in slide-in-from-bottom-full duration-300 md:max-w-md md:mx-auto md:rounded-b-3xl md:mb-4 max-h-[85vh] flex flex-col overflow-hidden">
            <div className="flex justify-between items-center mb-4 flex-shrink-0">
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold tracking-tight text-gray-900">Mis Pedidos</h2>
                {activeOrders.length > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-700">
                    {activeOrders.length}
                  </span>
                )}
              </div>
              <button 
                onClick={() => setShowOrdersSheet(false)}
                className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-300 transition-colors"
              >
                <i className="bi bi-x-lg text-sm"></i>
              </button>
            </div>

            <div className="overflow-y-auto flex-1 space-y-4 pr-1 pb-4">
              {loadingOrders && activeOrders.length === 0 ? (
                <div className="flex justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#aa1918]"></div>
                </div>
              ) : activeOrders.length > 0 ? (
                <div className="space-y-3">
                  {activeOrders.map((order) => {
                    const itemsSummary = Array.isArray(order.items) && order.items.length > 0
                      ? order.items.map((i: any) => `${i.quantity || 1}x ${i.name || i.producto || 'Producto'}`).join(', ')
                      : 'Detalle del pedido no disponible'

                    const paymentBadge = getPaymentBadgeConfig(order.payment?.paymentStatus)
                    const statusBadge = getOrderStatusBadgeConfig(order.status)
                    const PaymentIcon = paymentBadge.icon
                    const StatusIcon = statusBadge.icon

                    return (
                      <div
                        key={order.id}
                        onClick={() => {
                          setSelectedOrderId(order.id)
                          setIsOrderSidebarOpen(true)
                          setShowOrdersSheet(false)
                        }}
                        className="w-full bg-white p-4 rounded-2xl border border-gray-200 hover:border-gray-900 shadow-sm hover:shadow-md transition-all group cursor-pointer text-left space-y-3"
                      >
                        {/* Header: Logo + Flow (Tienda -> Dirección) + Valor a Pagar / Estado Pago Unificado */}
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            <div className="w-11 h-11 rounded-xl overflow-hidden bg-gray-50 border border-gray-100 flex-shrink-0 shadow-sm group-hover:scale-105 transition-transform">
                              <img
                                src={order.businessImage || '/default-restaurant-og.svg'}
                                alt={order.businessName || 'Tienda'}
                                className="w-full h-full object-cover"
                              />
                            </div>
                            <div className="min-w-0 flex-1">
                              <h4 className="font-black text-gray-900 text-sm tracking-tight leading-tight truncate">
                                {order.businessName || 'Tienda'}
                              </h4>
                              <div className="flex items-center gap-1.5 mt-1 min-w-0">
                                <ArrowRight size={12} className="text-emerald-500 flex-shrink-0" />
                                <span
                                  className="text-xs font-medium text-gray-600 truncate"
                                  title={order.delivery?.type === 'pickup' ? 'Retiro en local' : (order.delivery?.references || (order.delivery as any)?.reference || 'Entrega a domicilio')}
                                >
                                  {order.delivery?.type === 'pickup'
                                    ? 'Retiro en local'
                                    : (order.delivery?.references || (order.delivery as any)?.reference || order.delivery?.sector || 'Entrega a domicilio')}
                                </span>
                              </div>
                            </div>
                          </div>
                          {/* Esquina Superior Derecha: Unificación de Valor y Estado del Pago */}
                          <div className="text-right flex-shrink-0">
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl border ${paymentBadge.className}`}>
                              <PaymentIcon size={11} />
                              <span className="text-xs font-black">${(order.total || 0).toFixed(2)}</span>
                              <span className="text-[10px] font-bold border-l border-current/20 pl-1.5">{paymentBadge.label}</span>
                            </span>
                          </div>
                        </div>

                        {/* Detalle del pedido */}
                        <div className="bg-gray-50/90 p-2.5 rounded-xl border border-gray-100">
                          <p className="text-[11px] font-medium text-gray-700 leading-snug line-clamp-2">
                            {itemsSummary}
                          </p>
                        </div>

                        {/* Footer: Estado del Pedido */}
                        <div className="flex items-center justify-between pt-1 gap-2 border-t border-gray-100">
                          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Estado del pedido</span>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full border ${statusBadge.className}`}>
                              <StatusIcon size={11} />
                              <span>{statusBadge.label}</span>
                            </span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="bg-white rounded-2xl p-6 text-center shadow-sm border border-gray-100 flex flex-col items-center">
                  <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mb-3">
                    <i className="bi bi-box-seam text-xl text-gray-400"></i>
                  </div>
                  <h3 className="font-bold text-gray-600">Sin órdenes activas</h3>
                  <p className="text-xs text-gray-400 mt-1">No tienes pedidos en curso ahora mismo.</p>
                </div>
              )}

              <Link 
                href="/my-orders"
                onClick={() => {
                  setShowOrdersSheet(false)
                  setActiveUrl('/my-orders')
                }}
                className="w-full bg-white border border-gray-200 text-gray-900 font-bold tracking-wide py-3.5 rounded-2xl flex items-center justify-center gap-2 hover:bg-gray-50 active:scale-[0.98] transition-all shadow-sm"
              >
                <i className="bi bi-list-ul"></i>
                Historial completo de pedidos
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Navigation */}
      <div 
        className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 z-[65] shadow-[0_-5px_10px_rgb(0,0,0,0.02)] md:max-w-md md:mx-auto md:rounded-t-2xl md:border-x md:border-gray-100"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex justify-around items-center h-16 px-2">
          {/* TIENDAS */}
          <Link 
            href="/" 
            onClick={() => setActiveUrl('/')}
            className={`flex flex-col items-center justify-center w-full h-full gap-1 transition-all ${isActive('/', true) ? 'text-[#aa1918]' : 'text-gray-400 hover:text-gray-900'}`}
          >
            <div className={`relative p-1 rounded-xl transition-all ${isActive('/', true) ? 'bg-red-50' : ''}`}>
              <Store size={20} strokeWidth={isActive('/', true) ? 2.5 : 1.5} />
            </div>
            <span className="text-[10px] font-bold tracking-tight">Tiendas</span>
          </Link>
          
          {/* FUDDIES - SOCIAL / OPINIONES */}
          <Link 
            href="/fuddies" 
            onClick={() => setActiveUrl('/fuddies')}
            className={`flex flex-col items-center justify-center w-full h-full gap-1 transition-all ${isActive('/fuddies') ? 'text-[#aa1918]' : 'text-gray-400 hover:text-gray-900'}`}
          >
            <div className={`relative p-1 rounded-xl transition-all ${isActive('/fuddies') ? 'bg-red-50' : ''}`}>
              <FuddieIcon size={20} className="w-5 h-5 transition-transform" />
            </div>
            <span className="text-[10px] font-bold tracking-tight">Fuddies</span>
          </Link>

          {/* RECOMENDACIONES - AHORA ABRE EL SIDEBAR */}
          <button
            type="button"
            onClick={() => {
              if (user) {
                setShowRecommendationsSidebar(true)
              } else {
                window.location.href = "/"
              }
            }}
            className={`flex flex-col items-center justify-center w-full h-full gap-1 transition-all ${showRecommendationsSidebar ? 'text-[#aa1918]' : 'text-gray-400 hover:text-gray-900'}`}
          >
            <div className={`relative p-1 rounded-xl transition-all ${showRecommendationsSidebar ? 'bg-red-50' : ''}`}>
              <Flame size={20} strokeWidth={showRecommendationsSidebar ? 2.5 : 1.5} />
            </div>
            <span className="text-[10px] font-bold tracking-tight">Recomendados</span>
          </button>

          {/* PEDIDOS - AHORA ABRE EL MODAL */}
          <button
            onClick={() => {
              if (user) {
                setShowOrdersSheet(true)
                setActiveUrl('/my-orders')
              } else {
                window.location.href = "/" // Fallback if no user
              }
            }}
            className={`flex flex-col items-center justify-center w-full h-full gap-1 transition-all relative ${isActive('/my-orders') || showOrdersSheet ? 'text-[#aa1918]' : 'text-gray-400 hover:text-gray-900'}`}
          >
            {activeOrders.length > 0 ? (
              <>
                <div className={`relative p-0.5 rounded-full transition-all ${isActive('/my-orders') || showOrdersSheet ? 'bg-red-100 ring-2 ring-red-100' : 'bg-gray-100 ring-1 ring-gray-100'}`}>
                  <div className="w-6 h-6 rounded-full overflow-hidden bg-white">
                    <img src={activeOrders[0].businessImage || '/default-restaurant-og.svg'} alt="Tienda" className="w-full h-full object-cover" />
                  </div>
                  <span className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border-2 border-white ${getStatusInfo(activeOrders[0].status).dot} animate-pulse`}></span>
                </div>
                <span className={`text-[9px] font-black tracking-tight uppercase line-clamp-1 px-0.5 ${getStatusInfo(activeOrders[0].status).color.split(' ')[1] || ''}`}>
                  {getStatusInfo(activeOrders[0].status).text}
                </span>
              </>
            ) : (
              <>
                <div className={`relative p-1 rounded-xl transition-all ${isActive('/my-orders') || showOrdersSheet ? 'bg-red-50' : ''}`}>
                  <i className={`bi bi-receipt${isActive('/my-orders') || showOrdersSheet ? '-cutoff' : ''} text-xl leading-none`}></i>
                </div>
                <span className="text-[10px] font-bold tracking-tight">Pedidos</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Sidebar de Recomendaciones */}
      <ClientRecommendationsSidebar
        isOpen={showRecommendationsSidebar}
        onClose={() => setShowRecommendationsSidebar(false)}
        referrals={clientReferrals}
        referralStats={referralStats}
        walletBalance={walletBalance}
        loading={loadingRecommendations}
        formatDate={formatNotificationDate}
        onReferralClick={handleReferralClick}
      />

      {/* Modal de Detalle de Referido */}
      <ReferralModal
        isOpen={referralModalOpen}
        onClose={() => setReferralModalOpen(false)}
        product={selectedReferralProduct}
        referralLink={selectedReferralLink}
        businessName={selectedReferralBusinessName}
      />

      {/* Sidebar de Detalles de Orden */}
      {isOrderSidebarOpen && selectedOrderId && (
        <div className="z-[70] relative">
          <OrderSidebar 
            isOpen={isOrderSidebarOpen}
            orderId={selectedOrderId}
            onClose={() => setIsOrderSidebarOpen(false)}
          />
        </div>
      )}
    </>
  )
}
