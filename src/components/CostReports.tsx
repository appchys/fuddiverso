'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { Business, Order, Delivery } from '@/types'
import { calculateCostReport, CostReport, getOrdersByBusiness, getDeliveriesByStatus, getExpensesByBusiness, ExpenseEntry, createExpense, deleteExpense } from '@/lib/database'

interface CostReportsProps {
  business: Business | null
}

type ReportType = 'costs' | 'deliveries' | 'general'

interface DeliveryEarnings {
  name: string;
  amount: number;
  id: string;
}

interface DeliveryReport {
  deliveryId: string
  deliveryName: string
  totalOrders: number
  cashCollected: number
  transferCollected: number
  totalCollected: number
  deliveryEarnings: number
  averageDeliveryTime: number
  orders: Order[]
}

// Helper function para obtener la fecha actual en Ecuador (UTC-5)
const getEcuadorDate = () => {
  const now = new Date()
  // Convertir a UTC-5 (Ecuador)
  const ecuadorDate = new Date(now.getTime() - (5 * 60 * 60 * 1000))
  return ecuadorDate.toISOString().split('T')[0]
}

export default function CostReports({ business }: CostReportsProps) {
  const [report, setReport] = useState<CostReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [dateRange, setDateRange] = useState<'today' | 'week' | 'month' | 'custom'>('today')
  const [customStartDate, setCustomStartDate] = useState('')
  const [customEndDate, setCustomEndDate] = useState('')
  const [expandedIngredient, setExpandedIngredient] = useState<string | null>(null)
  const [reportType, setReportType] = useState<ReportType>('general')
  const [deliveries, setDeliveries] = useState<Delivery[]>([])
  const [selectedDelivery, setSelectedDelivery] = useState<string>('all')
  const [deliveryReports, setDeliveryReports] = useState<DeliveryReport[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [expenses, setExpenses] = useState<ExpenseEntry[]>([])
  const [showExpenseModal, setShowExpenseModal] = useState(false)
  const [newExpense, setNewExpense] = useState({
    amount: '',
    concept: '',
    paymentMethod: 'cash',
    date: getEcuadorDate()
  })

  const getDateRange = () => {
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    
    switch (dateRange) {
      case 'today':
        // Para "Hoy", usamos la misma fecha como inicio y fin
        const todayStr = today.toISOString().split('T')[0] // YYYY-MM-DD de hoy
        const todayStart = new Date(todayStr + 'T00:00:00')
        const todayEnd = new Date(todayStr + 'T23:59:59')
        return { start: todayStart, end: todayEnd }
      case 'week':
        const weekStart = new Date(today)
        weekStart.setDate(today.getDate() - 6) // -6 para incluir hoy
        weekStart.setHours(0, 0, 0, 0)
        return { start: weekStart, end: new Date(today.getTime() + 24 * 60 * 60 * 1000 - 1) }
      case 'month':
        const monthStart = new Date(today)
        monthStart.setDate(today.getDate() - 29) // -29 para incluir hoy
        monthStart.setHours(0, 0, 0, 0)
        return { start: monthStart, end: new Date(today.getTime() + 24 * 60 * 60 * 1000 - 1) }
      case 'custom':
        if (customStartDate && customEndDate) {
          // Para fechas personalizadas, asegurar rango completo del día
          const start = new Date(customStartDate + 'T00:00:00')
          const end = new Date(customEndDate + 'T23:59:59')
          return { start, end }
        }
        return { start: today, end: new Date(today.getTime() + 24 * 60 * 60 * 1000 - 1) }
      default:
        return { start: today, end: new Date(today.getTime() + 24 * 60 * 60 * 1000 - 1) }
    }
  }

  // Helper para parsear correctamente el campo `date` guardado como "YYYY-MM-DD"
  const parseExpenseDate = (date: any) => {
    if (!date) return new Date(0)
    if (typeof date === 'string') {
      // Agregar hora local para que no se interprete como UTC y no reste un día en zonas UTC-5
      return new Date(date + 'T00:00:00')
    }
    return date instanceof Date ? date : new Date(date)
  }

  const loadReport = async () => {
    if (!business?.id) return
    
    setLoading(true)
    try {
      const { start, end } = getDateRange()
      
      // Cargar datos según el tipo de reporte
      if (reportType === 'costs') {
        const [reportData, expensesData] = await Promise.all([
          calculateCostReport(business.id, start, end),
          getExpensesByBusiness(business.id, start, end)
        ])
        setReport(reportData)
        setExpenses(expensesData)
      } else if (reportType === 'deliveries' || reportType === 'general') {
        // Cargar órdenes y deliveries
        const [ordersData, deliveriesData] = await Promise.all([
          getOrdersByBusiness(business.id),
          getDeliveriesByStatus('activo')
        ])
        
        // Filtrar órdenes por rango de fechas
        const filteredOrders = ordersData.filter(order => {
          const orderDate = order.createdAt instanceof Date ? order.createdAt : new Date(order.createdAt)
          return orderDate >= start && orderDate <= end
        })
        
        setOrders(filteredOrders)
        setDeliveries(deliveriesData)
        
        // Calcular reportes por delivery
        calculateDeliveryReports(filteredOrders, deliveriesData)
      }
    } catch (error) {
      console.error('Error loading report:', error)
      alert('Error al cargar el reporte')
    } finally {
      setLoading(false)
    }
  }

  const calculateDeliveryReports = (ordersData: Order[], deliveriesData: Delivery[]) => {
    const reports: DeliveryReport[] = []
    
    // Reporte para cada delivery
    deliveriesData.forEach(delivery => {
      // Include all non-cancelled orders for this delivery
      const deliveryOrders = ordersData.filter(order => 
        order.delivery?.assignedDelivery === delivery.id && 
        order.status !== 'cancelled'
      )
      
      if (deliveryOrders.length === 0) return
      
      let cashCollected = 0
      let transferCollected = 0
      let totalDeliveryFees = 0
      let totalDeliveryTime = 0
      let ordersWithTime = 0
      
      deliveryOrders.forEach(order => {
        // Calcular efectivo y transferencias
        if (order.payment?.method === 'cash') {
          cashCollected += order.total
        } else if (order.payment?.method === 'transfer') {
          transferCollected += order.total
        } else if (order.payment?.method === 'mixed') {
          cashCollected += order.payment?.cashAmount || 0
          transferCollected += order.payment?.transferAmount || 0
        }
        
        // Calcular ganancia del delivery (costo de envío)
        if (order.delivery?.type === 'delivery') {
          totalDeliveryFees += order.delivery?.deliveryCost || 0
        }
        
        // Calcular tiempo de entrega usando deliveredAt (o statusHistory.deliveredAt), con fallback a updatedAt
        // Solo para órdenes entregadas
        if (order.status === 'delivered') {
          const createdAt = order.createdAt instanceof Date ? order.createdAt : new Date(order.createdAt)
          const deliveredAtSource: any = (order as any).deliveredAt || (order as any)?.statusHistory?.deliveredAt || order.updatedAt
          const deliveredAtDate = deliveredAtSource instanceof Date
            ? deliveredAtSource
            : (deliveredAtSource?.toDate ? deliveredAtSource.toDate() : new Date(deliveredAtSource))
          const deliveryTimeMinutes = (deliveredAtDate.getTime() - createdAt.getTime()) / (1000 * 60)
          if (isFinite(deliveryTimeMinutes) && deliveryTimeMinutes >= 0) {
            totalDeliveryTime += deliveryTimeMinutes
            ordersWithTime++
          }
        }
      })
      
      reports.push({
        deliveryId: delivery.id,
        deliveryName: delivery.nombres,
        totalOrders: deliveryOrders.length,
        cashCollected,
        transferCollected,
        totalCollected: cashCollected + transferCollected,
        deliveryEarnings: totalDeliveryFees,
        averageDeliveryTime: ordersWithTime > 0 ? totalDeliveryTime / ordersWithTime : 0,
        orders: deliveryOrders
      })
    })
    
    setDeliveryReports(reports)
  }

  useEffect(() => {
    loadReport()
  }, [business?.id, dateRange, reportType])

  if (!business) {
    return (
      <div className="text-center py-8 text-gray-500">
        Selecciona un negocio para ver los reportes
      </div>
    )
  }

  // Filtrar gastos según el rango de fechas
  const filteredExpenses = useMemo(() => {
    const { start, end } = getDateRange();
    return expenses.filter(expense => {
      const expenseDate = parseExpenseDate(expense.date);
      return expenseDate >= start && expenseDate <= end;
    });
  }, [expenses, dateRange, customStartDate, customEndDate]);

  const filteredModalExpenses = useMemo(() => {
    const { start, end } = getDateRange();
    return expenses.filter(expense => {
      const expenseDate = parseExpenseDate(expense.date);
      return expenseDate >= start && expenseDate <= end;
    });
  }, [expenses, dateRange, customStartDate, customEndDate]);

  const expenseConcepts = useMemo(() => {
    const uniqueConcepts = new Set(expenses.map(expense => expense.concept));
    return Array.from(uniqueConcepts);
  }, [expenses]);

  return (
    <div className="space-y-6">
      {/* Header con filtros */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">
              <i className="bi bi-bar-chart-line me-2"></i>
              Panel de Reportes
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              Análisis completo de ventas, costos y entregas
            </p>
          </div>
        </div>

        {/* Selector de tipo de reporte */}
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={() => setReportType('general')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              reportType === 'general'
                ? 'bg-red-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <i className="bi bi-graph-up me-2"></i>
            General
          </button>
          <button
            onClick={() => setReportType('deliveries')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              reportType === 'deliveries'
                ? 'bg-red-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <i className="bi bi-truck me-2"></i>
            Por Delivery
          </button>
          <button
            onClick={() => setReportType('costs')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              reportType === 'costs'
                ? 'bg-red-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <i className="bi bi-basket me-2"></i>
            Costos e Ingredientes
          </button>
        </div>

        {/* Filtros de fecha */}
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={() => setDateRange('today')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              dateRange === 'today'
                ? 'bg-red-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Hoy
          </button>
          <button
            onClick={() => setDateRange('week')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              dateRange === 'week'
                ? 'bg-red-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            7 días
          </button>
          <button
            onClick={() => setDateRange('month')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              dateRange === 'month'
                ? 'bg-red-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            30 días
          </button>
          <button
            onClick={() => setDateRange('custom')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              dateRange === 'custom'
                ? 'bg-red-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Personalizado
          </button>
        </div>

        {dateRange === 'custom' && (
          <div className="mt-4 flex gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Desde</label>
              <input
                type="date"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Hasta</label>
              <input
                type="date"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
              />
            </div>
            <div className="flex items-end">
              <button
                onClick={loadReport}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              >
                Aplicar
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Filtro por delivery (solo visible en reporte de deliveries) */}
      {reportType === 'deliveries' && deliveries.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Filtrar por Delivery
          </label>
          <select
            value={selectedDelivery}
            onChange={(e) => setSelectedDelivery(e.target.value)}
            className="w-full md:w-64 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
          >
            <option value="all">Todos los deliveries</option>
            {deliveries.map(delivery => (
              <option key={delivery.id} value={delivery.id}>
                {delivery.nombres}
              </option>
            ))}
          </select>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Generando reporte...</p>
        </div>
      ) : reportType === 'general' ? (
        <GeneralReport orders={orders} />
      ) : reportType === 'deliveries' ? (
        <DeliveryReportsView 
          reports={deliveryReports.filter(r => selectedDelivery === 'all' || r.deliveryId === selectedDelivery)}
        />
      ) : report ? (
        <>
          {/* Resumen General */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Ingresos (Sin envío)</p>
                  <p className="text-2xl font-bold text-emerald-600">
                    ${(report.totalRevenue - report.totalShippingCost).toFixed(2)}
                  </p>
                </div>
                <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center">
                  <i className="bi bi-cash-stack text-emerald-600 text-xl"></i>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Costos Totales</p>
                  <p className="text-2xl font-bold text-red-600">
                    ${(report.totalIngredientCost + report.totalShippingCost).toFixed(2)}
                  </p>
                </div>
                <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
                  <i className="bi bi-calculator text-red-600 text-xl"></i>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Gastos totales</p>
                  <p className="text-2xl font-bold text-red-700">
                    ${filteredExpenses.reduce((sum, e) => sum + (Number.isFinite(e.amount) ? e.amount : 0), 0).toFixed(2)}
                  </p>
                  <button
                    onClick={() => setShowExpenseModal(true)}
                    className="mt-2 text-sm text-red-600 hover:text-red-700 flex items-center gap-1"
                  >
                    <i className="bi bi-plus-circle"></i>
                    Agregar gasto
                  </button>
                </div>
                <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
                  <i className="bi bi-wallet2 text-red-700 text-xl"></i>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Ganancia Neta y Margen</p>
                  <p className="text-2xl font-bold text-blue-600">
                    ${(Math.max(0, report.profitAmount - report.totalShippingCost)).toFixed(2)}
                  </p>
                  <p className="text-sm text-purple-600 mt-1">
                    {report.totalRevenue > 0 ? ((report.profitAmount - report.totalShippingCost) / report.totalRevenue * 100).toFixed(1) : 0}% margen
                  </p>
                </div>
                <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                  <i className="bi bi-graph-up-arrow text-blue-600 text-xl"></i>
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                {report.totalOrders} pedidos completados
              </p>
            </div>
          </div>

          {/* Consumo de Ingredientes */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">
                <i className="bi bi-basket me-2"></i>
                Consumo de Ingredientes
              </h3>
              <p className="text-sm text-gray-500 mt-1">
                Ingredientes más utilizados y su costo
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Ingrediente
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Cantidad Usada
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Costo Unitario
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Costo Total
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Detalles
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {report.ingredientConsumption.map((ingredient, index) => (
                    <React.Fragment key={index}>
                      <tr className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="font-medium text-gray-900">{ingredient.ingredientName}</span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-gray-700">
                          {Number.isInteger(ingredient.totalQuantity) 
                            ? ingredient.totalQuantity 
                            : ingredient.totalQuantity.toFixed(2)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-gray-700">
                          ${ingredient.unitCost.toFixed(2)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="font-semibold text-red-600">
                            ${ingredient.totalCost.toFixed(2)}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <button
                            onClick={() => setExpandedIngredient(
                              expandedIngredient === ingredient.ingredientName ? null : ingredient.ingredientName
                            )}
                            className="text-blue-600 hover:text-blue-800 text-sm"
                          >
                            <i className={`bi ${expandedIngredient === ingredient.ingredientName ? 'bi-chevron-up' : 'bi-chevron-down'} me-1`}></i>
                            Ver uso
                          </button>
                        </td>
                      </tr>
                      {expandedIngredient === ingredient.ingredientName && (
                        <tr>
                          <td colSpan={5} className="px-6 py-4 bg-gray-50">
                            <div className="space-y-2">
                              <p className="text-sm font-medium text-gray-700 mb-2">Usado en:</p>
                              {ingredient.usedInProducts.map((usage, idx) => (
                                <div key={idx} className="text-sm text-gray-600 pl-4">
                                  • {usage.productName}
                                  {usage.variantName && ` - ${usage.variantName}`}
                                  : {usage.quantitySold} vendidos, {usage.ingredientQuantityUsed.toFixed(2)} unidades usadas
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Productos Más Vendidos */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">
                <i className="bi bi-trophy me-2"></i>
                Productos Más Vendidos
              </h3>
              <p className="text-sm text-gray-500 mt-1">
                Rendimiento por producto
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Producto
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Cantidad Vendida
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Ingresos
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Costo
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Ganancia
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Margen
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {report.topSellingProducts.map((product, index) => {
                    const margin = product.revenue > 0 ? (product.profit / product.revenue) * 100 : 0
                    return (
                      <tr key={index} className="hover:bg-gray-50">
                        <td className="px-6 py-4">
                          <div>
                            <span className="font-medium text-gray-900">{product.productName}</span>
                            {product.variantName && (
                              <span className="text-sm text-gray-500 ml-2">({product.variantName})</span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="font-semibold text-gray-900">{product.quantitySold}</span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-emerald-600 font-medium">
                          ${product.revenue.toFixed(2)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-red-600">
                          ${product.cost.toFixed(2)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-blue-600 font-semibold">
                          ${product.profit.toFixed(2)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                            margin >= 50 ? 'bg-green-100 text-green-800' :
                            margin >= 30 ? 'bg-yellow-100 text-yellow-800' :
                            'bg-red-100 text-red-800'
                          }`}>
                            {margin.toFixed(1)}%
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <div className="text-center py-12 text-gray-500">
          No hay datos para el período seleccionado
        </div>
      )}

      {/* Modal para agregar gasto */}
      {showExpenseModal && (
        <div className="fixed inset-0 flex items-start md:items-center justify-center z-50 overflow-auto py-8">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowExpenseModal(false)}></div>
          <div className="relative bg-white rounded-lg shadow-xl max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                <i className="bi bi-wallet2 me-2"></i>
                Agregar Gasto
              </h3>
              <form onSubmit={async (e) => {
                e.preventDefault()
                if (!business?.id) return

                try {
                  const amount = parseFloat(newExpense.amount)
                  if (isNaN(amount) || amount <= 0) {
                    alert('El monto debe ser mayor a 0')
                    return
                  }

                  await createExpense({
                    businessId: business.id,
                    concept: newExpense.concept,
                    amount: amount,
                    paymentMethod: newExpense.paymentMethod,
                    date: newExpense.date
                  })

                  // Recargar reporte
                  loadReport()
                  // Limpiar form
                  setNewExpense({
                    amount: '',
                    concept: '',
                    paymentMethod: 'cash',
                    date: getEcuadorDate()
                  })
                  // Cerrar modal
                  setShowExpenseModal(false)
                } catch (error) {
                  console.error('Error al crear gasto:', error)
                  alert('Error al crear el gasto')
                }
              }}>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Concepto
                    </label>
                    <input
                      list="expense-concepts"
                      type="text"
                      value={newExpense.concept}
                      onChange={(e) => setNewExpense({...newExpense, concept: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
                      required
                    />
                    <datalist id="expense-concepts">
                      {expenseConcepts.map((concept, index) => (
                        <option key={index} value={concept} />
                      ))}
                    </datalist>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Monto ($)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={newExpense.amount}
                      onChange={(e) => setNewExpense({...newExpense, amount: e.target.value})}
                      onWheel={(e) => e.currentTarget.blur()} // Evitar cambios al hacer scroll
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Método de pago
                    </label>
                    <select
                      value={newExpense.paymentMethod}
                      onChange={(e) => setNewExpense({...newExpense, paymentMethod: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
                    >
                      <option value="cash">Efectivo</option>
                      <option value="transfer">Transferencia</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Fecha
                    </label>
                    <input
                      type="date"
                      value={newExpense.date}
                      onChange={(e) => {
                        setNewExpense({...newExpense, date: e.target.value});
                      }}
                      max="2030-12-31"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
                      required
                    />
                  </div>
                </div>

                {/* Lista de gastos */}
                <div className="mt-6 border-t border-gray-200 pt-4">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-medium text-gray-700">
                      Gastos {dateRange === 'today' ? 'de hoy' : 
                             dateRange === 'week' ? 'últimos 7 días' :
                             dateRange === 'month' ? 'últimos 30 días' :
                             'del período'}
                    </h4>
                  </div>
                  {filteredModalExpenses.length > 0 ? (
                    <div className="space-y-2 max-h-64 overflow-y-auto pr-2">
                      {filteredModalExpenses.map((expense, index) => (
                        <div key={expense.id || index} className="bg-gray-50 p-3 rounded-lg">
                          <div className="flex justify-between items-start">
                            <div>
                              <div className="flex items-center gap-2">
                                <p className="font-medium text-gray-900">{expense.concept}</p>
                                <span className="text-xs text-gray-500">
                                  {parseExpenseDate(expense.date).toLocaleDateString('es-EC', {
                                    day: '2-digit',
                                    month: '2-digit',
                                    year: 'numeric'
                                  })}
                                </span>
                              </div>
                              <p className="text-sm text-gray-500">
                                {expense.paymentMethod === 'cash' ? 'Efectivo' : 'Transferencia'}
                              </p>
                            </div>
                            <div className="flex items-center gap-3">
                              <p className="font-semibold text-red-600">
                                ${expense.amount.toFixed(2)}
                              </p>
                              <button
                                type="button"
                                title="Eliminar gasto"
                                onClick={async () => {
                                  if (!expense.id) return
                                  const ok = confirm('¿Eliminar gasto? Esta acción no se puede deshacer.')
                                  if (!ok) return
                                  try {
                                    await deleteExpense(expense.id)
                                    await loadReport()
                                  } catch (err) {
                                    console.error('Error eliminando gasto', err)
                                    alert('Error al eliminar el gasto')
                                  }
                                }}
                                className="text-gray-400 hover:text-red-600"
                              >
                                <i className="bi bi-trash-fill"></i>
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500 text-center py-4">
                      No hay gastos registrados en este período
                    </p>
                  )}
                  <div className="mt-3 pt-3 border-t border-gray-200">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-600">Total {dateRange === 'today' ? 'del día' : 'del período'}:</span>
                      <span className="font-bold text-red-600">
                        ${filteredModalExpenses.reduce((sum, e) => sum + e.amount, 0).toFixed(2)}
                      </span>
                    </div>
                    {dateRange !== 'today' && (
                      <div className="flex justify-between items-center mt-1">
                        <span className="text-xs text-gray-500">Promedio diario:</span>
                        <span className="text-sm font-medium text-gray-600">
                          ${(filteredModalExpenses.reduce((sum, e) => sum + e.amount, 0) / 
                             (dateRange === 'week' ? 7 : dateRange === 'month' ? 30 : 
                              Math.max(1, Math.ceil((new Date(customEndDate).getTime() - new Date(customStartDate).getTime()) / (1000 * 60 * 60 * 24)))
                             )).toFixed(2)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-6 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setShowExpenseModal(false)}
                    className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg"
                  >
                    Guardar Gasto
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Componente para reporte general
function GeneralReport({ orders }: { orders: Order[] }) {
  // Show all orders except cancelled ones
  const validOrders = orders.filter(o => o.status !== 'cancelled')
  const deliveredOrders = validOrders.filter(o => o.status === 'delivered')
  const [deliveries, setDeliveries] = useState<Delivery[]>([])
  
  // Cargar la lista de repartidores
  useEffect(() => {
    const loadDeliveries = async () => {
      try {
        const activeDeliveries = await getDeliveriesByStatus('activo')
        setDeliveries(activeDeliveries)
      } catch (error) {
        console.error('Error cargando repartidores:', error)
      }
    }
    loadDeliveries()
  }, [])
  
  const totalRevenue = validOrders.reduce((sum, order) => sum + order.total, 0)
  const cashRevenue = validOrders.reduce((sum, order) => {
    if (order.payment?.method === 'cash') return sum + order.total
    if (order.payment?.method === 'mixed') return sum + (order.payment?.cashAmount || 0)
    return sum
  }, 0)
  const transferRevenue = validOrders.reduce((sum, order) => {
    if (order.payment?.method === 'transfer') return sum + order.total
    if (order.payment?.method === 'mixed') return sum + (order.payment?.transferAmount || 0)
    return sum
  }, 0)
  const deliveryOrders = validOrders.filter(o => o.delivery?.type === 'delivery')
  const pickupOrders = validOrders.filter(o => o.delivery?.type === 'pickup')
  const totalDeliveryFees = deliveryOrders.reduce((sum, order) => sum + (order.delivery?.deliveryCost || 0), 0)
  
  // Calcular ganancias por repartidor
  const deliveryEarningsByDriver = useMemo(() => {
    const earnings: { [key: string]: DeliveryEarnings } = {}
    
    deliveryOrders.forEach(order => {
      const driverId = order.delivery?.assignedDelivery
      if (!driverId) return
      
      const driver = deliveries.find(d => d.id === driverId)
      const driverName = driver?.nombres || `Repartidor ${driverId}`
      const deliveryCost = order.delivery?.deliveryCost || 0
      
      if (!earnings[driverId]) {
        earnings[driverId] = {
          id: driverId,
          name: driverName,
          amount: 0
        }
      }
      
      earnings[driverId].amount += deliveryCost
    })
    
    return earnings
  }, [deliveryOrders, deliveries])
  
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className="text-sm text-gray-500">Ingresos Totales</p>
              <p className="text-2xl font-bold text-emerald-600">
                ${totalRevenue.toFixed(2)}
              </p>
            </div>
            <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center">
              <i className="bi bi-cash-stack text-emerald-600 text-xl"></i>
            </div>
          </div>
          <div className="mt-4 space-y-2">
            <div className="flex justify-between items-center text-sm">
              <div className="flex items-center">
                <i className="bi bi-cash text-green-600 mr-2"></i>
                <span className="text-gray-600">Efectivo</span>
              </div>
              <span className="font-medium text-green-600">${cashRevenue.toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <div className="flex items-center">
                <i className="bi bi-bank text-blue-600 mr-2"></i>
                <span className="text-gray-600">Transferencias</span>
              </div>
              <span className="font-medium text-blue-600">${transferRevenue.toFixed(2)}</span>
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-3">
            {deliveredOrders.length} pedidos entregados
          </p>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Ganancias Delivery</p>
              <p className="text-2xl font-bold text-purple-600">
                ${totalDeliveryFees.toFixed(2)}
              </p>
            </div>
            <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center">
              <i className="bi bi-truck text-purple-600 text-xl"></i>
            </div>
          </div>
          
          {/* Desglose por repartidor */}
          <div className="mt-4 space-y-2 max-h-48 overflow-y-auto pr-2">
            {Object.entries(deliveryEarningsByDriver)
              .sort(([, a], [, b]) => b.amount - a.amount)
              .map(([driverId, { name, amount }]) => (
                <div key={driverId} className="flex justify-between items-center text-sm py-1">
                  <div className="flex items-center">
                    <i className="bi bi-person text-purple-500 mr-2"></i>
                    <span className="text-gray-600 truncate max-w-[140px]">{name}</span>
                  </div>
                  <span className="font-medium text-purple-600">
                    ${amount.toFixed(2)}
                  </span>
                </div>
              ))}
          </div>
          
          <p className="text-xs text-gray-500 mt-3">
            {deliveryOrders.length} {deliveryOrders.length === 1 ? 'entrega' : 'entregas'} • 
            {Object.keys(deliveryEarningsByDriver).length} {Object.keys(deliveryEarningsByDriver).length === 1 ? 'repartidor' : 'repartidores'}
          </p>
        </div>
      </div>

      {/* Desglose por tipo de entrega */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            <i className="bi bi-truck me-2"></i>
            Entregas a Domicilio
          </h3>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-gray-600">Total Pedidos:</span>
              <span className="font-semibold">{validOrders.filter(o => o.delivery?.type === 'delivery').length}</span>
            </div>
            
            <div className="space-y-1 pl-2 border-l-2 border-gray-100">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Efectivo:</span>
                <span className="font-medium text-emerald-600">
                  ${deliveryOrders
                    .filter(o => o.payment.method === 'cash' || o.payment.method === 'mixed')
                    .reduce((sum, o) => sum + o.total, 0)
                    .toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Transferencia:</span>
                <span className="font-medium text-blue-600">
                  ${deliveryOrders
                    .filter(o => o.payment.method === 'transfer' || o.payment.method === 'mixed')
                    .reduce((sum, o) => sum + o.total, 0)
                    .toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between font-semibold pt-1 mt-1 border-t border-gray-100">
                <span>Total:</span>
                <span className="text-emerald-600">
                  ${deliveryOrders.reduce((sum, o) => sum + o.total, 0).toFixed(2)}
                </span>
              </div>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Costo de envíos:</span>
              <span className="font-semibold text-purple-600">
                ${totalDeliveryFees.toFixed(2)}
              </span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            <i className="bi bi-shop me-2"></i>
            Retiro en Tienda
          </h3>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-gray-600">Total Pedidos:</span>
              <span className="font-semibold">{validOrders.filter(o => o.delivery?.type === 'pickup').length}</span>
            </div>
            
            <div className="space-y-1 pl-2 border-l-2 border-gray-100">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Efectivo:</span>
                <span className="font-medium text-emerald-600">
                  ${pickupOrders
                    .filter(o => o.payment.method === 'cash' || o.payment.method === 'mixed')
                    .reduce((sum, o) => sum + o.total, 0)
                    .toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Transferencia:</span>
                <span className="font-medium text-blue-600">
                  ${pickupOrders
                    .filter(o => o.payment.method === 'transfer' || o.payment.method === 'mixed')
                    .reduce((sum, o) => sum + o.total, 0)
                    .toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between font-semibold pt-1 mt-1 border-t border-gray-100">
                <span>Total:</span>
                <span className="text-emerald-600">
                  ${pickupOrders.reduce((sum, o) => sum + o.total, 0).toFixed(2)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      
    </>
  )
}

// Componente para reportes de delivery
function DeliveryReportsView({ reports }: { reports: DeliveryReport[] }) {
  const [expandedDelivery, setExpandedDelivery] = useState<string | null>(null)
  
  if (reports.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        No hay datos de entregas para el período seleccionado
      </div>
    )
  }
  
  return (
    <div className="space-y-4">
      {/* Resumen total */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Total Entregas</p>
              <p className="text-2xl font-bold text-gray-900">
                {reports.reduce((sum, r) => sum + r.totalOrders, 0)}
              </p>
            </div>
            <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center">
              <i className="bi bi-box-seam text-gray-600 text-xl"></i>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Efectivo Total</p>
              <p className="text-2xl font-bold text-green-600">
                ${reports.reduce((sum, r) => sum + r.cashCollected, 0).toFixed(2)}
              </p>
            </div>
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
              <i className="bi bi-cash text-green-600 text-xl"></i>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Transferencias</p>
              <p className="text-2xl font-bold text-blue-600">
                ${reports.reduce((sum, r) => sum + r.transferCollected, 0).toFixed(2)}
              </p>
            </div>
            <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
              <i className="bi bi-bank text-blue-600 text-xl"></i>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Ganancias Delivery</p>
              <p className="text-2xl font-bold text-purple-600">
                ${reports.reduce((sum, r) => sum + r.deliveryEarnings, 0).toFixed(2)}
              </p>
            </div>
            <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center">
              <i className="bi bi-truck text-purple-600 text-xl"></i>
            </div>
          </div>
        </div>
      </div>

      {/* Tabla de deliveries */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">
            <i className="bi bi-people me-2"></i>
            Reporte por Delivery
          </h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Delivery
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Entregas
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Efectivo
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Transferencia
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Total Cobrado
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Ganancia
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Tiempo Promedio
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Detalles
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {reports.map((report) => (
                <React.Fragment key={report.deliveryId}>
                  <tr className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="font-medium text-gray-900">{report.deliveryName}</span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="font-semibold text-gray-900">{report.totalOrders}</span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-green-600 font-medium">
                      ${report.cashCollected.toFixed(2)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-blue-600 font-medium">
                      ${report.transferCollected.toFixed(2)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-emerald-600 font-semibold">
                      ${report.totalCollected.toFixed(2)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-purple-600 font-semibold">
                      ${report.deliveryEarnings.toFixed(2)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-gray-700">
                      {report.averageDeliveryTime > 0 ? (
                        <span>{Math.round(report.averageDeliveryTime)} min</span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <button
                        onClick={() => setExpandedDelivery(
                          expandedDelivery === report.deliveryId ? null : report.deliveryId
                        )}
                        className="text-blue-600 hover:text-blue-800 text-sm"
                      >
                        <i className={`bi ${expandedDelivery === report.deliveryId ? 'bi-chevron-up' : 'bi-chevron-down'} me-1`}></i>
                        {expandedDelivery === report.deliveryId ? 'Ocultar' : 'Ver'}
                      </button>
                    </td>
                  </tr>
                  {expandedDelivery === report.deliveryId && (
                    <tr>
                      <td colSpan={8} className="px-6 py-4 bg-gray-50">
                        <div className="space-y-3">
                          <h4 className="font-semibold text-gray-900 mb-3">Pedidos entregados:</h4>
                          {report.orders.map((order, idx) => {
                            const orderDate = order.createdAt instanceof Date ? order.createdAt : new Date(order.createdAt)
                            const deliveredDate = order.updatedAt instanceof Date ? order.updatedAt : new Date(order.updatedAt)
                            const deliveryTime = Math.round((deliveredDate.getTime() - orderDate.getTime()) / (1000 * 60))
                            
                            return (
                              <div key={idx} className="bg-white p-4 rounded-lg border border-gray-200">
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
                                  <div>
                                    <span className="text-gray-500">Cliente:</span>
                                    <p className="font-medium text-gray-900">{order.customer?.name}</p>
                                  </div>
                                  <div>
                                    <span className="text-gray-500">Total:</span>
                                    <p className="font-semibold text-emerald-600">${order.total.toFixed(2)}</p>
                                  </div>
                                  <div>
                                    <span className="text-gray-500">Método de pago:</span>
                                    <p className="font-medium">
                                      {order.payment?.method === 'cash' ? '💵 Efectivo' :
                                       order.payment?.method === 'transfer' ? '🏦 Transferencia' :
                                       order.payment?.method === 'mixed' ? '💳 Mixto' : 'Sin especificar'}
                                    </p>
                                    {order.payment?.method === 'mixed' && (
                                      <p className="text-xs text-gray-600 mt-1">
                                        Efectivo: ${order.payment?.cashAmount?.toFixed(2)} | 
                                        Transferencia: ${order.payment?.transferAmount?.toFixed(2)}
                                      </p>
                                    )}
                                  </div>
                                  <div>
                                    <span className="text-gray-500">Tiempo de entrega:</span>
                                    <p className="font-medium text-gray-900">{deliveryTime} min</p>
                                  </div>
                                </div>
                                <div className="mt-2 pt-2 border-t border-gray-100">
                                  <span className="text-xs text-gray-500">
                                    Pedido: {orderDate.toLocaleDateString()} {orderDate.toLocaleTimeString()}
                                  </span>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
