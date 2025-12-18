'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { Business } from '@/types'
import {
  recordStockMovement,
  getStockMovements,
  getIngredientStockSummary,
  IngredientStockMovement,
  IngredientStockSummary,
  getIngredientLibrary,
  updateIngredientLibraryItem
} from '@/lib/database'

interface IngredientStockManagementProps {
  business: Business | null
}

export default function IngredientStockManagement({ business }: IngredientStockManagementProps) {
  const [stockSummary, setStockSummary] = useState<IngredientStockSummary[]>([])
  const [selectedIngredient, setSelectedIngredient] = useState<string | null>(null)
  const [movements, setMovements] = useState<IngredientStockMovement[]>([])
  const [loading, setLoading] = useState(false)
  const [showMovementModal, setShowMovementModal] = useState(false)
  const [dateRange, setDateRange] = useState<'today' | 'week' | 'month' | 'all'>('week')
  const [favorites, setFavorites] = useState<string[]>([])
  const [showEditIngredientModal, setShowEditIngredientModal] = useState(false)
  const [editIngredientData, setEditIngredientData] = useState({
    name: '',
    unitCost: ''
  })

  const [newMovement, setNewMovement] = useState({
    ingredientName: '',
    type: 'entry' as 'entry' | 'sale' | 'adjustment',
    quantity: '',
    date: new Date().toISOString().split('T')[0],
    notes: '',
    unitCost: ''
  })

  useEffect(() => {
    if (business?.id) {
      loadStockSummary()
      const saved = localStorage.getItem(`fuddi_fav_ingredients_${business.id}`)
      if (saved) setFavorites(JSON.parse(saved))
    }
  }, [business?.id])

  useEffect(() => {
    if (selectedIngredient && business?.id) {
      loadIngredientDetails()
    }
  }, [selectedIngredient, dateRange, business?.id])

  const loadStockSummary = async () => {
    if (!business?.id) return
    setLoading(true)
    try {
      const summary = await getIngredientStockSummary(business.id)
      setStockSummary(summary)
      if (summary.length > 0 && !selectedIngredient) {
        setSelectedIngredient(summary[0].ingredientId)
      }
    } catch (error) {
      console.error('Error loading summary:', error)
    } finally {
      setLoading(false)
    }
  }

  const loadIngredientDetails = async () => {
    if (!business?.id || !selectedIngredient) return
    try {
      const start = new Date()
      if (dateRange === 'week') start.setDate(start.getDate() - 7)
      else if (dateRange === 'month') start.setDate(start.getDate() - 30)
      else if (dateRange === 'today') start.setHours(0, 0, 0, 0)

      const history = await getStockMovements(
        business.id,
        selectedIngredient,
        dateRange === 'all' ? undefined : start
      )
      setMovements(history)
    } catch (error) {
      console.error('Error loading details:', error)
    }
  }

  const handleCreateMovement = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!business?.id) return

    try {
      const ingId = selectedIngredient || `ing_${newMovement.ingredientName.toLowerCase().trim().replace(/\s+/g, '_')}`
      const ingName = newMovement.ingredientName || stockSummary.find(s => s.ingredientId === selectedIngredient)?.ingredientName || ''

      await recordStockMovement({
        ingredientId: ingId,
        ingredientName: ingName,
        type: newMovement.type,
        quantity: parseFloat(newMovement.quantity),
        date: newMovement.date,
        notes: newMovement.notes,
        businessId: business.id,
        unitCost: newMovement.type === 'entry' ? parseFloat(newMovement.unitCost) || 0 : 0
      })

      setShowMovementModal(false)
      setNewMovement({
        ingredientName: '',
        type: 'entry',
        quantity: '',
        date: new Date().toISOString().split('T')[0],
        notes: '',
        unitCost: ''
      })
      await loadStockSummary()
      if (selectedIngredient) await loadIngredientDetails()
    } catch (error) {
      alert('Error al registrar el movimiento')
    }
  }

  const sortedSummary = useMemo(() => {
    return [...stockSummary].sort((a, b) => {
      const aFav = favorites.includes(a.ingredientId)
      const bFav = favorites.includes(b.ingredientId)
      if (aFav && !bFav) return -1
      if (!aFav && bFav) return 1
      return a.ingredientName.localeCompare(b.ingredientName)
    })
  }, [stockSummary, favorites])

  const toggleFavorite = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const newFavs = favorites.includes(id)
      ? favorites.filter(f => f !== id)
      : [...favorites, id]
    setFavorites(newFavs)
    if (business?.id) {
      localStorage.setItem(`fuddi_fav_ingredients_${business.id}`, JSON.stringify(newFavs))
    }
  }

  const handleUpdateIngredient = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!business?.id || !selectedIngredientData?.libraryId) return

    try {
      await updateIngredientLibraryItem(
        business.id,
        selectedIngredientData.libraryId,
        {
          name: editIngredientData.name,
          unitCost: parseFloat(editIngredientData.unitCost)
        }
      )
      setShowEditIngredientModal(false)
      loadStockSummary()
    } catch (error) {
      console.error('Error updating ingredient:', error)
      alert('Error al actualizar el ingrediente')
    }
  }

  const selectedIngredientData = useMemo(() => {
    return stockSummary.find(s => s.ingredientId === selectedIngredient)
  }, [stockSummary, selectedIngredient])

  return (
    <div className="animate-in fade-in duration-500">
      <div className="flex flex-col lg:flex-row gap-6">

        {/* Sidebar de Ingredientes */}
        <div className="lg:w-80 flex-shrink-0">
          <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden sticky top-24">
            <div className="p-6 border-b border-gray-100 bg-gray-50/30 flex justify-between items-center">
              <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest">Ingredientes</h3>
              <button
                onClick={() => {
                  setNewMovement(prev => ({ ...prev, ingredientName: '', unitCost: '' }))
                  setShowMovementModal(true)
                }}
                className="text-red-600 hover:bg-red-50 p-2 rounded-full transition-colors"
                title="Nuevo Ingrediente"
              >
                <i className="bi bi-plus-lg text-lg"></i>
              </button>
            </div>

            <div className="max-h-[calc(100vh-300px)] overflow-y-auto custom-scrollbar">
              {sortedSummary.map(ing => (
                <button
                  key={ing.ingredientId}
                  onClick={() => setSelectedIngredient(ing.ingredientId)}
                  className={`w-full text-left p-4 transition-all flex items-center gap-4 group relative ${selectedIngredient === ing.ingredientId ? 'bg-red-50 border-l-4 border-red-500' : 'hover:bg-gray-50 border-l-4 border-transparent'
                    }`}
                >
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-xs ${selectedIngredient === ing.ingredientId ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-500'
                    }`}>
                    {ing.ingredientName.substring(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0 pr-6">
                    <p className={`font-bold text-sm truncate ${selectedIngredient === ing.ingredientId ? 'text-red-700' : 'text-gray-900'}`}>
                      {ing.ingredientName}
                    </p>
                    <p className={`text-[10px] font-semibold truncate ${selectedIngredient === ing.ingredientId ? 'text-red-400' : 'text-gray-500'}`}>
                      ${ing.unitCost?.toFixed(2) || '0.00'} / {ing.unit || 'uds'}
                    </p>
                  </div>

                  {/* Favorite Toggle */}
                  <div
                    onClick={(e) => toggleFavorite(ing.ingredientId, e)}
                    className={`absolute right-12 top-1/2 -translate-y-1/2 p-2 rounded-full transition-all duration-300 opacity-0 group-hover:opacity-100 ${favorites.includes(ing.ingredientId) ? 'opacity-100 text-yellow-500 scale-110' : 'text-gray-300 hover:text-yellow-400 hover:scale-110'
                      }`}
                  >
                    <i className={`bi ${favorites.includes(ing.ingredientId) ? 'bi-star-fill' : 'bi-star'}`}></i>
                  </div>

                  <div className={`text-right ${selectedIngredient === ing.ingredientId ? 'text-red-600' : 'text-gray-900'}`}>
                    <p className="text-sm font-bold">{Math.round(ing.currentStock)}</p>
                    <p className="text-[10px] opacity-70 uppercase font-bold">{ing.unit || 'uds'}</p>
                  </div>
                </button>
              ))}

              {stockSummary.length === 0 && !loading && (
                <div className="p-10 text-center text-gray-300">
                  <i className="bi bi-inbox text-4xl block mb-2 opacity-20"></i>
                  <p className="text-xs font-bold uppercase tracking-widest">Sin datos</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Área de Detalle */}
        <div className="flex-1 min-w-0">
          {selectedIngredientData ? (
            <div className="space-y-6">

              {/* Header de Detalle */}
              <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                <div className="flex items-center gap-6">
                  <div className="w-20 h-20 bg-red-50 rounded-3xl flex items-center justify-center text-3xl shadow-inner border border-red-100/50">
                    🍱
                  </div>
                  <div>
                    <div className="flex items-center gap-3">
                      <h2 className="text-3xl font-bold text-gray-900 tracking-tight">{selectedIngredientData.ingredientName}</h2>
                      <button
                        onClick={() => {
                          setEditIngredientData({
                            name: selectedIngredientData.ingredientName,
                            unitCost: selectedIngredientData.unitCost?.toString() || '0'
                          })
                          setShowEditIngredientModal(true)
                        }}
                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
                        title="Editar ingrediente"
                      >
                        <i className="bi bi-pencil-square text-xl"></i>
                      </button>
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-xs font-semibold text-gray-500 uppercase tracking-widest">{selectedIngredientData.unit || 'uds'}</span>
                      <span className={`h-2 w-2 rounded-full ${selectedIngredientData.currentStock > 0 ? 'bg-green-500' : 'bg-red-500'}`}></span>
                      <span className="text-[10px] font-bold text-gray-500 uppercase tracking-tighter">
                        {selectedIngredientData.currentStock > 0 ? 'En Stock' : 'Agotado'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-4 w-full md:w-auto">
                  <div className="bg-gray-50 px-6 py-4 rounded-2xl flex-1 md:flex-none border border-gray-100">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Costo Base</p>
                    <p className="text-2xl font-bold text-gray-900">
                      <span className="text-sm font-semibold text-gray-400 mr-1">$</span>
                      {selectedIngredientData.unitCost?.toFixed(2) || '0.00'}
                    </p>
                  </div>
                  <div className="bg-gray-50 px-6 py-4 rounded-2xl flex-1 md:flex-none border border-gray-100">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Existencias</p>
                    <p className="text-2xl font-bold text-gray-900">
                      {Math.round(selectedIngredientData.currentStock * 100) / 100}
                      <span className="text-sm font-semibold text-gray-400 ml-1">{selectedIngredientData.unit || 'uds'}</span>
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setNewMovement(prev => ({
                        ...prev,
                        ingredientName: '',
                        unitCost: selectedIngredientData.unitCost?.toString() || ''
                      }))
                      setShowMovementModal(true)
                    }}
                    className="bg-slate-900 text-white h-full px-6 py-4 rounded-2xl font-black uppercase text-xs hover:bg-black transition-all shadow-xl shadow-slate-200 active:scale-95 flex items-center gap-2"
                  >
                    <i className="bi bi-plus-lg"></i>
                    Movimiento
                  </button>
                </div>
              </div>

              {/* Historial */}
              <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="p-6 border-b border-gray-50 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                  <div>
                    <h3 className="text-lg font-bold text-gray-900">Historial de Movimientos</h3>
                    <p className="text-xs text-gray-400 font-medium">Registro detallado de entradas y salidas</p>
                  </div>

                  <div className="flex bg-gray-100 p-1 rounded-xl gap-1">
                    {(['today', 'week', 'month', 'all'] as const).map(range => (
                      <button
                        key={range}
                        onClick={() => setDateRange(range)}
                        className={`text-[10px] px-3 py-1.5 rounded-lg font-bold uppercase transition-all ${dateRange === range ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400 hover:text-gray-600'
                          }`}
                      >
                        {range === 'today' ? 'Hoy' : range === 'week' ? 'Semana' : range === 'month' ? 'Mes' : 'Todo'}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-gray-50/50">
                        <th className="px-8 py-4 text-left text-[10px] font-bold text-gray-400 uppercase tracking-widest">Fecha</th>
                        <th className="px-8 py-4 text-left text-[10px] font-bold text-gray-400 uppercase tracking-widest">Tipo</th>
                        <th className="px-8 py-4 text-right text-[10px] font-bold text-gray-400 uppercase tracking-widest">Cantidad</th>
                        <th className="px-8 py-4 text-left text-[10px] font-bold text-gray-400 uppercase tracking-widest">Notas</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 border-t border-gray-50">
                      {movements.map((m, idx) => (
                        <tr key={idx} className="hover:bg-gray-50/30 transition-colors group">
                          <td className="px-8 py-5">
                            <p className="text-sm font-bold text-slate-900">
                              {new Date(m.date).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })}
                            </p>
                            <p className="text-[10px] text-gray-400 font-medium">{new Date(m.date).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</p>
                          </td>
                          <td className="px-8 py-5">
                            <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-tight ${m.type === 'entry' ? 'bg-emerald-50 text-emerald-700' :
                              m.type === 'sale' ? 'bg-blue-50 text-blue-700' : 'bg-orange-50 text-orange-700'
                              }`}>
                              <i className={`bi ${m.type === 'entry' ? 'bi-arrow-down-left' : m.type === 'sale' ? 'bi-bag-check' : 'bi-sliders2'}`}></i>
                              {m.type === 'entry' ? 'Entrada' : m.type === 'sale' ? 'Venta' : 'Carga'}
                            </span>
                          </td>
                          <td className="px-8 py-5 text-right">
                            <p className={`text-sm font-bold ${m.type === 'sale' ? 'text-red-500' : 'text-emerald-500'}`}>
                              {m.type === 'sale' ? '-' : '+'}{m.quantity}
                            </p>
                            <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest">{selectedIngredientData.unit || 'uds'}</p>
                          </td>
                          <td className="px-8 py-5">
                            <p className="text-xs text-gray-400 font-medium italic group-hover:text-gray-600 transition-colors line-clamp-2 max-w-xs">
                              {m.notes || '— Sin notas'}
                            </p>
                          </td>
                        </tr>
                      ))}
                      {movements.length === 0 && (
                        <tr>
                          <td colSpan={4} className="px-8 py-20 text-center">
                            <div className="flex flex-col items-center gap-3">
                              <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center">
                                <i className="bi bi-clock-history text-2xl text-gray-200"></i>
                              </div>
                              <p className="text-xs font-black text-gray-300 uppercase tracking-[0.2em]">Cero actividad registrada</p>
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

            </div>
          ) : (
            <div className="bg-white rounded-[3rem] border-2 border-dashed border-gray-100 h-[600px] flex flex-col items-center justify-center text-gray-300">
              <div className="relative mb-8">
                <div className="absolute inset-0 bg-red-100 blur-[80px] opacity-20 animate-pulse"></div>
                <div className="relative w-32 h-32 bg-gray-50 rounded-[2.5rem] flex items-center justify-center shadow-inner border border-white">
                  <i className="bi bi-box-seam text-6xl opacity-20"></i>
                </div>
              </div>
              <h3 className="text-xl font-bold text-gray-900 tracking-tight uppercase">Control de Stock</h3>
              <p className="text-sm mt-3 text-gray-400 font-medium max-w-[240px] text-center">
                Selecciona un insumo de la lista para ver movimientos y stock en tiempo real
              </p>
            </div>
          )}
        </div>

      </div>

      {/* Modal Re-diseñado */}
      {showMovementModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-xl z-[100] flex items-center justify-center p-4 animate-in fade-in duration-300">
          <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-md overflow-hidden border border-white/20">
            <div className="p-8 border-b border-gray-100 flex justify-between items-center bg-gray-50/30">
              <div>
                <h3 className="text-2xl font-bold text-gray-900">Registrar</h3>
                <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-1">Existencias e Insumos</p>
              </div>
              <button
                onClick={() => setShowMovementModal(false)}
                className="h-12 w-12 flex items-center justify-center rounded-2xl bg-white text-gray-400 hover:bg-red-50 hover:text-red-500 shadow-sm transition-all text-2xl font-light"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleCreateMovement} className="p-8 space-y-6">
              {!selectedIngredient && (
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">Nuevo Insumo</label>
                  <input
                    type="text"
                    required
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl p-4 text-gray-900 font-bold focus:bg-white focus:border-red-500 transition-all placeholder:text-gray-300 outline-none"
                    placeholder="Nombre del insumo..."
                    value={newMovement.ingredientName}
                    onChange={e => setNewMovement({ ...newMovement, ingredientName: e.target.value })}
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">Tipo</label>
                  <div className="relative">
                    <select
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl p-4 text-gray-900 font-bold focus:bg-white focus:border-red-500 transition-all appearance-none outline-none"
                      value={newMovement.type}
                      onChange={e => setNewMovement({ ...newMovement, type: e.target.value as any })}
                    >
                      <option value="entry">Entrada (+)</option>
                      <option value="adjustment">Carga (+/-)</option>
                      <option value="sale">Gasto (-)</option>
                    </select>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">Cantidad</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl p-4 text-gray-900 font-bold focus:bg-white focus:border-red-500 transition-all outline-none"
                    placeholder="0.00"
                    value={newMovement.quantity}
                    onChange={e => setNewMovement({ ...newMovement, quantity: e.target.value })}
                  />
                </div>
              </div>

              {newMovement.type === 'entry' && (
                <div className="space-y-2 animate-in slide-in-from-top-2 duration-300">
                  <label className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest ml-1">Costo Unitario ($)</label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-emerald-600 font-bold">$</span>
                    <input
                      type="number"
                      step="0.01"
                      className="w-full bg-emerald-50/30 border border-emerald-100 rounded-xl pl-8 pr-4 py-4 text-gray-900 font-bold focus:bg-white focus:border-emerald-500 transition-all outline-none"
                      placeholder="0.00"
                      value={newMovement.unitCost}
                      onChange={e => setNewMovement({ ...newMovement, unitCost: e.target.value })}
                    />
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">Notas</label>
                <textarea
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl p-4 text-gray-900 font-medium h-24 focus:bg-white focus:border-gray-400 resize-none transition-all placeholder:text-gray-300 text-sm outline-none"
                  placeholder="Detalles adicionales..."
                  value={newMovement.notes}
                  onChange={e => setNewMovement({ ...newMovement, notes: e.target.value })}
                ></textarea>
              </div>

              <div className="flex gap-4 pt-2">
                <button
                  type="submit"
                  className="w-full bg-red-600 text-white px-8 py-4 rounded-xl font-bold uppercase text-xs hover:bg-red-700 shadow-lg shadow-red-100 transition-all active:scale-95"
                >
                  Guardar Movimiento
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Editar Ingrediente */}
      {showEditIngredientModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-xl z-[100] flex items-center justify-center p-4 animate-in fade-in duration-300">
          <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-md overflow-hidden border border-white/20">
            <div className="p-8 border-b border-gray-100 flex justify-between items-center bg-gray-50/30">
              <div>
                <h3 className="text-2xl font-bold text-gray-900">Editar Insumo</h3>
                <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-1">Configuración de Biblioteca</p>
              </div>
              <button
                onClick={() => setShowEditIngredientModal(false)}
                className="w-10 h-10 flex items-center justify-center rounded-2xl hover:bg-gray-100 text-gray-400 transition-colors"
              >
                <i className="bi bi-x-lg"></i>
              </button>
            </div>

            <form onSubmit={handleUpdateIngredient} className="p-8 space-y-6">
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">Nombre del Insumo</label>
                <input
                  type="text"
                  required
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl p-4 text-gray-900 font-bold focus:bg-white focus:border-red-500 transition-all outline-none"
                  value={editIngredientData.name}
                  onChange={e => setEditIngredientData({ ...editIngredientData, name: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">Costo Base ($)</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold">$</span>
                  <input
                    type="number"
                    step="0.01"
                    required
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl pl-8 pr-4 py-4 text-gray-900 font-bold focus:bg-white focus:border-red-500 transition-all outline-none"
                    value={editIngredientData.unitCost}
                    onChange={e => setEditIngredientData({ ...editIngredientData, unitCost: e.target.value })}
                  />
                </div>
                <p className="text-[9px] text-gray-400 font-medium ml-1">Este costo se usará como sugerencia en nuevos movimientos</p>
              </div>

              <div className="flex gap-4 pt-2">
                <button
                  type="submit"
                  className="w-full bg-red-600 text-white px-8 py-4 rounded-xl font-bold uppercase text-xs hover:bg-red-700 shadow-lg shadow-red-100 transition-all active:scale-95"
                >
                  Guardar Cambios
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <style jsx>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #e2e8f0;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #cbd5e1;
        }
      `}</style>
    </div>
  )
}
