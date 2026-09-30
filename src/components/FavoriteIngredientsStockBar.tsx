'use client'

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Business } from '@/types'
import {
  getIngredientStockSummary,
  getFavoriteIngredients,
  IngredientStockSummary,
  recordStockMovement
} from '@/lib/database'
import { db } from '@/lib/firebase'
import { collection, query, where, onSnapshot, doc } from 'firebase/firestore'
import StockConfigModal from '@/components/StockConfigModal'

interface FavoriteIngredientsStockBarProps {
  business: Business
  onNavigateToInventory?: () => void
}

export default function FavoriteIngredientsStockBar({
  business,
  onNavigateToInventory
}: FavoriteIngredientsStockBarProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [stockSummary, setStockSummary] = useState<IngredientStockSummary[]>([])
  const [favoriteIds, setFavoriteIds] = useState<string[]>(business.favoriteIngredients || [])
  const [loading, setLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [stockConfigIngredient, setStockConfigIngredient] = useState<IngredientStockSummary | null>(null)
  const [quickAddIngredient, setQuickAddIngredient] = useState<IngredientStockSummary | null>(null)
  const [quickAddQty, setQuickAddQty] = useState<string>('10')
  const [savingQuickAdd, setSavingQuickAdd] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)

  // Cargar datos de stock y favoritos
  const loadStockData = useCallback(async (showIndicator = false) => {
    if (!business?.id) return
    if (showIndicator) setIsRefreshing(true)
    try {
      const [summary, favs] = await Promise.all([
        getIngredientStockSummary(business.id),
        getFavoriteIngredients(business.id)
      ])
      setStockSummary(summary)
      if (favs && favs.length > 0) {
        setFavoriteIds(favs)
      } else if (business.favoriteIngredients) {
        setFavoriteIds(business.favoriteIngredients)
      }
    } catch (error) {
      console.error('Error al cargar stock de ingredientes favoritos:', error)
    } finally {
      setLoading(false)
      if (showIndicator) setIsRefreshing(false)
    }
  }, [business?.id, business?.favoriteIngredients])

  // Carga inicial y listeners en tiempo real
  useEffect(() => {
    if (!business?.id) return

    loadStockData()

    // 1. Listener en tiempo real para movimientos de stock
    const movementsRef = collection(db, 'ingredientStockMovements')
    const qMovements = query(movementsRef, where('businessId', '==', business.id))
    const unsubscribeMovements = onSnapshot(
      qMovements,
      () => {
        loadStockData()
      },
      (error) => {
        console.error('Error en listener de movimientos de stock:', error)
      }
    )

    // 2. Listener en tiempo real para cambios en los favoritos del negocio
    const businessDocRef = doc(db, 'businesses', business.id)
    const unsubscribeBusiness = onSnapshot(
      businessDocRef,
      (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data()
          if (Array.isArray(data?.favoriteIngredients)) {
            setFavoriteIds(data.favoriteIngredients)
          }
        }
      },
      (error) => {
        console.error('Error en listener de negocio para favoritos:', error)
      }
    )

    // Limpieza de suscripciones
    return () => {
      unsubscribeMovements()
      unsubscribeBusiness()
    }
  }, [business?.id, loadStockData])

  // Cerrar al hacer clic fuera
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  // Cerrar con Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown)
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  // Filtrar y ordenar los ingredientes marcados como favoritos
  const favoriteIngredients = useMemo(() => {
    if (!favoriteIds || favoriteIds.length === 0 || stockSummary.length === 0) {
      return []
    }

    const normalize = (name: string) => name.trim().toLowerCase()

    return stockSummary.filter(ing => {
      const normName = normalize(ing.ingredientName)
      const genId = `ing_${normName.replace(/\s+/g, '_')}`
      return (
        favoriteIds.includes(ing.ingredientId) ||
        favoriteIds.includes(genId) ||
        (ing.libraryId && favoriteIds.includes(ing.libraryId)) ||
        favoriteIds.includes(normName)
      )
    })
  }, [stockSummary, favoriteIds])

  // Estadísticas globales de favoritos
  const stats = useMemo(() => {
    let outOfStockCount = 0
    let lowStockCount = 0
    let optimalCount = 0

    favoriteIngredients.forEach(ing => {
      if (ing.isStockLimited) {
        if (ing.currentStock <= 0) {
          outOfStockCount++
        } else if (ing.currentStock <= (ing.minStock ?? 0)) {
          lowStockCount++
        } else {
          optimalCount++
        }
      } else {
        optimalCount++
      }
    })

    return {
      outOfStockCount,
      lowStockCount,
      optimalCount,
      total: favoriteIngredients.length,
      hasOutOfStock: outOfStockCount > 0,
      hasLowStock: lowStockCount > 0
    }
  }, [favoriteIngredients])

  // Manejar adición rápida de existencias
  const handleQuickAdd = (e: React.FormEvent) => {
    e.preventDefault()
    if (!quickAddIngredient || !business?.id) return
    const qty = parseFloat(quickAddQty)
    if (isNaN(qty) || qty <= 0) return

    const targetIngId = quickAddIngredient.ingredientId
    const targetName = quickAddIngredient.ingredientName
    const targetUnit = quickAddIngredient.unit || 'uds'

    // 1. Actualización optimista inmediata en memoria (0ms de espera)
    setStockSummary(prev => prev.map(item => {
      if (item.ingredientId === targetIngId) {
        return {
          ...item,
          currentStock: item.currentStock + qty
        }
      }
      return item
    }))

    // Cerrar modal al instante
    setQuickAddIngredient(null)
    setQuickAddQty('10')

    // 2. Guardar en segundo plano en Firebase
    const today = new Date().toISOString().split('T')[0]
    recordStockMovement({
      businessId: business.id,
      ingredientId: targetIngId,
      ingredientName: targetName,
      type: 'entry',
      quantity: qty,
      date: today,
      notes: `Entrada rápida (+${qty} ${targetUnit})`
    }).catch(error => {
      console.error('Error al registrar entrada rápida de stock en segundo plano:', error)
      alert(`Error al guardar entrada de stock para "${targetName}"`)
      loadStockData(false)
    })
  }

  return (
    <div className="relative" ref={containerRef}>
      {/* Botón Disparador (Ícono en la esquina superior derecha) */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          setIsOpen(!isOpen)
        }}
        className={`relative p-1.5 sm:p-2 rounded-lg transition-all duration-200 flex items-center justify-center ${
          isOpen
            ? 'bg-amber-100/80 text-amber-800 shadow-sm'
            : stats.hasOutOfStock
            ? 'text-rose-600 bg-rose-50 hover:bg-rose-100/80'
            : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
        }`}
        title={
          stats.hasOutOfStock
            ? `¡Atención! Hay ${stats.outOfStockCount} ingrediente(s) sin stock`
            : stats.hasLowStock
            ? `Alerta: Hay ${stats.lowStockCount} ingrediente(s) con stock bajo`
            : 'Ver stock de ingredientes favoritos'
        }
        aria-label="Stock de ingredientes favoritos"
        aria-expanded={isOpen}
      >
        <i className="bi bi-boxes text-lg sm:text-xl"></i>

        {/* Punto de Notificación: Si hay al menos un producto sin stock */}
        {stats.hasOutOfStock ? (
          <span className="absolute -top-0.5 -right-0.5 flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-rose-600 ring-2 ring-white"></span>
          </span>
        ) : stats.hasLowStock ? (
          /* Punto de notificación ámbar si no hay en 0 pero sí con stock bajo */
          <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500 ring-2 ring-white"></span>
          </span>
        ) : null}
      </button>

      {/* Overlay translúcido en móviles para cerrar al tocar fuera */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/20 backdrop-blur-[1px] z-[65] md:hidden"
          onClick={(e) => {
            e.stopPropagation()
            setIsOpen(false)
          }}
        />
      )}

      {/* Panel Desplegable (Popover) desde la esquina superior derecha */}
      {isOpen && (
        <div 
          onClick={(e) => e.stopPropagation()}
          className="fixed inset-x-3 top-16 md:absolute md:inset-auto md:right-0 md:top-full md:mt-2 md:w-[480px] bg-white rounded-2xl shadow-2xl border border-gray-100 z-[70] overflow-hidden flex flex-col max-h-[85vh] md:max-h-[75vh] animate-in fade-in slide-in-from-top-2 duration-200"
        >
          {/* Cabecera del Panel */}
          <div className="px-4 py-3 bg-gradient-to-r from-gray-50/90 via-white to-gray-50/40 border-b border-gray-100 flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-500 shrink-0">
                <i className="bi bi-star-fill text-sm"></i>
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-black text-gray-900 tracking-tight leading-tight truncate">
                    Stock de Favoritos
                  </h3>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 text-gray-600">
                    {favoriteIngredients.length} fijado{favoriteIngredients.length === 1 ? '' : 's'}
                  </span>
                </div>
                <p className="text-[10px] font-medium text-gray-400 truncate">
                  Monitoreo de ingredientes clave en tiempo real
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {/* Badges de alertas */}
              {stats.outOfStockCount > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-50 text-rose-600 text-[10px] font-black border border-rose-100">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse"></span>
                  {stats.outOfStockCount} sin stock
                </span>
              )}

              {/* Botón Refrescar */}
              <button
                onClick={() => loadStockData(true)}
                disabled={isRefreshing}
                className={`p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-all ${
                  isRefreshing ? 'animate-spin text-amber-500' : ''
                }`}
                title="Actualizar stock"
              >
                <i className="bi bi-arrow-repeat text-sm"></i>
              </button>

              {/* Enlace rápido a Inventario */}
              {onNavigateToInventory && (
                <button
                  onClick={() => {
                    setIsOpen(false)
                    onNavigateToInventory()
                  }}
                  className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-all text-xs font-bold flex items-center gap-1"
                  title="Gestionar en Inventario"
                >
                  <i className="bi bi-boxes"></i>
                </button>
              )}

              {/* Botón Cerrar */}
              <button
                onClick={() => setIsOpen(false)}
                className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-all"
                title="Cerrar panel"
              >
                <i className="bi bi-x-lg text-xs"></i>
              </button>
            </div>
          </div>

          {/* Contenido / Listado con Barras Visuales de Stock */}
          <div className="p-3.5 space-y-2.5 overflow-y-auto flex-1 custom-scrollbar">
            {loading && stockSummary.length === 0 ? (
              <div className="space-y-3 py-2">
                {[1, 2, 3].map(idx => (
                  <div key={idx} className="bg-gray-50/70 rounded-xl p-3 border border-gray-100 animate-pulse space-y-2">
                    <div className="h-3.5 bg-gray-200 rounded w-1/2"></div>
                    <div className="h-2 bg-gray-200 rounded-full w-full"></div>
                  </div>
                ))}
              </div>
            ) : favoriteIngredients.length === 0 ? (
              <div className="py-8 px-4 text-center">
                <div className="w-12 h-12 rounded-2xl bg-amber-50 flex items-center justify-center text-amber-500 mx-auto mb-3">
                  <i className="bi bi-star text-2xl"></i>
                </div>
                <h4 className="text-sm font-black text-gray-900 tracking-tight mb-1">
                  Sin ingredientes favoritos
                </h4>
                <p className="text-xs font-medium text-gray-500 leading-relaxed mb-4 max-w-xs mx-auto">
                  Marca tus ingredientes con la estrella en la pestaña de Inventario para consultar su stock en barra aquí en cualquier momento.
                </p>
                {onNavigateToInventory && (
                  <button
                    onClick={() => {
                      setIsOpen(false)
                      onNavigateToInventory()
                    }}
                    className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-bold transition-all shadow-sm shadow-amber-500/20 inline-flex items-center gap-2 active:scale-95"
                  >
                    <i className="bi bi-boxes"></i>
                    Ir a Inventario
                  </button>
                )}
              </div>
            ) : (
              favoriteIngredients.map((ing) => {
                const isLimited = ing.isStockLimited ?? false
                const stockVal = Math.round(ing.currentStock)
                const minVal = ing.minStock ?? 0
                const isOutOfStock = isLimited && stockVal <= 0
                const isLowStock = isLimited && !isOutOfStock && stockVal <= minVal

                // Referencia máxima para el cálculo de porcentaje en la barra
                const maxRef = Math.max(
                  stockVal,
                  (minVal > 0 ? minVal * 2.5 : 20),
                  10
                )
                const percentage = isLimited
                  ? Math.min(100, Math.max(isOutOfStock ? 2 : 5, Math.round((stockVal / maxRef) * 100)))
                  : 100

                // Clases de color para la barra y bordes
                let barColor = 'bg-gradient-to-r from-emerald-500 to-teal-500'
                let badgeBg = 'bg-emerald-50 text-emerald-700 border-emerald-100'
                let borderCard = 'border-gray-100 hover:border-gray-200'

                if (isOutOfStock) {
                  barColor = 'bg-gradient-to-r from-rose-500 to-red-600'
                  badgeBg = 'bg-rose-50 text-rose-700 border-rose-200'
                  borderCard = 'border-rose-200 bg-rose-50/20'
                } else if (isLowStock) {
                  barColor = 'bg-gradient-to-r from-amber-400 to-orange-500'
                  badgeBg = 'bg-amber-50 text-amber-700 border-amber-200'
                  borderCard = 'border-amber-200 bg-amber-50/15'
                }

                return (
                  <div
                    key={ing.ingredientId}
                    className={`rounded-xl border p-3 transition-all duration-200 bg-white flex flex-col gap-2 ${borderCard}`}
                  >
                    {/* Fila 1: Nombre, Mínimo y Botones de Acción */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                              isOutOfStock
                                ? 'bg-rose-500 animate-pulse'
                                : isLowStock
                                ? 'bg-amber-500'
                                : 'bg-emerald-500'
                            }`}
                          ></span>
                          <h4
                            className="font-black text-gray-900 tracking-tight leading-tight text-xs sm:text-sm truncate"
                            title={ing.ingredientName}
                          >
                            {ing.ingredientName}
                          </h4>
                        </div>
                        <p className="text-[10px] font-medium text-gray-400 mt-0.5 truncate pl-3">
                          {isLimited ? (
                            minVal > 0 ? (
                              <span>Mínimo seguro: {minVal} {ing.unit || 'uds'}</span>
                            ) : (
                              <span>Sin mínimo definido</span>
                            )
                          ) : (
                            <span className="text-emerald-600 font-semibold">Stock ilimitado</span>
                          )}
                        </p>
                      </div>

                      {/* Botones de acción rápida: Configurar y Entrada Rápida */}
                      <div className="flex items-center gap-1 shrink-0">
                        {isLimited && (
                          <button
                            type="button"
                            onClick={() => {
                              setQuickAddIngredient(ing)
                              setQuickAddQty('10')
                            }}
                            className="w-6 h-6 rounded-lg bg-gray-50 hover:bg-emerald-50 text-gray-400 hover:text-emerald-600 flex items-center justify-center transition-colors text-xs"
                            title={`Sumar stock a ${ing.ingredientName}`}
                          >
                            <i className="bi bi-plus-lg"></i>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setStockConfigIngredient(ing)}
                          className="w-6 h-6 rounded-lg bg-gray-50 hover:bg-gray-100 text-gray-400 hover:text-gray-700 flex items-center justify-center transition-colors text-xs"
                          title="Ajustar configuración de stock"
                        >
                          <i className="bi bi-sliders"></i>
                        </button>
                      </div>
                    </div>

                    {/* Fila 2: Valor Numérico y Badge de Estado */}
                    <div className="flex items-baseline justify-between gap-2 pt-0.5">
                      <div className="flex items-baseline gap-1">
                        {isLimited ? (
                          <>
                            <span
                              className={`text-base font-black tracking-tight leading-none ${
                                isOutOfStock
                                  ? 'text-rose-600'
                                  : isLowStock
                                  ? 'text-amber-600'
                                  : 'text-gray-900'
                              }`}
                            >
                              {stockVal}
                            </span>
                            <span className="text-[10px] font-bold uppercase text-gray-400">
                              {ing.unit || 'uds'}
                            </span>
                          </>
                        ) : (
                          <span className="text-sm font-black text-emerald-600 flex items-center gap-1 leading-none">
                            <i className="bi bi-infinity text-base"></i>
                            <span className="text-[10px] uppercase font-bold tracking-tight">Ilimitado</span>
                          </span>
                        )}
                      </div>

                      <span
                        className={`text-[9px] font-bold px-2 py-0.5 rounded-full border flex items-center gap-1 ${badgeBg}`}
                      >
                        {isOutOfStock ? (
                          <>
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse"></span>
                            Sin Stock
                          </>
                        ) : isLowStock ? (
                          <>
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                            Stock Bajo
                          </>
                        ) : (
                          <>
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                            {isLimited ? `${percentage}%` : 'Óptimo'}
                          </>
                        )}
                      </span>
                    </div>

                    {/* Fila 3: Barra Visual de Stock */}
                    <div className="w-full">
                      <div
                        className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden p-0.5 border border-gray-200/50"
                        title={
                          isLimited
                            ? `Quedan ${stockVal} ${ing.unit || 'uds'} (mínimo: ${minVal})`
                            : 'Stock no limitado'
                        }
                      >
                        <div
                          className={`h-full rounded-full transition-all duration-500 ease-out ${barColor}`}
                          style={{
                            width: `${percentage}%`
                          }}
                        />
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>

          {/* Pie del Panel */}
          {favoriteIngredients.length > 0 && onNavigateToInventory && (
            <div className="px-4 py-2.5 bg-gray-50/60 border-t border-gray-100 flex items-center justify-between shrink-0">
              <span className="text-[10px] font-medium text-gray-400">
                ¿Necesitas agregar más favoritos?
              </span>
              <button
                onClick={() => {
                  setIsOpen(false)
                  onNavigateToInventory()
                }}
                className="text-[11px] font-bold text-amber-600 hover:text-amber-700 flex items-center gap-1 transition-colors"
              >
                <span>Administrar en Inventario</span>
                <i className="bi bi-arrow-right text-[10px]"></i>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Modal para Ajustar Stock de un Ingrediente */}
      {stockConfigIngredient && business?.id && (
        <StockConfigModal
          businessId={business.id}
          ingredient={stockConfigIngredient}
          onClose={() => setStockConfigIngredient(null)}
          onSaved={(optimisticUpdate) => {
            if (optimisticUpdate) {
              setStockSummary(prev => prev.map(item => {
                if (item.ingredientId === stockConfigIngredient.ingredientId) {
                  return { ...item, ...optimisticUpdate }
                }
                return item
              }))
            }
          }}
        />
      )}

      {/* Modal / Diálogo para Entrada Rápida de Stock */}
      {quickAddIngredient && (
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden border border-gray-100">
            <div className="p-6 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between">
              <div>
                <span className="text-[10px] font-black uppercase tracking-widest text-emerald-600">Entrada Rápida</span>
                <h3 className="text-lg font-black text-gray-900 tracking-tight leading-tight mt-0.5">
                  {quickAddIngredient.ingredientName}
                </h3>
              </div>
              <button
                onClick={() => setQuickAddIngredient(null)}
                className="w-8 h-8 rounded-full hover:bg-gray-200 text-gray-400 hover:text-gray-700 flex items-center justify-center transition-colors"
              >
                <i className="bi bi-x-lg text-sm"></i>
              </button>
            </div>

            <form onSubmit={handleQuickAdd} className="p-6 space-y-4">
              <div className="bg-gray-50 p-3 rounded-2xl border border-gray-100 flex items-center justify-between">
                <span className="text-xs font-bold text-gray-500">Stock Actual:</span>
                <span className="text-sm font-black text-gray-900">
                  {Math.round(quickAddIngredient.currentStock)} {quickAddIngredient.unit || 'uds'}
                </span>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                  Cantidad a Ingresar ({quickAddIngredient.unit || 'uds'})
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="any"
                    min="0.1"
                    required
                    value={quickAddQty}
                    onChange={(e) => setQuickAddQty(e.target.value)}
                    placeholder="Ej. 10"
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl font-bold text-gray-900 text-base focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                    autoFocus
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
                    {[5, 10, 20].map(quickNum => (
                      <button
                        key={quickNum}
                        type="button"
                        onClick={() => setQuickAddQty(quickNum.toString())}
                        className="px-2 py-1 bg-white border border-gray-200 hover:bg-emerald-50 hover:text-emerald-700 rounded-lg text-[10px] font-bold text-gray-600 transition-colors shadow-2xs"
                      >
                        +{quickNum}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setQuickAddIngredient(null)}
                  className="flex-1 py-2.5 rounded-xl border border-gray-200 text-xs font-bold text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-all shadow-sm shadow-emerald-600/30 flex items-center justify-center gap-1.5 active:scale-95"
                >
                  <i className="bi bi-check-lg text-sm"></i>
                  <span>Agregar Stock</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
