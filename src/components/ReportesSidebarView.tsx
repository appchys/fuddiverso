'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { Business, Order } from '@/types'
import { db } from '@/lib/firebase'
import { collection, query, where, onSnapshot, Timestamp } from 'firebase/firestore'

interface ReportesSidebarViewProps {
    onBack: () => void
    onClose: () => void
    selectedBusinessId: string | null
    businesses: Business[]
}

// Helper to convert Firestore timestamp to Date
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

// Helper to format Date to local string YYYY-MM-DD
const getLocalDateString = (date: Date): string => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

export default function ReportesSidebarView({
    onBack,
    onClose,
    selectedBusinessId,
    businesses
}: ReportesSidebarViewProps) {
    const [daysToShow, setDaysToShow] = useState<number>(15)
    const [orders, setOrders] = useState<Order[]>([])
    const [loading, setLoading] = useState<boolean>(true)
    const [expandedDays, setExpandedDays] = useState<Record<string, boolean>>({})

    const currentBusinessName = useMemo(() => {
        if (!selectedBusinessId || selectedBusinessId === 'all') return 'Todos los negocios'
        return businesses.find(b => b.id === selectedBusinessId)?.name || 'Negocio'
    }, [selectedBusinessId, businesses])

    // Carga de órdenes desde Firestore en tiempo real según el rango de días y negocio
    useEffect(() => {
        setLoading(true)
        const now = new Date()
        const startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysToShow, 0, 0, 0)

        const q = (!selectedBusinessId || selectedBusinessId === 'all')
            ? query(
                collection(db, 'orders'),
                where('createdAt', '>=', Timestamp.fromDate(startDate))
              )
            : query(
                collection(db, 'orders'),
                where('businessId', '==', selectedBusinessId),
                where('createdAt', '>=', Timestamp.fromDate(startDate))
              )

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const data = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            })) as Order[]
            setOrders(data)
            setLoading(false)
        }, (error) => {
            console.error("Error loading orders for reports:", error)
            setLoading(false)
        })

        return () => unsubscribe()
    }, [selectedBusinessId, daysToShow])

    const toggleDayExpand = (dateStr: string) => {
        setExpandedDays(prev => ({
            ...prev,
            [dateStr]: !prev[dateStr]
        }))
    }

    // Procesamiento diario de estadísticas
    const dailyStats = useMemo(() => {
        const groups: Record<string, {
            dateStr: string
            displayDate: string
            sales: number
            delivery: number
            commission: number
            liquidado: number
            pendiente: number
            ordersCount: number
            businessBreakdown: Record<string, {
                name: string
                sales: number
                commission: number
                liquidado: number
                pendiente: number
            }>
        }> = {}

        orders.forEach(o => {
            if (o.status === 'cancelled' || o.status === 'borrador') return

            const refDate = toSafeDate(o.createdAt)
            const dateStr = getLocalDateString(refDate)

            if (!groups[dateStr]) {
                const [y, m, d] = dateStr.split('-').map(Number)
                const date = new Date(y, m - 1, d, 12, 0, 0)
                const isToday = dateStr === getLocalDateString(new Date())

                let displayDate = ''
                if (isToday) {
                    displayDate = `Hoy (${date.toLocaleDateString('es-EC', { day: 'numeric', month: 'short' })})`
                } else {
                    const formatted = date.toLocaleDateString('es-EC', {
                        weekday: 'long',
                        day: 'numeric',
                        month: 'long'
                    })
                    displayDate = formatted.charAt(0).toUpperCase() + formatted.slice(1)
                }

                groups[dateStr] = {
                    dateStr,
                    displayDate,
                    sales: 0,
                    delivery: 0,
                    commission: 0,
                    liquidado: 0,
                    pendiente: 0,
                    ordersCount: 0,
                    businessBreakdown: {}
                }
            }

            const g = groups[dateStr]
            g.ordersCount += 1

            const orderTotal = o.total || 0
            const deliveryFee = o.delivery?.type === 'delivery' ? (o.delivery?.deliveryCost || 0) : 0
            const productSubtotal = o.subtotal || Math.max(0, orderTotal - deliveryFee)

            let commission = 0
            if (o.items && o.items.length > 0) {
                o.items.forEach((item: any) => {
                    commission += (item.commission || 0) * (item.quantity || 1)
                })
            }

            const isSettled = o.settlementStatus === 'settled'

            g.sales += productSubtotal
            g.delivery += deliveryFee
            g.commission += commission

            if (isSettled) {
                g.liquidado += productSubtotal
            } else {
                g.pendiente += productSubtotal
            }

            if (o.businessId) {
                if (!g.businessBreakdown[o.businessId]) {
                    const bizName = businesses.find(b => b.id === o.businessId)?.name || (o as any).businessName || `Restaurante ${o.businessId.substring(0, 6)}...`
                    g.businessBreakdown[o.businessId] = {
                        name: bizName,
                        sales: 0,
                        commission: 0,
                        liquidado: 0,
                        pendiente: 0
                    }
                }
                const bStats = g.businessBreakdown[o.businessId]
                bStats.sales += productSubtotal
                bStats.commission += commission
                if (isSettled) {
                    bStats.liquidado += productSubtotal
                } else {
                    bStats.pendiente += productSubtotal
                }
            }
        })

        return Object.values(groups).sort((a, b) => b.dateStr.localeCompare(a.dateStr))
    }, [orders, businesses])

    // Totales agregados globales
    const totals = useMemo(() => {
        let totalSales = 0
        let totalDelivery = 0
        let totalCommission = 0
        let totalLiquidado = 0
        let totalPendiente = 0
        let totalOrders = 0

        dailyStats.forEach(d => {
            totalSales += d.sales
            totalDelivery += d.delivery
            totalCommission += d.commission
            totalLiquidado += d.liquidado
            totalPendiente += d.pendiente
            totalOrders += d.ordersCount
        })

        return {
            sales: totalSales,
            delivery: totalDelivery,
            commission: totalCommission,
            liquidado: totalLiquidado,
            pendiente: totalPendiente,
            orders: totalOrders
        }
    }, [dailyStats])

    const topCommissionBusiness = useMemo<{ name: string; commission: number } | null>(() => {
        const commissionByBiz: Record<string, { name: string; commission: number }> = {}

        orders.forEach(o => {
            if (o.status === 'cancelled' || o.status === 'borrador') return
            if (!o.businessId) return

            let commission = 0
            if (o.items && o.items.length > 0) {
                o.items.forEach((item: any) => {
                    commission += (item.commission || 0) * (item.quantity || 1)
                })
            }

            if (!commissionByBiz[o.businessId]) {
                const bizName = businesses.find(b => b.id === o.businessId)?.name || (o as any).businessName || `Restaurante ${o.businessId.substring(0, 6)}...`
                commissionByBiz[o.businessId] = {
                    name: bizName,
                    commission: 0
                }
            }
            commissionByBiz[o.businessId].commission += commission
        })

        let topBiz: { name: string; commission: number } | null = null
        Object.values(commissionByBiz).forEach(b => {
            if (b.commission > 0 && (!topBiz || b.commission > topBiz.commission)) {
                topBiz = b
            }
        })

        return topBiz
    }, [orders, businesses])

    return (
        <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-50">
            {/* Header */}
            <div className="px-4 py-3 bg-white border-b border-slate-100 flex items-center justify-between gap-2 shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                    <button
                        onClick={onBack}
                        className="p-1 text-slate-500 hover:text-slate-800 rounded-lg hover:bg-slate-100 transition-colors flex items-center shrink-0"
                        title="Volver"
                    >
                        <i className="bi bi-chevron-left text-lg"></i>
                    </button>
                    <div className="min-w-0">
                        <h2 className="text-base font-bold text-slate-900 leading-tight truncate">Reportes Financieros</h2>
                        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider truncate">{currentBusinessName}</p>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <select
                        value={daysToShow}
                        onChange={(e) => setDaysToShow(Number(e.target.value))}
                        className="text-xs bg-slate-100 text-slate-700 font-bold rounded-lg px-2.5 py-1.5 border border-slate-200 focus:outline-hidden cursor-pointer"
                    >
                        <option value={7}>Últimos 7 días</option>
                        <option value={15}>Últimos 15 días</option>
                        <option value={30}>Últimos 30 días</option>
                        <option value={90}>Últimos 90 días</option>
                    </select>
                    <button
                        onClick={onClose}
                        className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
                        title="Cerrar barra lateral"
                    >
                        <i className="bi bi-x-lg text-sm"></i>
                    </button>
                </div>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {loading ? (
                    <div className="flex flex-col justify-center items-center py-16 space-y-3">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-600"></div>
                        <p className="text-xs text-slate-500 font-medium">Cargando estadísticas de caja...</p>
                    </div>
                ) : (
                    <>
                        {/* Global Metrics Summary cards */}
                        <div className="grid grid-cols-2 gap-3">
                            <div className="bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-2xs space-y-1">
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Ventas totales</span>
                                <h3 className="text-lg font-black text-slate-900 leading-tight">${totals.sales.toFixed(2)}</h3>
                                <p className="text-[9px] text-slate-400 font-semibold">{totals.orders} pedidos activos</p>
                            </div>

                            <div className="bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-2xs space-y-1">
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Envío Delivery</span>
                                <h3 className="text-lg font-black text-slate-900 leading-tight">${totals.delivery.toFixed(2)}</h3>
                                <p className="text-[9px] text-slate-400 font-semibold">Costo total transportes</p>
                            </div>

                            <div className="bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-2xs space-y-1 col-span-2 flex justify-between items-center gap-4">
                                <div className="space-y-1 min-w-0">
                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Comisiones Fuddi</span>
                                    <h3 className="text-lg font-black text-slate-600 leading-tight">${totals.commission.toFixed(2)}</h3>
                                    <p className="text-[9px] text-slate-400 font-semibold">Total generado por servicio</p>
                                </div>
                                {topCommissionBusiness && (
                                    <div className="text-right bg-slate-50 border border-slate-100 p-2 rounded-xl shrink-0 min-w-0 max-w-[50%] animate-in fade-in duration-200">
                                        <span className="text-[8px] font-extrabold text-red-500 uppercase tracking-wider block">Mayor Generador</span>
                                        <p className="font-bold text-[11px] text-slate-700 truncate mt-0.5" title={topCommissionBusiness.name}>
                                            {topCommissionBusiness.name}
                                        </p>
                                        <span className="text-[10px] font-black text-slate-500 block">${topCommissionBusiness.commission.toFixed(2)}</span>
                                    </div>
                                )}
                            </div>

                            <div className="bg-emerald-50/50 border border-emerald-100 p-3.5 rounded-2xl shadow-2xs space-y-1">
                                <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">Liquidado</span>
                                <h3 className="text-lg font-black text-emerald-700 leading-tight">${totals.liquidado.toFixed(2)}</h3>
                            </div>

                            <div className="bg-amber-50/50 border border-amber-100 p-3.5 rounded-2xl shadow-2xs space-y-1">
                                <span className="text-[10px] font-bold text-amber-600 uppercase tracking-wider">Pendiente</span>
                                <h3 className="text-lg font-black text-amber-700 leading-tight">${totals.pendiente.toFixed(2)}</h3>
                            </div>
                        </div>

                        {/* Desglose Diario list */}
                        <div className="space-y-3">
                            <h3 className="text-xs font-black text-slate-400 uppercase tracking-wider pl-1">Desglose Diario</h3>

                            {dailyStats.length === 0 ? (
                                <div className="bg-white p-6 rounded-2xl border border-slate-200/80 text-center space-y-2 shadow-2xs">
                                    <div className="w-9 h-9 bg-slate-100 text-slate-600 rounded-full flex items-center justify-center mx-auto">
                                        <i className="bi bi-calendar-x text-lg"></i>
                                    </div>
                                    <p className="text-xs text-slate-900 font-bold">Sin transacciones</p>
                                    <p className="text-xs text-slate-500 font-medium">No se registraron ventas en el periodo seleccionado.</p>
                                </div>
                            ) : (
                                dailyStats.map(day => {
                                    const isExpanded = Boolean(expandedDays[day.dateStr])
                                    const totalForProgress = day.liquidado + day.pendiente
                                    const percentageSettled = totalForProgress > 0 ? (day.liquidado / totalForProgress) * 100 : 0

                                    return (
                                        <div key={day.dateStr} className="bg-white rounded-2xl border border-slate-200/80 shadow-2xs overflow-hidden transition-all duration-150">
                                            {/* Cabecera del día */}
                                            <div
                                                onClick={() => toggleDayExpand(day.dateStr)}
                                                className="p-3.5 hover:bg-slate-50/50 cursor-pointer flex items-center justify-between gap-3 select-none"
                                            >
                                                <div className="min-w-0">
                                                    <h4 className="font-bold text-sm text-slate-900 leading-tight">{day.displayDate}</h4>
                                                    <span className="text-[10px] text-slate-400 font-semibold">{day.ordersCount} {day.ordersCount === 1 ? 'pedido' : 'pedidos'}</span>
                                                </div>

                                                <div className="flex items-center gap-1.5 shrink-0">
                                                    <span className="text-xs font-black text-slate-800">${(day.sales).toFixed(2)}</span>
                                                    <i className={`bi bi-chevron-${isExpanded ? 'up' : 'down'} text-slate-400 text-xs`}></i>
                                                </div>
                                            </div>

                                            {/* Métricas e Info del día */}
                                            <div className="px-3.5 pb-3.5 space-y-3">
                                                {/* Mini grid de 3 columnas */}
                                                <div className="grid grid-cols-3 gap-1 bg-slate-50 p-2 rounded-xl text-center text-[10px] border border-slate-100">
                                                    <div>
                                                        <span className="text-slate-400 font-semibold">Ventas</span>
                                                        <p className="font-black text-slate-800 mt-0.5">${day.sales.toFixed(2)}</p>
                                                    </div>
                                                    <div>
                                                        <span className="text-slate-400 font-semibold">Envío</span>
                                                        <p className="font-black text-slate-800 mt-0.5">${day.delivery.toFixed(2)}</p>
                                                    </div>
                                                    <div>
                                                        <span className="text-slate-400 font-semibold">Comisión</span>
                                                        <p className="font-black text-slate-500 mt-0.5">-${day.commission.toFixed(2)}</p>
                                                    </div>
                                                </div>

                                                {/* Barra de progreso de liquidación */}
                                                <div className="space-y-1">
                                                    <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden flex">
                                                        <div className="bg-emerald-500 h-full transition-all duration-300" style={{ width: `${percentageSettled}%` }}></div>
                                                        <div className="bg-amber-500 h-full transition-all duration-300" style={{ width: `${100 - percentageSettled}%` }}></div>
                                                    </div>
                                                    <div className="flex justify-between items-center text-[9px] font-bold text-slate-500 px-0.5">
                                                        <span className="text-emerald-600">Liq: ${day.liquidado.toFixed(2)} ({percentageSettled.toFixed(0)}%)</span>
                                                        <span className="text-amber-700">Pend: ${day.pendiente.toFixed(2)}</span>
                                                    </div>
                                                </div>

                                                {/* Desglose por restaurante si está expandido */}
                                                {isExpanded && Object.keys(day.businessBreakdown).length > 0 && (
                                                    <div className="border-t border-slate-100 pt-3 space-y-2 animate-in fade-in duration-150">
                                                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider pl-0.5">Por Restaurante</span>
                                                        <div className="space-y-1.5">
                                                            {Object.entries(day.businessBreakdown).map(([bizId, bStats]) => (
                                                                <div key={bizId} className="flex items-center justify-between gap-3 text-xs bg-slate-50/50 p-2 rounded-lg border border-slate-100">
                                                                    <div className="min-w-0">
                                                                        <p className="font-bold text-slate-700 truncate">{bStats.name}</p>
                                                                        <span className="text-[9px] text-slate-400 font-semibold">Comisión: -${bStats.commission.toFixed(2)}</span>
                                                                    </div>
                                                                    <div className="text-right shrink-0">
                                                                        <p className="font-black text-slate-800">${bStats.sales.toFixed(2)}</p>
                                                                        <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded-md ${
                                                                            bStats.pendiente === 0
                                                                                ? 'bg-emerald-50 text-emerald-700'
                                                                                : 'bg-amber-50 text-amber-700'
                                                                        }`}>
                                                                            {bStats.pendiente === 0 ? 'Liquidado' : 'Pendiente'}
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )
                                })
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    )
}
