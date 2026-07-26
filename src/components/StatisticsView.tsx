'use client'

import React, { useMemo, useState, useEffect } from 'react';
import { Order } from '@/types';
import { getOrdersByBusinessComplete } from '@/lib/database';
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer
} from 'recharts';

interface StatisticsViewProps {
    orders: Order[];
    businessId?: string;
}

type DateFilter = 'today' | 'yesterday' | '7days' | '30days' | 'custom';

// Helper para obtener fecha efectiva (programada > creación)
const getEffectiveDate = (order: Order): Date => {
    try {
        if (order.timing?.scheduledDate) {
            if (order.timing.scheduledDate instanceof Date) {
                return order.timing.scheduledDate;
            } else if ((order.timing.scheduledDate as any)?.toDate) {
                return (order.timing.scheduledDate as any).toDate();
            } else if ((order.timing.scheduledDate as any)?.seconds) {
                return new Date((order.timing.scheduledDate as any).seconds * 1000);
            } else if (typeof order.timing.scheduledDate === 'string') {
                return new Date(order.timing.scheduledDate);
            }
        }

        if (!order.createdAt) return new Date();

        if (order.createdAt instanceof Date) {
            return order.createdAt;
        } else if ((order.createdAt as any)?.toDate) {
            return (order.createdAt as any).toDate();
        } else if ((order.createdAt as any)?.seconds) {
            return new Date((order.createdAt as any).seconds * 1000);
        }

        return new Date(order.createdAt as any);
    } catch (e) {
        return new Date();
    }
};

const getOrderSubtotal = (order: Order) => {
    if (typeof order.subtotal === 'number') return order.subtotal;
    const deliveryCost = order.delivery?.deliveryCost || 0;
    const calculated = order.total - deliveryCost;
    if (isNaN(calculated)) return order.total || 0;
    return Math.max(0, calculated);
};

const getPaymentMethodLabel = (order: Order): string => {
    const rawMethod = order.payment?.method || (order as any).paymentMethod || '';
    if (!rawMethod) return 'Efectivo / No especificado';
    const m = String(rawMethod).toLowerCase();
    if (m.includes('cash') || m.includes('efectivo')) return 'Efectivo';
    if (m.includes('transfer') || m.includes('banco')) return 'Transferencia';
    if (m.includes('card') || m.includes('tarjeta') || m.includes('paymentez') || m.includes('debit') || m.includes('credit')) return 'Tarjeta';
    if (m.includes('saldo') || m.includes('wallet') || m.includes('fuddi')) return 'Saldo Fuddi';
    if (m.includes('mixed') || m.includes('mixto')) return 'Pago Mixto';
    if (m.includes('contra') || m.includes('delivery')) return 'Contra entrega';
    return rawMethod;
};

