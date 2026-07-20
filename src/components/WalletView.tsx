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

            const isPickup = order.delivery?.type === 'pickup'
            const isCash = order.payment?.method === 'cash'
            const isStoreMoney = isPickup && isCash
            const currentOrderTotal = order.total || 0

            if (isStoreMoney) {
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

        // El resultado neto a transferir a la tienda es: Ventas Digitales recaudadas por Fuddi - Comisión Total de Fuddi - Retiros previos
        const netIncome = collectedByFuddiSubtotal - totalCommission
        const currentBalance = netIncome - totalWithdrawals
        const pendingToSettle = netIncome - settledAmount

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
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-gray-900 mb-1">Finanzas</h1>
                <p className="text-gray-600">Resumen de ingresos, valores a recibir y estado de depósitos de Fuddi.</p>
            </div>

            {/* Aviso de Horario Fijo de Depósitos y Corte Visual */}
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 flex items-start gap-3 text-amber-900 shadow-sm">
                <span className="material-symbols-rounded text-amber-600 text-xl mt-0.5">schedule</span>
                <div className="text-sm">
                    <span className="font-bold">Corte diario y horario de depósito:</span>
                    <p className="mt-0.5 text-amber-800">
                        Los cortes se realizan automáticamente a las <strong>00:00 (medianoche)</strong>. Las ventas posteriores pertenecen al día siguiente. Las transferencias bancarias correspondientes al saldo pendiente se realizan antes de las <strong>2:00 PM</strong>.
                    </p>
                </div>
            </div>

            {/* Filtros de Fecha y Vista */}
            <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 mb-6">
                <div className="flex flex-wrap items-center gap-4">
                    {/* Selector de Vista */}
                    <div className="flex gap-2 p-1 bg-gray-100 rounded-lg">
                        <button
                            onClick={() => setViewMode('pending')}
                            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${viewMode === 'pending'
                                ? 'bg-amber-500 text-white shadow-sm'
                                : 'text-gray-500 hover:text-gray-900'
                                }`}
                        >
                            🟡 Pendientes de Pago
                        </button>
                        <button
                            onClick={() => setViewMode('all')}
                            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${viewMode === 'all'
                                ? 'bg-emerald-600 text-white shadow-sm'
                                : 'text-gray-500 hover:text-gray-900'
                                }`}
                        >
                            🟢 Historial Completo
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

            {/* Tarjeta Destacada de Valores a Recibir */}
            <div className="bg-gradient-to-br from-slate-900 to-slate-800 p-6 sm:p-8 rounded-2xl shadow-xl text-white mb-8">
                <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
                    <div className="flex items-center gap-3">
                        <div className="p-3 bg-white/10 rounded-xl backdrop-blur-md">
                            <span className="material-symbols-rounded text-2xl text-emerald-400">payments</span>
                        </div>
                        <div>
                            <span className="text-xs uppercase tracking-widest text-slate-400 font-bold block">Resumen de Liquidación</span>
                            <h2 className="text-lg font-semibold text-white">Valores por Recibir</h2>
                        </div>
                    </div>
                    <div>
                        {financials.currentBalance > 0 ? (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-amber-400/20 text-amber-300 border border-amber-400/30">
                                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
                                🟡 Pendiente de depósito
                            </span>
                        ) : (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-emerald-400/20 text-emerald-300 border border-emerald-400/30">
                                <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                                🟢 Depositado / Al día
                            </span>
                        )}
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4 border-t border-slate-700/60">
                    <div>
                        <span className="text-xs text-slate-400 block mb-1">Resultado Neto del Período</span>
                        {financials.currentBalance >= 0 ? (
                            <div className="text-3xl sm:text-4xl font-extrabold text-emerald-400">
                                Te transferiremos ${financials.currentBalance.toFixed(2)}
                            </div>
                        ) : (
                            <div className="text-3xl sm:text-4xl font-extrabold text-amber-400">
                                Debes pagar de comisiones ${Math.abs(financials.currentBalance).toFixed(2)}
                            </div>
                        )}
                        <span className="text-xs text-slate-400 mt-2 block">
                            (Ventas Digitales - Comisión Fuddi - Efectivo Retenido)
                        </span>
                    </div>

                    <div className="bg-slate-800/80 p-4 rounded-xl border border-slate-700/50">
                        <span className="text-xs text-slate-400 block mb-1">Ventas Digitales</span>
                        <div className="text-xl font-bold text-white">${financials.collectedByFuddiSubtotal.toFixed(2)}</div>
                        <div className="text-xs text-emerald-400 mt-1">Cobrado por Fuddi (Tarjeta/Transferencia)</div>
                    </div>

                    <div className="bg-slate-800/80 p-4 rounded-xl border border-slate-700/50">
                        <span className="text-xs text-slate-400 block mb-1">Comisiones Fuddi</span>
                        <div className="text-xl font-bold text-rose-400">-${financials.totalCommission.toFixed(2)}</div>
                        <div className="text-xs text-slate-400 mt-1">{financials.orderCount} órdenes en el período</div>
                    </div>
                </div>
            </div>

            {/* Movimientos / Órdenes */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200">
                <div className="p-6 border-b border-gray-100">
                    <h3 className="text-lg font-bold text-gray-900 mb-1">
                        {viewMode === 'pending' ? 'Órdenes Pendientes de Pago' : 'Todos los Movimientos'}
                    </h3>
                    <p className="text-sm text-gray-500">
                        {viewMode === 'pending' 
                            ? 'Ventas registradas en el período que están por ser depositadas'
                            : 'Historial completo de ventas y liquidaciones depositadas'
                        }
                    </p>
                </div>
                
                {loadingSettlements ? (
                    <div className="p-12 text-center text-gray-500">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600 mx-auto mb-4"></div>
                        Cargando movimientos...
                    </div>
                ) : filteredOrders.length === 0 && filteredSettlements.length === 0 ? (
                    <div className="p-12 text-center text-gray-500">
                        <span className="material-symbols-rounded text-4xl mb-3 block text-emerald-500">check_circle</span>
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
                                                    isSettled ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                                                }`}>
                                                    <span className="material-symbols-rounded text-xl">
                                                        {isSettled ? 'check_circle' : 'hourglass_top'}
                                                    </span>
                                                </div>
                                                <div>
                                                    <div className="font-semibold text-gray-900 flex items-center gap-2 flex-wrap">
                                                        <span>Venta - Pedido #{order.id.slice(-6)}</span>
                                                        <span className={`text-xs font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${
                                                            isPickup ? 'bg-gray-100 text-gray-600' : 'bg-blue-100 text-blue-700'
                                                        }`}>
                                                            {isPickup ? 'Retiro' : 'Delivery'}
                                                        </span>
                                                        {isSettled ? (
                                                            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                                                                🟢 Depositado
                                                            </span>
                                                        ) : (
                                                            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                                                                🟡 Pendiente de depósito
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
                                                <div className="text-lg font-bold text-emerald-600">
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
                        
                        {/* Liquidaciones (Retiros / Pagos Realizados) */}
                        {viewMode === 'all' && filteredSettlements
                            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                            .map((settlement) => (
                                <div key={settlement.id} className="p-6 hover:bg-gray-50 transition-colors">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-4">
                                            <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center">
                                                <span className="material-symbols-rounded text-emerald-600 text-xl">verified</span>
                                            </div>
                                            <div>
                                                <div className="font-semibold text-gray-900 flex items-center gap-2">
                                                    <span>Liquidación Depositada</span>
                                                    <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                                                        🟢 Depositado
                                                    </span>
                                                </div>
                                                <div className="text-sm text-gray-500">
                                                    {new Date(settlement.createdAt).toLocaleDateString()} • {settlement.totalOrders} órdenes liquidadas
                                                </div>
                                                {(settlement as any).referenceNumber && (
                                                    <div className="text-xs text-gray-600 mt-1 font-mono">
                                                        Ref. Bancaria: {(settlement as any).referenceNumber}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <div className="text-lg font-bold text-emerald-600">${Math.abs(settlement.netAmount).toFixed(2)}</div>
                                            <div className="text-xs text-gray-500">Depositado en tu cuenta</div>
                                        </div>
                                    </div>
                                </div>
                            ))
                        }
                    </div>
                )}
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex items-start gap-3 mt-6">
                <span className="material-symbols-rounded text-slate-600 mt-0.5">info</span>
                <div>
                    <h4 className="font-semibold text-slate-900 text-sm">¿Cómo se calculan tus valores a recibir?</h4>
                    <p className="text-slate-700 text-sm mt-1">
                        • <strong>Ventas Digitales:</strong> Dinero cobrado por Fuddi (Tarjeta/Transferencia) que se te abonará.<br/>
                        • <strong>Ventas en Efectivo:</strong> Dinero cobrado directamente en tu local o por tus repartidores.<br/>
                        • <strong>Corte Automático:</strong> Toda orden generada antes de la medianoche (00:00) entra en el depósito de las 2:00 PM del día siguiente.<br/>
                        • <strong>Estado:</strong> Cambia automáticamente de 🟡 <strong>Pendiente de depósito</strong> a 🟢 <strong>Depositado</strong> cuando el administrador procesa el pago.
                    </p>
                </div>
            </div>
        </div>
    )
}
