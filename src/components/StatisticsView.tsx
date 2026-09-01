'use client'

import React, { useMemo, useState, useEffect } from 'react';
import { Order, Delivery } from '@/types';
import {
    getOrdersByBusinessComplete,
    getExpensesByBusiness,
    ExpenseEntry,
    getDeliveriesByStatus,
    getDailyVisitsForBusiness,
    DailyVisit
} from '@/lib/database';
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    Cell
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

// Helper para limpiar y normalizar texto de conceptos (elimina espacios extras, tildes, minúsculas)
const cleanConceptKey = (str: string): string => {
    if (!str) return '';
    return str
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
};

// Algoritmo de distancia Levenshtein para tolerancia a errores de tipeo (ej. Distrisabores vs Distrisavores)
const levenshteinDistance = (a: string, b: string): number => {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const matrix: number[][] = [];
    for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }
    return matrix[b.length][a.length];
};

// Determina si dos conceptos son idénticos o variaciones por tipeo
const areConceptsSimilar = (norm1: string, norm2: string): boolean => {
    if (norm1 === norm2) return true;

    const maxLen = Math.max(norm1.length, norm2.length);
    const minLen = Math.min(norm1.length, norm2.length);

    // Solo aplicar tolerancia a errores de tipeo si la palabra tiene al menos 4 caracteres
    if (minLen >= 4 && Math.abs(norm1.length - norm2.length) <= 2) {
        const dist = levenshteinDistance(norm1, norm2);
        if (maxLen >= 8 && dist <= 2) return true; // ej. Distrisabores vs Distrisavores
        if (maxLen >= 5 && dist <= 1) return true; // ej. Aceites vs Aceite
    }

    return false;
};

// Formatea el concepto para mostrar con mayúscula inicial en cada palabra
const formatConceptDisplay = (str: string): string => {
    const trimmed = str.trim().replace(/\s+/g, ' ');
    if (!trimmed) return 'Otros Gastos';
    return trimmed
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
};

