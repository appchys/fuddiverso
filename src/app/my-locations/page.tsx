'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { getLocationsByClient, deleteLocation, updateLocation } from '@/lib/database'
import { GoogleMap } from '@/components/GoogleMap'
import { collection, addDoc, query, where, getDocs } from 'firebase/firestore'
import { db } from '@/lib/firebase'

interface LocationData {
  id: string
  id_cliente: string
  referencia: string
  sector: string
  tarifa: string
  latlong: string
}

export default function MyLocationsPage() {
  const { user, isAuthenticated } = useAuth()
  const router = useRouter()
  const [locations, setLocations] = useState<LocationData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isAddingLocation, setIsAddingLocation] = useState(false)
  const [editingLocation, setEditingLocation] = useState<string | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null)
  
  const [newLocation, setNewLocation] = useState({
    referencia: '',
    sector: '',
    tarifa: '2.00',
    latlong: ''
  })

  // Estados para el mapa de agregar ubicación
  const [mapCenter, setMapCenter] = useState({ lat: -2.1894, lng: -79.8890 })
  const [mapZoom, setMapZoom] = useState(13)
  const [isLoadingLocation, setIsLoadingLocation] = useState(false)

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/')
      return
    }

    loadLocations()
  }, [user, isAuthenticated, router])

  const loadLocations = async () => {
    if (!user?.celular) return

    setLoading(true)
    try {
      const userLocations = await getLocationsByClient(user.celular)
      setLocations(userLocations)
    } catch (err) {
      console.error('Error loading locations:', err)
      setError('Error al cargar las ubicaciones')
    } finally {
      setLoading(false)
    }
  }

  // Función para obtener el ID del cliente basado en su número de celular
  const getClientId = async (celular: string): Promise<string | null> => {
    try {
      const clientQuery = query(
        collection(db, 'clients'),
        where('celular', '==', celular)
      );
      
      const clientSnapshot = await getDocs(clientQuery);
      
      if (clientSnapshot.empty) {
        return null;
      }

      const clientDoc = clientSnapshot.docs[0];
      return clientDoc.data().id;
    } catch (error) {
      console.error('Error getting client ID:', error);
      return null;
    }
  }

  // Función optimizada para manejar cambios en el mapa
  const handleMapClick = useCallback((lat: number, lng: number) => {
    setNewLocation(prev => ({
      ...prev,
      latlong: `${lat},${lng}`
    }))
    setMapCenter({ lat, lng })
  }, [])

  const handleAddLocation = async () => {
    if (!user?.celular) return

    // Validaciones
    if (!newLocation.referencia.trim() || !newLocation.sector.trim()) {
      setError('Por favor completa todos los campos requeridos')
      return
    }

    if (!newLocation.latlong) {
      setError('Por favor selecciona una ubicación en el mapa')
      return
    }

    try {
      // Obtener el ID del cliente
      const clientId = await getClientId(user.celular)
      if (!clientId) {
        setError('No se pudo encontrar el cliente en la base de datos')
        return
      }

      // Crear la ubicación con el ID del cliente correcto
      await addDoc(collection(db, 'ubicaciones'), {
        id_cliente: clientId,
        referencia: newLocation.referencia.trim(),
        sector: newLocation.sector.trim(),
        tarifa: newLocation.tarifa,
        latlong: newLocation.latlong
      })

      setNewLocation({
        referencia: '',
        sector: '',
        tarifa: '2.00',
        latlong: ''
      })
      setIsAddingLocation(false)
      loadLocations()
      setError(null)
    } catch (err) {
      console.error('Error adding location:', err)
      setError('Error al agregar la ubicación')
    }
  }

  const handleUpdateLocation = async (locationId: string, data: Partial<LocationData>) => {
    try {
      await updateLocation(locationId, data)
      setEditingLocation(null)
      loadLocations()
    } catch (err) {
      console.error('Error updating location:', err)
      setError('Error al actualizar la ubicación')
    }
  }

  const handleDeleteLocation = async (locationId: string) => {
    try {
      await deleteLocation(locationId)
      setShowDeleteConfirm(null)
      loadLocations()
    } catch (err) {
      console.error('Error deleting location:', err)
      setError('Error al eliminar la ubicación')
    }
  }

  const getCurrentLocation = () => {
    if (navigator.geolocation) {
      setIsLoadingLocation(true)
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const lat = position.coords.latitude
          const lng = position.coords.longitude
          setNewLocation(prev => ({
            ...prev,
            latlong: `${lat},${lng}`
          }))
          setMapCenter({ lat, lng })
          setMapZoom(15)
          setIsLoadingLocation(false)
        },
        (error) => {
          console.error('Error getting location:', error)
          setError('Error al obtener la ubicación actual')
          setIsLoadingLocation(false)
        }
      )
    } else {
      setError('Tu navegador no soporta geolocalización')
    }
  }

  // Función para obtener URL de Google Static Maps
  const getStaticMapUrl = (latlong: string) => {
    if (!latlong) return ''
    const [lat, lng] = latlong.split(',')
    return `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=15&size=150x150&markers=color:red%7C${lat},${lng}&key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}`
  }

  // Memoizar las coordenadas del marcador para el nuevo mapa
  const currentMapPosition = useMemo(() => {
    if (newLocation.latlong) {
      const [lat, lng] = newLocation.latlong.split(',').map(Number)
      return { lat, lng }
    }
    return mapCenter
  }, [newLocation.latlong, mapCenter])

  if (!isAuthenticated || !user) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-red-500 mx-auto"></div>
          <p className="mt-4 text-gray-600">Verificando acceso...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Mis Ubicaciones</h1>
              <p className="mt-2 text-gray-600">Gestiona tus direcciones de entrega</p>
            </div>
            <button
              onClick={() => setIsAddingLocation(true)}
              className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 flex items-center"
            >
              <i className="bi bi-plus mr-2"></i>
              Agregar Ubicación
            </button>
          </div>
        </div>

        {/* Mensaje de error */}
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex items-center text-red-700">
              <i className="bi bi-exclamation-triangle mr-2"></i>
              {error}
              <button
                onClick={() => setError(null)}
                className="ml-auto text-red-400 hover:text-red-600"
              >
                <i className="bi bi-x"></i>
              </button>
            </div>
          </div>
        )}

        {/* Modal para agregar ubicación */}
        {isAddingLocation && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Agregar Nueva Ubicación</h3>
              
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Formulario a la izquierda */}
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Referencias *
                    </label>
                    <input
                      type="text"
                      value={newLocation.referencia}
                      onChange={(e) => setNewLocation(prev => ({ ...prev, referencia: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                      placeholder="Ej: Casa color azul, portón negro"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Sector *
                    </label>
                    <input
                      type="text"
                      value={newLocation.sector}
                      onChange={(e) => setNewLocation(prev => ({ ...prev, sector: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                      placeholder="Ej: Norte de Quito, La Carolina"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Tarifa de envío
                    </label>
                    <select
                      value={newLocation.tarifa}
                      onChange={(e) => setNewLocation(prev => ({ ...prev, tarifa: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                    >
                      <option value="1.00">$1.00</option>
                      <option value="1.50">$1.50</option>
                      <option value="2.00">$2.00</option>
                      <option value="2.50">$2.50</option>
                      <option value="3.00">$3.00</option>
                      <option value="3.50">$3.50</option>
                      <option value="4.00">$4.00</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Ubicación
                    </label>
                    <div className="flex space-x-2">
                      <button
                        onClick={getCurrentLocation}
                        disabled={isLoadingLocation}
                        className="bg-blue-600 text-white px-3 py-2 rounded-lg hover:bg-blue-700 flex items-center disabled:opacity-50"
                      >
                        {isLoadingLocation ? (
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                        ) : (
                          <i className="bi bi-geo-alt"></i>
                        )}
                      </button>
                      <span className="px-3 py-2 text-sm text-gray-600 bg-gray-50 rounded-lg flex-1">
                        {newLocation.latlong ? 'Ubicación seleccionada en el mapa' : 'Haz clic en el mapa para seleccionar'}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      Usa el botón de ubicación o haz clic en el mapa
                    </p>
                  </div>
                </div>

                {/* Mapa a la derecha */}
                <div className="h-80 lg:h-full min-h-[300px]">
                  <GoogleMap
                    latitude={currentMapPosition.lat}
                    longitude={currentMapPosition.lng}
                    zoom={mapZoom}
                    height="100%"
                    onLocationChange={handleMapClick}
                    marker={!!newLocation.latlong}
                    draggable={true}
                  />
                </div>
              </div>

              <div className="flex space-x-3 mt-6">
                <button
                  onClick={handleAddLocation}
                  className="flex-1 bg-red-600 text-white py-2 px-4 rounded-lg hover:bg-red-700"
                >
                  Agregar
                </button>
                <button
                  onClick={() => {
                    setIsAddingLocation(false)
                    setNewLocation({ referencia: '', sector: '', tarifa: '2.00', latlong: '' })
                    setError(null)
                  }}
                  className="flex-1 bg-gray-200 text-gray-800 py-2 px-4 rounded-lg hover:bg-gray-300"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Lista de ubicaciones */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-500"></div>
            <span className="ml-3 text-gray-600">Cargando ubicaciones...</span>
          </div>
        ) : locations.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm p-8 text-center">
            <i className="bi bi-geo-alt text-gray-400 text-4xl mb-4"></i>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No tienes ubicaciones guardadas</h3>
            <p className="text-gray-600 mb-6">Agrega tu primera dirección de entrega para hacer pedidos más rápido</p>
            <button
              onClick={() => setIsAddingLocation(true)}
              className="bg-red-600 text-white px-6 py-3 rounded-lg hover:bg-red-700 flex items-center mx-auto"
            >
              <i className="bi bi-plus mr-2"></i>
              Agregar Mi Primera Ubicación
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {locations.map((location) => (
              <div key={location.id} className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                {/* Layout horizontal: Mapa a la izquierda, información a la derecha */}
                <div className="flex flex-col sm:flex-row">
                  {/* Mapa de la ubicación */}
                  <div className="w-full sm:w-32 h-32 sm:h-24 flex-shrink-0">
                    {location.latlong ? (
                      <img
                        src={getStaticMapUrl(location.latlong)}
                        alt={`Mapa de ${location.sector}`}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none'
                          const fallback = e.currentTarget.nextElementSibling as HTMLElement
                          if (fallback) {
                            fallback.classList.remove('hidden')
                          }
                        }}
                      />
                    ) : (
                      <div className="w-full h-full bg-gray-200 flex items-center justify-center">
                        <i className="bi bi-geo-alt text-gray-400 text-xl"></i>
                      </div>
                    )}
                    {/* Fallback cuando falla la imagen */}
                    <div className="hidden w-full h-full bg-gray-200 flex items-center justify-center">
                      <i className="bi bi-geo-alt text-gray-400 text-xl"></i>
                    </div>
                  </div>

                  {/* Información de la ubicación */}
                  <div className="flex-1 p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center mb-1">
                          <i className="bi bi-geo-alt text-red-500 mr-2"></i>
                          <h3 className="text-lg font-medium text-gray-900">{location.sector}</h3>
                        </div>
                        <p className="text-gray-600 mb-2">{location.referencia}</p>
                        <div className="flex items-center space-x-4 text-sm text-gray-500">
                          <span className="flex items-center">
                            <i className="bi bi-scooter mr-1"></i>
                            Envío: ${location.tarifa}
                          </span>
                          {location.latlong && (
                            <span className="flex items-center">
                              <i className="bi bi-pin-map mr-1"></i>
                              Ubicación guardada
                            </span>
                          )}
                        </div>
                      </div>
                      
                      <div className="flex items-center space-x-2 ml-4">
                        <button
                          onClick={() => setEditingLocation(location.id)}
                          className="text-gray-400 hover:text-gray-600 p-2"
                          title="Editar ubicación"
                        >
                          <i className="bi bi-pencil"></i>
                        </button>
                        <button
                          onClick={() => setShowDeleteConfirm(location.id)}
                          className="text-gray-400 hover:text-red-600 p-2"
                          title="Eliminar ubicación"
                        >
                          <i className="bi bi-trash"></i>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Modal de confirmación de eliminación */}
        {showDeleteConfirm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg p-6 w-full max-w-sm">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Confirmar eliminación</h3>
              <p className="text-gray-600 mb-6">¿Estás seguro de que deseas eliminar esta ubicación?</p>
              
              <div className="flex space-x-3">
                <button
                  onClick={() => handleDeleteLocation(showDeleteConfirm)}
                  className="flex-1 bg-red-600 text-white py-2 px-4 rounded-lg hover:bg-red-700"
                >
                  Eliminar
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(null)}
                  className="flex-1 bg-gray-200 text-gray-800 py-2 px-4 rounded-lg hover:bg-gray-300"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
