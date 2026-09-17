'use client'

import { useState, useEffect, useRef } from 'react'

export const GOOGLE_MAPS_API_KEY = 'AIzaSyAgOiLYPpzxlUHkX3lCmp5KK4UF7wx7zMs'

interface GoogleMapProps {
  latitude: number
  longitude: number
  height?: string
  width?: string
  zoom?: number
  marker?: boolean
  draggable?: boolean
  fixedCenterMarker?: boolean
  onLocationChange?: (lat: number, lng: number) => void
}

declare global {
  interface Window {
    google: any
    initMap: () => void
    googleMapsLoading?: boolean
    googleMapsLoaded?: boolean
  }
}

// Global state para controlar la carga de Google Maps
let isGoogleMapsLoading = false
let isGoogleMapsLoaded = false
const loadingCallbacks: (() => void)[] = []

// Función para cargar Google Maps API una sola vez
const loadGoogleMapsAPI = (): Promise<void> => {
  return new Promise((resolve) => {
    // Si ya está cargado, resolver inmediatamente
    if (window.google && window.google.maps) {
      isGoogleMapsLoaded = true
      resolve()
      return
    }

    // Si ya se está cargando, agregar callback y esperar
    if (isGoogleMapsLoading) {
      loadingCallbacks.push(resolve)
      return
    }

    // Marcar como cargando
    isGoogleMapsLoading = true

    // Verificar si el script ya existe
    const existingScript = document.querySelector(`script[src*="maps.googleapis.com"]`)
    if (existingScript) {
      // Si el script ya existe, esperar a que cargue
      const checkLoaded = () => {
        if (window.google && window.google.maps) {
          isGoogleMapsLoaded = true
          isGoogleMapsLoading = false
          resolve()
          loadingCallbacks.forEach(callback => callback())
          loadingCallbacks.length = 0
        } else {
          setTimeout(checkLoaded, 100)
        }
      }
      checkLoaded()
      return
    }

    // Crear nuevo script
    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=places`
    script.async = true
    script.defer = true

    script.onload = () => {
      isGoogleMapsLoaded = true
      isGoogleMapsLoading = false
      resolve()
      loadingCallbacks.forEach(callback => callback())
      loadingCallbacks.length = 0
    }

    script.onerror = () => {
      isGoogleMapsLoading = false
      console.error('Error loading Google Maps API')
      resolve() // Resolver de todas formas para evitar bloqueos
    }

    document.head.appendChild(script)
  })
}

export function GoogleMap({
  latitude,
  longitude,
  height = '200px',
  width = '100%',
  zoom = 15,
  marker = true,
  draggable = false,
  fixedCenterMarker = false,
  onLocationChange
}: GoogleMapProps) {
  const mapRef = useRef<HTMLDivElement>(null)
  const [map, setMap] = useState<any>(null)
  const [markerInstance, setMarkerInstance] = useState<any>(null)
  const [isLoaded, setIsLoaded] = useState(false)

  // Cargar Google Maps API una sola vez
  useEffect(() => {
    loadGoogleMapsAPI().then(() => {
      setIsLoaded(true)
    })
  }, [])

  const onLocationChangeRef = useRef(onLocationChange)
  useEffect(() => {
    onLocationChangeRef.current = onLocationChange
  }, [onLocationChange])

  // Inicializar mapa (solo una vez cuando isLoaded es true)
  useEffect(() => {
    if (!isLoaded || !mapRef.current || !window.google || map) return

    const mapInstance = new window.google.maps.Map(mapRef.current, {
      center: { lat: latitude, lng: longitude },
      zoom: zoom,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      gestureHandling: 'auto',
    })

    setMap(mapInstance)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded])

  // Gestionar el marcador nativo de Google Maps reactivamente
  useEffect(() => {
    if (!map || !window.google) return

    if (marker && !fixedCenterMarker) {
      let currentMarker = markerInstance
      if (!currentMarker) {
        currentMarker = new window.google.maps.Marker({
          position: { lat: latitude, lng: longitude },
          map: map,
          draggable: draggable,
          title: 'Ubicación'
        })
        setMarkerInstance(currentMarker)
      } else {
        currentMarker.setMap(map)
        currentMarker.setDraggable(draggable)
        currentMarker.setPosition({ lat: latitude, lng: longitude })
      }

      const dragListener = currentMarker.addListener('dragend', () => {
        const pos = currentMarker.getPosition()
        if (onLocationChangeRef.current && pos) {
          onLocationChangeRef.current(pos.lat(), pos.lng())
        }
      })

      return () => {
        window.google.maps.event.removeListener(dragListener)
      }
    } else {
      if (markerInstance) {
        markerInstance.setMap(null)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, marker, fixedCenterMarker, draggable])

  // Gestionar listeners del mapa según el modo
  useEffect(() => {
    if (!map || !window.google) return

    const listeners: any[] = []

    if (fixedCenterMarker) {
      let isUserDragging = false
      let userHasMoved = false

      listeners.push(
        map.addListener('dragstart', () => {
          isUserDragging = true
          userHasMoved = true
        }),
        map.addListener('dragend', () => {
          isUserDragging = false
          const center = map.getCenter()
          if (onLocationChangeRef.current && center) {
            onLocationChangeRef.current(center.lat(), center.lng())
          }
        }),
        map.addListener('idle', () => {
          // Solo disparar onLocationChange en idle si el usuario interactuó y no está arrastrando en este instante
          if (userHasMoved && !isUserDragging) {
            const center = map.getCenter()
            if (onLocationChangeRef.current && center) {
              onLocationChangeRef.current(center.lat(), center.lng())
            }
          }
        }),
        map.addListener('click', (e: any) => {
          userHasMoved = true
          map.panTo(e.latLng)
        })
      )
    } else if (draggable) {
      // Modo mover pin directamente: click en cualquier parte traslada el pin y notifica
      listeners.push(
        map.addListener('click', (e: any) => {
          const lat = e.latLng.lat()
          const lng = e.latLng.lng()
          if (markerInstance) {
            markerInstance.setPosition(e.latLng)
          }
          if (onLocationChangeRef.current) {
            onLocationChangeRef.current(lat, lng)
          }
        })
      )
    }

    return () => {
      listeners.forEach((listener) => window.google.maps.event.removeListener(listener))
    }
  }, [map, fixedCenterMarker, draggable, markerInstance])

  // Actualizar posición cuando cambien las props
  useEffect(() => {
    if (map) {
      const currentCenter = map.getCenter()
      if (!fixedCenterMarker || (currentCenter && (Math.abs(currentCenter.lat() - latitude) > 0.0001 || Math.abs(currentCenter.lng() - longitude) > 0.0001))) {
        const newPosition = { lat: latitude, lng: longitude }
        map.panTo(newPosition)
      }
      if (markerInstance && !fixedCenterMarker) {
        markerInstance.setPosition({ lat: latitude, lng: longitude })
      }
    }
  }, [latitude, longitude, map, markerInstance, fixedCenterMarker])

  if (!isLoaded) {
    return (
      <div
        style={{ height, width }}
        className="bg-gray-100 rounded-lg flex items-center justify-center"
      >
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-500 mx-auto mb-2"></div>
          <p className="text-sm text-gray-600">Cargando mapa...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative" style={{ height, width }}>
      <div
        ref={mapRef}
        style={{ height: '100%', width: '100%' }}
        className="rounded-lg border border-gray-300"
      />
      {fixedCenterMarker && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-[100%] pointer-events-none drop-shadow-md z-10 transition-transform">
          <svg className="w-10 h-10 text-red-600 drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
          </svg>
        </div>
      )}
    </div>
  )
}

// Hook para obtener ubicación actual
export function useCurrentLocation() {
  const [location, setLocation] = useState<{ lat: number, lng: number } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const getCurrentLocation = () => {
    setLoading(true)
    setError(null)

    if (!navigator.geolocation) {
      setError('Geolocalización no soportada')
      setLoading(false)
      return
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude
        })
        setLoading(false)
      },
      (error) => {
        setError('Error al obtener ubicación: ' + error.message)
        setLoading(false)
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000
      }
    )
  }

  return { location, loading, error, getCurrentLocation }
}
