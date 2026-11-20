'use client'

import React from 'react'
import { GOOGLE_MAPS_API_KEY } from '@/components/GoogleMap'

export interface ClientLocationItem {
  id: string
  id_cliente: string
  referencia: string
  sector?: string
  tarifa: string
  latlong?: string
  photo?: string
  isFavorite?: boolean
  createdBy?: 'client' | 'admin'
}

interface ClientLocationsListProps {
  locations: ClientLocationItem[]
  selectedLocationId?: string | null
  loading?: boolean
  onSelectLocation: (location: ClientLocationItem) => void
  onEditLocation?: (location: ClientLocationItem) => void
  onDeleteLocation?: (locationId: string) => void
  onAddNewLocation?: () => void
}

export function ClientLocationsList({
  locations,
  selectedLocationId,
  loading = false,
  onSelectLocation,
  onEditLocation,
  onDeleteLocation,
  onAddNewLocation,
}: ClientLocationsListProps) {
  return (
    <div>
      {loading ? (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
          <p className="text-sm text-gray-500 mt-2">Cargando ubicaciones...</p>
        </div>
      ) : locations.length > 0 ? (
        <div className="space-y-3 mb-4">
          {locations.map((location) => (
            <label
              key={location.id}
              className="flex items-start p-3 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer"
            >
              <input
                type="radio"
                name="selectedLocation"
                checked={selectedLocationId === location.id}
                onChange={() => onSelectLocation(location)}
                className="mr-3 mt-1 flex-shrink-0"
              />

              {/* Mapa estático */}
              {location.latlong && (
                <a
                  href={
                    location.latlong.startsWith('pluscode:')
                      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location.latlong.replace('pluscode:', ''))}`
                      : `https://www.google.com/maps/search/?api=1&query=${location.latlong}`
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="w-16 h-16 mr-3 flex-shrink-0 bg-gray-200 rounded-md overflow-hidden relative block hover:opacity-80 transition-opacity"
                  title="Abrir en Google Maps"
                >
                  <img
                    src={`https://maps.googleapis.com/maps/api/staticmap?center=${location.latlong}&zoom=13&size=64x64&maptype=roadmap&markers=color:red%7C${location.latlong}&key=${GOOGLE_MAPS_API_KEY}`}
                    alt="Ubicación en mapa"
                    className="w-full h-full object-cover"
                    loading="lazy"
                    decoding="async"
                    onError={(e) => {
                      const target = e.target as HTMLImageElement
                      target.style.display = 'none'
                      const parent = target.parentElement
                      if (parent) {
                        const fallback = parent.querySelector('.map-fallback') as HTMLElement
                        if (fallback) {
                          fallback.style.display = 'flex'
                        }
                      }
                    }}
                  />
                  <div className="map-fallback absolute inset-0 hidden w-full h-full flex items-center justify-center bg-gray-200">
                    <i className="bi bi-geo-alt text-gray-400 text-lg"></i>
                  </div>
                </a>
              )}

              {/* Foto de ubicación */}
              {location.photo && (
                <div className="w-16 h-16 mr-3 flex-shrink-0 bg-gray-200 rounded-md overflow-hidden relative">
                  <img
                    src={location.photo}
                    alt="Foto de ubicación"
                    className="w-full h-full object-cover"
                    loading="lazy"
                    decoding="async"
                  />
                </div>
              )}

              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 break-words">
                  {location.referencia || location.sector || 'Ubicación guardada'}
                </p>
                {location.sector && location.referencia && (
                  <p className="text-xs text-gray-500 mt-0.5">{location.sector}</p>
                )}
              </div>

              {(onEditLocation || onDeleteLocation) && (
                <div className="ml-3 flex flex-col items-end gap-2">
                  {onEditLocation && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onEditLocation(location)
                      }}
                      className="text-sm text-blue-600 hover:text-blue-700 p-1"
                      type="button"
                    >
                      <i className="bi bi-pencil"></i>
                    </button>
                  )}
                  {onDeleteLocation && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onDeleteLocation(location.id)
                      }}
                      className="text-sm text-red-600 hover:text-red-700 p-1"
                      type="button"
                    >
                      <i className="bi bi-trash"></i>
                    </button>
                  )}
                </div>
              )}
            </label>
          ))}
        </div>
      ) : (
        <div className="text-center py-8">
          <i className="bi bi-geo-alt text-gray-400 text-4xl mb-3"></i>
          <p className="text-sm text-gray-500 mb-4">No hay ubicaciones registradas para este cliente</p>
        </div>
      )}

      {onAddNewLocation && (
        <div className="flex space-x-3">
          <button
            type="button"
            onClick={onAddNewLocation}
            className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 transition-colors"
          >
            <i className="bi bi-plus-lg mr-2"></i>
            Nueva ubicación
          </button>
        </div>
      )}
    </div>
  )
}

interface ClientLocationsModalProps extends ClientLocationsListProps {
  isOpen: boolean
  title?: string
  subtitle?: string
  onClose: () => void
}

export function ClientLocationsModal({
  isOpen,
  title = 'Seleccionar ubicación',
  subtitle,
  onClose,
  ...listProps
}: ClientLocationsModalProps) {
  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg p-6 w-full max-w-md max-h-[80vh] overflow-y-auto"
        style={{ overscrollBehavior: 'contain' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-start mb-4 gap-3">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
            {subtitle && <p className="text-xs text-gray-500 truncate mt-0.5">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 p-1 rounded hover:bg-gray-100 transition-colors shrink-0"
          >
            <i className="bi bi-x-lg"></i>
          </button>
        </div>

        <ClientLocationsList {...listProps} />
      </div>
    </div>
  )
}
