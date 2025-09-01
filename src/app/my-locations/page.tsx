'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { getLocationsByClient, deleteLocation, updateLocation } from '@/lib/database'
import { addDoc, collection } from 'firebase/firestore'
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
      await addDoc(collection(db, 'ubicaciones'), {
        id_cliente: user.celular,
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
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const lat = position.coords.latitude
          const lng = position.coords.longitude
          setNewLocation(prev => ({
            ...prev,
            latlong: `${lat},${lng}`
          }))
        },
        (error) => {
          console.error('Error getting location:', error)
          setError('Error al obtener la ubicación actual')
        }
      )
    } else {
      setError('Tu navegador no soporta geolocalización')
    }
  }

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
            </div>
          </div>
        )}

        {/* Modal para agregar ubicación */}
        {isAddingLocation && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg p-6 w-full max-w-md">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Agregar Nueva Ubicación</h3>
              
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
                    <input
                      type="text"
                      value={newLocation.latlong}
                      onChange={(e) => setNewLocation(prev => ({ ...prev, latlong: e.target.value }))}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                      placeholder="Latitud,Longitud"
                      readOnly
                    />
                    <button
                      onClick={getCurrentLocation}
                      className="bg-blue-600 text-white px-3 py-2 rounded-lg hover:bg-blue-700 flex items-center"
                    >
                      <i className="bi bi-geo-alt"></i>
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Usa el botón de ubicación para obtener tu posición actual
                  </p>
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
              <div key={location.id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center mb-2">
                      <i className="bi bi-geo-alt text-red-500 mr-2"></i>
                      <h3 className="text-lg font-medium text-gray-900">{location.sector}</h3>
                    </div>
                    <p className="text-gray-600 mb-2">{location.referencia}</p>
                    <div className="flex items-center space-x-4 text-sm text-gray-500">
                      <span className="flex items-center">
                        <i className="bi bi-truck mr-1"></i>
                        Envío: ${location.tarifa}
                      </span>
                      {location.latlong && (
                        <span className="flex items-center">
                          <i className="bi bi-pin-map mr-1"></i>
                          {location.latlong.split(',')[0].substring(0, 8)}, {location.latlong.split(',')[1]?.substring(0, 8)}
                        </span>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => setEditingLocation(location.id)}
                      className="text-gray-400 hover:text-gray-600 p-2"
                    >
                      <i className="bi bi-pencil"></i>
                    </button>
                    <button
                      onClick={() => setShowDeleteConfirm(location.id)}
                      className="text-gray-400 hover:text-red-600 p-2"
                    >
                      <i className="bi bi-trash"></i>
                    </button>
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
