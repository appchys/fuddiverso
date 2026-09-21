'use client'

import React, { useState } from 'react'
import { IngredientStockSummary, saveIngredientStockConfig } from '@/lib/database'

interface StockConfigModalProps {
  businessId: string
  ingredient: IngredientStockSummary
  onClose: () => void
  onSaved: () => Promise<void> | void
}

export default function StockConfigModal({ businessId, ingredient, onClose, onSaved }: StockConfigModalProps) {
  const [isStockLimited, setIsStockLimited] = useState(ingredient.isStockLimited ?? false)
  const [availableStock, setAvailableStock] = useState(Math.round(ingredient.currentStock).toString())
  const [minStock, setMinStock] = useState((ingredient.minStock ?? 0).toString())
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      await saveIngredientStockConfig(businessId, ingredient.ingredientName, ingredient.libraryId, {
        isStockLimited,
        minStock: parseFloat(minStock) || 0,
        targetStock: isStockLimited ? (parseFloat(availableStock) || 0) : undefined,
        currentStock: ingredient.currentStock
      })
      await onSaved()
      onClose()
    } catch (error) {
      console.error('Error guardando configuración de stock:', error)
      alert('Error al guardar la configuración de stock')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-xl z-[100] flex items-center justify-center p-4 animate-in fade-in duration-300">
      <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-md overflow-hidden border border-white/20">
        <div className="p-8 border-b border-gray-100 flex justify-between items-center bg-gray-50/30">
          <div>
            <h3 className="text-2xl font-black text-gray-900 tracking-tight">Configurar Stock</h3>
            <p className="text-xs font-bold text-rose-600 uppercase tracking-widest mt-1">{ingredient.ingredientName}</p>
          </div>
          <button onClick={onClose} className="w-10 h-10 flex items-center justify-center rounded-2xl hover:bg-gray-100 text-gray-400 transition-colors">
            <i className="bi bi-x-lg"></i>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-8 space-y-6">
          <div className="space-y-3">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">Tipo de Control</label>
            <div className="grid grid-cols-2 gap-3">
              <button type="button" onClick={() => setIsStockLimited(false)} className={`p-4 rounded-2xl border text-left transition-all flex flex-col gap-2 ${!isStockLimited ? 'border-emerald-500 bg-emerald-50/50 shadow-sm ring-2 ring-emerald-500/20' : 'border-gray-200 bg-gray-50/50 hover:bg-white hover:border-gray-300'}`}>
                <div className="flex items-center justify-between"><i className={`bi bi-infinity text-xl ${!isStockLimited ? 'text-emerald-600' : 'text-gray-400'}`}></i>{!isStockLimited && <span className="w-2 h-2 rounded-full bg-emerald-500"></span>}</div>
                <div><p className={`text-sm font-black ${!isStockLimited ? 'text-emerald-900' : 'text-gray-700'}`}>Ilimitado</p><p className="text-[10px] font-medium text-gray-500 leading-tight mt-0.5">Por defecto. Sin tope.</p></div>
              </button>
              <button type="button" onClick={() => setIsStockLimited(true)} className={`p-4 rounded-2xl border text-left transition-all flex flex-col gap-2 ${isStockLimited ? 'border-rose-500 bg-rose-50/50 shadow-sm ring-2 ring-rose-500/20' : 'border-gray-200 bg-gray-50/50 hover:bg-white hover:border-gray-300'}`}>
                <div className="flex items-center justify-between"><i className={`bi bi-box-seam text-lg ${isStockLimited ? 'text-rose-600' : 'text-gray-400'}`}></i>{isStockLimited && <span className="w-2 h-2 rounded-full bg-rose-500"></span>}</div>
                <div><p className={`text-sm font-black ${isStockLimited ? 'text-rose-900' : 'text-gray-700'}`}>Limitado</p><p className="text-[10px] font-medium text-gray-500 leading-tight mt-0.5">Control con alertas.</p></div>
              </button>
            </div>
          </div>

          {isStockLimited && (
            <div className="space-y-4 pt-2 border-t border-gray-100 animate-in slide-in-from-top-2 duration-300">
              <div className="space-y-2">
                <div className="flex justify-between items-center ml-1"><label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Stock Disponible Actual</label><span className="text-[10px] font-bold text-rose-500">{ingredient.unit || 'uds'}</span></div>
                <input type="number" step="0.01" required className="w-full bg-gray-50 border border-gray-200 rounded-xl p-4 text-gray-900 font-bold focus:bg-white focus:border-rose-500 transition-all outline-none" placeholder="0" value={availableStock} onChange={e => setAvailableStock(e.target.value)} />
                <p className="text-[10px] text-gray-400 font-medium ml-1">Cantidad de unidades disponibles para este ingrediente.</p>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between items-center ml-1"><label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Stock Mínimo (Alerta)</label><span className="text-[10px] font-bold text-amber-500">Aviso</span></div>
                <input type="number" step="0.01" required className="w-full bg-gray-50 border border-gray-200 rounded-xl p-4 text-gray-900 font-bold focus:bg-white focus:border-rose-500 transition-all outline-none" placeholder="0" value={minStock} onChange={e => setMinStock(e.target.value)} />
                <p className="text-[10px] text-gray-400 font-medium ml-1">El sistema alertará cuando las existencias alcancen o bajen de esta cantidad.</p>
              </div>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} disabled={saving} className="w-1/3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold py-4 rounded-xl text-xs uppercase tracking-wider transition-colors">Cancelar</button>
            <button type="submit" disabled={saving} className="flex-1 bg-gradient-to-r from-rose-500 to-red-600 text-white font-black py-4 rounded-xl text-xs uppercase tracking-wider hover:from-rose-600 hover:to-red-700 shadow-lg shadow-rose-500/25 transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2">
              {saving ? <><div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div><span>Guardando...</span></> : <span>Guardar Configuración</span>}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
