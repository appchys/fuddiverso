'use client'

import React, { useState, useEffect } from 'react'
import { Business } from '@/types'
import { calculateCostReport, CostReport } from '@/lib/database'

interface CostReportsProps {
  business: Business | null
}

export default function CostReports({ business }: CostReportsProps) {
  const [report, setReport] = useState<CostReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [dateRange, setDateRange] = useState<'today' | 'week' | 'month' | 'custom'>('today')
  const [customStartDate, setCustomStartDate] = useState('')
  const [customEndDate, setCustomEndDate] = useState('')
  const [expandedIngredient, setExpandedIngredient] = useState<string | null>(null)

  const getDateRange = () => {
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    
    switch (dateRange) {
      case 'today':
        return { start: today, end: new Date(today.getTime() + 24 * 60 * 60 * 1000) }
      case 'week':
        const weekStart = new Date(today)
        weekStart.setDate(today.getDate() - 7)
        return { start: weekStart, end: now }
      case 'month':
        const monthStart = new Date(today)
        monthStart.setDate(today.getDate() - 30)
        return { start: monthStart, end: now }
      case 'custom':
        return {
          start: customStartDate ? new Date(customStartDate) : today,
          end: customEndDate ? new Date(customEndDate) : now
        }
      default:
        return { start: today, end: now }
    }
  }

  const loadReport = async () => {
    if (!business?.id) return
    
    setLoading(true)
    try {
      const { start, end } = getDateRange()
      const reportData = await calculateCostReport(business.id, start, end)
      setReport(reportData)
    } catch (error) {
      console.error('Error loading report:', error)
      alert('Error al cargar el reporte')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadReport()
  }, [business?.id, dateRange])

  if (!business) {
    return (
      <div className="text-center py-8 text-gray-500">
        Selecciona un negocio para ver los reportes
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header con filtros */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">
              <i className="bi bi-graph-up me-2"></i>
              Reporte de Costos
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              Análisis de costos e ingredientes consumidos
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
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

      {loading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Generando reporte...</p>
        </div>
      ) : report ? (
        <>
          {/* Resumen General */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Ingresos Totales</p>
                  <p className="text-2xl font-bold text-emerald-600">
                    ${report.totalRevenue.toFixed(2)}
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
                  <p className="text-sm text-gray-500">Costo Ingredientes</p>
                  <p className="text-2xl font-bold text-red-600">
                    ${report.totalIngredientCost.toFixed(2)}
                  </p>
                </div>
                <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
                  <i className="bi bi-basket text-red-600 text-xl"></i>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Ganancia Neta</p>
                  <p className="text-2xl font-bold text-blue-600">
                    ${report.profitAmount.toFixed(2)}
                  </p>
                </div>
                <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                  <i className="bi bi-graph-up-arrow text-blue-600 text-xl"></i>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Margen de Ganancia</p>
                  <p className="text-2xl font-bold text-purple-600">
                    {report.profitMargin.toFixed(1)}%
                  </p>
                </div>
                <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center">
                  <i className="bi bi-percent text-purple-600 text-xl"></i>
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
                          {ingredient.totalQuantity.toFixed(2)}
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
    </div>
  )
}
