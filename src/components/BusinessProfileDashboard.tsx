'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import { Business, Product, Ingredient, CoverageZone } from '@/types'
import { getIngredientLibrary, addOrUpdateIngredientInLibrary, IngredientLibraryItem, uploadImage, getCoverageZonesByGroup } from '@/lib/database'
import ProductList from './ProductList'
import NotificationSettings from './NotificationSettings'
import PrintSettings from './PrintSettings'
import ConfiguracionView from './ConfiguracionView'
import { GoogleMap, useCurrentLocation } from './GoogleMap'
import QRCodesContent from '@/app/business/qr-codes/qr-codes-content'
import BranchManagementView from './BranchManagementView'
import { auth } from '@/lib/firebase'

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
  initialTab?: 'general' | 'products' | 'fidelizacion' | 'notifications' | 'admins' | 'configuracion' | 'sucursales'
  onDirectUpdate?: (field: keyof Business, value: any) => Promise<void>
  onSwitchBusiness?: (businessId: string) => void
  // Props para gestión de administradores (opcionales)
  onAddAdmin?: () => void
  onRemoveAdmin?: (email: string) => void
  onEditAdminPassword?: (email: string) => void
  onTransferOwnership?: (admin: any) => void
  userRole?: 'owner' | 'admin' | 'manager' | null
  printMode?: 'standard' | 'bluetooth'
  onTogglePrintMode?: () => void
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
  onSwitchBusiness,
  onAddAdmin,
  onRemoveAdmin,
  onEditAdminPassword,
  onTransferOwnership,
  userRole,
  printMode,
  onTogglePrintMode
}: BusinessProfileDashboardProps) {
  const [coverLoaded, setCoverLoaded] = useState(false)
  const [logoLoaded, setLogoLoaded] = useState(false)
  const [activeTab, setActiveTab] = useState<'general' | 'products' | 'fidelizacion' | 'notifications' | 'admins' | 'configuracion' | 'sucursales'>(initialTab)
  const [fidelizacionSubTab, setFidelizacionSubTab] = useState<'automatic' | 'qr' | 'delivery'>('automatic')

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

  // Estados para la campaña de delivery gratis
  const [groupZones, setGroupZones] = useState<CoverageZone[]>([])
  const [loadingGroupZones, setLoadingGroupZones] = useState(false)
  const [deliveryCampaignForm, setDeliveryCampaignForm] = useState({
    isActive: business?.freeDeliveryCampaign?.isActive ?? false,
    startDate: business?.freeDeliveryCampaign?.startDate ?? '',
    endDate: business?.freeDeliveryCampaign?.endDate ?? '',
    applicableZoneIds: business?.freeDeliveryCampaign?.applicableZoneIds ?? [],
    minimumOrderAmount: business?.freeDeliveryCampaign?.minimumOrderAmount ?? 0,
  })
  const [savingCampaign, setSavingCampaign] = useState(false)
  const [campaignSaved, setCampaignSaved] = useState(false)



  useEffect(() => {
    if (business?.id && activeTab === 'fidelizacion') {
      getIngredientLibrary(business.id).then(lib => setIngredientLibrary(lib))
    }
  }, [business?.id, activeTab])

  // Cargar zonas del grupo del restaurante cuando se abre el sub-tab
  useEffect(() => {
    if (activeTab === 'fidelizacion' && fidelizacionSubTab === 'delivery' && business?.groupId) {
      setLoadingGroupZones(true)
      getCoverageZonesByGroup(business.groupId)
        .then(zones => setGroupZones(zones))
        .finally(() => setLoadingGroupZones(false))
    }
  }, [activeTab, fidelizacionSubTab, business?.groupId])

  // Sincronizar formulario cuando cambia el negocio
  useEffect(() => {
    setDeliveryCampaignForm({
      isActive: business?.freeDeliveryCampaign?.isActive ?? false,
      startDate: business?.freeDeliveryCampaign?.startDate ?? '',
      endDate: business?.freeDeliveryCampaign?.endDate ?? '',
      applicableZoneIds: business?.freeDeliveryCampaign?.applicableZoneIds ?? [],
      minimumOrderAmount: business?.freeDeliveryCampaign?.minimumOrderAmount ?? 0,
    })
  }, [business?.id])


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
  const configuredDeliveryTime = displayBusiness.defaultDeliveryTime ?? displayBusiness.deliveryTime ?? 30

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
                                            {!displayBusiness.pickupSettings?.enabled 
                                                ? 'Desactivado' 
                                                : displayBusiness.pickupSettings.restrictToPrevious 
                                                    ? 'Solo recurrentes' 
                                                    : 'Habilitado'}
                                        </p>
                                        {displayBusiness.pickupSettings?.enabled && (
                                            <span className="text-[9px] font-black text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-100">
                                                {displayBusiness.pickupSettings.restrictToPrevious ? 'RESTRINGIDO' : 'ACTIVO'}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-2xl border border-gray-100/50">
                                <i className="bi bi-clock-history text-purple-500 text-lg"></i>
                                <div>
                                    <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Tiempo de Entrega</p>
                                    <p className="text-sm font-bold text-gray-900">{configuredDeliveryTime} minutos</p>
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
            onBusinessChange={onSwitchBusiness}
            products={products}
            categories={categories}
            onProductsChange={onProductsChange}
            onCategoriesChange={onCategoriesChange}
            onDirectUpdate={onDirectUpdate}
          />
        </div>
      )}

      {/* Contenido de la pestaña Fidelización */}
      {activeTab === 'fidelizacion' && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          {/* Sub-tabs Header Bar */}
          <div className="bg-gray-50/80 p-2 border-b border-gray-100 flex flex-col sm:flex-row gap-2">
            <button
              onClick={() => setFidelizacionSubTab('automatic')}
              className={`flex-1 py-3 px-4 rounded-xl text-sm font-bold tracking-tight transition-all duration-200 flex items-center justify-center gap-2.5 ${
                fidelizacionSubTab === 'automatic'
                  ? 'bg-white text-rose-600 shadow-md shadow-gray-200/50 border border-gray-200/60'
                  : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100/60'
              }`}
            >
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm transition-colors ${
                fidelizacionSubTab === 'automatic' ? 'bg-rose-100/80 text-rose-600' : 'bg-gray-100 text-gray-400'
              }`}>
                <i className="bi bi-gift"></i>
              </div>
              <span>Premio Automático</span>
            </button>
            
            <button
              onClick={() => setFidelizacionSubTab('qr')}
              className={`flex-1 py-3 px-4 rounded-xl text-sm font-bold tracking-tight transition-all duration-200 flex items-center justify-center gap-2.5 ${
                fidelizacionSubTab === 'qr'
                  ? 'bg-white text-rose-600 shadow-md shadow-gray-200/50 border border-gray-200/60'
                  : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100/60'
              }`}
            >
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm transition-colors ${
                fidelizacionSubTab === 'qr' ? 'bg-rose-100/80 text-rose-600' : 'bg-gray-100 text-gray-400'
              }`}>
                <i className="bi bi-qr-code"></i>
              </div>
              <span>Códigos QR</span>
            </button>

            <button
              onClick={() => setFidelizacionSubTab('delivery')}
              className={`flex-1 py-3 px-4 rounded-xl text-sm font-bold tracking-tight transition-all duration-200 flex items-center justify-center gap-2.5 ${
                fidelizacionSubTab === 'delivery'
                  ? 'bg-white text-rose-600 shadow-md shadow-gray-200/50 border border-gray-200/60'
                  : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100/60'
              }`}
            >
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm transition-colors ${
                fidelizacionSubTab === 'delivery' ? 'bg-rose-100/80 text-rose-600' : 'bg-gray-100 text-gray-400'
              }`}>
                <i className="bi bi-truck"></i>
              </div>
              <span>Delivery Gratis</span>
            </button>
          </div>

          <div className="p-6 md:p-8">
            {/* Contenido Premio Automático */}
            {fidelizacionSubTab === 'automatic' && (
              <div className="max-w-2xl mx-auto">
                {/* Hero Header */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-6 border-b border-gray-100 mb-6">
                  <div className="flex items-center gap-3.5">
                    <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center text-xl shadow-sm border border-rose-100/60 flex-shrink-0">
                      <i className="bi bi-gift-fill"></i>
                    </div>
                    <div>
                      <h3 className="text-xl font-black text-gray-900 tracking-tight">Premio Automático</h3>
                      <p className="text-xs font-medium text-gray-500 leading-relaxed mt-0.5">Configura un regalo que se agregará automáticamente al carrito de tus clientes.</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end flex-wrap">
                    {/* Toggle Switch */}
                    <button
                      type="button"
                      onClick={() => {
                        const currentSettings = displayBusiness.rewardSettings || { enabled: false, name: '', description: '' };
                        onBusinessFieldChange('rewardSettings', { ...currentSettings, enabled: !currentSettings.enabled });
                      }}
                      className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border transition-all cursor-pointer flex-shrink-0 ${
                        displayBusiness.rewardSettings?.enabled
                          ? 'bg-rose-50/80 border-rose-200 text-rose-700 shadow-sm'
                          : 'bg-gray-50 border-gray-200 text-gray-500'
                      }`}
                    >
                      <span className="text-[11px] font-bold uppercase tracking-wider">
                        {displayBusiness.rewardSettings?.enabled ? 'ACTIVADO' : 'DESACTIVADO'}
                      </span>
                      <div className={`relative inline-block w-8 h-4.5 rounded-full transition-colors duration-200 ${
                        displayBusiness.rewardSettings?.enabled ? 'bg-rose-500' : 'bg-gray-300'
                      }`}>
                        <div className={`absolute top-0.5 left-0.5 w-3.5 h-3.5 bg-white rounded-full transition-transform duration-200 shadow-sm ${
                          displayBusiness.rewardSettings?.enabled ? 'translate-x-3.5' : ''
                        }`}></div>
                      </div>
                    </button>

                    {/* Botón Editar / Guardar / Cancelar en el Header */}
                    {isEditingProfile ? (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={onCancelEdit}
                          className="px-3 py-2 border border-gray-200 text-gray-600 rounded-xl hover:bg-gray-100 font-bold text-xs transition-colors flex items-center gap-1.5"
                        >
                          <i className="bi bi-x-circle text-xs"></i>
                          Cancelar
                        </button>
                        <button
                          type="button"
                          onClick={onSaveProfile}
                          className="px-3.5 py-2 bg-gradient-to-r from-rose-500 to-red-600 hover:from-rose-600 hover:to-red-700 text-white rounded-xl font-bold text-xs transition-all shadow-md shadow-rose-500/20 active:scale-95 flex items-center gap-1.5"
                        >
                          <i className="bi bi-check2 text-xs"></i>
                          Guardar
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={onEditProfile}
                        className="px-3.5 py-2 bg-gradient-to-r from-rose-500 to-red-600 hover:from-rose-600 hover:to-red-700 text-white rounded-xl font-bold text-xs transition-all shadow-md shadow-rose-500/20 active:scale-95 flex items-center gap-1.5"
                      >
                        <i className="bi bi-pencil-square text-xs"></i>
                        Editar Configuración
                      </button>
                    )}
                  </div>
                </div>

                {!isEditingProfile ? (
                  /* VISTA RESUMEN (SOLO LECTURA) */
                  <div className="space-y-6">
                    <div className="bg-gradient-to-br from-rose-50/40 via-white to-gray-50/40 p-6 rounded-2xl border border-rose-100/80 shadow-sm relative overflow-hidden">
                      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
                        <div>
                          <span className="text-[10px] font-black uppercase tracking-widest text-rose-600 bg-rose-100/80 px-2.5 py-1 rounded-full border border-rose-200/60 inline-block mb-2">
                            Premio Configurado
                          </span>
                          <h4 className="text-xl font-black text-gray-900 tracking-tight">
                            {displayBusiness.rewardSettings?.name || 'Sin nombre de premio configurado'}
                          </h4>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1.5 ${
                            displayBusiness.rewardSettings?.enabled
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : 'bg-gray-100 text-gray-500 border border-gray-200'
                          }`}>
                            <span className={`w-2 h-2 rounded-full ${displayBusiness.rewardSettings?.enabled ? 'bg-emerald-500 animate-pulse' : 'bg-gray-400'}`}></span>
                            {displayBusiness.rewardSettings?.enabled ? 'Activo en Carrito' : 'Inactivo'}
                          </span>
                        </div>
                      </div>

                      {displayBusiness.rewardSettings?.description ? (
                        <p className="text-xs text-gray-600 font-medium leading-relaxed bg-white/90 p-3.5 rounded-xl border border-gray-100">
                          {displayBusiness.rewardSettings.description}
                        </p>
                      ) : (
                        <p className="text-xs text-gray-400 font-medium italic">Sin descripción registrada.</p>
                      )}

                      {/* Insumos Asociados */}
                      <div className="mt-5 pt-4 border-t border-rose-100/60">
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-xs font-bold text-gray-700 uppercase tracking-wider flex items-center gap-1.5">
                            <i className="bi bi-box-seam text-rose-500"></i> Insumos incluidos ({(displayBusiness.rewardSettings?.ingredients || []).length})
                          </span>
                          <span className="text-xs font-black text-rose-600 bg-rose-50 px-2.5 py-1 rounded-full border border-rose-100">
                            Costo Total: ${calculateTotalRewardIngredientCost().toFixed(2)}
                          </span>
                        </div>

                        {(displayBusiness.rewardSettings?.ingredients || []).length === 0 ? (
                          <div className="p-3 bg-gray-50/60 rounded-xl border border-dashed border-gray-200 text-center">
                            <p className="text-xs text-gray-400 font-medium">No hay insumos ni ingredientes asignados a este premio.</p>
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {(displayBusiness.rewardSettings?.ingredients || []).map((ing, idx) => (
                              <div key={ing.id || idx} className="bg-white p-3 rounded-xl border border-gray-100 shadow-2xs flex justify-between items-center text-xs">
                                <span className="font-bold text-gray-800">{ing.name}</span>
                                <span className="text-gray-500 font-medium">
                                  {ing.quantity} u. (<strong className="text-rose-600">${(ing.quantity * ing.unitCost).toFixed(2)}</strong>)
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Info Callout */}
                    <div className="p-4 bg-amber-50/80 rounded-2xl border border-amber-200/60 flex gap-3 text-amber-900 text-xs">
                      <i className="bi bi-info-circle-fill text-amber-500 text-base flex-shrink-0 mt-0.5"></i>
                      <p className="font-medium leading-relaxed">
                        Este premio aparecerá automáticamente en el carrito del cliente con precio de <strong>$0.00</strong>. Para modificar los datos o cambiar insumos, haz clic en el botón <strong>Editar Configuración</strong> en la barra superior.
                      </p>
                    </div>
                  </div>
                ) : (
                  /* VISTA FORMULARIO DE EDICIÓN */
                  <div className={`space-y-6 transition-opacity duration-200 ${displayBusiness.rewardSettings?.enabled ? 'opacity-100' : 'opacity-50 pointer-events-none'}`}>
                    <div>
                      <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Nombre del Premio</label>
                      <div className="relative">
                        <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-rose-500 text-base">🎁</span>
                        <input
                          type="text"
                          placeholder="Ej: 5 wantancitos gratis por compras sobre $15"
                          value={displayBusiness.rewardSettings?.name || ''}
                          onChange={(e) => {
                            const currentSettings = displayBusiness.rewardSettings || { enabled: false, name: '', description: '' };
                            onBusinessFieldChange('rewardSettings', { ...currentSettings, name: e.target.value });
                          }}
                          className="w-full pl-10 pr-4 py-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:border-rose-500 focus:ring-4 focus:ring-rose-500/10 font-bold text-sm text-gray-900 transition-all shadow-sm"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Descripción (opcional)</label>
                      <textarea
                        placeholder="Ej: ¡Felicidades! Has reclamado tu premio especial totalmente gratis."
                        value={displayBusiness.rewardSettings?.description || ''}
                        onChange={(e) => {
                          const currentSettings = displayBusiness.rewardSettings || { enabled: false, name: '', description: '' };
                          onBusinessFieldChange('rewardSettings', { ...currentSettings, description: e.target.value });
                        }}
                        className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl focus:outline-none focus:border-rose-500 focus:ring-4 focus:ring-rose-500/10 font-medium text-sm text-gray-800 transition-all shadow-sm"
                        rows={3}
                      />
                    </div>

                    {/* Sección de Ingredientes y Costos del Premio */}
                    <div className="mt-8 pt-6 border-t border-gray-100">
                      <div className="flex items-center justify-between mb-4">
                        <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                          <i className="bi bi-box-seam text-rose-500"></i>
                          Ingredientes y Costos del Premio
                        </h4>
                        <div className="flex items-center gap-2 bg-rose-50/80 px-3 py-1.5 rounded-full border border-rose-100">
                          <span className="text-xs font-medium text-gray-600">Costo total premio:</span>
                          <span className="text-xs font-black text-rose-600">
                            ${calculateTotalRewardIngredientCost().toFixed(2)}
                          </span>
                        </div>
                      </div>

                      {/* Formulario para agregar ingrediente */}
                      <div className="bg-gray-50/70 p-4.5 rounded-2xl border border-dashed border-gray-200 mb-6 space-y-3.5">
                        <h5 className="text-[11px] font-bold text-gray-600 uppercase tracking-wider flex items-center gap-1.5">
                          <i className="bi bi-plus-circle-fill text-rose-500 text-xs"></i>
                          Agregar Insumo de la Base
                        </h5>
                        
                        <div className="relative reward-ingredient-input-container">
                          <div className="relative">
                            <i className="bi bi-search absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs"></i>
                            <input
                              type="text"
                              name="name"
                              placeholder="Buscar o escribir insumo..."
                              value={currentRewardIngredient.name}
                              onChange={handleRewardIngredientChange}
                              onFocus={() => setShowRewardIngredientSuggestions(true)}
                              autoComplete="off"
                              className="w-full pl-9 pr-4 py-2.5 text-xs bg-white border border-gray-200 rounded-xl focus:outline-none focus:border-rose-500 font-bold transition-all shadow-sm"
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
                                    className="w-full px-4 py-2.5 text-left text-xs hover:bg-rose-50/60 border-b border-gray-50 last:border-b-0 transition-all flex justify-between items-center"
                                  >
                                    <span className="font-bold text-gray-700">{ing.name}</span>
                                    <span className="text-rose-600 font-black">${ing.unitCost.toFixed(2)}</span>
                                  </button>
                                ))
                              ) : currentRewardIngredient.name.trim() !== '' && (
                                <button
                                  type="button"
                                  onClick={() => setShowRewardIngredientSuggestions(false)}
                                  className="w-full text-left px-4 py-3 bg-rose-50 hover:bg-rose-100/80 text-xs font-bold text-rose-700 transition-all flex items-center gap-2"
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
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs font-bold">$</span>
                            <input
                              type="number"
                              name="unitCost"
                              step="0.01"
                              placeholder="Costo unitario"
                              value={currentRewardIngredient.unitCost}
                              onChange={handleRewardIngredientChange}
                              className="w-full pl-7 pr-3 py-2.5 text-xs bg-white border border-gray-200 rounded-xl focus:outline-none focus:border-rose-500 font-bold transition-all"
                            />
                          </div>
                          <input
                            type="number"
                            name="quantity"
                            step="0.1"
                            placeholder="Cantidad"
                            value={currentRewardIngredient.quantity}
                            onChange={handleRewardIngredientChange}
                            className="w-full px-3 py-2.5 text-xs bg-white border border-gray-200 rounded-xl focus:outline-none focus:border-rose-500 font-bold transition-all"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={addRewardIngredient}
                          disabled={!currentRewardIngredient.name.trim()}
                          className="w-full bg-gradient-to-r from-rose-500 to-red-600 hover:from-rose-600 hover:to-red-700 text-white px-4 py-2.5 text-xs rounded-xl transition-all font-black uppercase tracking-wider shadow-md shadow-rose-500/15 disabled:opacity-40"
                        >
                          Agregar al Premio
                        </button>
                      </div>

                      {/* Lista de ingredientes agregados */}
                      <div className="space-y-2">
                        {(displayBusiness.rewardSettings?.ingredients || []).length === 0 ? (
                          <div className="text-center py-4 bg-gray-50/60 rounded-xl border border-dashed border-gray-200">
                            <p className="text-xs font-medium text-gray-400">No hay ingredientes definidos para este premio.</p>
                          </div>
                        ) : (
                          (displayBusiness.rewardSettings?.ingredients || []).map((ing, idx) => (
                            <div key={ing.id || idx} className="flex items-center justify-between p-3 bg-gray-50/80 rounded-xl border border-gray-100 hover:bg-gray-100/60 transition-colors group">
                              <div className="flex flex-col">
                                <span className="text-xs font-bold text-gray-900">{ing.name}</span>
                                <span className="text-[11px] text-gray-500 font-medium">
                                  {ing.quantity} x ${ing.unitCost.toFixed(2)} = <strong className="text-rose-600">${(ing.quantity * ing.unitCost).toFixed(2)}</strong>
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() => removeRewardIngredient(ing.id || (ing as any).id)}
                                className="p-1.5 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                                title="Eliminar ingrediente"
                              >
                                <i className="bi bi-trash text-xs"></i>
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="p-4 bg-amber-50/80 rounded-2xl border border-amber-200/60">
                      <div className="flex gap-3">
                        <i className="bi bi-info-circle-fill text-amber-500 text-base flex-shrink-0 mt-0.5"></i>
                        <p className="text-xs text-amber-900 font-medium leading-relaxed">
                          Este premio aparecerá automáticamente en el carrito del cliente con un precio de <strong>$0.00</strong>. Asegúrate de contar con insumos suficientes en cocina.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Contenido Códigos QR */}
            {fidelizacionSubTab === 'qr' && (
              <QRCodesContent businessId={business.id} embedded={true} />
            )}

            {/* Contenido Delivery Gratis */}
            {fidelizacionSubTab === 'delivery' && (
              <div className="max-w-2xl mx-auto">
                {/* Hero Header */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-6 border-b border-gray-100 mb-6">
                  <div className="flex items-center gap-3.5">
                    <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center text-xl shadow-sm border border-rose-100/60 flex-shrink-0">
                      <i className="bi bi-truck"></i>
                    </div>
                    <div>
                      <h3 className="text-xl font-black text-gray-900 tracking-tight">Campaña de Delivery Gratis</h3>
                      <p className="text-xs font-medium text-gray-500 leading-relaxed mt-0.5">El restaurante asume el costo de envío. El repartidor recibe su pago normal.</p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setDeliveryCampaignForm(prev => ({ ...prev, isActive: !prev.isActive }))}
                    className={`flex items-center gap-3 px-3.5 py-2 rounded-2xl border transition-all cursor-pointer flex-shrink-0 ${
                      deliveryCampaignForm.isActive
                        ? 'bg-emerald-50/80 border-emerald-200 text-emerald-700 shadow-sm'
                        : 'bg-gray-50 border-gray-200 text-gray-500'
                    }`}
                  >
                    <span className="text-xs font-bold uppercase tracking-wider">
                      {deliveryCampaignForm.isActive ? 'ACTIVADA' : 'DESACTIVADA'}
                    </span>
                    <div className={`relative inline-block w-9 h-5 rounded-full transition-colors duration-200 ${
                      deliveryCampaignForm.isActive ? 'bg-emerald-500' : 'bg-gray-300'
                    }`}>
                      <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform duration-200 shadow-sm ${
                        deliveryCampaignForm.isActive ? 'translate-x-4' : ''
                      }`}></div>
                    </div>
                  </button>
                </div>

                <div className={`space-y-6 transition-opacity duration-200 ${deliveryCampaignForm.isActive ? 'opacity-100' : 'opacity-50 pointer-events-none'}`}>
                  {/* Fechas de la campaña */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Fecha de inicio (opcional)</label>
                      <input
                        type="date"
                        value={deliveryCampaignForm.startDate}
                        onChange={e => setDeliveryCampaignForm(prev => ({ ...prev, startDate: e.target.value }))}
                        className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl focus:outline-none focus:border-rose-500 focus:ring-4 focus:ring-rose-500/10 font-bold text-xs text-gray-800 transition-all shadow-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Fecha de fin (opcional)</label>
                      <input
                        type="date"
                        value={deliveryCampaignForm.endDate}
                        onChange={e => setDeliveryCampaignForm(prev => ({ ...prev, endDate: e.target.value }))}
                        className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl focus:outline-none focus:border-rose-500 focus:ring-4 focus:ring-rose-500/10 font-bold text-xs text-gray-800 transition-all shadow-sm"
                      />
                    </div>
                  </div>

                  {/* Monto mínimo de compra */}
                  <div>
                    <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">Monto mínimo de compra (0 = sin mínimo)</label>
                    <div className="relative">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-sm">$</span>
                      <input
                        type="number"
                        min="0"
                        step="0.50"
                        value={deliveryCampaignForm.minimumOrderAmount}
                        onChange={e => setDeliveryCampaignForm(prev => ({ ...prev, minimumOrderAmount: parseFloat(e.target.value) || 0 }))}
                        className="w-full pl-8 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl focus:outline-none focus:border-rose-500 focus:ring-4 focus:ring-rose-500/10 font-bold text-xs text-gray-900 transition-all shadow-sm"
                      />
                    </div>
                  </div>

                  {/* Zonas aplicables */}
                  <div>
                    <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2 flex items-center justify-between">
                      <span>Zonas donde aplica</span>
                      <span className="text-gray-400 font-medium normal-case text-[11px]">(vacío = aplica a todas las zonas)</span>
                    </label>

                    {!business?.groupId ? (
                      <div className="p-4 bg-amber-50/80 border border-amber-200/80 rounded-xl text-xs text-amber-900 font-medium flex items-center gap-2">
                        <i className="bi bi-exclamation-triangle text-amber-600 text-sm"></i>
                        Este restaurante no tiene un grupo de cobertura asignado. Asigna un grupo desde el panel de administración.
                      </div>
                    ) : loadingGroupZones ? (
                      <div className="flex items-center gap-2 py-4 text-gray-500 text-xs font-bold">
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-rose-500"></div>
                        Cargando zonas...
                      </div>
                    ) : groupZones.length === 0 ? (
                      <div className="p-4 bg-gray-50 border border-gray-200/80 rounded-xl text-xs text-gray-500 font-medium">
                        No hay zonas configuradas para el grupo de este restaurante.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {groupZones.map(zone => {
                          const isChecked = deliveryCampaignForm.applicableZoneIds.includes(zone.id)
                          return (
                            <label
                              key={zone.id}
                              className={`flex items-center gap-3 p-3.5 rounded-xl border cursor-pointer transition-all ${
                                isChecked
                                  ? 'border-rose-300 bg-rose-50/40 text-rose-900 shadow-sm'
                                  : 'border-gray-200 bg-white hover:border-gray-300'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {
                                  setDeliveryCampaignForm(prev => ({
                                    ...prev,
                                    applicableZoneIds: isChecked
                                      ? prev.applicableZoneIds.filter(id => id !== zone.id)
                                      : [...prev.applicableZoneIds, zone.id]
                                  }))
                                }}
                                className="w-4 h-4 text-rose-600 rounded focus:ring-rose-500 border-gray-300"
                              />
                              <div className="flex-1 flex items-center justify-between">
                                <span className="text-xs font-bold text-gray-800">{zone.name}</span>
                                {zone.deliveryFee > 0 && (
                                  <span className="text-[11px] text-gray-500 font-medium">${zone.deliveryFee.toFixed(2)}</span>
                                )}
                              </div>
                              {isChecked && <i className="bi bi-check-circle-fill text-rose-500 text-sm"></i>}
                            </label>
                          )
                        })}
                      </div>
                    )}
                  </div>

                  {/* Info Callout */}
                  <div className="p-4 bg-emerald-50/80 rounded-2xl border border-emerald-200/60">
                    <div className="flex gap-3">
                      <i className="bi bi-info-circle-fill text-emerald-600 text-base flex-shrink-0 mt-0.5"></i>
                      <p className="text-xs text-emerald-900 font-medium leading-relaxed">
                        Los clientes verán el costo de envío <strong>tachado</strong> y un <strong>$0.00</strong> promocional. El repartidor sigue recibiendo su tarifa habitual asumida por el negocio.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Botón Guardar */}
                <div className="mt-8 pt-6 border-t border-gray-100">
                  {campaignSaved && (
                    <p className="text-emerald-600 text-xs font-bold text-center mb-3 flex items-center justify-center gap-1.5">
                      <i className="bi bi-check-circle-fill"></i> Campaña guardada exitosamente
                    </p>
                  )}
                  <button
                    onClick={async () => {
                      if (!onDirectUpdate) return
                      setSavingCampaign(true)
                      setCampaignSaved(false)
                      try {
                        await onDirectUpdate('freeDeliveryCampaign', deliveryCampaignForm)
                        setCampaignSaved(true)
                        setTimeout(() => setCampaignSaved(false), 3000)
                      } catch (e) {
                        alert('Error al guardar la campaña')
                      } finally {
                        setSavingCampaign(false)
                      }
                    }}
                    disabled={savingCampaign || !onDirectUpdate}
                    className="w-full py-3.5 bg-gradient-to-r from-rose-500 to-red-600 hover:from-rose-600 hover:to-red-700 text-white rounded-xl font-bold text-xs transition-all shadow-lg shadow-rose-500/20 active:scale-98 flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {savingCampaign ? (
                      <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div> Guardando...</>
                    ) : (
                      <><i className="bi bi-check2-circle text-sm"></i> Guardar Configuración de Campaña</>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Contenido de la pestaña Sucursales */}
      {activeTab === 'sucursales' && (
        <BranchManagementView
          currentBusiness={business}
          onSwitchBusiness={onSwitchBusiness}
          userRole={userRole}
        />
      )}

      {/* Contenido de la pestaña Configuración (Notificaciones e Impresión) */}
      {(activeTab === 'configuracion' || activeTab === 'notifications') && (
        <ConfiguracionView
          business={business}
          onBusinessFieldChange={onDirectUpdate || onBusinessFieldChange}
          printMode={printMode}
          onTogglePrintMode={onTogglePrintMode}
          initialConfigSubTab={activeTab === 'notifications' ? 'notifications' : 'notifications'}
        />
      )}
    </div>
  )
}
