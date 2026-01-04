'use client'

import React, { useState, useEffect } from 'react'
import { Business, Product, Ingredient } from '@/types'
import { getIngredientLibrary, addOrUpdateIngredientInLibrary, IngredientLibraryItem } from '@/lib/database'
import ProductList from './ProductList'

interface BusinessProfileDashboardProps {
  business: Business
  editedBusiness: Business | null
  isEditingProfile: boolean
  uploadingCover: boolean
  uploadingProfile: boolean
  uploadingLocation: boolean
  products: Product[]
  categories: string[]
  onCoverImageUpload: (event: React.ChangeEvent<HTMLInputElement>) => void
  onProfileImageUpload: (event: React.ChangeEvent<HTMLInputElement>) => void
  onLocationImageUpload: (event: React.ChangeEvent<HTMLInputElement>) => void
  onEditProfile: () => void
  onCancelEdit: () => void
  onSaveProfile: () => void
  onBusinessFieldChange: (field: keyof Business, value: any) => void
  onScheduleFieldChange: (day: string, key: 'open' | 'close' | 'isOpen', value: any) => void
  onToggleDayOpen: (day: string) => void
  onProductsChange: (products: Product[]) => void
  onCategoriesChange: (categories: string[]) => void
  initialTab?: 'general' | 'products' | 'fidelizacion'
}