export default function StatisticsView({ orders = [], businessId }: StatisticsViewProps) {
    const [dateFilter, setDateFilter] = useState<DateFilter>('today');
    const [startDate, setStartDate] = useState<string>('');
    const [endDate, setEndDate] = useState<string>('');

    const [fetchedOrders, setFetchedOrders] = useState<Order[]>([]);
    const [loadingHistory, setLoadingHistory] = useState<boolean>(false);

    const [isMounted, setIsMounted] = useState<boolean>(false);

    useEffect(() => {
        setIsMounted(true);
    }, []);

    // Cargar historial de órdenes completo de Firebase cuando existe businessId
    useEffect(() => {
        if (!businessId) return;
        let isMounted = true;

        const fetchHistory = async () => {
            setLoadingHistory(true);
            try {
                const history = await getOrdersByBusinessComplete(businessId);
                if (isMounted) {
                    setFetchedOrders(history || []);
                }
            } catch (error) {
                console.error('Error cargando historial completo en Estadísticas:', error);
            } finally {
                if (isMounted) {
                    setLoadingHistory(false);
                }
            }
        };

        fetchHistory();

        return () => {
            isMounted = false;
        };
    }, [businessId]);

    // Combinar órdenes en tiempo real con órdenes históricas cargadas
    const allOrdersCombined = useMemo(() => {
        const map = new Map<string, Order>();
        (fetchedOrders || []).forEach(o => {
            if (o?.id) map.set(o.id, o);
        });
        (orders || []).forEach(o => {
            if (o?.id) map.set(o.id, o);
        });
        return Array.from(map.values());
    }, [orders, fetchedOrders]);

    const filteredOrders = useMemo(() => {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        return allOrdersCombined.filter(order => {
            if (!order) return false;
            // Excluir órdenes canceladas y borradores/drafts no confirmados
            const status = String(order.status || '').toLowerCase();
            if (status === 'cancelled' || status === 'borrador' || status === 'draft') return false;

            const orderDate = getEffectiveDate(order);
            if (!orderDate || isNaN(orderDate.getTime())) return false;

            const orderDateOnly = new Date(orderDate.getFullYear(), orderDate.getMonth(), orderDate.getDate());

            switch (dateFilter) {
                case 'today':
                    return orderDateOnly.getTime() === today.getTime();

                case 'yesterday': {
                    const yesterday = new Date(today);
                    yesterday.setDate(yesterday.getDate() - 1);
                    return orderDateOnly.getTime() === yesterday.getTime();
                }

                case '7days': {
                    const sevenDaysAgo = new Date(today);
                    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
                    return orderDateOnly >= sevenDaysAgo && orderDateOnly <= today;
                }

                case '30days': {
                    const thirtyDaysAgo = new Date(today);
                    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);
                    return orderDateOnly >= thirtyDaysAgo && orderDateOnly <= today;
                }

                case 'custom': {
                    if (!startDate || !endDate) return true;
                    const startParts = startDate.split('-').map(Number);
                    const endParts = endDate.split('-').map(Number);
                    const start = new Date(startParts[0], startParts[1] - 1, startParts[2]);
                    const end = new Date(endParts[0], endParts[1] - 1, endParts[2]);
                    return orderDateOnly >= start && orderDateOnly <= end;
                }

                default:
                    return true;
            }
        });
    }, [allOrdersCombined, dateFilter, startDate, endDate]);

    const stats = useMemo(() => {
        // 1. Montos de venta
        const totalPublicSales = filteredOrders.reduce((sum, order) => sum + (order.total || 0), 0);
        const totalProductSubtotal = filteredOrders.reduce((sum, order) => sum + getOrderSubtotal(order), 0);
        const totalStoreSales = filteredOrders.reduce((sum, order) => {
            const calculatedStoreTotal = (order.items || []).reduce((s, item) => {
                const price = item.storeReceives || (item.price && item.commission ? item.price - item.commission : (item.product?.basePrice || item.product?.price || item.price || 0));
                return s + (price * (item.quantity || 1));
            }, 0);
            return sum + (calculatedStoreTotal || getOrderSubtotal(order));
        }, 0);

        // 2. Cantidad de órdenes y ticket promedio
        const totalOrdersCount = filteredOrders.length;
        const averageTicket = totalOrdersCount > 0 ? (totalStoreSales / totalOrdersCount) : 0;

        // 3. Productos más vendidos (Top 5) y cantidad total de items
        let totalItemsSold = 0;
        const productSales: Record<string, { name: string; quantity: number }> = {};

        // 4. Métodos de Pago
        const paymentMap: Record<string, { label: string; count: number; total: number }> = {};

        // 5. Ventas por fecha / hora
        const salesMap = new Map<string, { label: string; timestamp: number; amount: number }>();
        const hourlySales = new Array(24).fill(0).map((_, i) => ({
            hour: `${String(i).padStart(2, '0')}:00`,
            amount: 0
        }));

        // 6. Horas pico
        const ordersByHour = new Array(24).fill(0).map((_, i) => ({
            hour: `${String(i).padStart(2, '0')}:00`,
            count: 0
        }));

        filteredOrders.forEach((order) => {
            // Método de pago
            const methodLabel = getPaymentMethodLabel(order);
            if (!paymentMap[methodLabel]) {
                paymentMap[methodLabel] = { label: methodLabel, count: 0, total: 0 };
            }
            paymentMap[methodLabel].count += 1;
            paymentMap[methodLabel].total += getOrderSubtotal(order);

            // Procesar productos (excluyendo premios/precio 0 y agrupando por variante)
            order.items?.forEach((item) => {
                const itemAny = item as any;
                const price = typeof itemAny.price === 'number' ? itemAny.price : (typeof item.product?.price === 'number' ? item.product.price : (typeof itemAny.basePrice === 'number' ? itemAny.basePrice : (typeof itemAny.storeReceives === 'number' ? itemAny.storeReceives : 0)));
                const isZeroPriceOrReward = price === 0 || itemAny.isReward || itemAny.isGift || itemAny.isPrize || itemAny.isFree || itemAny.isPremio;

                // Excluir premios o productos de precio 0
                if (isZeroPriceOrReward) {
                    return;
                }

                const productId = itemAny.productId || item.product?.id || itemAny.id || 'producto';
                const productName = itemAny.name || item.product?.name || item.name || 'Producto';
                const variantName = item.variant || itemAny.variantName || itemAny.selectedVariant || (itemAny.variant?.name) || '';

                // Construir nombre amigable incluyendo la variante si existe
                let displayName = productName;
                if (variantName && String(variantName).trim() !== '' && String(variantName).toLowerCase() !== String(productName).toLowerCase()) {
                    displayName = `${productName} (${variantName})`;
                }

                // Clave única agrupando por id de producto y variante
                const itemKey = `${productId}_${variantName || 'default'}`;

                const qty = item.quantity || 1;
                totalItemsSold += qty;

                if (!productSales[itemKey]) {
                    productSales[itemKey] = {
                        name: displayName,
                        quantity: 0,
                    };
                }
                productSales[itemKey].quantity += qty;
            });

            // Procesar fechas y horas
            try {
                const orderDate = getEffectiveDate(order);
                if (!isNaN(orderDate.getTime())) {
                    const hour = orderDate.getHours();
                    const subtotal = getOrderSubtotal(order);

                    // Horas pico y ventas por hora
                    if (ordersByHour[hour]) {
                        ordersByHour[hour].count += 1;
                        hourlySales[hour].amount += subtotal;
                    }

                    // Fechas
                    const year = orderDate.getFullYear();
                    const month = String(orderDate.getMonth() + 1).padStart(2, '0');
                    const day = String(orderDate.getDate()).padStart(2, '0');
                    const dateKey = `${year}-${month}-${day}`;
                    const label = `${day}/${month}`;
                    const dayStartTimestamp = new Date(year, orderDate.getMonth(), orderDate.getDate()).getTime();

                    const current = salesMap.get(dateKey) || { label, timestamp: dayStartTimestamp, amount: 0 };
                    current.amount += subtotal;
                    salesMap.set(dateKey, current);
                }
            } catch (e) {
                console.warn('Error procesando fecha de orden:', e);
            }
        });

        // Top 5 productos
        const topProducts = Object.values(productSales)
            .sort((a, b) => b.quantity - a.quantity)
            .slice(0, 5);

        // Array de Métodos de pago
        const paymentMethodsList = Object.values(paymentMap).sort((a, b) => b.count - a.count);

        // Chart Data según filtro (diario u horario)
        const isSingleDay = ['today', 'yesterday'].includes(dateFilter);
        const chartData = isSingleDay
            ? hourlySales.map(h => ({ date: h.hour, amount: parseFloat(h.amount.toFixed(2)) }))
            : Array.from(salesMap.values())
                .sort((a, b) => a.timestamp - b.timestamp)
                .map(item => ({
                    date: item.label,
                    amount: parseFloat(item.amount.toFixed(2))
                }));

        return {
            totalPublicSales,
            totalProductSubtotal,
            totalStoreSales,
            totalOrdersCount,
            averageTicket,
            totalItemsSold,
            topProducts,
            paymentMethodsList,
            chartData,
            ordersByHour,
            isSingleDay
        };
    }, [filteredOrders, dateFilter]);

    return (
        <div className="space-y-6 animate-fade-in pb-8">
            {/* Header & Filtros */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-gray-200 pb-5">
                <div>
                    <h2 className="text-3xl font-black text-gray-900 tracking-tight leading-tight flex items-center gap-3">
                        <span className="material-symbols-rounded text-red-600 text-3xl">insights</span>
                        Estadísticas de Negocio
                    </h2>
                    <p className="text-sm font-medium text-gray-500 leading-relaxed mt-1">
                        Resumen de rendimiento, ventas y métricas clave de tus pedidos.
                    </p>
                </div>

                {/* Controles de Filtro de Fecha */}
                <div className="flex flex-wrap items-center gap-2 bg-gray-100 p-1.5 rounded-xl border border-gray-200/80">
                    <button
                        onClick={() => setDateFilter('today')}
                        className={`px-3.5 py-2 text-xs font-bold rounded-lg transition-all ${dateFilter === 'today'
                            ? 'bg-white text-gray-900 shadow-sm border border-gray-200/50'
                            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/60'
                            }`}
                    >
                        Hoy
                    </button>
                    <button
                        onClick={() => setDateFilter('yesterday')}
                        className={`px-3.5 py-2 text-xs font-bold rounded-lg transition-all ${dateFilter === 'yesterday'
                            ? 'bg-white text-gray-900 shadow-sm border border-gray-200/50'
                            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/60'
                            }`}
                    >
                        Ayer
                    </button>
                    <button
                        onClick={() => setDateFilter('7days')}
                        className={`px-3.5 py-2 text-xs font-bold rounded-lg transition-all ${dateFilter === '7days'
                            ? 'bg-white text-gray-900 shadow-sm border border-gray-200/50'
                            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/60'
                            }`}
                    >
                        7 Días
                    </button>
                    <button
                        onClick={() => setDateFilter('30days')}
                        className={`px-3.5 py-2 text-xs font-bold rounded-lg transition-all ${dateFilter === '30days'
                            ? 'bg-white text-gray-900 shadow-sm border border-gray-200/50'
                            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/60'
                            }`}
                    >
                        30 Días
                    </button>
                    <button
                        onClick={() => setDateFilter('custom')}
                        className={`px-3.5 py-2 text-xs font-bold rounded-lg transition-all ${dateFilter === 'custom'
                            ? 'bg-white text-gray-900 shadow-sm border border-gray-200/50'
                            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/60'
                            }`}
                    >
                        Personalizado
                    </button>
                </div>
            </div>

            {/* Selector de Rango Personalizado */}
            {dateFilter === 'custom' && (
                <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 flex flex-wrap items-center gap-4 animate-in fade-in slide-in-from-top-2">
                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-bold text-gray-600 uppercase tracking-wider">Desde</label>
                        <input
                            type="date"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                            className="bg-gray-50 border border-gray-300 text-gray-900 text-sm font-medium rounded-lg focus:ring-red-500 focus:border-red-500 block p-2.5"
                        />
                    </div>
                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-bold text-gray-600 uppercase tracking-wider">Hasta</label>
                        <input
                            type="date"
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                            className="bg-gray-50 border border-gray-300 text-gray-900 text-sm font-medium rounded-lg focus:ring-red-500 focus:border-red-500 block p-2.5"
                        />
                    </div>
                </div>
            )}

            {/* Indicador de carga de historial */}
            {loadingHistory && (
                <div className="flex items-center justify-between bg-blue-50/80 border border-blue-200 px-4 py-3 rounded-xl text-blue-800 text-xs font-medium animate-pulse">
                    <div className="flex items-center gap-2">
                        <span className="material-symbols-rounded text-base animate-spin">sync</span>
                        Cargando historial de pedidos completo de la base de datos...
                    </div>
                </div>
            )}

            {/* Tarjetas Principales de Métricas */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                {/* Ventas Totales */}
                <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-200 hover:shadow-md transition-shadow">
                    <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-bold uppercase tracking-wider text-gray-500">Ventas Totales</span>
                        <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                            <span className="material-symbols-rounded">payments</span>
                        </div>
                    </div>
                    <div className="text-3xl font-black text-emerald-600 tracking-tight leading-tight">
                        ${stats.totalStoreSales.toFixed(2)}
                    </div>
                    <div className="text-[11px] font-semibold text-gray-500 mt-1">
                        Público (Total Cliente): <span className="font-bold text-gray-800">${stats.totalPublicSales.toFixed(2)}</span>
                    </div>
                    <p className="text-xs font-medium text-gray-500 leading-relaxed mt-2">
                        Ingreso neto asignado al negocio
                    </p>
                </div>

                {/* Total Pedidos */}
                <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-200 hover:shadow-md transition-shadow">
                    <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-bold uppercase tracking-wider text-gray-500">Total Pedidos</span>
                        <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                            <span className="material-symbols-rounded">receipt_long</span>
                        </div>
                    </div>
                    <div className="text-3xl font-black text-blue-600 tracking-tight leading-tight">
                        {stats.totalOrdersCount}
                    </div>
                    <p className="text-xs font-medium text-gray-500 leading-relaxed mt-2">
                        Pedidos procesados en el periodo
                    </p>
                </div>

                {/* Ticket Promedio */}
                <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-200 hover:shadow-md transition-shadow">
                    <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-bold uppercase tracking-wider text-gray-500">Ticket Promedio</span>
                        <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
                            <span className="material-symbols-rounded">query_stats</span>
                        </div>
                    </div>
                    <div className="text-3xl font-black text-purple-600 tracking-tight leading-tight">
                        ${stats.averageTicket.toFixed(2)}
                    </div>
                    <p className="text-xs font-medium text-gray-500 leading-relaxed mt-2">
                        Promedio gastado por cada pedido
                    </p>
                </div>

                {/* Items Vendidos */}
                <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-200 hover:shadow-md transition-shadow">
                    <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-bold uppercase tracking-wider text-gray-500">Productos Vendidos</span>
                        <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
                            <span className="material-symbols-rounded">inventory_2</span>
                        </div>
                    </div>
                    <div className="text-3xl font-black text-amber-600 tracking-tight leading-tight">
                        {stats.totalItemsSold}
                    </div>
                    <p className="text-xs font-medium text-gray-500 leading-relaxed mt-2">
                        Unidades totales en el periodo
                    </p>
                </div>
            </div>

            {/* Fila Central: Top Productos & Métodos de Pago */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Top 5 Más Vendidos */}
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 flex flex-col justify-between">
                    <div>
                        <div className="flex items-center justify-between mb-5">
                            <div>
                                <h3 className="text-lg font-black text-gray-900 tracking-tight leading-tight">Top 5 Más Vendidos</h3>
                                <p className="text-xs font-medium text-gray-500 leading-relaxed">Productos con mayor volumen de venta</p>
                            </div>
                            <div className="p-2.5 bg-amber-100 text-amber-700 rounded-xl">
                                <span className="material-symbols-rounded text-xl">military_tech</span>
                            </div>
                        </div>

                        <div className="space-y-3.5">
                            {stats.topProducts.length > 0 ? (
                                stats.topProducts.map((product, index) => (
                                    <div key={index} className="flex justify-between items-center p-2.5 rounded-xl hover:bg-gray-50 transition-colors">
                                        <div className="flex items-center gap-3 min-w-0">
                                            <span className={`
                                                w-7 h-7 flex items-center justify-center rounded-lg text-xs font-black shrink-0
                                                ${index === 0 ? 'bg-amber-400 text-amber-950' :
                                                    index === 1 ? 'bg-gray-300 text-gray-800' :
                                                        index === 2 ? 'bg-orange-300 text-orange-950' : 'bg-gray-100 text-gray-600'}
                                            `}>
                                                {index + 1}
                                            </span>
                                            <span className="text-sm font-bold text-gray-900 truncate" title={product.name}>
                                                {product.name}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-1.5 shrink-0 bg-gray-100 px-3 py-1 rounded-lg">
                                            <span className="text-xs font-black text-gray-900">{product.quantity}</span>
                                            <span className="text-[10px] font-semibold text-gray-500">uds</span>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <div className="text-center py-8 text-gray-400 text-sm font-medium">
                                    No se registraron ventas de productos en este periodo
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Desglose por Método de Pago */}
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 flex flex-col justify-between">
                    <div>
                        <div className="flex items-center justify-between mb-5">
                            <div>
                                <h3 className="text-lg font-black text-gray-900 tracking-tight leading-tight">Métodos de Pago</h3>
                                <p className="text-xs font-medium text-gray-500 leading-relaxed">Formas de pago elegidas por los clientes</p>
                            </div>
                            <div className="p-2.5 bg-blue-100 text-blue-700 rounded-xl">
                                <span className="material-symbols-rounded text-xl">credit_card</span>
                            </div>
                        </div>

                        <div className="space-y-3.5">
                            {stats.paymentMethodsList.length > 0 ? (
                                stats.paymentMethodsList.map((pm, index) => {
                                    const percentage = stats.totalOrdersCount > 0
                                        ? Math.round((pm.count / stats.totalOrdersCount) * 100)
                                        : 0;
                                    return (
                                        <div key={index} className="p-2.5 rounded-xl hover:bg-gray-50 transition-colors">
                                            <div className="flex justify-between items-center mb-1.5">
                                                <span className="text-sm font-bold text-gray-900">{pm.label}</span>
                                                <div className="text-right">
                                                    <span className="text-xs font-black text-gray-900">${pm.total.toFixed(2)}</span>
                                                    <span className="text-[11px] font-semibold text-gray-500 ml-2">({pm.count} ped.)</span>
                                                </div>
                                            </div>
                                            <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden">
                                                <div
                                                    className="bg-blue-600 h-full rounded-full transition-all duration-500"
                                                    style={{ width: `${percentage}%` }}
                                                />
                                            </div>
                                        </div>
                                    );
                                })
                            ) : (
                                <div className="text-center py-8 text-gray-400 text-sm font-medium">
                                    No hay registros de formas de pago en este periodo
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Gráfico de Ventas (por Hora si es Hoy/Ayer, por Fecha si son múltiples días) */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
                <div className="mb-6 flex items-center justify-between">
                    <div>
                        <h3 className="text-xl font-black text-gray-900 tracking-tight leading-tight">
                            {stats.isSingleDay ? 'Ventas por Hora' : 'Ventas por Fecha'}
                        </h3>
                        <p className="text-xs font-medium text-gray-500 leading-relaxed mt-0.5">
                            {stats.isSingleDay
                                ? 'Distribución de ingresos a lo largo de las horas del día'
                                : 'Comportamiento y tendencia de ventas diarias'}
                        </p>
                    </div>
                </div>
                <div className="h-[320px] w-full">
                    {isMounted && stats.chartData.length > 0 ? (
                        <ResponsiveContainer width="100%" height={320} minWidth={0} minHeight={320}>
                            <BarChart data={stats.chartData}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                                <XAxis
                                    dataKey="date"
                                    tick={{ fontSize: 12, fill: '#4B5563', fontWeight: 500 }}
                                    axisLine={false}
                                    tickLine={false}
                                />
                                <YAxis
                                    tick={{ fontSize: 12, fill: '#4B5563', fontWeight: 500 }}
                                    axisLine={false}
                                    tickLine={false}
                                    tickFormatter={(value) => `$${value}`}
                                />
                                <Tooltip
                                    cursor={{ fill: '#F3F4F6' }}
                                    contentStyle={{ borderRadius: '12px', border: '1px solid #E5E7EB', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)' }}
                                    formatter={(value?: number) => [`$${(value || 0).toFixed(2)}`, 'Ventas']}
                                />
                                <Bar
                                    dataKey="amount"
                                    fill="#EF4444"
                                    radius={[6, 6, 0, 0]}
                                    maxBarSize={45}
                                />
                            </BarChart>
                        </ResponsiveContainer>
                    ) : (
                        <div className="h-full flex items-center justify-center text-gray-400 font-medium text-sm">
                            No hay suficientes datos de ventas para mostrar el gráfico
                        </div>
                    )}
                </div>
            </div>

            {/* Gráfico de Horas Pico */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
                <div className="mb-6">
                    <h3 className="text-xl font-black text-gray-900 tracking-tight leading-tight">Horas Con Más Pedidos</h3>
                    <p className="text-xs font-medium text-gray-500 leading-relaxed mt-0.5">
                        Distribución del número de pedidos según el horario de recepción o entrega
                    </p>
                </div>
                <div className="h-[300px] w-full">
                    {isMounted ? (
                        <ResponsiveContainer width="100%" height={300} minWidth={0} minHeight={300}>
                            <BarChart data={stats.ordersByHour}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                                <XAxis
                                    dataKey="hour"
                                    tick={{ fontSize: 12, fill: '#4B5563', fontWeight: 500 }}
                                    axisLine={false}
                                    tickLine={false}
                                    interval={2}
                                />
                                <YAxis
                                    tick={{ fontSize: 12, fill: '#4B5563', fontWeight: 500 }}
                                    axisLine={false}
                                    tickLine={false}
                                    allowDecimals={false}
                                />
                                <Tooltip
                                    cursor={{ fill: '#F3F4F6' }}
                                    contentStyle={{ borderRadius: '12px', border: '1px solid #E5E7EB', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)' }}
                                />
                                <Bar
                                    dataKey="count"
                                    name="Pedidos"
                                    fill="#3B82F6"
                                    radius={[6, 6, 0, 0]}
                                    maxBarSize={45}
                                />
                            </BarChart>
                        </ResponsiveContainer>
                    ) : (
                        <div className="h-full flex items-center justify-center text-gray-400 font-medium text-sm">
                            Cargando gráfico...
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
