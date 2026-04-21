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
  updateIngredientLibraryItem,
  addFavoriteIngredient,
  removeFavoriteIngredient,
  getFavoriteIngredients
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
  const [showAllIngredients, setShowAllIngredients] = useState(false)
  const [showHistoryModal, setShowHistoryModal] = useState(false)
  const [historyIngredient, setHistoryIngredient] = useState<IngredientStockSummary | null>(null)
  const [historyMovements, setHistoryMovements] = useState<IngredientStockMovement[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
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
      loadFavoriteIngredients()
    }
  }, [business?.id])

  const loadFavoriteIngredients = async () => {
    if (!business?.id) return
    try {
      const favIngredients = await getFavoriteIngredients(business.id)
      setFavorites(favIngredients)
    } catch (error) {
      console.error('Error loading favorite ingredients:', error)
      setFavorites([])
    }
  }

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

  const toggleFavorite = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!business?.id) return
    
    const isFav = favorites.includes(id)
    
    try {
      if (isFav) {
        await removeFavoriteIngredient(business.id, id)
        setFavorites(prev => prev.filter(f => f !== id))
      } else {
        await addFavoriteIngredient(business.id, id)
        setFavorites(prev => [...prev, id])
      }
    } catch (error) {
      console.error('Error toggling favorite:', error)
      // Revert the change on error
      if (isFav) {
        setFavorites(prev => [...prev, id])
      } else {
        setFavorites(prev => prev.filter(f => f !== id))
      }
    }
  }
  
  const openMovementForIngredient = (ing: IngredientStockSummary, e: React.MouseEvent) => {
    e.stopPropagation()
    setNewMovement({
      ingredientName: ing.ingredientName,
      type: 'entry',
      quantity: '',
      date: new Date().toISOString().split('T')[0],
      notes: '',
      unitCost: ing.unitCost?.toString() || ''
    })
    setSelectedIngredient(ing.ingredientId)
    setShowMovementModal(true)
  }

  const openHistoryForIngredient = async (ing: IngredientStockSummary, e: React.MouseEvent) => {
    e.stopPropagation()
    setHistoryIngredient(ing)
    setShowHistoryModal(true)
    setLoadingHistory(true)
    try {
      if (business?.id) {
        const history = await getStockMovements(business.id, ing.ingredientId)
        setHistoryMovements(history)
      }
    } catch (error) {
      console.error('Error loading history:', error)
    } finally {
      setLoadingHistory(false)
    }
  }

  const groupedMovements = useMemo(() => {
    const groups: { [key: string]: IngredientStockMovement[] } = {}
    historyMovements.forEach(m => {
      if (!groups[m.date]) groups[m.date] = []
      groups[m.date].push(m)
    })
    return Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0]))
  }, [historyMovements])

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

  const { favoriteIngredients, otherIngredients } = useMemo(() => {
    return {
      favoriteIngredients: sortedSummary.filter(ing => favorites.includes(ing.ingredientId)),
      otherIngredients: sortedSummary.filter(ing => !favorites.includes(ing.ingredientId))
    }
  }, [sortedSummary, favorites])

  return (
    <div className="animate-in fade-in duration-500">
      <div className="flex flex-col lg:flex-row gap-6">

        {/* Sidebar de Ingredientes */}
        <div className="lg:w-80 flex-shrink-0">
          <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden sticky top-24">
            <div className="p-6 border-b border-gray-100 bg-gray-50/30">
              <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest">Ingredientes</h3>
            </div>

            <div className="max-h-[calc(100vh-300px)] overflow-y-auto custom-scrollbar">
              {favoriteIngredients.map(ing => (
                <div
                  key={ing.ingredientId}
                  onClick={() => setSelectedIngredient(ing.ingredientId)}
                  className={`w-full text-left p-4 transition-all flex items-center gap-4 group relative cursor-pointer ${selectedIngredient === ing.ingredientId ? 'bg-red-50 border-l-4 border-red-500' : 'hover:bg-gray-50 border-l-4 border-transparent'
                    }`}
                >
                                     <div className="flex-1 pr-4">
                    <p className={`font-bold text-sm ${selectedIngredient === ing.ingredientId ? 'text-red-700' : 'text-gray-900'}`}>
                      {ing.ingredientName}
                    </p>
                    <p className={`text-[10px] font-semibold ${selectedIngredient === ing.ingredientId ? 'text-red-400' : 'text-gray-500'}`}>
                      ${ing.unitCost?.toFixed(2) || '0.00'} / {ing.unit || 'uds'}
                    </p>
                  </div>

                  <div className={`text-right ${selectedIngredient === ing.ingredientId ? 'text-red-600' : 'text-gray-900'} flex items-center gap-2`}>
                    <div>
                      <p className="text-sm font-bold">{Math.round(ing.currentStock)}</p>
                      <p className="text-[10px] opacity-70 uppercase font-bold">{ing.unit || 'uds'}</p>
                    </div>

                    {/* Action Buttons Container */}
                    <div className="flex items-center gap-1">
                      {/* Register Movement Shortcut */}
                      <button
                        onClick={(e) => openMovementForIngredient(ing, e)}
                        className="p-2 rounded-full text-red-500 hover:bg-red-50 transition-all duration-300 z-20"
                        title="Registrar Movimiento"
                      >
                        <i className="bi bi-plus-circle-fill text-lg"></i>
                      </button>

                      {/* Three-dot Menu */}
                      <div className="relative">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setOpenMenuId(openMenuId === ing.ingredientId ? null : ing.ingredientId)
                          }}
                          className="p-2 rounded-full text-gray-400 hover:bg-gray-100 transition-all duration-300 z-20"
                          title="Más opciones"
                        >
                          <i className="bi bi-three-dots-vertical text-lg"></i>
                        </button>

                        {openMenuId === ing.ingredientId && (
                          <div className="absolute right-0 top-full mt-1 bg-white rounded-xl shadow-lg border border-gray-100 py-1 min-w-[140px] z-50">
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                openHistoryForIngredient(ing, e)
                                setOpenMenuId(null)
                              }}
                              className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-600 flex items-center gap-2 transition-colors"
                            >
                              <i className="bi bi-clock-history"></i>
                              Ver movimientos
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                toggleFavorite(ing.ingredientId, e)
                                setOpenMenuId(null)
                              }}
                              className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-yellow-50 hover:text-yellow-600 flex items-center gap-2 transition-colors"
                            >
                              <i className={`bi ${favorites.includes(ing.ingredientId) ? 'bi-star-fill' : 'bi-star'}`}></i>
                              {favorites.includes(ing.ingredientId) ? 'Quitar favorito' : 'Añadir favorito'}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              {otherIngredients.length > 0 && (
                <div className="bg-gray-50/50 border-t border-gray-100">
                  <button 
                    onClick={() => setShowAllIngredients(!showAllIngredients)}
                    className="w-full py-3 px-4 text-[10px] font-bold text-gray-500 uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-gray-100 transition-colors"
                  >
                    <span>{showAllIngredients ? 'Ver menos' : `Ver otros ingredientes (${otherIngredients.length})`}</span>
                    <i className={`bi bi-chevron-${showAllIngredients ? 'up' : 'down'}`}></i>
                  </button>
                  
                  {showAllIngredients && otherIngredients.map(ing => (
                    <div
                      key={ing.ingredientId}
                      onClick={() => setSelectedIngredient(ing.ingredientId)}
                      className={`w-full text-left p-4 transition-all flex items-center gap-4 group relative cursor-pointer ${selectedIngredient === ing.ingredientId ? 'bg-red-50 border-l-4 border-red-500' : 'hover:bg-gray-50 border-l-4 border-transparent'
                        }`}
                    >
                                     <div className="flex-1 pr-4">
                        <p className={`font-bold text-sm ${selectedIngredient === ing.ingredientId ? 'text-red-700' : 'text-gray-900'}`}>
                          {ing.ingredientName}
                        </p>
                        <p className={`text-[10px] font-semibold ${selectedIngredient === ing.ingredientId ? 'text-red-400' : 'text-gray-500'}`}>
                          ${ing.unitCost?.toFixed(2) || '0.00'} / {ing.unit || 'uds'}
                        </p>
                      </div>

                      <div className={`text-right ${selectedIngredient === ing.ingredientId ? 'text-red-600' : 'text-gray-900'} flex items-center gap-2`}>
                        <div>
                          <p className="text-sm font-bold">{Math.round(ing.currentStock)}</p>
                          <p className="text-[10px] opacity-70 uppercase font-bold">{ing.unit || 'uds'}</p>
                        </div>

                        {/* Action Buttons Container */}
                        <div className="flex items-center gap-1">
                          {/* Register Movement Shortcut */}
                          <button
                            onClick={(e) => openMovementForIngredient(ing, e)}
                            className="p-2 rounded-full text-red-500 hover:bg-red-50 transition-all duration-300 z-20"
                            title="Registrar Movimiento"
                          >
                            <i className="bi bi-plus-circle-fill text-lg"></i>
                          </button>

                          {/* Three-dot Menu */}
                          <div className="relative">
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                setOpenMenuId(openMenuId === ing.ingredientId ? null : ing.ingredientId)
                              }}
                              className="p-2 rounded-full text-gray-400 hover:bg-gray-100 transition-all duration-300 z-20"
                              title="Más opciones"
                            >
                              <i className="bi bi-three-dots-vertical text-lg"></i>
                            </button>

                            {openMenuId === ing.ingredientId && (
                              <div className="absolute right-0 top-full mt-1 bg-white rounded-xl shadow-lg border border-gray-100 py-1 min-w-[140px] z-50">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    openHistoryForIngredient(ing, e)
                                    setOpenMenuId(null)
                                  }}
                                  className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-600 flex items-center gap-2 transition-colors"
                                >
                                  <i className="bi bi-clock-history"></i>
                                  Ver movimientos
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    toggleFavorite(ing.ingredientId, e)
                                    setOpenMenuId(null)
                                  }}
                                  className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-yellow-50 hover:text-yellow-600 flex items-center gap-2 transition-colors"
                                >
                                  <i className={`bi ${favorites.includes(ing.ingredientId) ? 'bi-star-fill' : 'bi-star'}`}></i>
                                  {favorites.includes(ing.ingredientId) ? 'Quitar favorito' : 'Añadir favorito'}
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {stockSummary.length === 0 && !loading && (
                <div className="p-10 text-center text-gray-300">
                  <i className="bi bi-inbox text-4xl block mb-2 opacity-20"></i>
                  <p className="text-xs font-bold uppercase tracking-widest">Sin datos</p>
                </div>
              )}
            </div>
          </div>
        </div>

        
      </div>

      {/* Modal Re-diseñado */}
      {showMovementModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-xl z-[100] flex items-center justify-center p-4 animate-in fade-in duration-300">
          <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-md overflow-hidden border border-white/20">
            <div className="p-8 border-b border-gray-100 flex justify-between items-center bg-gray-50/30">
              <div>
                <h3 className="text-2xl font-bold text-gray-900">Registrar Movimiento</h3>
                <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-1">
                  {selectedIngredient ? selectedIngredientData?.ingredientName || 'Ingrediente' : 'Nuevo Insumo'}
                </p>
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
      {/* Modal de Historial de Movimientos */}
      {showHistoryModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl animate-in zoom-in-95 duration-300">
            <div className="p-6 bg-blue-600 text-white flex justify-between items-center">
              <div>
                <h2 className="text-xl font-bold">Historial de Movimientos</h2>
                <p className="text-blue-100 text-sm">{historyIngredient?.ingredientName}</p>
              </div>
              <button
                onClick={() => setShowHistoryModal(false)}
                className="p-2 hover:bg-white/10 rounded-full transition-colors"
              >
                <i className="bi bi-x-lg text-xl"></i>
              </button>
            </div>

            <div className="p-6 max-h-[60vh] overflow-y-auto custom-scrollbar bg-gray-50">
              {loadingHistory ? (
                <div className="flex flex-col items-center justify-center py-12 text-gray-400 gap-4">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                  <p className="text-sm font-bold uppercase tracking-widest">Cargando historial...</p>
                </div>
              ) : groupedMovements.length > 0 ? (
                <div className="space-y-6">
                  {groupedMovements.map(([date, items]) => (
                    <div key={date} className="space-y-2">
                      <div className="flex items-center gap-2">
                        <div className="h-px flex-1 bg-gray-200"></div>
                        <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                          {new Date(date + 'T12:00:00').toLocaleDateString('es-EC', { 
                            weekday: 'long', 
                            day: 'numeric', 
                            month: 'long' 
                          })}
                        </span>
                        <div className="h-px flex-1 bg-gray-200"></div>
                      </div>
                      <div className="space-y-1">
                        {items.map((m, i) => (
                          <div 
                            key={i} 
                            className="bg-white p-3 rounded-xl border border-gray-100 flex items-center justify-between shadow-sm"
                          >
                            <div className="flex items-center gap-3">
                              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                                m.type === 'entry' ? 'bg-green-100 text-green-600' :
                                m.type === 'sale' ? 'bg-indigo-100 text-indigo-600' :
                                'bg-orange-100 text-orange-600'
                              }`}>
                                <i className={`bi ${
                                  m.type === 'entry' ? 'bi-plus-lg' :
                                  m.type === 'sale' ? 'bi-cart' :
                                  'bi-gear'
                                }`}></i>
                              </div>
                              <div>
                                <p className="text-sm font-bold text-gray-900 capitalize">
                                  {m.type === 'entry' ? 'Entrada' : m.type === 'sale' ? 'Venta' : 'Ajuste'}
                                </p>
                                {m.notes && <p className="text-[10px] text-gray-500">{m.notes}</p>}
                              </div>
                            </div>
                            <div className="text-right">
                              <p className={`text-sm font-black ${
                                m.type === 'entry' ? 'text-green-600' :
                                m.type === 'sale' ? 'text-red-600' :
                                'text-gray-900'
                              }`}>
                                {m.type === 'entry' || (m.type === 'adjustment' && m.quantity > 0) ? '+' : ''}{m.quantity}
                              </p>
                              <p className="text-[10px] font-bold text-gray-400 uppercase">{historyIngredient?.unit || 'uds'}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-gray-300 gap-2">
                  <i className="bi bi-clock-history text-4xl opacity-20"></i>
                  <p className="text-sm font-bold uppercase tracking-widest">Sin movimientos registrados</p>
                </div>
              )}
            </div>

            <div className="p-6 border-t border-gray-100 bg-white flex justify-end">
              <button
                onClick={() => setShowHistoryModal(false)}
                className="px-6 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-xl font-bold transition-colors"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