export default function BusinessProfileDashboard({
  business,
  editedBusiness,
  isEditingProfile,
  uploadingCover,
  uploadingProfile,
  uploadingLocation,
  products,
  categories,
  onCoverImageUpload,
  onProfileImageUpload,
  onLocationImageUpload,
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
  const [activeTab, setActiveTab] = useState<'general' | 'products' | 'fidelizacion'>(initialTab)

  // Estados para ingredientes del premio
  const [ingredientLibrary, setIngredientLibrary] = useState<IngredientLibraryItem[]>([])
  const [currentRewardIngredient, setCurrentRewardIngredient] = useState({
    name: '',
    unitCost: '',
    quantity: ''
  })
  const [showRewardIngredientSuggestions, setShowRewardIngredientSuggestions] = useState(false)
  const [rewardIngredientSearchTerm, setRewardIngredientSearchTerm] = useState('')

  useEffect(() => {
    if (business?.id && activeTab === 'fidelizacion') {
      getIngredientLibrary(business.id).then(lib => setIngredientLibrary(lib))
    }
  }, [business?.id, activeTab])

  const handleRewardIngredientChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setCurrentRewardIngredient(prev => ({ ...prev, [name]: value }))

    if (name === 'name') {
      setRewardIngredientSearchTerm(value)
      setShowRewardIngredientSuggestions(value.trim().length > 0)
    }
  }

  const addRewardIngredient = async () => {
    if (!currentRewardIngredient.name.trim()) return

    const unitCost = currentRewardIngredient.unitCost ? Number(currentRewardIngredient.unitCost) : 0
    const quantity = currentRewardIngredient.quantity ? Number(currentRewardIngredient.quantity) : 1

    if (isNaN(unitCost) || unitCost < 0 || isNaN(quantity) || quantity <= 0) {
      alert('Los valores deben ser válidos')
      return
    }

    const newIngredient = {
      id: Date.now().toString(),
      name: currentRewardIngredient.name.trim(),
      unitCost: unitCost,
      quantity: quantity
    }

    const currentSettings = displayBusiness.rewardSettings || { enabled: false, name: '', description: '' }
    const updatedIngredients = [...(currentSettings.ingredients || []), newIngredient]

    onBusinessFieldChange('rewardSettings', { ...currentSettings, ingredients: updatedIngredients })

    setCurrentRewardIngredient({ name: '', unitCost: '', quantity: '' })
    setShowRewardIngredientSuggestions(false)
    setRewardIngredientSearchTerm('')

    if (business?.id) {
      await addOrUpdateIngredientInLibrary(business.id, newIngredient.name, unitCost)
      const library = await getIngredientLibrary(business.id)
      setIngredientLibrary(library)
    }
  }

  const removeRewardIngredient = (ingredientId: string) => {
    const currentSettings = displayBusiness.rewardSettings || { enabled: false, name: '', description: '' }
    const updatedIngredients = (currentSettings.ingredients || []).filter(i => (i.id || (i as any).id) !== ingredientId)
    onBusinessFieldChange('rewardSettings', { ...currentSettings, ingredients: updatedIngredients })
  }

  const selectRewardIngredientFromLibrary = (ingredient: IngredientLibraryItem) => {
    setCurrentRewardIngredient({
      name: ingredient.name,
      unitCost: ingredient.unitCost.toString(),
      quantity: '1'
    })
    setShowRewardIngredientSuggestions(false)
    setRewardIngredientSearchTerm('')
  }

  const getFilteredRewardIngredients = () => {
    if (!rewardIngredientSearchTerm.trim()) return ingredientLibrary
    const searchLower = rewardIngredientSearchTerm.toLowerCase()
    return ingredientLibrary.filter(ing => ing.name.toLowerCase().includes(searchLower))
  }

  const calculateTotalRewardIngredientCost = () => {
    return (displayBusiness.rewardSettings?.ingredients || []).reduce((sum, ingredient) =>
      sum + (ingredient.unitCost * ingredient.quantity), 0)
  }

  // Cerrar sugerencias al hacer clic fuera
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element
      if (showRewardIngredientSuggestions && !target.closest('.reward-ingredient-input-container')) {
        setShowRewardIngredientSuggestions(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showRewardIngredientSuggestions])

  const displayBusiness = isEditingProfile && editedBusiness ? editedBusiness : business

  return (
    <div className="space-y-6">
      {/* Pestañas */}
      <div className="border-b border-gray-200">
        <div className="flex gap-8">
          <button
            onClick={() => setActiveTab('general')}
            className={`pb-4 font-medium transition-colors ${activeTab === 'general'
              ? 'text-red-600 border-b-2 border-red-600'
              : 'text-gray-600 hover:text-gray-900'
              }`}
          >
            <i className="bi bi-info-circle me-2"></i>
            Generales
          </button>
          <button
            onClick={() => setActiveTab('products')}
            className={`pb-4 font-medium transition-colors ${activeTab === 'products'
              ? 'text-red-600 border-b-2 border-red-600'
              : 'text-gray-600 hover:text-gray-900'
              }`}
          >
            <i className="bi bi-box-seam me-2"></i>
            Productos
          </button>
          <button
            onClick={() => setActiveTab('fidelizacion')}
            className={`pb-4 font-medium transition-colors ${activeTab === 'fidelizacion'
              ? 'text-red-600 border-b-2 border-red-600'
              : 'text-gray-600 hover:text-gray-900'
              }`}
          >
            <i className="bi bi-gift me-2"></i>
            Fidelización
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
                      className={`absolute inset-0 rounded-full animate-pulse bg-gray-200 ${logoLoaded ? 'hidden' : 'block'
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

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Foto del Local</label>
                  <div className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-gray-300 border-dashed rounded-lg hover:border-red-400 transition-colors group relative overflow-hidden">
                    {displayBusiness.locationImage ? (
                      <div className="relative w-full aspect-video rounded-lg overflow-hidden">
                        <img
                          src={displayBusiness.locationImage}
                          alt="Foto del local"
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <label className="cursor-pointer bg-white text-gray-900 px-4 py-2 rounded-full text-sm font-bold shadow-lg transform translate-y-2 group-hover:translate-y-0 transition-transform">
                            {uploadingLocation ? 'Subiendo...' : 'Cambiar Foto'}
                            <input
                              type="file"
                              accept="image/*"
                              onChange={onLocationImageUpload}
                              disabled={uploadingLocation}
                              className="hidden"
                            />
                          </label>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-1 text-center">
                        <i className="bi bi-shop text-4xl text-gray-400 mb-2"></i>
                        <div className="flex text-sm text-gray-600">
                          <label className="relative cursor-pointer bg-white rounded-md font-medium text-red-600 hover:text-red-500 focus-within:outline-none focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-red-500">
                            <span>{uploadingLocation ? 'Subiendo...' : 'Sube una foto'}</span>
                            <input
                              type="file"
                              accept="image/*"
                              onChange={onLocationImageUpload}
                              disabled={uploadingLocation}
                              className="hidden"
                            />
                          </label>
                          <p className="pl-1">o arrastra y suelta</p>
                        </div>
                        <p className="text-xs text-gray-500">PNG, JPG, GIF hasta 10MB</p>
                      </div>
                    )}
                  </div>
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

                {displayBusiness.locationImage && (
                  <div className="mt-4 max-w-lg mx-auto rounded-xl overflow-hidden shadow-md border border-gray-100">
                    <img
                      src={displayBusiness.locationImage}
                      alt="Foto del local"
                      className="w-full aspect-video object-cover"
                    />
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
      {/* Contenido de la pestaña Fidelización */}
      {activeTab === 'fidelizacion' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="max-w-2xl mx-auto">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Premio Automático</h3>
                <p className="text-sm text-gray-500">Configura un regalo que se agregará automáticamente al carrito de tus clientes.</p>
              </div>
              <div
                className={`relative inline-block w-12 h-6 rounded-full cursor-pointer transition-colors duration-200 ${displayBusiness.rewardSettings?.enabled ? 'bg-red-500' : 'bg-gray-200'}`}
                onClick={() => {
                  const currentSettings = displayBusiness.rewardSettings || { enabled: false, name: '', description: '' };
                  onBusinessFieldChange('rewardSettings', { ...currentSettings, enabled: !currentSettings.enabled });
                }}
              >
                <div className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform duration-200 shadow-sm ${displayBusiness.rewardSettings?.enabled ? 'translate-x-6' : ''}`}></div>
              </div>
            </div>

            <div className={`space-y-4 transition-opacity duration-200 ${displayBusiness.rewardSettings?.enabled ? 'opacity-100' : 'opacity-50 pointer-events-none'}`}>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Nombre del Premio</label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-gray-400">🎁</span>
                  <input
                    type="text"
                    placeholder="Ej: 5 wantancitos gratis"
                    value={displayBusiness.rewardSettings?.name || ''}
                    onChange={(e) => {
                      const currentSettings = displayBusiness.rewardSettings || { enabled: false, name: '', description: '' };
                      onBusinessFieldChange('rewardSettings', { ...currentSettings, name: e.target.value });
                    }}
                    className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Descripción (opcional)</label>
                <textarea
                  placeholder="Ej: ¡Felicidades! Has reclamado tu premio especial gratis"
                  value={displayBusiness.rewardSettings?.description || ''}
                  onChange={(e) => {
                    const currentSettings = displayBusiness.rewardSettings || { enabled: false, name: '', description: '' };
                    onBusinessFieldChange('rewardSettings', { ...currentSettings, description: e.target.value });
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
                  rows={3}
                />
              </div>

              {/* Sección de Ingredientes y Costos del Premio */}
              <div className="mt-8 pt-6 border-t border-gray-100">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">Ingredientes y Costos</h4>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">Costo total del premio:</span>
                    <span className="text-sm font-bold text-red-600">
                      ${calculateTotalRewardIngredientCost().toFixed(2)}
                    </span>
                  </div>
                </div>

                {/* Formulario para agregar ingrediente - Estilo unificado con ProductList */}
                <div className="bg-gray-50/50 p-4 rounded-2xl border border-dashed border-gray-200 mb-6">
                  <h5 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                    <i className="bi bi-plus-circle text-red-500"></i>
                    Agregar Insumo de la Base
                  </h5>
                  <div className="space-y-4">
                    <div className="relative reward-ingredient-input-container">
                      <div className="relative">
                        <i className="bi bi-search absolute left-4 top-1/2 -translate-y-1/2 text-gray-300 text-xs"></i>
                        <input
                          type="text"
                          name="name"
                          placeholder="Buscar o crear insumo..."
                          value={currentRewardIngredient.name}
                          onChange={handleRewardIngredientChange}
                          onFocus={() => setShowRewardIngredientSuggestions(true)}
                          autoComplete="off"
                          className="w-full pl-10 pr-4 py-3 text-sm bg-white border border-gray-200 rounded-xl focus:outline-none focus:border-red-500 font-bold transition-all shadow-sm"
                        />
                      </div>
                      {showRewardIngredientSuggestions && (
                        <div className="absolute z-20 w-full mt-1 bg-white border border-gray-100 rounded-xl shadow-xl overflow-hidden overflow-y-auto max-h-48">
                          {getFilteredRewardIngredients().length > 0 ? (
                            getFilteredRewardIngredients().map((ing) => (
                              <button
                                key={ing.id}
                                type="button"
                                onClick={() => selectRewardIngredientFromLibrary(ing)}
                                className="w-full px-4 py-2.5 text-left text-xs hover:bg-red-50 border-b border-gray-50 last:border-b-0 transition-all flex justify-between items-center"
                              >
                                <span className="font-bold text-gray-700">{ing.name}</span>
                                <span className="text-red-500 font-black">${ing.unitCost.toFixed(2)}</span>
                              </button>
                            ))
                          ) : currentRewardIngredient.name.trim() !== '' && (
                            <button
                              type="button"
                              onClick={() => setShowRewardIngredientSuggestions(false)}
                              className="w-full text-left px-4 py-3 bg-red-50 hover:bg-red-100 text-xs font-black text-red-700 transition-all flex items-center gap-2"
                            >
                              <i className="bi bi-plus-lg bg-white p-1 rounded-lg shadow-sm"></i>
                              Crear "{currentRewardIngredient.name}"
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">$</span>
                        <input
                          type="number"
                          name="unitCost"
                          step="0.01"
                          placeholder="Costo u."
                          value={currentRewardIngredient.unitCost}
                          onChange={handleRewardIngredientChange}
                          className="w-full pl-7 pr-3 py-2.5 text-sm bg-white border border-gray-200 rounded-xl focus:outline-none focus:border-red-500 font-black transition-all"
                        />
                      </div>
                      <input
                        type="number"
                        name="quantity"
                        step="0.1"
                        placeholder="Cantidad"
                        value={currentRewardIngredient.quantity}
                        onChange={handleRewardIngredientChange}
                        className="w-full px-3 py-2.5 text-sm bg-white border border-gray-200 rounded-xl focus:outline-none focus:border-red-500 font-black transition-all"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={addRewardIngredient}
                      disabled={!currentRewardIngredient.name.trim()}
                      className="w-full bg-red-600 text-white px-4 py-3 text-xs rounded-xl hover:bg-red-700 transition-all font-black uppercase tracking-wider"
                    >
                      Agregar al Premio
                    </button>
                  </div>
                </div>

                {/* Lista de ingredientes agregados */}
                <div className="space-y-2">
                  {(displayBusiness.rewardSettings?.ingredients || []).length === 0 ? (
                    <div className="text-center py-4 bg-gray-50 rounded-lg border border-dashed border-gray-200">
                      <p className="text-xs text-gray-500">No hay ingredientes definidos para este premio.</p>
                    </div>
                  ) : (
                    (displayBusiness.rewardSettings?.ingredients || []).map((ing, idx) => (
                      <div key={ing.id || idx} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg border border-gray-100 group">
                        <div className="flex flex-col">
                          <span className="text-sm font-medium text-gray-900">{ing.name}</span>
                          <span className="text-xs text-gray-500">
                            {ing.quantity} x ${ing.unitCost.toFixed(2)} = ${(ing.quantity * ing.unitCost).toFixed(2)}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeRewardIngredient(ing.id || (ing as any).id)}
                          className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors opacity-0 group-hover:opacity-100"
                        >
                          <i className="bi bi-trash text-sm"></i>
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="p-4 bg-orange-50 rounded-lg border border-orange-100">
                <div className="flex gap-3">
                  <i className="bi bi-info-circle text-orange-500 text-lg"></i>
                  <p className="text-sm text-orange-800">
                    Este premio aparecerá en el carrito del cliente con un precio de <strong>$0.00</strong>. Asegúrate de tener stock suficiente para cumplir con estos regalos.
                  </p>
                </div>
              </div>
            </div>

            {isEditingProfile && (
              <div className="flex gap-3 mt-8 pt-6 border-t border-gray-200">
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
            )}

            {!isEditingProfile && (
              <div className="mt-8 pt-6 border-t border-gray-200 text-center">
                <button
                  onClick={onEditProfile}
                  className="inline-flex items-center px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors font-medium gap-2"
                >
                  <i className="bi bi-pencil"></i>
                  Editar Configuración
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
