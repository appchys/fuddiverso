import React, { useState, useMemo } from 'react'
import { Order, Business } from '@/types'
import { format, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, isWithinInterval, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'

interface WalletViewProps {
    business: Business
    orders: Order[]
    historicalOrders: Order[]
}

type TimeRange = 'today' | 'week' | 'month' | 'custom'

export default function WalletView({ business, orders, historicalOrders }: WalletViewProps) {
    const [timeRange, setTimeRange] = useState<TimeRange>('today')
    const [customStartDate, setCustomStartDate] = useState('')
    const [customEndDate, setCustomEndDate] = useState('')

    // Combinar todas las órdenes
    const allOrders = useMemo(() => {
        // Filtrar duplicados por si acaso
        const seen = new Set()
        return [...orders, ...historicalOrders].filter(order => {
            if (seen.has(order.id)) return false
            seen.add(order.id)
            return true
        }).filter(order => order.status === 'delivered') // Solo órdenes entregadas
    }, [orders, historicalOrders])

    const filteredOrders = useMemo(() => {
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
                if (!customStartDate || !customEndDate) return allOrders
                start = startOfDay(parseISO(customStartDate))
                end = endOfDay(parseISO(customEndDate))
                break
            default:
                start = startOfDay(now)
                end = endOfDay(now)
        }

        return allOrders.filter(order => {
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
    }, [allOrders, timeRange, customStartDate, customEndDate])

    const financials = useMemo(() => {
        let totalProducts = 0
        let totalDelivery = 0 // Solo informativo, no se cobra comisión

        filteredOrders.forEach(order => {
            // Calcular total de productos sumando items
            const orderProductsTotal = order.items.reduce((sum, item) => sum + item.subtotal, 0)
            totalProducts += orderProductsTotal

            // El resto sería delivery (aproximado, o usar order.delivery.cost si existe y es confiable)
            // O simplemente order.total - orderProductsTotal
            if (order.total > orderProductsTotal) {
                totalDelivery += (order.total - orderProductsTotal)
            }
        })

        const commissionRate = 0.04 // 4%
        const commission = totalProducts * commissionRate
        const netSales = totalProducts - commission

        return {
            totalProducts,
            commission,
            netSales,
            orderCount: filteredOrders.length
        }
    }, [filteredOrders])

    return (
        <div className="p-6 max-w-7xl mx-auto">
            <div className="mb-8">
                <h1 className="text-2xl font-bold text-gray-900 mb-2">Billetera</h1>
                <p className="text-gray-600">Gestión de ingresos y comisiones de Fuddi.</p>
            </div>

            {/* Filtros de Fecha */}
            <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 mb-6 flex flex-wrap items-center gap-4">
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

            {/* Tarjetas de Resumen */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                {/* Ventas Totales (Productos) */}
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                    <div className="flex items-center justify-between mb-4">
                        <div className="p-3 bg-blue-50 text-blue-600 rounded-lg">
                            <span className="material-symbols-rounded text-2xl">shopping_bag</span>
                        </div>
                        <span className="text-sm font-medium text-gray-500">
                            {financials.orderCount} ordenes
                        </span>
                    </div>
                    <h3 className="text-gray-500 text-sm font-medium mb-1">Ventas Totales (Productos)</h3>
                    <p className="text-3xl font-bold text-gray-900">${financials.totalProducts.toFixed(2)}</p>
                    <p className="text-xs text-gray-400 mt-2">Base para cálculo de comisión</p>
                </div>

                {/* Comisión Fuddi */}
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                    <div className="flex items-center justify-between mb-4">
                        <div className="p-3 bg-red-50 text-red-600 rounded-lg">
                            <span className="material-symbols-rounded text-2xl">percent</span>
                        </div>
                        <span className="text-sm font-medium text-red-600 bg-red-50 px-2 py-1 rounded-full">4%</span>
                    </div>
                    <h3 className="text-gray-500 text-sm font-medium mb-1">Comisión Fuddi</h3>
                    <p className="text-3xl font-bold text-red-600">-${financials.commission.toFixed(2)}</p>
                    <p className="text-xs text-gray-400 mt-2">Deducido del total de productos</p>
                </div>

                {/* Ventas Netas */}
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 bg-gradient-to-br from-green-50 to-white">
                    <div className="flex items-center justify-between mb-4">
                        <div className="p-3 bg-green-100 text-green-600 rounded-lg">
                            <span className="material-symbols-rounded text-2xl">account_balance_wallet</span>
                        </div>
                    </div>
                    <h3 className="text-gray-500 text-sm font-medium mb-1">Ganancia Neta Estimada</h3>
                    <p className="text-3xl font-bold text-green-600">${financials.netSales.toFixed(2)}</p>
                    <p className="text-xs text-gray-400 mt-2">Lo que recibirás (excluyendo envío)</p>
                </div>
            </div>

            <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 flex items-start gap-3">
                <span className="material-symbols-rounded text-blue-600 mt-0.5">info</span>
                <div>
                    <h4 className="font-semibold text-blue-900 text-sm">Información sobre el cobro</h4>
                    <p className="text-blue-800 text-sm mt-1">
                        La comisión del 4% se calcula únicamente sobre el valor de los productos vendidos.
                        El costo de envío no se toma en cuenta para este cálculo.
                    </p>
                </div>
            </div>
        </div>
    )
}
