import React, { useState, useMemo, useEffect } from 'react'
import { Order, Business, Settlement } from '@/types'
import { format, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, isWithinInterval, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { getSettlementsByBusiness } from '@/lib/database'

interface WalletViewProps {
    business: Business
    orders: Order[]
    historicalOrders: Order[]
}

type TimeRange = 'today' | 'week' | 'month' | 'custom'
type ViewMode = 'pending' | 'all'

export default function WalletView({ business, orders, historicalOrders }: WalletViewProps) {
    const [timeRange, setTimeRange] = useState<TimeRange>('today')
    const [customStartDate, setCustomStartDate] = useState('')
    const [customEndDate, setCustomEndDate] = useState('')
    const [viewMode, setViewMode] = useState<ViewMode>('pending')
    const [settlements, setSettlements] = useState<Settlement[]>([])
    const [loadingSettlements, setLoadingSettlements] = useState(true)

    // Cargar liquidaciones de esta tienda
    useEffect(() => {
        const loadSettlements = async () => {
            try {
                setLoadingSettlements(true)
                const businessSettlements = await getSettlementsByBusiness(business.id)
                setSettlements(businessSettlements || [])
            } catch (error) {
                console.error('Error loading settlements:', error)
                setSettlements([])
            } finally {
                setLoadingSettlements(false)
            }
        }
        loadSettlements()
    }, [business.id])

    // Combinar todas las órdenes
    const allOrders = useMemo(() => {
        // Filtrar duplicados por si acaso
        const seen = new Set()
        return [...orders, ...historicalOrders].filter(order => {
            if (seen.has(order.id)) return false
            seen.add(order.id)
            return true
        }).filter(order => {
            // Excluir estados no válidos
            if (['borrador', 'pending', 'cancelled'].includes(order.status as any)) return false
            return true
        })
    }, [orders, historicalOrders])

    // Separar órdenes pendientes vs liquidadas
    const { pendingOrders, settledOrders } = useMemo(() => {
        const pending = allOrders.filter(order => {
            if (order.settlementStatus && order.settlementStatus !== 'pending') return false
            return true
        })
        
        const settled = allOrders.filter(order => {
            return order.settlementStatus === 'settled' || order.settlementId
        })
        
        return { pendingOrders: pending, settledOrders: settled }
    }, [allOrders])

    // Filtrar por tiempo según vista actual
    const filteredOrders = useMemo(() => {
        const ordersToFilter = viewMode === 'pending' ? pendingOrders : [...pendingOrders, ...settledOrders]
        
        const now = new Date()
        let start: Date
        let end: Date

        switch (timeRange) {
            case 'today':
                start = startOfDay(now)
                end = endOfDay(now)
                break
            case 'week':
                start = startOfWeek(now, { weekStartsOn: 1 }) // Lunes
                end = endOfWeek(now, { weekStartsOn: 1 })
                break
            case 'month':
                start = startOfMonth(now)
                end = endOfMonth(now)
                break
            case 'custom':
                if (!customStartDate || !customEndDate) return ordersToFilter
                start = startOfDay(parseISO(customStartDate))
                end = endOfDay(parseISO(customEndDate))
                break
            default:
                start = startOfDay(now)
                end = endOfDay(now)
        }

        return ordersToFilter.filter(order => {
            let orderDate: Date
            if (order.createdAt && typeof order.createdAt === 'object' && 'toDate' in order.createdAt) {
                orderDate = (order.createdAt as any).toDate()
            } else if (typeof order.createdAt === 'string') {
                orderDate = new Date(order.createdAt)
            } else {
                return false
            }
            return isWithinInterval(orderDate, { start, end })
        })
    }, [pendingOrders, settledOrders, timeRange, customStartDate, customEndDate, viewMode])

    // Filtrar liquidaciones por tiempo
    const filteredSettlements = useMemo(() => {
        if (viewMode === 'pending') return []
        
        const now = new Date()
        let start: Date
        let end: Date

        switch (timeRange) {
            case 'today':
                start = startOfDay(now)
                end = endOfDay(now)
                break
            case 'week':
                start = startOfWeek(now, { weekStartsOn: 1 })
                end = endOfWeek(now, { weekStartsOn: 1 })
                break
            case 'month':
                start = startOfMonth(now)
                end = endOfMonth(now)
                break
            case 'custom':
                if (!customStartDate || !customEndDate) return settlements
                start = startOfDay(parseISO(customStartDate))
                end = endOfDay(parseISO(customEndDate))
                break
            default:
                start = startOfDay(now)
                end = endOfDay(now)
        }

        return settlements.filter(settlement => {
            const settlementDate = new Date(settlement.createdAt)
            return isWithinInterval(settlementDate, { start, end })
        })
    }, [settlements, timeRange, customStartDate, customEndDate, viewMode])

    // Función para calcular información de liquidación (igual que en AdminSettlements)
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

    const financials = useMemo(() => {
        let totalSales = 0
        let totalSubtotal = 0
        let totalCommission = 0
        let totalDelivery = 0
        let collectedByFuddi = 0
        let collectedByStore = 0
        let collectedByFuddiSubtotal = 0
        let collectedByStoreSubtotal = 0
        let settledAmount = 0
        let totalWithdrawals = 0

        // Calcular ingresos de órdenes
        filteredOrders.forEach(order => {
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

            // Si está liquidada, sumar al monto retirado
            if (order.settlementStatus === 'settled') {
                const info = getSettlementOrderInfo(order)
                settledAmount += info.storeReceives
            }
        })

        // Sumar retiros de liquidaciones procesadas
        filteredSettlements.forEach(settlement => {
            totalWithdrawals += Math.abs(settlement.netAmount)
        })

        // El balance real es: ingresos netos - retiros
        const netIncome = totalSubtotal - totalCommission // lo que generaron las ventas
        const currentBalance = netIncome - totalWithdrawals // saldo actual
        const pendingToSettle = netIncome - settledAmount // pendiente por liquidar

        return {
            totalSales,
            totalSubtotal,
            totalCommission,
            totalDelivery,
            collectedByFuddi,
            collectedByStore,
            collectedByFuddiSubtotal,
            collectedByStoreSubtotal,
            netIncome,
            totalWithdrawals,
            currentBalance,
            pendingToSettle,
            settledAmount,
            orderCount: filteredOrders.length
        }
    }, [filteredOrders, filteredSettlements])

    return (
        <div className="p-6 max-w-7xl mx-auto">
            <div className="mb-8">
                <h1 className="text-2xl font-bold text-gray-900 mb-2">Billetera</h1>
                <p className="text-gray-600">Gestión de ingresos y comisiones de Fuddi.</p>
            </div>

            {/* Filtros de Fecha y Vista */}
            <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 mb-6">
                <div className="flex flex-wrap items-center gap-4">
                    {/* Selector de Vista */}
                    <div className="flex gap-2 p-1 bg-gray-100 rounded-lg">
                        <button
                            onClick={() => setViewMode('pending')}
                            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${viewMode === 'pending'
                                ? 'bg-orange-500 text-white shadow-sm'
                                : 'text-gray-500 hover:text-gray-900'
                                }`}
                        >
                            Pendientes
                        </button>
                        <button
                            onClick={() => setViewMode('all')}
                            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${viewMode === 'all'
                                ? 'bg-green-500 text-white shadow-sm'
                                : 'text-gray-500 hover:text-gray-900'
                                }`}
                        >
                            Todos
                        </button>
                    </div>

                    {/* Filtros de Fecha */}
                    <div className="flex gap-2 p-1 bg-gray-100 rounded-lg">
                        {(['today', 'week', 'month', 'custom'] as TimeRange[]).map((range) => (
                            <button
                                key={range}
                                onClick={() => setTimeRange(range)}
                                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${timeRange === range
                                    ? 'bg-white text-gray-900 shadow-sm'
                                    : 'text-gray-500 hover:text-gray-900'
                                    }`}
                            >
                                {range === 'today' && 'Hoy'}
                                {range === 'week' && 'Esta Semana'}
                                {range === 'month' && 'Este Mes'}
                                {range === 'custom' && 'Personalizado'}
                            </button>
                        ))}
                    </div>

                    {timeRange === 'custom' && (
                        <div className="flex items-center gap-2">
                            <input
                                type="date"
                                value={customStartDate}
                                onChange={(e) => setCustomStartDate(e.target.value)}
                                className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                            />
                            <span className="text-gray-500">-</span>
                            <input
                                type="date"
                                value={customEndDate}
                                onChange={(e) => setCustomEndDate(e.target.value)}
                                className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                            />
                        </div>
                    )}
                </div>
            </div>

            {/* Saldo Disponible */}
            <div className="bg-gradient-to-br from-blue-600 to-blue-700 p-8 rounded-xl shadow-lg text-white mb-8">
                <div className="flex items-center justify-between mb-6">
                    <div className="p-4 bg-white/20 rounded-lg backdrop-blur-sm">
                        <span className="material-symbols-rounded text-3xl">account_balance_wallet</span>
                    </div>
                    <span className="text-sm font-medium text-blue-100">
                        Saldo Disponible
                    </span>
                </div>
                <h3 className="text-blue-100 text-lg font-medium mb-2">Tu saldo actual</h3>
                <p className="text-5xl font-bold mb-2">${financials.currentBalance.toFixed(2)}</p>
                <p className="text-sm text-blue-200">{financials.orderCount} movimientos en este período</p>
            </div>

            {/* Movimientos Estilo Billetera */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200">
                <div className="p-6 border-b border-gray-100">
                    <h3 className="text-lg font-bold text-gray-900 mb-1">
                        {viewMode === 'pending' ? 'Movimientos Pendientes' : 'Todos los Movimientos'}
                    </h3>
                    <p className="text-sm text-gray-500">
                        {viewMode === 'pending' 
                            ? 'Ventas esperando ser liquidadas'
                            : 'Historial completo de tu billetera'
                        }
                    </p>
                </div>
                
                {loadingSettlements ? (
                    <div className="p-12 text-center text-gray-500">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
                        Cargando movimientos...
                    </div>
                ) : filteredOrders.length === 0 && filteredSettlements.length === 0 ? (
                    <div className="p-12 text-center text-gray-500">
                        <span className="material-symbols-rounded text-4xl mb-3 block text-green-500">check_circle</span>
                        No hay movimientos en este período.
                    </div>
                ) : (
                    <div className="divide-y divide-gray-100">
                        {/* Ventas (Ingresos) */}
                        {filteredOrders
                            .sort((a, b) => new Date(b.createdAt as any).getTime() - new Date(a.createdAt as any).getTime())
                            .map((order) => {
                                const info = getSettlementOrderInfo(order)
                                const isStoreCollector = order.paymentCollector === 'store'
                                const isSettled = order.settlementStatus === 'settled'
                                const isPickup = order.delivery?.type === 'pickup'
                                
                                return (
                                    <div key={order.id} className="p-6 hover:bg-gray-50 transition-colors">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-4">
                                                <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                                                    isSettled ? 'bg-gray-100' : 'bg-green-100'
                                                }`}>
                                                    <span className={`material-symbols-rounded text-xl ${
                                                        isSettled ? 'text-gray-600' : 'text-green-600'
                                                    }`}>
                                                        {isSettled ? 'shopping_bag' : 'add_circle'}
                                                    </span>
                                                </div>
                                                <div>
                                                    <div className="font-semibold text-gray-900">
                                                        Venta - Pedido #{order.id.slice(-6)}
                                                        <span className={`ml-2 text-xs font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${
                                                            isPickup ? 'bg-gray-100 text-gray-600' : 'bg-blue-100 text-blue-700'
                                                        }`}>
                                                            {isPickup ? 'Retiro' : 'Delivery'}
                                                        </span>
                                                        {isSettled && (
                                                            <span className="ml-2 text-xs font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                                                                Liquidado
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="text-sm text-gray-500">
                                                        {new Date(order.createdAt as any).toLocaleDateString()} • {order.customer?.name || 'Cliente'}
                                                    </div>
                                                    <div className="flex items-center gap-2 mt-1">
                                                        <span className={`text-xs font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${
                                                            isStoreCollector
                                                                ? 'bg-purple-100 text-purple-700'
                                                                : 'bg-blue-100 text-blue-700'
                                                        }`}>
                                                            {isStoreCollector ? '🏢 Tienda' : '🦅 Fuddi'}
                                                        </span>
                                                        <span className="text-xs text-gray-500">
                                                            {order.payment.method === 'cash' ? 'Efectivo' : 
                                                             order.payment.method === 'transfer' ? 'Transferencia' : 'Mixto'}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <div className="text-lg font-bold text-green-600">
                                                    +${info.storeReceives.toFixed(2)}
                                                </div>
                                                <div className="text-xs text-gray-500">
                                                    Total: ${(order.total || 0).toFixed(2)}
                                                </div>
                                                <div className="text-xs text-red-500">
                                                    Comisión: -${info.commission.toFixed(2)}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )
                            })
                        }
                        
                        {/* Liquidaciones (Retiros) */}
                        {viewMode === 'all' && filteredSettlements
                            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                            .map((settlement) => (
                                <div key={settlement.id} className="p-6 hover:bg-gray-50 transition-colors">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-4">
                                            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
                                                <span className="material-symbols-rounded text-red-600 text-xl">remove_circle</span>
                                            </div>
                                            <div>
                                                <div className="font-semibold text-gray-900">Liquidación / Retiro</div>
                                                <div className="text-sm text-gray-500">
                                                    {new Date(settlement.createdAt).toLocaleDateString()} • {settlement.totalOrders} órdenes liquidadas
                                                </div>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <div className="text-lg font-bold text-red-600">-${Math.abs(settlement.netAmount).toFixed(2)}</div>
                                            <div className="text-xs text-gray-500">Transferido a tu cuenta</div>
                                        </div>
                                    </div>
                                </div>
                            ))
                        }
                    </div>
                )}
            </div>

            <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 flex items-start gap-3 mt-6">
                <span className="material-symbols-rounded text-blue-600 mt-0.5">info</span>
                <div>
                    <h4 className="font-semibold text-blue-900 text-sm">¿Cómo funciona tu billetera?</h4>
                    <p className="text-blue-800 text-sm mt-1">
                        • <strong>Ingresos:</strong> Cada venta suma dinero a tu billetera (venta - comisión Fuddi)<br/>
                        • <strong>Retiros:</strong> Cuando el administrador hace liquidaciones, se resta dinero de tu billetera<br/>
                        • <strong>Saldo Actual:</strong> Es lo que tienes disponible actualmente (ingresos - retiros)
                    </p>
                </div>
            </div>
        </div>
    )
}
