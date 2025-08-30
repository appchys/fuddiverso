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

  // Inicializar mapa
  useEffect(() => {
    if (!isLoaded || !mapRef.current || !window.google) return

    const mapInstance = new window.google.maps.Map(mapRef.current, {
      center: { lat: latitude, lng: longitude },
      zoom: zoom,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
    })

    setMap(mapInstance)

    if (marker) {
      const markerInstance = new window.google.maps.Marker({
        position: { lat: latitude, lng: longitude },
        map: mapInstance,
        draggable: draggable,
        title: 'Ubicación'
      })

      if (draggable && onLocationChange) {
        markerInstance.addListener('dragend', () => {
          const position = markerInstance.getPosition()
          onLocationChange(position.lat(), position.lng())
        })
      }

      setMarkerInstance(markerInstance)
    }

    // Click en el mapa para mover marcador (solo si es draggable)
    if (draggable && onLocationChange) {
      mapInstance.addListener('click', (e: any) => {
        const lat = e.latLng.lat()
        const lng = e.latLng.lng()
        
        if (markerInstance) {
          markerInstance.setPosition({ lat, lng })
        }
        
        onLocationChange(lat, lng)
      })
    }

  }, [isLoaded, latitude, longitude, zoom, marker, draggable, onLocationChange])

  // Actualizar posición cuando cambien las props
  useEffect(() => {
    if (map && markerInstance) {
      const newPosition = { lat: latitude, lng: longitude }
      map.setCenter(newPosition)
      markerInstance.setPosition(newPosition)
    }
  }, [latitude, longitude, map, markerInstance])

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
    <div 
      ref={mapRef} 
      style={{ height, width }} 
      className="rounded-lg border border-gray-300"
    />
  )
}

// Hook para obtener ubicación actual
export function useCurrentLocation() {
  const [location, setLocation] = useState<{lat: number, lng: number} | null>(null)
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
