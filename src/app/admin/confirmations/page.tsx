'use client'

import { useEffect, useState, useMemo } from 'react'
import { db } from '@/lib/firebase'
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore'
import { getAllBusinesses } from '@/lib/database'
import { Order, Business } from '@/types'

type ConfirmationChannel = 'all' | 'app' | 'telegram_bot' | 'telegram_miniapp' | 'email'
type DateRangeOption = 'today' | '7days' | '30days' | 'this_month' | 'all'

interface ConfirmationStats {
  totalConfirmed: number
  appCount: number
  telegramBotCount: number
  telegramMiniappCount: number
  emailCount: number
}

// Auxiliar para convertir cualquier formato de fecha a Date
const parseOrderDate = (dateVal: any): Date | null => {
  if (!dateVal) return null
  if (dateVal instanceof Date) return dateVal
  if (typeof dateVal?.toDate === 'function') return dateVal.toDate()
  if (typeof dateVal?.seconds === 'number') return new Date(dateVal.seconds * 1000)
  if (typeof dateVal === 'string' || typeof dateVal === 'number') {
    const parsed = new Date(dateVal)
    return isNaN(parsed.getTime()) ? null : parsed
  }
  return null
}

// Auxiliar para determinar el origen de confirmación (retrocompatible con órdenes históricas)
const getEffectiveSource = (order: any): 'app' | 'telegram_bot' | 'telegram_miniapp' | 'email' => {
  if (order.confirmationSource) {
    return order.confirmationSource
  }
  // Retrocompatibilidad: si Telegram bot guardó confirmedBy
  if (order.confirmedBy) {
    return 'telegram_bot'
  }
  // De lo contrario, si la orden fue confirmada en el pasado, se asume 'app' por defecto
  return 'app'
}

export default function OrderConfirmationsAdminPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [businesses, setBusinesses] = useState<Business[]>([])
  const [loading, setLoading] = useState<boolean>(true)

  // Filtros
  const [selectedChannel, setSelectedChannel] = useState<ConfirmationChannel>('all')
  const [selectedBusinessId, setSelectedBusinessId] = useState<string>('all')
  const [dateRange, setDateRange] = useState<DateRangeOption>('30days')
  const [searchQuery, setSearchQuery] = useState<string>('')
  
  // Paginación
  const [currentPage, setCurrentPage] = useState<number>(1)
  const pageSize = 15

  // Cargar lista de tiendas para los filtros
  useEffect(() => {
    const loadStores = async () => {
      try {
        const list = await getAllBusinesses()
        setBusinesses(list || [])
      } catch (err) {
        console.error('Error cargando tiendas:', err)
      }
    }
    loadStores()
  }, [])

  // Suscripción en tiempo real a las órdenes de Firebase
  useEffect(() => {
    setLoading(true)
    const ordersRef = collection(db, 'orders')
    const q = query(ordersRef, orderBy('createdAt', 'desc'))

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const orderList: Order[] = []
      snapshot.forEach((docSnap) => {
        orderList.push({
          id: docSnap.id,
          ...docSnap.data()
        } as Order)
      })
      setOrders(orderList)
      setLoading(false)
    }, (error) => {
      console.error('Error escuchando ordenes en tiempo real:', error)
      setLoading(false)
    })

    return () => unsubscribe()
  }, [])

  // Mapa de nombres de negocios
  const businessMap = useMemo(() => {
    const map: Record<string, string> = {}
    businesses.forEach(b => {
      map[b.id] = b.name
    })
    return map
  }, [businesses])

  // Filtrar órdenes que hayan sido confirmadas o que estén en proceso/completadas
  const confirmedOrdersAll = useMemo(() => {
    return orders.filter(o => {
      // Considerar confirmadas las órdenes cuyo estado pasó de pending (confirmed, preparing, ready, on_way, delivered)
      // O que tengan registro de confirmationSource o statusHistory.confirmedAt
      const isConfirmedState = ['confirmed', 'preparing', 'ready', 'on_way', 'delivered'].includes(o.status)
      const hasConfirmedTimestamp = !!(o.statusHistory?.confirmedAt || (o as any).statusHistory?.preparingAt)
      return isConfirmedState || hasConfirmedTimestamp
    })
  }, [orders])

  // Filtrar según Rango de Fecha elegido
  const dateFilteredOrders = useMemo(() => {
    const now = new Date()
    return confirmedOrdersAll.filter(o => {
      const confirmedDate = parseOrderDate(o.statusHistory?.confirmedAt || o.createdAt)
      if (!confirmedDate) return false

      if (dateRange === 'today') {
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        return confirmedDate >= todayStart
      }
      if (dateRange === '7days') {
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        return confirmedDate >= sevenDaysAgo
      }
      if (dateRange === '30days') {
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
        return confirmedDate >= thirtyDaysAgo
      }
      if (dateRange === 'this_month') {
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
        return confirmedDate >= monthStart
      }
      return true // 'all'
    })
  }, [confirmedOrdersAll, dateRange])

  // Aplicar filtro por negocio
  const businessFilteredOrders = useMemo(() => {
    if (selectedBusinessId === 'all') return dateFilteredOrders
    return dateFilteredOrders.filter(o => o.businessId === selectedBusinessId)
  }, [dateFilteredOrders, selectedBusinessId])

  // Métricas generales para el período y negocio seleccionados
  const stats: ConfirmationStats = useMemo(() => {
    let appCount = 0
    let telegramBotCount = 0
    let telegramMiniappCount = 0
    let emailCount = 0

    businessFilteredOrders.forEach(o => {
      const src = getEffectiveSource(o)
      if (src === 'app') appCount++
      else if (src === 'telegram_bot') telegramBotCount++
      else if (src === 'telegram_miniapp') telegramMiniappCount++
      else if (src === 'email') emailCount++
    })

    return {
      totalConfirmed: businessFilteredOrders.length,
      appCount,
      telegramBotCount,
      telegramMiniappCount,
      emailCount
    }
  }, [businessFilteredOrders])

  // Filtrar por canal y búsqueda de texto
  const finalFilteredOrders = useMemo(() => {
    return businessFilteredOrders.filter(o => {
      const src = getEffectiveSource(o)
      
      // Filtro de Canal
      if (selectedChannel !== 'all') {
        if (selectedChannel === 'app' && src !== 'app') return false
        if (selectedChannel === 'telegram_bot' && src !== 'telegram_bot') return false
        if (selectedChannel === 'telegram_miniapp' && src !== 'telegram_miniapp') return false
        if (selectedChannel === 'email' && src !== 'email') return false
      }

      // Búsqueda por query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim()
        const orderIdMatch = o.id.toLowerCase().includes(q)
        const customerNameMatch = (o.customer?.name || '').toLowerCase().includes(q)
        const businessNameMatch = (businessMap[o.businessId] || '').toLowerCase().includes(q)
        if (!orderIdMatch && !customerNameMatch && !businessNameMatch) return false
      }

      return true
    })
  }, [businessFilteredOrders, selectedChannel, searchQuery, businessMap])

  // Resetear paginación al cambiar filtros
  useEffect(() => {
    setCurrentPage(1)
  }, [selectedChannel, selectedBusinessId, dateRange, searchQuery])

  // Paginación
  const totalPages = Math.ceil(finalFilteredOrders.length / pageSize) || 1
  const paginatedOrders = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return finalFilteredOrders.slice(start, start + pageSize)
  }, [finalFilteredOrders, currentPage])

  // Desglose por tienda (Top tiendas con sus canales preferidos)
  const storeBreakdown = useMemo(() => {
    const map: Record<string, { name: string, app: number, telegram_bot: number, telegram_miniapp: number, email: number, total: number }> = {}

    dateFilteredOrders.forEach(o => {
      const bId = o.businessId || 'unknown'
      const bName = businessMap[bId] || 'Tienda Sin Nombre'
      if (!map[bId]) {
        map[bId] = { name: bName, app: 0, telegram_bot: 0, telegram_miniapp: 0, email: 0, total: 0 }
      }
      const src = getEffectiveSource(o)
      map[bId].total++
      if (src === 'app') map[bId].app++
      else if (src === 'telegram_bot') map[bId].telegram_bot++
      else if (src === 'telegram_miniapp') map[bId].telegram_miniapp++
      else if (src === 'email') map[bId].email++
    })

    return Object.values(map).sort((a, b) => b.total - a.total).slice(0, 8)
  }, [dateFilteredOrders, businessMap])

  // Cálculos de porcentajes
  const total = stats.totalConfirmed || 1
  const appPct = Math.round((stats.appCount / total) * 100)
  const telegramBotPct = Math.round((stats.telegramBotCount / total) * 100)
  const telegramMiniappPct = Math.round((stats.telegramMiniappCount / total) * 100)
  const emailPct = Math.round((stats.emailCount / total) * 100)
  const telegramTotalCount = stats.telegramBotCount + stats.telegramMiniappCount
  const telegramTotalPct = Math.round((telegramTotalCount / total) * 100)

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-8 text-gray-900">
      
      {/* Enzabezado principal */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-gray-900 via-gray-800 to-slate-900 p-6 md:p-8 rounded-3xl text-white shadow-xl border border-gray-800">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <span className="bg-blue-500/20 text-blue-400 p-2 rounded-xl border border-blue-500/30">
              <i className="bi bi-check-all text-2xl"></i>
            </span>
            <span className="text-xs font-bold uppercase tracking-wider text-blue-400">Panel de Control Admin</span>
          </div>
          <h1 className="text-2xl md:text-3xl font-black tracking-tight">Origen de Confirmaciones de Órdenes</h1>
          <p className="text-sm text-gray-400 mt-1 max-w-2xl">
            Monitorea en tiempo real los canales utilizados por los restaurantes para confirmar pedidos: Correo Electrónico, App/Dashboard Web, Botón Inline de Telegram y Telegram Mini App.
          </p>
        </div>

        <div className="flex items-center gap-3 bg-white/5 backdrop-blur-md p-3 rounded-2xl border border-white/10 self-start md:self-auto">
          <i className="bi bi-[#10b981] bi-activity text-emerald-400 text-lg animate-pulse"></i>
          <div>
            <p className="text-[10px] uppercase font-bold text-gray-400">Estado en tiempo real</p>
            <p className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block animate-ping"></span>
              Suscripción Activa
            </p>
          </div>
        </div>
      </div>

      {/* Bar de Filtros Rápidos (Rango de Fechas y Tienda) */}
      <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4">
        
        {/* Selector de Rango de Fecha */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold uppercase text-gray-500 mr-1 flex items-center gap-1">
            <i className="bi bi-calendar-event"></i> Período:
          </span>
          {[
            { id: 'today', label: 'Hoy' },
            { id: '7days', label: 'Últimos 7 días' },
            { id: '30days', label: 'Últimos 30 días' },
            { id: 'this_month', label: 'Este Mes' },
            { id: 'all', label: 'Todo' }
          ].map(opt => (
            <button
              key={opt.id}
              onClick={() => setDateRange(opt.id as DateRangeOption)}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
                dateRange === opt.id
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-200'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Selector de Tienda */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase text-gray-500 flex items-center gap-1">
            <i className="bi bi-shop"></i> Tienda:
          </span>
          <select
            value={selectedBusinessId}
            onChange={(e) => setSelectedBusinessId(e.target.value)}
            className="bg-gray-50 border border-gray-200 text-gray-800 text-xs font-semibold rounded-xl px-3.5 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all max-w-[220px]"
          >
            <option value="all">Todas las tiendas ({businesses.length})</option>
            {businesses.map(b => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Tarjetas de Métricas de Resumen */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        
        {/* Total Confirmadas */}
        <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm hover:shadow-md transition-all">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold uppercase tracking-wider text-gray-400">Total Confirmados</span>
            <div className="w-10 h-10 rounded-2xl bg-gray-100 flex items-center justify-center text-gray-700 font-bold">
              <i className="bi bi-bag-check-fill text-lg"></i>
            </div>
          </div>
          <div className="text-3xl font-black text-gray-900 mb-1">{stats.totalConfirmed}</div>
          <p className="text-xs text-gray-500">Pedidos aceptados en el período</p>
        </div>

        {/* Confirmadas desde App Web */}
        <div className="bg-white p-6 rounded-3xl border border-blue-100 shadow-sm hover:shadow-md transition-all relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/5 rounded-bl-full pointer-events-none group-hover:scale-110 transition-transform"></div>
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold uppercase tracking-wider text-blue-600 flex items-center gap-1.5">
              <i className="bi bi-phone-fill"></i> App / Web
            </span>
            <div className="w-10 h-10 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
              <i className="bi bi-display-fill text-lg"></i>
            </div>
          </div>
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-3xl font-black text-gray-900">{stats.appCount}</span>
            <span className="text-sm font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-lg border border-blue-100">
              {appPct}%
            </span>
          </div>
          <p className="text-xs text-gray-500">Confirmados desde Panel Web/App</p>
        </div>

        {/* Confirmadas desde Telegram (Total) */}
        <div className="bg-white p-6 rounded-3xl border border-sky-100 shadow-sm hover:shadow-md transition-all relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-sky-500/5 rounded-bl-full pointer-events-none group-hover:scale-110 transition-transform"></div>
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold uppercase tracking-wider text-sky-600 flex items-center gap-1.5">
              <i className="bi bi-telegram"></i> Telegram Total
            </span>
            <div className="w-10 h-10 rounded-2xl bg-sky-50 text-sky-600 flex items-center justify-center font-bold">
              <i className="bi bi-telegram text-xl"></i>
            </div>
          </div>
          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-3xl font-black text-gray-900">{telegramTotalCount}</span>
            <span className="text-sm font-bold text-sky-600 bg-sky-50 px-2 py-0.5 rounded-lg border border-sky-100">
              {telegramTotalPct}%
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px] font-semibold border-t border-gray-100 pt-2 text-gray-600">
            <div className="flex items-center gap-1 text-sky-700">
              <i className="bi bi-robot text-sky-500"></i> Bot Inline: <strong>{stats.telegramBotCount}</strong>
            </div>
            <div className="flex items-center gap-1 text-teal-700">
              <i className="bi bi-app-indicator text-teal-500"></i> MiniApp: <strong>{stats.telegramMiniappCount}</strong>
            </div>
          </div>
        </div>

        {/* Confirmadas desde Email */}
        <div className="bg-white p-6 rounded-3xl border border-amber-100 shadow-sm hover:shadow-md transition-all relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/5 rounded-bl-full pointer-events-none group-hover:scale-110 transition-transform"></div>
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold uppercase tracking-wider text-amber-600 flex items-center gap-1.5">
              <i className="bi bi-envelope-fill"></i> Correo Electrónico
            </span>
            <div className="w-10 h-10 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center font-bold">
              <i className="bi bi-envelope-open-fill text-lg"></i>
            </div>
          </div>
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-3xl font-black text-gray-900">{stats.emailCount}</span>
            <span className="text-sm font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-lg border border-amber-100">
              {emailPct}%
            </span>
          </div>
          <p className="text-xs text-gray-500">Confirmados por link en email</p>
        </div>

      </div>

      {/* Barra Visual Proporcional de Canales */}
      <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2">
            <i className="bi bi-[#2563eb] bi-bar-chart-steps text-blue-600"></i>
            Distribución Porcentual de Canales de Confirmación
          </h3>
          <span className="text-xs font-bold text-gray-400">Total: {stats.totalConfirmed} órdenes</span>
        </div>

        {/* Barra Segmentada */}
        <div className="h-4 w-full bg-gray-100 rounded-full overflow-hidden flex shadow-inner">
          {stats.appCount > 0 && (
            <div
              style={{ width: `${appPct}%` }}
              className="bg-blue-600 h-full transition-all duration-500 relative group cursor-pointer"
              title={`App Web: ${stats.appCount} (${appPct}%)`}
            ></div>
          )}
          {stats.telegramBotCount > 0 && (
            <div
              style={{ width: `${telegramBotPct}%` }}
              className="bg-sky-500 h-full transition-all duration-500 relative group cursor-pointer"
              title={`Telegram Bot Inline: ${stats.telegramBotCount} (${telegramBotPct}%)`}
            ></div>
          )}
          {stats.telegramMiniappCount > 0 && (
            <div
              style={{ width: `${telegramMiniappPct}%` }}
              className="bg-teal-500 h-full transition-all duration-500 relative group cursor-pointer"
              title={`Telegram MiniApp: ${stats.telegramMiniappCount} (${telegramMiniappPct}%)`}
            ></div>
          )}
          {stats.emailCount > 0 && (
            <div
              style={{ width: `${emailPct}%` }}
              className="bg-amber-500 h-full transition-all duration-500 relative group cursor-pointer"
              title={`Email: ${stats.emailCount} (${emailPct}%)`}
            ></div>
          )}
        </div>

        {/* Leyenda de colores */}
        <div className="flex flex-wrap items-center justify-between gap-4 pt-2 text-xs font-semibold text-gray-600">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-blue-600"></span>
            <span>App Web / Dashboard: <strong className="text-gray-900">{stats.appCount} ({appPct}%)</strong></span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-sky-500"></span>
            <span>Telegram Bot Inline: <strong className="text-gray-900">{stats.telegramBotCount} ({telegramBotPct}%)</strong></span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-teal-500"></span>
            <span>Telegram MiniApp: <strong className="text-gray-900">{stats.telegramMiniappCount} ({telegramMiniappPct}%)</strong></span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-amber-500"></span>
            <span>Correo Electrónico: <strong className="text-gray-900">{stats.emailCount} ({emailPct}%)</strong></span>
          </div>
        </div>
      </div>

      {/* Desglose por Restaurante (Top Tiendas) */}
      {storeBreakdown.length > 0 && (
        <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-gray-100 pb-3">
            <div>
              <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <i className="bi bi-buildings-fill text-indigo-600"></i>
                Preferencia de Confirmación por Tienda / Restaurante
              </h3>
              <p className="text-xs text-gray-500">Principales tiendas y los canales que más utilizan sus administradores</p>
            </div>
            <span className="text-xs font-bold bg-indigo-50 text-indigo-600 px-3 py-1 rounded-xl">
              {storeBreakdown.length} tiendas activas
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {storeBreakdown.map((item, idx) => {
              const itemTotal = item.total || 1
              return (
                <div key={idx} className="bg-gray-50/80 p-4 rounded-2xl border border-gray-200/60 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black text-gray-900 truncate max-w-[150px]" title={item.name}>
                      {item.name}
                    </span>
                    <span className="text-[10px] font-extrabold bg-gray-200 text-gray-700 px-2 py-0.5 rounded-md">
                      {item.total} ord
                    </span>
                  </div>

                  {/* Micro barras */}
                  <div className="space-y-1.5 pt-1 text-[11px]">
                    <div className="flex items-center justify-between text-gray-600">
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-blue-600"></span> App
                      </span>
                      <span className="font-bold">{item.app} ({Math.round((item.app/itemTotal)*100)}%)</span>
                    </div>

                    <div className="flex items-center justify-between text-gray-600">
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-sky-500"></span> Telegram Bot
                      </span>
                      <span className="font-bold">{item.telegram_bot} ({Math.round((item.telegram_bot/itemTotal)*100)}%)</span>
                    </div>

                    <div className="flex items-center justify-between text-gray-600">
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-teal-500"></span> Telegram MiniApp
                      </span>
                      <span className="font-bold">{item.telegram_miniapp} ({Math.round((item.telegram_miniapp/itemTotal)*100)}%)</span>
                    </div>

                    <div className="flex items-center justify-between text-gray-600">
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-amber-500"></span> Email
                      </span>
                      <span className="font-bold">{item.email} ({Math.round((item.email/itemTotal)*100)}%)</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Sección de Tabla con Filtros de Canal y Búsqueda */}
      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
        
        {/* Cabecera de la Tabla y Filtros de Pestaña */}
        <div className="p-6 border-b border-gray-100 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                <i className="bi bi-list-task text-blue-600"></i>
                Listado Detallado de Pedidos Confirmados
              </h3>
              <p className="text-xs text-gray-500">Mostrando {finalFilteredOrders.length} pedidos encontrados</p>
            </div>

            {/* Buscador por Texto */}
            <div className="relative">
              <i className="bi bi-search absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs"></i>
              <input
                type="text"
                placeholder="Buscar por ID, tienda o cliente..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all w-full sm:w-64 text-gray-800"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs"
                >
                  <i className="bi bi-x-circle-fill"></i>
                </button>
              )}
            </div>
          </div>

          {/* Tabs por Origen de Confirmación */}
          <div className="flex flex-wrap gap-2 pt-2">
            {[
              { id: 'all', label: 'Todos los Canales', icon: 'bi-grid-fill', count: businessFilteredOrders.length },
              { id: 'app', label: 'App / Web', icon: 'bi-phone-fill', count: stats.appCount },
              { id: 'telegram_bot', label: 'Telegram Bot (Inline)', icon: 'bi-robot', count: stats.telegramBotCount },
              { id: 'telegram_miniapp', label: 'Telegram MiniApp', icon: 'bi-app-indicator', count: stats.telegramMiniappCount },
              { id: 'email', label: 'Correo Electrónico', icon: 'bi-envelope-fill', count: stats.emailCount }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setSelectedChannel(tab.id as ConfirmationChannel)}
                className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all ${
                  selectedChannel === tab.id
                    ? 'bg-gray-900 text-white shadow-md'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                <i className={`bi ${tab.icon}`}></i>
                <span>{tab.label}</span>
                <span className={`px-1.5 py-0.5 rounded-md text-[10px] ${
                  selectedChannel === tab.id ? 'bg-white/20 text-white' : 'bg-gray-200 text-gray-700'
                }`}>
                  {tab.count}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Estado de Carga */}
        {loading ? (
          <div className="p-16 flex flex-col items-center justify-center text-center">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mb-3"></div>
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Cargando órdenes desde Firebase...</p>
          </div>
        ) : paginatedOrders.length === 0 ? (
          /* Estado Vacío */
          <div className="p-16 flex flex-col items-center justify-center text-center space-y-3">
            <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 text-2xl">
              <i className="bi bi-inbox-fill"></i>
            </div>
            <h4 className="text-base font-bold text-gray-800">No se encontraron órdenes confirmadas</h4>
            <p className="text-xs text-gray-500 max-w-sm">
              Prueba cambiando el rango de fechas, seleccionando otra tienda o borrando el término de búsqueda.
            </p>
          </div>
        ) : (
          /* Tabla de Resultados */
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50/80 text-[11px] font-bold uppercase tracking-wider text-gray-500 border-b border-gray-100">
                  <th className="py-3.5 px-6">ID Pedido</th>
                  <th className="py-3.5 px-6">Tienda / Restaurante</th>
                  <th className="py-3.5 px-6">Cliente</th>
                  <th className="py-3.5 px-6">Origen Confirmación</th>
                  <th className="py-3.5 px-6">Fecha / Hora</th>
                  <th className="py-3.5 px-6">Total</th>
                  <th className="py-3.5 px-6 text-right">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-xs text-gray-700 font-medium">
                {paginatedOrders.map((order) => {
                  const source = getEffectiveSource(order)
                  const businessName = businessMap[order.businessId] || 'Tienda'
                  const confirmedDate = parseOrderDate(order.statusHistory?.confirmedAt || order.createdAt)

                  return (
                    <tr key={order.id} className="hover:bg-blue-50/40 transition-colors">
                      
                      {/* ID Pedido */}
                      <td className="py-4 px-6 font-mono font-bold text-gray-900">
                        #{order.id.slice(-6).toUpperCase()}
                      </td>

                      {/* Tienda */}
                      <td className="py-4 px-6 font-bold text-gray-900">
                        {businessName}
                      </td>

                      {/* Cliente */}
                      <td className="py-4 px-6">
                        <div className="font-bold text-gray-800">{order.customer?.name || 'Cliente'}</div>
                        <div className="text-[11px] text-gray-400">{order.customer?.phone || ''}</div>
                      </td>

                      {/* Origen de Confirmación Badge */}
                      <td className="py-4 px-6">
                        {source === 'app' && (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200/60 shadow-sm">
                            <i className="bi bi-phone-fill text-blue-600"></i> App / Dashboard Web
                          </span>
                        )}
                        {source === 'telegram_bot' && (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-bold bg-sky-50 text-sky-700 border border-sky-200/60 shadow-sm">
                            <i className="bi bi-robot text-sky-600"></i> Telegram Bot (Inline)
                          </span>
                        )}
                        {source === 'telegram_miniapp' && (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-bold bg-teal-50 text-teal-700 border border-teal-200/60 shadow-sm">
                            <i className="bi bi-app-indicator text-teal-600"></i> Telegram MiniApp
                          </span>
                        )}
                        {source === 'email' && (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200/60 shadow-sm">
                            <i className="bi bi-envelope-at-fill text-amber-600"></i> Correo Electrónico
                          </span>
                        )}
                      </td>

                      {/* Fecha y Hora */}
                      <td className="py-4 px-6 text-gray-600">
                        {confirmedDate ? (
                          <>
                            <div className="font-semibold text-gray-800">
                              {confirmedDate.toLocaleDateString('es-EC', { day: '2-digit', month: 'short', year: 'numeric' })}
                            </div>
                            <div className="text-[11px] text-gray-400">
                              {confirmedDate.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' })}
                            </div>
                          </>
                        ) : (
                          <span className="text-gray-400 italic">No registrada</span>
                        )}
                      </td>

                      {/* Total */}
                      <td className="py-4 px-6 font-bold text-gray-900">
                        ${(order.total || 0).toFixed(2)}
                      </td>

                      {/* Estado de la orden */}
                      <td className="py-4 px-6 text-right">
                        <span className={`inline-block px-2.5 py-1 rounded-lg text-[11px] font-bold ${
                          order.status === 'delivered' ? 'bg-emerald-100 text-emerald-800' :
                          order.status === 'on_way' ? 'bg-indigo-100 text-indigo-800' :
                          order.status === 'ready' ? 'bg-teal-100 text-teal-800' :
                          order.status === 'preparing' ? 'bg-amber-100 text-amber-800' :
                          'bg-blue-100 text-blue-800'
                        }`}>
                          {order.status === 'delivered' ? 'Entregado' :
                           order.status === 'on_way' ? 'En Camino' :
                           order.status === 'ready' ? 'Listo' :
                           order.status === 'preparing' ? 'En Preparación' :
                           'Confirmado'}
                        </span>
                      </td>

                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Paginación */}
        {!loading && finalFilteredOrders.length > 0 && (
          <div className="p-4 border-t border-gray-100 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-gray-500 font-semibold">
            <div>
              Mostrando página <strong>{currentPage}</strong> de <strong>{totalPages}</strong> ({finalFilteredOrders.length} pedidos)
            </div>

            <div className="flex items-center gap-2">
              <button
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                className="px-3.5 py-1.5 rounded-xl border border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                <i className="bi bi-chevron-left"></i> Anterior
              </button>
              <button
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                className="px-3.5 py-1.5 rounded-xl border border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                Siguiente <i className="bi bi-chevron-right"></i>
              </button>
            </div>
          </div>
        )}

      </div>

    </div>
  )
}
