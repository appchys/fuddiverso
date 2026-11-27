'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import Link from 'next/link'
import { Business } from '@/types'
import { loadGoogleMapsAPI, GoogleMap, useCurrentLocation } from '@/components/GoogleMap'
import { normalizeEcuadorianPhone } from '@/lib/validation'

export interface StoreCoordinates {
  lat: number
  lng: number
}

// Extrae coordenadas válidas de una tienda (pickupSettings.latlong o mapLocation)
export function extractBusinessCoords(business: Business): StoreCoordinates | null {
  // 1. Revisar pickupSettings.latlong primero (fuente principal en el editor de tiendas)
  const rawString = business.pickupSettings?.latlong
  if (rawString && typeof rawString === 'string') {
    const parsed = parseLatLongString(rawString)
    if (parsed) return parsed
  }

  // 2. Revisar mapLocation numérico si es válido y distinto de (0, 0)
  if (
    business.mapLocation &&
    typeof business.mapLocation.lat === 'number' &&
    typeof business.mapLocation.lng === 'number' &&
    !isNaN(business.mapLocation.lat) &&
    !isNaN(business.mapLocation.lng) &&
    Math.abs(business.mapLocation.lat) > 0.0001 &&
    Math.abs(business.mapLocation.lng) > 0.0001
  ) {
    return {
      lat: business.mapLocation.lat,
      lng: business.mapLocation.lng
    }
  }

  return null
}

// Parsea texto "lat, lng" o enlaces de Google Maps
export function parseLatLongString(raw: string): StoreCoordinates | null {
  if (!raw || typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null

  // Enlaces de Google Maps
  if (/google\.(com|es)\/maps|maps\.app\.goo\.gl|maps\.google/i.test(trimmed)) {
    const qMatch = trimmed.match(/[?&]q=(-?\d+\.?\d*),(-?\d+\.?\d*)/)
    if (qMatch) {
      const lat = parseFloat(qMatch[1])
      const lng = parseFloat(qMatch[2])
      if (isValidLatLng(lat, lng)) return { lat, lng }
    }
    const placeMatch = trimmed.match(/\/place\/(-?\d+\.?\d*),(-?\d+\.?\d*)/)
    if (placeMatch) {
      const lat = parseFloat(placeMatch[1])
      const lng = parseFloat(placeMatch[2])
      if (isValidLatLng(lat, lng)) return { lat, lng }
    }
    const atMatch = trimmed.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/)
    if (atMatch) {
      const lat = parseFloat(atMatch[1])
      const lng = parseFloat(atMatch[2])
      if (isValidLatLng(lat, lng)) return { lat, lng }
    }
  }

  // Formato "lat, lng"
  const clean = trimmed.replace(/[()[\]\s]/g, '')
  const parts = clean.split(',')
  if (parts.length === 2) {
    const lat = parseFloat(parts[0])
    const lng = parseFloat(parts[1])
    if (isValidLatLng(lat, lng)) {
      return { lat, lng }
    }
  }

  return null
}

