'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { getAllClientsGlobal, getAllClientLocations, getAllOrders, FirestoreClient } from '@/lib/database'
import { ClientLocation, Order } from '@/types'
import { GoogleMap } from '@/components/GoogleMap'

// Normalizar texto para búsqueda sin acentos ni mayúsculas
const normalizeText = (text: string): string => {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
}

// Normalizar número de teléfono para WhatsApp
const cleanPhoneForWhatsApp = (phone: string): string => {
  if (!phone) return ''
  let cleaned = phone.replace(/\D/g, '')
  if (cleaned.startsWith('0')) {
    cleaned = '593' + cleaned.substring(1)
  } else if (!cleaned.startsWith('593') && cleaned.length === 9) {
    cleaned = '593' + cleaned
  }
  return cleaned
}

// Formatear teléfono para visualización ecuatoriana
const formatDisplayPhone = (phone: string): string => {
  if (!phone) return 'Sin teléfono'
  const cleaned = phone.replace(/\D/g, '')
  if (cleaned.length === 10 && cleaned.startsWith('09')) {
    return `${cleaned.substring(0, 4)} ${cleaned.substring(4, 7)} ${cleaned.substring(7)}`
  }
  return phone
}

// Componente para resaltar términos buscados en la referencia
function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query || !query.trim()) return <span>{text}</span>

  const terms = query
    .trim()
    .split(/\s+/)
    .filter(t => t.length > 1)
    .map(t => normalizeText(t))

  if (terms.length === 0) return <span>{text}</span>

  const normalized = normalizeText(text)
  const matches: { start: number; end: number }[] = []

  // Localizar rangos de coincidencias
  terms.forEach(term => {
    let index = normalized.indexOf(term)
    while (index !== -1) {
      matches.push({ start: index, end: index + term.length })
      index = normalized.indexOf(term, index + 1)
    }
  })

  if (matches.length === 0) return <span>{text}</span>

  // Unificar rangos superpuestos
  matches.sort((a, b) => a.start - b.start)
  const merged: { start: number; end: number }[] = []
  matches.forEach(m => {
    if (merged.length === 0) {
      merged.push(m)
    } else {
      const last = merged[merged.length - 1]
      if (m.start <= last.end) {
        last.end = Math.max(last.end, m.end)
      } else {
        merged.push(m)
      }
    }
  })

  const parts: React.ReactNode[] = []
  let cursor = 0

  merged.forEach((m, idx) => {
    if (m.start > cursor) {
      parts.push(text.substring(cursor, m.start))
    }
    parts.push(
      <mark
        key={`match-${idx}`}
        className="bg-amber-200 text-amber-950 font-semibold px-1 rounded-md shadow-sm"
      >
        {text.substring(m.start, m.end)}
      </mark>
    )
    cursor = m.end
  })

  if (cursor < text.length) {
    parts.push(text.substring(cursor))
  }

  return <span>{parts}</span>
}

export interface SearchResultItem {
  id: string
  clientId: string
  clientName: string
  clientPhone: string
  clientEmail?: string
  clientPhotoUrl?: string
  referencia: string
  sector: string
  tarifa: string | number
  latlong?: string
  photo?: string
  source: 'ubicaciones' | 'pedido'
  orderId?: string
  orderDate?: Date
  businessName?: string
  allOtherLocations: ClientLocation[]
  totalOrdersCount: number
}

const COMMON_QUICK_SEARCHES = [
  'parque',
  'farmacia',
  'esquina',
  'porton',
  'condominio',
  'calle',
  'diagonal',
  'edificio',
  'frente',
  'tienda'
]

