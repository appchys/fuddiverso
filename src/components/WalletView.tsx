'use client'

import React, { useState, useMemo, useEffect } from 'react'
import { Order, Business, Settlement } from '@/types'
import { format, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, isWithinInterval, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { getSettlementsByBusiness, getOrdersByBusinessComplete } from '@/lib/database'
import { Timestamp } from 'firebase/firestore'

interface WalletViewProps {
    business: Business
    orders: Order[]
    historicalOrders: Order[]
}

type TimeRange = 'today' | 'week' | 'month' | 'custom'
type ViewMode = 'pending' | 'all'

const toSafeDate = (val: any): Date => {
    if (!val) return new Date()
    if (val instanceof Timestamp) return val.toDate()
    if (typeof val.toDate === 'function') return val.toDate()
    if (val.seconds) return new Date(val.seconds * 1000)
    if (typeof val === 'string') {
        const dateOnlyMatch = val.match(/^(\d{4})-(\d{2})-(\d{2})$/)
        if (dateOnlyMatch) {
            const [, year, month, day] = dateOnlyMatch
            return new Date(Number(year), Number(month) - 1, Number(day))
        }
        return new Date(val)
    }
    if (val instanceof Date) return val
    return new Date()
}

const getOrderProgrammedDate = (order: Order): Date => {
    if (order.timing?.scheduledDate) {
        return toSafeDate(order.timing.scheduledDate)
    }
    return toSafeDate(order.createdAt)
}

const getLocalDateString = (date: Date): string => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

const getOrderDisplayTime = (order: Order) => {
    try {
        if (order.timing?.scheduledTime) {
            return order.timing.scheduledTime;
        }
        const date = toSafeDate(order.createdAt);
        return date.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
        return '--:--';
    }
}

export default function WalletView({ business, orders, historicalOrders }: WalletViewProps) {
    const [settlements, setSettlements] = useState<Settlement[]>([])
    const [loadingSettlements, setLoadingSettlements] = useState(true)
    const [expandedDays, setExpandedDays] = useState<Record<string, boolean>>({})
    const [localHistoricalOrders, setLocalHistoricalOrders] = useState<Order[]>([])
    const [loadingHistory, setLoadingHistory] = useState(true)
    const [pendingGroupsExpanded, setPendingGroupsExpanded] = useState(true)
    const [settledGroupsExpanded, setSettledGroupsExpanded] = useState(false)
    const [showInfoModal, setShowInfoModal] = useState(false)

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

    // Cargar historial de órdenes completo para las finanzas de esta tienda
    useEffect(() => {
        const loadHistory = async () => {
            try {
                setLoadingHistory(true)
                const data = await getOrdersByBusinessComplete(business.id)
                setLocalHistoricalOrders(data || [])
            } catch (error) {
                console.error('Error loading complete history in WalletView:', error)
            } finally {
                setLoadingHistory(false)
            }
        }
        loadHistory()
    }, [business.id])

    // Combinar todas las órdenes sin duplicados y excluir borradores/canceladas
    const allOrders = useMemo(() => {
        const seen = new Set()
        return [...orders, ...localHistoricalOrders].filter(order => {
            if (seen.has(order.id)) return false
            seen.add(order.id)
            return true
        }).filter(order => {
            if (['borrador', 'pending', 'cancelled'].includes(order.status as any)) return false
            return true
        })
    }, [orders, localHistoricalOrders])

    // Separar órdenes pendientes vs liquidadas
    const { pendingOrders, settledOrders } = useMemo(() => {
        const pending = allOrders.filter(order => {
            if (order.settlementStatus && order.settlementStatus !== 'pending') return false
            return true
        })
        
        const settled = allOrders.filter(order => {
            return order.settlementStatus === 'settled' || Boolean(order.settlementId)
        })
        
        return { pendingOrders: pending, settledOrders: settled }
    }, [allOrders])

    // Mostrar la totalidad de las órdenes históricas sin ningún filtro de fecha
    const filteredOrders = allOrders

    // Información financiera de cada pedido
    const getSettlementOrderInfo = (order: Order) => {
        let orderCommission = 0
        let orderSubtotal = 0

        if (order.items && order.items.length > 0) {
            order.items.forEach((item: any) => {
                const qty = item.quantity || 1
                orderCommission += (item.commission || 0) * qty
                orderSubtotal += (item.price || 0) * qty
            })
        } else {
            const deliveryFee = order.delivery?.type === 'delivery' ? (order.delivery?.deliveryCost || 0) : 0
            orderSubtotal = order.subtotal || Math.max(0, (order.total || 0) - deliveryFee)
        }

        const isPickup = order.delivery?.type === 'pickup'
        const isCash = order.payment?.method === 'cash'
        const isStoreMoney = order.paymentCollector ? (order.paymentCollector === 'store') : (isPickup && isCash)

        const cashCollected = isStoreMoney ? orderSubtotal : 0
        const digitalCollected = isStoreMoney ? 0 : orderSubtotal
        const storeReceives = digitalCollected - orderCommission

        return {
            subtotal: orderSubtotal,
            commission: orderCommission,
            storeReceives,
            cashCollected,
            digitalCollected,
            isStoreMoney
        }
    }

    // Totales financieros generales para el encabezado (solo valores pendientes, sin filtro de fecha)
    const financials = useMemo(() => {
        let totalSales = 0
        let totalCommission = 0
        let collectedByFuddi = 0
        let collectedByStore = 0
        let totalDelivery = 0
        let settledAmount = 0

        pendingOrders.forEach(order => {
            const info = getSettlementOrderInfo(order)
            const deliveryFee = order.delivery?.type === 'delivery' ? (order.delivery?.deliveryCost || 0) : 0

            totalSales += info.subtotal
            totalCommission += info.commission
            totalDelivery += deliveryFee

            if (info.isStoreMoney) {
                collectedByStore += info.subtotal
            } else {
                collectedByFuddi += info.subtotal
            }

            if (order.settlementStatus === 'settled') {
                settledAmount += info.storeReceives
            }
        })

        const netBalance = collectedByFuddi - totalCommission
        const pendingToSettle = netBalance - settledAmount

        return {
            totalSales,
            totalCommission,
            collectedByFuddi,
            collectedByStore,
            totalDelivery,
            netBalance,
            pendingToSettle,
            settledAmount,
            orderCount: pendingOrders.length
        }
    }, [pendingOrders])

    // Agrupar órdenes por FECHA DE PROGRAMACIÓN
    const groupedDays = useMemo(() => {
        const todayStr = getLocalDateString(new Date())
        const groups: Record<string, Order[]> = {}

        filteredOrders.forEach(order => {
            const progDate = getOrderProgrammedDate(order)
            const dateStr = getLocalDateString(progDate)
            if (!groups[dateStr]) {
                groups[dateStr] = []
            }
            groups[dateStr].push(order)
        })

        return Object.entries(groups).map(([dateStr, ordersList]) => {
            const [y, m, d] = dateStr.split('-').map(Number)
            const date = new Date(y, m - 1, d, 12, 0, 0)
            const isToday = dateStr === todayStr

            let displayDate = ''
            if (isToday) {
                displayDate = `Hoy (${date.toLocaleDateString('es-EC', { day: 'numeric', month: 'short' })})`
            } else {
                const formatted = date.toLocaleDateString('es-EC', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric'
                })
                displayDate = formatted.charAt(0).toUpperCase() + formatted.slice(1)
            }

            let daySales = 0
            let dayCommission = 0
            let dayCashCollected = 0
            let dayDigitalCollected = 0
            let dayPendingCount = 0
            let daySettledCount = 0

            ordersList.forEach(o => {
                const info = getSettlementOrderInfo(o)
                daySales += info.subtotal
                dayCommission += info.commission
                dayCashCollected += info.cashCollected
                dayDigitalCollected += info.digitalCollected

                if (o.settlementStatus === 'settled') {
                    daySettledCount++
                } else {
                    dayPendingCount++
                }
            })

            const dayNetBalance = dayDigitalCollected - dayCommission
            const isDayFullySettled = ordersList.length > 0 && ordersList.every(o => o.settlementStatus === 'settled')

            return {
                dateStr,
                displayDate,
                date,
                isToday,
                ordersList,
                daySales,
                dayCommission,
                dayCashCollected,
                dayDigitalCollected,
                dayNetBalance,
                dayPendingCount,
                daySettledCount,
                isDayFullySettled
            }
        }).sort((a, b) => b.dateStr.localeCompare(a.dateStr))
    }, [filteredOrders])

    // Separar jornadas según su estado (Pendientes vs Liquidadas)
    const { pendingDays, settledDays } = useMemo(() => {
        const pending = groupedDays.filter(day => !day.isDayFullySettled)
        const settled = groupedDays.filter(day => day.isDayFullySettled)
        return { pendingDays: pending, settledDays: settled }
    }, [groupedDays])

    const renderDayRow = (day: typeof groupedDays[0]) => {
        const isExpanded = Boolean(expandedDays[day.dateStr])

        return (
            <div key={day.dateStr} className="bg-white rounded-2xl border border-slate-200/80 shadow-2xs overflow-hidden transition-all">
                {/* Cabecera del Día */}
                <div
                    onClick={() => toggleDayExpand(day.dateStr)}
                    className="py-3 px-4 hover:bg-slate-50/60 transition-colors cursor-pointer flex flex-wrap items-center justify-between gap-3 select-none"
                >
                    <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="font-bold text-sm text-slate-900 leading-tight">{day.displayDate}</h4>
                            <span className="text-[10px] font-semibold text-slate-400">({day.ordersList.length} {day.ordersList.length === 1 ? 'orden' : 'órdenes'})</span>
                        </div>

                        <div className="flex items-center gap-3 text-xs">
                            <span className="text-slate-600 font-medium">Ventas: <strong className="text-slate-900">${day.daySales.toFixed(2)}</strong></span>
                            <span className="text-slate-400">Comisión: <strong className="text-slate-500">-${day.dayCommission.toFixed(2)}</strong></span>
                        </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                        <div className="text-right">
                            <span className="text-[10px] text-slate-400 font-medium block">Neto del Día</span>
                            <span className={`text-sm font-bold ${day.dayNetBalance >= 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
                                {day.dayNetBalance >= 0 ? `+$${day.dayNetBalance.toFixed(2)}` : `-$${Math.abs(day.dayNetBalance).toFixed(2)}`}
                            </span>
                        </div>

                        {day.isDayFullySettled ? (
                            <span className="px-2.5 py-1 text-[10px] font-bold rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/60 flex items-center gap-1">
                                <i className="bi bi-check-circle-fill text-[10px]"></i>
                                <span>Depositado</span>
                            </span>
                        ) : (
                            <span className="px-2.5 py-1 text-[10px] font-bold rounded-full bg-amber-50 text-amber-700 border border-amber-200/60 flex items-center gap-1">
                                <i className="bi bi-hourglass-split text-[10px]"></i>
                                <span>Pendiente ({day.dayPendingCount})</span>
                            </span>
                        )}

                        <i className={`bi bi-chevron-${isExpanded ? 'up' : 'down'} text-slate-400 text-xs ml-1`}></i>
                    </div>
                </div>

                {/* Detalle Expandido del Día */}
                {isExpanded && (
                    <div className="border-t border-slate-100 bg-slate-50/40 p-3.5 space-y-3 animate-in fade-in duration-150">
                        {/* Resumen del Día */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-white p-3 rounded-xl border border-slate-200/80 text-center text-xs">
                            <div>
                                <p className="text-[10px] font-medium text-slate-400 uppercase">Fuddi</p>
                                <p className="font-semibold text-slate-900 mt-0.5">${day.dayDigitalCollected.toFixed(2)}</p>
                            </div>
                            <div>
                                <p className="text-[10px] font-medium text-slate-400 uppercase">Tienda</p>
                                <p className="font-semibold text-slate-900 mt-0.5">${day.dayCashCollected.toFixed(2)}</p>
                            </div>
                            <div>
                                <p className="text-[10px] font-medium text-slate-400 uppercase">Comisión</p>
                                <p className="font-semibold text-slate-500 mt-0.5">-${day.dayCommission.toFixed(2)}</p>
                            </div>
                            <div>
                                <p className="text-[10px] font-medium text-slate-400 uppercase">Saldo Neto Día</p>
                                <p className={`font-bold mt-0.5 ${day.dayNetBalance >= 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
                                    ${day.dayNetBalance.toFixed(2)}
                                </p>
                            </div>
                        </div>

                        {/* Lista de Órdenes del Día */}
                        <div className="space-y-2">
                            {day.ordersList.map(order => {
                                const info = getSettlementOrderInfo(order)
                                const isSettled = order.settlementStatus === 'settled'

                                return (
                                    <div key={order.id} className="bg-white p-3 rounded-xl border border-slate-200/80 shadow-2xs space-y-2 text-xs">
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="min-w-0 flex items-center gap-2 flex-wrap">
                                                <span className="font-bold text-slate-900">{order.customer?.name || 'Cliente'}</span>
                                                <span className="text-slate-400 text-[10px]">({getOrderDisplayTime(order)} • {order.payment?.method === 'cash' ? 'Efectivo' : 'Transferencia'})</span>
                                            </div>

                                            <div className="flex items-center gap-1.5 shrink-0">
                                                <span className={`px-2 py-0.5 text-[10px] font-medium rounded-md ${
                                                    info.isStoreMoney ? 'bg-slate-100 text-slate-700' : 'bg-blue-50 text-blue-700'
                                                }`}>
                                                    {info.isStoreMoney ? '🏢 Tienda' : '🦅 Fuddi'}
                                                </span>

                                                <span className={`px-2 py-0.5 text-[10px] font-medium rounded-full ${
                                                    isSettled ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/60' : 'bg-amber-50 text-amber-700 border border-amber-200/60'
                                                }`}>
                                                    {isSettled ? 'Depositado' : 'Pendiente'}
                                                </span>
                                            </div>
                                        </div>

                                        <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-slate-600 text-xs">
                                            <div className="flex items-center gap-3">
                                                <span>Venta: <strong className="text-slate-900">${info.subtotal.toFixed(2)}</strong></span>
                                                <span className="text-slate-400">Comisión: <strong className="text-slate-500">-${info.commission.toFixed(2)}</strong></span>
                                            </div>

                                            <span className={`font-bold ${info.storeReceives >= 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
                                                Ganancia: ${info.storeReceives.toFixed(2)}
                                            </span>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                )}
            </div>
        )
    }

    const toggleDayExpand = (dateStr: string) => {
        setExpandedDays(prev => ({
            ...prev,
            [dateStr]: !prev[dateStr]
        }))
    }

    return (
        <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div>
                    <h1 className="text-2xl font-black text-slate-900 tracking-tight">Finanzas y Cierres</h1>
                </div>
            </div>



            {/* Tarjeta Resumen General de Liquidación (Minimalista) */}
            <div className="bg-slate-900 px-5 py-4 rounded-2xl shadow-lg text-white">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    {/* Sección Principal: Valor a recibir */}
                    <div className="space-y-1">
                        <div className="flex items-center gap-1 text-slate-400">
                            <span className="text-[10px] uppercase tracking-widest font-bold">Valor a Recibir</span>
                            <button
                                onClick={() => setShowInfoModal(true)}
                                className="hover:text-white transition-colors focus:outline-hidden"
                                title="Ver información sobre el Proceso de Liquidación"
                            >
                                <span className="material-symbols-rounded text-[11px] block">info</span>
                            </button>
                        </div>
                        <div className="text-3xl font-black text-emerald-400">
                            ${financials.netBalance.toFixed(2)}
                        </div>
                        <span className="text-[10px] text-slate-400 block">
                            Total neto acumulado pendiente de depósito
                        </span>
                    </div>

                    {/* Desglose Minimalista */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2 border-t md:border-t-0 md:border-l border-slate-800 pt-3 md:pt-0 md:pl-6">
                        <div>
                            <span className="text-[9px] uppercase tracking-wider text-slate-500 font-bold block">Total de Ventas</span>
                            <span className="text-sm font-extrabold text-white">${financials.totalSales.toFixed(2)}</span>
                        </div>
                        <div>
                            <span className="text-[9px] uppercase tracking-wider text-slate-500 font-bold block">Recaudado por Tienda</span>
                            <span className="text-sm font-extrabold text-white">${financials.collectedByStore.toFixed(2)}</span>
                        </div>
                        <div>
                            <span className="text-[9px] uppercase tracking-wider text-slate-500 font-bold block">Comisión</span>
                            <span className="text-sm font-extrabold text-rose-400">-${financials.totalCommission.toFixed(2)}</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Listado Agrupado por Día (Jornadas por Fecha de Programación) */}
            <div className="space-y-3">

                {loadingSettlements || loadingHistory ? (
                    <div className="bg-white p-12 rounded-2xl border border-slate-200/80 text-center text-slate-500 shadow-2xs">
                        <div className="animate-spin rounded-full h-7 w-7 border-b-2 border-slate-900 mx-auto mb-3"></div>
                        <p className="text-xs font-semibold">Cargando cierre de finanzas...</p>
                    </div>
                ) : groupedDays.length === 0 ? (
                    <div className="bg-white p-10 rounded-2xl border border-slate-200/80 text-center space-y-2 shadow-2xs">
                        <div className="w-10 h-10 bg-slate-100 text-slate-500 rounded-full flex items-center justify-center mx-auto">
                            <span className="material-symbols-rounded text-xl">event_busy</span>
                        </div>
                        <p className="text-xs font-bold text-slate-700">Sin órdenes registradas en este período</p>
                    </div>
                ) : (
                    <div className="space-y-6">
                        {/* Jornadas Pendientes */}
                        {pendingDays.length > 0 && (
                            <div className="space-y-3">
                                <div
                                    onClick={() => setPendingGroupsExpanded(prev => !prev)}
                                    className="flex items-center justify-between gap-1.5 px-1 pt-1 cursor-pointer select-none group"
                                >
                                    <h4 className="text-xs font-bold text-amber-600 uppercase tracking-wider flex items-center gap-1.5 group-hover:text-amber-700 transition-colors">
                                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse border border-amber-300"></span>
                                        Jornadas Pendientes de Depósito ({pendingDays.length})
                                    </h4>
                                    <i className={`bi bi-chevron-${pendingGroupsExpanded ? 'up' : 'down'} text-amber-500 text-xs`}></i>
                                </div>
                                {pendingGroupsExpanded && (
                                    <div className="space-y-3">
                                        {pendingDays.map(renderDayRow)}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Jornadas Liquidadas */}
                        {settledDays.length > 0 && (
                            <div className="space-y-3">
                                <div
                                    onClick={() => setSettledGroupsExpanded(prev => !prev)}
                                    className="flex items-center justify-between gap-1.5 px-1 pt-1 cursor-pointer select-none group"
                                >
                                    <h4 className="text-xs font-bold text-emerald-600 uppercase tracking-wider flex items-center gap-1.5 group-hover:text-emerald-700 transition-colors">
                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                                        Jornadas Liquidadas ({settledDays.length})
                                    </h4>
                                    <i className={`bi bi-chevron-${settledGroupsExpanded ? 'up' : 'down'} text-emerald-500 text-xs`}></i>
                                </div>
                                {settledGroupsExpanded && (
                                    <div className="space-y-3">
                                        {settledDays.map(renderDayRow)}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Modal Informativo del Proceso de Liquidación */}
            {showInfoModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
                    <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200/80 relative space-y-4 animate-in zoom-in-95 duration-200">
                        {/* Botón Cerrar */}
                        <button
                            onClick={() => setShowInfoModal(false)}
                            className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 transition-colors focus:outline-hidden"
                        >
                            <span className="material-symbols-rounded text-xl">close</span>
                        </button>

                        <div className="flex items-start gap-3">
                            <div className="p-2.5 bg-amber-50 rounded-xl text-amber-600 shrink-0">
                                <span className="material-symbols-rounded text-xl block">schedule</span>
                            </div>
                            <div className="space-y-2">
                                <h3 className="text-sm font-black text-slate-900 leading-tight">Proceso de Liquidación por Jornada</h3>
                                <p className="text-xs text-slate-600 leading-relaxed">
                                    Las órdenes se agrupan automáticamente por su <strong>fecha de programación</strong>. Si una jornada del pasado no ha sido marcada como liquidada por la administración, sus órdenes se mantendrán en estado <strong>Pendiente de depósito</strong> agrupadas en esa misma fecha.
                                </p>
                            </div>
                        </div>

                        <div className="pt-2 flex justify-end">
                            <button
                                onClick={() => setShowInfoModal(false)}
                                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-all"
                            >
                                Entendido
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
