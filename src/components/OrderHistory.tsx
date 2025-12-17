'use client'

import React, { useState, useMemo } from 'react'
import { Order } from '@/types'

interface OrderHistoryProps {
  orders: Order[]
  onOrderEdit?: (order: Order) => void
  onOrderDelete?: (orderId: string) => void
  onOrderStatusChange?: (orderId: string, status: Order['status']) => void
  getStatusColor?: (status: string) => string
  getStatusText?: (status: string) => string
  formatDate?: (date: string | Date) => string
  formatTime?: (date: string | Date) => string
  getOrderDateTime?: (order: Order) => Date
  OrderRow?: React.ComponentType<{ order: Order; isToday: boolean }>
}

export default function OrderHistory({
  orders,
  onOrderEdit,
  onOrderDelete,
  onOrderStatusChange,
  getStatusColor = (status: string) => 'bg-gray-100 text-gray-800',
  getStatusText = (status: string) => status,
  formatDate = (date) => new Date(date).toLocaleDateString('es-EC'),
  formatTime = (date) => new Date(date).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' }),
  getOrderDateTime = (order) => new Date(order.createdAt),
  OrderRow
}: OrderHistoryProps) {
  const [collapsedDates, setCollapsedDates] = useState<Set<string>>(new Set())

  // Categorizar órdenes
  const categorizedOrders = useMemo(() => {
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    const upcomingOrders = orders.filter(order => {
      const orderDate = getOrderDateTime(order)
      return orderDate >= tomorrow
    }).sort((a, b) => {
      const timeA = getOrderDateTime(a).getTime()
      const timeB = getOrderDateTime(b).getTime()
      return timeA - timeB
    })

    const pastOrders = orders.filter(order => {
      const orderDate = getOrderDateTime(order)
      return orderDate < today
    }).sort((a, b) => {
      const timeA = getOrderDateTime(a).getTime()
      const timeB = getOrderDateTime(b).getTime()
      return timeB - timeA
    })

    return { upcomingOrders, pastOrders }
  }, [orders, getOrderDateTime])

  // Agrupar pedidos por fecha
  const groupOrdersByDate = (ordersList: Order[]) => {
    const grouped = ordersList.reduce((acc, order) => {
      const orderDate = getOrderDateTime(order)
      const dateKey = orderDate.toLocaleDateString('es-EC', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })

      if (!acc[dateKey]) {
        acc[dateKey] = []
      }
      acc[dateKey].push(order)
      return acc
    }, {} as Record<string, Order[]>)

    return Object.entries(grouped)
      .sort(([dateA], [dateB]) => {
        const orderA = grouped[dateA][0]
        const orderB = grouped[dateB][0]
        return getOrderDateTime(orderB).getTime() - getOrderDateTime(orderA).getTime()
      })
      .map(([date, orders]) => ({
        date,
        orders: orders.sort((a, b) => getOrderDateTime(b).getTime() - getOrderDateTime(a).getTime())
      }))
  }

  const toggleDateCollapse = (dateKey: string) => {
    const newCollapsed = new Set(collapsedDates)
    if (newCollapsed.has(dateKey)) {
      newCollapsed.delete(dateKey)
    } else {
      newCollapsed.add(dateKey)
    }
    setCollapsedDates(newCollapsed)
  }

  const { upcomingOrders, pastOrders } = categorizedOrders
  const groupedPastOrders = groupOrdersByDate(pastOrders.slice(0, 100))

  return (
    <div>
      {(() => {
        return (
          <div className="space-y-8">
            {/* Pedidos Próximos */}
            {upcomingOrders.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-bold text-gray-900">
                    <i className="bi bi-clock me-2"></i>
                    Pedidos Próximos ({upcomingOrders.length})
                  </h2>
                </div>
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <tbody className="bg-white divide-y divide-gray-200">
                        {upcomingOrders.map((order) => 
                          OrderRow ? (
                            <OrderRow key={order.id} order={order} isToday={false} />
                          ) : (
                            <tr key={order.id} className="hover:bg-gray-50">
                              <td className="px-3 py-3 text-sm text-gray-900">
                                {formatTime(getOrderDateTime(order))}
                              </td>
                              <td className="px-3 py-3 text-sm text-gray-900">
                                {order.customer?.name || 'N/A'}
                              </td>
                              <td className="px-3 py-3 text-sm text-gray-600">
                                {order.items?.length || 0} producto(s)
                              </td>
                              <td className="px-3 py-3 text-sm font-bold text-emerald-600">
                                ${(order.total || 0).toFixed(2)}
                              </td>
                              <td className="px-3 py-3 text-sm">
                                <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(order.status)}`}>
                                  {getStatusText(order.status)}
                                </span>
                              </td>
                            </tr>
                          )
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* Historial de Pedidos Agrupado por Fecha */}
            {groupedPastOrders.length > 0 ? (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-bold text-gray-900">
                    <i className="bi bi-archive me-2"></i>
                    Historial de Pedidos ({pastOrders.length})
                  </h2>
                  {pastOrders.length > 100 && (
                    <span className="text-sm text-gray-500">
                      Mostrando los últimos 100 pedidos
                    </span>
                  )}
                </div>

                <div className="space-y-4">
                  {groupedPastOrders.map(({ date, orders }) => {
                    const isCollapsed = collapsedDates.has(date)
                    return (
                      <div key={date} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                        {/* Header de fecha colapsable */}
                        <button
                          onClick={() => toggleDateCollapse(date)}
                          className="w-full px-4 py-3 bg-gray-50 border-b border-gray-200 text-left hover:bg-gray-100 transition-colors"
                        >
                          <div className="flex items-center justify-between">
                            <h3 className="text-lg font-semibold text-gray-900 capitalize">
                              {date}
                              <span className="ml-2 bg-gray-200 text-gray-700 px-2 py-1 rounded-full text-sm">
                                {orders.length}
                              </span>
                            </h3>
                            <div className="flex items-center">
                              <span className="text-sm text-gray-500 mr-2">
                                ${orders.reduce((sum, order) => sum + (order.total || 0), 0).toFixed(2)} total
                              </span>
                              <i className={`bi ${isCollapsed ? 'bi-chevron-down' : 'bi-chevron-up'} text-gray-400`}></i>
                            </div>
                          </div>
                        </button>

                        {/* Tabla de pedidos (colapsable) */}
                        {!isCollapsed && (
                          <div className="overflow-x-auto">
                            <table className="w-full">
                              <tbody className="bg-white divide-y divide-gray-200">
                                {orders.map((order) =>
                                  OrderRow ? (
                                    <OrderRow key={order.id} order={order} isToday={false} />
                                  ) : (
                                    <tr key={order.id} className="hover:bg-gray-50">
                                      <td className="px-3 py-3 text-sm text-gray-900">
                                        {formatTime(getOrderDateTime(order))}
                                      </td>
                                      <td className="px-3 py-3 text-sm text-gray-900">
                                        {order.customer?.name || 'N/A'}
                                      </td>
                                      <td className="px-3 py-3 text-sm text-gray-600">
                                        {order.items?.length || 0} producto(s)
                                      </td>
                                      <td className="px-3 py-3 text-sm font-bold text-emerald-600">
                                        ${(order.total || 0).toFixed(2)}
                                      </td>
                                      <td className="px-3 py-3 text-sm">
                                        <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(order.status)}`}>
                                          {getStatusText(order.status)}
                                        </span>
                                      </td>
                                    </tr>
                                  )
                                )}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : upcomingOrders.length === 0 && (
              <div className="bg-white rounded-xl p-8 text-center border border-gray-200">
                <div className="text-6xl mb-4">📋</div>
                <h3 className="text-lg font-medium text-gray-900 mb-2">No hay pedidos en el historial</h3>
                <p className="text-gray-500 text-sm">Los pedidos completados aparecerán aquí</p>
              </div>
            )}
          </div>
        )
      })()}
    </div>
  )
}