export default function AdminClientReferenceSearchPage() {
  const [clients, setClients] = useState<FirestoreClient[]>([])
  const [locations, setLocations] = useState<ClientLocation[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null)

  // Filtros
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedSector, setSelectedSector] = useState('all')
  const [filterSource, setFilterSource] = useState<'all' | 'ubicaciones' | 'pedidos'>('all')
  const [onlyWithCoordinates, setOnlyWithCoordinates] = useState(false)
  const [onlyWithPhoto, setOnlyWithPhoto] = useState(false)
  const [viewMode, setViewMode] = useState<'cards' | 'grouped' | 'table'>('cards')

  // Modales
  const [mapModalData, setMapModalData] = useState<{
    lat: number
    lng: number
    referencia: string
    clientName: string
  } | null>(null)
  const [photoModalData, setPhotoModalData] = useState<{
    url: string
    title: string
    clientName: string
  } | null>(null)
  const [clientDetailModal, setClientDetailModal] = useState<FirestoreClient | null>(null)

  // Feedback de copiado
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // Acordeón de otras ubicaciones abiertas por item ID
  const [expandedLocations, setExpandedLocations] = useState<Record<string, boolean>>({})

  const toggleExpand = (id: string) => {
    setExpandedLocations(prev => ({ ...prev, [id]: !prev[id] }))
  }

  // Cargar datos iniciales
  const loadData = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true)
    } else {
      setLoading(true)
    }

    try {
      const [fetchedClients, fetchedLocations, fetchedOrders] = await Promise.all([
        getAllClientsGlobal().catch(err => {
          console.warn('Error fetching clients:', err)
          return [] as FirestoreClient[]
        }),
        getAllClientLocations().catch(err => {
          console.warn('Error fetching locations:', err)
          return [] as ClientLocation[]
        }),
        getAllOrders().catch(err => {
          console.warn('Error fetching orders:', err)
          return [] as Order[]
        })
      ])

      setClients(fetchedClients)
      setLocations(fetchedLocations)
      setOrders(fetchedOrders)
      setLastRefreshedAt(new Date())
    } catch (error) {
      console.error('Error loading search data:', error)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Crear mapas rápidos para búsqueda de clientes
  const clientsById = useMemo(() => {
    const map = new Map<string, FirestoreClient>()
    clients.forEach(c => {
      if (c.id) map.set(c.id, c)
      if (c.celular) {
        const clean = c.celular.replace(/\D/g, '')
        map.set(clean, c)
      }
    })
    return map
  }, [clients])

  const clientOrdersCount = useMemo(() => {
    const countMap = new Map<string, number>()
    orders.forEach(o => {
      const custPhone = o.customer?.phone?.replace(/\D/g, '')
      const custId = o.customer?.id
      if (custPhone) {
        countMap.set(custPhone, (countMap.get(custPhone) || 0) + 1)
      }
      if (custId) {
        countMap.set(custId, (countMap.get(custId) || 0) + 1)
      }
    })
    return countMap
  }, [orders])

  // Ubicaciones agrupadas por cliente
  const clientLocationsMap = useMemo(() => {
    const map = new Map<string, ClientLocation[]>()
    locations.forEach(loc => {
      const key = loc.id_cliente
      if (!map.has(key)) {
        map.set(key, [])
      }
      map.get(key)!.push(loc)
    })
    return map
  }, [locations])

  // Sectores únicos detectados
  const uniqueSectors = useMemo(() => {
    const sectors = new Set<string>()
    locations.forEach(l => {
      if (l.sector && l.sector.trim()) sectors.add(l.sector.trim())
    })
    orders.forEach(o => {
      if (o.delivery?.sector && o.delivery.sector.trim()) {
        sectors.add(o.delivery.sector.trim())
      }
    })
    return Array.from(sectors).sort((a, b) => a.localeCompare(b))
  }, [locations, orders])

  // Procesar y unificar todas las referencias de entrega disponibles
  const allReferences = useMemo(() => {
    const list: SearchResultItem[] = []
    const seenUbicacionIds = new Set<string>()

    // 1. Agregar desde tabla ubicaciones
    locations.forEach(loc => {
      if (!loc.referencia || !loc.referencia.trim()) return
      seenUbicacionIds.add(loc.id)

      // Buscar cliente asociado por ID o por celular
      const client = clientsById.get(loc.id_cliente) || clientsById.get(loc.id_cliente.replace(/\D/g, ''))
      const clientPhone = client?.celular || (loc.id_cliente.startsWith('09') ? loc.id_cliente : '')
      const clientName = client?.nombres || 'Cliente no registrado'

      const otherLocs = (clientLocationsMap.get(loc.id_cliente) || []).filter(l => l.id !== loc.id)
      const totalOrders = clientOrdersCount.get(loc.id_cliente) || (clientPhone ? clientOrdersCount.get(clientPhone.replace(/\D/g, '')) : 0) || 0

      list.push({
        id: `loc_${loc.id}`,
        clientId: client?.id || loc.id_cliente,
        clientName,
        clientPhone,
        clientEmail: client?.email,
        clientPhotoUrl: client?.photoURL,
        referencia: loc.referencia.trim(),
        sector: loc.sector || 'Sin sector especificado',
        tarifa: loc.tarifa || '0.00',
        latlong: loc.latlong,
        photo: loc.photo,
        source: 'ubicaciones',
        allOtherLocations: otherLocs,
        totalOrdersCount: totalOrders
      })
    })

    // 2. Agregar referencias desde pedidos de entrega
    orders.forEach(order => {
      if (order.delivery?.type !== 'delivery') return
      const refText = (order.delivery?.references || order.delivery?.selectedLocation?.referencia || '').trim()
      if (!refText) return

      // Evitar duplicados exactos si ya existe en ubicaciones para el mismo cliente
      const customerPhone = order.customer?.phone || ''
      const customerName = order.customer?.name || 'Cliente de Pedido'
      const customerId = order.customer?.id || ''

      const alreadyInList = list.some(item =>
        item.referencia.toLowerCase() === refText.toLowerCase() &&
        (item.clientPhone === customerPhone || item.clientId === customerId)
      )

      if (!alreadyInList) {
        const client = (customerId ? clientsById.get(customerId) : null) ||
                       (customerPhone ? clientsById.get(customerPhone.replace(/\D/g, '')) : null)
        const otherLocs = customerId ? (clientLocationsMap.get(customerId) || []) : []
        const totalOrders = (customerPhone ? clientOrdersCount.get(customerPhone.replace(/\D/g, '')) : 0) || 1

        list.push({
          id: `ord_${order.id}`,
          clientId: client?.id || customerId || customerPhone,
          clientName: client?.nombres || customerName,
          clientPhone: client?.celular || customerPhone,
          clientEmail: client?.email,
          clientPhotoUrl: client?.photoURL,
          referencia: refText,
          sector: order.delivery?.sector || 'Sin sector especificado',
          tarifa: order.delivery?.tarifa || order.delivery?.deliveryCost || '0.00',
          latlong: order.delivery?.latlong,
          photo: order.delivery?.photo || order.delivery?.selectedLocation?.photo,
          source: 'pedido',
          orderId: order.id,
          orderDate: order.createdAt instanceof Date ? order.createdAt : undefined,
          businessName: order.businessSnapshot?.name || order.businessId,
          allOtherLocations: otherLocs,
          totalOrdersCount: totalOrders
        })
      }
    })

    return list
  }, [locations, orders, clientsById, clientLocationsMap, clientOrdersCount])

  // Filtrado y búsqueda reactiva
  const filteredResults = useMemo(() => {
    const normQuery = normalizeText(searchTerm)
    const searchTerms = normQuery.split(/\s+/).filter(t => t.length > 0)

    return allReferences.filter(item => {
      // Filtro de origen
      if (filterSource === 'ubicaciones' && item.source !== 'ubicaciones') return false
      if (filterSource === 'pedidos' && item.source !== 'pedido') return false

      // Filtro por sector
      if (selectedSector !== 'all' && item.sector.toLowerCase() !== selectedSector.toLowerCase()) {
        return false
      }

      // Filtro solo con coordenadas
      if (onlyWithCoordinates && (!item.latlong || !item.latlong.includes(','))) {
        return false
      }

      // Filtro solo con foto
      if (onlyWithPhoto && !item.photo) {
        return false
      }

      // Búsqueda por término (referencia, cliente, teléfono, sector)
      if (searchTerms.length > 0) {
        const itemRefNorm = normalizeText(item.referencia)
        const clientNameNorm = normalizeText(item.clientName)
        const clientPhoneNorm = (item.clientPhone || '').replace(/\D/g, '')
        const sectorNorm = normalizeText(item.sector)

        // Todos los términos ingresados deben coincidir en la referencia o datos del cliente
        const matchesAllTerms = searchTerms.every(term => {
          return (
            itemRefNorm.includes(term) ||
            clientNameNorm.includes(term) ||
            clientPhoneNorm.includes(term) ||
            sectorNorm.includes(term)
          )
        })

        if (!matchesAllTerms) return false
      }

      return true
    })
  }, [allReferences, searchTerm, filterSource, selectedSector, onlyWithCoordinates, onlyWithPhoto])

  // Agrupado por cliente para vista de clientes
  const groupedByClient = useMemo(() => {
    const map = new Map<string, {
      clientId: string
      clientName: string
      clientPhone: string
      clientEmail?: string
      clientPhotoUrl?: string
      items: SearchResultItem[]
      totalOrders: number
    }>()

    filteredResults.forEach(item => {
      const key = item.clientId || item.clientPhone || item.id
      if (!map.has(key)) {
        map.set(key, {
          clientId: item.clientId,
          clientName: item.clientName,
          clientPhone: item.clientPhone,
          clientEmail: item.clientEmail,
          clientPhotoUrl: item.clientPhotoUrl,
          items: [],
          totalOrders: item.totalOrdersCount
        })
      }
      map.get(key)!.items.push(item)
    })

    return Array.from(map.values()).sort((a, b) => a.clientName.localeCompare(b.clientName))
  }, [filteredResults])

  // Copiar al portapapeles con animación
  const handleCopy = async (text: string, identifier: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedId(identifier)
      setTimeout(() => setCopiedId(null), 2000)
    } catch (err) {
      console.error('Error al copiar:', err)
    }
  }

  // Abrir modal de mapa
  const handleOpenMap = (latlong: string, referencia: string, clientName: string) => {
    if (!latlong || !latlong.includes(',')) return
    const [latStr, lngStr] = latlong.split(',').map(s => s.trim())
    const lat = parseFloat(latStr)
    const lng = parseFloat(lngStr)
    if (!isNaN(lat) && !isNaN(lng)) {
      setMapModalData({ lat, lng, referencia, clientName })
    }
  }

  return (
    <div className="space-y-6 pb-12">
      {/* Encabezado Principal */}
      <div className="bg-white rounded-3xl p-6 md:p-8 border border-gray-100 shadow-sm transition-all">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-xs font-bold tracking-wide">
              <i className="bi bi-geo-alt-fill text-blue-600"></i>
              BÚSQUEDA AVANZADA DE CLIENTES
            </div>
            <h1 className="text-2xl md:text-3xl font-black text-gray-900 tracking-tight leading-tight">
              Búsqueda de Clientes por Referencia
            </h1>
            <p className="text-sm md:text-base font-medium text-gray-500 leading-relaxed max-w-2xl">
              Localiza clientes y sus datos de contacto buscando por descripción de ubicación, calle, punto de referencia o sector de entrega.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => loadData(true)}
              disabled={refreshing || loading}
              className="inline-flex items-center gap-2 bg-gray-50 hover:bg-gray-100 text-gray-700 px-4 py-2.5 rounded-2xl text-xs font-bold uppercase tracking-wider transition-all border border-gray-200 active:scale-95 disabled:opacity-50"
            >
              <i className={`bi bi-arrow-repeat text-base ${refreshing ? 'animate-spin text-blue-600' : ''}`}></i>
              {refreshing ? 'Actualizando...' : 'Actualizar'}
            </button>
            {lastRefreshedAt && (
              <span className="text-xs text-gray-400 font-medium hidden sm:inline">
                Actualizado {lastRefreshedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        </div>

        {/* Estadísticas Rápidas */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 pt-6 border-t border-gray-100">
          <div className="bg-gray-50/80 rounded-2xl p-4 border border-gray-100">
            <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400 block mb-1">
              Coincidencias
            </span>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-black text-blue-600 tracking-tight">
                {filteredResults.length}
              </span>
              <span className="text-xs font-medium text-gray-400">referencias</span>
            </div>
          </div>

          <div className="bg-gray-50/80 rounded-2xl p-4 border border-gray-100">
            <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400 block mb-1">
              Clientes Únicos
            </span>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-black text-gray-900 tracking-tight">
                {groupedByClient.length}
              </span>
              <span className="text-xs font-medium text-gray-400">usuarios</span>
            </div>
          </div>

          <div className="bg-gray-50/80 rounded-2xl p-4 border border-gray-100">
            <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400 block mb-1">
              Total Ubicaciones
            </span>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-black text-gray-800 tracking-tight">
                {locations.length}
              </span>
              <span className="text-xs font-medium text-gray-400">guardadas</span>
            </div>
          </div>

          <div className="bg-gray-50/80 rounded-2xl p-4 border border-gray-100">
            <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400 block mb-1">
              Pedidos Analizados
            </span>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-black text-gray-800 tracking-tight">
                {orders.length}
              </span>
              <span className="text-xs font-medium text-gray-400">órdenes</span>
            </div>
          </div>
        </div>
      </div>

      {/* Barra de Búsqueda y Filtros */}
      <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm space-y-4">
        {/* Input Principal */}
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-400">
            <i className="bi bi-search text-lg"></i>
          </div>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar por referencia (ej: frente al parque, casa blanca de 2 pisos, portón negro, calle Bolívar)..."
            className="w-full pl-12 pr-12 py-4 bg-gray-50 hover:bg-gray-100/80 focus:bg-white border border-gray-200 focus:border-blue-500 rounded-2xl text-sm md:text-base font-medium text-gray-900 focus:outline-none focus:ring-4 focus:ring-blue-500/10 transition-all placeholder:text-gray-400"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute inset-y-0 right-0 pr-4 flex items-center text-gray-400 hover:text-gray-700 transition-colors"
              title="Borrar búsqueda"
            >
              <i className="bi bi-x-circle-fill text-lg"></i>
            </button>
          )}
        </div>

        {/* Búsquedas Rápidas Populares */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-xs font-bold uppercase tracking-wider text-gray-400 flex items-center gap-1 mr-1">
            <i className="bi bi-lightning-charge-fill text-amber-500"></i>
            Filtros rápidos:
          </span>
          {COMMON_QUICK_SEARCHES.map(keyword => {
            const isActive = searchTerm.toLowerCase().includes(keyword)
            return (
              <button
                key={keyword}
                onClick={() => {
                  if (isActive) {
                    setSearchTerm(prev => prev.replace(new RegExp(keyword, 'gi'), '').trim())
                  } else {
                    setSearchTerm(keyword)
                  }
                }}
                className={`text-xs px-3 py-1.5 rounded-xl font-bold transition-all border ${
                  isActive
                    ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                    : 'bg-gray-50 hover:bg-gray-100 text-gray-600 border-gray-200'
                }`}
              >
                #{keyword}
              </button>
            )
          })}
        </div>

        {/* Filtros Secundarios y Modos de Vista */}
        <div className="flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-gray-100">
          <div className="flex flex-wrap items-center gap-3">
            {/* Filtro Origen */}
            <select
              value={filterSource}
              onChange={(e) => setFilterSource(e.target.value as any)}
              className="bg-gray-50 border border-gray-200 text-gray-700 text-xs font-bold rounded-xl px-3 py-2 focus:outline-none focus:border-blue-500"
            >
              <option value="all">Todas las fuentes</option>
              <option value="ubicaciones">Solo Ubicaciones Guardadas</option>
              <option value="pedidos">Solo Pedidos Recientes</option>
            </select>

            {/* Filtro Sector */}
            {uniqueSectors.length > 0 && (
              <select
                value={selectedSector}
                onChange={(e) => setSelectedSector(e.target.value)}
                className="bg-gray-50 border border-gray-200 text-gray-700 text-xs font-bold rounded-xl px-3 py-2 focus:outline-none focus:border-blue-500 max-w-[200px]"
              >
                <option value="all">Todos los sectores ({uniqueSectors.length})</option>
                {uniqueSectors.map(sec => (
                  <option key={sec} value={sec}>{sec}</option>
                ))}
              </select>
            )}

            {/* Switch Solo con GPS */}
            <label className="inline-flex items-center gap-2 cursor-pointer text-xs font-bold text-gray-600 select-none bg-gray-50 hover:bg-gray-100 px-3 py-2 rounded-xl border border-gray-200 transition-colors">
              <input
                type="checkbox"
                checked={onlyWithCoordinates}
                onChange={(e) => setOnlyWithCoordinates(e.target.checked)}
                className="rounded text-blue-600 focus:ring-blue-500 w-3.5 h-3.5"
              />
              <i className="bi bi-geo text-blue-600"></i>
              Solo con GPS
            </label>

            {/* Switch Solo con Foto */}
            <label className="inline-flex items-center gap-2 cursor-pointer text-xs font-bold text-gray-600 select-none bg-gray-50 hover:bg-gray-100 px-3 py-2 rounded-xl border border-gray-200 transition-colors">
              <input
                type="checkbox"
                checked={onlyWithPhoto}
                onChange={(e) => setOnlyWithPhoto(e.target.checked)}
                className="rounded text-blue-600 focus:ring-blue-500 w-3.5 h-3.5"
              />
              <i className="bi bi-camera text-purple-600"></i>
              Solo con Foto
            </label>
          </div>

          {/* Selector de Modo de Vista */}
          <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-2xl border border-gray-200">
            <button
              onClick={() => setViewMode('cards')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                viewMode === 'cards'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-800'
              }`}
              title="Vista de referencias individuales"
            >
              <i className="bi bi-card-heading"></i>
              <span className="hidden sm:inline">Por Referencia</span>
            </button>
            <button
              onClick={() => setViewMode('grouped')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                viewMode === 'grouped'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-800'
              }`}
              title="Vista agrupada por cliente"
            >
              <i className="bi bi-people-fill"></i>
              <span className="hidden sm:inline">Por Cliente</span>
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                viewMode === 'table'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-800'
              }`}
              title="Vista de tabla compacta"
            >
              <i className="bi bi-table"></i>
              <span className="hidden sm:inline">Tabla</span>
            </button>
          </div>
        </div>
      </div>

      {/* Estados de Carga / Resultados */}
      {loading ? (
        <div className="bg-white rounded-3xl p-12 text-center border border-gray-100 shadow-sm space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent mx-auto"></div>
          <h3 className="text-lg font-black text-gray-900 tracking-tight">Cargando datos de clientes y referencias...</h3>
          <p className="text-xs text-gray-500 font-medium">Sincronizando perfiles y ubicaciones de entrega desde Firestore.</p>
        </div>
      ) : filteredResults.length === 0 ? (
        <div className="bg-white rounded-3xl p-12 text-center border border-gray-100 shadow-sm space-y-4">
          <div className="w-16 h-16 bg-gray-100 text-gray-400 rounded-3xl flex items-center justify-center mx-auto text-2xl">
            <i className="bi bi-search"></i>
          </div>
          <h3 className="text-lg font-black text-gray-900 tracking-tight">No se encontraron referencias</h3>
          <p className="text-sm font-medium text-gray-500 max-w-md mx-auto leading-relaxed">
            {searchTerm
              ? `No hay coincidencias para "${searchTerm}". Intenta buscar con una sola palabra clave como "parque", "farmacia" o el número de teléfono del cliente.`
              : 'No hay ubicaciones registradas con los filtros seleccionados.'}
          </p>
          {(searchTerm || selectedSector !== 'all' || filterSource !== 'all' || onlyWithCoordinates || onlyWithPhoto) && (
            <button
              onClick={() => {
                setSearchTerm('')
                setSelectedSector('all')
                setFilterSource('all')
                setOnlyWithCoordinates(false)
                setOnlyWithPhoto(false)
              }}
              className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-2xl text-xs font-bold uppercase tracking-wider transition-all shadow-md shadow-blue-600/20 active:scale-95"
            >
              <i className="bi bi-eraser-fill"></i>
              Limpiar todos los filtros
            </button>
          )}
        </div>
      ) : (
        <>
          {/* MODO 1: TARJETAS POR REFERENCIA */}
          {viewMode === 'cards' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredResults.map((item) => {
                const waPhone = cleanPhoneForWhatsApp(item.clientPhone)
                const waMessage = encodeURIComponent(
                  `Hola ${item.clientName}, te saludamos de Fuddi con respecto a tu ubicación de entrega (${item.referencia}).`
                )
                const waUrl = waPhone ? `https://wa.me/${waPhone}?text=${waMessage}` : ''
                const hasCoordinates = !!(item.latlong && item.latlong.includes(','))
                const isExpanded = !!expandedLocations[item.id]

                return (
                  <div
                    key={item.id}
                    className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm hover:shadow-md transition-all flex flex-col justify-between space-y-4"
                  >
                    <div className="space-y-4">
                      {/* Cabecera del Cliente */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-black flex items-center justify-center text-sm shadow-md shadow-blue-600/10 shrink-0">
                            {item.clientPhotoUrl ? (
                              <img
                                src={item.clientPhotoUrl}
                                alt={item.clientName}
                                className="w-full h-full object-cover rounded-2xl"
                              />
                            ) : (
                              item.clientName.substring(0, 2).toUpperCase()
                            )}
                          </div>
                          <div className="min-w-0">
                            <h3 className="text-base font-black text-gray-900 tracking-tight leading-tight truncate">
                              {item.clientName}
                            </h3>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-xs font-bold text-gray-500">
                                {formatDisplayPhone(item.clientPhone)}
                              </span>
                              {item.totalOrdersCount > 0 && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-50 text-emerald-700">
                                  {item.totalOrdersCount} {item.totalOrdersCount === 1 ? 'pedido' : 'pedidos'}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Badge de Origen */}
                        <div className="shrink-0">
                          {item.source === 'ubicaciones' ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-[10px] font-black uppercase tracking-wider bg-blue-50 text-blue-700 border border-blue-100">
                              <i className="bi bi-bookmark-check-fill text-blue-600"></i>
                              Guardada
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-[10px] font-black uppercase tracking-wider bg-amber-50 text-amber-800 border border-amber-100">
                              <i className="bi bi-bag-check-fill text-amber-600"></i>
                              {item.businessName ? item.businessName.substring(0, 14) : 'Pedido'}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Bloque de Referencia */}
                      <div className="bg-gray-50/80 rounded-2xl p-4 border border-gray-100 space-y-2">
                        <div className="flex items-center justify-between text-xs text-gray-400 font-bold uppercase tracking-wider">
                          <span className="flex items-center gap-1.5">
                            <i className="bi bi-pin-map-fill text-red-500"></i>
                            Referencia de Entrega
                          </span>
                          <button
                            onClick={() => handleCopy(item.referencia, `ref_${item.id}`)}
                            className="text-gray-400 hover:text-gray-700 text-xs font-bold transition-colors"
                            title="Copiar texto de referencia"
                          >
                            {copiedId === `ref_${item.id}` ? (
                              <span className="text-emerald-600 font-bold">¡Copiado!</span>
                            ) : (
                              <i className="bi bi-clipboard"></i>
                            )}
                          </button>
                        </div>
                        <p className="text-sm font-medium text-gray-800 leading-relaxed break-words">
                          <HighlightText text={item.referencia} query={searchTerm} />
                        </p>

                        {/* Metadatos de Sector y Tarifa */}
                        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-200/60 text-xs font-bold">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-gray-200/70 text-gray-700 text-[11px]">
                            <i className="bi bi-compass"></i>
                            {item.sector}
                          </span>
                          {item.tarifa && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-50 text-emerald-800 text-[11px]">
                              <i className="bi bi-currency-dollar"></i>
                              Tarifa: ${typeof item.tarifa === 'number' ? item.tarifa.toFixed(2) : item.tarifa}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Foto de la Referencia / Fachada si existe */}
                      {item.photo && (
                        <div className="relative rounded-2xl overflow-hidden border border-gray-200 group bg-gray-100">
                          <img
                            src={item.photo}
                            alt={`Referencia de ${item.clientName}`}
                            className="w-full h-36 object-cover cursor-pointer group-hover:scale-105 transition-transform duration-300"
                            onClick={() => setPhotoModalData({
                              url: item.photo!,
                              title: item.referencia,
                              clientName: item.clientName
                            })}
                          />
                          <div
                            onClick={() => setPhotoModalData({
                              url: item.photo!,
                              title: item.referencia,
                              clientName: item.clientName
                            })}
                            className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer text-white text-xs font-bold gap-1"
                          >
                            <i className="bi bi-arrows-fullscreen"></i>
                            Ampliar Foto
                          </div>
                        </div>
                      )}

                      {/* Coordenadas GPS */}
                      {hasCoordinates && (
                        <div className="flex items-center justify-between bg-blue-50/50 rounded-xl px-3 py-2 border border-blue-100/80 text-xs">
                          <div className="flex items-center gap-1.5 text-blue-900 font-bold truncate">
                            <i className="bi bi-geo-alt-fill text-blue-600"></i>
                            <span className="truncate">{item.latlong}</span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              onClick={() => handleCopy(item.latlong!, `gps_${item.id}`)}
                              className="text-blue-700 hover:text-blue-900 font-bold text-[11px]"
                              title="Copiar coordenadas"
                            >
                              {copiedId === `gps_${item.id}` ? '¡Copiado!' : 'Copiar'}
                            </button>
                            <button
                              onClick={() => handleOpenMap(item.latlong!, item.referencia, item.clientName)}
                              className="bg-blue-600 text-white px-2 py-0.5 rounded-lg font-bold text-[11px] hover:bg-blue-700 transition-colors shadow-sm"
                            >
                              Ver Mapa
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Acciones Rápidas */}
                    <div className="space-y-2 pt-3 border-t border-gray-100">
                      <div className="grid grid-cols-2 gap-2">
                        {/* WhatsApp */}
                        {waUrl ? (
                          <a
                            href={waUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white py-2.5 px-3 rounded-2xl text-xs font-bold tracking-wide transition-all shadow-md shadow-emerald-700/20 active:scale-95"
                          >
                            <i className="bi bi-whatsapp text-sm"></i>
                            <span>WhatsApp</span>
                          </a>
                        ) : (
                          <button
                            disabled
                            className="flex items-center justify-center gap-2 bg-gray-100 text-gray-400 py-2.5 px-3 rounded-2xl text-xs font-bold cursor-not-allowed"
                          >
                            <i className="bi bi-whatsapp text-sm"></i>
                            <span>Sin número</span>
                          </button>
                        )}

                        {/* Llamar / Copiar Teléfono */}
                        {item.clientPhone ? (
                          <div className="flex gap-1">
                            <a
                              href={`tel:${item.clientPhone}`}
                              className="flex-1 flex items-center justify-center gap-1.5 bg-gray-900 hover:bg-black text-white py-2.5 px-2 rounded-2xl text-xs font-bold tracking-wide transition-all active:scale-95"
                            >
                              <i className="bi bi-telephone-fill text-xs"></i>
                              <span>Llamar</span>
                            </a>
                            <button
                              onClick={() => handleCopy(item.clientPhone, `phone_${item.id}`)}
                              className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 rounded-2xl text-xs font-bold transition-colors"
                              title="Copiar número"
                            >
                              {copiedId === `phone_${item.id}` ? (
                                <i className="bi bi-check-lg text-emerald-600"></i>
                              ) : (
                                <i className="bi bi-clipboard"></i>
                              )}
                            </button>
                          </div>
                        ) : (
                          <button
                            disabled
                            className="flex items-center justify-center gap-2 bg-gray-100 text-gray-400 py-2.5 px-3 rounded-2xl text-xs font-bold cursor-not-allowed"
                          >
                            <i className="bi bi-telephone-x"></i>
                            <span>No disponible</span>
                          </button>
                        )}
                      </div>

                      {/* Botones de Navegación Externa si tiene coordenadas */}
                      {hasCoordinates && (
                        <div className="flex gap-2 pt-1">
                          <a
                            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.latlong!)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex-1 flex items-center justify-center gap-1.5 bg-gray-50 hover:bg-gray-100 text-gray-700 py-2 rounded-xl text-[11px] font-bold border border-gray-200 transition-colors"
                          >
                            <i className="bi bi-google text-red-500"></i>
                            Google Maps
                          </a>
                          <a
                            href={`https://waze.com/ul?ll=${encodeURIComponent(item.latlong!)}&navigate=yes`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex-1 flex items-center justify-center gap-1.5 bg-gray-50 hover:bg-gray-100 text-gray-700 py-2 rounded-xl text-[11px] font-bold border border-gray-200 transition-colors"
                          >
                            <i className="bi bi-cursor-fill text-cyan-500"></i>
                            Waze
                          </a>
                        </div>
                      )}

                      {/* Otras ubicaciones del cliente (Acordeón) */}
                      {item.allOtherLocations.length > 0 && (
                        <div className="pt-2">
                          <button
                            onClick={() => toggleExpand(item.id)}
                            className="w-full flex items-center justify-between text-xs font-bold text-gray-500 hover:text-blue-600 transition-colors py-1 px-2 rounded-lg hover:bg-gray-50"
                          >
                            <span className="flex items-center gap-1.5">
                              <i className="bi bi-geo-alt"></i>
                              Otras ubicaciones del cliente ({item.allOtherLocations.length})
                            </span>
                            <i className={`bi bi-chevron-${isExpanded ? 'up' : 'down'}`}></i>
                          </button>

                          {isExpanded && (
                            <div className="mt-2 space-y-2 pl-2 border-l-2 border-blue-200">
                              {item.allOtherLocations.map((otherLoc) => (
                                <div
                                  key={otherLoc.id}
                                  className="bg-gray-50 p-2.5 rounded-xl text-xs space-y-1 border border-gray-100"
                                >
                                  <p className="font-medium text-gray-800 break-words">
                                    {otherLoc.referencia}
                                  </p>
                                  <div className="flex items-center justify-between text-[10px] text-gray-500">
                                    <span>{otherLoc.sector || 'Sin sector'}</span>
                                    {otherLoc.latlong && (
                                      <button
                                        onClick={() => handleOpenMap(otherLoc.latlong!, otherLoc.referencia, item.clientName)}
                                        className="text-blue-600 hover:underline font-bold"
                                      >
                                        Ver en mapa
                                      </button>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* MODO 2: AGRUPADO POR CLIENTE */}
          {viewMode === 'grouped' && (
            <div className="space-y-4">
              {groupedByClient.map((clientGroup) => {
                const waPhone = cleanPhoneForWhatsApp(clientGroup.clientPhone)
                const waUrl = waPhone ? `https://wa.me/${waPhone}` : ''

                return (
                  <div
                    key={clientGroup.clientId || clientGroup.clientPhone}
                    className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm space-y-4"
                  >
                    {/* Header del Cliente */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-gray-100">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-black flex items-center justify-center text-base shadow-md shadow-blue-600/10 shrink-0">
                          {clientGroup.clientPhotoUrl ? (
                            <img
                              src={clientGroup.clientPhotoUrl}
                              alt={clientGroup.clientName}
                              className="w-full h-full object-cover rounded-2xl"
                            />
                          ) : (
                            clientGroup.clientName.substring(0, 2).toUpperCase()
                          )}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-lg font-black text-gray-900 tracking-tight">
                              {clientGroup.clientName}
                            </h3>
                            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-blue-50 text-blue-700">
                              {clientGroup.items.length} {clientGroup.items.length === 1 ? 'ubicación coincidente' : 'ubicaciones coincidentes'}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-xs text-gray-500 font-medium mt-0.5">
                            <span className="font-bold text-gray-700">
                              {formatDisplayPhone(clientGroup.clientPhone)}
                            </span>
                            {clientGroup.clientEmail && (
                              <span className="hidden md:inline text-gray-400">
                                {clientGroup.clientEmail}
                              </span>
                            )}
                            {clientGroup.totalOrders > 0 && (
                              <span className="text-emerald-700 font-bold">
                                • {clientGroup.totalOrders} pedidos totales
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {waUrl && (
                          <a
                            href={waUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-sm active:scale-95"
                          >
                            <i className="bi bi-whatsapp"></i>
                            WhatsApp
                          </a>
                        )}
                        {clientGroup.clientPhone && (
                          <a
                            href={`tel:${clientGroup.clientPhone}`}
                            className="inline-flex items-center gap-1.5 bg-gray-900 hover:bg-black text-white px-4 py-2 rounded-xl text-xs font-bold transition-all active:scale-95"
                          >
                            <i className="bi bi-telephone-fill text-xs"></i>
                            Llamar
                          </a>
                        )}
                      </div>
                    </div>

                    {/* Lista de Ubicaciones del Cliente */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 pt-1">
                      {clientGroup.items.map((item) => {
                        const hasCoordinates = !!(item.latlong && item.latlong.includes(','))
                        return (
                          <div
                            key={item.id}
                            className="bg-gray-50/80 rounded-2xl p-4 border border-gray-100 flex flex-col justify-between space-y-3"
                          >
                            <div className="space-y-2">
                              <div className="flex items-center justify-between text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                                <span>{item.source === 'ubicaciones' ? 'Guardada' : 'De Pedido'}</span>
                                <span className="text-gray-700">{item.sector}</span>
                              </div>
                              <p className="text-xs font-medium text-gray-800 leading-relaxed">
                                <HighlightText text={item.referencia} query={searchTerm} />
                              </p>
                              {item.photo && (
                                <img
                                  src={item.photo}
                                  alt="Fachada"
                                  className="w-full h-24 object-cover rounded-xl cursor-pointer hover:opacity-90 transition-opacity"
                                  onClick={() => setPhotoModalData({
                                    url: item.photo!,
                                    title: item.referencia,
                                    clientName: item.clientName
                                  })}
                                />
                              )}
                            </div>

                            <div className="pt-2 border-t border-gray-200/60 flex items-center justify-between text-xs">
                              {hasCoordinates ? (
                                <button
                                  onClick={() => handleOpenMap(item.latlong!, item.referencia, item.clientName)}
                                  className="text-blue-600 hover:text-blue-800 font-bold flex items-center gap-1 text-[11px]"
                                >
                                  <i className="bi bi-geo-alt-fill"></i>
                                  Ver mapa
                                </button>
                              ) : (
                                <span className="text-gray-400 text-[10px]">Sin GPS</span>
                              )}

                              <button
                                onClick={() => handleCopy(item.referencia, `ref_${item.id}`)}
                                className="text-gray-400 hover:text-gray-700 font-bold text-[11px]"
                              >
                                {copiedId === `ref_${item.id}` ? '¡Copiado!' : 'Copiar ref.'}
                              </button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* MODO 3: TABLA COMPACTA */}
          {viewMode === 'table' && (
            <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-50/80 text-gray-400 font-bold uppercase tracking-wider border-b border-gray-100">
                    <tr>
                      <th className="py-4 px-4">Cliente</th>
                      <th className="py-4 px-4">Teléfono</th>
                      <th className="py-4 px-4 min-w-[280px]">Referencia de Ubicación</th>
                      <th className="py-4 px-4">Sector</th>
                      <th className="py-4 px-4">Origen</th>
                      <th className="py-4 px-4 text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 text-gray-700 font-medium">
                    {filteredResults.map((item) => {
                      const waPhone = cleanPhoneForWhatsApp(item.clientPhone)
                      const waUrl = waPhone ? `https://wa.me/${waPhone}` : ''
                      const hasCoordinates = !!(item.latlong && item.latlong.includes(','))

                      return (
                        <tr key={item.id} className="hover:bg-gray-50/60 transition-colors">
                          <td className="py-3 px-4 font-black text-gray-900 tracking-tight">
                            {item.clientName}
                          </td>
                          <td className="py-3 px-4 font-bold text-gray-600">
                            {formatDisplayPhone(item.clientPhone)}
                          </td>
                          <td className="py-3 px-4 leading-relaxed">
                            <HighlightText text={item.referencia} query={searchTerm} />
                          </td>
                          <td className="py-3 px-4">
                            <span className="px-2 py-0.5 rounded-lg bg-gray-100 font-bold text-gray-700 text-[11px]">
                              {item.sector}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            {item.source === 'ubicaciones' ? (
                              <span className="text-[10px] font-black uppercase text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md">
                                Guardada
                              </span>
                            ) : (
                              <span className="text-[10px] font-black uppercase text-amber-800 bg-amber-50 px-2 py-0.5 rounded-md">
                                Pedido
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right space-x-1 shrink-0">
                            {waUrl && (
                              <a
                                href={waUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                                title="Abrir WhatsApp"
                              >
                                <i className="bi bi-whatsapp text-sm"></i>
                              </a>
                            )}
                            {hasCoordinates && (
                              <button
                                onClick={() => handleOpenMap(item.latlong!, item.referencia, item.clientName)}
                                className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                title="Ver en Mapa"
                              >
                                <i className="bi bi-geo-alt-fill text-sm"></i>
                              </button>
                            )}
                            <button
                              onClick={() => handleCopy(item.referencia, `ref_${item.id}`)}
                              className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                              title="Copiar Referencia"
                            >
                              <i className="bi bi-clipboard text-sm"></i>
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* MODAL DE MAPA INTERACTIVO CON GOOGLE MAPS */}
      {mapModalData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl max-w-2xl w-full shadow-2xl overflow-hidden border border-gray-100 flex flex-col">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="text-base font-black text-gray-900 tracking-tight leading-tight">
                  Ubicación de {mapModalData.clientName}
                </h3>
                <p className="text-xs text-gray-500 font-medium mt-0.5 truncate max-w-md">
                  {mapModalData.referencia}
                </p>
              </div>
              <button
                onClick={() => setMapModalData(null)}
                className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 flex items-center justify-center transition-colors"
              >
                <i className="bi bi-x-lg text-sm"></i>
              </button>
            </div>

            <div className="relative h-80 sm:h-96 w-full bg-gray-100">
              <GoogleMap
                latitude={mapModalData.lat}
                longitude={mapModalData.lng}
                zoom={16}
                marker={true}
                height="100%"
                width="100%"
              />
            </div>

            <div className="p-4 bg-gray-50 border-t border-gray-100 flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-gray-500 font-mono">
                {mapModalData.lat.toFixed(6)}, {mapModalData.lng.toFixed(6)}
              </span>
              <div className="flex items-center gap-2">
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${mapModalData.lat},${mapModalData.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-blue-600 hover:bg-blue-700 text-white px-3.5 py-2 rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-1.5"
                >
                  <i className="bi bi-box-arrow-up-right"></i>
                  Google Maps
                </a>
                <a
                  href={`https://waze.com/ul?ll=${mapModalData.lat},${mapModalData.lng}&navigate=yes`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-cyan-600 hover:bg-cyan-700 text-white px-3.5 py-2 rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-1.5"
                >
                  <i className="bi bi-cursor-fill"></i>
                  Waze
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE FOTO DE REFERENCIA EN ALTA RESOLUCIÓN */}
      {photoModalData && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => setPhotoModalData(null)}
        >
          <div
            className="bg-white rounded-3xl max-w-xl w-full shadow-2xl overflow-hidden border border-gray-100 flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-black text-gray-900 tracking-tight leading-tight">
                  Foto de Fachada / Referencia
                </h3>
                <p className="text-xs text-gray-500 font-medium truncate max-w-sm">
                  {photoModalData.clientName}
                </p>
              </div>
              <button
                onClick={() => setPhotoModalData(null)}
                className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 flex items-center justify-center transition-colors"
              >
                <i className="bi bi-x-lg text-sm"></i>
              </button>
            </div>

            <div className="max-h-[70vh] bg-black flex items-center justify-center overflow-hidden">
              <img
                src={photoModalData.url}
                alt={photoModalData.title}
                className="max-h-[70vh] w-auto object-contain"
              />
            </div>

            <div className="p-4 bg-gray-50 border-t border-gray-100 text-xs font-medium text-gray-700">
              <p className="break-words">
                <span className="font-bold text-gray-900">Referencia: </span>
                {photoModalData.title}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
