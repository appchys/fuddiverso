'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { getOrdersByClient, getBusiness, getDeliveryById } from '@/lib/database'
import Link from 'next/link'

interface Order {
  id: string
  businessId: string
  customer: {
    name: string
    phone: string
  }
  business?: {
    id: string
    name: string
    address: string
    image?: string
  }
  items: Array<{
    name: string
    quantity: number
    price: number
    productId: string
    variant?: string
  }>
  delivery: {
    type: 'delivery' | 'pickup'
    deliveryCost?: number
    latlong?: string
    references?: string
    assignedDelivery?: string
  }
  payment: {
    method: 'cash' | 'transfer'
    paymentStatus: string
    selectedBank?: string
  }
  timing: {
    type: 'immediate' | 'scheduled'
    scheduledDate?: any
    scheduledTime?: string
  }
  subtotal: number
  total: number
  status: 'pending' | 'confirmed' | 'preparing' | 'ready' | 'delivered' | 'cancelled'
  createdAt: Date
  updatedAt?: Date
  createdByAdmin?: boolean
}

export default function MyOrdersPage() {
  const { user, isAuthenticated } = useAuth()
  const router = useRouter()
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [currentTime, setCurrentTime] = useState(new Date())

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/')
      return
    }

    loadOrders()
  }, [user, isAuthenticated, router])

  // Actualizar tiempo cada minuto para mostrar información en tiempo real
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date())
    }, 60000) // Actualizar cada minuto

    return () => clearInterval(interval)
  }, [])

  const loadOrders = async () => {
    if (!user?.celular) return

    setLoading(true)
    try {
      const userOrders = await getOrdersByClient(user.celular)
      
      // Enriquecer pedidos con información del negocio
      const enrichedOrders = await Promise.all(
        userOrders.map(async (order) => {
          try {
            const business = await getBusiness(order.businessId)
            return {
              ...order,
              business: business ? {
                id: business.id,
                name: business.name,
                address: business.address,
                image: business.image
              } : {
                id: order.businessId,
                name: 'Negocio no disponible',
                address: '',
                image: undefined
              }
            }
          } catch (err) {
            console.error('Error loading business:', err)
            return {
              ...order,
              business: {
                id: order.businessId,
                name: 'Negocio no disponible',
                address: '',
                image: undefined
              }
            }
          }
        })
      )

      // Ordenar por fecha de entrega (más próximos primero)
      const sortedOrders = enrichedOrders.sort((a, b) => {
        // Función helper para obtener la fecha/hora de entrega
        const getDeliveryDateTime = (order: Order) => {
          if (order.timing?.type === 'scheduled' && order.timing.scheduledDate) {
            // Para pedidos programados, usar la fecha programada
            const baseDate = new Date(order.timing.scheduledDate.seconds * 1000)
            
            // Si hay hora programada, agregar la hora
            if (order.timing.scheduledTime) {
              const [hours, minutes] = order.timing.scheduledTime.split(':').map(Number)
              baseDate.setHours(hours, minutes, 0, 0)
            }
            
            return baseDate.getTime()
          } else {
            // Para pedidos inmediatos, usar la fecha de creación
            return new Date(order.createdAt).getTime()
          }
        }
        
        const dateA = getDeliveryDateTime(a)
        const dateB = getDeliveryDateTime(b)
        
        return dateA - dateB
      })

      setOrders(sortedOrders)
    } catch (err) {
      console.error('Error loading orders:', err)
      setError('Error al cargar los pedidos')
    } finally {
      setLoading(false)
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-yellow-100 text-yellow-800'
      case 'confirmed': return 'bg-blue-100 text-blue-800'
      case 'preparing': return 'bg-orange-100 text-orange-800'
      case 'ready': return 'bg-purple-100 text-purple-800'
      case 'delivered': return 'bg-green-100 text-green-800'
      case 'cancelled': return 'bg-red-100 text-red-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const getStatusText = (status: string) => {
    switch (status) {
      case 'pending': return 'Pendiente'
      case 'confirmed': return 'Confirmado'
      case 'preparing': return 'En preparación'
      case 'ready': return 'Listo'
      case 'delivered': return 'Entregado'
      case 'cancelled': return 'Cancelado'
      default: return status
    }
  }

  const handleOrderReceived = (orderId: string) => {
    // TODO: Implementar actualización del estado del pedido a "delivered"
    console.log('Pedido recibido:', orderId)
    // Aquí puedes agregar la lógica para actualizar el estado en Firebase
  }

  const handleContactDelivery = async (order: Order) => {
    try {
      if (order.delivery.assignedDelivery) {
        const delivery = await getDeliveryById(order.delivery.assignedDelivery)
        if (delivery && delivery.celular) {
          const phone = delivery.celular
          const message = `Hola ${delivery.nombres || 'estimado repartidor'}, tengo una consulta sobre mi pedido del negocio ${order.business?.name || 'negocio'}. ¡Gracias!`
          window.open(`https://wa.me/593${phone.substring(1)}?text=${encodeURIComponent(message)}`, '_blank')
        } else {
          alert('No se pudo obtener la información del repartidor')
        }
      } else {
        alert('No hay repartidor asignado para este pedido')
      }
    } catch (error) {
      console.error('Error getting delivery info:', error)
      alert('Error al obtener la información del repartidor')
    }
  }

  const handleContactBusiness = async (order: Order) => {
    try {
      const business = await getBusiness(order.businessId)
      if (business && business.celular) {
        const phone = business.celular
        const message = `Hola ${business.name}, tengo una consulta sobre mi pedido para retiro. ¡Gracias!`
        window.open(`https://wa.me/593${phone.substring(1)}?text=${encodeURIComponent(message)}`, '_blank')
      } else {
        alert('No se pudo obtener la información de contacto del negocio')
      }
    } catch (error) {
      console.error('Error getting business info:', error)
      alert('Error al obtener la información del negocio')
    }
  }

  const getDeliveryText = (order: Order) => {
    if (!order.timing?.scheduledDate) return 'Horario no definido'
    
    const scheduledDate = new Date(order.timing.scheduledDate.seconds * 1000)
    const timeText = order.timing.scheduledTime || ''
    
    // Verificar si es hoy
    const today = new Date()
    const isToday = scheduledDate.toDateString() === today.toDateString()
    
    if (order.timing.type === 'immediate') {
      if (isToday) {
        return `Entrega estimada: Hoy a las ${timeText}`
      } else {
        const dateText = scheduledDate.toLocaleDateString('es-ES', { 
          weekday: 'long',
          day: 'numeric', 
          month: 'long'
        })
        return `Entrega estimada: ${dateText} a las ${timeText}`
      }
    } else {
      if (isToday) {
        return `Programado para: Hoy a las ${timeText}`
      } else {
        const dateText = scheduledDate.toLocaleDateString('es-ES', { 
          weekday: 'long',
          day: 'numeric', 
          month: 'long'
        })
        return `Programado para: ${dateText} a las ${timeText}`
      }
    }
  }

  if (!isAuthenticated || !user) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-red-500 mx-auto"></div>
          <p className="mt-4 text-gray-600">Verificando acceso...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Mis Pedidos</h1>
          <p className="mt-2 text-gray-600">Historial de todos tus pedidos</p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-500"></div>
            <span className="ml-3 text-gray-600">Cargando pedidos...</span>
          </div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
            <i className="bi bi-exclamation-triangle text-red-500 text-2xl mb-2"></i>
            <p className="text-red-700">{error}</p>
            <button 
              onClick={loadOrders}
              className="mt-4 bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700"
            >
              Reintentar
            </button>
          </div>
        ) : orders.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm p-8 text-center">
            <i className="bi bi-bag text-gray-400 text-4xl mb-4"></i>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No tienes pedidos aún</h3>
            <p className="text-gray-600 mb-6">¡Explora nuestros restaurantes y haz tu primer pedido!</p>
            <Link 
              href="/"
              className="inline-flex items-center bg-red-600 text-white px-6 py-3 rounded-lg hover:bg-red-700"
            >
              <i className="bi bi-search mr-2"></i>
              Explorar Restaurantes
            </Link>
          </div>
        ) : (
          <div className="space-y-6">
            {orders.map((order) => (
              <div key={order.id} className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                {/* Header del pedido */}
                <div className="px-6 py-4 bg-gray-50 border-b">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                      {/* Imagen de la tienda */}
                      <div className="w-12 h-12 rounded-lg overflow-hidden flex-shrink-0">
                        {order.business?.image ? (
                          <img 
                            src={order.business.image} 
                            alt={order.business.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full bg-gray-200 flex items-center justify-center">
                            <i className="bi bi-shop text-gray-400 text-lg"></i>
                          </div>
                        )}
                      </div>
                      <div>
                        <h3 className="text-lg font-medium text-gray-900">{order.business?.name || 'Negocio no disponible'}</h3>
                        <p className="text-sm text-gray-600">
                          {getDeliveryText(order)}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(order.status)}`}>
                        {getStatusText(order.status)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Contenido del pedido */}
                <div className="px-6 py-4">
                  {/* Items */}
                  <div className="mb-4">
                    <h4 className="text-sm font-medium text-gray-900 mb-2">Productos:</h4>
                    <div className="space-y-2">
                      {order.items.map((item, index) => (
                        <div key={index} className="flex justify-between items-center text-sm">
                          <span className="text-gray-600">
                            {item.quantity || 0}x {item.name}
                          </span>
                          <span className="font-medium">${((item.price || 0) * (item.quantity || 0)).toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Información de entrega */}
                  <div className="mb-4 text-sm">
                    <div className="flex items-center text-gray-600 mb-1">
                      <i className={`bi ${order.delivery.type === 'delivery' ? 'bi-scooter' : 'bi-bag'} mr-2`}></i>
                      <span className="font-medium">
                        {order.delivery.type === 'delivery' ? 'Delivery' : 'Retiro en tienda'}
                      </span>
                    </div>
                    {order.delivery.type === 'delivery' && order.delivery.references && (
                      <p className="text-gray-600 ml-5">{order.delivery.references}</p>
                    )}
                  </div>

                  {/* Total */}
                  <div className="border-t pt-4">
                    <div className="flex justify-between items-center">
                      <span className="text-lg font-medium text-gray-900">Total:</span>
                      <span className="text-lg font-bold text-red-600">${(order.total || 0).toFixed(2)}</span>
                    </div>
                  </div>
                </div>

                {/* Acciones */}
                <div className="px-6 py-4 bg-gray-50 border-t">
                  {/* Información de pago y tipo en móviles */}
                  <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600 mb-4">
                    <span className="flex items-center">
                      <i className={`bi ${order.payment?.method === 'cash' ? 'bi-cash' : 'bi-credit-card'} mr-1`}></i>
                      {order.payment?.method === 'cash' ? 'Efectivo' : 'Transferencia'}
                    </span>
                    <span className="flex items-center">
                      <i className={`bi ${order.timing?.type === 'immediate' ? 'bi-clock' : 'bi-calendar'} mr-1`}></i>
                      {order.timing?.type === 'immediate' ? 'Inmediato' : 'Programado'}
                    </span>
                  </div>
                  
                  {/* Botones - stack en móviles, inline en desktop */}
                  <div className="flex flex-col sm:flex-row gap-3 sm:gap-2 sm:justify-end">
                    {/* Botón Contactar Repartidor - solo para delivery y pedidos listos */}
                    {order.delivery.type === 'delivery' && order.status === 'ready' && (
                      <button 
                        onClick={() => handleContactDelivery(order)}
                        className="w-full sm:w-auto inline-flex items-center justify-center px-4 py-3 sm:px-3 sm:py-1.5 text-sm bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors font-medium"
                      >
                        <i className="bi bi-chat-dots mr-2"></i>
                        Contactar Repartidor
                      </button>
                    )}
                    
                    {/* Botón Recibido - solo para pedidos ready */}
                    {order.status === 'ready' && (
                      <button 
                        onClick={() => handleOrderReceived(order.id)}
                        className="w-full sm:w-auto inline-flex items-center justify-center px-4 py-3 sm:px-3 sm:py-1.5 text-sm bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition-colors font-medium"
                      >
                        <i className="bi bi-check-circle mr-2"></i>
                        Marcar como Recibido
                      </button>
                    )}
                    
                    {/* Botón Cancelar - solo para pedidos pending */}
                    {order.status === 'pending' && (
                      <button className="w-full sm:w-auto inline-flex items-center justify-center px-4 py-3 sm:px-3 sm:py-1.5 text-sm bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors font-medium">
                        <i className="bi bi-x-circle mr-2"></i>
                        Cancelar Pedido
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
