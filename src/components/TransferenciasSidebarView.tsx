'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { Business, Order } from '@/types'
import { db } from '@/lib/firebase'
import { collection, query, where, onSnapshot, doc, updateDoc, Timestamp } from 'firebase/firestore'

interface TransferenciasSidebarViewProps {
    onBack: () => void
    onClose: () => void
    selectedBusinessId: string | null
    businesses: Business[]
    onManagePayment?: (order: Order) => void
}

// Helper para convertir timestamp de Firestore o Date a Date de JS
const toSafeDate = (val: any): Date => {
    if (!val) return new Date()
    if (val instanceof Timestamp) return val.toDate()
    if (typeof val.toDate === 'function') return val.toDate()
    if (typeof val.seconds === 'number') return new Date(val.seconds * 1000)
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

// Formatear Date a YYYY-MM-DD local
const getLocalDateString = (date: Date): string => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

// Obtener fecha relevante de la orden
const getOrderReferenceDate = (order: Order): Date => {
    return order.timing?.scheduledDate
        ? toSafeDate(order.timing.scheduledDate)
        : toSafeDate(order.createdAt)
}

// Formatear fecha para el encabezado del grupo
const formatGroupDateHeader = (dateStr: string): string => {
    const now = new Date()
    const todayStr = getLocalDateString(now)
    
    const yesterday = new Date(now)
    yesterday.setDate(now.getDate() - 1)
    const yesterdayStr = getLocalDateString(yesterday)

    const [y, m, d] = dateStr.split('-').map(Number)
    const dateObj = new Date(y, m - 1, d)

    const dayName = dateObj.toLocaleDateString('es-EC', { weekday: 'short' })
    const monthName = dateObj.toLocaleDateString('es-EC', { month: 'short' })
    const formattedDate = `${dayName.charAt(0).toUpperCase() + dayName.slice(1)} ${d} ${monthName.charAt(0).toUpperCase() + monthName.slice(1)}`

    if (dateStr === todayStr) {
        return `Hoy - ${formattedDate}`
    } else if (dateStr === yesterdayStr) {
        return `Ayer - ${formattedDate}`
    }
    return formattedDate
}

// Obtener monto por transferencia de la orden
const getTransferAmount = (order: Order): number => {
    if (order.payment?.method === 'mixed') {
        return order.payment.transferAmount || 0
    }
    return order.total || 0
}

export default function TransferenciasSidebarView({
    onBack,
    onClose,
    selectedBusinessId,
    businesses,
    onManagePayment
}: TransferenciasSidebarViewProps) {
    const [daysToShow, setDaysToShow] = useState<number>(30)
    const [orders, setOrders] = useState<Order[]>([])
    const [loading, setLoading] = useState<boolean>(true)
    const [statusFilter, setStatusFilter] = useState<'pending' | 'paid' | 'all'>('pending')
    const [selectedBusinessFilter, setSelectedBusinessFilter] = useState<string>(selectedBusinessId || 'all')
    const [receiptModalOrder, setReceiptModalOrder] = useState<Order | null>(null)
    const [validatingOrderId, setValidatingOrderId] = useState<string | null>(null)
    const [validatingGroupDate, setValidatingGroupDate] = useState<string | null>(null)
    
    // Estado para acordeón colapsado por día (por defecto todos colapsados)
    const [expandedDays, setExpandedDays] = useState<Record<string, boolean>>({})

    const toggleDayExpand = (dateStr: string) => {
        setExpandedDays(prev => ({
            ...prev,
            [dateStr]: !prev[dateStr]
        }))
    }

    // Resetear el acordeón para que todos los días inicien colapsados al cambiar filtro o pestaña
    useEffect(() => {
        setExpandedDays({})
    }, [statusFilter, selectedBusinessFilter, daysToShow])

    // Sincronizar filtro de negocio si cambia por props
    useEffect(() => {
        if (selectedBusinessId) {
            setSelectedBusinessFilter(selectedBusinessId)
        }
    }, [selectedBusinessId])

    // Cargar órdenes en tiempo real desde Firestore
    useEffect(() => {
        setLoading(true)
        const now = new Date()
        const startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysToShow, 0, 0, 0)

        const q = (selectedBusinessFilter === 'all')
            ? query(
                collection(db, 'orders'),
                where('createdAt', '>=', Timestamp.fromDate(startDate))
              )
            : query(
                collection(db, 'orders'),
                where('businessId', '==', selectedBusinessFilter),
                where('createdAt', '>=', Timestamp.fromDate(startDate))
              )

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const data = snapshot.docs.map(docSnap => ({
                id: docSnap.id,
                ...docSnap.data()
            })) as Order[]
            setOrders(data)
            setLoading(false)
        }, (error) => {
            console.error("Error al cargar órdenes de transferencia:", error)
            setLoading(false)
        })

        return () => unsubscribe()
    }, [selectedBusinessFilter, daysToShow])

    // Filtrar solo las órdenes que contienen transferencia
    const transferOrders = useMemo(() => {
        return orders.filter(o => {
            if (o.status === 'cancelled' || o.status === 'borrador') return false
            
            const isTransferMethod = o.payment?.method === 'transfer' || 
                (o.payment?.method === 'mixed' && (o.payment.transferAmount || 0) > 0)
            
            if (!isTransferMethod) return false

            const isPaid = o.payment?.paymentStatus === 'paid'
            if (statusFilter === 'pending' && isPaid) return false
            if (statusFilter === 'paid' && !isPaid) return false

            return true
        })
    }, [orders, statusFilter])

    // Agrupar transferencias por fecha (de más reciente a más antigua)
    const groupedByDate = useMemo(() => {
        const groupsMap: Record<string, {
            dateStr: string;
            displayDate: string;
            orders: Order[];
            totalAmount: number;
            pendingCount: number;
            validatedCount: number;
            totalOrdersCount: number;
        }> = {}

        transferOrders.forEach(order => {
            const refDate = getOrderReferenceDate(order)
            const dateStr = getLocalDateString(refDate)

            if (!groupsMap[dateStr]) {
                groupsMap[dateStr] = {
                    dateStr,
                    displayDate: formatGroupDateHeader(dateStr),
                    orders: [],
                    totalAmount: 0,
                    pendingCount: 0,
                    validatedCount: 0,
                    totalOrdersCount: 0
                }
            }

            const amount = getTransferAmount(order)
            groupsMap[dateStr].orders.push(order)
            groupsMap[dateStr].totalAmount += amount
            groupsMap[dateStr].totalOrdersCount += 1
            if (order.payment?.paymentStatus === 'paid') {
                groupsMap[dateStr].validatedCount += 1
            } else {
                groupsMap[dateStr].pendingCount += 1
            }
        })

        // Ordenar grupos por fecha descendente
        const sortedDates = Object.keys(groupsMap).sort((a, b) => b.localeCompare(a))

        return sortedDates.map(dateStr => {
            // Ordenar las órdenes dentro del grupo por hora (más reciente primero)
            groupsMap[dateStr].orders.sort((a, b) => {
                const dateA = getOrderReferenceDate(a).getTime()
                const dateB = getOrderReferenceDate(b).getTime()
                return dateB - dateA
            })
            return groupsMap[dateStr]
        })
    }, [transferOrders])

    // Resumen general de totales
    const summaryStats = useMemo(() => {
        let totalCount = 0
        let pendingCount = 0
        let totalAmount = 0
        let pendingAmount = 0

        orders.forEach(o => {
            if (o.status === 'cancelled' || o.status === 'borrador') return
            const isTransferMethod = o.payment?.method === 'transfer' || 
                (o.payment?.method === 'mixed' && (o.payment.transferAmount || 0) > 0)
            if (!isTransferMethod) return

            const amount = getTransferAmount(o)
            totalCount++
            totalAmount += amount

            if (o.payment?.paymentStatus !== 'paid') {
                pendingCount++
                pendingAmount += amount
            }
        })

        return { totalCount, pendingCount, totalAmount, pendingAmount }
    }, [orders])

    // Validar pago individual
    const handleValidatePayment = async (order: Order) => {
        if (!order.id) return
        setValidatingOrderId(order.id)
        try {
            const orderRef = doc(db, 'orders', order.id)
            const updatedPayment = {
                ...order.payment,
                paymentStatus: 'paid' as const
            }
            await updateDoc(orderRef, { payment: updatedPayment })
        } catch (error) {
            console.error("Error al validar el pago de transferencia:", error)
            alert("No se pudo validar el pago de la transferencia.")
        } finally {
            setValidatingOrderId(null)
        }
    }

    // Cambiar estado a pendiente
    const handleUnvalidatePayment = async (order: Order) => {
        if (!order.id) return
        setValidatingOrderId(order.id)
        try {
            const orderRef = doc(db, 'orders', order.id)
            const updatedPayment = {
                ...order.payment,
                paymentStatus: 'pending' as const
            }
            await updateDoc(orderRef, { payment: updatedPayment })
        } catch (error) {
            console.error("Error al desmarcar pago:", error)
            alert("No se pudo cambiar el estado de la transferencia.")
        } finally {
            setValidatingOrderId(null)
        }
    }

    // Validar todas las del día
    const handleValidateAllForDate = async (groupOrders: Order[], dateStr: string, e: React.MouseEvent) => {
        e.stopPropagation()
        const pendingInGroup = groupOrders.filter(o => o.payment?.paymentStatus !== 'paid')
        if (pendingInGroup.length === 0) return

        if (!window.confirm(`¿Deseas marcar como validadas las ${pendingInGroup.length} transferencias pendientes del día?`)) {
            return
        }

        setValidatingGroupDate(dateStr)
        try {
            await Promise.all(
                pendingInGroup.map(order => {
                    const orderRef = doc(db, 'orders', order.id)
                    const updatedPayment = {
                        ...order.payment,
                        paymentStatus: 'paid' as const
                    }
                    return updateDoc(orderRef, { payment: updatedPayment })
                })
            )
        } catch (error) {
            console.error("Error al validar transferencias masivas:", error)
            alert("Ocurrió un error al validar algunas transferencias.")
        } finally {
            setValidatingGroupDate(null)
        }
    }

    const currentBusinessName = useMemo(() => {
        if (!selectedBusinessFilter || selectedBusinessFilter === 'all') return 'Todos los negocios'
        return businesses.find(b => b.id === selectedBusinessFilter)?.name || 'Negocio'
    }, [selectedBusinessFilter, businesses])

    return (
        <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-50">
            {/* Encabezado */}
            <div className="px-4 py-3 bg-white border-b border-slate-100 flex items-center justify-between gap-2 shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                    <button
                        onClick={onBack}
                        className="p-1 text-slate-500 hover:text-slate-800 rounded-lg hover:bg-slate-100 transition-colors flex items-center shrink-0"
                        title="Volver al menú"
                    >
                        <i className="bi bi-chevron-left text-lg"></i>
                    </button>
                    <div className="min-w-0">
                        <h2 className="text-base font-black text-gray-900 tracking-tight leading-tight truncate">
                            Revisión de Transferencias
                        </h2>
                        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider truncate">
                            {currentBusinessName}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                    <select
                        value={daysToShow}
                        onChange={(e) => setDaysToShow(Number(e.target.value))}
                        className="text-xs bg-slate-100 text-slate-700 font-bold rounded-lg px-2 py-1.5 border border-slate-200 focus:outline-hidden cursor-pointer"
                    >
                        <option value={7}>7 días</option>
                        <option value={15}>15 días</option>
                        <option value={30}>30 días</option>
                        <option value={90}>90 días</option>
                    </select>
                    <button
                        onClick={onClose}
                        className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
                        title="Cerrar lateral"
                    >
                        <i className="bi bi-x-lg text-sm"></i>
                    </button>
                </div>
            </div>

            {/* Filtros e Indicadores estilo Cierre de Caja */}
            <div className="px-4 py-3 bg-white border-b border-slate-100 space-y-3 shrink-0">
                {/* Selector de Negocio si hay múltiples */}
                {businesses.length > 1 && (
                    <div>
                        <select
                            value={selectedBusinessFilter}
                            onChange={(e) => setSelectedBusinessFilter(e.target.value)}
                            className="w-full text-xs bg-slate-50 text-slate-800 font-bold rounded-xl px-3 py-2 border border-slate-200 focus:outline-hidden"
                        >
                            <option value="all">🏢 Todos los negocios</option>
                            {businesses.map(b => (
                                <option key={b.id} value={b.id}>{b.name}</option>
                            ))}
                        </select>
                    </div>
                )}

                {/* Tarjetas de Resumen */}
                <div className="grid grid-cols-2 gap-2">
                    <div className="bg-amber-50/70 border border-amber-200/60 rounded-xl p-2.5 flex items-center justify-between shadow-2xs">
                        <div>
                            <p className="text-[10px] font-black text-amber-600 uppercase tracking-wider">Por Validar</p>
                            <p className="text-base font-black text-amber-900 tracking-tight leading-tight">
                                {summaryStats.pendingCount} <span className="text-xs font-semibold text-amber-700">(${summaryStats.pendingAmount.toFixed(2)})</span>
                            </p>
                        </div>
                        <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-600 flex items-center justify-center">
                            <i className="bi bi-hourglass-split text-base"></i>
                        </div>
                    </div>
                    <div className="bg-slate-100/70 border border-slate-200/60 rounded-xl p-2.5 flex items-center justify-between shadow-2xs">
                        <div>
                            <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Monto Total</p>
                            <p className="text-base font-black text-slate-900 tracking-tight leading-tight">
                                ${summaryStats.totalAmount.toFixed(2)}
                            </p>
                        </div>
                        <div className="w-8 h-8 rounded-lg bg-slate-200 text-slate-600 flex items-center justify-center">
                            <i className="bi bi-bank text-base"></i>
                        </div>
                    </div>
                </div>

                {/* Pestañas de Estado (Estilo de subpestañas Cierre de Caja) */}
                <div className="flex bg-slate-200/60 p-1 rounded-xl shadow-2xs border border-slate-200/40 text-xs">
                    <button
                        type="button"
                        onClick={() => setStatusFilter('pending')}
                        className={`flex-1 py-1.5 px-2 text-xs font-bold uppercase tracking-wider rounded-lg transition-all duration-150 flex items-center justify-center gap-1.5 cursor-pointer ${
                            statusFilter === 'pending'
                                ? 'bg-white text-slate-900 shadow-2xs font-black'
                                : 'text-slate-500 hover:text-slate-800'
                        }`}
                    >
                        <span>Por Validar</span>
                        {summaryStats.pendingCount > 0 && (
                            <span className="px-1.5 py-0.2 text-[9px] font-black rounded-full bg-amber-500 text-white shadow-2xs">
                                {summaryStats.pendingCount}
                            </span>
                        )}
                    </button>
                    <button
                        type="button"
                        onClick={() => setStatusFilter('paid')}
                        className={`flex-1 py-1.5 px-2 text-xs font-bold uppercase tracking-wider rounded-lg transition-all duration-150 flex items-center justify-center gap-1.5 cursor-pointer ${
                            statusFilter === 'paid'
                                ? 'bg-white text-slate-900 shadow-2xs font-black'
                                : 'text-slate-500 hover:text-slate-800'
                        }`}
                    >
                        <span>Validadas</span>
                        <span className="px-1.5 py-0.2 text-[9px] font-semibold rounded-full bg-emerald-100 text-emerald-800">
                            {summaryStats.totalCount - summaryStats.pendingCount}
                        </span>
                    </button>
                    <button
                        type="button"
                        onClick={() => setStatusFilter('all')}
                        className={`flex-1 py-1.5 px-2 text-xs font-bold uppercase tracking-wider rounded-lg transition-all duration-150 flex items-center justify-center gap-1.5 cursor-pointer ${
                            statusFilter === 'all'
                                ? 'bg-white text-slate-900 shadow-2xs font-black'
                                : 'text-slate-500 hover:text-slate-800'
                        }`}
                    >
                        <span>Todas</span>
                        <span className="px-1.5 py-0.2 text-[9px] font-semibold rounded-full bg-slate-200 text-slate-700">
                            {summaryStats.totalCount}
                        </span>
                    </button>
                </div>
            </div>

            {/* Lista Agrupada por Fechas (Colapsada por defecto con estilo Cierre de Caja por Repartidor) */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {loading ? (
                    <div className="flex flex-col justify-center items-center py-16 space-y-3">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-600"></div>
                        <p className="text-xs text-slate-500 font-medium">Cargando transferencias...</p>
                    </div>
                ) : groupedByDate.length === 0 ? (
                    <div className="bg-white p-6 rounded-2xl border border-slate-200/80 text-center space-y-2 shadow-2xs">
                        <div className="w-9 h-9 bg-slate-100 text-slate-600 rounded-full flex items-center justify-center mx-auto">
                            <i className={`bi ${statusFilter === 'pending' ? 'bi-check-circle-fill text-emerald-600' : 'bi-bank'} text-lg`}></i>
                        </div>
                        <p className="text-xs text-slate-900 font-bold">
                            {statusFilter === 'pending' ? '¡Todo al día!' : 'Sin registros'}
                        </p>
                        <p className="text-xs text-slate-500 font-medium leading-relaxed">
                            {statusFilter === 'pending'
                                ? 'No hay transferencias pendientes por validar'
                                : 'No hay registros de transferencias que coincidan con la búsqueda'}
                        </p>
                    </div>
                ) : (
                    groupedByDate.map(group => {
                        const isDayExpanded = Boolean(expandedDays[group.dateStr])
                        const isDayFullyValid = group.pendingCount === 0

                        return (
                            <div key={group.dateStr} className="bg-white rounded-2xl border border-slate-200/80 shadow-2xs overflow-hidden transition-all">
                                {/* Cabecera del Día (Estilo Cierre de Caja Por Repartidor) */}
                                <div
                                    onClick={() => toggleDayExpand(group.dateStr)}
                                    className="p-4 hover:bg-slate-50/60 transition-colors cursor-pointer flex flex-wrap items-center justify-between gap-3 select-none"
                                >
                                    <div className="min-w-0 flex-1 space-y-1">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <h4 className="font-bold text-sm text-slate-900 leading-tight">
                                                {group.displayDate}
                                            </h4>
                                            <span className="text-[10px] font-semibold text-slate-400">
                                                ({group.totalOrdersCount} {group.totalOrdersCount === 1 ? 'transferencia' : 'transferencias'})
                                            </span>
                                        </div>
                                        <p className="text-xs text-slate-500 font-medium">
                                            Monto Total: <strong className="text-slate-900">${group.totalAmount.toFixed(2)}</strong>
                                        </p>
                                    </div>

                                    <div className="flex items-center gap-2.5 shrink-0">
                                        {/* Estado del día */}
                                        {isDayFullyValid ? (
                                            <span className="px-2.5 py-1 text-[10px] font-bold rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/60 flex items-center gap-1.5 shadow-2xs">
                                                <div className="w-3.5 h-3.5 rounded-full bg-emerald-600 text-white flex items-center justify-center text-[8px] font-black">
                                                    ✓
                                                </div>
                                                <span>{group.validatedCount}/{group.totalOrdersCount} Validadas</span>
                                            </span>
                                        ) : (
                                            <span className="px-2.5 py-1 text-[10px] font-bold rounded-full bg-amber-50 text-amber-900 border border-amber-200/80 flex items-center gap-1.5 shadow-2xs">
                                                <div className="relative w-3.5 h-3.5 flex items-center justify-center shrink-0">
                                                    <svg className="w-3.5 h-3.5 transform -rotate-90" viewBox="0 0 36 36">
                                                        <path className="text-amber-200" strokeWidth="6" stroke="currentColor" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                                                        <path className="text-amber-600 transition-all duration-300" strokeDasharray={`${(group.validatedCount / group.totalOrdersCount) * 100}, 100`} strokeWidth="6" strokeLinecap="round" stroke="currentColor" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                                                    </svg>
                                                </div>
                                                <span>{group.validatedCount}/{group.totalOrdersCount}</span>
                                            </span>
                                        )}

                                        {/* Botón validar día */}
                                        {group.pendingCount > 0 && (
                                            <button
                                                type="button"
                                                disabled={validatingGroupDate === group.dateStr}
                                                onClick={(e) => handleValidateAllForDate(group.orders, group.dateStr, e)}
                                                className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-[11px] flex items-center gap-1 shadow-2xs transition-all active:scale-95 cursor-pointer disabled:opacity-50"
                                                title="Validar todas las del día"
                                            >
                                                {validatingGroupDate === group.dateStr ? (
                                                    <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                                                ) : (
                                                    <>
                                                        <i className="bi bi-check2-all text-xs"></i>
                                                        <span>Validar ({group.pendingCount})</span>
                                                    </>
                                                )}
                                            </button>
                                        )}

                                        <i className={`bi bi-chevron-${isDayExpanded ? 'up' : 'down'} text-slate-400 text-xs ml-0.5`}></i>
                                    </div>
                                </div>

                                {/* Cuerpo Desplegable de la Fecha (Accordion) */}
                                {isDayExpanded && (
                                    <div className="border-t border-slate-100 bg-slate-50/50 p-3 space-y-3 animate-in fade-in duration-150">
                                        <div className="space-y-2.5">
                                            {group.orders.map(order => {
                                                const transferAmt = getTransferAmount(order)
                                                const isPaid = order.payment?.paymentStatus === 'paid'
                                                const isValidatingThis = validatingOrderId === order.id
                                                const refDate = getOrderReferenceDate(order)
                                                const timeFormatted = refDate.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' })
                                                const isMixed = order.payment?.method === 'mixed'
                                                const businessName = businesses.find(b => b.id === order.businessId)?.name

                                                return (
                                                    <div key={order.id} className="bg-white rounded-xl border border-slate-200/80 p-3.5 space-y-3 shadow-2xs hover:border-slate-300 transition-colors">
                                                        <div className="flex items-start justify-between gap-3">
                                                            {/* Info del Cliente y Pedido */}
                                                            <div className="min-w-0 flex-1 space-y-0.5">
                                                                <div className="flex flex-wrap items-center gap-1.5">
                                                                    <h4 className="font-bold text-sm text-slate-900 leading-tight truncate">
                                                                        {order.customer?.name || 'Cliente sin nombre'}
                                                                    </h4>
                                                                    {isMixed && (
                                                                        <span className="px-1.5 py-0.2 rounded-full bg-amber-100 text-amber-800 text-[9px] font-bold uppercase">
                                                                            Mixto
                                                                        </span>
                                                                    )}
                                                                </div>

                                                                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                                                                    <span>{timeFormatted}</span>
                                                                    {order.payment?.selectedBank && (
                                                                        <>
                                                                            <span>·</span>
                                                                            <span className="font-medium text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded-md text-[10px]">
                                                                                🏦 {order.payment.selectedBank}
                                                                            </span>
                                                                        </>
                                                                    )}
                                                                </div>

                                                                {businessName && selectedBusinessFilter === 'all' && (
                                                                    <p className="text-[10px] text-slate-400 font-medium truncate">
                                                                        {businessName}
                                                                    </p>
                                                                )}
                                                            </div>

                                                            {/* Monto y Estado */}
                                                            <div className="text-right shrink-0">
                                                                <p className="font-black text-base text-slate-900 tracking-tight">
                                                                    ${transferAmt.toFixed(2)}
                                                                </p>
                                                                <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider mt-0.5 ${
                                                                    isPaid
                                                                        ? 'bg-emerald-100 text-emerald-800'
                                                                        : order.payment?.paymentStatus === 'validating'
                                                                        ? 'bg-amber-100 text-amber-800'
                                                                        : 'bg-slate-100 text-slate-700'
                                                                }`}>
                                                                    {isPaid ? 'Validada' : order.payment?.paymentStatus === 'validating' ? 'Validando' : 'Por Validar'}
                                                                </span>
                                                            </div>
                                                        </div>

                                                        {/* Comprobante Adjunto si existe */}
                                                        {order.payment?.receiptImageUrl && (
                                                            <button
                                                                type="button"
                                                                onClick={() => setReceiptModalOrder(order)}
                                                                className="w-full flex items-center gap-3 p-2 bg-blue-50/60 hover:bg-blue-50 border border-blue-100 rounded-xl transition-all text-left group"
                                                            >
                                                                <img
                                                                    src={order.payment.receiptImageUrl}
                                                                    alt="Comprobante"
                                                                    className="w-12 h-12 rounded-lg object-cover border border-white shadow-2xs group-hover:scale-105 transition-transform"
                                                                />
                                                                <div className="min-w-0 flex-1">
                                                                    <p className="text-xs font-bold text-blue-900 tracking-tight">
                                                                        Comprobante de Pago
                                                                    </p>
                                                                    <p className="text-[11px] text-blue-600 font-medium truncate">
                                                                        Toca para ampliar y revisar detalle
                                                                    </p>
                                                                </div>
                                                                <i className="bi bi-arrows-angle-expand text-blue-500 text-sm shrink-0"></i>
                                                            </button>
                                                        )}

                                                        {/* Acciones de Validación (Estilo de botones Cierre de Caja) */}
                                                        <div className="flex items-center gap-2 pt-1 border-t border-slate-100">
                                                            {!isPaid ? (
                                                                <button
                                                                    type="button"
                                                                    disabled={isValidatingThis}
                                                                    onClick={() => handleValidatePayment(order)}
                                                                    className="flex-1 py-1.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-2xs active:scale-95 cursor-pointer disabled:opacity-50"
                                                                >
                                                                    {isValidatingThis ? (
                                                                        <>
                                                                            <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                                                                            <span>Guardando...</span>
                                                                        </>
                                                                    ) : (
                                                                        <>
                                                                            <i className="bi bi-check-circle-fill text-xs"></i>
                                                                            <span>Validar Pago</span>
                                                                        </>
                                                                    )}
                                                                </button>
                                                            ) : (
                                                                <button
                                                                    type="button"
                                                                    disabled={isValidatingThis}
                                                                    onClick={() => handleUnvalidatePayment(order)}
                                                                    className="flex-1 py-1.5 px-3 bg-emerald-50 hover:bg-amber-50 text-emerald-700 hover:text-amber-800 border border-emerald-200/60 hover:border-amber-300 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                                                                >
                                                                    {isValidatingThis ? (
                                                                        <span className="w-3.5 h-3.5 border-2 border-emerald-700 border-t-transparent rounded-full animate-spin"></span>
                                                                    ) : (
                                                                        <>
                                                                            <i className="bi bi-check-circle-fill text-xs text-emerald-600"></i>
                                                                            <span>Pago Validado (Desmarcar)</span>
                                                                        </>
                                                                    )}
                                                                </button>
                                                            )}

                                                            {/* Gestionar detalles de pago */}
                                                            {onManagePayment && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => onManagePayment(order)}
                                                                    className="px-2 py-1 rounded-lg text-xs font-medium bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors flex items-center gap-1 shadow-2xs"
                                                                    title="Editar detalles de pago"
                                                                >
                                                                    <i className="bi bi-pencil text-[10px]"></i>
                                                                    <span>Gestionar</span>
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )
                    })
                )}
            </div>

            {/* Modal para ampliar Comprobante */}
            {receiptModalOrder?.payment?.receiptImageUrl && (
                <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs p-4 flex items-center justify-center animate-in fade-in duration-200">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
                        {/* Header del Modal */}
                        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2 bg-slate-50 shrink-0">
                            <div className="min-w-0">
                                <h3 className="text-sm font-black text-slate-900 tracking-tight leading-tight">
                                    Comprobante de Transferencia
                                </h3>
                                <p className="text-xs text-slate-500 font-medium truncate">
                                    {receiptModalOrder.customer?.name}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setReceiptModalOrder(null)}
                                className="w-8 h-8 rounded-full hover:bg-slate-200 text-slate-500 flex items-center justify-center transition-colors"
                            >
                                <i className="bi bi-x-lg text-sm"></i>
                            </button>
                        </div>

                        {/* Imagen del Comprobante */}
                        <div className="flex-1 bg-slate-900 p-4 flex items-center justify-center overflow-auto">
                            <img
                                src={receiptModalOrder.payment.receiptImageUrl}
                                alt="Comprobante completo"
                                className="max-w-full max-h-[60vh] object-contain rounded-lg shadow-md"
                            />
                        </div>

                        {/* Footer del Modal con Acción de Validación */}
                        <div className="p-4 bg-white border-t border-slate-100 flex items-center justify-between gap-3 shrink-0">
                            <div>
                                <p className="text-xs text-slate-500 font-medium">Monto Transferencia</p>
                                <p className="text-lg font-black text-slate-900 tracking-tight leading-tight">
                                    ${getTransferAmount(receiptModalOrder).toFixed(2)}
                                </p>
                            </div>
                            <div className="flex items-center gap-2">
                                {receiptModalOrder.payment?.paymentStatus !== 'paid' ? (
                                    <button
                                        type="button"
                                        disabled={validatingOrderId === receiptModalOrder.id}
                                        onClick={async () => {
                                            await handleValidatePayment(receiptModalOrder)
                                            setReceiptModalOrder(null)
                                        }}
                                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl transition-all shadow-xs flex items-center gap-1.5 active:scale-95 cursor-pointer"
                                    >
                                        <i className="bi bi-check-circle-fill text-xs"></i>
                                        <span>Validar Pago</span>
                                    </button>
                                ) : (
                                    <span className="px-3 py-1.5 bg-emerald-100 text-emerald-800 text-xs font-bold rounded-xl flex items-center gap-1">
                                        <i className="bi bi-check-circle-fill text-xs text-emerald-600"></i>
                                        <span>Pago Validado</span>
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
