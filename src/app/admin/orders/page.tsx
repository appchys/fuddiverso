'use client'

import { useState, useEffect } from 'react'
import { getAllOrders, getAllBusinesses, updateOrderStatus, updateOrder } from '@/lib/database'
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

  // Estados para validación de pagos
  const [showEditPaymentModal, setShowEditPaymentModal] = useState(false)
  const [showReceiptPreviewModal, setShowReceiptPreviewModal] = useState(false)
  const [paymentEditingOrder, setPaymentEditingOrder] = useState<Order | null>(null)
  const [editPaymentData, setEditPaymentData] = useState({
    method: 'cash' as 'cash' | 'transfer' | 'mixed',
    cashAmount: 0,
    transferAmount: 0,
    paymentStatus: 'pending' as 'pending' | 'validating' | 'paid' | 'rejected'
  })

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

  // Funciones para Pago
  const handleEditPayment = (order: Order) => {
    setPaymentEditingOrder(order)
    setEditPaymentData({
      method: order.payment?.method || 'cash',
      cashAmount: order.payment?.cashAmount || 0,
      transferAmount: order.payment?.transferAmount || 0,
      paymentStatus: order.payment?.paymentStatus || (order.payment?.method === 'transfer' ? 'paid' : 'pending')
    })
    setShowEditPaymentModal(true)
  }

  const handleSavePaymentEdit = async () => {
    if (!paymentEditingOrder) return

    try {
      let paymentUpdate: any = {
        method: editPaymentData.method,
        paymentStatus: editPaymentData.paymentStatus || 'pending'
      }

      if (editPaymentData.method === 'mixed') {
        paymentUpdate.cashAmount = editPaymentData.cashAmount
        paymentUpdate.transferAmount = editPaymentData.transferAmount
      }

      await updateOrder(paymentEditingOrder.id, {
        payment: {
          ...paymentEditingOrder.payment,
          ...paymentUpdate
        }
      } as any)

      // Actualizar la lista local
      setOrders(orders.map(order =>
        order.id === paymentEditingOrder.id
          ? { ...order, payment: { ...order.payment, ...paymentUpdate } as any }
          : order
      ))

      setShowEditPaymentModal(false)
      setPaymentEditingOrder(null)
    } catch (error) {
      console.error('Error updating payment:', error)
      alert('Error al actualizar el pago')
    }
  }

  const handleValidatePayment = async (orderId: string) => {
    try {
      if (!paymentEditingOrder) return

      let paymentUpdate: any = {
        method: editPaymentData.method,
        paymentStatus: 'paid' as const
      }

      if (editPaymentData.method === 'mixed') {
        paymentUpdate.cashAmount = editPaymentData.cashAmount
        paymentUpdate.transferAmount = editPaymentData.transferAmount
      }

      const updatedPayment = {
        ...paymentEditingOrder.payment,
        ...paymentUpdate
      }

      await updateOrder(orderId, {
        payment: updatedPayment
      } as any)

      // Actualizar estado local
      setOrders(orders.map(order =>
        order.id === orderId
          ? { ...order, payment: updatedPayment as any }
          : order
      ))

      setShowReceiptPreviewModal(false)
      setShowEditPaymentModal(false)
      setPaymentEditingOrder(null)
    } catch (error) {
      console.error('Error validating payment:', error)
      alert('Error al validar el pago')
    }
  }

  const handleRejectPayment = async (orderId: string) => {
    try {
      if (!paymentEditingOrder) return

      const updatedPayment = {
        ...paymentEditingOrder.payment,
        paymentStatus: 'rejected' as const
      }

      await updateOrder(orderId, {
        payment: updatedPayment
      } as any)

      // Actualizar estado local
      setOrders(orders.map(order =>
        order.id === orderId ? {
          ...order,
          payment: updatedPayment as any
        } : order
      ))

      setShowReceiptPreviewModal(false)
      setShowEditPaymentModal(false)
      setPaymentEditingOrder(null)
    } catch (error) {
      console.error('Error rejecting payment:', error)
      alert('Error al rechazar el pago')
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
                  Pago
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
                      <div className="flex items-center space-x-2">
                        <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${order.payment?.method === 'transfer' ? 'bg-blue-100 text-blue-800' :
                          order.payment?.method === 'mixed' ? 'bg-purple-100 text-purple-800' :
                            'bg-green-100 text-green-800'
                          }`}>
                          <i className={`bi ${order.payment?.method === 'transfer' ? 'bi-credit-card' :
                            order.payment?.method === 'mixed' ? 'bi-cash-coin' :
                              'bi-cash'
                            } me-1.5`}></i>
                          {order.payment?.method === 'transfer' ? 'Transf.' :
                            order.payment?.method === 'mixed' ? 'Mixto' : 'Efectivo'}
                        </span>

                        {(order.payment?.method === 'transfer' || order.payment?.method === 'mixed') && (
                          <button
                            onClick={() => handleEditPayment(order)}
                            className={`p-1 rounded-md hover:bg-gray-100 transition-colors ${order.payment?.paymentStatus === 'paid' ? 'text-green-600' :
                              order.payment?.paymentStatus === 'validating' ? 'text-yellow-600 animate-pulse' :
                                order.payment?.paymentStatus === 'rejected' ? 'text-red-600' :
                                  'text-blue-600'
                              }`}
                            title="Verificar/Editar Pago"
                          >
                            <i className={`bi ${order.payment?.paymentStatus === 'paid' ? 'bi-patch-check-fill' :
                              order.payment?.paymentStatus === 'validating' ? 'bi-hourglass-split' :
                                'bi-wallet2'
                              } text-lg`}></i>
                          </button>
                        )}
                      </div>
                    </td>

                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className={`text-sm font-medium ${timeElapsed.includes('d') || parseInt(timeElapsed) > 60
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

        {/* Modal de Edición de Método de Pago */}
        {showEditPaymentModal && paymentEditingOrder && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl max-w-md w-full shadow-2xl">
              <div className="p-6">
                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-bold text-gray-900">
                    <i className="bi bi-credit-card me-2 text-blue-600"></i>
                    Gestionar Pago
                  </h2>
                  <button
                    onClick={() => setShowEditPaymentModal(false)}
                    className="text-gray-400 hover:text-gray-600 text-2xl transition-colors"
                  >
                    <i className="bi bi-x-lg text-lg"></i>
                  </button>
                </div>

                {/* Información del pedido */}
                <div className="mb-6 p-4 bg-gray-50 rounded-xl flex justify-between items-start border border-gray-100">
                  <div>
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Cliente</p>
                    <p className="text-base font-bold text-gray-900">
                      {paymentEditingOrder?.customer?.name || 'Cliente sin nombre'}
                    </p>
                    <p className="text-sm text-gray-600 mt-2">
                      Total: <span className="font-bold text-blue-600">
                        ${(paymentEditingOrder?.total || 0).toFixed(2)}
                      </span>
                    </p>
                  </div>

                  {/* Mostrar comprobante si existe */}
                  {paymentEditingOrder?.payment?.receiptImageUrl && (
                    <div className="ml-4">
                      <button
                        type="button"
                        onClick={() => setShowReceiptPreviewModal(true)}
                        className="block relative group"
                        title="Ver comprobante completo"
                      >
                        <img
                          src={paymentEditingOrder.payment.receiptImageUrl}
                          alt="Comprobante"
                          className="w-20 h-20 object-cover rounded-lg border border-gray-200 shadow-sm transition-transform group-hover:scale-105"
                        />
                        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-0 group-hover:bg-opacity-20 transition-all rounded-lg">
                          <i className="bi bi-zoom-in text-white opacity-0 group-hover:opacity-100 drop-shadow-md"></i>
                        </div>
                      </button>
                      <p className="text-[10px] text-gray-500 mt-1 text-center font-medium">Click para ampliar</p>
                    </div>
                  )}
                </div>

                {/* Selección de método de pago */}
                <div className="space-y-4 mb-6">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-3">
                      Método de Pago
                    </label>
                    <div className="grid grid-cols-1 gap-2">
                      {[
                        { id: 'cash', label: 'Efectivo', icon: 'bi-cash', color: 'text-green-600', bg: 'hover:bg-green-50' },
                        { id: 'transfer', label: 'Transferencia', icon: 'bi-credit-card', color: 'text-blue-600', bg: 'hover:bg-blue-50' },
                        { id: 'mixed', label: 'Mixto', icon: 'bi-cash-coin', color: 'text-purple-600', bg: 'hover:bg-purple-50' }
                      ].map((m) => (
                        <label
                          key={m.id}
                          className={`flex items-center p-3 border rounded-xl cursor-pointer transition-all ${editPaymentData.method === m.id
                            ? 'border-blue-500 bg-blue-50/50 ring-1 ring-blue-500'
                            : 'border-gray-200 hover:bg-gray-50'
                            }`}
                        >
                          <input
                            type="radio"
                            name="paymentMethod"
                            value={m.id}
                            checked={editPaymentData.method === m.id}
                            onChange={(e) => setEditPaymentData({
                              ...editPaymentData,
                              method: e.target.value as any,
                              cashAmount: 0,
                              transferAmount: 0,
                              paymentStatus: m.id === 'transfer' ? 'paid' : 'pending'
                            })}
                            className="h-4 w-4 text-blue-600 focus:ring-blue-500"
                          />
                          <span className="ml-3 font-medium text-gray-700 flex items-center">
                            <i className={`bi ${m.icon} me-2 ${m.color}`}></i>
                            {m.label}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Selector de estado de pago */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      Estado Actual
                    </label>
                    <select
                      value={editPaymentData.paymentStatus}
                      onChange={(e) => setEditPaymentData({
                        ...editPaymentData,
                        paymentStatus: e.target.value as any
                      })}
                      className="w-full px-4 py-2 bg-white border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm font-medium"
                    >
                      <option value="pending">⏳ Pendiente</option>
                      <option value="validating">🕵️ Validando</option>
                      <option value="paid">✅ Pagado</option>
                      <option value="rejected">❌ Rechazado</option>
                    </select>
                  </div>

                  {/* Montos para pago mixto */}
                  {editPaymentData.method === 'mixed' && (
                    <div className="p-4 bg-blue-50 rounded-xl border border-blue-100">
                      <h4 className="text-xs font-bold text-blue-800 uppercase tracking-widest mb-3">
                        Distribución Mixta
                      </h4>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-bold text-gray-500 mb-1 ml-1">EFECTIVO</label>
                          <div className="relative">
                            <span className="absolute left-3 top-2 text-gray-400 text-xs">$</span>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={editPaymentData.cashAmount}
                              onChange={(e) => {
                                const cash = parseFloat(e.target.value) || 0
                                const transfer = (paymentEditingOrder?.total || 0) - cash
                                setEditPaymentData({
                                  ...editPaymentData,
                                  cashAmount: cash,
                                  transferAmount: Math.max(0, transfer)
                                })
                              }}
                              className="w-full pl-6 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-1 focus:ring-blue-500 appearance-none"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-gray-500 mb-1 ml-1">TRANSF.</label>
                          <div className="relative">
                            <span className="absolute left-3 top-2 text-gray-400 text-xs">$</span>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={editPaymentData.transferAmount}
                              onChange={(e) => {
                                const transfer = parseFloat(e.target.value) || 0
                                const cash = (paymentEditingOrder?.total || 0) - transfer
                                setEditPaymentData({
                                  ...editPaymentData,
                                  transferAmount: transfer,
                                  cashAmount: Math.max(0, cash)
                                })
                              }}
                              className="w-full pl-6 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-1 focus:ring-blue-500 appearance-none"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Botones de acción */}
                <div className="flex flex-col space-y-2">
                  <button
                    onClick={handleSavePaymentEdit}
                    disabled={editPaymentData.method === 'mixed' &&
                      Math.abs(((editPaymentData.cashAmount || 0) + (editPaymentData.transferAmount || 0)) - (paymentEditingOrder?.total || 0)) > 0.01
                    }
                    className="w-full bg-blue-600 text-white font-bold py-3 px-4 rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:bg-gray-400 transition-all shadow-lg shadow-blue-200"
                  >
                    Guardar Cambios
                  </button>
                  <button
                    onClick={() => setShowEditPaymentModal(false)}
                    className="w-full bg-gray-50 text-gray-600 font-semibold py-3 px-4 rounded-xl hover:bg-gray-100 transition-all"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Modal de Previsualización de Comprobante */}
        {showReceiptPreviewModal && paymentEditingOrder?.payment?.receiptImageUrl && (
          <div className="fixed inset-0 bg-black/95 flex items-center justify-center z-[70] p-4 backdrop-blur-sm">
            <div className="relative max-w-4xl w-full h-[90vh] flex flex-col bg-white rounded-2xl overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
              {/* Header */}
              <div className="p-4 border-b flex items-center justify-between bg-gray-50/80">
                <div>
                  <h3 className="font-bold text-gray-900 flex items-center">
                    <i className="bi bi-file-earmark-image me-2 text-blue-600"></i>
                    Comprobante de Pago
                  </h3>
                  <p className="text-xs text-gray-500 font-medium">
                    {paymentEditingOrder?.customer?.name} • <span className="text-blue-600">${(paymentEditingOrder?.total || 0).toFixed(2)}</span>
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleRejectPayment(paymentEditingOrder.id)}
                    className="px-4 py-2 bg-red-50 text-red-600 rounded-xl hover:bg-red-100 transition-colors font-bold text-sm flex items-center gap-2 border border-red-100"
                  >
                    <i className="bi bi-x-circle-fill"></i>
                    Rechazar
                  </button>
                  <button
                    onClick={() => handleValidatePayment(paymentEditingOrder.id)}
                    className="px-4 py-2 bg-green-600 text-white rounded-xl hover:bg-green-700 transition-all font-bold text-sm flex items-center gap-2 shadow-lg shadow-green-200"
                  >
                    <i className="bi bi-patch-check-fill"></i>
                    Validar Pago
                  </button>
                  <button
                    onClick={() => setShowReceiptPreviewModal(false)}
                    className="p-2 text-gray-400 hover:text-gray-600 transition-colors ml-2"
                  >
                    <i className="bi bi-x-lg text-xl"></i>
                  </button>
                </div>
              </div>

              {/* Imagen */}
              <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-gray-100/50">
                <img
                  src={paymentEditingOrder.payment.receiptImageUrl}
                  alt="Comprobante completo"
                  className="max-w-full max-h-full object-contain rounded-lg shadow-inner"
                />
              </div>

              {/* Footer */}
              <div className="p-3 bg-gray-50/50 text-center border-t border-gray-100">
                <p className="text-[11px] text-gray-400 font-medium italic">
                  Al validar, el pago se marcará como confirmado y se guardarán los cambios automáticamente.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
