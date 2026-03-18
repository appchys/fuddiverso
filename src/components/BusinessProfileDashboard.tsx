'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import { Business, Product, Ingredient } from '@/types'
import { getIngredientLibrary, addOrUpdateIngredientInLibrary, IngredientLibraryItem, uploadImage } from '@/lib/database'
import ProductList from './ProductList'
import NotificationSettings from './NotificationSettings'
import { GoogleMap, useCurrentLocation } from './GoogleMap'
import QRCodesContent from '@/app/business/qr-codes/qr-codes-content'

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
  initialTab?: 'general' | 'products' | 'fidelizacion' | 'notifications' | 'admins'
  onDirectUpdate?: (field: keyof Business, value: any) => Promise<void>
  // Props para gestión de administradores (opcionales)
  onAddAdmin?: () => void
  onRemoveAdmin?: (email: string) => void
  onTransferOwnership?: (admin: any) => void
  userRole?: 'owner' | 'admin' | 'manager' | null
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
  initialTab = 'general',
  onDirectUpdate,
  onAddAdmin,
  onRemoveAdmin,
  onTransferOwnership,
  userRole
}: BusinessProfileDashboardProps) {
  const [coverLoaded, setCoverLoaded] = useState(false)
  const [logoLoaded, setLogoLoaded] = useState(false)
  const [activeTab, setActiveTab] = useState<'general' | 'products' | 'fidelizacion' | 'notifications' | 'admins'>(initialTab)
  const [fidelizacionSubTab, setFidelizacionSubTab] = useState<'automatic' | 'qr'>('automatic')

  // Hook para ubicación
  const { location, loading: locating, error: locationError, getCurrentLocation } = useCurrentLocation()

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

  const handlePickupLocationChange = (lat: number, lng: number) => {
    const currentSettings = displayBusiness.pickupSettings || { enabled: false, references: '', latlong: '', storePhotoUrl: '' }
    onBusinessFieldChange('pickupSettings', {
      ...currentSettings,
      latlong: `${lat}, ${lng}`
    })
  }

  const handleCaptureCurrentLocation = () => {
    getCurrentLocation()
  }

  useEffect(() => {
    if (location) {
      handlePickupLocationChange(location.lat, location.lng)
    }
  }, [location])

  const handleStorePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !business?.id) return

    try {
      const path = `businesses/${business.id}/pickup_photo_${Date.now()}`
      const url = await uploadImage(file, path)
      const currentSettings = displayBusiness.pickupSettings || { enabled: false, references: '', latlong: '', storePhotoUrl: '' }
      onBusinessFieldChange('pickupSettings', {
        ...currentSettings,
        storePhotoUrl: url
      })
    } catch (error) {
      console.error('Error al subir foto del negocio:', error)
      alert('Error al subir la foto')
    }
  }

  return (
    <div className="space-y-6 pt-4">



      {/* Contenido de la pestaña General */}
      {activeTab === 'general' && (
        <div className="space-y-6 animate-fadeIn">
          {/* Tarjeta de Identidad */}
          <div className="bg-white rounded-3xl shadow-xl shadow-gray-200/50 border border-gray-100 overflow-hidden group">
            <div className="h-32 sm:h-48 bg-gray-100 relative overflow-hidden">
                {displayBusiness.coverImage ? (
                    <img src={displayBusiness.coverImage} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
                ) : (
                    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100">
                        <i className="bi bi-image text-gray-300 text-4xl"></i>
                    </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent"></div>
            </div>
            
            <div className="px-8 pb-8 -mt-12 sm:-mt-16 relative z-10">
                <div className="flex flex-col sm:flex-row items-end gap-6 mb-6">
                    <div className="w-24 h-24 sm:w-32 sm:h-32 rounded-[2rem] bg-white p-2 shadow-2xl shadow-black/10 overflow-hidden ring-4 ring-white transition-transform duration-500 hover:rotate-2">
                        {displayBusiness.image ? (
                            <img src={displayBusiness.image} className="w-full h-full object-cover rounded-[1.5rem]" />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center bg-gray-50 rounded-[1.5rem]">
                                <i className="bi bi-shop text-3xl text-gray-200"></i>
                            </div>
                        )}
                    </div>
                    <div className="flex-1 pb-2">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                            <h2 className="text-2xl sm:text-3xl font-black text-gray-900 uppercase tracking-tight">{displayBusiness.name}</h2>
                            {displayBusiness.isActive ? (
                                <span className="px-3 py-1 bg-emerald-100 text-emerald-600 rounded-full text-[10px] font-black uppercase tracking-widest border border-emerald-200">Activo</span>
                            ) : (
                                <span className="px-3 py-1 bg-gray-100 text-gray-400 rounded-full text-[10px] font-black uppercase tracking-widest border border-gray-200">Inactivo</span>
                            )}
                        </div>
                        <p className="text-sm font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
                            <i className="bi bi-tag-fill text-red-500"></i>
                            {displayBusiness.category || 'Sin Categoría'}
                        </p>
                    </div>
                    <button 
                        onClick={onEditProfile}
                        className="mb-2 px-6 py-3 bg-gray-900 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-black transition-all hover:scale-105 active:scale-95 shadow-xl shadow-gray-900/20 flex items-center gap-2"
                    >
                        <i className="bi bi-pencil-square"></i>
                        Editar Perfil
                    </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pt-6 border-t border-gray-100">
                    <div className="space-y-4">
                        <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">Contacto y Ubicación</h4>
                        <div className="space-y-3">
                            <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-2xl border border-gray-100/50">
                                <i className="bi bi-whatsapp text-emerald-500 text-lg"></i>
                                <div>
                                    <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">WhatsApp</p>
                                    <p className="text-sm font-bold text-gray-900">{displayBusiness.phone || 'No especificado'}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-2xl border border-gray-100/50">
                                <i className="bi bi-envelope text-blue-500 text-lg"></i>
                                <div>
                                    <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Email</p>
                                    <p className="text-sm font-bold text-gray-900 truncate max-w-[150px]">{displayBusiness.email}</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">Configuración</h4>
                        <div className="space-y-3">
                            <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-2xl border border-gray-100/50">
                                <i className="bi bi-bicycle text-red-500 text-lg"></i>
                                <div className="flex-1">
                                    <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Repartidor Predeterminado</p>
                                    <div className="flex items-center justify-between">
                                        <p className="text-sm font-bold text-gray-900">
                                            {displayBusiness.defaultDeliveryId ? 'Configurado' : 'No asignado'}
                                        </p>
                                        {displayBusiness.defaultDeliveryId && (
                                            <span className="text-[9px] font-black text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100">ACTIVO</span>
                                        )}
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-2xl border border-gray-100/50">
                                <i className="bi bi-shop-window text-blue-500 text-lg"></i>
                                <div className="flex-1">
                                    <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Retiro en Local</p>
                                    <div className="flex items-center justify-between">
                                        <p className="text-sm font-bold text-gray-900">
                                            {displayBusiness.pickupSettings?.enabled ? 'Habilitado' : 'Desactivado'}
                                        </p>
                                        {displayBusiness.pickupSettings?.enabled && (
                                            <span className="text-[9px] font-black text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-100">ACTIVO</span>
                                        )}
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-2xl border border-gray-100/50">
                                <i className="bi bi-clock-history text-purple-500 text-lg"></i>
                                <div>
                                    <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Tiempo de Entrega</p>
                                    <p className="text-sm font-bold text-gray-900">{displayBusiness.deliveryTime || 30} minutos</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">Horario Hoy</h4>
                        <div className="p-4 bg-gray-900 text-white rounded-[2rem] shadow-xl shadow-gray-900/10">
                            {(() => {
                                const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
                                const today = days[new Date().getDay()] as keyof Business['schedule']
                                const schedule = displayBusiness.schedule?.[today]
                                
                                return (
                                    <div className="flex flex-col items-center justify-center text-center">
                                        <p className="text-[9px] font-black text-gray-400 uppercase tracking-[0.3em] mb-2">Estado Actual</p>
                                        {!schedule?.isOpen ? (
                                            <span className="text-lg font-black text-red-400 uppercase italic">Cerrado</span>
                                        ) : (
                                            <div className="flex flex-col items-center">
                                                <span className="text-lg font-black text-emerald-400 uppercase italic">Abierto</span>
                                                <p className="text-xs font-black text-gray-400 mt-1 uppercase tracking-widest">
                                                    {schedule.open} - {schedule.close}
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                )
                            })()}
                        </div>
                    </div>
                </div>
            </div>
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
            onDirectUpdate={onDirectUpdate}
          />
        </div>
      )}

      {/* Contenido de la pestaña Administradores */}
      {activeTab === 'admins' && (
        <div>
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 sm:mb-6">
            <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-3 sm:mb-0">
              <i className="bi bi-people me-2"></i>Administradores
            </h2>
            {onAddAdmin && (
              <button
                onClick={onAddAdmin}
                className="w-full sm:w-auto bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors text-sm sm:text-base"
              >
                <i className="bi bi-person-plus me-2"></i>
                Agregar Administrador
              </button>
            )}
          </div>

          {/* Lista de administradores */}
          <div className="bg-white rounded-lg shadow-md overflow-hidden">
            <div className="px-4 sm:px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">
                Propietario y Administradores
              </h3>
              <p className="text-sm text-gray-500 mt-1">
                Gestiona quién puede administrar tu tienda
              </p>
            </div>

            <div className="divide-y divide-gray-200">
              {/* Propietario */}
              <div className="px-4 sm:px-6 py-4">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center">
                  <div className="flex items-center mb-3 sm:mb-0">
                    <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0">
                      <i className="bi bi-crown text-red-600"></i>
                    </div>
                    <div className="ml-3">
                      <p className="text-sm font-medium text-gray-900">{displayBusiness.email}</p>
                      <p className="text-sm text-gray-500">Propietario</p>
                    </div>
                  </div>
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                    Todos los permisos
                  </span>
                </div>
              </div>

              {/* Administradores */}
              {displayBusiness.administrators && displayBusiness.administrators.length > 0 ? (
                displayBusiness.administrators.map((admin, index) => (
                  <div key={index} className="px-4 sm:px-6 py-4">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center">
                      <div className="flex items-center mb-3 sm:mb-0">
                        <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                          <i className="bi bi-person text-blue-600"></i>
                        </div>
                        <div className="ml-3">
                          <p className="text-sm font-medium text-gray-900">{admin.email}</p>
                          <p className="text-sm text-gray-500 capitalize">{admin.role}</p>
                        </div>
                      </div>
                      <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-2">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                          {admin.role === 'admin' ? 'Administrador' : 'Gerente'}
                        </span>
                        {onRemoveAdmin && (
                          <button
                            onClick={() => onRemoveAdmin(admin.email)}
                            className="text-red-600 hover:text-red-700 text-sm"
                          >
                            <i className="bi bi-trash me-1"></i>
                            Remover
                          </button>
                        )}
                        {userRole === 'owner' && onTransferOwnership && (
                          <button
                            onClick={() => onTransferOwnership(admin)}
                            className="text-orange-600 hover:text-orange-700 text-sm flex items-center"
                            title="Convertir en dueño del negocio"
                          >
                            <i className="bi bi-crown me-1"></i>
                            Transferir Propiedad
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Permisos */}
                    <div className="mt-3 sm:ml-13">
                      <p className="text-xs text-gray-500 mb-2">Permisos:</p>
                      <div className="flex flex-wrap gap-1">
                        {admin.permissions.manageProducts && (
                          <span className="inline-flex items-center px-2 py-1 rounded text-xs bg-green-100 text-green-800">
                            Productos
                          </span>
                        )}
                        {admin.permissions.manageOrders && (
                          <span className="inline-flex items-center px-2 py-1 rounded text-xs bg-green-100 text-green-800">
                            Pedidos
                          </span>
                        )}
                        {admin.permissions.viewReports && (
                          <span className="inline-flex items-center px-2 py-1 rounded text-xs bg-green-100 text-green-800">
                            Reportes
                          </span>
                        )}
                        {admin.permissions.editBusiness && (
                          <span className="inline-flex items-center px-2 py-1 rounded text-xs bg-green-100 text-green-800">
                            Editar Tienda
                          </span>
                        )}
                        {admin.permissions.manageAdmins && (
                          <span className="inline-flex items-center px-2 py-1 rounded text-xs bg-green-100 text-green-800">
                            Administradores
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="px-4 sm:px-6 py-8 text-center">
                  <i className="bi bi-people text-gray-400 text-4xl mb-4"></i>
                  <p className="text-gray-500">No hay administradores adicionales</p>
                  <p className="text-sm text-gray-400 mt-1">
                    Agrega administradores para que te ayuden a gestionar tu tienda
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {/* Contenido de la pestaña Fidelización */}
      {activeTab === 'fidelizacion' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          {/* Sub-tabs header */}
          <div className="flex border-b border-gray-200">
            <button
              onClick={() => setFidelizacionSubTab('automatic')}
              className={`flex-1 py-4 text-sm font-medium text-center transition-colors border-b-2 ${fidelizacionSubTab === 'automatic'
                  ? 'border-red-500 text-red-600 bg-red-50/50'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }`}
            >
              <i className="bi bi-gift me-2"></i>
              Premio Automático
            </button>
            <button
              onClick={() => setFidelizacionSubTab('qr')}
              className={`flex-1 py-4 text-sm font-medium text-center transition-colors border-b-2 ${fidelizacionSubTab === 'qr'
                  ? 'border-red-500 text-red-600 bg-red-50/50'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }`}
            >
              <i className="bi bi-qr-code me-2"></i>
              Códigos QR
            </button>
          </div>

          <div className="p-6">
            {/* Contenido Premio Automático */}
            {fidelizacionSubTab === 'automatic' && (
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

                {isEditingProfile ? (
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
                ) : (
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
            )}

            {/* Contenido Códigos QR */}
            {fidelizacionSubTab === 'qr' && (
              <QRCodesContent businessId={business.id} />
            )}
          </div>
        </div>
      )}

      {/* Contenido de la pestaña Notificaciones */}
      {activeTab === 'notifications' && (
        <NotificationSettings
          business={business}
          onBusinessFieldChange={onDirectUpdate || onBusinessFieldChange}
        />
      )}
    </div>
  )
}
