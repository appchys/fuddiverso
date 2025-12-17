'use client'

import React, { useState } from 'react'
import { Business, Product } from '@/types'
import ProductList from './ProductList'

interface BusinessProfileDashboardProps {
  business: Business
  editedBusiness: Business | null
  isEditingProfile: boolean
  uploadingCover: boolean
  uploadingProfile: boolean
  products: Product[]
  categories: string[]
  onCoverImageUpload: (event: React.ChangeEvent<HTMLInputElement>) => void
  onProfileImageUpload: (event: React.ChangeEvent<HTMLInputElement>) => void
  onEditProfile: () => void
  onCancelEdit: () => void
  onSaveProfile: () => void
  onBusinessFieldChange: (field: keyof Business, value: any) => void
  onScheduleFieldChange: (day: string, key: 'open' | 'close' | 'isOpen', value: any) => void
  onToggleDayOpen: (day: string) => void
  onProductsChange: (products: Product[]) => void
  onCategoriesChange: (categories: string[]) => void
  initialTab?: 'general' | 'products'
}

export default function BusinessProfileDashboard({
  business,
  editedBusiness,
  isEditingProfile,
  uploadingCover,
  uploadingProfile,
  products,
  categories,
  onCoverImageUpload,
  onProfileImageUpload,
  onEditProfile,
  onCancelEdit,
  onSaveProfile,
  onBusinessFieldChange,
  onScheduleFieldChange,
  onToggleDayOpen,
  onProductsChange,
  onCategoriesChange,
  initialTab = 'general'
}: BusinessProfileDashboardProps) {
  const [coverLoaded, setCoverLoaded] = useState(false)
  const [logoLoaded, setLogoLoaded] = useState(false)
  const [activeTab, setActiveTab] = useState<'general' | 'products'>(initialTab)

  const displayBusiness = isEditingProfile && editedBusiness ? editedBusiness : business

  return (
    <div className="space-y-6">
      {/* Pestañas */}
      <div className="border-b border-gray-200">
        <div className="flex gap-8">
          <button
            onClick={() => setActiveTab('general')}
            className={`pb-4 font-medium transition-colors ${
              activeTab === 'general'
                ? 'text-red-600 border-b-2 border-red-600'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <i className="bi bi-info-circle me-2"></i>
            Generales
          </button>
          <button
            onClick={() => setActiveTab('products')}
            className={`pb-4 font-medium transition-colors ${
              activeTab === 'products'
                ? 'text-red-600 border-b-2 border-red-600'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <i className="bi bi-box-seam me-2"></i>
            Productos
          </button>
        </div>
      </div>

      {/* Contenido de la pestaña Generales */}
      {activeTab === 'general' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          {/* Portada */}
          <div className="relative w-full h-40 sm:h-56 bg-gray-200">
            {displayBusiness.coverImage ? (
              <>
                <div
                  className={`absolute inset-0 animate-pulse bg-gray-200 ${coverLoaded ? 'hidden' : 'block'}`}
                ></div>
                <img
                  src={displayBusiness.coverImage}
                  alt={`Portada de ${displayBusiness.name}`}
                  className="w-full h-full object-cover"
                  onLoad={() => setCoverLoaded(true)}
                  onError={() => setCoverLoaded(true)}
                />
              </>
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-orange-100 to-orange-200" />
            )}

            {/* Botón para editar portada - solo en modo edición */}
            {isEditingProfile && (
              <label className="absolute right-4 top-4 z-10 p-2 bg-white/90 hover:bg-white rounded-full shadow cursor-pointer text-gray-700 transition-colors">
                <i className="bi bi-camera"></i>
                <input
                  type="file"
                  accept="image/*"
                  onChange={onCoverImageUpload}
                  disabled={uploadingCover}
                  className="hidden"
                />
              </label>
            )}

            {/* Logo */}
            <div className="absolute left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2 z-10">
              <div className="relative">
                {displayBusiness.image && (
                  <>
                    <div
                      className={`absolute inset-0 rounded-full animate-pulse bg-gray-200 ${
                        logoLoaded ? 'hidden' : 'block'
                      }`}
                    ></div>
                    <img
                      src={displayBusiness.image}
                      alt={displayBusiness.name}
                      className="w-24 h-24 sm:w-32 sm:h-32 rounded-full border-4 border-white shadow-lg object-cover"
                      onLoad={() => setLogoLoaded(true)}
                      onError={() => setLogoLoaded(true)}
                    />
                  </>
                )}

                {/* Botón para editar logo - solo en modo edición */}
                {isEditingProfile && (
                  <label className="absolute bottom-0 right-0 z-20 p-2 bg-red-500 hover:bg-red-600 rounded-full shadow cursor-pointer text-white transition-colors">
                    <i className="bi bi-camera text-sm"></i>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={onProfileImageUpload}
                      disabled={uploadingProfile}
                      className="hidden"
                    />
                  </label>
                )}
              </div>
            </div>
          </div>

          {/* Contenido del perfil */}
          <div className="px-4 sm:px-6 pt-16 sm:pt-20 pb-6 text-center">
          {isEditingProfile ? (
            // Modo edición
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Nombre del Negocio</label>
                <input
                  type="text"
                  value={editedBusiness?.name || ''}
                  onChange={(e) => onBusinessFieldChange('name', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Descripción</label>
                <textarea
                  value={editedBusiness?.description || ''}
                  onChange={(e) => onBusinessFieldChange('description', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                  rows={3}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
                <input
                  type="email"
                  value={editedBusiness?.email || ''}
                  onChange={(e) => onBusinessFieldChange('email', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Teléfono</label>
                <input
                  type="tel"
                  value={editedBusiness?.phone || ''}
                  onChange={(e) => onBusinessFieldChange('phone', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Dirección</label>
                <input
                  type="text"
                  value={editedBusiness?.address || ''}
                  onChange={(e) => onBusinessFieldChange('address', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>

              {/* Horario de atención */}
              <div className="mt-6 pt-6 border-t border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Horario de Atención</h3>
                <div className="space-y-3">
                  {['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((day) => {
                    const daySchedule = editedBusiness?.schedule?.[day] || { open: '09:00', close: '18:00', isOpen: true }
                    const dayNames: Record<string, string> = {
                      monday: 'Lunes',
                      tuesday: 'Martes',
                      wednesday: 'Miércoles',
                      thursday: 'Jueves',
                      friday: 'Viernes',
                      saturday: 'Sábado',
                      sunday: 'Domingo'
                    }

                    return (
                      <div key={day} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                        <input
                          type="checkbox"
                          checked={daySchedule.isOpen || false}
                          onChange={() => onToggleDayOpen(day)}
                          className="w-5 h-5 text-red-500 rounded focus:ring-red-500"
                        />
                        <span className="text-sm font-medium text-gray-700 w-24">{dayNames[day]}</span>
                        {daySchedule.isOpen && (
                          <>
                            <input
                              type="time"
                              value={daySchedule.open || '09:00'}
                              onChange={(e) => onScheduleFieldChange(day, 'open', e.target.value)}
                              className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                            />
                            <span className="text-gray-500">-</span>
                            <input
                              type="time"
                              value={daySchedule.close || '18:00'}
                              onChange={(e) => onScheduleFieldChange(day, 'close', e.target.value)}
                              className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                            />
                          </>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Botones de acción */}
              <div className="flex gap-3 mt-6 pt-6 border-t border-gray-200">
                <button
                  onClick={onCancelEdit}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors font-medium"
                >
                  Cancelar
                </button>
                <button
                  onClick={onSaveProfile}
                  className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors font-medium"
                >
                  Guardar Cambios
                </button>
              </div>
            </div>
          ) : (
            // Modo visualización
            <div className="space-y-4">
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">{displayBusiness.name}</h1>
              </div>

              {displayBusiness.description && (
                <p className="text-gray-600 text-sm sm:text-base max-w-2xl mx-auto">
                  {displayBusiness.description}
                </p>
              )}

              <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
                {displayBusiness.phone && (
                  <a
                    href={`tel:${displayBusiness.phone}`}
                    className="inline-flex items-center px-4 py-2 bg-green-100 text-green-800 rounded-lg text-sm font-medium hover:bg-green-200 transition-colors"
                  >
                    <i className="bi bi-telephone mr-2"></i>
                    {displayBusiness.phone}
                  </a>
                )}
                {displayBusiness.email && (
                  <a
                    href={`mailto:${displayBusiness.email}`}
                    className="inline-flex items-center px-4 py-2 bg-blue-100 text-blue-800 rounded-lg text-sm font-medium hover:bg-blue-200 transition-colors"
                  >
                    <i className="bi bi-envelope mr-2"></i>
                    Email
                  </a>
                )}
              </div>

              {displayBusiness.address && (
                <div className="text-xs sm:text-sm text-gray-500 inline-flex items-center justify-center">
                  <i className="bi bi-geo-alt mr-1"></i>
                  {displayBusiness.address}
                </div>
              )}

              {/* Horario de atención */}
              <div className="mt-6 pt-6 border-t border-gray-200 max-w-md mx-auto">
                <h3 className="text-sm font-semibold text-gray-900 mb-3">Horario de Atención</h3>
                <div className="space-y-2 text-sm">
                  {['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((day) => {
                    const daySchedule = displayBusiness.schedule?.[day]
                    const dayNames: Record<string, string> = {
                      monday: 'Lunes',
                      tuesday: 'Martes',
                      wednesday: 'Miércoles',
                      thursday: 'Jueves',
                      friday: 'Viernes',
                      saturday: 'Sábado',
                      sunday: 'Domingo'
                    }

                    return (
                      <div key={day} className="flex justify-between text-gray-600">
                        <span className="font-medium">{dayNames[day]}</span>
                        <span>
                          {daySchedule?.isOpen ? `${daySchedule.open} - ${daySchedule.close}` : 'Cerrado'}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Botón de editar */}
              <div className="mt-6 pt-6 border-t border-gray-200">
                <button
                  onClick={onEditProfile}
                  className="w-full px-4 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors font-medium flex items-center justify-center gap-2"
                >
                  <i className="bi bi-pencil"></i>
                  Editar Información
                </button>
              </div>
            </div>
          )}
          </div>
        </div>
      )}

      {/* Contenido de la pestaña Productos */}
      {activeTab === 'products' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <ProductList
            business={business}
            products={products}
            categories={categories}
            onProductsChange={onProductsChange}
            onCategoriesChange={onCategoriesChange}
          />
        </div>
      )}
    </div>
  )
}
