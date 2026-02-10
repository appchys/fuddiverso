import React, { useMemo } from 'react';
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

export default function StatisticsView({ orders }: StatisticsViewProps) {
    const stats = useMemo(() => {
        // Filtrar órdenes válidas (no canceladas)
        const validOrders = orders.filter(
            (order) => order.status !== 'cancelled'
        );

        // Debug counters
        let debugTotalItems = 0;
        let debugSkippedPrice0 = 0;
        let debugSkippedNoProduct = 0;
        let debugProcessed = 0;
        let debugSampleInvalidItems: any[] = [];

        // 1. Monto total de venta
        const totalSales = validOrders.reduce((sum, order) => sum + order.total, 0);

        // 2. Cantidad de órdenes
        const totalOrdersCount = validOrders.length;

        // 3. Producto más vendido (Top 5)
        const productSales: Record<string, { name: string; quantity: number }> = {};

        // 4. Datos para el gráfico (ventas por fecha)
        const salesByDate: Record<string, number> = {};

        validOrders.forEach((order) => {
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
                // Obtener fecha segura
                let orderDate: Date;
                if (order.createdAt instanceof Date) {
                    orderDate = order.createdAt;
                } else if ((order.createdAt as any)?.toDate) {
                    orderDate = (order.createdAt as any).toDate();
                } else {
                    orderDate = new Date(order.createdAt as any);
                }

                if (!isNaN(orderDate.getTime())) {
                    const dateKey = orderDate.toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit' });
                    salesByDate[dateKey] = (salesByDate[dateKey] || 0) + order.total;
                }
            } catch (e) {
                console.warn('Error processing order date:', e);
            }
        });

        // Obtener Top 5 productos
        const topProducts = Object.values(productSales)
            .sort((a, b) => b.quantity - a.quantity)
            .slice(0, 5);

        // Convertir salesByDate a array para rechart y ordenar por fecha (aproximado por string DD/MM)
        // Nota: para un ordenamiento estricto necesitaríamos guardar el timestamp, pero para visualización simple esto suele bastar
        // si son fechas cercanas. Mejor hacemos un top 7 o últimos 7 días.

        const chartData = Object.entries(salesByDate).map(([date, amount]) => ({
            date,
            amount: parseFloat(amount.toFixed(2))
        }));

        // Ordenar un poco mejor si es posible, o dejar como vienen (cronológico si la DB las trae así)
        // Asumiremos que el orden de iteración coincide aprox, o podríamos ordenar por fecha real si guardamos timestamp.
        // Por simplicidad en este paso, lo dejamos así.

        return {
            totalSales,
            totalOrdersCount,
            topProducts,
            chartData,
            debug: {
                totalOrders: orders.length,
                validOrders: validOrders.length,
                totalItems: debugTotalItems,
                skippedPrice0: debugSkippedPrice0,
                skippedNoProduct: debugSkippedNoProduct,
                processedItems: debugProcessed,
                sampleInvalidItems: debugSampleInvalidItems
            }
        };
    }, [orders]);

    return (
        <div className="space-y-6 animate-fade-in">
            <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold text-gray-800">Estadísticas</h2>
            </div>

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
                        Ingresos brutos acumulados
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
                        Pedidos realizados (excluye cancelados)
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

            {/* Gráfico de Ventas */}
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

            {/* Debug Info */}
            <div className="mt-8 p-4 bg-gray-50 rounded-lg text-xs font-mono text-gray-500 border border-gray-200">
                <p className="font-semibold mb-2">Debug Info (Solo Desarrollo):</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    <p>Total Ordenes Recibidas: {stats.debug.totalOrders}</p>
                    <p>Ordenes Válidas: {stats.debug.validOrders}</p>
                    <p>Items Totales: {stats.debug.totalItems}</p>
                    <p>Items Procesados: {stats.debug.processedItems}</p>
                    <p>Omitidos (Precio 0): {stats.debug.skippedPrice0}</p>
                    <p>Omitidos (Error): {stats.debug.skippedNoProduct}</p>
                </div>
                {stats.debug.sampleInvalidItems.length > 0 && (
                    <div className="mt-4">
                        <p className="font-semibold mb-2">Muestra de Items Inválidos:</p>
                        <pre className="whitespace-pre-wrap break-all text-[10px] bg-white p-2 rounded border">
                            {JSON.stringify(stats.debug.sampleInvalidItems, null, 2)}
                        </pre>
                    </div>
                )}
            </div>
        </div>
    );
}
