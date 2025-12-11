"use client"

import React from 'react'
import { Business } from '@/types'

interface BusinessProfileSectionProps {
  business: Business
  editedBusiness: Business | null
  isEditingProfile: boolean
  uploadingCover: boolean
  uploadingProfile: boolean
  onCoverImageUpload: (e: React.ChangeEvent<HTMLInputElement>) => void
  onProfileImageUpload: (e: React.ChangeEvent<HTMLInputElement>) => void
  onEditProfile: () => void
  onCancelEdit: () => void
  onSaveProfile: () => void
  onBusinessFieldChange: (field: keyof Business, value: any) => void
  onScheduleFieldChange: (day: string, key: 'open' | 'close' | 'isOpen', value: any) => void
  onToggleDayOpen: (day: string) => void
}

export const BusinessProfileSection: React.FC<BusinessProfileSectionProps> = ({
  business,
  editedBusiness,
  isEditingProfile,
  uploadingCover,
  uploadingProfile,
  onCoverImageUpload,
  onProfileImageUpload,
  onEditProfile,
  onCancelEdit,
  onSaveProfile,
  onBusinessFieldChange,
  onScheduleFieldChange,
  onToggleDayOpen,
}) => {
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

  return (
    <div>
      <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-4 sm:mb-6">
        <i className="bi bi-shop me-2"></i>Información de la Tienda
      </h2>

      {/* Imagen de Portada */}
      <div className="bg-white rounded-lg shadow-md overflow-hidden mb-4 sm:mb-6">
        <div className="h-32 sm:h-48 bg-gradient-to-r from-red-400 to-red-600 relative">
          {business.coverImage ? (
            <img
              src={business.coverImage}
              alt="Portada de la tienda"
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <div className="text-center text-white">
                <i className="bi bi-image text-2xl sm:text-4xl mb-1 sm:mb-2 opacity-70"></i>
                <p className="text-xs sm:text-sm opacity-90">Imagen de portada</p>
              </div>
            </div>
          )}

          {/* Botón para subir portada */}
          <div className="absolute top-2 right-2 sm:top-4 sm:right-4">
            <input
              type="file"
              accept="image/*"
              onChange={onCoverImageUpload}
              className="hidden"
              id="cover-upload"
            />
            <label
              htmlFor="cover-upload"
              className="cursor-pointer bg-white bg-opacity-90 hover:bg-opacity-100 text-gray-700 px-2 py-1 sm:px-3 sm:py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all inline-flex items-center"
            >
              {uploadingCover ? (
                <>
                  <i className="bi bi-arrow-clockwise animate-spin me-1"></i>
                  <span className="hidden sm:inline">Subiendo...</span>
                  <span className="sm:hidden">...</span>
                </>
              ) : (
                <>
                  <i className="bi bi-camera me-1"></i>
                  <span className="hidden sm:inline">
                    {business.coverImage ? 'Cambiar Portada' : 'Subir Portada'}
                  </span>
                  <span className="sm:hidden">Portada</span>
                </>
              )}
            </label>
          </div>
        </div>

        {/* Imagen de Perfil superpuesta */}
        <div className="relative px-4 sm:px-6 pb-4 sm:pb-6">
          <div className="flex items-end -mt-12 sm:-mt-16">
            <div className="relative">
              <div className="w-20 h-20 sm:w-24 sm:h-24 bg-white rounded-full p-1 shadow-lg">
                {business.image ? (
                  <img
                    src={business.image}
                    alt={business.name}
                    className="w-full h-full object-cover rounded-full"
                  />
                ) : (
                  <div className="w-full h-full bg-gray-200 rounded-full flex items-center justify-center">
                    <i className="bi bi-shop text-gray-400 text-xl sm:text-2xl"></i>
                  </div>
                )}
              </div>

              {/* Botón para cambiar imagen de perfil */}
              <div className="absolute -bottom-1 -right-1">
                <input
                  type="file"
                  accept="image/*"
                  onChange={onProfileImageUpload}
                  className="hidden"
                  id="profile-upload"
                />
                <label
                  htmlFor="profile-upload"
                  className="cursor-pointer bg-red-600 text-white p-1 sm:p-1.5 rounded-full hover:bg-red-700 transition-colors inline-flex items-center justify-center"
                >
                  {uploadingProfile ? (
                    <i className="bi bi-arrow-clockwise animate-spin text-xs"></i>
                  ) : (
                    <i className="bi bi-camera text-xs"></i>
                  )}
                </label>
              </div>
            </div>

            <div className="ml-3 sm:ml-4 flex-1 min-w-0">
              <h3 className="text-lg sm:text-xl font-bold text-gray-900 truncate">{business.name}</h3>
              <p className="text-sm sm:text-base text-gray-600 truncate">@{business.username}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Información de la Tienda */}
      <div className="bg-white rounded-lg shadow-md p-4 sm:p-6">
        {!isEditingProfile ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <i className="bi bi-shop me-2"></i>Nombre de la Tienda
                </label>
                <p className="text-gray-900 text-sm sm:text-base">{business.name}</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <i className="bi bi-at me-2"></i>Usuario
                </label>
                <p className="text-gray-900 text-sm sm:text-base">@{business.username}</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <i className="bi bi-envelope me-2"></i>Email
                </label>
                <p className="text-gray-900 text-sm sm:text-base break-all">{business.email}</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <i className="bi bi-telephone me-2"></i>Teléfono
                </label>
                <p className="text-gray-900 text-sm sm:text-base">{business.phone}</p>
              </div>

              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <i className="bi bi-tags me-2"></i>Categorías
                </label>
                <div className="flex flex-wrap gap-2">
                  {business.categories && business.categories.length > 0 ? (
                    business.categories.map((category, index) => (
                      <span key={index} className="bg-red-100 text-red-800 px-2 py-1 rounded-full text-xs">
                        {category}
                      </span>
                    ))
                  ) : (
                    <span className="text-gray-500 text-sm">Sin categorías</span>
                  )}
                </div>
              </div>

              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <i className="bi bi-clock me-2"></i>Estado
                </label>
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${business.isActive
                  ? 'bg-green-100 text-green-800'
                  : 'bg-red-100 text-red-800'
                  }`}>
                  <i className={`bi ${business.isActive ? 'bi-check-circle' : 'bi-x-circle'} me-1`}></i>
                  {business.isActive ? 'Activa' : 'Inactiva'}
                </span>
              </div>

              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <i className="bi bi-geo-alt me-2"></i>Dirección
                </label>
                <p className="text-gray-900 text-sm sm:text-base">{business.address}</p>
              </div>

              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <i className="bi bi-card-text me-2"></i>Descripción
                </label>
                <p className="text-gray-900 text-sm sm:text-base">{business.description}</p>
              </div>

              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <i className="bi bi-building me-2"></i>Referencias de Ubicación
                </label>
                <p className="text-gray-900 text-sm sm:text-base">{business.references || 'Sin referencias'}</p>
              </div>

              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <i className="bi bi-clock-history me-2"></i>Horario de Atención
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {days.map((day) => {
                    const dayObj = editedBusiness?.schedule?.[day] || { open: '09:00', close: '18:00', isOpen: true }
                    const label = day.charAt(0).toUpperCase() + day.slice(1)
                    return (
                      <div key={day} className="flex items-center gap-2">
                        <div className="w-28">
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-gray-700">{label}</span>
                            <button
                              type="button"
                              onClick={() => onToggleDayOpen(day)}
                              className={`text-xs px-2 py-1 rounded ${dayObj.isOpen ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}
                            >
                              {dayObj.isOpen ? 'Abierto' : 'Cerrado'}
                            </button>
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <input type="time" value={dayObj.open} disabled className="w-24 px-2 py-1 border rounded text-sm" />
                            <span className="text-xs text-gray-400">-</span>
                            <input type="time" value={dayObj.close} disabled className="w-24 px-2 py-1 border rounded text-sm" />
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            <div className="mt-4 sm:mt-6 pt-4 sm:pt-6 border-t border-gray-200 flex flex-col sm:flex-row space-y-3 sm:space-y-0 sm:space-x-3">
              <button
                onClick={onEditProfile}
                className="w-full sm:w-auto bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors text-sm sm:text-base"
              >
                <i className="bi bi-pencil me-2"></i>
                Editar Información
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <i className="bi bi-shop me-2"></i>Nombre de la Tienda
                </label>
                <input
                  type="text"
                  value={editedBusiness?.name || ''}
                  onChange={(e) => onBusinessFieldChange('name', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm sm:text-base"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <i className="bi bi-at me-2"></i>Usuario
                </label>
                <input
                  type="text"
                  value={editedBusiness?.username || ''}
                  onChange={(e) => onBusinessFieldChange('username', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm sm:text-base"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <i className="bi bi-envelope me-2"></i>Email
                </label>
                <input
                  type="email"
                  value={editedBusiness?.email || ''}
                  onChange={(e) => onBusinessFieldChange('email', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm sm:text-base"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <i className="bi bi-telephone me-2"></i>Teléfono
                </label>
                <input
                  type="tel"
                  value={editedBusiness?.phone || ''}
                  onChange={(e) => onBusinessFieldChange('phone', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm sm:text-base"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <i className="bi bi-tags me-2"></i>Categorías (separadas por comas)
                </label>
                <input
                  type="text"
                  value={editedBusiness?.categories?.join(', ') || ''}
                  onChange={(e) => onBusinessFieldChange('categories', e.target.value.split(',').map(c => c.trim()).filter(c => c))}
                  placeholder="Ej: Comida rápida, Pizza, Italiana"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm sm:text-base"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <i className="bi bi-clock me-2"></i>Estado de la Tienda
                </label>
                <select
                  value={editedBusiness?.isActive ? 'true' : 'false'}
                  onChange={(e) => onBusinessFieldChange('isActive', e.target.value === 'true')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm sm:text-base"
                >
                  <option value="true">Activa</option>
                  <option value="false">Inactiva</option>
                </select>
              </div>

              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <i className="bi bi-geo-alt me-2"></i>Dirección
                </label>
                <input
                  type="text"
                  value={editedBusiness?.address || ''}
                  onChange={(e) => onBusinessFieldChange('address', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm sm:text-base"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <i className="bi bi-card-text me-2"></i>Descripción
                </label>
                <textarea
                  value={editedBusiness?.description || ''}
                  onChange={(e) => onBusinessFieldChange('description', e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm sm:text-base"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <i className="bi bi-building me-2"></i>Referencias de Ubicación
                </label>
                <textarea
                  value={editedBusiness?.references || ''}
                  onChange={(e) => onBusinessFieldChange('references', e.target.value)}
                  rows={2}
                  placeholder="Ej: Cerca del centro comercial, junto a la farmacia..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm sm:text-base"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <i className="bi bi-clock-history me-2"></i>Horario de Atención
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {days.map((day) => {
                    const dayObj = editedBusiness?.schedule?.[day] || { open: '09:00', close: '18:00', isOpen: true }
                    const label = day.charAt(0).toUpperCase() + day.slice(1)
                    return (
                      <div key={day} className="flex items-center gap-2">
                        <div className="w-28">
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-gray-700">{label}</span>
                            <button
                              type="button"
                              onClick={() => onToggleDayOpen(day)}
                              className={`text-xs px-2 py-1 rounded ${dayObj.isOpen ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}
                            >
                              {dayObj.isOpen ? 'Abierto' : 'Cerrado'}
                            </button>
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <input
                              type="time"
                              value={dayObj.open}
                              onChange={(e) => onScheduleFieldChange(day, 'open', e.target.value)}
                              className="w-24 px-2 py-1 border rounded text-sm"
                            />
                            <span className="text-xs text-gray-400">-</span>
                            <input
                              type="time"
                              value={dayObj.close}
                              onChange={(e) => onScheduleFieldChange(day, 'close', e.target.value)}
                              className="w-24 px-2 py-1 border rounded text-sm"
                            />
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            <div className="mt-4 sm:mt-6 pt-4 sm:pt-6 border-t border-gray-200 flex flex-col sm:flex-row space-y-3 sm:space-y-0 sm:space-x-3">
              <button
                onClick={onSaveProfile}
                className="w-full sm:w-auto bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors text-sm sm:text-base"
              >
                <i className="bi bi-check-circle me-2"></i>
                Guardar Cambios
              </button>
              <button
                onClick={onCancelEdit}
                className="w-full sm:w-auto bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 transition-colors text-sm sm:text-base"
              >
                <i className="bi bi-x-circle me-2"></i>
                Cancelar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
