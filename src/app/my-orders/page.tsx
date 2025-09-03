'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { getOrdersByClient, getBusiness } from '@/lib/database'
import Link from 'next/link'

interface Order {
  id: string
  customer: {
    name: string
    phone: string
  }
  business: {
    id: string
    name: string
    address: string
  }
  items: Array<{
    name: string
    quantity: number
    price: number
    subtotal: number
  }>
  delivery: {
    type: 'delivery' | 'pickup'
    address?: string
    references?: string
    fee?: number
  }
  payment: {
    method: 'cash' | 'transfer'
    bankDetails?: any
  }
  scheduling: {
    type: 'immediate' | 'scheduled'
    date?: string
    time?: string
  }
  total: number
  status: 'pending' | 'confirmed' | 'preparing' | 'ready' | 'delivered' | 'cancelled'
  createdAt: Date
  updatedAt: Date
}

export default function MyOrdersPage() {
  const { user, isAuthenticated } = useAuth()
  const router = useRouter()
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/')
      return
    }

    loadOrders()
  }, [user, isAuthenticated, router])

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
                address: business.address
              } : {
                id: order.businessId,
                name: 'Negocio no disponible',
                address: ''
              }
            }
          } catch (err) {
            console.error('Error loading business:', err)
            return {
              ...order,
              business: {
                id: order.businessId,
                name: 'Negocio no disponible',
                address: ''
              }
            }
          }
        })
      )

      setOrders(enrichedOrders)
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
                    <div>
                      <h3 className="text-lg font-medium text-gray-900">{order.business.name}</h3>
                      <p className="text-sm text-gray-600">Pedido #{order.id.slice(-8)}</p>
                    </div>
                    <div className="text-right">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(order.status)}`}>
                        {getStatusText(order.status)}
                      </span>
                      <p className="text-sm text-gray-500 mt-1">
                        {order.createdAt.toLocaleDateString('es-ES', { 
                          year: 'numeric', 
                          month: 'short', 
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </p>
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
                            {item.quantity}x {item.name}
                          </span>
                          <span className="font-medium">${item.subtotal.toFixed(2)}</span>
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
                    {order.delivery.type === 'delivery' && order.delivery.address && (
                      <p className="text-gray-600 ml-5">{order.delivery.address}</p>
                    )}
                  </div>

                  {/* Total */}
                  <div className="border-t pt-4">
                    <div className="flex justify-between items-center">
                      <span className="text-lg font-medium text-gray-900">Total:</span>
                      <span className="text-lg font-bold text-red-600">${order.total.toFixed(2)}</span>
                    </div>
                  </div>
                </div>

                {/* Acciones */}
                <div className="px-6 py-4 bg-gray-50 border-t">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4 text-sm text-gray-600">
                      <span className="flex items-center">
                        <i className={`bi ${order.payment.method === 'cash' ? 'bi-cash' : 'bi-credit-card'} mr-1`}></i>
                        {order.payment.method === 'cash' ? 'Efectivo' : 'Transferencia'}
                      </span>
                      <span className="flex items-center">
                        <i className={`bi ${order.scheduling.type === 'immediate' ? 'bi-clock' : 'bi-calendar'} mr-1`}></i>
                        {order.scheduling.type === 'immediate' ? 'Inmediato' : 'Programado'}
                      </span>
                    </div>
                    
                    {order.status === 'pending' && (
                      <div className="flex space-x-2">
                        <button className="text-red-600 hover:text-red-700 text-sm font-medium">
                          Cancelar
                        </button>
                      </div>
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