function isValidLatLng(lat: number, lng: number): boolean {
  return (
    !isNaN(lat) &&
    !isNaN(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180 &&
    Math.abs(lat) > 0.0001 &&
    Math.abs(lng) > 0.0001
  )
}

interface AdminStoresMapProps {
  businesses: Business[]
  coverageGroups: { id: string; name: string }[]
  groupNameMap: Record<string, string>
  onSaveStoreLocation: (
    business: Business,
    coords: StoreCoordinates | null,
    references: string,
    groupId?: string
  ) => Promise<void>
}

export default function AdminStoresMap({
  businesses,
  coverageGroups,
  groupNameMap,
  onSaveStoreLocation
}: AdminStoresMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const [mapInstance, setMapInstance] = useState<any>(null)
  const [isMapReady, setIsMapReady] = useState(false)
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null)
  const [sideTab, setSideTab] = useState<'without_location' | 'with_location'>('without_location')
  const [noGpsSubFilter, setNoGpsSubFilter] = useState<'all' | 'without_group' | 'with_group'>('all')
  const [listSearch, setListSearch] = useState('')

  // Estado del modal para asignar / editar ubicación o grupo rápidamente
  const [editingStore, setEditingStore] = useState<Business | null>(null)
  const [editorMode, setEditorMode] = useState<'gps' | 'group_only'>('gps')
  const [selectedGroupId, setSelectedGroupId] = useState<string>('external')
  const [coordInput, setCoordInput] = useState('')
  const [referencesInput, setReferencesInput] = useState('')
  const [previewCoords, setPreviewCoords] = useState<StoreCoordinates>({ lat: -1.86287, lng: -79.97704 })
  const [savingLocation, setSavingLocation] = useState(false)
  const { location: gpsLocation, loading: locatingGps, getCurrentLocation } = useCurrentLocation()

  // Referencia de marcadores en Google Maps
  const markersRef = useRef<Record<string, any>>({})

  // Verifica si una tienda tiene un grupo de cobertura específico asignado
  const hasCoverageGroup = useCallback(
    (business: Business) =>
      Boolean(business.groupId && business.groupId !== 'external' && groupNameMap[business.groupId]),
    [groupNameMap]
  )

  // Separar tiendas con ubicación y sin ubicación
  const { storesWithLocation, storesWithoutLocation } = useMemo(() => {
    const withLoc: { business: Business; coords: StoreCoordinates }[] = []
    const withoutLoc: Business[] = []

    businesses.forEach(business => {
      const coords = extractBusinessCoords(business)
      if (coords) {
        withLoc.push({ business, coords })
      } else {
        withoutLoc.push(business)
      }
    })

    return { storesWithLocation: withLoc, storesWithoutLocation: withoutLoc }
  }, [businesses])

  // Contadores de subfiltro en tiendas sin coordenadas GPS
  const noGpsCounts = useMemo(() => {
    let withGroup = 0
    let withoutGroup = 0
    storesWithoutLocation.forEach(b => {
      if (hasCoverageGroup(b)) withGroup++
      else withoutGroup++
    })
    return { all: storesWithoutLocation.length, withGroup, withoutGroup }
  }, [storesWithoutLocation, hasCoverageGroup])

  // Filtrado interno de la lista lateral
  const filteredWithoutLocation = useMemo(() => {
    const q = listSearch.toLowerCase().trim()
    return storesWithoutLocation.filter(b => {
      const matchesQuery =
        !q ||
        b.name.toLowerCase().includes(q) ||
        (b.username && b.username.toLowerCase().includes(q)) ||
        (b.phone && b.phone.includes(q))

      const matchesGroupSubFilter =
        noGpsSubFilter === 'all' ||
        (noGpsSubFilter === 'with_group' && hasCoverageGroup(b)) ||
        (noGpsSubFilter === 'without_group' && !hasCoverageGroup(b))

      return matchesQuery && matchesGroupSubFilter
    })
  }, [storesWithoutLocation, listSearch, noGpsSubFilter, hasCoverageGroup])

  const filteredWithLocation = useMemo(() => {
    const q = listSearch.toLowerCase().trim()
    if (!q) return storesWithLocation
    return storesWithLocation.filter(
      ({ business: b }) =>
        b.name.toLowerCase().includes(q) ||
        (b.username && b.username.toLowerCase().includes(q)) ||
        (b.phone && b.phone.includes(q))
    )
  }, [storesWithLocation, listSearch])

  // Tienda seleccionada actualmente en el mapa
  const selectedStoreItem = useMemo(() => {
    if (!selectedStoreId) return null
    return storesWithLocation.find(item => item.business.id === selectedStoreId) || null
  }, [storesWithLocation, selectedStoreId])

  // Cargar Google Maps API
  useEffect(() => {
    let mounted = true
    loadGoogleMapsAPI()
      .then(() => {
        if (mounted) setIsMapReady(true)
      })
      .catch(err => {
        console.error('Error al cargar Google Maps:', err)
      })
    return () => {
      mounted = false
    }
  }, [])

  // Inicializar instancia del mapa
  useEffect(() => {
    if (!isMapReady || !mapContainerRef.current || !window.google || mapInstance) return

    const initialCenter =
      storesWithLocation.length > 0
        ? storesWithLocation[0].coords
        : { lat: -1.86287, lng: -79.97704 }

    const map = new window.google.maps.Map(mapContainerRef.current, {
      center: initialCenter,
      zoom: 13,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true,
      zoomControl: true,
      gestureHandling: 'greedy',
      styles: [
        {
          featureType: 'poi.business',
          stylers: [{ visibility: 'off' }]
        }
      ]
    })

    setMapInstance(map)
  }, [isMapReady, mapInstance, storesWithLocation])

  // Crear SVG personalizado para el pin de cada tienda
  const createStorePinSvg = useCallback((business: Business, isSelected: boolean) => {
    // Color según estado: Oculta (ámbar), Abierta (esmeralda), Cerrada (slate)
    let fillColor = '#10B981' // emerald-500 (Abierta)
    if (business.isHidden) {
      fillColor = '#F59E0B' // amber-500 (Oculta)
    } else if (!business.isOpen) {
      fillColor = '#64748B' // slate-500 (Cerrada)
    }

    const size = isSelected ? 50 : 40
    // Limpiar emojis, sustitutos UTF-16 y caracteres especiales XML antes de extraer iniciales
    const cleanName = (business.name || 'T')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9\s]/g, ' ')
      .trim()

    const initials =
      (cleanName || 'T')
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(w => Array.from(w)[0]?.toUpperCase() || '')
        .join('')
        .slice(0, 2) || 'T'

    const ringStroke = isSelected ? '#1D4ED8' : '#FFFFFF'
    const ringWidth = isSelected ? 3 : 2

    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 42 42">
        <defs>
          <filter id="dropShadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#0F172A" flood-opacity="0.35"/>
          </filter>
        </defs>
        <path d="M21 2C12.716 2 6 8.716 6 17c0 10.75 15 23 15 23s15-12.25 15-23c0-8.284-6.716-15-15-15z"
              fill="${fillColor}" stroke="${ringStroke}" stroke-width="${ringWidth}" filter="url(#dropShadow)"/>
        <circle cx="21" cy="16.5" r="9.5" fill="#FFFFFF"/>
        <text x="21" y="20" font-size="9.5" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
              font-weight="900" fill="#0F172A" text-anchor="middle">${initials}</text>
      </svg>
    `
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`
  }, [])

  //Ajustar el mapa para mostrar todos los marcadores
  const fitAllStores = useCallback(() => {
    if (!mapInstance || !window.google || storesWithLocation.length === 0) return

    const bounds = new window.google.maps.LatLngBounds()
    storesWithLocation.forEach(({ coords }) => {
      bounds.extend(coords)
    })

    mapInstance.fitBounds(bounds, { top: 60, right: 50, bottom: 60, left: 50 })

    if (storesWithLocation.length === 1) {
      setTimeout(() => {
        if (mapInstance.getZoom() > 16) {
          mapInstance.setZoom(16)
        }
      }, 150)
    }
  }, [mapInstance, storesWithLocation])

  // Ajustar bounds cuando se inicializa el mapa por primera vez
  const hasFittedInitialRef = useRef(false)
  useEffect(() => {
    if (mapInstance && storesWithLocation.length > 0 && !hasFittedInitialRef.current) {
      hasFittedInitialRef.current = true
      fitAllStores()
    }
  }, [mapInstance, storesWithLocation, fitAllStores])

  // Sincronizar marcadores en el mapa
  useEffect(() => {
    if (!mapInstance || !window.google) return

    const validIds = new Set(storesWithLocation.map(s => s.business.id))

    // Eliminar marcadores que ya no están en la lista filtrada
    Object.keys(markersRef.current).forEach(id => {
      if (!validIds.has(id)) {
        markersRef.current[id].setMap(null)
        delete markersRef.current[id]
      }
    })

    // Crear o actualizar marcadores
    storesWithLocation.forEach(({ business, coords }) => {
      const isSelected = business.id === selectedStoreId
      const iconUrl = createStorePinSvg(business, isSelected)
      const size = isSelected ? 50 : 40

      if (markersRef.current[business.id]) {
        const marker = markersRef.current[business.id]
        marker.setPosition(coords)
        marker.setTitle(business.name)
        marker.setIcon({
          url: iconUrl,
          scaledSize: new window.google.maps.Size(size, size),
          anchor: new window.google.maps.Point(size / 2, size)
        })
        marker.setZIndex(isSelected ? 100 : 10)
      } else {
        const marker = new window.google.maps.Marker({
          position: coords,
          map: mapInstance,
          title: business.name,
          zIndex: isSelected ? 100 : 10,
          icon: {
            url: iconUrl,
            scaledSize: new window.google.maps.Size(size, size),
            anchor: new window.google.maps.Point(size / 2, size)
          }
        })

        marker.addListener('click', () => {
          setSelectedStoreId(business.id)
          mapInstance.panTo(coords)
          if (mapInstance.getZoom() < 15) {
            mapInstance.setZoom(16)
          }
        })

        markersRef.current[business.id] = marker
      }
    })
  }, [mapInstance, storesWithLocation, selectedStoreId, createStorePinSvg])

  // Seleccionar una tienda desde la lista y centrar el mapa
  const handleFocusStoreOnMap = (businessId: string) => {
    const found = storesWithLocation.find(s => s.business.id === businessId)
    if (!found) return
    setSelectedStoreId(businessId)
    if (mapInstance) {
      mapInstance.panTo(found.coords)
      mapInstance.setZoom(16)
    }
  }

  // Abrir el modal para asignar o editar la ubicación o grupo de una tienda
  const handleOpenLocationEditor = (business: Business, initialMode: 'gps' | 'group_only' = 'gps') => {
    const existingCoords = extractBusinessCoords(business)
    const defaultCoords =
      existingCoords ||
      (storesWithLocation.length > 0
        ? storesWithLocation[0].coords
        : { lat: -1.86287, lng: -79.97704 })

    setEditingStore(business)
    setEditorMode(initialMode)
    setSelectedGroupId(business.groupId || 'external')
    setPreviewCoords(defaultCoords)
    setCoordInput(existingCoords ? `${existingCoords.lat}, ${existingCoords.lng}` : `${defaultCoords.lat}, ${defaultCoords.lng}`)
    setReferencesInput(business.pickupSettings?.references || '')
  }

  // Actualizar coordenadas cuando el usuario usa el botón de GPS actual en el modal
  useEffect(() => {
    if (gpsLocation && editingStore) {
      const formatted = `${gpsLocation.lat.toFixed(6)}, ${gpsLocation.lng.toFixed(6)}`
      setPreviewCoords({ lat: gpsLocation.lat, lng: gpsLocation.lng })
      setCoordInput(formatted)
    }
  }, [gpsLocation, editingStore])

  // Cambio manual en el input de coordenadas o link de Google Maps
  const handleCoordInputChange = (value: string) => {
    setCoordInput(value)
    const parsed = parseLatLongString(value)
    if (parsed) {
      setPreviewCoords(parsed)
    }
  }

  // Guardar ubicación o solo grupo desde el modal rápido
  const handleConfirmSaveLocation = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingStore) return

    if (editorMode === 'group_only') {
      setSavingLocation(true)
      try {
        await onSaveStoreLocation(editingStore, null, '', selectedGroupId)
        setEditingStore(null)
      } catch (error) {
        console.error('Error al guardar grupo de cobertura:', error)
      } finally {
        setSavingLocation(false)
      }
      return
    }

    const parsed = parseLatLongString(coordInput) || previewCoords
    if (!parsed || !isValidLatLng(parsed.lat, parsed.lng)) {
      alert('Por favor ingresa o selecciona coordenadas válidas en el mapa.')
      return
    }

    setSavingLocation(true)
    try {
      await onSaveStoreLocation(editingStore, parsed, referencesInput.trim(), selectedGroupId)
      const savedId = editingStore.id
      setEditingStore(null)
      setSelectedStoreId(savedId)
      if (mapInstance) {
        mapInstance.panTo(parsed)
        mapInstance.setZoom(16)
      }
    } catch (error) {
      console.error('Error al guardar ubicación:', error)
    } finally {
      setSavingLocation(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Barra de Resumen de Ubicaciones */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white p-3.5 sm:p-4 rounded-3xl border border-gray-200/80 shadow-xs flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center text-lg shrink-0">
              <i className="bi bi-geo-alt-fill"></i>
            </div>
            <div>
              <p className="text-[10px] sm:text-xs font-bold text-gray-400 uppercase tracking-wider">
                En el Mapa (Con GPS)
              </p>
              <p className="text-lg sm:text-2xl font-black text-gray-900 leading-tight">
                {storesWithLocation.length}
                <span className="text-xs font-medium text-gray-400 ml-1.5">
                  de {businesses.length}
                </span>
              </p>
            </div>
          </div>
          {storesWithLocation.length > 0 && (
            <button
              type="button"
              onClick={fitAllStores}
              className="px-3 py-1.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold transition-all active:scale-95 flex items-center gap-1.5"
              title="Encuadrar todas las tiendas en el mapa"
            >
              <i className="bi bi-arrows-fullscreen text-xs"></i>
              <span>Ver todas</span>
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => setSideTab('without_location')}
          className={`p-3.5 sm:p-4 rounded-3xl border text-left transition-all active:scale-[0.99] flex items-center justify-between ${
            sideTab === 'without_location'
              ? 'bg-amber-50/80 border-amber-300 ring-2 ring-amber-400/20'
              : 'bg-white border-gray-200/80 shadow-xs hover:border-amber-200'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-100/80 text-amber-600 flex items-center justify-center text-lg shrink-0">
              <i className="bi bi-exclamation-triangle-fill"></i>
            </div>
            <div>
              <p className="text-[10px] sm:text-xs font-bold text-amber-700 uppercase tracking-wider">
                Sin Ubicación GPS
              </p>
              <p className="text-lg sm:text-2xl font-black text-amber-900 leading-tight">
                {storesWithoutLocation.length}
              </p>
            </div>
          </div>
          <span className="text-[11px] font-bold text-amber-700 bg-amber-100 px-2.5 py-1 rounded-xl">
            Ver lista
          </span>
        </button>

        {/* Leyenda de Pines */}
        <div className="bg-white p-3.5 sm:p-4 rounded-3xl border border-gray-200/80 shadow-xs flex flex-col justify-center gap-2">
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
            Leyenda del Mapa
          </span>
          <div className="flex flex-wrap items-center gap-3 text-xs font-bold text-gray-700">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-emerald-500 inline-block shadow-2xs"></span>
              Abierta
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-slate-500 inline-block shadow-2xs"></span>
              Cerrada
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-amber-500 inline-block shadow-2xs"></span>
              Oculta
            </span>
          </div>
        </div>
      </div>

      {/* Contenedor Principal: Mapa + Panel Lateral de Tiendas Sin/Con Ubicación */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* Columna Mapa (7 u 8 columnas en Desktop) */}
        <div className="lg:col-span-7 xl:col-span-8 bg-white rounded-3xl border border-gray-200/80 shadow-xs overflow-hidden relative h-[460px] sm:h-[580px] flex flex-col">
          {/* Barra flotante superior en el mapa */}
          <div className="absolute top-3 left-3 right-14 z-10 flex items-center justify-between pointer-events-none">
            <div className="bg-white/95 backdrop-blur-md px-3.5 py-2 rounded-2xl shadow-md border border-gray-200/70 flex items-center gap-2 pointer-events-auto">
              <i className="bi bi-map-fill text-blue-600 text-sm"></i>
              <span className="text-xs font-black text-gray-900 tracking-tight">
                Mapa de Tiendas ({storesWithLocation.length})
              </span>
            </div>

            {storesWithLocation.length > 0 && (
              <button
                type="button"
                onClick={fitAllStores}
                className="pointer-events-auto px-3 py-2 bg-white/95 backdrop-blur-md hover:bg-white text-gray-700 hover:text-blue-600 rounded-2xl shadow-md border border-gray-200/70 text-xs font-bold flex items-center gap-1.5 transition-all active:scale-95"
                title="Ajustar zoom a todas las tiendas"
              >
                <i className="bi bi-arrows-fullscreen text-xs"></i>
                <span className="hidden sm:inline">Encuadrar todo</span>
              </button>
            )}
          </div>

          {/* Lienzo de Google Maps */}
          {!isMapReady ? (
            <div className="w-full h-full flex flex-col items-center justify-center bg-gray-50 text-gray-400 gap-2">
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-600 border-t-transparent" />
              <span className="text-xs font-bold text-gray-500">Cargando mapa de tiendas...</span>
            </div>
          ) : (
            <div ref={mapContainerRef} className="w-full h-full flex-1" />
          )}

          {/* Estado vacío si ninguna tienda filtrada tiene coordenadas */}
          {isMapReady && storesWithLocation.length === 0 && (
            <div className="absolute inset-x-4 top-20 max-w-sm mx-auto z-10 bg-white/95 backdrop-blur-md rounded-3xl shadow-xl border border-gray-200/80 p-5 text-center space-y-2">
              <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto text-xl">
                <i className="bi bi-geo-alt"></i>
              </div>
              <h4 className="text-sm font-black text-gray-900 tracking-tight leading-tight">
                Ninguna tienda tiene ubicación GPS
              </h4>
              <p className="text-xs font-medium text-gray-500 leading-relaxed">
                Selecciona una tienda de la lista de tiendas sin ubicación para asignarle sus coordenadas en el mapa.
              </p>
            </div>
          )}

          {/* Tarjeta flotante inferior cuando se selecciona una tienda en el mapa */}
          {selectedStoreItem && (
            <div className="absolute bottom-3 left-3 right-3 sm:left-4 sm:right-4 max-w-lg mx-auto z-20 animate-in fade-in slide-in-from-bottom-2 duration-200">
              <div className="bg-white/98 backdrop-blur-md rounded-3xl shadow-2xl border border-gray-200/90 p-4 relative">
                <button
                  type="button"
                  onClick={() => setSelectedStoreId(null)}
                  className="absolute top-3 right-3 w-7 h-7 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 flex items-center justify-center text-xs transition-colors"
                  title="Cerrar detalle"
                >
                  <i className="bi bi-x-lg"></i>
                </button>

                <div className="flex items-start gap-3 pr-7">
                  <div className="relative w-12 h-12 rounded-2xl overflow-hidden bg-gray-100 border border-gray-200/70 shrink-0 aspect-square">
                    {selectedStoreItem.business.image ? (
                      <img
                        src={selectedStoreItem.business.image}
                        alt={selectedStoreItem.business.name}
                        className="w-full h-full object-cover aspect-square"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-400 text-lg">
                        <i className="bi bi-shop"></i>
                      </div>
                    )}
                    <span
                      className={`absolute bottom-0.5 right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white ${
                        selectedStoreItem.business.isOpen ? 'bg-emerald-500' : 'bg-gray-400'
                      }`}
                    />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <h4 className="text-sm sm:text-base font-black text-gray-900 tracking-tight leading-tight truncate">
                        {selectedStoreItem.business.name}
                      </h4>
                      <span
                        className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${
                          selectedStoreItem.business.isOpen
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200/80'
                            : 'bg-slate-100 text-slate-600 border-slate-200/80'
                        }`}
                      >
                        {selectedStoreItem.business.isOpen ? 'Abierta' : 'Cerrada'}
                      </span>
                      {selectedStoreItem.business.isHidden && (
                        <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200/80">
                          Oculta
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-500 font-medium">
                      {selectedStoreItem.business.username && (
                        <span className="text-blue-600 font-bold">@{selectedStoreItem.business.username}</span>
                      )}
                      <span>•</span>
                      <span className="text-[11px] uppercase font-bold text-gray-400">
                        {groupNameMap[selectedStoreItem.business.groupId || 'external'] || 'Ecuador'}
                      </span>
                    </div>

                    {selectedStoreItem.business.pickupSettings?.references && (
                      <p className="text-xs font-medium text-gray-600 leading-relaxed mt-1.5 line-clamp-2">
                        <i className="bi bi-geo-alt text-gray-400 mr-1"></i>
                        {selectedStoreItem.business.pickupSettings.references}
                      </p>
                    )}

                    <p className="text-[11px] font-mono text-gray-400 mt-1">
                      {selectedStoreItem.coords.lat.toFixed(5)}, {selectedStoreItem.coords.lng.toFixed(5)}
                    </p>
                  </div>
                </div>

                {/* Acciones rápidas en la tarjeta de la tienda seleccionada */}
                <div className="grid grid-cols-3 gap-2 mt-3 pt-2.5 border-t border-gray-100">
                  <button
                    type="button"
                    onClick={() => handleOpenLocationEditor(selectedStoreItem.business)}
                    className="flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-bold transition-all active:scale-95"
                  >
                    <i className="bi bi-geo-alt-fill text-xs"></i>
                    <span>Mover Pin</span>
                  </button>

                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${selectedStoreItem.coords.lat},${selectedStoreItem.coords.lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold transition-all active:scale-95"
                  >
                    <i className="bi bi-box-arrow-up-right text-xs"></i>
                    <span>Google Maps</span>
                  </a>

                  <Link
                    href={`/admin/stores/${selectedStoreItem.business.id}`}
                    className="flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl bg-gray-900 hover:bg-gray-800 text-white text-xs font-bold transition-all active:scale-95"
                  >
                    <i className="bi bi-gear-fill text-xs"></i>
                    <span>Configurar</span>
                  </Link>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Columna Lateral: Lista de Tiendas Sin Ubicación / Con Ubicación (5 o 4 columnas en Desktop) */}
        <div className="lg:col-span-5 xl:col-span-4 bg-white rounded-3xl border border-gray-200/80 shadow-xs overflow-hidden flex flex-col h-[500px] sm:h-[580px]">
          {/* Pestañas del panel lateral */}
          <div className="p-3 border-b border-gray-100 bg-gray-50/60 space-y-2.5">
            <div className="grid grid-cols-2 gap-1.5 bg-gray-200/70 p-1 rounded-2xl">
              <button
                type="button"
                onClick={() => setSideTab('without_location')}
                className={`py-2 px-2.5 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-1.5 ${
                  sideTab === 'without_location'
                    ? 'bg-white text-amber-800 shadow-xs'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <i className="bi bi-exclamation-circle-fill text-amber-500"></i>
                <span>Sin Ubicación</span>
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                    sideTab === 'without_location'
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-gray-300/70 text-gray-700'
                  }`}
                >
                  {storesWithoutLocation.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setSideTab('with_location')}
                className={`py-2 px-2.5 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-1.5 ${
                  sideTab === 'with_location'
                    ? 'bg-white text-emerald-800 shadow-xs'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <i className="bi bi-geo-alt-fill text-emerald-500"></i>
                <span>Ubicadas</span>
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                    sideTab === 'with_location'
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-gray-300/70 text-gray-700'
                  }`}
                >
                  {storesWithLocation.length}
                </span>
              </button>
            </div>

            {/* Buscador rápido dentro de la lista lateral */}
            <div className="relative">
              <i className="bi bi-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs"></i>
              <input
                type="text"
                value={listSearch}
                onChange={e => setListSearch(e.target.value)}
                placeholder={
                  sideTab === 'without_location'
                    ? 'Filtrar tiendas sin ubicación...'
                    : 'Filtrar tiendas con ubicación...'
                }
                className="w-full bg-white border border-gray-200/80 rounded-xl pl-8 pr-7 py-1.5 text-xs font-medium text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500"
              />
              {listSearch && (
                <button
                  type="button"
                  onClick={() => setListSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs"
                >
                  <i className="bi bi-x-circle-fill"></i>
                </button>
              )}
            </div>

            {/* Subfiltro para tiendas sin GPS: Todas / Sin Grupo / Solo Grupo */}
            {sideTab === 'without_location' && storesWithoutLocation.length > 0 && (
              <div className="flex items-center gap-1 pt-0.5">
                <button
                  type="button"
                  onClick={() => setNoGpsSubFilter('all')}
                  className={`flex-1 py-1 px-2 rounded-lg text-[10px] font-bold transition-all ${
                    noGpsSubFilter === 'all'
                      ? 'bg-gray-900 text-white'
                      : 'bg-white text-gray-600 border border-gray-200/70 hover:bg-gray-100'
                  }`}
                >
                  Todas ({noGpsCounts.all})
                </button>
                <button
                  type="button"
                  onClick={() => setNoGpsSubFilter('without_group')}
                  className={`flex-1 py-1 px-2 rounded-lg text-[10px] font-bold transition-all ${
                    noGpsSubFilter === 'without_group'
                      ? 'bg-amber-600 text-white'
                      : 'bg-white text-amber-700 border border-amber-200/70 hover:bg-amber-50'
                  }`}
                >
                  Sin Grupo ({noGpsCounts.withoutGroup})
                </button>
                <button
                  type="button"
                  onClick={() => setNoGpsSubFilter('with_group')}
                  className={`flex-1 py-1 px-2 rounded-lg text-[10px] font-bold transition-all ${
                    noGpsSubFilter === 'with_group'
                      ? 'bg-blue-600 text-white'
                      : 'bg-white text-blue-700 border border-blue-200/70 hover:bg-blue-50'
                  }`}
                >
                  Con Grupo ({noGpsCounts.withGroup})
                </button>
              </div>
            )}
          </div>

          {/* Contenido de la Lista */}
          <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
            {sideTab === 'without_location' ? (
              filteredWithoutLocation.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center p-6 text-center space-y-2">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center text-xl">
                    <i className="bi bi-check2-circle"></i>
                  </div>
                  <p className="text-sm font-black text-gray-900 tracking-tight leading-tight">
                    {storesWithoutLocation.length === 0
                      ? '¡Todas las tiendas tienen ubicación!'
                      : 'Sin resultados para este filtro'}
                  </p>
                  <p className="text-xs font-medium text-gray-500 leading-relaxed max-w-xs">
                    {storesWithoutLocation.length === 0
                      ? 'Todas las tiendas filtradas cuentan con coordenadas GPS registradas.'
                      : 'Prueba cambiando el subfiltro o el término en el buscador.'}
                  </p>
                </div>
              ) : (
                filteredWithoutLocation.map(business => {
                  const hasGroup = hasCoverageGroup(business)
                  const cityName = hasGroup
                    ? groupNameMap[business.groupId!]
                    : 'Sin grupo asignado'
                  const phoneDigits = business.phone ? normalizeEcuadorianPhone(business.phone) : ''

                  return (
                    <div
                      key={business.id}
                      className="p-3.5 hover:bg-amber-50/30 transition-colors flex flex-col gap-2.5"
                    >
                      <div className="flex items-start gap-3">
                        <div className="relative w-10 h-10 rounded-xl overflow-hidden bg-gray-100 border border-gray-200/70 shrink-0 aspect-square">
                          {business.image ? (
                            <img
                              src={business.image}
                              alt={business.name}
                              className="w-full h-full object-cover aspect-square"
                              loading="lazy"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">
                              <i className="bi bi-shop"></i>
                            </div>
                          )}
                          <span
                            className={`absolute bottom-0.5 right-0.5 w-2 h-2 rounded-full border border-white ${
                              business.isOpen ? 'bg-emerald-500' : 'bg-gray-400'
                            }`}
                          />
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <Link
                              href={`/admin/stores/${business.id}`}
                              className="text-sm font-black text-gray-900 tracking-tight leading-tight hover:text-blue-600 transition-colors truncate"
                            >
                              {business.name}
                            </Link>
                            {business.isHidden && (
                              <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200/80 shrink-0">
                                Oculta
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                            {business.username && (
                              <span className="text-[11px] font-bold text-blue-600 truncate">
                                @{business.username}
                              </span>
                            )}
                            <span
                              onClick={() => handleOpenLocationEditor(business, 'group_only')}
                              className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md cursor-pointer transition-colors ${
                                hasGroup
                                  ? 'bg-blue-50 text-blue-700 border border-blue-200/70 hover:bg-blue-100'
                                  : 'bg-gray-100 text-gray-500 border border-gray-200/70 hover:bg-gray-200'
                              }`}
                              title="Clic para elegir el grupo de cobertura"
                            >
                              <i className="bi bi-tags-fill text-[9px]"></i>
                              <span>{cityName}</span>
                            </span>
                          </div>

                          {business.pickupSettings?.references && (
                            <p className="text-[11px] font-medium text-gray-500 leading-relaxed mt-1 line-clamp-1">
                              Ref: {business.pickupSettings.references}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2 pt-0.5">
                        <div className="flex items-center gap-1.5">
                          {business.phone ? (
                            <a
                              href={`https://wa.me/593${phoneDigits.startsWith('0') ? phoneDigits.slice(1) : phoneDigits}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-2 py-1 rounded-lg transition-colors"
                              title="Contactar por WhatsApp"
                            >
                              <i className="bi bi-whatsapp"></i>
                              <span>{business.phone}</span>
                            </a>
                          ) : (
                            <span className="text-[11px] text-gray-400 font-medium">Sin teléfono</span>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5">
                          <Link
                            href={`/admin/stores/${business.id}`}
                            className="px-2.5 py-1.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-[11px] font-bold transition-all active:scale-95"
                            title="Abrir configuración completa de la tienda"
                          >
                            <i className="bi bi-gear-fill"></i>
                          </Link>
                          <button
                            type="button"
                            onClick={() => handleOpenLocationEditor(business, 'gps')}
                            className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-[11px] font-bold shadow-2xs transition-all active:scale-95 flex items-center gap-1"
                          >
                            <i className="bi bi-geo-alt-fill text-[10px]"></i>
                            <span>Asignar ubicación</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })
              )
            ) : filteredWithLocation.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center p-6 text-center space-y-2">
                <div className="w-12 h-12 rounded-2xl bg-gray-100 text-gray-400 flex items-center justify-center text-xl">
                  <i className="bi bi-geo-alt"></i>
                </div>
                <p className="text-sm font-black text-gray-900 tracking-tight leading-tight">
                  No hay tiendas ubicadas con este filtro
                </p>
                <p className="text-xs font-medium text-gray-500 leading-relaxed">
                  Prueba cambiando los filtros o asigna ubicación a las tiendas pendientes.
                </p>
              </div>
            ) : (
              filteredWithLocation.map(({ business, coords }) => {
                const isSelected = business.id === selectedStoreId
                const cityName = groupNameMap[business.groupId || 'external'] || 'Ecuador'

                return (
                  <div
                    key={business.id}
                    onClick={() => handleFocusStoreOnMap(business.id)}
                    className={`p-3.5 cursor-pointer transition-colors flex items-center justify-between gap-3 ${
                      isSelected ? 'bg-blue-50/70' : 'hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="relative w-10 h-10 rounded-xl overflow-hidden bg-gray-100 border border-gray-200/70 shrink-0 aspect-square">
                        {business.image ? (
                          <img
                            src={business.image}
                            alt={business.name}
                            className="w-full h-full object-cover aspect-square"
                            loading="lazy"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">
                            <i className="bi bi-shop"></i>
                          </div>
                        )}
                        <span
                          className={`absolute bottom-0.5 right-0.5 w-2 h-2 rounded-full border border-white ${
                            business.isOpen ? 'bg-emerald-500' : 'bg-gray-400'
                          }`}
                        />
                      </div>

                      <div className="min-w-0">
                        <p className="text-sm font-black text-gray-900 tracking-tight leading-tight truncate">
                          {business.name}
                        </p>
                        <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-gray-500 font-medium">
                          <span className="uppercase font-bold text-[10px] text-gray-400">{cityName}</span>
                          <span>•</span>
                          <span className="font-mono text-[10px] text-gray-400">
                            {coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation()
                          handleOpenLocationEditor(business)
                        }}
                        className="w-8 h-8 rounded-xl bg-gray-100 hover:bg-blue-100 text-gray-600 hover:text-blue-700 flex items-center justify-center text-xs transition-colors"
                        title="Editar ubicación"
                      >
                        <i className="bi bi-pencil-fill text-[11px]"></i>
                      </button>
                      <span className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center text-xs">
                        <i className="bi bi-crosshair"></i>
                      </span>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>

      {/* Modal para Asignar o Editar Ubicación / Grupo de Cobertura de una Tienda */}
      {editingStore && (
        <div className="fixed inset-0 z-[85] flex items-end sm:items-center justify-center">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200"
            onClick={() => !savingLocation && setEditingStore(null)}
          />
          <div className="relative bg-white w-full sm:max-w-xl rounded-t-3xl sm:rounded-3xl p-5 sm:p-6 shadow-2xl max-h-[92vh] overflow-y-auto z-10 animate-in slide-in-from-bottom duration-200">
            <div className="w-12 h-1.5 bg-gray-300 rounded-full mx-auto mb-3 sm:hidden" />

            <div className="flex items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center text-lg shrink-0">
                  <i className={`bi ${editorMode === 'group_only' ? 'bi-tags-fill' : 'bi-geo-alt-fill'}`}></i>
                </div>
                <div className="min-w-0">
                  <h3 className="text-base sm:text-lg font-black text-gray-900 tracking-tight leading-tight truncate">
                    Ubicación de {editingStore.name}
                  </h3>
                  <p className="text-xs font-medium text-gray-500">
                    {editorMode === 'group_only'
                      ? 'Elige únicamente el grupo de cobertura (sin coordenadas ni referencias)'
                      : 'Ubica el pin en el mapa o elige solo su grupo de cobertura'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={savingLocation}
                onClick={() => setEditingStore(null)}
                className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 flex items-center justify-center text-xs shrink-0"
              >
                <i className="bi bi-x-lg"></i>
              </button>
            </div>

            {/* Selector de Modo: Coordenadas GPS vs Solo Grupo de Cobertura */}
            <div className="grid grid-cols-2 gap-1.5 bg-gray-100 p-1 rounded-2xl mb-4">
              <button
                type="button"
                onClick={() => setEditorMode('gps')}
                className={`py-2.5 px-3 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-1.5 ${
                  editorMode === 'gps'
                    ? 'bg-white text-blue-700 shadow-xs'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <i className="bi bi-geo-alt-fill text-xs"></i>
                <span>Mapa y Coordenadas</span>
              </button>

              <button
                type="button"
                onClick={() => setEditorMode('group_only')}
                className={`py-2.5 px-3 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-1.5 ${
                  editorMode === 'group_only'
                    ? 'bg-white text-blue-700 shadow-xs'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <i className="bi bi-tags-fill text-xs"></i>
                <span>Solo Grupo de Cobertura</span>
              </button>
            </div>

            <form onSubmit={handleConfirmSaveLocation} className="space-y-4">
              {editorMode === 'group_only' ? (
                /* Modo: Solo elegir Grupo de Cobertura (sin referencias ni coordenadas) */
                <div className="space-y-3">
                  <label className="block text-[11px] font-bold text-gray-700 uppercase tracking-wider">
                    Selecciona el Grupo de Cobertura al que pertenece
                  </label>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {coverageGroups.map(group => {
                      const isSelected = selectedGroupId === group.id
                      return (
                        <button
                          key={group.id}
                          type="button"
                          onClick={() => setSelectedGroupId(group.id)}
                          className={`p-3.5 rounded-2xl border-2 text-left transition-all active:scale-[0.98] flex items-center justify-between gap-2 ${
                            isSelected
                              ? 'border-blue-600 bg-blue-50/70 text-blue-900 shadow-2xs'
                              : 'border-gray-200/80 bg-gray-50/60 hover:bg-gray-100 text-gray-800'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div
                              className={`w-8 h-8 rounded-xl flex items-center justify-center text-sm shrink-0 ${
                                isSelected ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 border border-gray-200'
                              }`}
                            >
                              <i className="bi bi-tags-fill"></i>
                            </div>
                            <span className="text-xs sm:text-sm font-black tracking-tight truncate">
                              {group.name}
                            </span>
                          </div>
                          {isSelected && <i className="bi bi-check-circle-fill text-blue-600 text-base shrink-0"></i>}
                        </button>
                      )
                    })}

                    <button
                      type="button"
                      onClick={() => setSelectedGroupId('external')}
                      className={`p-3.5 rounded-2xl border-2 text-left transition-all active:scale-[0.98] flex items-center justify-between gap-2 ${
                        selectedGroupId === 'external'
                          ? 'border-slate-700 bg-slate-100 text-slate-900 shadow-2xs'
                          : 'border-gray-200/80 bg-gray-50/60 hover:bg-gray-100 text-gray-600'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div
                          className={`w-8 h-8 rounded-xl flex items-center justify-center text-sm shrink-0 ${
                            selectedGroupId === 'external'
                              ? 'bg-slate-700 text-white'
                              : 'bg-white text-gray-400 border border-gray-200'
                          }`}
                        >
                          <i className="bi bi-globe-americas"></i>
                        </div>
                        <span className="text-xs sm:text-sm font-bold tracking-tight truncate">
                          Otras Ubicaciones
                        </span>
                      </div>
                      {selectedGroupId === 'external' && (
                        <i className="bi bi-check-circle-fill text-slate-700 text-base shrink-0"></i>
                      )}
                    </button>
                  </div>

                  <p className="text-[11px] text-gray-500 font-medium leading-relaxed bg-gray-50 p-3 rounded-2xl border border-gray-200/60">
                    <i className="bi bi-info-circle text-blue-600 mr-1.5"></i>
                    Se guardará únicamente el grupo de cobertura de la tienda, sin requerir coordenadas GPS ni referencias de dirección.
                  </p>
                </div>
              ) : (
                /* Modo: Mapa, Coordenadas, Referencias y Grupo */
                <>
                  {coverageGroups.length > 0 && (
                    <div>
                      <label className="block text-[11px] font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                        Grupo de Cobertura / Ciudad
                      </label>
                      <select
                        value={selectedGroupId}
                        onChange={e => setSelectedGroupId(e.target.value)}
                        className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-2xl text-xs sm:text-sm font-bold text-gray-900 focus:bg-white focus:outline-none focus:border-blue-500"
                      >
                        {coverageGroups.map(group => (
                          <option key={group.id} value={group.id}>
                            {group.name}
                          </option>
                        ))}
                        <option value="external">Otras Ubicaciones</option>
                      </select>
                    </div>
                  )}

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-[11px] font-bold text-gray-700 uppercase tracking-wider">
                        Coordenadas (Latitud, Longitud) o Link de Maps
                      </label>
                      <button
                        type="button"
                        onClick={() => getCurrentLocation()}
                        disabled={locatingGps}
                        className="text-xs font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1 disabled:opacity-50"
                      >
                        <i className={`bi ${locatingGps ? 'bi-arrow-repeat animate-spin' : 'bi-crosshair'}`} />
                        <span>{locatingGps ? 'Obteniendo GPS...' : 'Usar mi GPS actual'}</span>
                      </button>
                    </div>
                    <input
                      type="text"
                      required
                      value={coordInput}
                      onChange={e => handleCoordInputChange(e.target.value)}
                      placeholder="Ej: -1.862870, -79.977040"
                      className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-2xl text-xs sm:text-sm font-mono text-gray-900 focus:bg-white focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  {/* Mapa interactivo con pin central fijo */}
                  <div className="rounded-2xl overflow-hidden border border-gray-200 h-56 sm:h-64 relative bg-gray-100">
                    <GoogleMap
                      latitude={previewCoords.lat}
                      longitude={previewCoords.lng}
                      height="100%"
                      zoom={16}
                      draggable={true}
                      fixedCenterMarker={true}
                      onLocationChange={(lat, lng) => {
                        const roundedLat = Number(lat.toFixed(6))
                        const roundedLng = Number(lng.toFixed(6))
                        setPreviewCoords({ lat: roundedLat, lng: roundedLng })
                        setCoordInput(`${roundedLat}, ${roundedLng}`)
                      }}
                    />
                  </div>
                  <p className="text-[11px] text-gray-400 font-medium text-center -mt-2">
                    Mueve el mapa para situar el marcador rojo exactamente sobre la tienda.
                  </p>

                  <div>
                    <label className="block text-[11px] font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                      Dirección / Referencias del Local (Opcional)
                    </label>
                    <input
                      type="text"
                      value={referencesInput}
                      onChange={e => setReferencesInput(e.target.value)}
                      placeholder="Ej: Av. Principal frente al parque central, local esquinero..."
                      className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-2xl text-xs sm:text-sm font-medium text-gray-900 focus:bg-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </>
              )}

              <div className="flex items-center gap-2.5 pt-2">
                <button
                  type="button"
                  disabled={savingLocation}
                  onClick={() => setEditingStore(null)}
                  className="flex-1 py-3 rounded-2xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold transition-all active:scale-95"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingLocation}
                  className="flex-1 py-3 rounded-2xl bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white text-xs font-bold shadow-md shadow-blue-600/25 transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {savingLocation ? (
                    <>
                      <div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-white border-t-transparent" />
                      <span>Guardando...</span>
                    </>
                  ) : (
                    <>
                      <i className="bi bi-check-lg text-sm"></i>
                      <span>
                        {editorMode === 'group_only' ? 'Guardar Grupo de Cobertura' : 'Guardar Ubicación'}
                      </span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