export default function StatisticsView({ orders = [], businessId }: StatisticsViewProps) {
    const [dateFilter, setDateFilter] = useState<DateFilter>('today');
    const [startDate, setStartDate] = useState<string>('');
    const [endDate, setEndDate] = useState<string>('');

    const [fetchedOrders, setFetchedOrders] = useState<Order[]>([]);
    const [expenses, setExpenses] = useState<ExpenseEntry[]>([]);
    const [dailyVisits, setDailyVisits] = useState<DailyVisit[]>([]);
    const [deliveriesList, setDeliveriesList] = useState<Delivery[]>([]);
    const [loadingData, setLoadingData] = useState<boolean>(false);

    const [isMounted, setIsMounted] = useState<boolean>(false);

    useEffect(() => {
        setIsMounted(true);
    }, []);

    // Cargar repartidores / deliveries activos e inactivos para mapear nombres
    useEffect(() => {
        let isCurrent = true;
        const fetchDeliveries = async () => {
            try {
                const [activos, inactivos] = await Promise.all([
                    getDeliveriesByStatus('activo'),
                    getDeliveriesByStatus('inactivo')
                ]);
                if (isCurrent) {
                    setDeliveriesList([...(activos || []), ...(inactivos || [])]);
                }
            } catch (e) {
                console.error('Error cargando deliveries en Estadísticas:', e);
            }
        };
        fetchDeliveries();
        return () => {
            isCurrent = false;
        };
    }, []);

    // Cargar historial de órdenes, egresos y visitas de Firebase cuando existe businessId
    useEffect(() => {
        if (!businessId) return;
        let isCurrent = true;

        const fetchData = async () => {
            setLoadingData(true);
            try {
                const [history, expensesData, visitsData] = await Promise.all([
                    getOrdersByBusinessComplete(businessId),
                    getExpensesByBusiness(businessId),
                    getDailyVisitsForBusiness(businessId, 120)
                ]);
                if (isCurrent) {
                    setFetchedOrders(history || []);
                    setExpenses(expensesData || []);
                    setDailyVisits(visitsData || []);
                }
            } catch (error) {
                console.error('Error cargando historial, egresos o visitas en Estadísticas:', error);
            } finally {
                if (isCurrent) {
                    setLoadingData(false);
                }
            }
        };

        fetchData();

        return () => {
            isCurrent = false;
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

    const filteredExpenses = useMemo(() => {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const todayStr = `${year}-${month}-${day}`;

        return (expenses || []).filter(expense => {
            if (!expense || !expense.date) return false;
            const expDateStr = String(expense.date).substring(0, 10);

            switch (dateFilter) {
                case 'today':
                    return expDateStr === todayStr;

                case 'yesterday': {
                    const y = new Date(now);
                    y.setDate(y.getDate() - 1);
                    const yStr = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
                    return expDateStr === yStr;
                }

                case '7days': {
                    const d7 = new Date(now);
                    d7.setDate(d7.getDate() - 6);
                    const d7Str = `${d7.getFullYear()}-${String(d7.getMonth() + 1).padStart(2, '0')}-${String(d7.getDate()).padStart(2, '0')}`;
                    return expDateStr >= d7Str && expDateStr <= todayStr;
                }

                case '30days': {
                    const d30 = new Date(now);
                    d30.setDate(d30.getDate() - 29);
                    const d30Str = `${d30.getFullYear()}-${String(d30.getMonth() + 1).padStart(2, '0')}-${String(d30.getDate()).padStart(2, '0')}`;
                    return expDateStr >= d30Str && expDateStr <= todayStr;
                }

                case 'custom': {
                    if (!startDate || !endDate) return true;
                    return expDateStr >= startDate && expDateStr <= endDate;
                }

                default:
                    return true;
            }
        });
    }, [expenses, dateFilter, startDate, endDate]);

    const filteredVisits = useMemo(() => {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const todayStr = `${year}-${month}-${day}`;

        return (dailyVisits || []).filter(visit => {
            if (!visit || !visit.date) return false;
            const vDateStr = String(visit.date).substring(0, 10);

            switch (dateFilter) {
                case 'today':
                    return vDateStr === todayStr;

                case 'yesterday': {
                    const y = new Date(now);
                    y.setDate(y.getDate() - 1);
                    const yStr = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
                    return vDateStr === yStr;
                }

                case '7days': {
                    const d7 = new Date(now);
                    d7.setDate(d7.getDate() - 6);
                    const d7Str = `${d7.getFullYear()}-${String(d7.getMonth() + 1).padStart(2, '0')}-${String(d7.getDate()).padStart(2, '0')}`;
                    return vDateStr >= d7Str && vDateStr <= todayStr;
                }

                case '30days': {
                    const d30 = new Date(now);
                    d30.setDate(d30.getDate() - 29);
                    const d30Str = `${d30.getFullYear()}-${String(d30.getMonth() + 1).padStart(2, '0')}-${String(d30.getDate()).padStart(2, '0')}`;
                    return vDateStr >= d30Str && vDateStr <= todayStr;
                }

                case 'custom': {
                    if (!startDate || !endDate) return true;
                    return vDateStr >= startDate && vDateStr <= endDate;
                }

                default:
                    return true;
            }
        });
    }, [dailyVisits, dateFilter, startDate, endDate]);

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

        // 2. Gastos Totales y Utilidad Neta
        const totalExpensesAmount = filteredExpenses.reduce((sum, e) => sum + (Number.isFinite(e.amount) ? e.amount : 0), 0);
        const netProfit = totalStoreSales - totalExpensesAmount;

        // Desglose de Gastos por Concepto (Unificado con Limpieza y Tolerancia a Errores de Tipeo)
        const expenseConceptGroups: Array<{
            normKey: string;
            displayConcept: string;
            total: number;
            count: number;
        }> = [];

        filteredExpenses.forEach((e) => {
            const rawConcept = e.concept || 'Otros Gastos';
            const normKey = cleanConceptKey(rawConcept);

            if (!normKey) return;

            // Buscar si ya existe un grupo equivalente o similar por error de tipeo
            const existingGroup = expenseConceptGroups.find(g => areConceptsSimilar(g.normKey, normKey));

            if (existingGroup) {
                existingGroup.total += e.amount || 0;
                existingGroup.count += 1;
            } else {
                expenseConceptGroups.push({
                    normKey,
                    displayConcept: formatConceptDisplay(rawConcept),
                    total: e.amount || 0,
                    count: 1
                });
            }
        });

        const expensesByConceptList = expenseConceptGroups
            .map(g => ({
                concept: g.displayConcept,
                total: g.total,
                count: g.count
            }))
            .sort((a, b) => b.total - a.total);

        // 3. Map de deliveries por ID
        const deliveriesMap: Record<string, Delivery> = {};
        (deliveriesList || []).forEach(d => {
            if (d?.id) deliveriesMap[d.id] = d;
        });

        // 4. Desglose y Ganancias por Delivery
        const deliveryMap: Record<string, {
            id: string;
            name: string;
            ordersCount: number;
            totalSales: number;
            totalDeliveryCost: number;
            netStoreSales: number;
        }> = {};

        let totalDeliveryOrdersCount = 0;

        filteredOrders.forEach((order) => {
            const assignedId = order.delivery?.assignedDelivery || (order as any).deliveryId;
            if (!assignedId) return;

            totalDeliveryOrdersCount += 1;
            const driverName = deliveriesMap[assignedId]?.nombres || (order.delivery as any)?.driverName || (order.delivery as any)?.nombre || `Repartidor (${assignedId.slice(0, 5)})`;
            const deliveryCost = order.delivery?.deliveryCost || 0;
            const orderTotal = order.total || getOrderSubtotal(order);

            if (!deliveryMap[assignedId]) {
                deliveryMap[assignedId] = {
                    id: assignedId,
                    name: driverName,
                    ordersCount: 0,
                    totalSales: 0,
                    totalDeliveryCost: 0,
                    netStoreSales: 0
                };
            }

            deliveryMap[assignedId].ordersCount += 1;
            deliveryMap[assignedId].totalSales += orderTotal;
            deliveryMap[assignedId].totalDeliveryCost += deliveryCost;
            deliveryMap[assignedId].netStoreSales += Math.max(0, orderTotal - deliveryCost);
        });

        const deliveryStatsList = Object.values(deliveryMap).sort((a, b) => b.ordersCount - a.ordersCount);

        // 5. Cantidad de órdenes y ticket promedio
        const totalOrdersCount = filteredOrders.length;
        const averageTicket = totalOrdersCount > 0 ? (totalStoreSales / totalOrdersCount) : 0;

        // 6. Productos más vendidos (Top 5) y cantidad total de items
        let totalItemsSold = 0;
        const productSales: Record<string, { name: string; quantity: number }> = {};

        // 7. Métodos de Pago
        const paymentMap: Record<string, { label: string; count: number; total: number }> = {};

        // 8. Ventas por fecha / hora
        const salesMap = new Map<string, { label: string; timestamp: number; amount: number }>();
        const hourlySales = new Array(24).fill(0).map((_, i) => ({
            hour: `${String(i).padStart(2, '0')}:00`,
            amount: 0
        }));

        // 9. Horas pico
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

        // 10. Métricas y Gráfico de Visitas Diarias
        const totalVisitsCount = filteredVisits.reduce((sum, v) => sum + (Number.isFinite(v.count) ? v.count : 0), 0);

        let periodDaysCount = 1;
        if (dateFilter === 'today' || dateFilter === 'yesterday') {
            periodDaysCount = 1;
        } else if (dateFilter === '7days') {
            periodDaysCount = 7;
        } else if (dateFilter === '30days') {
            periodDaysCount = 30;
        } else if (dateFilter === 'custom' && startDate && endDate) {
            const startParts = startDate.split('-').map(Number);
            const endParts = endDate.split('-').map(Number);
            const s = new Date(startParts[0], startParts[1] - 1, startParts[2]);
            const e = new Date(endParts[0], endParts[1] - 1, endParts[2]);
            const diffDays = Math.ceil(Math.abs(e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1;
            periodDaysCount = Math.max(1, diffDays || 1);
        } else {
            periodDaysCount = Math.max(1, filteredVisits.length || 1);
        }

        const averageDailyVisits = Number((totalVisitsCount / periodDaysCount).toFixed(1));
        const conversionRate = totalVisitsCount > 0
            ? ((totalOrdersCount / totalVisitsCount) * 100).toFixed(1)
            : '0.0';

        // Construir datos del gráfico de visitas diarias continuo
        const visitsMap = new Map<string, number>();
        (dailyVisits || []).forEach(v => {
            if (v?.date) {
                visitsMap.set(String(v.date).substring(0, 10), v.count || 0);
            }
        });

        let visitsChartData: Array<{
            date: string;
            fullDate: string;
            visits: number;
            highlight?: boolean;
        }> = [];

        const now = new Date();

        if (dateFilter === 'today' || dateFilter === 'yesterday') {
            // Mostrar los últimos 7 días como contexto de tendencia, destacando el día seleccionado
            for (let i = 6; i >= 0; i--) {
                const d = new Date(now);
                d.setDate(d.getDate() - i);
                const y = d.getFullYear();
                const m = String(d.getMonth() + 1).padStart(2, '0');
                const dayNum = String(d.getDate()).padStart(2, '0');
                const dateKey = `${y}-${m}-${dayNum}`;
                const label = `${dayNum}/${m}`;
                const count = visitsMap.get(dateKey) || 0;

                const isTargetDay = dateFilter === 'today' ? i === 0 : i === 1;

                visitsChartData.push({
                    date: label,
                    fullDate: dateKey,
                    visits: count,
                    highlight: isTargetDay
                });
            }
        } else if (dateFilter === '7days') {
            for (let i = 6; i >= 0; i--) {
                const d = new Date(now);
                d.setDate(d.getDate() - i);
                const y = d.getFullYear();
                const m = String(d.getMonth() + 1).padStart(2, '0');
                const dayNum = String(d.getDate()).padStart(2, '0');
                const dateKey = `${y}-${m}-${dayNum}`;
                const label = `${dayNum}/${m}`;
                const count = visitsMap.get(dateKey) || 0;

                visitsChartData.push({
                    date: label,
                    fullDate: dateKey,
                    visits: count
                });
            }
        } else if (dateFilter === '30days') {
            for (let i = 29; i >= 0; i--) {
                const d = new Date(now);
                d.setDate(d.getDate() - i);
                const y = d.getFullYear();
                const m = String(d.getMonth() + 1).padStart(2, '0');
                const dayNum = String(d.getDate()).padStart(2, '0');
                const dateKey = `${y}-${m}-${dayNum}`;
                const label = `${dayNum}/${m}`;
                const count = visitsMap.get(dateKey) || 0;

                visitsChartData.push({
                    date: label,
                    fullDate: dateKey,
                    visits: count
                });
            }
        } else if (dateFilter === 'custom' && startDate && endDate) {
            const startParts = startDate.split('-').map(Number);
            const endParts = endDate.split('-').map(Number);
            const s = new Date(startParts[0], startParts[1] - 1, startParts[2]);
            const e = new Date(endParts[0], endParts[1] - 1, endParts[2]);
            const diffDays = Math.ceil(Math.abs(e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1;

            if (diffDays <= 60) {
                for (let i = 0; i < diffDays; i++) {
                    const d = new Date(s);
                    d.setDate(d.getDate() + i);
                    const y = d.getFullYear();
                    const m = String(d.getMonth() + 1).padStart(2, '0');
                    const dayNum = String(d.getDate()).padStart(2, '0');
                    const dateKey = `${y}-${m}-${dayNum}`;
                    const label = `${dayNum}/${m}`;
                    const count = visitsMap.get(dateKey) || 0;

                    visitsChartData.push({
                        date: label,
                        fullDate: dateKey,
                        visits: count
                    });
                }
            } else {
                visitsChartData = filteredVisits.map(v => {
                    const parts = v.date.split('-');
                    const label = parts.length === 3 ? `${parts[2]}/${parts[1]}` : v.date;
                    return {
                        date: label,
                        fullDate: v.date,
                        visits: v.count || 0
                    };
                });
            }
        } else {
            visitsChartData = filteredVisits.map(v => {
                const parts = v.date.split('-');
                const label = parts.length === 3 ? `${parts[2]}/${parts[1]}` : v.date;
                return {
                    date: label,
                    fullDate: v.date,
                    visits: v.count || 0
                };
            });
        }

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
            totalExpensesAmount,
            netProfit,
            totalOrdersCount,
            averageTicket,
            totalItemsSold,
            topProducts,
            paymentMethodsList,
            expensesByConceptList,
            deliveryStatsList,
            totalDeliveryOrdersCount,
            totalVisitsCount,
            averageDailyVisits,
            conversionRate,
            visitsChartData,
            chartData,
            ordersByHour,
            isSingleDay
        };
    }, [filteredOrders, filteredExpenses, filteredVisits, dailyVisits, deliveriesList, dateFilter, startDate, endDate]);

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
                        Resumen de rendimiento, ventas, gastos y entregas por delivery.
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

            {/* Indicador de carga */}
            {loadingData && (
                <div className="flex items-center justify-between bg-blue-50/80 border border-blue-200 px-4 py-3 rounded-xl text-blue-800 text-xs font-medium animate-pulse">
                    <div className="flex items-center gap-2">
                        <span className="material-symbols-rounded text-base animate-spin">sync</span>
                        Cargando estadísticas y datos de gastos...
                    </div>
                </div>
            )}

            {/* Tarjeta Unificada: Balance Financiero (Ventas, Gastos y Ganancia) */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
                <div className="flex items-center justify-between mb-6 pb-4 border-b border-gray-100">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                            <span className="material-symbols-rounded text-2xl">account_balance</span>
                        </div>
                        <div>
                            <h3 className="text-lg font-black text-gray-900 tracking-tight leading-none">Resumen Financiero</h3>
                            <p className="text-xs font-medium text-gray-500 mt-1">Balance de Ingresos, Egresos y Resultado Neto</p>
                        </div>
                    </div>
                    <span className="text-xs font-bold text-gray-400">
                        {dateFilter === 'today' ? 'Hoy' : dateFilter === 'yesterday' ? 'Ayer' : dateFilter === '7days' ? 'Últimos 7 Días' : dateFilter === '30days' ? 'Últimos 30 Días' : 'Personalizado'}
                    </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 divide-y md:divide-y-0 md:divide-x divide-gray-100">
                    {/* Ventas Totales */}
                    <div className="flex flex-col justify-between pt-4 md:pt-0 md:pr-4">
                        <div className="flex items-center gap-2 mb-2">
                            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                            <span className="text-xs font-bold uppercase tracking-wider text-gray-500">Ventas Totales</span>
                        </div>
                        <div className="text-3xl font-black text-emerald-600 tracking-tight leading-tight">
                            ${stats.totalStoreSales.toFixed(2)}
                        </div>
                        <div className="text-xs text-gray-500 font-medium mt-2 flex justify-between items-center">
                            <span>Público (Cliente):</span>
                            <span className="font-bold text-gray-800">${stats.totalPublicSales.toFixed(2)}</span>
                        </div>
                    </div>

                    {/* Total Gastos */}
                    <div className="flex flex-col justify-between pt-4 md:pt-0 md:px-4">
                        <div className="flex items-center gap-2 mb-2">
                            <span className="w-2.5 h-2.5 rounded-full bg-rose-500"></span>
                            <span className="text-xs font-bold uppercase tracking-wider text-gray-500">Total Gastos</span>
                        </div>
                        <div className="text-3xl font-black text-rose-600 tracking-tight leading-tight">
                            ${stats.totalExpensesAmount.toFixed(2)}
                        </div>
                        <div className="text-xs text-gray-500 font-medium mt-2 flex justify-between items-center">
                            <span>Egresos Registrados:</span>
                            <span className="font-bold text-gray-800">{filteredExpenses.length} registros</span>
                        </div>
                    </div>

                    {/* Ganancia Estimada */}
                    <div className="flex flex-col justify-between pt-4 md:pt-0 md:pl-4">
                        <div className="flex items-center gap-2 mb-2">
                            <span className={`w-2.5 h-2.5 rounded-full ${stats.netProfit >= 0 ? 'bg-indigo-500' : 'bg-red-500'}`}></span>
                            <span className="text-xs font-bold uppercase tracking-wider text-gray-500">Ganancia Neta</span>
                        </div>
                        <div className={`text-3xl font-black tracking-tight leading-tight ${stats.netProfit >= 0 ? 'text-indigo-600' : 'text-red-600'}`}>
                            ${stats.netProfit.toFixed(2)}
                        </div>
                        <div className="text-xs text-gray-500 font-medium mt-2 flex justify-between items-center">
                            <span>Resultado:</span>
                            <span className="font-bold text-gray-800">Ventas - Gastos</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Tarjeta Unificada: Resumen Operativo (Total Pedidos, Productos Vendidos y Ticket Promedio) */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
                <div className="flex items-center justify-between mb-6 pb-4 border-b border-gray-100">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                            <span className="material-symbols-rounded text-2xl">orders</span>
                        </div>
                        <div>
                            <h3 className="text-lg font-black text-gray-900 tracking-tight leading-none">Resumen Operativo</h3>
                            <p className="text-xs font-medium text-gray-500 mt-1">Métricas clave de volumen y rendimiento de pedidos</p>
                        </div>
                    </div>
                    <span className="text-xs font-bold text-gray-400">
                        {stats.totalOrdersCount} {stats.totalOrdersCount === 1 ? 'pedido' : 'pedidos'}
                    </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 divide-y md:divide-y-0 md:divide-x divide-gray-100">
                    {/* Total Pedidos */}
                    <div className="flex flex-col justify-between pt-4 md:pt-0 md:pr-4">
                        <div className="flex items-center gap-2 mb-2">
                            <span className="w-2.5 h-2.5 rounded-full bg-blue-500"></span>
                            <span className="text-xs font-bold uppercase tracking-wider text-gray-500">Total Pedidos</span>
                        </div>
                        <div className="text-3xl font-black text-blue-600 tracking-tight leading-tight">
                            {stats.totalOrdersCount}
                        </div>
                        <div className="text-xs text-gray-500 font-medium mt-2">
                            Pedidos procesados en el periodo
                        </div>
                    </div>

                    {/* Productos Vendidos */}
                    <div className="flex flex-col justify-between pt-4 md:pt-0 md:px-4">
                        <div className="flex items-center gap-2 mb-2">
                            <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
                            <span className="text-xs font-bold uppercase tracking-wider text-gray-500">Productos Vendidos</span>
                        </div>
                        <div className="text-3xl font-black text-amber-600 tracking-tight leading-tight">
                            {stats.totalItemsSold}
                        </div>
                        <div className="text-xs text-gray-500 font-medium mt-2">
                            Unidades totales entregadas
                        </div>
                    </div>

                    {/* Ticket Promedio */}
                    <div className="flex flex-col justify-between pt-4 md:pt-0 md:pl-4">
                        <div className="flex items-center gap-2 mb-2">
                            <span className="w-2.5 h-2.5 rounded-full bg-purple-500"></span>
                            <span className="text-xs font-bold uppercase tracking-wider text-gray-500">Ticket Promedio</span>
                        </div>
                        <div className="text-3xl font-black text-purple-600 tracking-tight leading-tight">
                            ${stats.averageTicket.toFixed(2)}
                        </div>
                        <div className="text-xs text-gray-500 font-medium mt-2">
                            Promedio gastado por cada pedido
                        </div>
                    </div>
                </div>
            </div>

            {/* Tarjeta Unificada: Tráfico y Visitas a la Tienda */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
                <div className="flex items-center justify-between mb-6 pb-4 border-b border-gray-100">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                            <span className="material-symbols-rounded text-2xl">visibility</span>
                        </div>
                        <div>
                            <h3 className="text-lg font-black text-gray-900 tracking-tight leading-none">Tráfico y Visitas</h3>
                            <p className="text-xs font-medium text-gray-500 mt-1">Interacción de clientes con tu catálogo y tienda online</p>
                        </div>
                    </div>
                    <span className="text-xs font-bold text-gray-400">
                        {stats.totalVisitsCount} {stats.totalVisitsCount === 1 ? 'visita' : 'visitas'}
                    </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 divide-y md:divide-y-0 md:divide-x divide-gray-100">
                    {/* Total Visitas */}
                    <div className="flex flex-col justify-between pt-4 md:pt-0 md:pr-4">
                        <div className="flex items-center gap-2 mb-2">
                            <span className="w-2.5 h-2.5 rounded-full bg-indigo-500"></span>
                            <span className="text-xs font-bold uppercase tracking-wider text-gray-500">
                                {dateFilter === 'today' ? 'Visitas Hoy' : dateFilter === 'yesterday' ? 'Visitas Ayer' : 'Total Visitas'}
                            </span>
                        </div>
                        <div className="text-3xl font-black text-indigo-600 tracking-tight leading-tight flex items-baseline gap-2">
                            {stats.totalVisitsCount}
                            <span className="text-xs font-bold text-gray-400">vistas</span>
                        </div>
                        <div className="text-xs text-gray-500 font-medium mt-2">
                            {dateFilter === 'today' ? 'Clientes que vieron tu tienda hoy' : 'Total de visitas en el periodo'}
                        </div>
                    </div>

                    {/* Promedio Diario */}
                    <div className="flex flex-col justify-between pt-4 md:pt-0 md:px-4">
                        <div className="flex items-center gap-2 mb-2">
                            <span className="w-2.5 h-2.5 rounded-full bg-sky-500"></span>
                            <span className="text-xs font-bold uppercase tracking-wider text-gray-500">Promedio Diario</span>
                        </div>
                        <div className="text-3xl font-black text-sky-600 tracking-tight leading-tight flex items-baseline gap-2">
                            {stats.averageDailyVisits}
                            <span className="text-xs font-bold text-gray-400">visitas / día</span>
                        </div>
                        <div className="text-xs text-gray-500 font-medium mt-2">
                            Flujo diario promedio de navegación
                        </div>
                    </div>

                    {/* Conversión Pedidos / Visitas */}
                    <div className="flex flex-col justify-between pt-4 md:pt-0 md:pl-4">
                        <div className="flex items-center gap-2 mb-2">
                            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                            <span className="text-xs font-bold uppercase tracking-wider text-gray-500">Conversión a Pedidos</span>
                        </div>
                        <div className="text-3xl font-black text-emerald-600 tracking-tight leading-tight flex items-baseline gap-2">
                            {stats.conversionRate}%
                        </div>
                        <div className="text-xs text-gray-500 font-medium mt-2">
                            {stats.totalOrdersCount} pedidos de {stats.totalVisitsCount} visitas
                        </div>
                    </div>
                </div>
            </div>

            {/* Fila Central: Top Productos, Métodos de Pago & Desglose de Gastos */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
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

                {/* Desglose de Gastos por Concepto */}
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 flex flex-col justify-between md:col-span-2 lg:col-span-1">
                    <div>
                        <div className="flex items-center justify-between mb-5">
                            <div>
                                <h3 className="text-lg font-black text-gray-900 tracking-tight leading-tight">Gastos por Concepto</h3>
                                <p className="text-xs font-medium text-gray-500 leading-relaxed">Categorías de egresos en este periodo</p>
                            </div>
                            <div className="p-2.5 bg-rose-100 text-rose-700 rounded-xl">
                                <span className="material-symbols-rounded text-xl">shopping_bag</span>
                            </div>
                        </div>

                        <div className="space-y-3.5">
                            {stats.expensesByConceptList.length > 0 ? (
                                stats.expensesByConceptList.map((item, index) => {
                                    const percentage = stats.totalExpensesAmount > 0
                                        ? Math.round((item.total / stats.totalExpensesAmount) * 100)
                                        : 0;
                                    return (
                                        <div key={index} className="p-2.5 rounded-xl hover:bg-gray-50 transition-colors">
                                            <div className="flex justify-between items-center mb-1.5">
                                                <span className="text-sm font-bold text-gray-900 truncate max-w-[160px]" title={item.concept}>
                                                    {item.concept}
                                                </span>
                                                <div className="text-right">
                                                    <span className="text-xs font-black text-rose-600">${item.total.toFixed(2)}</span>
                                                    <span className="text-[11px] font-semibold text-gray-500 ml-2">({percentage}%)</span>
                                                </div>
                                            </div>
                                            <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden">
                                                <div
                                                    className="bg-rose-500 h-full rounded-full transition-all duration-500"
                                                    style={{ width: `${percentage}%` }}
                                                />
                                            </div>
                                        </div>
                                    );
                                })
                            ) : (
                                <div className="text-center py-8 text-gray-400 text-sm font-medium">
                                    No hay egresos registrados en este periodo
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Resumen de Ganancias y Entregas por Delivery */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
                <div className="flex items-center justify-between mb-5 pb-4 border-b border-gray-100">
                    <div>
                        <h3 className="text-xl font-black text-gray-900 tracking-tight leading-tight flex items-center gap-2">
                            <span className="material-symbols-rounded text-sky-600">local_shipping</span>
                            Resumen y Ganancias por Delivery
                        </h3>
                        <p className="text-xs font-medium text-gray-500 leading-relaxed mt-0.5">
                            Rendimiento de entregas, costo de envío acumulado y ventas por repartidor
                        </p>
                    </div>
                    {stats.totalDeliveryOrdersCount > 0 && (
                        <span className="px-3 py-1 bg-sky-50 text-sky-700 font-bold text-xs rounded-full border border-sky-200">
                            {stats.totalDeliveryOrdersCount} {stats.totalDeliveryOrdersCount === 1 ? 'entrega' : 'entregas'} en total
                        </span>
                    )}
                </div>

                {stats.deliveryStatsList.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {stats.deliveryStatsList.map((driver, index) => {
                            const pct = stats.totalDeliveryOrdersCount > 0
                                ? Math.round((driver.ordersCount / stats.totalDeliveryOrdersCount) * 100)
                                : 0;
                            return (
                                <div key={driver.id || index} className="p-4 rounded-xl border border-gray-100 bg-gray-50/50 hover:bg-white hover:border-sky-200 hover:shadow-sm transition-all space-y-3">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2.5 min-w-0">
                                            <div className="w-8 h-8 rounded-lg bg-sky-100 text-sky-700 flex items-center justify-center font-bold shrink-0 text-sm">
                                                <span className="material-symbols-rounded text-base">directions_bike</span>
                                            </div>
                                            <span className="font-bold text-gray-900 text-sm truncate" title={driver.name}>
                                                {driver.name}
                                            </span>
                                        </div>
                                        <span className="px-2.5 py-0.5 bg-sky-100 text-sky-800 text-xs font-black rounded-md">
                                            {driver.ordersCount} {driver.ordersCount === 1 ? 'ped.' : 'peds.'}
                                        </span>
                                    </div>

                                    <div className="grid grid-cols-2 gap-2 pt-1 border-t border-gray-200/60">
                                        <div>
                                            <span className="text-[10px] font-bold text-gray-600 uppercase tracking-wider block">Costo Envío</span>
                                            <span className="text-sm font-black text-sky-600">${driver.totalDeliveryCost.toFixed(2)}</span>
                                        </div>
                                        <div>
                                            <span className="text-[10px] font-bold text-gray-600 uppercase tracking-wider block">Ventas Pedidos</span>
                                            <span className="text-sm font-black text-gray-900">${driver.totalSales.toFixed(2)}</span>
                                        </div>
                                    </div>

                                    <div>
                                        <div className="flex justify-between items-center text-[11px] font-semibold text-gray-500 mb-1">
                                            <span>Participación</span>
                                            <span className="font-bold text-sky-700">{pct}%</span>
                                        </div>
                                        <div className="w-full bg-gray-200 h-1.5 rounded-full overflow-hidden">
                                            <div
                                                className="bg-sky-500 h-full rounded-full transition-all duration-500"
                                                style={{ width: `${pct}%` }}
                                            />
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="text-center py-8 text-gray-400 text-sm font-medium">
                        No hay entregas asignadas a repartidores en este período
                    </div>
                )}
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

            {/* Gráfico de Visitas Diarias */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
                <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                        <h3 className="text-xl font-black text-gray-900 tracking-tight leading-tight flex items-center gap-2">
                            <span className="material-symbols-rounded text-indigo-600">bar_chart</span>
                            Visitas Diarias a la Tienda
                        </h3>
                        <p className="text-xs font-medium text-gray-500 leading-relaxed mt-0.5">
                            {stats.isSingleDay
                                ? `Historial reciente de visitas (destacado: ${dateFilter === 'today' ? 'Hoy' : 'Ayer'} con ${stats.totalVisitsCount} visitas)`
                                : 'Tendencia y flujo de clientes que visitan tu tienda por fecha'}
                        </p>
                    </div>
                    <div className="flex items-center gap-2 self-start sm:self-auto">
                        <span className="px-3 py-1 bg-indigo-50 text-indigo-700 font-bold text-xs rounded-full border border-indigo-200 flex items-center gap-1.5">
                            <i className="bi bi-people text-xs"></i>
                            {stats.totalVisitsCount} {stats.totalVisitsCount === 1 ? 'visita' : 'visitas'} {stats.isSingleDay ? (dateFilter === 'today' ? 'hoy' : 'ayer') : 'en periodo'}
                        </span>
                    </div>
                </div>
                <div className="h-[300px] w-full">
                    {isMounted && stats.visitsChartData.length > 0 ? (
                        <ResponsiveContainer width="100%" height={300} minWidth={0} minHeight={300}>
                            <BarChart data={stats.visitsChartData}>
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
                                    allowDecimals={false}
                                />
                                <Tooltip
                                    cursor={{ fill: '#F3F4F6' }}
                                    contentStyle={{ borderRadius: '12px', border: '1px solid #E5E7EB', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)' }}
                                    formatter={(value?: number) => [`${value || 0} visitas`, 'Visitas']}
                                    labelFormatter={(label, payload) => {
                                        const fullDate = payload?.[0]?.payload?.fullDate;
                                        return fullDate ? `Fecha: ${fullDate}` : `Día: ${label}`;
                                    }}
                                />
                                <Bar
                                    dataKey="visits"
                                    name="Visitas"
                                    radius={[6, 6, 0, 0]}
                                    maxBarSize={45}
                                >
                                    {stats.visitsChartData.map((entry, index) => (
                                        <Cell
                                            key={`cell-visit-${index}`}
                                            fill={entry.highlight ? '#4338CA' : '#6366F1'}
                                        />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    ) : (
                        <div className="h-full flex items-center justify-center text-gray-400 font-medium text-sm">
                            No hay datos de visitas registrados para mostrar
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
