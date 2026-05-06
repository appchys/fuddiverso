'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { Flame } from 'lucide-react'
import { getOrdersByClient, getBusiness } from '@/lib/database'
import OrderSidebar from '@/components/OrderSidebar'

export default function BottomNavigation() {
  const pathname = usePathname()
  const { user } = useAuth()
  
  // No mostrar en páginas en las que no resulta útil un nav universal
  const isBusinessRoute = pathname.startsWith('/business')
  const isDeliveryRoute = pathname.startsWith('/delivery')
  const isCheckoutRoute = pathname === '/checkout'
  const isAdminRoute = pathname.startsWith('/admin')
  const isOrderRoute = pathname.startsWith('/o/')

  const showNav = !isBusinessRoute && !isDeliveryRoute && !isCheckoutRoute && !isAdminRoute && !isOrderRoute

  const [activeUrl, setActiveUrl] = useState('')
  const [showOrdersSheet, setShowOrdersSheet] = useState(false)
  const [activeOrders, setActiveOrders] = useState<any[]>([])
  const [loadingOrders, setLoadingOrders] = useState(false)
  
  const [isOrderSidebarOpen, setIsOrderSidebarOpen] = useState(false)
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null)

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
            !['delivered', 'cancelled', 'rejected'].includes(o.status)
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
      <div className="md:hidden pb-16" /> 

      {/* MODAL BOTTOM SHEET DE PEDIDOS */}
      {showOrdersSheet && (
        <div className="md:hidden fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm flex flex-col justify-end">
          <div 
            className="flex-1" 
            onClick={() => setShowOrdersSheet(false)} 
          />
          <div className="bg-gray-50 rounded-t-3xl p-5 pb-24 shadow-2xl animate-in slide-in-from-bottom-full duration-300">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold tracking-tight text-gray-900">Mis Pedidos</h2>
              <button 
                onClick={() => setShowOrdersSheet(false)}
                className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-300"
              >
                <i className="bi bi-x-lg text-sm"></i>
              </button>
            </div>

            {loadingOrders && activeOrders.length === 0 ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#aa1918]"></div>
              </div>
            ) : activeOrders.length > 0 ? (
              <div className="space-y-3 mb-6">
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 ml-1">Órdenes Activas ({activeOrders.length})</h3>
                {activeOrders.map((order) => {
                  const statusInfo = getStatusInfo(order.status)
                  return (
                    <button
                      key={order.id}
                      onClick={() => {
                        setSelectedOrderId(order.id)
                        setIsOrderSidebarOpen(true)
                        setShowOrdersSheet(false)
                      }}
                      className="w-full bg-white rounded-2xl p-4 flex items-center gap-4 shadow-sm border border-gray-100 hover:border-gray-200 hover:shadow-md transition-all text-left group"
                    >
                      <div className="w-14 h-14 rounded-full border border-gray-100 flex-shrink-0 bg-gray-50 overflow-hidden">
                        <img 
                          src={order.businessImage || '/default-restaurant-og.svg'} 
                          alt={order.businessName || 'Restaurante'} 
                          className="w-full h-full object-cover" 
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-bold text-gray-900 truncate">{order.businessName || 'Orden Activa'}</h4>
                        <div className="flex items-center gap-2 mt-1">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase flex items-center gap-1 w-max ${statusInfo.color}`}>
                            <span className={`w-1 h-1 rounded-full ${statusInfo.dot} animate-pulse`}></span>
                            {statusInfo.text}
                          </span>
                          <span className="text-xs text-gray-400 font-medium">${order.total?.toFixed(2) || '0.00'}</span>
                        </div>
                      </div>
                      <i className="bi bi-chevron-right text-gray-300 group-hover:text-gray-500 transition-colors"></i>
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="bg-white rounded-2xl p-6 text-center shadow-sm border border-gray-100 mb-6 flex flex-col items-center">
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
      )}

      {/* Bottom Navigation */}
      <div 
        className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 z-[65] shadow-[0_-5px_10px_rgb(0,0,0,0.02)]"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex justify-around items-center h-16 px-2">
          {/* INICIO */}
          <Link 
            href="/" 
            onClick={() => setActiveUrl('/')}
            className={`flex flex-col items-center justify-center w-full h-full gap-1 transition-all ${isActive('/', true) ? 'text-[#aa1918]' : 'text-gray-400 hover:text-gray-900'}`}
          >
            <div className={`relative p-1 rounded-xl transition-all ${isActive('/', true) ? 'bg-red-50' : ''}`}>
              <i className={`bi bi-house${isActive('/', true) ? '-door-fill' : '-door'} text-xl leading-none`}></i>
            </div>
            <span className="text-[10px] font-bold tracking-tight">Inicio</span>
          </Link>
          
          {/* FAVORITOS */}
          <Link 
            href="/favorites" 
            onClick={() => setActiveUrl('/favorites')}
            className={`flex flex-col items-center justify-center w-full h-full gap-1 transition-all ${isActive('/favorites') ? 'text-[#aa1918]' : 'text-gray-400 hover:text-gray-900'}`}
          >
            <div className={`relative p-1 rounded-xl transition-all ${isActive('/favorites') ? 'bg-red-50' : ''}`}>
              <i className={`bi bi-heart${isActive('/favorites') ? '-fill' : ''} text-xl leading-none`}></i>
            </div>
            <span className="text-[10px] font-bold tracking-tight">Favoritos</span>
          </Link>

          {/* RECOMENDACIONES */}
          <Link
            href={user ? "/profile?tab=recommendations" : "/"}
            onClick={() => user && setActiveUrl('/profile?tab=recommendations')}
            className={`flex flex-col items-center justify-center w-full h-full gap-1 transition-all ${isActive('tab=recommendations') ? 'text-[#aa1918]' : 'text-gray-400 hover:text-gray-900'}`}
          >
            <div className={`relative p-1 rounded-xl transition-all ${isActive('tab=recommendations') ? 'bg-red-50' : ''}`}>
              <Flame size={20} strokeWidth={isActive('tab=recommendations') ? 2.5 : 1.5} />
            </div>
            <span className="text-[10px] font-bold tracking-tight">Recomendados</span>
          </Link>

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
