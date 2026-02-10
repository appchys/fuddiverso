import React, { useMemo, useState } from 'react';
import { Order } from '@/types';
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
            }
        }

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
    // Si existe subtotal explicito, usarlo
    if (typeof order.subtotal === 'number') return order.subtotal;

    // Si no, intentar calcular restando envío
    const deliveryCost = order.delivery?.deliveryCost || 0;
    const calculated = order.total - deliveryCost;

    // Si falla (ej: datos antiguos), recurrir a sumar items si es posible, o devolver total
    if (isNaN(calculated)) return order.total || 0;

    return Math.max(0, calculated);
};

export default function StatisticsView({ orders }: StatisticsViewProps) {
    const [dateFilter, setDateFilter] = useState<DateFilter>('today');
    const [startDate, setStartDate] = useState<string>('');
    const [endDate, setEndDate] = useState<string>('');

    const filteredOrders = useMemo(() => {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        return orders.filter(order => {
            if (order.status === 'cancelled') return false;

            const orderDate = getEffectiveDate(order);

            if (isNaN(orderDate.getTime())) return false;

            // Normalizar fecha de la orden (sin hora) para comparaciones de días completos
            const orderDateOnly = new Date(orderDate.getFullYear(), orderDate.getMonth(), orderDate.getDate());

            switch (dateFilter) {
                case 'today':
                    return orderDateOnly.getTime() === today.getTime();

                case 'yesterday':
                    const yesterday = new Date(today);
                    yesterday.setDate(yesterday.getDate() - 1);
                    return orderDateOnly.getTime() === yesterday.getTime();

                case '7days':
                    const sevenDaysAgo = new Date(today);
                    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6); // Incluye hoy
                    return orderDateOnly >= sevenDaysAgo && orderDateOnly <= today;

                case '30days':
                    const thirtyDaysAgo = new Date(today);
                    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29); // Incluye hoy
                    return orderDateOnly >= thirtyDaysAgo && orderDateOnly <= today;

                case 'custom':
                    if (!startDate || !endDate) return true; // Mostrar todo si no hay rango completo

                    const startParts = startDate.split('-').map(Number);
                    const endParts = endDate.split('-').map(Number);

                    // Crear fechas locales explícitamente year, monthIndex (0-11), day
                    const start = new Date(startParts[0], startParts[1] - 1, startParts[2]);
                    const end = new Date(endParts[0], endParts[1] - 1, endParts[2]);

                    return orderDateOnly >= start && orderDateOnly <= end;

                default:
                    return true;
            }
        });
    }, [orders, dateFilter, startDate, endDate]);

    const stats = useMemo(() => {
        // Debug counters
        let debugTotalItems = 0;
        let debugSkippedPrice0 = 0;
        let debugSkippedNoProduct = 0;
        let debugProcessed = 0;
        let debugSampleInvalidItems: any[] = [];

        // 1. Monto total de venta (Subtotal)
        const totalSales = filteredOrders.reduce((sum, order) => sum + getOrderSubtotal(order), 0);

        // 2. Cantidad de órdenes
        const totalOrdersCount = filteredOrders.length;

        // 3. Producto más vendido (Top 5)
        const productSales: Record<string, { name: string; quantity: number }> = {};

        // 4. Datos para el gráfico (ventas por fecha)
        // Usamos un Map para acumular por día único (YYYY-MM-DD) y luego ordenar
        const salesMap = new Map<string, { label: string; timestamp: number; amount: number }>();

        // 5. Datos para horas pico
        const ordersByHour = new Array(24).fill(0).map((_, i) => ({
            hour: `${String(i).padStart(2, '0')}:00`,
            count: 0
        }));

        filteredOrders.forEach((order) => {
            // Procesar productos
            order.items?.forEach((item) => {
                debugTotalItems++;

                // Normalizar datos del producto (soporte para estructura antigua y nueva)
                const itemAny = item as any;
                const productId = itemAny.productId || item.product?.id;
                const productName = itemAny.name || item.product?.name || 'Producto desconocido';
                // El precio puede estar en item.price (estructura antigua/simple) o item.product.price (referencia completa)
                const price = typeof itemAny.price === 'number' ? itemAny.price : item.product?.price;

                // Validación básica
                if (!productId) {
                    debugSkippedNoProduct++;
                    if (debugSampleInvalidItems.length < 3) {
                        debugSampleInvalidItems.push(item);
                    }
                    return;
                }

                // Excluir productos regalo (precio 0)
                if (price === 0) {
                    debugSkippedPrice0++;
                    return;
                }

                debugProcessed++;

                if (!productSales[productId]) {
                    productSales[productId] = {
                        name: productName,
                        quantity: 0,
                    };
                }
                productSales[productId].quantity += (item.quantity || 1);
            });

            // Procesar ventas por fecha
            try {
                // Obtener fecha efectiva (programada o creación)
                const orderDate = getEffectiveDate(order);

                if (!isNaN(orderDate.getTime())) {
                    // Clave única por día (YYYY-MM-DD) para evitar colisiones anuales
                    const year = orderDate.getFullYear();
                    const month = String(orderDate.getMonth() + 1).padStart(2, '0');
                    const day = String(orderDate.getDate()).padStart(2, '0');
                    const dateKey = `${year}-${month}-${day}`;

                    // Etiqueta visual amigable (DD/MM)
                    const label = `${day}/${month}`;

                    // Timestamp de inicio del día para ordenar
                    const dayStartTimestamp = new Date(year, orderDate.getMonth(), orderDate.getDate()).getTime();

                    const current = salesMap.get(dateKey) || { label, timestamp: dayStartTimestamp, amount: 0 };

                    // Usar subtotal en lugar de total
                    current.amount += getOrderSubtotal(order);

                    salesMap.set(dateKey, current);

                    // Agregar a horas pico
                    const hour = orderDate.getHours();
                    if (ordersByHour[hour]) {
                        ordersByHour[hour].count++;
                    }
                }
            } catch (e) {
                console.warn('Error processing order date:', e);
            }
        });

        // Obtener Top 5 productos
        const topProducts = Object.values(productSales)
            .sort((a, b) => b.quantity - a.quantity)
            .slice(0, 5);

        // Convertir salesMap a array y ordenar cronológicamente
        const chartData = Array.from(salesMap.values())
            .sort((a, b) => a.timestamp - b.timestamp)
            .map(item => ({
                date: item.label,
                amount: parseFloat(item.amount.toFixed(2))
            }));

        // Ordenar un poco mejor si es posible, o dejar como vienen (cronológico si la DB las trae así)
        // Asumiremos que el orden de iteración coincide aprox, o podríamos ordenar por fecha real si guardamos timestamp.
        // Por simplicidad en este paso, lo dejamos así.

        return {
            totalSales,
            totalOrdersCount,
            topProducts,
            chartData,
            ordersByHour,
            debug: {
                totalOrders: orders.length,
                filteredOrders: filteredOrders.length,
                totalItems: debugTotalItems,
                skippedPrice0: debugSkippedPrice0,
                skippedNoProduct: debugSkippedNoProduct,
                processedItems: debugProcessed,
                sampleInvalidItems: debugSampleInvalidItems
            }
        };
    }, [orders, filteredOrders]);

    return (
        <div className="space-y-6 animate-fade-in">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <h2 className="text-2xl font-bold text-gray-800">Estadísticas</h2>

                {/* Filtros de Fecha */}
                <div className="flex flex-wrap items-center gap-2 bg-gray-100 p-1.5 rounded-xl">
                    <button
                        onClick={() => setDateFilter('today')}
                        className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-all ${dateFilter === 'today'
                            ? 'bg-white text-gray-900 shadow-sm'
                            : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200'
                            }`}
                    >
                        Hoy
                    </button>
                    <button
                        onClick={() => setDateFilter('yesterday')}
                        className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-all ${dateFilter === 'yesterday'
                            ? 'bg-white text-gray-900 shadow-sm'
                            : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200'
                            }`}
                    >
                        Ayer
                    </button>
                    <button
                        onClick={() => setDateFilter('7days')}
                        className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-all ${dateFilter === '7days'
                            ? 'bg-white text-gray-900 shadow-sm'
                            : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200'
                            }`}
                    >
                        7 Días
                    </button>
                    <button
                        onClick={() => setDateFilter('30days')}
                        className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-all ${dateFilter === '30days'
                            ? 'bg-white text-gray-900 shadow-sm'
                            : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200'
                            }`}
                    >
                        30 Días
                    </button>
                    <button
                        onClick={() => setDateFilter('custom')}
                        className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-all ${dateFilter === 'custom'
                            ? 'bg-white text-gray-900 shadow-sm'
                            : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200'
                            }`}
                    >
                        Personalizado
                    </button>
                </div>
            </div>

            {/* Selector de Rango Personalizado */}
            {dateFilter === 'custom' && (
                <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-wrap items-center gap-4 animate-in fade-in slide-in-from-top-2">
                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-semibold text-gray-500 uppercase">Desde</label>
                        <input
                            type="date"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                            className="bg-gray-50 border border-gray-200 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5"
                        />
                    </div>
                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-semibold text-gray-500 uppercase">Hasta</label>
                        <input
                            type="date"
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                            className="bg-gray-50 border border-gray-200 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5"
                        />
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Card: Monto Total */}
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                    <div className="flex items-center gap-4 mb-4">
                        <div className="p-3 bg-green-100 text-green-600 rounded-lg">
                            <i className="bi bi-currency-dollar text-xl"></i>
                        </div>
                        <h3 className="text-gray-500 font-medium text-sm">Ventas Totales</h3>
                    </div>
                    <div className="text-3xl font-bold text-gray-900">
                        ${stats.totalSales.toFixed(2)}
                    </div>
                    <p className="text-sm text-gray-400 mt-1">
                        Ingresos del periodo seleccionado
                    </p>
                </div>

                {/* Card: Cantidad de Órdenes */}
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                    <div className="flex items-center gap-4 mb-4">
                        <div className="p-3 bg-blue-100 text-blue-600 rounded-lg">
                            <i className="bi bi-receipt text-xl"></i>
                        </div>
                        <h3 className="text-gray-500 font-medium text-sm">Total Pedidos</h3>
                    </div>
                    <div className="text-3xl font-bold text-gray-900">
                        {stats.totalOrdersCount}
                    </div>
                    <p className="text-sm text-gray-400 mt-1">
                        Pedidos realizados en el periodo
                    </p>
                </div>

                {/* Card: Top Productos */}
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 row-span-2 md:row-span-1">
                    <div className="flex items-center gap-4 mb-4">
                        <div className="p-3 bg-orange-100 text-orange-600 rounded-lg">
                            <i className="bi bi-trophy text-xl"></i>
                        </div>
                        <h3 className="text-gray-500 font-medium text-sm">Top 5 Más Vendidos</h3>
                    </div>

                    <div className="space-y-3">
                        {stats.topProducts.length > 0 ? (
                            stats.topProducts.map((product, index) => (
                                <div key={index} className="flex justify-between items-center">
                                    <div className="flex items-center gap-2">
                                        <span className={`
                                            w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold
                                            ${index === 0 ? 'bg-yellow-100 text-yellow-700' :
                                                index === 1 ? 'bg-gray-100 text-gray-700' :
                                                    index === 2 ? 'bg-orange-100 text-orange-700' : 'bg-gray-50 text-gray-500'}
                                        `}>
                                            {index + 1}
                                        </span>
                                        <span className="text-sm font-medium text-gray-900 line-clamp-1" title={product.name}>
                                            {product.name}
                                        </span>
                                    </div>
                                    <span className="text-sm font-semibold text-gray-600">
                                        {product.quantity}
                                    </span>
                                </div>
                            ))
                        ) : (
                            <div className="text-center py-4 text-gray-400 text-sm">
                                No hay datos de ventas
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Gráfico de Ventas - Solo mostrar si NO es hoy ni ayer */}
            {!['today', 'yesterday'].includes(dateFilter) && (
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                    <div className="mb-6">
                        <h3 className="text-lg font-bold text-gray-800">Ventas por Fecha</h3>
                    </div>
                    <div className="h-[300px] w-full">
                        {stats.chartData.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={stats.chartData}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                    <XAxis
                                        dataKey="date"
                                        tick={{ fontSize: 12, fill: '#6B7280' }}
                                        axisLine={false}
                                        tickLine={false}
                                    />
                                    <YAxis
                                        tick={{ fontSize: 12, fill: '#6B7280' }}
                                        axisLine={false}
                                        tickLine={false}
                                        tickFormatter={(value) => `$${value}`}
                                    />
                                    <Tooltip
                                        cursor={{ fill: '#F3F4F6' }}
                                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}
                                        formatter={(value?: number) => [`$${(value || 0).toFixed(2)}`, 'Ventas']}

                                    />
                                    <Bar
                                        dataKey="amount"
                                        fill="#EF4444"
                                        radius={[4, 4, 0, 0]}
                                        maxBarSize={50}
                                    />
                                </BarChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="h-full flex items-center justify-center text-gray-400">
                                No hay datos suficientes para mostrar el gráfico
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Gráfico de Horas Pico */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 mt-6">
                <div className="mb-6">
                    <h3 className="text-lg font-bold text-gray-800">Horas Con Más Pedidos</h3>
                    <p className="text-sm text-gray-400">Distribución de pedidos por hora (según hora programada)</p>
                </div>
                <div className="h-[300px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={stats.ordersByHour}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} />
                            <XAxis
                                dataKey="hour"
                                tick={{ fontSize: 12, fill: '#6B7280' }}
                                axisLine={false}
                                tickLine={false}
                                interval={3}
                            />
                            <YAxis
                                tick={{ fontSize: 12, fill: '#6B7280' }}
                                axisLine={false}
                                tickLine={false}
                                allowDecimals={false}
                            />
                            <Tooltip
                                cursor={{ fill: '#F3F4F6' }}
                                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}
                            />
                            <Bar
                                dataKey="count"
                                name="Pedidos"
                                fill="#3B82F6"
                                radius={[4, 4, 0, 0]}
                                maxBarSize={50}
                            />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>


        </div>
    );
}
