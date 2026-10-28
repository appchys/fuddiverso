'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { Order, Business, Delivery } from '@/types'
import { loadGoogleMapsAPI, GOOGLE_MAPS_API_KEY } from '@/components/GoogleMap'

interface DeliveryAssignedOrdersMapProps {
  orders: Order[]
  deliveryId: string | null
  delivery: Delivery | null
  businesses: Business[]
  deliveryLocation: { lat: number; lng: number } | null
  onOpenOrderDetails: (order: Order) => void
  onBackToOrders: () => void
  onStatusChange?: (orderId: string, status: Order['status']) => Promise<void>
}

// Extrae de forma segura coordenadas válidas del pedido
export function extractOrderCoords(order: Order): { lat: number; lng: number } | null {
  // 1. Coordenadas numéricas directas en mapLocation
  if (
    order.delivery?.mapLocation &&
    typeof order.delivery.mapLocation.lat === 'number' &&
    typeof order.delivery.mapLocation.lng === 'number' &&
    !isNaN(order.delivery.mapLocation.lat) &&
    !isNaN(order.delivery.mapLocation.lng) &&
    order.delivery.mapLocation.lat !== 0 &&
    order.delivery.mapLocation.lng !== 0
  ) {
    return {
      lat: order.delivery.mapLocation.lat,
      lng: order.delivery.mapLocation.lng
    }
  }

  // 2. Extraer de string latlong o selectedLocation
  const rawString = order.delivery?.latlong || order.delivery?.selectedLocation?.latlong
  if (rawString && typeof rawString === 'string') {
    const trimmed = rawString.trim()

    // Enlaces de Google Maps
    if (/google\.(com|es)\/maps|maps\.app\.goo\.gl|maps\.google/i.test(trimmed)) {
      const qMatch = trimmed.match(/[?&]q=(-?\d+\.?\d*),(-?\d+\.?\d*)/)
      if (qMatch) {
        return { lat: parseFloat(qMatch[1]), lng: parseFloat(qMatch[2]) }
      }
      const placeMatch = trimmed.match(/\/place\/(-?\d+\.?\d*),(-?\d+\.?\d*)/)
      if (placeMatch) {
        return { lat: parseFloat(placeMatch[1]), lng: parseFloat(placeMatch[2]) }
      }
      const atMatch = trimmed.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/)
      if (atMatch) {
        return { lat: parseFloat(atMatch[1]), lng: parseFloat(atMatch[2]) }
      }
    }

    // Formato "lat, lng" o "lat,lng"
    const clean = trimmed.replace(/[()[\]\s]/g, '')
    const parts = clean.split(',')
    if (parts.length === 2) {
      const lat = parseFloat(parts[0])
      const lng = parseFloat(parts[1])
      if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        return { lat, lng }
      }
    }
  }

  return null
}

// Determina si una fecha corresponde a hoy
function isToday(date: Date): boolean {
  const now = new Date()
  return (
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear()
  )
}

// Determina si una fecha es futura (después de hoy)
function isFuture(date: Date): boolean {
  const now = new Date()
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
  return date.getTime() > todayEnd.getTime()
}

// Obtiene la fecha del pedido
function getOrderDate(order: Order): Date {
  if (order.timing?.scheduledDate && order.timing.type === 'scheduled') {
    const ts = order.timing.scheduledDate as any
    if (typeof ts?.toDate === 'function') return ts.toDate()
    if (ts?.seconds !== undefined) return new Date(ts.seconds * 1000)
    if (ts instanceof Date) return ts
    return new Date(ts)
  }
  const createdAt = order.createdAt as any
  if (typeof createdAt?.toDate === 'function') return createdAt.toDate()
  if (createdAt?.seconds !== undefined) return new Date(createdAt.seconds * 1000)
  if (createdAt instanceof Date) return createdAt
  return new Date(createdAt || Date.now())
}

