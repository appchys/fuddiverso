'use client'

import React, { useState, useEffect } from 'react'
import { db } from '@/lib/firebase'
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore'
import { DebugLogEntry, LogCategory, LogLevel } from '@/lib/debug-log'

export default function AdminLogsPage() {
  const [logs, setLogs] = useState<DebugLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [selectedLevel, setSelectedLevel] = useState<string>('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null)
  const [logsLimit, setLogsLimit] = useState(100)

  useEffect(() => {
    setLoading(true)
    const logsRef = collection(db, 'debug_logs')
    const q = query(logsRef, orderBy('timestamp', 'desc'), limit(logsLimit))

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs: DebugLogEntry[] = snapshot.docs.map(docSnap => ({
        id: docSnap.id,
        ...docSnap.data()
      } as DebugLogEntry))
      setLogs(docs)
      setLoading(false)
    }, (err) => {
      console.error('Error listening to debug logs:', err)
      setLoading(false)
    })

    return () => unsubscribe()
  }, [logsLimit])

  const filteredLogs = logs.filter(log => {
    if (selectedCategory !== 'all' && log.category !== selectedCategory) return false
    if (selectedLevel !== 'all' && log.level !== selectedLevel) return false
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase()
      const matchAction = log.action?.toLowerCase().includes(term)
      const matchBusiness = log.businessName?.toLowerCase().includes(term) || log.businessId?.toLowerCase().includes(term)
      const matchOrder = log.orderId?.toLowerCase().includes(term)
      const matchData = JSON.stringify(log.data || {}).toLowerCase().includes(term)
      return matchAction || matchBusiness || matchOrder || matchData
    }
    return true
  })

  const getLevelBadge = (level: LogLevel) => {
    switch (level) {
      case 'error':
        return <span className="px-2 py-0.5 text-xs font-black rounded-md bg-red-500/20 text-red-400 border border-red-500/30">ERROR</span>
      case 'warn':
        return <span className="px-2 py-0.5 text-xs font-black rounded-md bg-amber-500/20 text-amber-400 border border-amber-500/30">WARN</span>
      default:
        return <span className="px-2 py-0.5 text-xs font-black rounded-md bg-blue-500/20 text-blue-400 border border-blue-500/30">INFO</span>
    }
  }

  const getCategoryBadge = (category: LogCategory) => {
    const colors: Record<string, string> = {
      manual_order: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
      checkout: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
      order_creation: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
      timing_debug: 'bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/30',
      system: 'bg-gray-500/20 text-gray-300 border-gray-500/30'
    }
    return (
      <span className={`px-2.5 py-0.5 text-xs font-bold rounded-lg border ${colors[category] || colors.system}`}>
        {category}
      </span>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-[#1A1A1A] p-6 rounded-3xl border border-white/5 shadow-xl">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white shadow-lg shadow-blue-900/30">
              <i className="bi bi-journal-text text-xl"></i>
            </div>
            <div>
              <h1 className="text-xl font-black text-white tracking-tight">Logs del Sistema y Depuración</h1>
              <p className="text-xs text-gray-400 font-medium">Registro persistente de eventos de checkout, órdenes manuales y fechas</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setLogsLimit(prev => prev === 100 ? 300 : 100)}
            className="px-4 py-2 bg-white/5 hover:bg-white/10 text-gray-300 rounded-xl text-xs font-bold border border-white/10 transition-all"
          >
            Límite: {logsLimit} logs
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-[#1A1A1A] p-4 rounded-2xl border border-white/5 shadow-lg flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[220px]">
          <div className="relative">
            <i className="bi bi-search absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500 text-xs"></i>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar por texto, negocio, orderId, fecha..."
              className="w-full bg-white/5 border border-white/10 rounded-xl pl-9 pr-4 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:bg-white/10 transition-all"
            />
          </div>
        </div>

        <div>
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500 transition-all"
          >
            <option value="all" className="bg-gray-900">Todas las Categorías</option>
            <option value="manual_order" className="bg-gray-900">manual_order</option>
            <option value="checkout" className="bg-gray-900">checkout</option>
            <option value="order_creation" className="bg-gray-900">order_creation</option>
            <option value="timing_debug" className="bg-gray-900">timing_debug</option>
            <option value="system" className="bg-gray-900">system</option>
          </select>
        </div>

        <div>
          <select
            value={selectedLevel}
            onChange={(e) => setSelectedLevel(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500 transition-all"
          >
            <option value="all" className="bg-gray-900">Todos los Niveles</option>
            <option value="info" className="bg-gray-900">INFO</option>
            <option value="warn" className="bg-gray-900">WARN</option>
            <option value="error" className="bg-gray-900">ERROR</option>
          </select>
        </div>

        {(selectedCategory !== 'all' || selectedLevel !== 'all' || searchTerm) && (
          <button
            onClick={() => {
              setSelectedCategory('all')
              setSelectedLevel('all')
              setSearchTerm('')
            }}
            className="text-xs text-blue-400 hover:text-blue-300 font-bold px-2 py-1"
          >
            Limpiar filtros
          </button>
        )}

        <div className="ml-auto text-xs text-gray-400 font-medium">
          Mostrando {filteredLogs.length} de {logs.length}
        </div>
      </div>

      {/* Lista de Logs */}
      {loading ? (
        <div className="bg-[#1A1A1A] p-12 rounded-3xl border border-white/5 text-center flex flex-col items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mb-3"></div>
          <p className="text-xs text-gray-400 font-bold">Cargando logs en tiempo real...</p>
        </div>
      ) : filteredLogs.length === 0 ? (
        <div className="bg-[#1A1A1A] p-12 rounded-3xl border border-white/5 text-center">
          <i className="bi bi-inbox text-4xl text-gray-600 mb-2 block"></i>
          <h3 className="text-base font-bold text-white mb-1">No se encontraron logs</h3>
          <p className="text-xs text-gray-400">No hay registros que coincidan con los filtros actuales.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredLogs.map((log) => {
            const isExpanded = expandedLogId === log.id
            return (
              <div
                key={log.id}
                className="bg-[#1A1A1A] border border-white/5 hover:border-white/10 rounded-2xl p-4 transition-all"
              >
                <div
                  className="flex flex-col md:flex-row md:items-center justify-between gap-3 cursor-pointer"
                  onClick={() => setExpandedLogId(isExpanded ? null : log.id || null)}
                >
                  <div className="flex items-start md:items-center gap-3">
                    <div className="shrink-0 pt-0.5 md:pt-0">
                      {getLevelBadge(log.level)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        {getCategoryBadge(log.category)}
                        <span className="font-bold text-sm text-white">{log.action}</span>
                        {log.orderId && (
                          <span className="font-mono text-xs text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20">
                            ID: {log.orderId}
                          </span>
                        )}
                        {log.businessName && (
                          <span className="text-xs text-gray-300 font-medium">
                            🏪 {log.businessName}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-400 font-mono">
                        <span>🕒 {log.localTimestamp}</span>
                        <span>🌐 Offset: {log.timezoneOffset}m ({log.timezoneName || 'Local'})</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end md:self-auto">
                    <span className="text-xs text-gray-500 hover:text-gray-300 font-bold flex items-center gap-1">
                      {isExpanded ? 'Ocultar JSON' : 'Ver Detalle'}
                      <i className={`bi bi-chevron-${isExpanded ? 'up' : 'down'}`}></i>
                    </span>
                  </div>
                </div>

                {isExpanded && (
                  <div className="mt-4 pt-4 border-t border-white/5">
                    <div className="bg-black/50 p-4 rounded-xl font-mono text-xs text-gray-300 overflow-x-auto border border-white/5">
                      <div className="text-gray-500 mb-2 font-sans font-bold text-[11px] uppercase tracking-wider">
                        Datos del Evento ({log.id})
                      </div>
                      <pre className="whitespace-pre-wrap break-words">
                        {JSON.stringify(log.data || {}, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
