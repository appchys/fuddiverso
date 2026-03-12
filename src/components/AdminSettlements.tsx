'use client'

import { Fragment, useMemo, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { createDeliverySettlement, createSettlement, updateOrderSettlementStatus } from '@/lib/database'
import { Business, Delivery, Order, Settlement } from '@/types'

type Props = {
  orders: Order[]
  setOrders: Dispatch<SetStateAction<Order[]>>
  businesses: Business[]
  deliveries: Delivery[]
  settlementsHistory: Settlement[]
  reloadData: () => void | Promise<void>
}

export default function AdminSettlementsTab({
  orders,
  setOrders,
  businesses,
  deliveries,
  settlementsHistory,
  reloadData
}: Props) {
  const [mode, setMode] = useState<'review' | 'stores' | 'deliveries'>('review')
  const [selectedSettlementBusiness, setSelectedSettlementBusiness] = useState<string | null>(null)
  const [processingSettlement, setProcessingSettlement] = useState(false)
  const [selectedOrderForProof, setSelectedOrderForProof] = useState<Order | null>(null)
  const [settlementsView, setSettlementsView] = useState<'pending' | 'history'>('pending')
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
  const [showOrdersReviewFilters, setShowOrdersReviewFilters] = useState(false)
  const [ordersReviewFilters, setOrdersReviewFilters] = useState<{
    businessId: string
    paymentMethod: 'all' | 'cash' | 'transfer' | 'mixed'
    collector: 'all' | 'fuddi' | 'store'
    fulfillment: 'all' | 'delivery' | 'pickup'
    deliveryId: string
  }>({
    businessId: 'all',
    paymentMethod: 'all',
    collector: 'all',
    fulfillment: 'all',
    deliveryId: 'all'
  })

  const getSettlementOrderInfo = (order: Order) => {
    let orderBasePrice = 0
    let orderCommission = 0
    let orderStoreReceives = 0
    let orderPublicSubtotal = 0

    if (order.items && order.items.length > 0) {
      order.items.forEach((item: any) => {
        const qty = item.quantity || 1
        const publicPrice = (item.price || 0) * qty
        const commission = (item.commission || 0) * qty
        const basePrice = (item.basePrice || item.storePrice || 0) * qty

        orderPublicSubtotal += publicPrice
        orderBasePrice += basePrice
        orderCommission += commission
        orderStoreReceives += (item.storeReceives != null ? (item.storeReceives || 0) * qty : (publicPrice - commission))
      })
    } else {
      const subtotal = order.subtotal || ((order.total || 0) - (order.delivery?.deliveryCost || 0))
      orderBasePrice = subtotal
      orderCommission = 0
      orderStoreReceives = subtotal
      orderPublicSubtotal = subtotal
    }

    return {
      basePrice: orderBasePrice,
      commission: orderCommission,
      storeReceives: orderStoreReceives,
      publicSubtotal: orderPublicSubtotal
    }
  }

  const renderPaymentProofModal = () => {
    if (!selectedOrderForProof) return null

    const isStoreCollector = selectedOrderForProof.paymentCollector === 'store'

    return (
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setSelectedOrderForProof(null)}>
        <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
          <div className="p-4 border-b flex justify-between items-center sticky top-0 bg-white">
            <h3 className="font-bold text-lg">Comprobante de Pago</h3>
            <button onClick={() => setSelectedOrderForProof(null)} className="p-2 hover:bg-gray-100 rounded-full">
              <i className="bi bi-x-lg"></i>
            </button>
          </div>
          <div className="p-6 space-y-6">
            <div className="bg-gray-100 rounded-lg p-2 flex justify-center min-h-[200px] items-center">
              {(selectedOrderForProof.payment as any).receiptImageUrl ? (
                <img
                  src={(selectedOrderForProof.payment as any).receiptImageUrl}
                  alt="Comprobante"
                  className="max-w-full max-h-[60vh] object-contain rounded-lg"
                />
              ) : (
                <div className="text-gray-400 text-center">
                  <i className="bi bi-image-alt text-4xl mb-2 block"></i>
                  No hay imagen disponible
                </div>
              )}
            </div>

            <div className="space-y-3">
              <h4 className="font-semibold text-gray-900 text-center">¿Quién cobró este pedido?</h4>
              <div className="flex justify-center">
                <button
                  onClick={() => handleToggleCollector(selectedOrderForProof)}
                  className={`px-4 py-2 rounded-full text-xs font-black uppercase tracking-widest transition-all active:scale-95 ${isStoreCollector
                    ? 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                    : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                    }`}
                >
                  {isStoreCollector ? '🏢 Tienda' : '🦅 Fuddi'}
                </button>
              </div>

              <div className="text-center pt-2">
                <p className="text-sm text-gray-500">
                  Monto del Pedido: <span className="font-bold text-gray-900">${selectedOrderForProof.total.toFixed(2)}</span>
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const renderOrdersReview = () => {
    const selectedDelivery = ordersReviewFilters.deliveryId !== 'all' && ordersReviewFilters.deliveryId !== 'unassigned'
      ? deliveries.find(d => d.id === ordersReviewFilters.deliveryId)
      : undefined

    const filteredOrders = pendingOrders
      .filter(order => {
        if (ordersReviewFilters.businessId !== 'all' && order.businessId !== ordersReviewFilters.businessId) return false
        if (ordersReviewFilters.paymentMethod !== 'all' && order.payment?.method !== ordersReviewFilters.paymentMethod) return false

        const isPickup = order.delivery?.type === 'pickup'
        const fulfillment = isPickup ? 'pickup' : 'delivery'
        if (ordersReviewFilters.fulfillment !== 'all' && fulfillment !== ordersReviewFilters.fulfillment) return false

        if (ordersReviewFilters.deliveryId !== 'all') {
          if (isPickup) return false
          const assignedId = order.delivery?.assignedDelivery || 'unassigned'
          if (ordersReviewFilters.deliveryId === 'unassigned') {
            if (assignedId !== 'unassigned' && assignedId !== '' && assignedId !== null) return false
          } else {
            const matchesDocId = assignedId === ordersReviewFilters.deliveryId
            const matchesUid = Boolean(selectedDelivery?.uid) && assignedId === selectedDelivery?.uid
            if (!matchesDocId && !matchesUid) return false
          }
        }

        const collector = (order.paymentCollector || 'fuddi') as 'fuddi' | 'store'
        if (ordersReviewFilters.collector !== 'all' && collector !== ordersReviewFilters.collector) return false
        return true
      })

    const totals = filteredOrders.reduce((acc, order) => {
      const info = getSettlementOrderInfo(order)
      const deliveryCost = order.delivery?.deliveryCost || 0
      const parts = allocatePaymentParts(order)

      acc.cashCollected += parts.cashCollected
      acc.transferCollected += parts.transferCollected
      acc.storeTotal += info.storeReceives
      acc.deliveryTotal += deliveryCost
      acc.commissionTotal += info.commission

      return acc
    }, {
      cashCollected: 0,
      transferCollected: 0,
      storeTotal: 0,
      deliveryTotal: 0,
      commissionTotal: 0
    })

    const totalCollected = totals.cashCollected + totals.transferCollected

    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="mb-4 flex items-center justify-between gap-4">
          <button
            onClick={() => setShowOrdersReviewFilters(v => !v)}
            className="px-4 py-2 rounded-lg text-sm font-bold bg-gray-100 hover:bg-gray-200 text-gray-700"
          >
            {showOrdersReviewFilters ? 'Ocultar filtros' : 'Filtrar'}
          </button>

          <div className="text-sm text-gray-500 text-right">
            Mostrando <span className="font-bold text-gray-900">{filteredOrders.length}</span> de{' '}
            <span className="font-bold text-gray-900">{pendingOrders.length}</span>
          </div>
        </div>

        {showOrdersReviewFilters && (
          <div className="mb-4 grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
            <div>
              <div className="text-xs font-black text-gray-400 uppercase tracking-widest mb-1">Tienda</div>
              <select
                value={ordersReviewFilters.businessId}
                onChange={e => setOrdersReviewFilters(prev => ({ ...prev, businessId: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm"
              >
                <option value="all">Todas</option>
                {businesses
                  .slice()
                  .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
                  .map(b => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
              </select>
            </div>

            <div>
              <div className="text-xs font-black text-gray-400 uppercase tracking-widest mb-1">Tipo</div>
              <select
                value={ordersReviewFilters.fulfillment}
                onChange={e => setOrdersReviewFilters(prev => ({ ...prev, fulfillment: e.target.value as any }))}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm"
              >
                <option value="all">Todos</option>
                <option value="delivery">Delivery</option>
                <option value="pickup">Retiro</option>
              </select>
            </div>

            <div>
              <div className="text-xs font-black text-gray-400 uppercase tracking-widest mb-1">Delivery</div>
              <select
                value={ordersReviewFilters.deliveryId}
                onChange={e => setOrdersReviewFilters(prev => ({ ...prev, deliveryId: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm"
              >
                <option value="all">Todos</option>
                <option value="unassigned">Sin asignar</option>
                {deliveries
                  .slice()
                  .sort((a, b) => (a.nombres || '').localeCompare(b.nombres || ''))
                  .map(d => (
                    <option key={d.id} value={d.id}>{d.nombres || 'Delivery'}</option>
                  ))}
              </select>
            </div>

            <div>
              <div className="text-xs font-black text-gray-400 uppercase tracking-widest mb-1">Tipo de pago</div>
              <select
                value={ordersReviewFilters.paymentMethod}
                onChange={e => setOrdersReviewFilters(prev => ({ ...prev, paymentMethod: e.target.value as any }))}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm"
              >
                <option value="all">Todos</option>
                <option value="cash">Efectivo</option>
                <option value="transfer">Transferencia</option>
                <option value="mixed">Mixto</option>
              </select>
            </div>

            <div>
              <div className="text-xs font-black text-gray-400 uppercase tracking-widest mb-1">Recaudado por</div>
              <select
                value={ordersReviewFilters.collector}
                onChange={e => setOrdersReviewFilters(prev => ({ ...prev, collector: e.target.value as any }))}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm"
              >
                <option value="all">Todos</option>
                <option value="fuddi">🦅 Fuddi</option>
                <option value="store">🏢 Tienda</option>
              </select>
            </div>

            <div />
          </div>
        )}

        <div className="mb-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div className="bg-gray-50 border border-gray-100 rounded-2xl p-4">
            <div className="text-xs font-black text-gray-400 uppercase tracking-widest mb-1">Total recaudado</div>
            <div className="text-2xl font-black text-gray-900">${totalCollected.toFixed(2)}</div>
          </div>
          <div className="bg-white border border-gray-100 rounded-2xl p-4">
            <div className="text-xs font-black text-gray-400 uppercase tracking-widest mb-1">Efectivo</div>
            <div className="text-2xl font-black text-gray-900">${totals.cashCollected.toFixed(2)}</div>
          </div>
          <div className="bg-white border border-gray-100 rounded-2xl p-4">
            <div className="text-xs font-black text-gray-400 uppercase tracking-widest mb-1">Transferencia</div>
            <div className="text-2xl font-black text-gray-900">${totals.transferCollected.toFixed(2)}</div>
          </div>
          <div className="bg-green-50 border border-green-100 rounded-2xl p-4">
            <div className="text-xs font-black text-green-700 uppercase tracking-widest mb-1">Para tienda</div>
            <div className="text-2xl font-black text-green-800">${totals.storeTotal.toFixed(2)}</div>
          </div>
          <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4">
            <div className="text-xs font-black text-blue-700 uppercase tracking-widest mb-1">Para delivery</div>
            <div className="text-2xl font-black text-blue-800">${totals.deliveryTotal.toFixed(2)}</div>
          </div>
          <div className="bg-red-50 border border-red-100 rounded-2xl p-4">
            <div className="text-xs font-black text-red-700 uppercase tracking-widest mb-1">Comisión Fuddi</div>
            <div className="text-2xl font-black text-red-800">${totals.commissionTotal.toFixed(2)}</div>
          </div>
        </div>

        <div className="rounded-2xl border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-white border-b border-gray-100">
                  <th className="px-6 py-4 text-xs font-black text-gray-400 uppercase tracking-widest">Fecha</th>
                  <th className="px-6 py-4 text-xs font-black text-gray-400 uppercase tracking-widest">Tienda</th>
                  <th className="px-6 py-4 text-xs font-black text-gray-400 uppercase tracking-widest">Monto</th>
                  <th className="px-6 py-4 text-xs font-black text-gray-400 uppercase tracking-widest">Cliente</th>
                  <th className="px-6 py-4 text-xs font-black text-gray-400 uppercase tracking-widest">Pago</th>
                  <th className="px-6 py-4 text-xs font-black text-gray-400 uppercase tracking-widest text-center">Recaudado</th>
                  <th className="px-6 py-4 text-xs font-black text-gray-400 uppercase tracking-widest text-center">Detalle Liq.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 bg-white">
                {filteredOrders.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-10 text-center text-gray-500">
                      No hay órdenes que coincidan con el filtro.
                    </td>
                  </tr>
                ) : (
                  filteredOrders
                    .slice()
                    .sort((a, b) => new Date(b.createdAt as any).getTime() - new Date(a.createdAt as any).getTime())
                    .map((order) => {
                      const business = businesses.find(b => b.id === order.businessId)
                      const isStoreCollector = order.paymentCollector === 'store'
                      const collector = order.paymentCollector || 'fuddi'
                      const isPickup = order.delivery?.type === 'pickup'
                      const orderTypeLabel = isPickup ? 'Retiro en tienda' : 'Delivery'
                      const info = getSettlementOrderInfo(order)
                      const hasReceipt = Boolean((order.payment as any).receiptImageUrl)

                      return (
                        <tr key={order.id} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            <div className="flex items-center gap-2">
                              <span className="text-gray-500">{new Date(order.createdAt as any).toLocaleDateString()}</span>
                              <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${isPickup ? 'bg-gray-100 text-gray-600' : 'bg-green-100 text-green-700'}`}>
                                {orderTypeLabel}
                              </span>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {business?.name || order.businessId}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900">
                            ${(order.total || 0).toFixed(2)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            <div className="text-gray-900 font-medium">{order.customer?.name || '-'}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {order.payment.method === 'cash' ? 'Efectivo' : (
                              hasReceipt ? (
                                <button
                                  onClick={() => setSelectedOrderForProof(order)}
                                  className="text-blue-600 hover:text-blue-800 underline flex items-center gap-1 group"
                                >
                                  {order.payment.method === 'transfer' ? 'Transf.' : 'Mixto'}
                                  <i className="bi bi-image group-hover:scale-110 transition-transform"></i>
                                </button>
                              ) : (
                                <span>{order.payment.method === 'transfer' ? 'Transf.' : 'Mixto'}</span>
                              )
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-center">
                            <button
                              onClick={() => handleToggleCollector(order)}
                              className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 ${isStoreCollector
                                ? 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                                : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                                }`}
                            >
                              {collector === 'store' ? '🏢 Tienda' : '🦅 Fuddi'}
                            </button>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-center">
                            <div className="flex flex-col items-center">
                              <div className="text-[10px] font-bold text-red-500">Comi: -${info.commission.toFixed(2)}</div>
                              <div className="text-[10px] font-bold text-green-600">Tienda: ${info.storeReceives.toFixed(2)}</div>
                            </div>
                          </td>
                        </tr>
                      )
                    })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    )
  }

  const handleSetPaymentReceiver = async (order: Order, receiver: 'fuddi' | 'store') => {
    setOrders(prevOrders => prevOrders.map(o =>
      o.id === order.id ? { ...o, paymentReceiver: receiver } : o
    ))

    if (selectedOrderForProof && selectedOrderForProof.id === order.id) {
      setSelectedOrderForProof(prev => prev ? { ...prev, paymentReceiver: receiver } : null)
    }

    try {
      await updateOrderSettlementStatus(order.id, { paymentReceiver: receiver })
    } catch (error) {
      console.error('Error updating payment receiver:', error)
      setOrders(prevOrders => prevOrders.map(o =>
        o.id === order.id ? { ...o, paymentReceiver: order.paymentReceiver } : o
      ))
      alert('Error al actualizar. Por favor intenta de nuevo.')
    }
  }

  const allocatePaymentParts = (order: Order) => {
    const info = getSettlementOrderInfo(order)
    const deliveryCost = order.delivery?.deliveryCost || 0
    const publicSubtotal = info.publicSubtotal
    const commission = info.commission
    const storeReceives = info.storeReceives

    const cashPart = order.payment?.method === 'mixed'
      ? (order.payment.cashAmount || 0)
      : (order.payment?.method === 'cash' ? (order.total || 0) : 0)

    const transferPart = order.payment?.method === 'mixed'
      ? (order.payment.transferAmount || 0)
      : (order.payment?.method === 'transfer' ? (order.total || 0) : 0)

    const splitPayment = (amount: number) => {
      if (amount <= 0) {
        return { delivery: 0, commission: 0, store: 0 }
      }

      const payDelivery = Math.min(amount, deliveryCost)
      const remaining = Math.max(0, amount - payDelivery)

      if (publicSubtotal <= 0) {
        return { delivery: payDelivery, commission: 0, store: 0 }
      }

      const subtotalPaid = Math.min(remaining, publicSubtotal)
      const ratio = subtotalPaid / publicSubtotal

      return {
        delivery: payDelivery,
        commission: commission * ratio,
        store: storeReceives * ratio
      }
    }

    return {
      cash: splitPayment(cashPart),
      transfer: splitPayment(transferPart),
      cashCollected: cashPart,
      transferCollected: transferPart
    }
  }

  const { settlementsByBusiness, pendingOrders, pendingDeliveryOrders, deliveriesSummary } = useMemo(() => {
    const pending = orders.filter(o => {
      if (['borrador', 'pending', 'cancelled'].includes(o.status as any)) return false
      if (o.settlementStatus && o.settlementStatus !== 'pending') return false
      return true
    })

    const pendingDelivery = orders.filter(o => {
      if (['borrador', 'pending', 'cancelled'].includes(o.status as any)) return false
      if (o.deliverySettlementStatus && o.deliverySettlementStatus !== 'pending') return false
      return true
    })

    const byBusiness = businesses.reduce((acc, business) => {
      const businessOrders = pending.filter(o => o.businessId === business.id)
      if (businessOrders.length === 0) return acc

      let totalSales = 0
      let totalSubtotal = 0
      let totalCommission = 0
      let totalDelivery = 0
      let collectedByFuddi = 0
      let collectedByStore = 0
      let collectedByFuddiSubtotal = 0
      let collectedByStoreSubtotal = 0

      businessOrders.forEach(order => {
        let orderCommission = 0
        let orderSubtotal = 0

        if (order.items && order.items.length > 0) {
          order.items.forEach((item: any) => {
            const qty = item.quantity || 1
            orderCommission += (item.commission || 0) * qty
            orderSubtotal += (item.price || 0) * qty
          })
        } else {
          orderSubtotal = order.subtotal || ((order.total || 0) - (order.delivery?.deliveryCost || 0))
        }

        const deliveryCost = order.delivery?.deliveryCost || 0

        totalSales += (order.total || 0)
        totalSubtotal += orderSubtotal
        totalCommission += orderCommission
        totalDelivery += deliveryCost

        const currentOrderTotal = order.total || 0
        if (order.paymentCollector === 'store') {
          collectedByStore += currentOrderTotal
          collectedByStoreSubtotal += orderSubtotal
        } else {
          collectedByFuddi += currentOrderTotal
          collectedByFuddiSubtotal += orderSubtotal
        }
      })

      const netAmount = totalSubtotal - collectedByStoreSubtotal - totalCommission

      acc.push({
        business,
        orders: businessOrders,
        financials: {
          totalSales,
          totalSubtotal,
          totalCommission,
          collectedByFuddi,
          collectedByStore,
          collectedByFuddiSubtotal,
          collectedByStoreSubtotal,
          netAmount,
          count: businessOrders.length
        }
      })
      return acc
    }, [] as any[])

    const byDelivery = pendingDelivery
      .filter(o => o.delivery?.type === 'delivery')
      .reduce((acc, order) => {
        const assignedId = order.delivery?.assignedDelivery || 'unassigned'
        if (!acc[assignedId]) {
          acc[assignedId] = {
            deliveryId: assignedId,
            orders: [] as Order[],
            totals: {
              ordersCount: 0,
              cashCollected: 0,
              transferCollected: 0,
              toGiveFuddi: 0,
              fuddiPaysDelivery: 0,
              deliveryEarnings: 0
            }
          }
        }

        const parts = allocatePaymentParts(order)

        const deliveryEarnings = order.delivery?.deliveryCost || 0

        const cashCollected = parts.cashCollected
        const deliveryKeepsFromCash = Math.min(cashCollected, deliveryEarnings)
        const toFuddi = Math.max(0, cashCollected - deliveryKeepsFromCash)
        const fuddiPaysDelivery = Math.max(0, deliveryEarnings - deliveryKeepsFromCash)

        acc[assignedId].orders.push(order)
        acc[assignedId].totals.ordersCount += 1
        acc[assignedId].totals.cashCollected += parts.cashCollected
        acc[assignedId].totals.transferCollected += parts.transferCollected
        acc[assignedId].totals.toGiveFuddi += toFuddi
        acc[assignedId].totals.fuddiPaysDelivery += fuddiPaysDelivery
        acc[assignedId].totals.deliveryEarnings += deliveryEarnings

        return acc
      }, {} as Record<string, any>)

    const deliveriesSummaryArr = Object.values(byDelivery).map((row: any) => {
      const d = deliveries.find(x => x.id === row.deliveryId || (x as any).uid === row.deliveryId)
      return {
        ...row,
        deliveryName: row.deliveryId === 'unassigned' ? 'Sin asignar' : (d?.nombres || 'Delivery')
      }
    })

    return {
      settlementsByBusiness: byBusiness,
      pendingOrders: pending,
      pendingDeliveryOrders: pendingDelivery,
      deliveriesSummary: deliveriesSummaryArr
    }
  }, [orders, businesses, deliveries])

  const handleCreateDeliverySettlement = async (deliveryId: string, ordersToSettle: Order[], rowTotals: any) => {
    const balance = (rowTotals.toGiveFuddi || 0) - (rowTotals.fuddiPaysDelivery || 0)
    const label = balance >= 0 ? 'Delivery paga a Fuddi' : 'Fuddi paga al Delivery'

    if (!confirm(`¿Confirmas generar el corte (${label}) por $${Math.abs(balance).toFixed(2)}?`)) return

    setProcessingSettlement(true)
    try {
      const settlementData = {
        deliveryId,
        startDate: new Date(Math.min(...ordersToSettle.map(o => new Date(o.createdAt as any).getTime()))),
        endDate: new Date(),
        totalOrders: ordersToSettle.length,
        cashCollected: rowTotals.cashCollected || 0,
        deliveryEarnings: rowTotals.deliveryEarnings || 0,
        netAmount: balance,
        status: 'completed' as const,
        createdBy: 'admin'
      }

      await createDeliverySettlement(settlementData, ordersToSettle.map(o => o.id))
      
      // Update local state to remove settled orders instead of full reload
      setOrders(prevOrders => 
        prevOrders.filter(order => 
          !ordersToSettle.some(settledOrder => settledOrder.id === order.id)
        )
      )
    } catch (e) {
      console.error(e)
      alert('Error al generar corte de delivery')
    } finally {
      setProcessingSettlement(false)
    }
  }

  const renderDeliverySettlements = () => {
    return (
      <div className="space-y-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-bold text-gray-900 mb-1">Resumen por Delivery</h3>
          <p className="text-sm text-gray-500">Cortes pendientes (según filtro actual de liquidación)</p>

          {deliveriesSummary.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <i className="bi bi-check-circle text-4xl mb-3 block text-green-500"></i>
              No hay órdenes delivery pendientes de liquidación.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {deliveriesSummary
                .sort((a: any, b: any) => (b.totals.cashCollected || 0) - (a.totals.cashCollected || 0))
                .map((row: any) => (
                  <div key={row.deliveryId} className="bg-white border boundary-gray-200 rounded-xl p-4 shadow-sm hover:shadow-md transition-all">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 rounded-full bg-gray-100 overflow-hidden flex items-center justify-center">
                        <i className="bi bi-scooter text-gray-500"></i>
                      </div>
                      <div className="min-w-0">
                        <h4 className="font-bold text-gray-900 line-clamp-1">{row.deliveryName}</h4>
                        <p className="text-xs text-gray-500">{row.totals.ordersCount} órdenes</p>
                      </div>
                    </div>

                    <div className="space-y-2 mb-4">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Efectivo cobrado</span>
                        <span className="font-semibold">${row.totals.cashCollected.toFixed(2)}</span>
                      </div>
                      <div className="pt-2 border-t border-gray-100 space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-500">Comisión por envío</span>
                          <span className="text-green-700 font-bold">${row.totals.deliveryEarnings.toFixed(2)}</span>
                        </div>
                        {(() => {
                          const balance = (row.totals.toGiveFuddi || 0) - (row.totals.fuddiPaysDelivery || 0)
                          const isDeliveryPaysFuddi = balance >= 0

                          return (
                            <div className="flex justify-between text-sm pt-2 border-t border-gray-100">
                              <span className="text-gray-700 font-semibold">{isDeliveryPaysFuddi ? 'Delivery paga a Fuddi' : 'Fuddi paga al Delivery'}</span>
                              <span className={`font-black ${isDeliveryPaysFuddi ? 'text-blue-800' : 'text-red-800'}`}>${Math.abs(balance).toFixed(2)}</span>
                            </div>
                          )
                        })()}
                      </div>
                    </div>

                    <button
                      onClick={() => handleCreateDeliverySettlement(row.deliveryId, row.orders, row.totals)}
                      disabled={processingSettlement}
                      className={`w-full py-2 rounded-lg font-bold text-white ${processingSettlement ? 'bg-gray-400 cursor-not-allowed' : 'bg-green-600 hover:bg-green-700'}`}
                    >
                      {processingSettlement ? 'Procesando...' : 'Generar Corte'}
                    </button>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  const handleToggleCollector = async (order: Order) => {
    const newCollector = order.paymentCollector === 'store' ? 'fuddi' : 'store'

    setOrders(prevOrders => prevOrders.map(o =>
      o.id === order.id ? { ...o, paymentCollector: newCollector } : o
    ))

    if (selectedOrderForProof && selectedOrderForProof.id === order.id) {
      setSelectedOrderForProof(prev => prev ? { ...prev, paymentCollector: newCollector } : null)
    }

    try {
      await updateOrderSettlementStatus(order.id, { paymentCollector: newCollector })
    } catch (error) {
      console.error('Error updating payment collector:', error)
      setOrders(prevOrders => prevOrders.map(o =>
        o.id === order.id ? { ...o, paymentCollector: order.paymentCollector } : o
      ))
      alert('Error al actualizar. Por favor intenta de nuevo.')
    }
  }

  const handleCreateSettlement = async (businessId: string, ordersToSettle: Order[], financials: any) => {
    if (!confirm(`¿Confirmas generar el corte por $${financials.netAmount.toFixed(2)}?`)) return

    setProcessingSettlement(true)
    try {
      const settlementData: any = {
        businessId,
        startDate: new Date(Math.min(...ordersToSettle.map(o => new Date(o.createdAt as any).getTime()))),
        endDate: new Date(),
        totalOrders: financials.count,
        totalSales: financials.totalSubtotal,
        totalCommission: financials.totalCommission,
        totalDelivery: financials.totalDelivery,
        netAmount: financials.netAmount,
        status: 'completed',
        createdBy: 'admin'
      }

      await createSettlement(settlementData, ordersToSettle.map(o => o.id))
      alert('Corte generado exitosamente')
      setSelectedSettlementBusiness(null)
      await reloadData()
    } catch (e) {
      console.error(e)
      alert('Error al generar corte')
    } finally {
      setProcessingSettlement(false)
    }
  }

  if (selectedSettlementBusiness) {
    const selectedData = settlementsByBusiness.find(s => s.business.id === selectedSettlementBusiness)
    if (!selectedData) {
      return (
        <div className="p-4">
          Negocio no encontrado o sin pendientes.{' '}
          <button onClick={() => setSelectedSettlementBusiness(null)} className="text-blue-600 underline">
            Volver
          </button>
        </div>
      )
    }

    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <button onClick={() => setSelectedSettlementBusiness(null)} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
              <i className="bi bi-arrow-left text-xl text-gray-600"></i>
            </button>
            <div>
              <h3 className="text-xl font-bold text-gray-900">{selectedData.business.name}</h3>
              <p className="text-sm text-gray-500">Liquidación Pendiente</p>
            </div>
          </div>
        </div>

        {(() => {
          const summary = selectedData.orders.reduce((acc: any, order: Order) => {
            const info = getSettlementOrderInfo(order)
            const isStoreCollector = order.paymentCollector === 'store'

            acc.totalOrders++
            acc.totalAmount += (order.total || 0)
            acc.totalCommission += info.commission

            if (isStoreCollector) {
              acc.collectedByStore += (order.total || 0)
              acc.fuddiReceives += info.commission
            } else {
              acc.collectedByFuddi += (order.total || 0)
              acc.storeReceives += info.storeReceives
            }

            return acc
          }, {
            totalOrders: 0,
            totalAmount: 0,
            totalCommission: 0,
            collectedByStore: 0,
            collectedByFuddi: 0,
            storeReceives: 0,
            fuddiReceives: 0
          })

          const netSettlement = summary.storeReceives - summary.fuddiReceives

          return (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
                  <div className="text-xs font-black text-gray-400 uppercase tracking-widest mb-1">Ventas Totales</div>
                  <div className="text-2xl font-black text-gray-900">${summary.totalAmount.toFixed(2)}</div>
                  <div className="text-[10px] text-gray-400 mt-1">{summary.totalOrders} pedidos finalizados</div>
                </div>
                <div className="bg-blue-50 p-5 rounded-2xl border border-blue-100">
                  <div className="text-xs font-black text-blue-400 uppercase tracking-widest mb-1">Tienda Recauda</div>
                  <div className="text-2xl font-black text-blue-700">${summary.collectedByStore.toFixed(2)}</div>
                  <div className="text-[10px] text-blue-500 mt-1">Debe comisión: ${summary.fuddiReceives.toFixed(2)}</div>
                </div>
                <div className="bg-green-50 p-5 rounded-2xl border border-green-100">
                  <div className="text-xs font-black text-green-400 uppercase tracking-widest mb-1">Fuddi Recauda</div>
                  <div className="text-2xl font-black text-green-700">${summary.collectedByFuddi.toFixed(2)}</div>
                  <div className="text-[10px] text-green-500 mt-1">Debe producto: ${summary.storeReceives.toFixed(2)}</div>
                </div>
                <div className={`p-5 rounded-2xl border ${netSettlement >= 0 ? 'bg-amber-50 border-amber-100' : 'bg-red-50 border-red-100'}`}>
                  <div className="text-xs font-black uppercase tracking-widest mb-1">{netSettlement >= 0 ? 'Fuddi paga a Tienda' : 'Tienda paga a Fuddi'}</div>
                  <div className={`text-2xl font-black ${netSettlement >= 0 ? 'text-amber-700' : 'text-red-700'}`}>
                    ${Math.abs(netSettlement).toFixed(2)}
                  </div>
                  <div className="text-[10px] text-gray-500 mt-1">Liquidación Neta</div>
                </div>
              </div>

              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="px-6 py-4 text-xs font-black text-gray-400 uppercase tracking-widest">Fecha</th>
                      <th className="px-6 py-4 text-xs font-black text-gray-400 uppercase tracking-widest">Monto</th>
                      <th className="px-6 py-4 text-xs font-black text-gray-400 uppercase tracking-widest">Cliente</th>
                      <th className="px-6 py-4 text-xs font-black text-gray-400 uppercase tracking-widest">Pago</th>
                      <th className="px-6 py-4 text-xs font-black text-gray-400 uppercase tracking-widest text-center">Recaudado</th>
                      <th className="px-6 py-4 text-xs font-black text-gray-400 uppercase tracking-widest text-center">Detalle Liq.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {(() => {
                      const groups = selectedData.orders.reduce((acc: any, order: Order) => {
                        const assignedId = order.delivery?.type === 'pickup' ? 'pickup' : (order.delivery?.assignedDelivery || 'unassigned')
                        if (!acc[assignedId]) acc[assignedId] = []
                        acc[assignedId].push(order)
                        return acc
                      }, {} as Record<string, Order[]>)

                      return Object.entries(groups)
                        .sort(([idA], [idB]) => {
                          if (idA === 'pickup') return 1
                          if (idB === 'pickup') return -1
                          return 0
                        })
                        .map(([groupId, groupOrders]: [string, any]) => {
                          const delivery = deliveries.find(d => d.id === groupId || (d as any).uid === groupId)
                          const groupTitle = groupId === 'pickup' ? 'Retiros en Tienda' : (delivery ? `Delivery: ${delivery.nombres}` : 'Delivery: Sin asignar')
                          const groupIcon = groupId === 'pickup' ? 'bi-person-fill' : 'bi-scooter'
                          const isCollapsed = collapsedGroups[groupId] !== false

                          return (
                            <Fragment key={groupId}>
                              {(() => {
                                const gTotal = groupOrders.reduce((sum: number, o: Order) => sum + (o.total || 0), 0)
                                const gInfo = groupOrders.reduce((acc2: any, o: Order) => {
                                  const info = getSettlementOrderInfo(o)
                                  acc2.commission += info.commission
                                  acc2.storeReceives += info.storeReceives
                                  return acc2
                                }, { commission: 0, storeReceives: 0 })

                                return (
                                  <tr
                                    className="bg-gray-50/50 cursor-pointer hover:bg-gray-100 transition-colors"
                                    onClick={() => setCollapsedGroups(prev => ({ ...prev, [groupId]: !prev[groupId] }))}
                                  >
                                    <td colSpan={6} className="px-6 py-2">
                                      <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2 text-xs font-bold text-gray-500 uppercase tracking-wider">
                                          <i className={`bi ${groupIcon}`}></i>
                                          {groupTitle}

                                          <div className="flex items-center gap-1.5 ml-4">
                                            <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded-full text-[10px] font-bold" title="Total Grupo">
                                              ${gTotal.toFixed(2)}
                                            </span>
                                            <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded-full text-[10px] font-bold" title="Comisión Total Grupo">
                                              Liq: -${gInfo.commission.toFixed(2)}
                                            </span>
                                          </div>
                                        </div>
                                        <i className={`bi bi-chevron-${isCollapsed ? 'down' : 'up'} text-gray-400`}></i>
                                      </div>
                                    </td>
                                  </tr>
                                )
                              })()}

                              {!isCollapsed && groupOrders.map((order: Order) => {
                                const info = getSettlementOrderInfo(order)
                                const isStoreCollector = order.paymentCollector === 'store'

                                return (
                                  <tr key={order.id} className="hover:bg-gray-50 border-b border-gray-50">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                      <div className="flex items-center gap-2">
                                        <div
                                          className={`inline-flex items-center justify-center w-5 h-5 rounded-full ${order.createdByAdmin ? 'bg-purple-100 text-purple-600' : 'bg-blue-100 text-blue-600'}`}
                                          title={order.createdByAdmin ? 'Pedido Manual (Tienda)' : 'Pedido Automático (Cliente)'}
                                        >
                                          <i className={`bi ${order.createdByAdmin ? 'bi-person-badge' : 'bi-phone'} text-[10px]`}></i>
                                        </div>
                                        {new Date(order.createdAt as any).toLocaleDateString()}
                                      </div>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900">
                                      ${(order.total || 0).toFixed(2)}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                      <div className="text-gray-900 font-medium">{order.customer.name}</div>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                      {order.payment.method === 'cash' ? 'Efectivo' : (
                                        (order.payment as any).receiptImageUrl ? (
                                          <button
                                            onClick={() => setSelectedOrderForProof(order)}
                                            className="text-blue-600 hover:text-blue-800 underline flex items-center gap-1 group"
                                          >
                                            {order.payment.method === 'transfer' ? 'Transf.' : 'Mixto'}
                                            <i className="bi bi-image group-hover:scale-110 transition-transform"></i>
                                          </button>
                                        ) : (
                                          <span>{order.payment.method === 'transfer' ? 'Transf.' : 'Mixto'}</span>
                                        )
                                      )}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-center">
                                      <button
                                        onClick={() => handleToggleCollector(order)}
                                        className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 ${isStoreCollector
                                          ? 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                                          : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                                          }`}
                                      >
                                        {isStoreCollector ? '🏢 Tienda' : '🦅 Fuddi'}
                                      </button>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-center">
                                      <div className="flex flex-col items-center">
                                        <div className="text-[10px] font-bold text-red-500">Comi: -${info.commission.toFixed(2)}</div>
                                        <div className="text-[10px] font-bold text-green-600">Tienda: ${info.storeReceives.toFixed(2)}</div>
                                      </div>
                                    </td>
                                  </tr>
                                )
                              })}
                            </Fragment>
                          )
                        })
                    })()}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  onClick={() => handleCreateSettlement(selectedData.business.id, selectedData.orders, selectedData.financials)}
                  disabled={processingSettlement}
                  className={`px-6 py-3 rounded-lg font-bold text-white ${processingSettlement ? 'bg-gray-400 cursor-not-allowed' : 'bg-green-600 hover:bg-green-700'}`}
                >
                  {processingSettlement ? 'Procesando...' : 'Generar Corte'}
                </button>
              </div>
            </div>
          )
        })()}

        {renderPaymentProofModal()}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-center">
        <div className="bg-gray-100 p-1 rounded-lg inline-flex">
          <button
            onClick={() => setMode('review')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${mode === 'review' ? 'bg-white shadow text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
          >
            Revisar órdenes
          </button>
          <button
            onClick={() => setMode('stores')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${mode === 'stores' ? 'bg-white shadow text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
          >
            Tiendas
          </button>
          <button
            onClick={() => setMode('deliveries')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${mode === 'deliveries' ? 'bg-white shadow text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
          >
            Deliverys
          </button>
        </div>
      </div>

      {mode === 'review' ? (
        renderOrdersReview()
      ) : mode === 'deliveries' ? (
        renderDeliverySettlements()
      ) : (
        <>
          <div className="flex justify-center">
            <div className="bg-gray-100 p-1 rounded-lg inline-flex">
              <button
                onClick={() => setSettlementsView('pending')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${settlementsView === 'pending' ? 'bg-white shadow text-blue-600' : 'text-gray-500 hover:text-gray-700'
                  }`}
              >
                Pendientes
              </button>
              <button
                onClick={() => setSettlementsView('history')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${settlementsView === 'history' ? 'bg-white shadow text-blue-600' : 'text-gray-500 hover:text-gray-700'
                  }`}
              >
                Historial de Cortes
              </button>
            </div>
          </div>

          {settlementsView === 'pending' ? (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="mb-4">
                <h3 className="text-lg font-bold text-gray-900">Resumen de Pendientes por Tienda</h3>
              </div>

              {settlementsByBusiness.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <i className="bi bi-check-circle text-4xl mb-3 block text-green-500"></i>
                  No hay órdenes pendientes de liquidación.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {settlementsByBusiness.map((item: any) => (
                    <div key={item.business.id} className="bg-white border boundary-gray-200 rounded-xl p-4 shadow-sm hover:shadow-md transition-all">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-10 h-10 rounded-full bg-gray-100 overflow-hidden">
                          {item.business.image ? (
                            <img src={item.business.image} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center"><i className="bi bi-shop text-gray-400"></i></div>
                          )}
                        </div>
                        <div>
                          <h4 className="font-bold text-gray-900 line-clamp-1">{item.business.name}</h4>
                          <p className="text-xs text-gray-500">{item.financials.count} órdenes pendientes</p>
                        </div>
                      </div>
                      <div className="space-y-2 mb-4">
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-500">Ventas (Subtotal)</span>
                          <span className="font-semibold">${item.financials.totalSubtotal.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-500">Comisiones</span>
                          <span className="text-red-500 font-semibold">-${item.financials.totalCommission.toFixed(2)}</span>
                        </div>
                        <div className="pt-2 border-t border-gray-100 flex justify-between items-center">
                          <span className="text-xs font-bold text-gray-500 uppercase">A Transferir</span>
                          <span className={`text-lg font-bold ${item.financials.netAmount >= 0 ? 'text-green-600' : 'text-orange-600'}`}>
                            ${item.financials.netAmount.toFixed(2)}
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={() => setSelectedSettlementBusiness(item.business.id)}
                        className="w-full py-2 bg-gray-50 text-gray-700 font-semibold rounded-lg hover:bg-gray-100 transition-colors text-sm"
                      >
                        Ver Detalles
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
              <div className="p-6 border-b border-gray-100">
                <h3 className="text-lg font-bold text-gray-900">Historial de Cortes Realizados</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Fecha Corte</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tienda</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Periodo</th>
                      <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">Órdenes</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Ventas</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Comisión</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Neto Transf.</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {settlementsHistory.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                          No hay historial de cortes.
                        </td>
                      </tr>
                    ) : (
                      settlementsHistory.map((settlement) => {
                        const business = businesses.find(b => b.id === settlement.businessId)
                        return (
                          <tr key={settlement.id} className="hover:bg-gray-50">
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {(settlement as any).createdAt ? new Date((settlement as any).createdAt).toLocaleDateString() : '-'}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="text-sm font-medium text-gray-900">{business?.name || 'Desconocido'}</div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {new Date(settlement.startDate as any).toLocaleDateString()} - {new Date(settlement.endDate as any).toLocaleDateString()}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-900">
                              {settlement.totalOrders}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium text-gray-900">
                              ${settlement.totalSales.toFixed(2)}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium text-red-600">
                              -${settlement.totalCommission.toFixed(2)}
                            </td>
                            <td className={`px-6 py-4 whitespace-nowrap text-right text-sm font-bold ${settlement.netAmount >= 0 ? 'text-green-600' : 'text-orange-600'}`}>
                              ${settlement.netAmount.toFixed(2)}
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {renderPaymentProofModal()}
    </div>
  )
}
