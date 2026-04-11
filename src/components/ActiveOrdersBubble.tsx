'use client'

import { useState, useEffect } from 'react'
import { getOrdersByClient, getBusiness } from '@/lib/database'
import { useAuth } from '@/contexts/AuthContext'
import OrderSidebar from '@/components/OrderSidebar'

export default function ActiveOrdersBubble() {
  const { user } = useAuth()
  const [activeOrders, setActiveOrders] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [isOrderSidebarOpen, setIsOrderSidebarOpen] = useState(false)
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null)

  useEffect(() => {
    if (user?.celular) {
      setLoading(true)
      const fetchOrders = async () => {
        try {
          const orders = await getOrdersByClient(user.celular)
          const active = orders.filter((o: any) =>
            !['delivered', 'cancelled', 'rejected'].includes(o.status)
          )

          // Obtenemos info del negocio
          const enriched = await Promise.all(active.map(async (o: any) => {
            const biz = await getBusiness(o.businessId)
            return { ...o, businessName: biz?.name, businessImage: biz?.image }
          }))

          setActiveOrders(enriched)
        } catch (error) {
          console.error('Error fetching active orders for bubble:', error)
        } finally {
          setLoading(false)
        }
      }

      fetchOrders()
      // Polling cada 15 segundos para mantener actualizado el estado
      const interval = setInterval(fetchOrders, 15000) 
      return () => clearInterval(interval)
    } else {
      setActiveOrders([])
    }
  }, [user])

  if (!user || activeOrders.length === 0) return null

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
      <div className="fixed bottom-24 lg:bottom-10 right-4 lg:right-10 z-[100] flex flex-col items-end gap-3 pointer-events-none">
        
        {activeOrders.map((order, index) => {
          const statusInfo = getStatusInfo(order.status)
          
          return (
            <button 
              key={order.id}
              onClick={() => {
                setSelectedOrderId(order.id)
                setIsOrderSidebarOpen(true)
              }}
              className="relative pointer-events-auto group flex items-center bg-white p-1.5 rounded-full shadow-[0_8px_30px_rgb(0,0,0,0.12)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.2)] transition-all duration-300 border border-gray-100 hover:scale-105 active:scale-95 animate-in slide-in-from-bottom flex-shrink-0"
            >
              {/* Status Indicator */}
              <div className={`absolute -top-3 -left-3 px-2 py-1 ${statusInfo.color} rounded-full text-[9px] font-black uppercase tracking-widest shadow-sm flex items-center gap-1.5 z-10 border-2 border-white`}>
                <span className={`w-1.5 h-1.5 rounded-full ${statusInfo.dot} animate-pulse`}></span>
                <i className={`bi ${statusInfo.icon}`}></i>
              </div>

              {/* Imagen del Negocio */}
              <div className="w-14 h-14 rounded-full overflow-hidden border-2 border-white shadow-inner bg-gray-50 bg-white">
                <img 
                  src={order.businessImage || '/default-restaurant-og.svg'} 
                  alt={order.businessName || 'Restaurante'} 
                  className="w-full h-full object-cover" 
                />
              </div>
              
              {/* Tooltip on hover (desktop only) */}
              <div className="absolute right-full mr-4 px-3 py-2 bg-gray-900 text-white text-xs font-bold rounded-xl whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none hidden md:block">
                Ver orden en {order.businessName || 'Tienda'}
              </div>

              {/* Ping Animation behind button */}
              <div className={`absolute inset-0 rounded-full border-2 ${statusInfo.color.split(' ')[1].replace('text-', 'border-')} opacity-30 animate-ping -z-10`}></div>
            </button>
          )
        })}
      </div>

      {/* Sidebar de Detalles de Orden */}
      {isOrderSidebarOpen && selectedOrderId && (
        <OrderSidebar 
          isOpen={isOrderSidebarOpen}
          orderId={selectedOrderId}
          onClose={() => setIsOrderSidebarOpen(false)}
        />
      )}
    </>
  )
}