// Formateador de fecha/hora de entrega
function formatDeliveryTimeBadge(order: Order): { label: string; isFuture: boolean; isToday: boolean } {
  if (order.timing?.type !== 'scheduled') {
    return { label: '⚡ Inmediato', isFuture: false, isToday: true }
  }

  const time = order.timing.scheduledTime || ''
  const date = getOrderDate(order)

  if (isToday(date)) {
    return { label: `Hoy ${time ? `• ${time}` : ''}`, isFuture: false, isToday: true }
  }

  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const isTomorrow =
    date.getDate() === tomorrow.getDate() &&
    date.getMonth() === tomorrow.getMonth() &&
    date.getFullYear() === tomorrow.getFullYear()

  if (isTomorrow) {
    return { label: `Mañana ${time ? `• ${time}` : ''}`, isFuture: true, isToday: false }
  }

  const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
  const formatted = `${date.getDate()} ${months[date.getMonth()]} ${time ? `• ${time}` : ''}`
  return { label: formatted, isFuture: true, isToday: false }
}

export default function DeliveryAssignedOrdersMap({
  orders,
  deliveryId,
  delivery,
  businesses,
  deliveryLocation,
  onOpenOrderDetails,
  onBackToOrders,
  onStatusChange
}: DeliveryAssignedOrdersMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const [mapInstance, setMapInstance] = useState<any>(null)
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null)
  const [filterType, setFilterType] = useState<'all' | 'today' | 'future'>('all')
  const [isMapReady, setIsMapReady] = useState(false)
  const [showNoGpsList, setShowNoGpsList] = useState(false)

  // Marcadores de Google Maps almacenados en ref para actualización reactiva
  const markersRef = useRef<{ [orderId: string]: any }>({})
  const deliveryMarkerRef = useRef<any>(null)

  // 1. Filtrar TODOS los pedidos asignados activos (no entregados, no cancelados)
  // Incluye pedidos de HOY Y DE DÍAS FUTUROS (requerimiento explícito)
  const activeAssignedOrders = useMemo(() => {
    if (!deliveryId) return []
    return orders.filter(order => {
      const isAssigned = order.delivery?.assignedDelivery === deliveryId
      const isNotFinished = order.status !== 'delivered' && order.status !== 'cancelled'
      const isNotRejected = order.delivery?.acceptanceStatus !== 'rejected'
      return isAssigned && isNotFinished && isNotRejected
    })
  }, [orders, deliveryId])

  // Pedidos con coordenadas y pedidos sin coordenadas
  const { ordersWithCoords, ordersWithoutCoords } = useMemo(() => {
    const withCoords: { order: Order; coords: { lat: number; lng: number } }[] = []
    const withoutCoords: Order[] = []

    activeAssignedOrders.forEach(order => {
      const coords = extractOrderCoords(order)
      if (coords) {
        withCoords.push({ order, coords })
      } else {
        withoutCoords.push(order)
      }
    })

    return { ordersWithCoords: withCoords, ordersWithoutCoords: withoutCoords }
  }, [activeAssignedOrders])

  // Pedidos filtrados según la pestaña (Todos / Hoy / Futuros)
  const filteredOrdersWithCoords = useMemo(() => {
    return ordersWithCoords.filter(({ order }) => {
      const date = getOrderDate(order)
      if (filterType === 'today') return isToday(date)
      if (filterType === 'future') return isFuture(date)
      return true
    })
  }, [ordersWithCoords, filterType])

  // Pedido actualmente seleccionado
  const selectedOrderData = useMemo(() => {
    if (!selectedOrderId) return null
    return activeAssignedOrders.find(o => o.id === selectedOrderId) || null
  }, [activeAssignedOrders, selectedOrderId])

  // Contadores para los filtros
  const filterCounts = useMemo(() => {
    let todayCount = 0
    let futureCount = 0

    activeAssignedOrders.forEach(order => {
      const date = getOrderDate(order)
      if (isToday(date)) todayCount++
      else if (isFuture(date)) futureCount++
    })

    return {
      all: activeAssignedOrders.length,
      today: todayCount,
      future: futureCount
    }
  }, [activeAssignedOrders])

  // Cargar Google Maps API una sola vez
  useEffect(() => {
    let isMounted = true
    loadGoogleMapsAPI()
      .then(() => {
        if (isMounted) setIsMapReady(true)
      })
      .catch(err => {
        console.error('Error cargando Google Maps API:', err)
      })
    return () => {
      isMounted = false
    }
  }, [])

  // Inicializar el mapa de Google Maps
  useEffect(() => {
    if (!isMapReady || !mapContainerRef.current || !window.google || mapInstance) return

    // Centro inicial: Ecuador (Guayaquil) o ubicación del delivery si existe
    const defaultCenter = deliveryLocation || { lat: -2.1894, lng: -79.8891 }

    const map = new window.google.maps.Map(mapContainerRef.current, {
      center: defaultCenter,
      zoom: 13,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      zoomControl: true,
      zoomControlOptions: {
        position: window.google.maps.ControlPosition.RIGHT_CENTER
      },
      styles: [
        {
          featureType: 'poi',
          elementType: 'labels',
          stylers: [{ visibility: 'off' }]
        }
      ]
    })

    setMapInstance(map)
  }, [isMapReady, deliveryLocation, mapInstance])

  // Generador de SVG para el Pin de pedido
  const createPinSvgUri = (index: number, status: Order['status'], isSelected: boolean) => {
    let bgColor = '#2563EB' // blue-600
    if (status === 'on_way') bgColor = '#0284C7' // sky-600
    else if (status === 'ready') bgColor = '#059669' // emerald-600
    else if (status === 'preparing') bgColor = '#7C3AED' // purple-600

    const strokeColor = isSelected ? '#FFFFFF' : '#FFFFFF'
    const strokeWidth = isSelected ? 3 : 2
    const size = isSelected ? 48 : 38

    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 38 38">
        <defs>
          <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#000000" flood-opacity="0.35"/>
          </filter>
        </defs>
        <path d="M19 0C11.268 0 5 6.268 5 14c0 10.5 14 24 14 24s14-13.5 14-24c0-7.732-6.268-14-14-14z" 
              fill="${bgColor}" stroke="${strokeColor}" stroke-width="${strokeWidth}" filter="url(#shadow)"/>
        <circle cx="19" cy="14" r="8.5" fill="#FFFFFF"/>
        <text x="19" y="17.5" font-size="10" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif" 
              font-weight="900" fill="${bgColor}" text-anchor="middle">${index}</text>
      </svg>
    `
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`
  }

  // Generador de SVG para el Pin del repartidor
  const createDeliveryPinSvg = () => {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
        <circle cx="20" cy="20" r="18" fill="#2563EB" fill-opacity="0.25"/>
        <circle cx="20" cy="20" r="13" fill="#2563EB" stroke="#FFFFFF" stroke-width="3"/>
        <circle cx="20" cy="20" r="4.5" fill="#FFFFFF"/>
      </svg>
    `
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`
  }

  // Actualizar marcador de posición del repartidor
  useEffect(() => {
    if (!mapInstance || !window.google) return

    if (deliveryLocation) {
      if (!deliveryMarkerRef.current) {
        deliveryMarkerRef.current = new window.google.maps.Marker({
          position: deliveryLocation,
          map: mapInstance,
          title: 'Tu ubicación actual',
          zIndex: 999,
          icon: {
            url: createDeliveryPinSvg(),
            scaledSize: new window.google.maps.Size(40, 40),
            anchor: new window.google.maps.Point(20, 20)
          }
        })
      } else {
        deliveryMarkerRef.current.setPosition(deliveryLocation)
      }
    } else if (deliveryMarkerRef.current) {
      deliveryMarkerRef.current.setMap(null)
      deliveryMarkerRef.current = null
    }
  }, [mapInstance, deliveryLocation])

  // Actualizar pines de pedidos en el mapa según la lista filtrada
  useEffect(() => {
    if (!mapInstance || !window.google) return

    // Limpiar marcadores antiguos que ya no están
    const currentOrderIds = new Set(filteredOrdersWithCoords.map(item => item.order.id))
    Object.keys(markersRef.current).forEach(id => {
      if (!currentOrderIds.has(id)) {
        markersRef.current[id].setMap(null)
        delete markersRef.current[id]
      }
    })

    // Crear o actualizar marcadores para cada pedido
    filteredOrdersWithCoords.forEach(({ order, coords }, idx) => {
      const isSelected = order.id === selectedOrderId
      const pinIndex = idx + 1
      const iconUrl = createPinSvgUri(pinIndex, order.status, isSelected)
      const size = isSelected ? 48 : 38

      if (markersRef.current[order.id]) {
        // Actualizar posición e icono
        const marker = markersRef.current[order.id]
        marker.setPosition(coords)
        marker.setIcon({
          url: iconUrl,
          scaledSize: new window.google.maps.Size(size, size),
          anchor: new window.google.maps.Point(size / 2, size)
        })
        marker.setZIndex(isSelected ? 100 : 10)
      } else {
        // Crear nuevo marcador
        const marker = new window.google.maps.Marker({
          position: coords,
          map: mapInstance,
          title: `#${order.id.slice(-6)} - ${order.customer?.name || 'Cliente'}`,
          zIndex: isSelected ? 100 : 10,
          icon: {
            url: iconUrl,
            scaledSize: new window.google.maps.Size(size, size),
            anchor: new window.google.maps.Point(size / 2, size)
          }
        })

        marker.addListener('click', () => {
          setSelectedOrderId(order.id)
          mapInstance.panTo(coords)
        })

        markersRef.current[order.id] = marker
      }
    })
  }, [mapInstance, filteredOrdersWithCoords, selectedOrderId])

  // Ajustar vista para incluir todos los pines (fitBounds)
  const fitAllMarkers = () => {
    if (!mapInstance || !window.google) return

    const bounds = new window.google.maps.LatLngBounds()
    let count = 0

    filteredOrdersWithCoords.forEach(({ coords }) => {
      bounds.extend(coords)
      count++
    })

    if (deliveryLocation) {
      bounds.extend(deliveryLocation)
      count++
    }

    if (count > 0) {
      mapInstance.fitBounds(bounds, { top: 70, right: 30, bottom: 220, left: 30 })
      // Si solo hay un punto, limitar el zoom
      if (count === 1) {
        setTimeout(() => {
          if (mapInstance.getZoom() > 16) {
            mapInstance.setZoom(16)
          }
        }, 150)
      }
    }
  }

  // Ajustar el mapa al inicio si hay pedidos
  useEffect(() => {
    if (mapInstance && filteredOrdersWithCoords.length > 0) {
      fitAllMarkers()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapInstance, filterType])

  // Centrar en el pedido seleccionado
  const handleSelectOrder = (order: Order) => {
    setSelectedOrderId(order.id)
    const item = filteredOrdersWithCoords.find(i => i.order.id === order.id)
    if (item && mapInstance) {
      mapInstance.panTo(item.coords)
      mapInstance.setZoom(16)
    }
  }

  // Centrar en la ubicación del repartidor
  const handleCenterDelivery = () => {
    if (!mapInstance) return
    if (deliveryLocation) {
      mapInstance.panTo(deliveryLocation)
      mapInstance.setZoom(16)
    } else {
      alert('Tu ubicación GPS no está disponible o no se ha activado aún.')
    }
  }

  // Helper de tienda
  const getOrderBusiness = (order: Order) => {
    const matched = businesses.find(b => b.id === order.businessId)
    return {
      name: order.businessSnapshot?.name || matched?.name || 'Tienda',
      image: order.businessSnapshot?.logo || matched?.image || '',
      phone: order.businessSnapshot?.phone || matched?.phone || ''
    }
  }

  // Helper de estado del pedido
  const getStatusBadge = (status: Order['status']) => {
    switch (status) {
      case 'on_way':
        return { label: 'En camino', color: 'bg-sky-100 text-sky-800 border-sky-200' }
      case 'ready':
        return { label: 'Listo', color: 'bg-emerald-100 text-emerald-800 border-emerald-200' }
      case 'preparing':
        return { label: 'Preparando', color: 'bg-purple-100 text-purple-800 border-purple-200' }
      case 'confirmed':
        return { label: 'Confirmado', color: 'bg-blue-100 text-blue-800 border-blue-200' }
      default:
        return { label: 'Pendiente', color: 'bg-amber-100 text-amber-800 border-amber-200' }
    }
  }

  return (
    <div className="relative w-full h-[calc(100vh-4rem)] flex flex-col bg-gray-100 overflow-hidden">
      {/* Barra Superior Flotante: Título, Filtros y Acciones */}
      <div className="absolute top-3 left-3 right-3 z-20 flex flex-col gap-2 pointer-events-none">
        <div className="flex items-center justify-between gap-2 pointer-events-auto">
          {/* Botón para volver a la lista */}
          <button
            onClick={onBackToOrders}
            className="flex items-center gap-2 px-3 py-2 bg-white/95 backdrop-blur-md text-gray-800 hover:text-blue-600 rounded-2xl shadow-lg border border-gray-100 transition-all active:scale-95 text-xs font-bold"
            title="Volver a la lista de pedidos"
          >
            <i className="bi bi-arrow-left text-base"></i>
            <span className="hidden sm:inline">Lista</span>
          </button>

          {/* Título y Contador */}
          <div className="bg-white/95 backdrop-blur-md px-3.5 py-2 rounded-2xl shadow-lg border border-gray-100 flex items-center gap-2">
            <span className="text-base">🗺️</span>
            <div>
              <p className="text-xs font-black text-gray-900 leading-none tracking-tight">
                Mapa de Pedidos
              </p>
              <p className="text-[10px] font-bold text-blue-600 leading-none mt-0.5">
                {activeAssignedOrders.length} {activeAssignedOrders.length === 1 ? 'asignado' : 'asignados'}
              </p>
            </div>
          </div>

          {/* Herramientas de Mapa (Centrar en repartidor / Ajustar vista) */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={fitAllMarkers}
              className="w-10 h-10 bg-white/95 backdrop-blur-md text-gray-700 hover:text-blue-600 rounded-2xl shadow-lg border border-gray-100 flex items-center justify-center transition-all active:scale-95"
              title="Ajustar mapa a todos los pedidos"
              aria-label="Ajustar mapa a todos los pedidos"
            >
              <i className="bi bi-arrows-fullscreen text-sm"></i>
            </button>
            <button
              onClick={handleCenterDelivery}
              className={`w-10 h-10 bg-white/95 backdrop-blur-md rounded-2xl shadow-lg border border-gray-100 flex items-center justify-center transition-all active:scale-95 ${
                deliveryLocation ? 'text-blue-600 hover:bg-blue-50' : 'text-gray-400'
              }`}
              title="Centrar en mi ubicación actual"
              aria-label="Centrar en mi ubicación actual"
            >
              <i className="bi bi-crosshair text-base"></i>
            </button>
          </div>
        </div>

        {/* Selector de Filtros: Todos / Hoy / Futuros */}
        <div className="flex items-center gap-1.5 self-center bg-white/90 backdrop-blur-md p-1 rounded-2xl shadow-md border border-gray-100 pointer-events-auto">
          <button
            onClick={() => setFilterType('all')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              filterType === 'all'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Todos ({filterCounts.all})
          </button>
          <button
            onClick={() => setFilterType('today')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              filterType === 'today'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Hoy ({filterCounts.today})
          </button>
          <button
            onClick={() => setFilterType('future')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              filterType === 'future'
                ? 'bg-purple-600 text-white shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Futuros ({filterCounts.future})
          </button>
        </div>

        {/* Alerta de pedidos sin ubicación GPS (si existen) */}
        {ordersWithoutCoords.length > 0 && (
          <div className="self-center pointer-events-auto">
            <button
              onClick={() => setShowNoGpsList(prev => !prev)}
              className="px-3 py-1.5 bg-amber-500/95 text-white rounded-xl shadow-md text-xs font-bold flex items-center gap-1.5 active:scale-95 transition-all"
            >
              <i className="bi bi-exclamation-triangle-fill text-xs"></i>
              <span>{ordersWithoutCoords.length} {ordersWithoutCoords.length === 1 ? 'pedido sin GPS' : 'pedidos sin GPS'}</span>
              <i className={`bi bi-chevron-${showNoGpsList ? 'up' : 'down'} text-[10px]`}></i>
            </button>
          </div>
        )}
      </div>

      {/* Contenedor de Google Maps */}
      <div ref={mapContainerRef} className="w-full h-full flex-1" />

      {/* Modal flotante de pedidos sin GPS si el repartidor los despliega */}
      {showNoGpsList && ordersWithoutCoords.length > 0 && (
        <div className="absolute top-28 left-4 right-4 max-w-md mx-auto z-30 bg-white rounded-2xl shadow-2xl border border-amber-200 p-4 animate-fadeIn max-h-80 overflow-y-auto">
          <div className="flex items-center justify-between pb-2 border-b border-gray-100 mb-3">
            <h4 className="text-xs font-black text-gray-900 uppercase tracking-tight flex items-center gap-1.5">
              <span className="text-amber-500">⚠️</span> Pedidos sin coordenadas GPS
            </h4>
            <button
              onClick={() => setShowNoGpsList(false)}
              className="text-gray-400 hover:text-gray-600 p-1"
            >
              <i className="bi bi-x-lg text-sm"></i>
            </button>
          </div>
          <div className="space-y-2">
            {ordersWithoutCoords.map(order => {
              const b = getOrderBusiness(order)
              const timeBadge = formatDeliveryTimeBadge(order)
              return (
                <div
                  key={order.id}
                  onClick={() => {
                    setShowNoGpsList(false)
                    onOpenOrderDetails(order)
                  }}
                  className="p-3 bg-amber-50/60 rounded-xl border border-amber-100 hover:bg-amber-100/60 cursor-pointer transition-all"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-black text-gray-900">{order.customer?.name || 'Cliente'}</p>
                    <span className="text-[10px] font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded-full">
                      {timeBadge.label}
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-600 mt-1 truncate">
                    Tienda: <span className="font-semibold">{b.name}</span>
                  </p>
                  <p className="text-[11px] text-gray-500 mt-0.5 line-clamp-2">
                    Ref: {order.delivery?.references || 'Sin referencia registrada'}
                  </p>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Estado Vacío si no hay pedidos activos asignados */}
      {activeAssignedOrders.length === 0 && (
        <div className="absolute inset-x-4 top-24 max-w-sm mx-auto z-20 bg-white/95 backdrop-blur-md rounded-2xl shadow-xl border border-gray-100 p-6 text-center animate-fadeIn">
          <div className="w-14 h-14 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center mx-auto mb-3">
            <i className="bi bi-check-circle-fill text-2xl"></i>
          </div>
          <h3 className="text-base font-black text-gray-900 tracking-tight">Sin pedidos activos</h3>
          <p className="text-xs text-gray-500 mt-1">
            No tienes pedidos asignados pendientes de entrega en este momento.
          </p>
          <button
            onClick={onBackToOrders}
            className="mt-4 w-full py-2.5 bg-blue-600 text-white text-xs font-bold rounded-xl shadow-md shadow-blue-500/25 active:scale-95 transition-all"
          >
            Ir a la lista de pedidos
          </button>
        </div>
      )}

      {/* Tarjeta Detallada Inferior del Pedido Seleccionado */}
      {selectedOrderData && (
        <div className="absolute bottom-24 left-3 right-3 max-w-md mx-auto z-30 animate-[slideUp_0.25s_ease-out]">
          <div className="bg-white rounded-3xl shadow-2xl border border-gray-100 p-4 relative overflow-hidden">
            {/* Botón de cerrar tarjeta de selección */}
            <button
              onClick={() => setSelectedOrderId(null)}
              className="absolute top-3 right-3 w-7 h-7 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 flex items-center justify-center text-xs transition-colors"
              title="Cerrar detalle"
            >
              <i className="bi bi-x-lg"></i>
            </button>

            {(() => {
              const b = getOrderBusiness(selectedOrderData)
              const timeBadge = formatDeliveryTimeBadge(selectedOrderData)
              const statusBadge = getStatusBadge(selectedOrderData.status)
              const coords = extractOrderCoords(selectedOrderData)

              return (
                <div className="space-y-3">
                  {/* Fila 1: Badges y Tienda */}
                  <div className="flex items-center gap-2 pr-8">
                    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black border ${statusBadge.color}`}>
                      {statusBadge.label}
                    </span>
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[10px] font-black ${
                        timeBadge.isFuture
                          ? 'bg-purple-100 text-purple-800'
                          : 'bg-emerald-100 text-emerald-800'
                      }`}
                    >
                      {timeBadge.label}
                    </span>
                  </div>

                  {/* Fila 2: Cliente y Tienda */}
                  <div className="flex items-center gap-3">
                    {b.image ? (
                      <img
                        src={b.image}
                        alt={b.name}
                        className="w-12 h-12 rounded-2xl object-cover border border-gray-100 shadow-sm flex-shrink-0"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center font-black flex-shrink-0">
                        <i className="bi bi-shop text-xl"></i>
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-black text-gray-900 tracking-tight leading-tight truncate">
                        {selectedOrderData.customer?.name || 'Cliente sin nombre'}
                      </p>
                      <p className="text-xs text-gray-500 font-medium truncate mt-0.5">
                        {b.name} • <span className="font-bold text-gray-800">${selectedOrderData.total.toFixed(2)}</span>
                      </p>
                    </div>
                  </div>

                  {/* Fila 3: Referencias de entrega */}
                  <div className="bg-gray-50 p-2.5 rounded-xl border border-gray-100">
                    <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-0.5">
                      Dirección de entrega:
                    </p>
                    <p className="text-xs text-gray-800 line-clamp-2 leading-relaxed">
                      {selectedOrderData.delivery?.references || 'Sin referencia registrada'}
                    </p>
                  </div>

                  {/* Fila 4: Botones de Acción */}
                  <div className="grid grid-cols-3 gap-2 pt-1">
                    {/* Botón Navegar GPS */}
                    {coords ? (
                      <a
                        href={`https://www.google.com/maps/dir/?api=1&destination=${coords.lat},${coords.lng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex flex-col items-center justify-center py-2 px-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-md shadow-blue-500/25 transition-all active:scale-95 text-center"
                      >
                        <i className="bi bi-cursor-fill text-base leading-none mb-1"></i>
                        <span className="text-[10px] font-black leading-none">Navegar</span>
                      </a>
                    ) : (
                      <button
                        disabled
                        className="flex flex-col items-center justify-center py-2 px-2 bg-gray-200 text-gray-400 rounded-xl cursor-not-allowed text-center"
                      >
                        <i className="bi bi-cursor text-base leading-none mb-1"></i>
                        <span className="text-[10px] font-black leading-none">Sin GPS</span>
                      </button>
                    )}

                    {/* Botón WhatsApp */}
                    {selectedOrderData.customer?.phone ? (
                      <a
                        href={`https://wa.me/593${selectedOrderData.customer.phone.replace(/\D/g, '').replace(/^0/, '')}?text=${encodeURIComponent(
                          `Hola ${selectedOrderData.customer.name}, soy el repartidor de ${b.name}. Estoy gestionando la entrega de tu pedido.`
                        )}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex flex-col items-center justify-center py-2 px-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-md shadow-emerald-500/25 transition-all active:scale-95 text-center"
                      >
                        <i className="bi bi-whatsapp text-base leading-none mb-1"></i>
                        <span className="text-[10px] font-black leading-none">WhatsApp</span>
                      </a>
                    ) : (
                      <button
                        disabled
                        className="flex flex-col items-center justify-center py-2 px-2 bg-gray-200 text-gray-400 rounded-xl cursor-not-allowed text-center"
                      >
                        <i className="bi bi-telephone text-base leading-none mb-1"></i>
                        <span className="text-[10px] font-black leading-none">Sin Tel.</span>
                      </button>
                    )}

                    {/* Botón Ver Detalle */}
                    <button
                      onClick={() => onOpenOrderDetails(selectedOrderData)}
                      className="flex flex-col items-center justify-center py-2 px-2 bg-gray-900 hover:bg-black text-white rounded-xl shadow-md transition-all active:scale-95 text-center"
                    >
                      <i className="bi bi-receipt text-base leading-none mb-1"></i>
                      <span className="text-[10px] font-black leading-none">Detalles</span>
                    </button>
                  </div>
                </div>
              )
            })()}
          </div>
        </div>
      )}

      {/* Carrusel Horizontal Inferior de Pedidos */}
      {filteredOrdersWithCoords.length > 0 && (
        <div className="absolute bottom-3 left-0 right-0 z-20 px-3 pointer-events-none">
          <div className="flex gap-2.5 overflow-x-auto pb-1 pointer-events-auto snap-x no-scrollbar">
            {filteredOrdersWithCoords.map(({ order, coords }, idx) => {
              const isSelected = order.id === selectedOrderId
              const b = getOrderBusiness(order)
              const timeBadge = formatDeliveryTimeBadge(order)
              const pinIndex = idx + 1

              return (
                <div
                  key={order.id}
                  onClick={() => handleSelectOrder(order)}
                  className={`flex-shrink-0 w-64 p-3 rounded-2xl cursor-pointer transition-all snap-start shadow-lg border ${
                    isSelected
                      ? 'bg-blue-600 text-white border-blue-500 scale-[1.02] shadow-blue-500/30'
                      : 'bg-white/95 backdrop-blur-md text-gray-800 border-gray-100 hover:bg-white'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <span
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-black ${
                        isSelected ? 'bg-white text-blue-600' : 'bg-blue-600 text-white'
                      }`}
                    >
                      {pinIndex}
                    </span>
                    <p className="text-xs font-black truncate flex-1 tracking-tight">
                      {order.customer?.name || 'Cliente'}
                    </p>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        isSelected
                          ? 'bg-white/20 text-white'
                          : timeBadge.isFuture
                          ? 'bg-purple-100 text-purple-800'
                          : 'bg-emerald-100 text-emerald-800'
                      }`}
                    >
                      {timeBadge.label}
                    </span>
                  </div>
                  <p className={`text-[11px] truncate ${isSelected ? 'text-blue-100' : 'text-gray-500'}`}>
                    {b.name} • ${order.total.toFixed(2)}
                  </p>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Animaciones CSS */}
      <style jsx>{`
        @keyframes slideUp {
          from {
            transform: translateY(20px);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }
        .no-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .no-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </div>
  )
}
