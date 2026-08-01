'use client'

import React, { useState } from 'react'
import { Business } from '@/types'
import { updateBusiness } from '@/lib/database'
import { getTodayDateString } from '@/lib/store-utils'

interface DailyCheckInBannerProps {
  business: Business
  onBusinessUpdate?: (updated: Partial<Business>) => void
}

export default function DailyCheckInBanner({ business, onBusinessUpdate }: DailyCheckInBannerProps) {
  const [updating, setUpdating] = useState(false)
  const todayStr = getTodayDateString(new Date())

  const checkInState = business.dailyCheckInState
  const currentStatus = checkInState?.date === todayStr ? checkInState.status : 'pending'

  const handleSetStatus = async (status: 'open' | 'closed') => {
    setUpdating(true)
    try {
      const newState = {
        date: todayStr,
        status,
        respondedAt: new Date().toISOString(),
        lastNotificationSentDate: checkInState?.lastNotificationSentDate || todayStr
      }

      const updateData: Partial<Business> = {
        dailyCheckInState: newState
      }

      // Si abren manualmente la tienda vía check-in, limpiar cualquier manualStoreStatus que la mantuviera cerrada
      if (status === 'open' && business.manualStoreStatus === 'closed') {
        updateData.manualStoreStatus = null as any
        updateData.manualStatusExpiry = null as any
      }

      await updateBusiness(business.id, updateData)

      if (onBusinessUpdate) {
        onBusinessUpdate(updateData)
      }
    } catch (err) {
      console.error('Error al actualizar check-in desde el banner:', err)
    } finally {
      setUpdating(false)
    }
  }

  // Estilo según estado
  if (currentStatus === 'open') {
    return (
      <div className="bg-emerald-50/80 border border-emerald-200/80 rounded-2xl p-4 sm:p-5 mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm animate-fadeIn">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 bg-emerald-500/10 text-emerald-600 rounded-xl flex items-center justify-center text-xl shrink-0">
            <i className="bi bi-shop-window"></i>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <h4 className="font-bold text-sm text-emerald-950">Check-in diario confirmado</h4>
            </div>
            <p className="text-xs text-emerald-700 mt-0.5">
              Tu tienda está <strong>Abierta</strong> para recibir pedidos el día de hoy.
            </p>
          </div>
        </div>
        <button
          disabled={updating}
          onClick={() => handleSetStatus('closed')}
          className="self-end sm:self-auto px-3.5 py-2 bg-white hover:bg-emerald-100/50 text-emerald-800 border border-emerald-200 rounded-xl text-xs font-bold transition-all disabled:opacity-50 active:scale-95"
        >
          {updating ? 'Actualizando...' : 'Cambiar a Mantener Cerrada'}
        </button>
      </div>
    )
  }

  if (currentStatus === 'closed') {
    return (
      <div className="bg-rose-50/80 border border-rose-200/80 rounded-2xl p-4 sm:p-5 mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm animate-fadeIn">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 bg-rose-500/10 text-rose-600 rounded-xl flex items-center justify-center text-xl shrink-0">
            <i className="bi bi-door-closed-fill"></i>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-rose-500"></span>
              <h4 className="font-bold text-sm text-rose-950">Tienda confirmada como Cerrada hoy</h4>
            </div>
            <p className="text-xs text-rose-700 mt-0.5">
              Has indicado que tu tienda permanecerá <strong>Cerrada</strong> hoy. Los clientes no podrán realizar pedidos inmediatos.
            </p>
          </div>
        </div>
        <button
          disabled={updating}
          onClick={() => handleSetStatus('open')}
          className="self-end sm:self-auto px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold shadow-sm transition-all disabled:opacity-50 active:scale-95"
        >
          {updating ? 'Actualizando...' : '🟢 Abrir Tienda Ahora'}
        </button>
      </div>
    )
  }

  // Estado pendiente (pending)
  return (
    <div className="bg-amber-50/90 border border-amber-200 rounded-2xl p-4 sm:p-5 mb-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-sm animate-fadeIn">
      <div className="flex items-center gap-3.5">
        <div className="w-10 h-10 bg-amber-500/10 text-amber-700 rounded-xl flex items-center justify-center text-xl shrink-0">
          <i className="bi bi-exclamation-triangle-fill"></i>
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping"></span>
            <h4 className="font-bold text-sm text-amber-950">Check-in Diario requerido</h4>
          </div>
          <p className="text-xs text-amber-800 mt-0.5">
            Tu tienda permanecerá cerrada al público hasta que confirmes la apertura para el día de hoy.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 w-full md:w-auto justify-end">
        <button
          disabled={updating}
          onClick={() => handleSetStatus('closed')}
          className="flex-1 md:flex-initial px-4 py-2 bg-white hover:bg-amber-100/50 text-gray-700 border border-amber-200 rounded-xl text-xs font-bold transition-all disabled:opacity-50 active:scale-95 text-center"
        >
          🔴 Mantener Cerrada
        </button>
        <button
          disabled={updating}
          onClick={() => handleSetStatus('open')}
          className="flex-1 md:flex-initial px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-md shadow-emerald-600/20 transition-all disabled:opacity-50 active:scale-95 text-center flex items-center justify-center gap-1.5"
        >
          <i className="bi bi-check-circle-fill"></i>
          {updating ? 'Abriendo...' : '🟢 Abrir Tienda'}
        </button>
      </div>
    </div>
  )
}
