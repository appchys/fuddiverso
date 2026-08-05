'use client'

import React, { useState, useEffect } from 'react'
import { Business } from '@/types'
import { updateBusiness } from '@/lib/database'
import { getTodayDateString } from '@/lib/store-utils'

interface DailyCheckInBannerProps {
  business: Business
  onBusinessUpdate?: (updated: Partial<Business>) => void
}

export default function DailyCheckInBanner({ business, onBusinessUpdate }: DailyCheckInBannerProps) {
  const [updating, setUpdating] = useState(false)
  const [showActivatedBanner, setShowActivatedBanner] = useState(false)
  const [showErrorBanner, setShowErrorBanner] = useState(false)

  const todayStr = getTodayDateString(new Date())

  const checkInState = business.dailyCheckInState
  const currentStatus = checkInState?.date === todayStr ? checkInState.status : 'pending'

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      const checkinParam = params.get('checkin')
      const checkinErrorParam = params.get('checkin_error')

      if (checkinParam === 'open') {
        setShowActivatedBanner(true)
        const url = new URL(window.location.href)
        url.searchParams.delete('checkin')
        window.history.replaceState({}, '', url.pathname + url.search)
      } else if (checkinErrorParam) {
        setShowErrorBanner(true)
        const url = new URL(window.location.href)
        url.searchParams.delete('checkin_error')
        window.history.replaceState({}, '', url.pathname + url.search)
      }
    }
  }, [])

  useEffect(() => {
    if (showActivatedBanner) {
      const timer = setTimeout(() => {
        setShowActivatedBanner(false)
      }, 6000)
      return () => clearTimeout(timer)
    }
  }, [showActivatedBanner])

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

      if (status === 'open') {
        setShowActivatedBanner(true)
      }
    } catch (err) {
      console.error('Error al actualizar check-in desde el banner:', err)
    } finally {
      setUpdating(false)
    }
  }

  // Si mostró banner de error al venir de link caducado/inválido
  if (showErrorBanner) {
    return (
      <div className="bg-rose-50/95 border border-rose-200 rounded-2xl p-4 sm:p-5 mb-6 flex items-center justify-between gap-4 shadow-sm animate-fadeIn">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 bg-rose-500/10 text-rose-700 rounded-xl flex items-center justify-center text-xl shrink-0">
            <i className="bi bi-exclamation-triangle-fill"></i>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-rose-500"></span>
              <h4 className="font-black text-sm text-rose-950 tracking-tight leading-tight">Enlace de Check-in No Válido</h4>
            </div>
            <p className="text-xs text-rose-800/90 mt-0.5 font-medium leading-relaxed">
              El enlace de confirmación no es válido o ha expirado. Puedes modificar el estado de tu tienda aquí.
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowErrorBanner(false)}
          className="text-rose-600 hover:text-rose-800 text-xs font-bold px-2 py-1.5 rounded-lg hover:bg-rose-100/50 transition-colors shrink-0"
        >
          <i className="bi bi-x-lg"></i>
        </button>
      </div>
    )
  }

  // Si la tienda fue activada ('open') y tenemos activo el estado showActivatedBanner, mostrar notificación que se oculta a los 6s
  if (showActivatedBanner) {
    return (
      <div className="bg-emerald-50/95 border border-emerald-200 rounded-2xl p-4 sm:p-5 mb-6 flex items-center justify-between gap-4 shadow-sm animate-fadeIn">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 bg-emerald-500/10 text-emerald-700 rounded-xl flex items-center justify-center text-xl shrink-0">
            <i className="bi bi-shop"></i>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <h4 className="font-black text-sm text-emerald-950 tracking-tight leading-tight">¡Tienda Activada con Éxito!</h4>
            </div>
            <p className="text-xs text-emerald-800/90 mt-0.5 font-medium leading-relaxed">
              Tu confirmación ha sido registrada. La tienda se encuentra <strong>abierta y lista para recibir pedidos</strong>.
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowActivatedBanner(false)}
          className="text-emerald-600 hover:text-emerald-800 text-xs font-bold px-2 py-1.5 rounded-lg hover:bg-emerald-100/50 transition-colors shrink-0"
          title="Cerrar notificación"
        >
          <i className="bi bi-x-lg"></i>
        </button>
      </div>
    )
  }

  // Si la tienda ya está abierta y no hay banner de confirmación activo, no renderizar nada
  if (currentStatus === 'open') {
    return null
  }

  // Si confirmó como cerrada
  if (currentStatus === 'closed') {
    return (
      <div className="bg-rose-50/90 border border-rose-200/90 rounded-2xl p-4 sm:p-5 mb-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-sm animate-fadeIn">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 bg-rose-500/10 text-rose-700 rounded-xl flex items-center justify-center text-xl shrink-0">
            <i className="bi bi-door-closed-fill"></i>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-rose-500"></span>
              <h4 className="font-black text-sm text-rose-950 tracking-tight leading-tight">Tienda confirmada como Cerrada</h4>
            </div>
            <p className="text-xs text-rose-800/90 mt-0.5 font-medium leading-relaxed">
              Indicaste que no abrirás hoy, pero <strong>puedes abrir tu tienda en cualquier momento</strong> cuando estés listo para recibir pedidos.
            </p>
          </div>
        </div>
        <button
          disabled={updating}
          onClick={() => handleSetStatus('open')}
          className="self-end md:self-auto px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-md shadow-emerald-600/20 transition-all disabled:opacity-50 active:scale-95 text-center flex items-center justify-center gap-1.5 shrink-0"
        >
          <i className="bi bi-shop"></i>
          {updating ? 'Abriendo...' : '🟢 Abrir Tienda Ahora'}
        </button>
      </div>
    )
  }

  // Estado pendiente ('pending')
  return (
    <div className="bg-amber-50/90 border border-amber-200 rounded-2xl p-4 sm:p-5 mb-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-sm animate-fadeIn">
      <div className="flex items-center gap-3.5">
        <div className="w-10 h-10 bg-amber-500/10 text-amber-700 rounded-xl flex items-center justify-center text-xl shrink-0">
          <i className="bi bi-question-circle-fill"></i>
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping"></span>
            <h4 className="font-black text-sm text-amber-950 tracking-tight leading-tight">¿Vas a abrir hoy?</h4>
          </div>
          <p className="text-xs text-amber-800/90 mt-0.5 font-medium leading-relaxed">
            Confirma si tu tienda estará abierta el día de hoy para comenzar a recibir pedidos.
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
          {updating ? 'Procesando...' : '🟢 Abrir Tienda'}
        </button>
      </div>
    </div>
  )
}
