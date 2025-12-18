'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { Business } from '@/types'
import {
  recordStockMovement,
  getStockMovements,
  calculateCurrentStock,
  getIngredientStockSummary,
  IngredientStockMovement,
  IngredientStockSummary,
  calculateIngredientConsumption,
  getIngredientStockHistory
} from '@/lib/database'

interface IngredientStockManagementProps {
  business: Business | null
}

export default function IngredientStockManagement({ business }: IngredientStockManagementProps) {
  const [stockSummary, setStockSummary] = useState<IngredientStockSummary[]>([])
  const [selectedIngredient, setSelectedIngredient] = useState<string | null>(null)
  const [movements, setMovements] = useState<IngredientStockMovement[]>([])
  const [consumption, setConsumption] = useState<number>(0)
  const [loading, setLoading] = useState(false)
  const [showMovementModal, setShowMovementModal] = useState(false)
  const [dateRange, setDateRange] = useState<'today' | 'week' | 'month' | 'all'>('week')

  const [newMovement, setNewMovement] = useState({
    ingredientName: '',
    type: 'entry' as 'entry' | 'sale' | 'adjustment',
    quantity: '',
    date: new Date().toISOString().split('T')[0],
    notes: ''
  })

  // Cargar resumen de stock
  const loadStockSummary = async () => {
    if (!business?.id) return

    setLoading(true)
    try {
      const summary = await getIngredientStockSummary(business.id)
      setStockSummary(summary)

      // Seleccionar primer ingrediente por defecto
      if (summary.length > 0 && !selectedIngredient) {
        setSelectedIngredient(summary[0].ingredientId)
      }
    } catch (error) {
      console.error('Error loading stock summary:', error)
    } finally {
      setLoading(false)
    }
  }

  // Cargar movimientos del ingrediente seleccionado
  const loadMovements = async () => {
    if (!business?.id || !selectedIngredient) return

    try {
      const { start, end } = getDateRangeForFilter()
      const data = await getStockMovements(business.id, selectedIngredient, start, end)
      setMovements(data)

      // Cargar consumo automático
      const selectedItem = stockSummary.find(s => s.ingredientId === selectedIngredient)
      if (selectedItem) {
        const consumptionValue = await calculateIngredientConsumption(
          business.id,
          selectedItem.ingredientName,
          start,
          end
        )
        setConsumption(consumptionValue)
      }
    } catch (error) {
      console.error('Error loading movements:', error)
    }
  }

  const getDateRangeForFilter = () => {
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

    switch (dateRange) {
      case 'today':
        return {
          start: today,
          end: new Date(today.getTime() + 24 * 60 * 60 * 1000 - 1)
        }
      case 'week':
        const weekStart = new Date(today)
        weekStart.setDate(today.getDate() - 6)
        return {
          start: weekStart,
          end: new Date(today.getTime() + 24 * 60 * 60 * 1000 - 1)
        }
      case 'month':
        const monthStart = new Date(today)
        monthStart.setDate(today.getDate() - 29)
        return {
          start: monthStart,
          end: new Date(today.getTime() + 24 * 60 * 60 * 1000 - 1)
        }
      case 'all':
      default:
        return {
          start: new Date(0),
          end: new Date(today.getTime() + 24 * 60 * 60 * 1000 - 1)
        }
    }
  }

  const loadConsumption = async () => {
    if (!business?.id || !selectedIngredient) return

    const selectedItem = stockSummary.find(s => s.ingredientId === selectedIngredient)
    if (!selectedItem) return

    try {
      const { start, end } = getDateRangeForFilter()
      const consumption = await calculateIngredientConsumption(
        business.id,
        selectedItem.ingredientName,
        start,
        end
      )
      setConsumption(consumption)
    } catch (error) {
      console.error('Error loading consumption:', error)
    }
  }

  useEffect(() => {
    loadStockSummary()
  }, [business?.id])

  useEffect(() => {
    loadMovements()
  }, [business?.id, selectedIngredient, dateRange])

  const handleAddMovement = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!business?.id || !newMovement.ingredientName.trim() || !newMovement.quantity) {
      alert('Por favor completa todos los campos')
      return
    }

    try {
      await recordStockMovement({
        ingredientId: selectedIngredient || `ing_${Date.now()}`,
        ingredientName: newMovement.ingredientName,
        type: newMovement.type,
        quantity: Number(newMovement.quantity),
        date: newMovement.date,
        notes: newMovement.notes,
        businessId: business.id
      })

      // Recargar datos
      await loadStockSummary()
      setShowMovementModal(false)
      setNewMovement({
        ingredientName: '',
        type: 'entry',
        quantity: '',
        date: new Date().toISOString().split('T')[0],
        notes: ''
      })
      alert('Movimiento registrado exitosamente')
    } catch (error) {
      console.error('Error adding movement:', error)
      alert('Error al registrar el movimiento')
    }
  }

  const openNewMovement = (ingredient?: IngredientStockSummary) => {
    if (ingredient) {
      setSelectedIngredient(ingredient.ingredientId)
      setNewMovement({
        ingredientName: ingredient.ingredientName,
        type: 'entry',
        quantity: '',
        date: new Date().toISOString().split('T')[0],
        notes: ''
      })
    } else {
      const current = stockSummary.find(s => s.ingredientId === selectedIngredient)
      setNewMovement({
        ingredientName: current?.ingredientName || '',
        type: 'entry',
        quantity: '',
        date: new Date().toISOString().split('T')[0],
        notes: ''
      })
    }
    setShowMovementModal(true)
  }

  const selectedIngredientData = useMemo(() => {
    return stockSummary.find(s => s.ingredientId === selectedIngredient)
  }, [stockSummary, selectedIngredient])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">
              <i className="bi bi-box-seam me-2"></i>
              Gestión de Stock de Ingredientes
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              Controla el stock de tus ingredientes y visualiza el historial de movimientos
            </p>
          </div>
          <button
            onClick={() => openNewMovement()}
            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
          >
            <i className="bi bi-plus-lg me-2"></i>
            Nuevo Movimiento
          </button>
        </div>

        {/* Filtros de fecha */}
        <div className="flex flex-wrap gap-2">
          {(['today', 'week', 'month', 'all'] as const).map(range => (
            <button
              key={range}
              onClick={() => setDateRange(range)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${dateRange === range
                ? 'bg-red-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
            >
              {range === 'today' ? 'Hoy' : range === 'week' ? '7 días' : range === 'month' ? '30 días' : 'Todo'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Cargando stock...</p>
        </div>
      ) : stockSummary.length === 0 ? (
        <div className="bg-gray-50 rounded-lg border border-gray-200 p-8 text-center">
          <i className="bi bi-inbox text-4xl text-gray-300 mb-3 block"></i>
          <p className="text-gray-600 font-medium">No hay ingredientes registrados</p>
          <p className="text-sm text-gray-500 mt-1">Registra tu primer movimiento de stock para comenzar</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Panel lateral de ingredientes */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                <h3 className="font-semibold text-gray-900 text-sm">
                  Ingredientes ({stockSummary.length})
                </h3>
              </div>
              <div className="divide-y divide-gray-200 max-h-[600px] overflow-y-auto">
                {stockSummary.map(ingredient => (
                  <div
                    key={ingredient.ingredientId}
                    onClick={() => setSelectedIngredient(ingredient.ingredientId)}
                    className={`w-full text-left px-4 py-3 transition-colors hover:bg-gray-50 cursor-pointer ${selectedIngredient === ingredient.ingredientId
                      ? 'bg-red-50 border-l-4 border-red-600'
                      : 'border-l-4 border-transparent'
                      }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-gray-900 text-sm">
                          {ingredient.ingredientName}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                          Stock: {Math.round(ingredient.currentStock)}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className={`px-2 py-1 rounded-full text-xs font-medium ${ingredient.currentStock > 0
                          ? 'bg-green-100 text-green-800'
                          : ingredient.currentStock < 0
                            ? 'bg-red-100 text-red-800'
                            : 'bg-yellow-100 text-yellow-800'
                          }`}>
                          {ingredient.currentStock > 0 ? '✓' : ingredient.currentStock < 0 ? '!' : '✗'}
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            openNewMovement(ingredient)
                          }}
                          className="p-1 text-gray-400 hover:text-red-600 transition-colors"
                          title="Nuevo Movimiento"
                        >
                          <i className="bi bi-plus-circle text-lg"></i>
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Panel principal de detalles */}
          <div className="lg:col-span-3 space-y-6">
            {selectedIngredientData ? (
              <>
                {/* Tarjeta de resumen */}
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div>
                      <p className="text-sm text-gray-500 mb-1">Stock Actual</p>
                      <p className={`text-3xl font-bold ${selectedIngredientData.currentStock < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                        {Math.round(selectedIngredientData.currentStock)}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500 mb-1">Consumo en el Período</p>
                      <p className="text-3xl font-bold text-blue-600">
                        {Math.round(consumption)}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500 mb-1">Total de Movimientos</p>
                      <p className="text-3xl font-bold text-gray-900">
                        {movements.length}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500 mb-1">Últimos Movimientos</p>
                      <p className="text-sm text-gray-900">
                        {movements.length > 0
                          ? `${movements.slice(0, 2).map(m => `${m.quantity} ${m.type}`).join(', ')}`
                          : 'Sin movimientos'}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Historial de movimientos */}
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                  <div className="px-6 py-4 border-b border-gray-200">
                    <h3 className="font-semibold text-gray-900">Historial de Movimientos</h3>
                    <p className="text-sm text-gray-500 mt-1">
                      Registro de entradas, salidas y ajustes de stock
                    </p>
                  </div>

                  {movements.length === 0 ? (
                    <div className="px-6 py-8 text-center text-gray-500">
                      <i className="bi bi-inbox text-2xl mb-2 block"></i>
                      <p>No hay movimientos en este rango de fechas</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                              Fecha
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                              Tipo
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                              Cantidad
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">
                              Notas
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                          {movements.map(movement => (
                            <tr key={movement.id} className="hover:bg-gray-50">
                              <td className="px-6 py-4 text-sm text-gray-900">
                                {movement.date}
                              </td>
                              <td className="px-6 py-4 text-sm">
                                <span className={`px-3 py-1 rounded-full text-xs font-medium ${movement.type === 'entry'
                                  ? 'bg-green-100 text-green-800'
                                  : movement.type === 'sale'
                                    ? 'bg-blue-100 text-blue-800'
                                    : 'bg-yellow-100 text-yellow-800'
                                  }`}>
                                  {movement.type === 'entry' ? 'Entrada' : movement.type === 'sale' ? 'Venta' : 'Ajuste'}
                                </span>
                              </td>
                              <td className="px-6 py-4 text-sm font-medium text-gray-900">
                                {movement.type === 'sale' ? '-' : '+'}{Math.round(movement.quantity)}
                              </td>
                              <td className="px-6 py-4 text-sm text-gray-600">
                                {movement.notes || '-'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="bg-gray-50 rounded-lg border border-gray-200 p-8 text-center">
                <p className="text-gray-600">Selecciona un ingrediente para ver sus detalles</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal para nuevo movimiento */}
      {showMovementModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-semibold text-gray-900">
                  <i className="bi bi-plus-circle me-2"></i>
                  Registrar Movimiento
                </h3>
                <button
                  onClick={() => setShowMovementModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <i className="bi bi-x-lg text-xl"></i>
                </button>
              </div>

              <form onSubmit={handleAddMovement} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Ingrediente *
                  </label>
                  <input
                    type="text"
                    value={newMovement.ingredientName}
                    onChange={(e) => setNewMovement(prev => ({
                      ...prev,
                      ingredientName: e.target.value
                    }))}
                    placeholder="Ej: Tequeños, Salsa, Pan"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Tipo de Movimiento *
                  </label>
                  <select
                    value={newMovement.type}
                    onChange={(e) => setNewMovement(prev => ({
                      ...prev,
                      type: e.target.value as 'entry' | 'sale' | 'adjustment'
                    }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                  >
                    <option value="entry">Entrada (Compra)</option>
                    <option value="sale">Salida (Venta/Uso)</option>
                    <option value="adjustment">Ajuste Manual</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Cantidad *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={newMovement.quantity}
                    onChange={(e) => setNewMovement(prev => ({
                      ...prev,
                      quantity: e.target.value
                    }))}
                    placeholder="Ej: 50"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Fecha *
                  </label>
                  <input
                    type="date"
                    value={newMovement.date}
                    onChange={(e) => setNewMovement(prev => ({
                      ...prev,
                      date: e.target.value
                    }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Notas (Opcional)
                  </label>
                  <textarea
                    value={newMovement.notes}
                    onChange={(e) => setNewMovement(prev => ({
                      ...prev,
                      notes: e.target.value
                    }))}
                    placeholder="Ej: Compra a proveedor X, inversión $500"
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowMovementModal(false)}
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors font-medium"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
                  >
                    <i className="bi bi-check-lg me-1"></i>
                    Registrar
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
