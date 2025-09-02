'use client'

import { useState, useEffect, useCallback } from 'react'
import { GoogleMap, useJsApiLoader, Polygon, Marker } from '@react-google-maps/api'
import { getCoverageZones, createCoverageZone, updateCoverageZone, deleteCoverageZone } from '@/lib/database'
import { CoverageZone } from '@/types'

const mapContainerStyle = {
  width: '100%',
  height: '500px'
}

const center = {
  lat: -2.1709979,
  lng: -79.9224426 // Guayaquil, Ecuador
}

// Define libraries as a constant outside the component to prevent reloading
const GOOGLE_MAPS_LIBRARIES: ("drawing" | "geometry" | "places" | "visualization")[] = ["drawing"]

export default function CoverageZonesPage() {
  const [zones, setZones] = useState<CoverageZone[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedZone, setSelectedZone] = useState<CoverageZone | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [formData, setFormData] = useState({
    name: '',
    deliveryFee: 0,
    isActive: true
  })
  const [currentPolygon, setCurrentPolygon] = useState<{ lat: number; lng: number }[]>([])
  const [markers, setMarkers] = useState<{ lat: number; lng: number }[]>([])
  const [isDrawingMode, setIsDrawingMode] = useState(false)
  const [notification, setNotification] = useState<{ show: boolean; message: string; type: 'success' | 'error' }>({
    show: false,
    message: '',
    type: 'success'
  })

  const { isLoaded, loadError } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || 'AIzaSyAgOiLYPpzxlUHkX3lCmp5KK4UF7wx7zMs',
    libraries: GOOGLE_MAPS_LIBRARIES
  })

  const [map, setMap] = useState<google.maps.Map | null>(null)

  useEffect(() => {
    loadZones()
  }, [])

  const loadZones = async () => {
    try {
      setLoading(true)
      const zonesData = await getCoverageZones()
      setZones(zonesData)
    } catch (error) {
      console.error('Error loading zones:', error)
      showNotification('Error al cargar las zonas', 'error')
    } finally {
      setLoading(false)
    }
  }

  const showNotification = (message: string, type: 'success' | 'error' = 'success') => {
    setNotification({ show: true, message, type })
    setTimeout(() => {
      setNotification({ show: false, message: '', type: 'success' })
    }, 3000)
  }

  // Función para manejar clics en el mapa
  const handleMapClick = useCallback((event: google.maps.MapMouseEvent) => {
    if (!isDrawingMode || !event.latLng) return

    const lat = event.latLng.lat()
    const lng = event.latLng.lng()
    const newPoint = { lat, lng }

    setMarkers(prev => [...prev, newPoint])
    setCurrentPolygon(prev => [...prev, newPoint])
  }, [isDrawingMode])

  // Función para iniciar modo dibujo
  const startDrawing = () => {
    setIsDrawingMode(true)
    setMarkers([])
    setCurrentPolygon([])
  }

  // Función para terminar el dibujo
  const finishDrawing = () => {
    setIsDrawingMode(false)
    if (markers.length >= 3) {
      // Cerrar el polígono conectando el último punto con el primero
      setCurrentPolygon([...markers])
    } else {
      showNotification('Necesitas al menos 3 puntos para crear un polígono', 'error')
      setMarkers([])
      setCurrentPolygon([])
    }
  }

  // Función para limpiar el dibujo
  const clearDrawing = () => {
    setIsDrawingMode(false)
    setMarkers([])
    setCurrentPolygon([])
  }

  const handleSaveZone = async () => {
    if (!formData.name.trim()) {
      showNotification('El nombre de la zona es requerido', 'error')
      return
    }

    if (currentPolygon.length < 3) {
      showNotification('Se requieren al menos 3 puntos para formar un polígono válido', 'error')
      return
    }

    try {
      if (selectedZone) {
        // Actualizar zona existente
        await updateCoverageZone(selectedZone.id, {
          name: formData.name,
          deliveryFee: formData.deliveryFee,
          isActive: formData.isActive,
          polygon: currentPolygon
        })
        showNotification('Zona actualizada correctamente', 'success')
      } else {
        // Crear nueva zona
        await createCoverageZone({
          name: formData.name,
          deliveryFee: formData.deliveryFee,
          isActive: formData.isActive,
          polygon: currentPolygon
        })
        showNotification('Zona creada correctamente', 'success')
      }
      
      loadZones()
      resetForm()
    } catch (error) {
      console.error('Error saving zone:', error)
      showNotification('Error al guardar la zona', 'error')
    }
  }

  const handleDeleteZone = async (zoneId: string) => {
    if (!confirm('¿Estás seguro de que quieres eliminar esta zona?')) {
      return
    }

    try {
      await deleteCoverageZone(zoneId)
      showNotification('Zona eliminada correctamente', 'success')
      loadZones()
      if (selectedZone?.id === zoneId) {
        resetForm()
      }
    } catch (error) {
      console.error('Error deleting zone:', error)
      showNotification('Error al eliminar la zona', 'error')
    }
  }

  const resetForm = () => {
    setSelectedZone(null)
    setIsCreating(false)
    setFormData({
      name: '',
      deliveryFee: 0,
      isActive: true
    })
    setCurrentPolygon([])
    setMarkers([])
    setIsDrawingMode(false)
  }

  const startCreating = () => {
    resetForm()
    setIsCreating(true)
  }

  const editZone = (zone: CoverageZone) => {
    setSelectedZone(zone)
    setIsCreating(true)
    setFormData({
      name: zone.name,
      deliveryFee: zone.deliveryFee,
      isActive: zone.isActive
    })
    setCurrentPolygon(zone.polygon)
    setMarkers(zone.polygon)
    setIsDrawingMode(false)
  }

  const onLoad = useCallback((map: google.maps.Map) => {
    setMap(map)
  }, [])

  const onUnmount = useCallback(() => {
    setMap(null)
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-red-500 mx-auto"></div>
          <p className="mt-4 text-gray-600">Cargando zonas de cobertura...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Zonas de Cobertura</h1>
              <p className="text-gray-600 mt-1">Gestiona las zonas de entrega y sus tarifas</p>
            </div>
            <button
              onClick={startCreating}
              className="bg-red-500 text-white px-4 py-2 rounded-lg hover:bg-red-600 flex items-center gap-2"
            >
              <i className="bi bi-plus-circle"></i>
              Nueva Zona
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Lista de zonas */}
            <div>
              <h2 className="text-lg font-semibold mb-4">Zonas Existentes ({zones.length})</h2>
              
              {zones.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <i className="bi bi-geo text-4xl text-gray-300 mb-2"></i>
                  <p>No hay zonas de cobertura configuradas</p>
                  <p className="text-sm">Crea tu primera zona para comenzar</p>
                </div>
              ) : (
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {zones.map((zone) => (
                    <div
                      key={zone.id}
                      className={`p-4 border rounded-lg cursor-pointer transition-colors ${
                        selectedZone?.id === zone.id
                          ? 'border-red-500 bg-red-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                      onClick={() => editZone(zone)}
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <h3 className="font-medium text-gray-900">{zone.name}</h3>
                          <p className="text-sm text-gray-600">Tarifa: ${zone.deliveryFee.toFixed(2)}</p>
                          <p className="text-xs text-gray-500 mt-1">
                            {zone.polygon.length} puntos del polígono
                          </p>
                          <span className={`inline-block px-2 py-1 text-xs rounded-full mt-2 ${
                            zone.isActive 
                              ? 'bg-green-100 text-green-800' 
                              : 'bg-red-100 text-red-800'
                          }`}>
                            {zone.isActive ? 'Activa' : 'Inactiva'}
                          </span>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDeleteZone(zone.id)
                          }}
                          className="text-red-500 hover:text-red-700 ml-2"
                        >
                          <i className="bi bi-trash"></i>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Mapa */}
            <div>
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-semibold">Mapa de Cobertura</h2>
                {isCreating && (
                  <div className="flex gap-2">
                    {!isDrawingMode ? (
                      <button
                        onClick={startDrawing}
                        className="bg-blue-500 text-white px-3 py-1 text-sm rounded hover:bg-blue-600"
                      >
                        <i className="bi bi-pencil mr-1"></i>
                        Dibujar Zona
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={finishDrawing}
                          disabled={markers.length < 3}
                          className="bg-green-500 text-white px-3 py-1 text-sm rounded hover:bg-green-600 disabled:bg-gray-300"
                        >
                          <i className="bi bi-check-circle mr-1"></i>
                          Terminar ({markers.length} puntos)
                        </button>
                        <button
                          onClick={clearDrawing}
                          className="bg-red-500 text-white px-3 py-1 text-sm rounded hover:bg-red-600"
                        >
                          <i className="bi bi-x-circle mr-1"></i>
                          Limpiar
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>

              {isLoaded ? (
                <div className="relative">
                  <GoogleMap
                    mapContainerStyle={mapContainerStyle}
                    center={center}
                    zoom={12}
                    onLoad={onLoad}
                    onUnmount={onUnmount}
                    onClick={handleMapClick}
                    options={{
                      streetViewControl: false,
                      mapTypeControl: true,
                      fullscreenControl: false
                    }}
                  >
                    {/* Mostrar todas las zonas existentes */}
                    {zones.map((zone) => (
                      <Polygon
                        key={zone.id}
                        paths={zone.polygon}
                        options={{
                          fillColor: selectedZone?.id === zone.id ? '#ff0000' : '#0066cc',
                          fillOpacity: selectedZone?.id === zone.id ? 0.4 : 0.2,
                          strokeColor: selectedZone?.id === zone.id ? '#ff0000' : '#0066cc',
                          strokeOpacity: 1,
                          strokeWeight: 2
                        }}
                      />
                    ))}

                    {/* Mostrar marcadores del polígono en creación */}
                    {markers.map((marker, index) => (
                      <Marker
                        key={index}
                        position={marker}
                        label={(index + 1).toString()}
                        icon={{
                          url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
                            <svg width="30" height="30" viewBox="0 0 30 30" xmlns="http://www.w3.org/2000/svg">
                              <circle cx="15" cy="15" r="12" fill="#ff0000" stroke="#ffffff" stroke-width="2"/>
                              <text x="15" y="19" text-anchor="middle" fill="white" font-family="Arial" font-size="12" font-weight="bold">${index + 1}</text>
                            </svg>
                          `),
                          scaledSize: new window.google.maps.Size(30, 30)
                        }}
                      />
                    ))}

                    {/* Mostrar polígono actual en tiempo real */}
                    {currentPolygon.length > 2 && (
                      <Polygon
                        paths={currentPolygon}
                        options={{
                          fillColor: '#ff0000',
                          fillOpacity: 0.3,
                          strokeColor: '#ff0000',
                          strokeOpacity: 1,
                          strokeWeight: 2
                        }}
                      />
                    )}
                  </GoogleMap>

                  {/* Instrucciones de uso */}
                  {isDrawingMode && (
                    <div className="absolute top-4 left-4 bg-white p-3 rounded-lg shadow-lg border max-w-xs">
                      <div className="flex items-start gap-2">
                        <i className="bi bi-info-circle text-blue-500 mt-1"></i>
                        <div className="text-sm">
                          <p className="font-medium text-gray-800">Modo Dibujo Activo</p>
                          <p className="text-gray-600 mt-1">
                            Haz clic en el mapa para colocar puntos. Necesitas mínimo 3 puntos para crear la zona.
                          </p>
                          <p className="text-xs text-gray-500 mt-1">
                            Puntos actuales: {markers.length}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {!isCreating && zones.length === 0 && (
                    <div className="absolute inset-0 flex items-center justify-center bg-gray-50 bg-opacity-90">
                      <div className="text-center">
                        <i className="bi bi-geo text-4xl text-gray-300 mb-2"></i>
                        <p className="text-gray-600">No hay zonas configuradas</p>
                        <p className="text-sm text-gray-500">Crea tu primera zona para verla en el mapa</p>
                      </div>
                    </div>
                  )}
                </div>
              ) : loadError ? (
                <div className="w-full h-[500px] bg-red-50 border border-red-200 rounded-lg flex items-center justify-center">
                  <div className="text-center">
                    <i className="bi bi-exclamation-triangle text-4xl text-red-400 mb-4"></i>
                    <h3 className="text-lg font-medium text-red-800 mb-2">Error al cargar Google Maps</h3>
                    <p className="text-red-600 mb-4">No se pudo cargar la API de Google Maps.</p>
                    <div className="bg-red-100 border border-red-300 rounded-lg p-4 max-w-md">
                      <p className="text-sm text-red-700 mb-2">
                        <strong>Posibles soluciones:</strong>
                      </p>
                      <ul className="text-xs text-red-600 space-y-1 text-left">
                        <li>• Verifica que la API key de Google Maps esté configurada</li>
                        <li>• Asegúrate de que la API key tenga permisos para Maps JavaScript API</li>
                        <li>• Verifica tu conexión a internet</li>
                        <li>• Recarga la página</li>
                      </ul>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="w-full h-[500px] bg-gray-200 rounded-lg flex items-center justify-center">
                  <div className="text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-500 mx-auto mb-2"></div>
                    <p className="text-gray-600">Cargando mapa...</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Formulario de creación/edición */}
          {isCreating && (
            <div className="mt-6 p-6 bg-gray-50 rounded-lg border">
              <h3 className="text-lg font-semibold mb-4">
                {selectedZone ? 'Editar Zona' : 'Nueva Zona'}
              </h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Nombre de la zona *
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                    placeholder="Ej: Centro Norte, Samborondón, etc."
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Tarifa de envío ($) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.deliveryFee}
                    onChange={(e) => setFormData({ ...formData, deliveryFee: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                    placeholder="0.00"
                  />
                </div>
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Coordenadas del polígono
                </label>
                <div className="bg-gray-50 border border-gray-200 rounded-md p-3">
                  {currentPolygon.length > 0 ? (
                    <div className="space-y-1">
                      <p className="text-sm text-green-600 font-medium">
                        <i className="bi bi-check-circle mr-1"></i>
                        Polígono definido con {currentPolygon.length} puntos
                      </p>
                      <div className="max-h-24 overflow-y-auto">
                        {currentPolygon.map((point, index) => (
                          <div key={index} className="text-xs text-gray-600">
                            Punto {index + 1}: {point.lat.toFixed(6)}, {point.lng.toFixed(6)}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">
                      <i className="bi bi-geo mr-1"></i>
                      {isDrawingMode 
                        ? `Haz clic en el mapa para agregar puntos (${markers.length} puntos)`
                        : 'Usa el botón "Dibujar Zona" para definir el área de cobertura'
                      }
                    </p>
                  )}
                </div>
              </div>

              <div className="mb-6">
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={formData.isActive}
                    onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                    className="mr-2"
                  />
                  <span className="text-sm font-medium text-gray-700">Zona activa</span>
                </label>
              </div>
              
              <div className="flex justify-end gap-4">
                <button
                  onClick={resetForm}
                  className="px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSaveZone}
                  disabled={!formData.name.trim() || currentPolygon.length < 3}
                  className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:bg-gray-300 disabled:cursor-not-allowed"
                >
                  {selectedZone ? 'Actualizar' : 'Guardar'} Zona
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Sección de ayuda */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mt-6">
          <h3 className="font-medium text-blue-900 mb-3">
            <i className="bi bi-lightbulb mr-2"></i>
            Cómo usar el sistema de zonas de cobertura
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-blue-800">
            <div>
              <h4 className="font-medium mb-2">📍 Crear una zona:</h4>
              <ul className="space-y-1">
                <li>1. Haz clic en "Nueva Zona"</li>
                <li>2. Ingresa nombre y tarifa</li>
                <li>3. Haz clic en "Dibujar Zona"</li>
                <li>4. Coloca puntos en el mapa (mín. 3)</li>
                <li>5. Termina el dibujo y guarda</li>
              </ul>
            </div>
            <div>
              <h4 className="font-medium mb-2">⚙️ Funcionamiento:</h4>
              <ul className="space-y-1">
                <li>• Las zonas definen áreas de entrega</li>
                <li>• Cada zona tiene tarifa personalizada</li>
                <li>• Se calculan automáticamente en checkout</li>
                <li>• Si no hay zona: tarifa por defecto</li>
                <li>• Zonas inactivas no se usan</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* Notificaciones */}
      {notification.show && (
        <div className={`fixed top-4 right-4 z-50 p-4 rounded-lg shadow-lg ${
          notification.type === 'success' ? 'bg-green-500' : 'bg-red-500'
        } text-white`}>
          <div className="flex items-center gap-2">
            <i className={`bi ${notification.type === 'success' ? 'bi-check-circle' : 'bi-exclamation-circle'}`}></i>
            {notification.message}
          </div>
        </div>
      )}
    </div>
  )
}
