'use client'

import React, { useState, useMemo } from 'react'
import { Order, Delivery } from '@/types'
import { getNextStatus } from '@/components/WhatsAppUtils'

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
  availableDeliveries?: Delivery[]
  onDeliveryAssign?: (orderId: string, deliveryId: string) => void
  onPaymentEdit?: (order: Order) => void
  onWhatsAppDelivery?: (order: Order) => void
  onPrint?: (order: Order) => void
  onDeliveryStatusClick?: (order: Order) => void
  onCustomerClick?: (order: Order) => void
  businessPhone?: string
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
  OrderRow,
  availableDeliveries = [],
  onDeliveryAssign,
  onPaymentEdit,
  onWhatsAppDelivery,
  onPrint,
  onDeliveryStatusClick,
  onCustomerClick,
  businessPhone
}: OrderHistoryProps) {
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set())

  // Helper functions from dashboard
  const getActionIcon = (status: string) => {
    switch (status) {
        case 'preparing': return 'bi-fire text-purple-500'
        case 'ready': return 'bi-check2 text-green-600'
        case 'on_way': return 'bi-bicycle text-indigo-500'
        case 'delivered': return 'bi-stars text-purple-500'
        default: return 'bi-arrow-right'
    }
  }

  const getActionText = (status: string) => {
    switch (status) {
        case 'confirmed': return 'Confirmar'
        case 'preparing': return 'Preparando'
        case 'ready': return 'Listo para la entrega'
        case 'on_way': return 'En camino'
        case 'delivered': return 'Entregado'
        default: return getStatusText(status)
    }
  }

  // Helper to convert Firestore timestamp to Date
  const toSafeDate = (val: any): Date => {
    if (!val) return new Date()
    if (val.seconds) return new Date(val.seconds * 1000)
    if (typeof val === 'string') return new Date(val)
    if (val instanceof Date) return val
    return new Date()
  }

  // Helper to get the display time for an order
  const getOrderDisplayTime = (order: Order) => {
    try {
        if (order.timing?.scheduledTime) {
            return order.timing.scheduledTime; // Already formatted as HH:MM
        }
        const date = toSafeDate(order.createdAt);
        return date.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
        return '--:--';
    }
  }

  // OrderCard component
  function OrderCard({
    order,
    availableDeliveries,
    onStatusChange,
    onDeliveryAssign,
    onPaymentEdit,
    onWhatsAppDelivery,
    onPrint,
    onDeliveryStatusClick,
    onEdit,
    onDelete,
    onCustomerClick,
    businessPhone
  }: {
    order: Order,
    availableDeliveries: Delivery[],
    onStatusChange: (id: string, status: Order['status'], reason?: string) => void,
    onDeliveryAssign: (id: string, deliveryId: string) => void,
    onPaymentEdit: () => void,
    onWhatsAppDelivery: () => void,
    onPrint: () => void,
    onDeliveryStatusClick: (order: Order) => void,
    onEdit: () => void,
    onDelete: () => void,
    onCustomerClick: () => void,
    businessPhone?: string
  }) {
    const nextStatus = getNextStatus(order.status)
    const isDelivery = order.delivery?.type === 'delivery'
    const [isExpanded, setIsExpanded] = useState(false)
    const [statusMenuOpen, setStatusMenuOpen] = useState(false)
    const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false)
    const [discardReason, setDiscardReason] = useState('')

    // Urgency check
    const isUrgent = () => {
        // Only for active orders that are not ready or delivered
        if (['ready', 'delivered', 'completed', 'cancelled'].includes(order.status)) return false;

        const now = new Date();
        let targetDate = new Date();

        if (order.timing?.scheduledTime) {
            const [hours, minutes] = order.timing.scheduledTime.split(':').map(Number);
            targetDate.setHours(hours, minutes, 0, 0);
        } else {
            return false;
        }

        const diffInMinutes = (targetDate.getTime() - now.getTime()) / 60000;
        return diffInMinutes <= 5;
    }

    const urgent = isUrgent();

    // Sort items: non-zero price first, then zero price
    const sortedItems = [...(order.items || [])].sort((a: any, b: any) => {
        const priceA = (a.price || a.product?.price || 0) * a.quantity;
        const priceB = (b.price || b.product?.price || 0) * b.quantity;

        if (priceA === 0 && priceB !== 0) return 1;
        if (priceA !== 0 && priceB === 0) return -1;
        return 0; // Keep original order if both are zero or both are non-zero
    });

    return (
        <div className={`bg-white rounded-xl shadow-sm border border-gray-100 transition-all ${statusMenuOpen ? 'relative z-30' : ''} ${urgent ? 'animate-pulse border-red-300 ring-2 ring-red-100' : ''}`}>
            {/* Confirmation Modal for Discard */}
            {confirmDiscardOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" onClick={(e) => e.stopPropagation()}>
                    <div
                        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300"
                        onClick={() => {
                            setConfirmDiscardOpen(false)
                            setDiscardReason('')
                        }}
                    />

                    <div className="relative bg-white w-full max-w-sm rounded-2xl shadow-2xl p-6 flex flex-col items-center text-center animate-in zoom-in-95 duration-200">
                        <div className="w-16 h-16 bg-red-50 text-red-600 rounded-full flex items-center justify-center mb-4">
                            <i className="bi bi-trash3 text-2xl"></i>
                        </div>

                        <h4 className="text-xl font-bold text-gray-900 mb-2">¿Descartar pedido?</h4>
                        <p className="text-sm text-gray-500 mb-6 px-2">
                            Se marcará como descartado y desaparecerá de la lista activa. Por favor selecciona el motivo.
                        </p>

                        {/* Reason Selector */}
                        <div className="w-full mb-6">
                            <label className="block text-xs uppercase tracking-wider text-gray-400 font-bold mb-2 text-left ml-1">
                                Motivo del descarte
                            </label>
                            <select
                                value={discardReason}
                                onChange={(e) => setDiscardReason(e.target.value)}
                                className="w-full bg-gray-50 border border-gray-200 rounded-xl py-3 px-4 text-sm outline-none focus:ring-2 focus:ring-red-100 focus:border-red-300 transition-all font-medium"
                            >
                                <option value="">Selecciona un motivo...</option>
                                <option value="Cliente no responde">Cliente no responde</option>
                                <option value="Sin stock de productos">Sin stock de productos</option>
                                <option value="Fuera de zona de cobertura">Fuera de zona de cobertura</option>
                                <option value="Pedido duplicado">Pedido duplicado</option>
                                <option value="Fallo en el pago">Fallo en el pago</option>
                                <option value="Otro">Otro motivo</option>
                            </select>
                        </div>

                        <div className="flex gap-3 w-full">
                            <button
                                onClick={() => {
                                    setConfirmDiscardOpen(false)
                                    setDiscardReason('')
                                }}
                                className="flex-1 py-3 text-sm font-bold text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={() => {
                                    onStatusChange(order.id, 'cancelled', discardReason || 'Sin motivo especificado')
                                    setConfirmDiscardOpen(false)
                                    setDiscardReason('')
                                    setStatusMenuOpen(false)
                                }}
                                className="flex-1 py-3 text-sm font-bold text-white bg-red-600 rounded-xl hover:bg-red-700 transition-colors shadow-lg shadow-red-100 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
                                disabled={!discardReason}
                            >
                                Confirmar
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {/* Card Header: Time & Status */}
            <div
                className="px-4 py-3 border-b border-gray-50 flex justify-between items-start bg-gray-50/50 cursor-pointer hover:bg-gray-100 transition-colors"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                        {/* Chevron for expand/collapse */}
                        <i className={`bi bi-chevron-${isExpanded ? 'up' : 'down'} text-gray-400 text-xs mr-2 transform transition-transform duration-200`}></i>

                        <span className="text-sm sm:text-base font-bold text-gray-900 flex items-center gap-2">
                            {!isDelivery && <i className="bi bi-shop text-gray-400"></i>}
                            {order.customer?.name || "Cliente"}
                        </span>
                    </div>

                    <div className="flex items-center gap-2 mt-1 ml-5">
                        <i className={`bi ${order.timing?.type === 'scheduled' ? 'bi-clock' : 'bi-lightning-fill'} ${order.timing?.type === 'scheduled' ? 'text-blue-600' : 'text-yellow-500'}`}></i>
                        <span className="font-mono text-sm sm:font-medium text-gray-600">
                            {getOrderDisplayTime(order)}
                        </span>
                    </div>

                    {/* Items List (Small) */}
                    <div className="flex flex-col gap-0.5 mt-1 ml-5 min-w-0">
                        {sortedItems.map((item: any, idx) => {
                            return (
                                <div key={idx} className="text-xs sm:text-[10px] leading-tight text-gray-600">
                                    {item.quantity}x {item.variant || item.product?.name || item.name}
                                </div>
                            )
                        })}
                    </div>
                </div>

                <div className="flex flex-col items-end gap-2">
                    <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                        {/* Advance Status */}
                        {nextStatus && (
                            <button
                                onClick={() => onStatusChange(order.id, nextStatus)}
                                className={`flex items-center gap-1 rounded-lg transition-colors shadow-sm ${nextStatus === 'confirmed'
                                    ? 'px-3 py-1.5 text-xs font-bold bg-green-600 text-white hover:bg-green-700'
                                    : 'p-1.5 text-lg hover:bg-white hover:shadow-md'
                                    }`}
                                title={getActionText(nextStatus)}
                            >
                                {nextStatus === 'confirmed' ? (
                                    <>
                                        <span>{getActionText(nextStatus)}</span>
                                        <i className="bi bi-check2-circle"></i>
                                    </>
                                ) : (
                                    <i className={`bi ${getActionIcon(nextStatus)}`}></i>
                                )}
                            </button>
                        )}

                        {/* Discard Button for Pending Orders */}
                        {order.status === 'pending' && (
                            <button
                                onClick={() => setConfirmDiscardOpen(true)}
                                className="p-1.5 text-lg text-gray-400 bg-gray-50 border border-gray-100 rounded-lg hover:bg-gray-100 transition-colors shadow-sm"
                                title="Descartar pedido"
                            >
                                <i className="bi bi-x-lg"></i>
                            </button>
                        )}

                        {/* Status Select Menu */}
                        {order.status !== 'pending' &&
                            <div className="relative">
                                <button
                                    onClick={() => setStatusMenuOpen(!statusMenuOpen)}
                                    className={`p-1.5 text-lg rounded-lg transition-all hover:bg-gray-100 ${statusMenuOpen ? 'bg-gray-100' : ''}`}
                                    title="Cambiar estado"
                                >
                                    <i className="bi bi-three-dots-vertical"></i>
                                </button>

                                {statusMenuOpen &&
                                    <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-xl shadow-xl border border-gray-100 z-20 py-1 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
                                        <button
                                            onClick={() => {
                                                onStatusChange(order.id, 'preparing')
                                                setStatusMenuOpen(false)
                                            }}
                                            className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 transition-colors flex items-center gap-2"
                                        >
                                            <i className="bi bi-fire text-purple-500"></i>
                                            Preparando
                                        </button>
                                        <button
                                            onClick={() => {
                                                onStatusChange(order.id, 'ready')
                                                setStatusMenuOpen(false)
                                            }}
                                            className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 transition-colors flex items-center gap-2"
                                        >
                                            <i className="bi bi-box-seam text-green-500"></i>
                                            Listo para entrega
                                        </button>
                                        <button
                                            onClick={() => {
                                                onStatusChange(order.id, 'delivered')
                                                setStatusMenuOpen(false)
                                            }}
                                            className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 transition-colors flex items-center gap-2"
                                        >
                                            <i className="bi bi-check-all text-gray-500"></i>
                                            Entregado
                                        </button>
                                        <button
                                            onClick={() => {
                                                setConfirmDiscardOpen(true)
                                            }}
                                            className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 transition-colors flex items-center gap-2 border-t border-gray-50 mt-1"
                                        >
                                            <i className="bi bi-x-circle text-gray-500"></i>
                                            Descartado
                                        </button>
                                    </div>
                                }
                            </div>
                        }

                        {/* Delivery Acceptance Status */}
                        {isDelivery && order.delivery?.assignedDelivery && (
                            <div
                                className="p-1.5 flex items-center cursor-pointer hover:bg-white hover:shadow-sm rounded-lg transition-all"
                                onClick={(e) => {
                                    e.stopPropagation()
                                    onDeliveryStatusClick(order)
                                }}
                                title={
                                    order.delivery?.acceptanceStatus === 'accepted' ? 'Delivery Confirmado' :
                                        order.delivery?.acceptanceStatus === 'rejected' ? 'Delivery Rechazado' :
                                            'Esperando confirmación del delivery'
                                }
                            >
                                <span className={`material-symbols-rounded text-2xl transition-all ${order.delivery?.acceptanceStatus === 'accepted'
                                    ? 'text-green-500'
                                    : order.delivery?.acceptanceStatus === 'rejected'
                                        ? 'text-red-500'
                                        : 'text-yellow-500 animate-pulse'
                                    }`}>
                                    motorcycle
                                </span>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Card Body */}
            {isExpanded && (
                <div className="p-4 bg-white animate-in slide-in-from-top-2 duration-200">
                    {/* Customer Info */}
                    <div className="flex justify-between items-start mb-4">
                        <div className="flex-1 pr-2">
                            {isDelivery && (
                                <p className="text-sm text-gray-500 line-clamp-2">
                                    📍 {order.delivery?.references || (order.delivery as any)?.reference || "Ubicación"}
                                </p>
                            )}
                        </div>
                    </div>

                    {/* Items */}
                    <div className="space-y-2 mb-4">
                        {order.items?.map((item: any, idx: number) => (
                            <div key={idx} className="flex justify-between text-sm">
                                <span className="text-gray-700">
                                    <span className="font-medium text-gray-900">{item.quantity}x</span> {item.variant || item.product?.name || item.name}
                                </span>
                                <span className="text-gray-500">${((item.price || item.product?.price || 0) * item.quantity).toFixed(2)}</span>
                            </div>
                        ))}
                    </div>

                    <div className="border-t border-dashed border-gray-200 my-3"></div>

                    {/* Total & Payment */}
                    <div className="flex justify-between items-center mb-4">
                        <div className="flex items-center gap-2">
                            <button
                                onClick={onPaymentEdit}
                                className={`flex items-center gap-1.5 px-2 py-1 rounded text-sm font-medium transition-colors ${order.payment?.paymentStatus === 'paid'
                                    ? 'bg-green-100 text-green-700'
                                    : order.payment?.paymentStatus === 'validating'
                                        ? 'bg-yellow-100 text-yellow-700'
                                        : 'bg-red-100 text-red-700'
                                    }`}
                            >
                                <i className={`bi ${order.payment?.method === 'transfer' ? 'bi-bank' :
                                    order.payment?.method === 'mixed' ? 'bi-cash-coin' : 'bi-cash'
                                    }`}></i>
                                <span>${(order.total || 0).toFixed(2)}</span>
                                <i className="bi bi-pencil-square text-xs opacity-50 ml-1"></i>
                            </button>
                        </div>

                        {/* Print Button */}
                        <button
                            onClick={onPrint}
                            className="p-2 text-gray-400 hover:text-gray-600"
                        >
                            <i className="bi bi-printer"></i>
                        </button>
                    </div>

                    {/* Delivery Assignment */}
                    {isDelivery && (
                        <div className="mb-4">
                            <div className="flex items-center border border-gray-300 rounded-lg bg-white overflow-hidden">
                                <div className="bg-gray-100 px-3 py-2 border-r border-gray-300 text-gray-600">
                                    <i className="bi bi-truck text-lg"></i>
                                </div>
                                <select
                                    value={order.delivery?.assignedDelivery || ""}
                                    onChange={(e) => onDeliveryAssign(order.id, e.target.value)}
                                    className="w-full text-sm p-2 bg-transparent outline-none cursor-pointer hover:bg-gray-50 transition-colors"
                                >
                                    <option value="">Asignar Repartidor...</option>
                                    {availableDeliveries.map(d => (
                                        <option key={d.id} value={d.id}>{d.nombres}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    )}

                    {/* Actions: Edit & Delete */}
                    <div className="flex gap-2 pt-4 border-t border-gray-100">
                        <button
                            onClick={onCustomerClick}
                            className="flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium text-green-600 bg-green-50 rounded-lg hover:bg-green-100 transition-colors"
                        >
                            <i className="bi bi-person-fill"></i>
                            Contactar
                        </button>
                        <button
                            onClick={onEdit}
                            className="flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
                        >
                            <i className="bi bi-pencil"></i>
                            Editar
                        </button>
                        <button
                            onClick={onDelete}
                            className="flex items-center justify-center p-2 text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors"
                        >
                            <i className="bi bi-trash"></i>
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
  }

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

    // Past orders incluye hoy y anteriores
    const pastOrders = orders.filter(order => {
      const orderDate = getOrderDateTime(order)
      return orderDate < tomorrow
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

  const toggleDateExpansion = (dateKey: string) => {
    const newExpanded = new Set(expandedDates)
    if (newExpanded.has(dateKey)) {
      newExpanded.delete(dateKey)
    } else {
      newExpanded.add(dateKey)
    }
    setExpandedDates(newExpanded)
  }

  const { upcomingOrders } = categorizedOrders
  const groupedPastOrders = groupOrdersByDate(orders.slice(0, 100))

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
                <div className="space-y-3">
                  {upcomingOrders.map((order) =>
                    OrderRow ? (
                      <OrderRow key={order.id} order={order} isToday={false} />
                    ) : (
                      <OrderCard
                        key={order.id}
                        order={order}
                        availableDeliveries={availableDeliveries}
                        onStatusChange={(id, status, reason) => onOrderStatusChange?.(id, status)}
                        onDeliveryAssign={(id, deliveryId) => onDeliveryAssign?.(id, deliveryId)}
                        onPaymentEdit={() => onPaymentEdit?.(order)}
                        onWhatsAppDelivery={() => onWhatsAppDelivery?.(order)}
                        onPrint={() => onPrint?.(order)}
                        onDeliveryStatusClick={() => onDeliveryStatusClick?.(order)}
                        onEdit={() => onOrderEdit?.(order)}
                        onDelete={() => onOrderDelete?.(order.id)}
                        onCustomerClick={() => onCustomerClick?.(order)}
                        businessPhone={businessPhone}
                      />
                    )
                  )}
                </div>
              </div>
            )}

            {/* Historial de Pedidos Agrupado por Fecha */}
            {groupedPastOrders.length > 0 ? (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-bold text-gray-900">
                    <i className="bi bi-archive me-2"></i>
                    Historial de Pedidos ({orders.length})
                  </h2>
                  {orders.length > 100 && (
                    <span className="text-sm text-gray-500">
                      Mostrando los últimos 100 pedidos
                    </span>
                  )}
                </div>

                <div className="space-y-4">
                  {groupedPastOrders.map(({ date, orders }) => {
                    const isExpanded = expandedDates.has(date)
                    return (
                      <div key={date} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                        {/* Header de fecha colapsable */}
                        <button
                          onClick={() => toggleDateExpansion(date)}
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
                              <i className={`bi ${isExpanded ? 'bi-chevron-up' : 'bi-chevron-down'} text-gray-400`}></i>
                            </div>
                          </div>
                        </button>

                        {/* Tabla de pedidos (colapsable) */}
                        {isExpanded && (
                          <div className="p-4 space-y-3">
                            {orders.map((order) =>
                              OrderRow ? (
                                <OrderRow key={order.id} order={order} isToday={false} />
                              ) : (
                                <OrderCard
                                  key={order.id}
                                  order={order}
                                  availableDeliveries={availableDeliveries}
                                  onStatusChange={(id, status, reason) => onOrderStatusChange?.(id, status)}
                                  onDeliveryAssign={(id, deliveryId) => onDeliveryAssign?.(id, deliveryId)}
                                  onPaymentEdit={() => onPaymentEdit?.(order)}
                                  onWhatsAppDelivery={() => onWhatsAppDelivery?.(order)}
                                  onPrint={() => onPrint?.(order)}
                                  onDeliveryStatusClick={() => onDeliveryStatusClick?.(order)}
                                  onEdit={() => onOrderEdit?.(order)}
                                  onDelete={() => onOrderDelete?.(order.id)}
                                  onCustomerClick={() => onCustomerClick?.(order)}
                                  businessPhone={businessPhone}
                                />
                              )
                            )}
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
