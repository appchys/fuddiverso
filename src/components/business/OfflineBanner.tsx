'use client'

import React, { useEffect, useState } from 'react'
import { useConnectionStatus } from '@/hooks/useConnectionStatus'

export function OfflineBanner() {
  const { online, pendingWrites, pendingTasks, syncing, lastSyncedAt, checkNow } = useConnectionStatus()
  const [showSyncedNotice, setShowSyncedNotice] = useState(false)

  const totalPending = pendingWrites + pendingTasks

  useEffect(() => {
    if (online && lastSyncedAt && totalPending === 0) {
      setShowSyncedNotice(true)
      const timer = setTimeout(() => setShowSyncedNotice(false), 3500)
      return () => clearTimeout(timer)
    }
  }, [online, lastSyncedAt, totalPending])

  // Si estamos online, no hay pendientes, no sincronizando y no mostramos notice reciente de synced, no renderizamos nada
  if (online && totalPending === 0 && !syncing && !showSyncedNotice) {
    return null
  }

  return (
    <div className="w-full transition-all duration-300 z-40 sticky top-0">
      {!online ? (
        <div className="bg-amber-600/95 backdrop-blur-sm text-white px-4 py-2.5 text-xs sm:text-sm font-medium flex items-center justify-between shadow-md">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-300 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-100"></span>
            </span>
            <span>
              <strong>Modo sin conexión:</strong> Puedes seguir usando la app. Los cambios se guardan localmente
              {totalPending > 0 ? ` (${totalPending} cambio${totalPending !== 1 ? 's' : ''} pendiente${totalPending !== 1 ? 's' : ''})` : ''}.
            </span>
          </div>
          <button
            onClick={() => checkNow()}
            className="px-2.5 py-1 bg-amber-700/80 hover:bg-amber-800 rounded text-xs font-semibold uppercase tracking-wider transition-colors shrink-0 ml-2"
          >
            Reintentar
          </button>
        </div>
      ) : syncing || totalPending > 0 ? (
        <div className="bg-blue-600/95 backdrop-blur-sm text-white px-4 py-2 text-xs sm:text-sm font-medium flex items-center justify-between shadow-sm animate-pulse">
          <div className="flex items-center gap-2">
            <i className="bi bi-arrow-repeat animate-spin text-base"></i>
            <span>
              Sincronizando cambios con el servidor ({totalPending > 0 ? `${totalPending} pendiente${totalPending !== 1 ? 's' : ''}` : 'en progreso'})...
            </span>
          </div>
        </div>
      ) : showSyncedNotice ? (
        <div className="bg-emerald-600/95 backdrop-blur-sm text-white px-4 py-2 text-xs sm:text-sm font-medium flex items-center gap-2 shadow-sm animate-fade-in">
          <i className="bi bi-check-circle-fill text-emerald-200"></i>
          <span>Todo sincronizado con el servidor.</span>
        </div>
      ) : null}
    </div>
  )
}
