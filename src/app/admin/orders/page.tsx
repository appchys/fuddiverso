'use client'

import { useState, useEffect } from 'react'
import { getAllOrders, getAllBusinesses, updateOrderStatus } from '@/lib/database'
import { Order, Business } from '@/types'

export default function OrderManagement() {
  const [orders, setOrders] = useState<Order[]>([])
  const [businesses, setBusinesses] = useState<Business[]>([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState({
    status: 'all',
    business: 'all',
    search: ''
  })
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'amount'>('newest')
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null)

  useEffect(() => {
    loadData()
    
    // Auto refresh cada 30 segundos
    const interval = setInterval(loadData, 30000)
    return () => clearInterval(interval)
  }, [])

  const loadData = async () => {
    try {
      const [allOrders, allBusinesses] = await Promise.all([
        getAllOrders(),
        getAllBusinesses()
      ])

      // Filtrar datos válidos
      const validOrders = allOrders.filter(order => 
        order && 
        order.id && 
        order.customer && 
        order.customer.name && 
        typeof order.total === 'number'
      )
      
      const validBusinesses = allBusinesses.filter(business => 
        business && business.id && business.name
      )

      setOrders(validOrders)
      setBusinesses(validBusinesses)
    } catch (error) {
      console.error('Error loading data:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleStatusUpdate = async (orderId: string, newStatus: Order['status']) => {
    try {
      setUpdatingStatus(orderId)
      await updateOrderStatus(orderId, newStatus)
      
      // Actualizar estado local
      setOrders(prevOrders =>
        prevOrders.map(order =>
          order.id === orderId ? { ...order, status: newStatus } : order
        )
      )
    } catch (error) {
      console.error('Error updating status:', error)
      alert('Error al actualizar el estado del pedido')
    } finally {
      setUpdatingStatus(null)
    }
  }

  const getTimeElapsed = (createdAt: Date) => {
    try {
      if (!createdAt) return '0m'
      
      const now = new Date()
      const createdDate = new Date(createdAt)
      const diffMs = now.getTime() - createdDate.getTime()
      
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
    
    const business = businesses.find(b => b?.id === order?.businessId)
    
    // Filtro por estado
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Gestión de Pedidos</h1>
          <p className="text-gray-600 mt-2">
            {pendingOrdersCount} pedidos pendientes • {orders.length} total
          </p>
        </div>
        <button
          onClick={loadData}
          className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
        >
          <i className="bi bi-arrow-clockwise mr-2"></i>
          Actualizar
        </button>
      </div>

      {/* Filtros */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Buscar */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Buscar
            </label>
            <div className="relative">
              <input
                type="text"
                placeholder="Cliente, teléfono, tienda..."
                value={filters.search}
                onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <i className="bi bi-search absolute left-3 top-2.5 text-gray-400"></i>
            </div>
          </div>

          {/* Filtro por Estado */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Estado
            </label>
            <select
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="all">Todos los estados</option>
              <option value="pending">Pendiente</option>
              <option value="confirmed">Confirmado</option>
              <option value="preparing">Preparando</option>
              <option value="ready">Listo</option>
              <option value="delivered">Entregado</option>
              <option value="cancelled">Cancelado</option>
            </select>
          </div>

          {/* Filtro por Tienda */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Tienda
            </label>
            <select
              value={filters.business}
              onChange={(e) => setFilters({ ...filters, business: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="all">Todas las tiendas</option>
              {businesses.map(business => (
                <option key={business.id} value={business.id}>
                  {business.name}
                </option>
              ))}
            </select>
          </div>

          {/* Ordenar por */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Ordenar por
            </label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="newest">Más recientes</option>
              <option value="oldest">Más antiguos</option>
              <option value="amount">Mayor monto</option>
            </select>
          </div>
        </div>
      </div>

      {/* Tabla de Pedidos */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Pedido
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Cliente
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Tienda
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Productos
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Monto
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Tiempo
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Estado
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredOrders.map((order) => {
                const business = businesses.find(b => b.id === order.businessId)
                const timeElapsed = getTimeElapsed(order.createdAt)
                
                return (
                  <tr key={order.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">
                        #{order.id?.slice(-6)}
                      </div>
                      <div className="text-sm text-gray-500">
                        {order.createdAt ? new Date(order.createdAt).toLocaleDateString('es-ES', {
                          day: '2-digit',
                          month: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit'
                        }) : 'Sin fecha'}
                      </div>
                    </td>
                    
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">
                        {order.customer?.name || 'Sin nombre'}
                      </div>
                      <div className="text-sm text-gray-500">
                        {order.customer?.phone || 'Sin teléfono'}
                      </div>
                    </td>
                    
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="w-8 h-8 bg-gray-200 rounded-lg overflow-hidden mr-3">
                          {business?.image ? (
                            <img
                              src={business.image}
                              alt={business.name || 'Negocio'}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full bg-gray-200 flex items-center justify-center">
                              <i className="bi bi-shop text-xs text-gray-400"></i>
                            </div>
                          )}
                        </div>
                        <div className="text-sm font-medium text-gray-900">
                          {business?.name || 'N/A'}
                        </div>
                      </div>
                    </td>
                    
                    <td className="px-6 py-4">
                      <div className="text-sm text-gray-900">
                        {order.items?.length || 0} producto{(order.items?.length || 0) !== 1 ? 's' : ''}
                      </div>
                      <div className="text-xs text-gray-500 max-w-xs truncate">
                        {order.items?.map((item: any) => item?.name || 'Sin nombre').filter(Boolean).join(', ') || 'Sin productos'}
                      </div>
                    </td>
                    
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-semibold text-gray-900">
                        ${(order.total || 0).toFixed(2)}
                      </div>
                    </td>
                    
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className={`text-sm font-medium ${
                        timeElapsed.includes('d') || parseInt(timeElapsed) > 60 
                          ? 'text-red-600' 
                          : timeElapsed.includes('h') 
                            ? 'text-orange-600' 
                            : 'text-green-600'
                      }`}>
                        {timeElapsed}
                      </div>
                    </td>
                    
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full border ${getStatusColor(order.status)}`}>
                        {getStatusText(order.status)}
                      </span>
                    </td>
                    
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex space-x-2">
                        {order.status === 'pending' && (
                          <>
                            <button
                              onClick={() => handleStatusUpdate(order.id!, 'confirmed')}
                              disabled={updatingStatus === order.id}
                              className="text-blue-600 hover:text-blue-900 text-sm font-medium disabled:opacity-50"
                            >
                              Confirmar
                            </button>
                            <button
                              onClick={() => handleStatusUpdate(order.id!, 'cancelled')}
                              disabled={updatingStatus === order.id}
                              className="text-red-600 hover:text-red-900 text-sm font-medium disabled:opacity-50"
                            >
                              Cancelar
                            </button>
                          </>
                        )}
                        
                        {order.status === 'confirmed' && (
                          <button
                            onClick={() => handleStatusUpdate(order.id!, 'preparing')}
                            disabled={updatingStatus === order.id}
                            className="text-orange-600 hover:text-orange-900 text-sm font-medium disabled:opacity-50"
                          >
                            Preparando
                          </button>
                        )}
                        
                        {order.status === 'preparing' && (
                          <button
                            onClick={() => handleStatusUpdate(order.id!, 'ready')}
                            disabled={updatingStatus === order.id}
                            className="text-green-600 hover:text-green-900 text-sm font-medium disabled:opacity-50"
                          >
                            Listo
                          </button>
                        )}
                        
                        {order.status === 'ready' && (
                          <button
                            onClick={() => handleStatusUpdate(order.id!, 'delivered')}
                            disabled={updatingStatus === order.id}
                            className="text-gray-600 hover:text-gray-900 text-sm font-medium disabled:opacity-50"
                          >
                            Entregado
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        
        {filteredOrders.length === 0 && (
          <div className="text-center py-12">
            <i className="bi bi-inbox text-4xl text-gray-400 mb-4"></i>
            <p className="text-gray-500">No se encontraron pedidos</p>
          </div>
        )}
      </div>
    </div>
  )
}
