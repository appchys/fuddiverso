"use client"

import React, { useState, useEffect } from 'react'
import { Business, Delivery, CoverageGroup } from '@/types'
import { uploadImage, searchDeliveryByPhone, createDelivery, getDeliveryById, getCoverageGroups, getCoverageZoneForLocation, getDeliveriesByBusiness, linkDeliveryToBusiness, unlinkDeliveryFromBusiness } from '@/lib/database'
import { optimizeImage } from '@/lib/image-utils'
import { GoogleMap, useCurrentLocation } from './GoogleMap'

interface BusinessProfileEditorProps {
    business: Business
    onSave: (updatedBusiness: Partial<Business>) => Promise<void>
    onCancel: () => void
    saving?: boolean
}

export const BusinessProfileEditor: React.FC<BusinessProfileEditorProps> = ({
    business,
    onSave,
    onCancel,
    saving = false
}) => {
    const [formData, setFormData] = useState({
        name: business.name || '',
        username: business.username || '',
        description: business.description || '',
        phone: business.phone || '',
        email: business.email || '',
        category: business.category || '',
        businessType: (business.businessType || 'food_store') as 'food_store' | 'distributor',
        isActive: business.isActive ?? true,
        isHidden: business.isHidden ?? false,
        deliveryTime: business.defaultDeliveryTime ?? business.deliveryTime ?? 30,
        defaultDeliveryId: business.defaultDeliveryId || '',
        groupId: business.groupId || '',
        zoneId: business.zoneId || '',
        pickupSettings: business.pickupSettings 
            ? { restrictToPrevious: false, ...business.pickupSettings } 
            : { enabled: false, restrictToPrevious: false, references: '', latlong: '', storePhotoUrl: '' }
    })

    const [coverageGroups, setCoverageGroups] = useState<CoverageGroup[]>([])

    const [schedule, setSchedule] = useState(business.schedule || {
        monday: { open: '09:00', close: '18:00', isOpen: true },
        tuesday: { open: '09:00', close: '18:00', isOpen: true },
        wednesday: { open: '09:00', close: '18:00', isOpen: true },
        thursday: { open: '09:00', close: '18:00', isOpen: true },
        friday: { open: '09:00', close: '18:00', isOpen: true },
        saturday: { open: '09:00', close: '18:00', isOpen: true },
        sunday: { open: '09:00', close: '18:00', isOpen: false }
    })

    const [logoPreview, setLogoPreview] = useState<string | null>(business.image || null)
    const [coverPreview, setCoverPreview] = useState<string | null>(business.coverImage || null)
    const [newLogo, setNewLogo] = useState<File | null>(null)
    const [newCover, setNewCover] = useState<File | null>(null)
    const [uploadingLogo, setUploadingLogo] = useState(false)
    const [uploadingCover, setUploadingCover] = useState(false)
    const [dragActiveLogo, setDragActiveLogo] = useState(false)
    const [dragActiveCover, setDragActiveCover] = useState(false)
    const [dragActivePickup, setDragActivePickup] = useState(false)
    const [uploadingPickupPhoto, setUploadingPickupPhoto] = useState(false)
    const [activeSection, setActiveSection] = useState<'identity' | 'contact' | 'visual' | 'schedule' | 'delivery_pickup'>('identity')

    const { location: currentGeoLocation, loading: locating, getCurrentLocation } = useCurrentLocation()

    const days = [
        { key: 'monday', label: 'Lunes' },
        { key: 'tuesday', label: 'Martes' },
        { key: 'wednesday', label: 'Miércoles' },
        { key: 'thursday', label: 'Jueves' },
        { key: 'friday', label: 'Viernes' },
        { key: 'saturday', label: 'Sábado' },
        { key: 'sunday', label: 'Domingo' }
    ]

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        const { name, value } = e.target
        setFormData(prev => ({ ...prev, [name]: value }))
    }

    const handleLogoChange = (file: File) => {
        setNewLogo(file)
        setLogoPreview(URL.createObjectURL(file))
    }

    const handleCoverChange = (file: File) => {
        setNewCover(file)
        setCoverPreview(URL.createObjectURL(file))
    }

    const handleDragLogo = (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        if (e.type === "dragenter" || e.type === "dragover") setDragActiveLogo(true)
        else if (e.type === "dragleave") setDragActiveLogo(false)
    }

    const handleDropLogo = (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setDragActiveLogo(false)
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            handleLogoChange(e.dataTransfer.files[0])
        }
    }

    const handleDragCover = (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        if (e.type === "dragenter" || e.type === "dragover") setDragActiveCover(true)
        else if (e.type === "dragleave") setDragActiveCover(false)
    }

    const handleDropCover = (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setDragActiveCover(false)
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            handleCoverChange(e.dataTransfer.files[0])
        }
    }

    const handleScheduleChange = (day: string, field: 'open' | 'close' | 'isOpen', value: any) => {
        setSchedule(prev => ({
            ...prev,
            [day]: {
                ...prev[day],
                [field]: value
            }
        }))
    }

    const handlePickupChange = (field: string, value: any) => {
        setFormData(prev => ({
            ...prev,
            pickupSettings: {
                ...prev.pickupSettings,
                [field]: value
            }
        }))
    }

    const handlePickupLocationChange = (lat: number, lng: number) => {
        setFormData(prev => ({
            ...prev,
            pickupSettings: {
                ...prev.pickupSettings,
                latlong: `${lat}, ${lng}`
            }
        }))
    }

    const handlePickupPhotoChange = async (file: File) => {
        setUploadingPickupPhoto(true)
        try {
            const optimized = await optimizeImage(file, 800, 0.8)
            const path = `businesses/${business.id}/pickup_${Date.now()}.webp`
            const url = await uploadImage(optimized as any, path)
            setFormData(prev => ({
                ...prev,
                pickupSettings: {
                    ...prev.pickupSettings,
                    storePhotoUrl: url
                }
            }))
        } catch (error) {
            console.error('Error uploading pickup photo:', error)
            alert('Error al subir la foto del local')
        }
        setUploadingPickupPhoto(false)
    }

    useEffect(() => {
        const loadGroups = async () => {
            try {
                const groups = await getCoverageGroups()
                setCoverageGroups(groups)
            } catch (error) {
                console.error('Error loading coverage groups:', error)
            }
        }
        loadGroups()
        
        if (currentGeoLocation) {
            handlePickupLocationChange(currentGeoLocation.lat, currentGeoLocation.lng)
        }
    }, [currentGeoLocation])

    const handleSubmit = async () => {
        let logoUrl = business.image
        let coverUrl = business.coverImage

        // Subir nuevo logo si existe
        if (newLogo) {
            setUploadingLogo(true)
            try {
                const optimizedLogo = await optimizeImage(newLogo, 500, 0.8)
                const logoPath = `businesses/${Date.now()}_logo.webp`
                logoUrl = await uploadImage(optimizedLogo as any, logoPath)
            } catch (error) {
                console.error('Error uploading logo:', error)
            }
            setUploadingLogo(false)
        }

        // Subir nueva portada si existe
        if (newCover) {
            setUploadingCover(true)
            try {
                const optimizedCover = await optimizeImage(newCover, 1200, 0.7)
                const coverPath = `businesses/covers/${Date.now()}_cover.webp`
                coverUrl = await uploadImage(optimizedCover as any, coverPath)
            } catch (error) {
                console.error('Error uploading cover:', error)
            }
            setUploadingCover(false)
        }

        // Auto-detectar grupo y zona basándose en la ubicación de retiro
        let finalGroupId = formData.groupId
        let finalZoneId = formData.zoneId

        const coords = formData.pickupSettings.latlong.split(',').map(c => parseFloat(c.trim()))
        if (!isNaN(coords[0]) && !isNaN(coords[1])) {
            console.log('[DEBUG] BusinessProfileEditor - Auto-detecting zone for:', coords)
            try {
                const zone = await getCoverageZoneForLocation({ lat: coords[0], lng: coords[1] })
                if (zone) {
                    console.log('[DEBUG] BusinessProfileEditor - Found zone:', zone.name, 'Group:', zone.groupId)
                    finalGroupId = zone.groupId || ''
                    finalZoneId = zone.id
                } else {
                    console.log('[DEBUG] BusinessProfileEditor - No zone found, marking as external')
                    finalGroupId = 'external'
                    finalZoneId = 'none'
                }
            } catch (error) {
                console.error('[DEBUG] BusinessProfileEditor - Error detecting zone:', error)
            }
        }

        const deliveryTime = Number(formData.deliveryTime)

        await onSave({
            name: formData.name,
            username: formData.username,
            description: formData.description,
            phone: formData.phone,
            email: formData.email,
            category: formData.category,
            businessType: formData.businessType,
            isActive: formData.isActive,
            isHidden: formData.isHidden,
            image: logoUrl,
            coverImage: coverUrl,
            schedule,
            deliveryTime,
            defaultDeliveryTime: deliveryTime,
            defaultDeliveryId: formData.defaultDeliveryId,
            groupId: finalGroupId,
            zoneId: finalZoneId,
            pickupSettings: formData.pickupSettings
        })
    }

    const sectionNav = [
        { key: 'identity', label: 'Identidad', icon: 'bi-shop' },
        { key: 'contact', label: 'Contacto', icon: 'bi-telephone' },
        { key: 'visual', label: 'Visual', icon: 'bi-image' },
        { key: 'schedule', label: 'Horario', icon: 'bi-clock' },
        { key: 'delivery_pickup', label: 'Entrega', icon: 'bi-box-seam' }
    ]

    return (
        <div className="min-h-screen bg-[#F8F9FA] relative py-8 px-4 overflow-hidden">
            {/* Círculos decorativos de fondo */}
            <div className="absolute top-[-10%] left-[-10%] w-[40%] aspect-square bg-red-100/30 rounded-full blur-[120px]"></div>
            <div className="absolute bottom-[-10%] right-[-10%] w-[40%] aspect-square bg-orange-100/30 rounded-full blur-[120px]"></div>

            <div className="w-full max-w-3xl mx-auto relative z-10">
                <div className="bg-white/80 backdrop-blur-2xl rounded-[3rem] shadow-[0_32px_80px_rgba(0,0,0,0.08)] border border-white/50 overflow-hidden">

                    <div className="p-6 sm:p-10">
                        <header className="text-center mb-8">
                            <div className="inline-flex items-center justify-center w-16 h-16 bg-red-600 rounded-3xl shadow-xl shadow-red-200 mb-4 transform -rotate-6">
                                <i className="bi bi-pencil-square text-white text-3xl"></i>
                            </div>
                            <h1 className="text-3xl font-black text-gray-900 tracking-tight leading-none mb-2">
                                Editar Perfil
                            </h1>
                            <p className="text-gray-500 font-medium">{business.name}</p>
                        </header>

                        {/* Navegación de Secciones */}
                        <div className="flex flex-wrap justify-center gap-2 mb-8">
                            {sectionNav.map((section) => (
                                <button
                                    key={section.key}
                                    onClick={() => setActiveSection(section.key as any)}
                                    className={`px-4 py-2 rounded-2xl font-bold text-xs uppercase tracking-widest transition-all duration-300 flex items-center gap-2 ${activeSection === section.key
                                        ? 'bg-red-600 text-white shadow-lg shadow-red-200'
                                        : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                                        }`}
                                >
                                    <i className={`bi ${section.icon}`}></i>
                                    <span className="hidden sm:inline">{section.label}</span>
                                </button>
                            ))}
                        </div>

                        {/* Sección: Identidad */}
                        {activeSection === 'identity' && (
                            <div className="space-y-6 animate-fadeIn">
                                <div className="flex items-center gap-3 mb-4">
                                    <span className="w-8 h-8 rounded-full bg-gray-900 text-white flex items-center justify-center text-xs font-black">1</span>
                                    <h3 className="font-black text-gray-900 uppercase tracking-widest text-xs">Identidad del Negocio</h3>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                                    {/* Nombre */}
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">Nombre Comercial</label>
                                        <input
                                            type="text"
                                            name="name"
                                            value={formData.name}
                                            onChange={handleChange}
                                            className="w-full px-5 py-4 bg-gray-50 border-2 border-transparent rounded-2xl focus:bg-white focus:ring-4 focus:ring-red-500/5 focus:border-red-500 transition-all duration-300 font-bold text-gray-900 placeholder:text-gray-300"
                                            placeholder="Pizzería Don Mario"
                                        />
                                    </div>

                                    {/* Username */}
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">ID Único (URL)</label>
                                        <div className="relative group">
                                            <span className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-400 font-bold">@</span>
                                            <input
                                                type="text"
                                                name="username"
                                                value={formData.username}
                                                onChange={handleChange}
                                                className="w-full pl-10 pr-5 py-4 bg-gray-50 border-2 border-transparent rounded-2xl focus:bg-white focus:ring-4 focus:ring-red-500/5 focus:border-red-500 transition-all duration-300 font-bold text-gray-900 placeholder:text-gray-300"
                                                placeholder="username"
                                            />
                                        </div>
                                        <p className="text-gray-400 text-[9px] font-bold ml-1">fuddi.shop/@{formData.username || '...'}</p>
                                    </div>
                                </div>

                                {/* Tipo de Negocio */}
                                <div className="space-y-4">
                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">Tipo de Negocio</label>
                                    <div className="grid grid-cols-2 gap-4">
                                        <button
                                            type="button"
                                            onClick={() => setFormData(prev => ({ ...prev, businessType: 'food_store', category: '' }))}
                                            className={`p-4 rounded-2xl border-2 transition-all duration-300 flex flex-col items-center gap-2 ${formData.businessType === 'food_store'
                                                ? 'border-red-500 bg-red-50 shadow-md ring-1 ring-red-50'
                                                : 'border-gray-100 bg-gray-50/50 hover:border-gray-200'
                                                }`}
                                        >
                                            <i className={`bi bi-shop text-2xl ${formData.businessType === 'food_store' ? 'text-red-500' : 'text-gray-400'}`}></i>
                                            <span className={`text-[10px] font-black uppercase tracking-widest ${formData.businessType === 'food_store' ? 'text-red-600' : 'text-gray-500'}`}>Comida Preparada</span>
                                        </button>

                                        <button
                                            type="button"
                                            onClick={() => setFormData(prev => ({ ...prev, businessType: 'distributor', category: '' }))}
                                            className={`p-4 rounded-2xl border-2 transition-all duration-300 flex flex-col items-center gap-2 ${formData.businessType === 'distributor'
                                                ? 'border-red-500 bg-red-50 shadow-md ring-1 ring-red-50'
                                                : 'border-gray-100 bg-gray-50/50 hover:border-gray-200'
                                                }`}
                                        >
                                            <i className={`bi bi-box-seam text-2xl ${formData.businessType === 'distributor' ? 'text-red-500' : 'text-gray-400'}`}></i>
                                            <span className={`text-[10px] font-black uppercase tracking-widest ${formData.businessType === 'distributor' ? 'text-red-600' : 'text-gray-500'}`}>Proveedor</span>
                                        </button>
                                    </div>
                                </div>

                                {/* Categoría Dinámica */}
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">
                                        {formData.businessType === 'food_store' ? 'Especialidad Gastronómica' : 'Rubro de Suministros'}
                                    </label>
                                    <div className="relative">
                                        <select
                                            name="category"
                                            value={formData.category}
                                            onChange={handleChange}
                                            className="w-full px-5 py-4 bg-gray-50 border-2 border-transparent rounded-2xl focus:bg-white focus:ring-4 focus:ring-red-500/5 focus:border-red-500 transition-all duration-300 font-bold text-gray-900 appearance-none"
                                        >
                                            <option value="">Selecciona una opción</option>
                                            {formData.businessType === 'food_store' ? (
                                                <>
                                                    <option value="Comida Rápida">🍔 Comida Rápida</option>
                                                    <option value="Pizza">🍕 Pizza</option>
                                                    <option value="Postres">🧁 Postres y Dulces</option>
                                                    <option value="Bebidas">🍹 Bebidas y Jugos</option>
                                                    <option value="Saludable">🥗 Saludable</option>
                                                    <option value="Cafetería">☕ Cafetería</option>
                                                    <option value="Mariscos">🍤 Mariscos</option>
                                                    <option value="Parrilla">🥩 Parrilla y Asados</option>
                                                </>
                                            ) : (
                                                <>
                                                    <option value="Alimentos">🍎 Alimentos y Materia Prima</option>
                                                    <option value="Plásticos">🥤 Materiales Plásticos / Empaques</option>
                                                    <option value="Limpieza">🧹 Productos de Limpieza</option>
                                                    <option value="Equipamiento">🧑‍🍳 Equipamiento de Cocina</option>
                                                </>
                                            )}
                                            <option value="Otro">✨ Otro</option>
                                        </select>
                                        <div className="absolute right-5 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
                                            <i className="bi bi-chevron-down"></i>
                                        </div>
                                    </div>
                                </div>

                                {/* Descripción */}
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">Eslogan o Resumen</label>
                                    <textarea
                                        name="description"
                                        value={formData.description}
                                        onChange={handleChange}
                                        rows={2}
                                        className="w-full px-5 py-4 bg-gray-50 border-2 border-transparent rounded-2xl focus:bg-white focus:ring-4 focus:ring-red-500/5 focus:border-red-500 transition-all duration-300 font-bold text-gray-900 placeholder:text-gray-300 resize-none"
                                        placeholder="Cuéntanos qué hace especial a tu negocio..."
                                    />
                                </div>

                                {/* Grupo de Cobertura - Oculto por ser proceso automático interno 
                                 <div className="space-y-2">
                                     <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">Grupo de Cobertura (Ciudad)</label>
                                     <div className="relative">
                                         <select
                                             name="groupId"
                                             value={formData.groupId}
                                             onChange={handleChange}
                                             className="w-full px-5 py-4 bg-gray-50 border-2 border-transparent rounded-2xl focus:bg-white focus:ring-4 focus:ring-red-500/5 focus:border-red-500 transition-all duration-300 font-bold text-gray-900 appearance-none"
                                         >
                                             <option value="">Sin Grupo (Global)</option>
                                             {coverageGroups.map(group => (
                                                 <option key={group.id} value={group.id}>
                                                     {group.name}
                                                 </option>
                                             ))}
                                         </select>
                                         <div className="absolute right-5 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
                                             <i className="bi bi-chevron-down"></i>
                                         </div>
                                     </div>
                                 </div>
                                 */}

                                {/* Estado del negocio */}
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">Estado</label>
                                        <button
                                            type="button"
                                            onClick={() => setFormData(prev => ({ ...prev, isActive: !prev.isActive }))}
                                            className={`w-full p-4 rounded-2xl border-2 transition-all duration-300 flex items-center justify-center gap-2 ${formData.isActive
                                                ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                                                : 'border-gray-200 bg-gray-50 text-gray-500'
                                                }`}
                                        >
                                            <i className={`bi ${formData.isActive ? 'bi-check-circle-fill' : 'bi-x-circle'}`}></i>
                                            <span className="font-bold text-sm">{formData.isActive ? 'Activo' : 'Inactivo'}</span>
                                        </button>
                                    </div>

                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">Visibilidad</label>
                                        <button
                                            type="button"
                                            onClick={() => setFormData(prev => ({ ...prev, isHidden: !prev.isHidden }))}
                                            className={`w-full p-4 rounded-2xl border-2 transition-all duration-300 flex items-center justify-center gap-2 ${!formData.isHidden
                                                ? 'border-blue-500 bg-blue-50 text-blue-700'
                                                : 'border-gray-200 bg-gray-50 text-gray-500'
                                                }`}
                                        >
                                            <i className={`bi ${!formData.isHidden ? 'bi-eye-fill' : 'bi-eye-slash'}`}></i>
                                            <span className="font-bold text-sm">{!formData.isHidden ? 'Visible' : 'Oculto'}</span>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Sección: Contacto */}
                        {activeSection === 'contact' && (
                            <div className="space-y-6 animate-fadeIn">
                                <div className="flex items-center gap-3 mb-4">
                                    <span className="w-8 h-8 rounded-full bg-gray-900 text-white flex items-center justify-center text-xs font-black">2</span>
                                    <h3 className="font-black text-gray-900 uppercase tracking-widest text-xs">Contacto</h3>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                                    {/* Teléfono */}
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">WhatsApp de Pedidos</label>
                                        <input
                                            type="tel"
                                            name="phone"
                                            value={formData.phone}
                                            onChange={handleChange}
                                            className="w-full px-5 py-4 bg-gray-50 border-2 border-transparent rounded-2xl focus:bg-white focus:ring-4 focus:ring-red-500/5 focus:border-red-500 transition-all duration-300 font-bold text-gray-900 placeholder:text-gray-300"
                                            placeholder="09XXXXXXXX"
                                        />
                                    </div>

                                    {/* Email */}
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">Email</label>
                                        <input
                                            type="email"
                                            name="email"
                                            value={formData.email}
                                            onChange={handleChange}
                                            className="w-full px-5 py-4 bg-gray-50 border-2 border-transparent rounded-2xl focus:bg-white focus:ring-4 focus:ring-red-500/5 focus:border-red-500 transition-all duration-300 font-bold text-gray-900 placeholder:text-gray-300"
                                            placeholder="correo@ejemplo.com"
                                        />
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Sección: Visual */}
                        {activeSection === 'visual' && (
                            <div className="space-y-6 animate-fadeIn">
                                <div className="flex items-center gap-3 mb-4">
                                    <span className="w-8 h-8 rounded-full bg-gray-900 text-white flex items-center justify-center text-xs font-black">3</span>
                                    <h3 className="font-black text-gray-900 uppercase tracking-widest text-xs">Identidad Visual</h3>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                                    {/* Logo */}
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">Logo del negocio</label>
                                        <div
                                            onDragEnter={handleDragLogo}
                                            onDragOver={handleDragLogo}
                                            onDragLeave={handleDragLogo}
                                            onDrop={handleDropLogo}
                                            className={`relative flex flex-col items-center justify-center p-6 rounded-[2.5rem] border-2 border-dashed transition-all duration-300 aspect-square ${dragActiveLogo ? 'border-red-500 bg-red-50' : 'border-gray-100 bg-gray-50/50'}`}
                                        >
                                            <input
                                                type="file"
                                                accept="image/*"
                                                onChange={(e) => e.target.files?.[0] && handleLogoChange(e.target.files[0])}
                                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                                            />

                                            {logoPreview ? (
                                                <div className="relative w-full h-full rounded-3xl overflow-hidden shadow-xl">
                                                    <img src={logoPreview} className="w-full h-full object-cover" alt="Logo Preview" />
                                                    <div className="absolute inset-0 bg-black/20 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                                                        <i className="bi bi-pencil-square text-white text-2xl"></i>
                                                    </div>
                                                    {uploadingLogo && (
                                                        <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                                                            <div className="w-8 h-8 border-3 border-white/20 border-t-white rounded-full animate-spin"></div>
                                                        </div>
                                                    )}
                                                </div>
                                            ) : (
                                                <>
                                                    <div className="w-12 h-12 bg-white rounded-2xl shadow-sm flex items-center justify-center text-gray-400 mb-2">
                                                        <i className="bi bi-image text-xl"></i>
                                                    </div>
                                                    <p className="text-gray-900 font-black text-xs">Logo</p>
                                                    <p className="text-gray-400 text-[8px] font-bold uppercase tracking-widest mt-1 text-center">Cuadrado recomendado</p>
                                                </>
                                            )}
                                        </div>
                                    </div>

                                    {/* Portada */}
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">Imagen de Portada</label>
                                        <div
                                            onDragEnter={handleDragCover}
                                            onDragOver={handleDragCover}
                                            onDragLeave={handleDragCover}
                                            onDrop={handleDropCover}
                                            className={`relative flex flex-col items-center justify-center p-6 rounded-[2.5rem] border-2 border-dashed transition-all duration-300 aspect-square ${dragActiveCover ? 'border-red-500 bg-red-50' : 'border-gray-100 bg-gray-50/50'}`}
                                        >
                                            <input
                                                type="file"
                                                accept="image/*"
                                                onChange={(e) => e.target.files?.[0] && handleCoverChange(e.target.files[0])}
                                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                                            />

                                            {coverPreview ? (
                                                <div className="relative w-full h-full rounded-3xl overflow-hidden shadow-xl">
                                                    <img src={coverPreview} className="w-full h-full object-cover" alt="Cover Preview" />
                                                    <div className="absolute inset-0 bg-black/20 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                                                        <i className="bi bi-pencil-square text-white text-2xl"></i>
                                                    </div>
                                                    {uploadingCover && (
                                                        <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                                                            <div className="w-8 h-8 border-3 border-white/20 border-t-white rounded-full animate-spin"></div>
                                                        </div>
                                                    )}
                                                </div>
                                            ) : (
                                                <>
                                                    <div className="w-12 h-12 bg-white rounded-2xl shadow-sm flex items-center justify-center text-gray-400 mb-2">
                                                        <i className="bi bi-aspect-ratio text-xl"></i>
                                                    </div>
                                                    <p className="text-gray-900 font-black text-xs">Portada</p>
                                                    <p className="text-gray-400 text-[8px] font-bold uppercase tracking-widest mt-1 text-center">Horizontal recomendado</p>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Sección: Horario */}
                        {activeSection === 'schedule' && (
                            <div className="space-y-6 animate-fadeIn">
                                <div className="flex items-center gap-3 mb-4">
                                    <span className="w-8 h-8 rounded-full bg-gray-900 text-white flex items-center justify-center text-xs font-black">4</span>
                                    <h3 className="font-black text-gray-900 uppercase tracking-widest text-xs">Horario de Atención</h3>
                                </div>

                                <div className="p-6 bg-red-50/50 border-2 border-red-100 rounded-3xl mb-8">
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 bg-red-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-red-100">
                                                <i className="bi bi-clock-history"></i>
                                            </div>
                                            <div>
                                                <h4 className="text-sm font-black text-gray-900 uppercase tracking-tight">Tiempo de Entrega</h4>
                                                <p className="text-[10px] text-gray-500 font-bold">Tiempo estimado en minutos</p>
                                            </div>
                                        </div>
                                        <div className="relative group min-w-[120px]">
                                            <input
                                                type="number"
                                                name="deliveryTime"
                                                value={formData.deliveryTime}
                                                onChange={handleChange}
                                                min="1"
                                                className="w-full px-5 py-3 bg-white border-2 border-transparent rounded-2xl focus:ring-4 focus:ring-red-500/5 focus:border-red-500 transition-all duration-300 font-black text-gray-900 placeholder:text-gray-300"
                                                placeholder="30"
                                            />
                                            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 font-black text-[10px] uppercase">min</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-3">
                                    {days.map((day) => {
                                        const daySchedule = schedule[day.key] || { open: '09:00', close: '18:00', isOpen: true }
                                        return (
                                            <div key={day.key} className={`p-4 rounded-2xl transition-all duration-300 ${daySchedule.isOpen ? 'bg-emerald-50/50 border border-emerald-100' : 'bg-gray-50 border border-gray-100'}`}>
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-3">
                                                        <button
                                                            type="button"
                                                            onClick={() => handleScheduleChange(day.key, 'isOpen', !daySchedule.isOpen)}
                                                            className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${daySchedule.isOpen ? 'bg-emerald-500 text-white' : 'bg-gray-200 text-gray-400'}`}
                                                        >
                                                            <i className={`bi ${daySchedule.isOpen ? 'bi-check-lg' : 'bi-x-lg'}`}></i>
                                                        </button>
                                                        <span className={`font-bold ${daySchedule.isOpen ? 'text-gray-900' : 'text-gray-400'}`}>{day.label}</span>
                                                    </div>

                                                    {daySchedule.isOpen && (
                                                        <div className="flex items-center gap-2">
                                                            <input
                                                                type="time"
                                                                value={daySchedule.open}
                                                                onChange={(e) => handleScheduleChange(day.key, 'open', e.target.value)}
                                                                className="px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm font-bold text-gray-700"
                                                            />
                                                            <span className="text-gray-400 text-sm">a</span>
                                                            <input
                                                                type="time"
                                                                value={daySchedule.close}
                                                                onChange={(e) => handleScheduleChange(day.key, 'close', e.target.value)}
                                                                className="px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm font-bold text-gray-700"
                                                            />
                                                        </div>
                                                    )}

                                                    {!daySchedule.isOpen && (
                                                        <span className="text-gray-400 text-sm font-bold uppercase tracking-widest">Cerrado</span>
                                                    )}
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Section: Entrega (Retiro y Repartidor) */}
                        {activeSection === 'delivery_pickup' && (
                            <div className="space-y-12 animate-fadeIn">
                                {/* Retiro en tienda */}
                                <div className="space-y-8">
                                    <div className="flex items-center gap-3 mb-4">
                                        <span className="w-8 h-8 rounded-full bg-gray-900 text-white flex items-center justify-center text-xs font-black">5</span>
                                        <h3 className="font-black text-gray-900 uppercase tracking-widest text-xs">Retiros en Tienda</h3>
                                    </div>

                                    {/* Selector de Opción de Retiro */}
                                    <div className="bg-white rounded-3xl p-6 border-2 border-dashed border-gray-100 space-y-4 hover:border-red-100 transition-colors">
                                        <div className="flex items-center gap-4">
                                            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-xl transition-all ${formData.pickupSettings.enabled ? 'bg-red-600 text-white shadow-lg shadow-red-200' : 'bg-gray-100 text-gray-400'}`}>
                                                <i className="bi bi-shop-window"></i>
                                            </div>
                                            <div>
                                                <h4 className="font-black text-gray-900 uppercase tracking-widest text-[10px]">Estatus del Servicio de Retiro</h4>
                                                <p className="text-[11px] font-semibold text-gray-500 leading-snug">Configura cómo tus clientes pueden retirar sus pedidos en tienda</p>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
                                            {/* Opción: Desactivado */}
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    handlePickupChange('enabled', false)
                                                    handlePickupChange('restrictToPrevious', false)
                                                }}
                                                className={`p-3 rounded-2xl border-2 text-left transition-all ${
                                                    !formData.pickupSettings.enabled
                                                        ? 'border-red-600 bg-red-50/50 text-red-900 shadow-sm'
                                                        : 'border-gray-100 bg-gray-50/30 text-gray-500 hover:border-gray-200'
                                                }`}
                                            >
                                                <div className="font-black text-[10px] uppercase tracking-wider mb-1">Desactivado</div>
                                                <div className="text-[11px] font-semibold opacity-85 leading-snug">Los clientes no podrán seleccionar retiro.</div>
                                            </button>

                                            {/* Opción: Activado (Todos) */}
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    handlePickupChange('enabled', true)
                                                    handlePickupChange('restrictToPrevious', false)
                                                }}
                                                className={`p-3 rounded-2xl border-2 text-left transition-all ${
                                                    formData.pickupSettings.enabled && !formData.pickupSettings.restrictToPrevious
                                                        ? 'border-red-600 bg-red-50/50 text-red-900 shadow-sm'
                                                        : 'border-gray-100 bg-gray-50/30 text-gray-500 hover:border-gray-200'
                                                }`}
                                            >
                                                <div className="font-black text-[10px] uppercase tracking-wider mb-1">Activado (Todos)</div>
                                                <div className="text-[11px] font-semibold opacity-85 leading-snug">Cualquier cliente podrá retirar en tienda.</div>
                                            </button>

                                            {/* Opción: Solo clientes con retiros previos */}
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    handlePickupChange('enabled', true)
                                                    handlePickupChange('restrictToPrevious', true)
                                                }}
                                                className={`p-3 rounded-2xl border-2 text-left transition-all ${
                                                    formData.pickupSettings.enabled && formData.pickupSettings.restrictToPrevious
                                                        ? 'border-red-600 bg-red-50/50 text-red-900 shadow-sm'
                                                        : 'border-gray-100 bg-gray-50/30 text-gray-500 hover:border-gray-200'
                                                }`}
                                            >
                                                <div className="font-black text-[10px] uppercase tracking-wider mb-1">Solo Históricos</div>
                                                <div className="text-[11px] font-semibold opacity-85 leading-snug">Solo para clientes que ya hayan retirado antes.</div>
                                            </button>
                                        </div>
                                    </div>

                                    {formData.pickupSettings.enabled && (
                                        <div className="space-y-8 animate-fadeIn">
                                            {/* Referencias del Local */}
                                            <div className="space-y-2">
                                                <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">Instrucciones de Retiro / Referencias</label>
                                                <textarea
                                                    value={formData.pickupSettings.references}
                                                    onChange={(e) => handlePickupChange('references', e.target.value)}
                                                    className="w-full px-5 py-4 bg-gray-50 border-2 border-transparent rounded-2xl focus:bg-white focus:ring-4 focus:ring-red-500/5 focus:border-red-500 transition-all duration-300 font-bold text-gray-900 placeholder:text-gray-300 min-h-[100px]"
                                                    placeholder="Ej: Retirar por la ventanilla lateral frente al parque central..."
                                                />
                                            </div>

                                            {/* Mapa de Ubicación */}
                                            <div className="space-y-4">
                                                <div className="flex items-center justify-between px-1">
                                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Ubicación en el Mapa</label>
                                                    <button
                                                        type="button"
                                                        onClick={() => getCurrentLocation()}
                                                        disabled={locating}
                                                        className="flex items-center gap-2 text-[10px] font-black text-red-600 uppercase tracking-widest hover:text-red-700 transition-colors"
                                                    >
                                                        <i className={`bi ${locating ? 'animate-spin bi-arrow-repeat' : 'bi-geo-alt-fill'}`}></i>
                                                        {locating ? 'Obteniendo...' : 'Usar mi ubicación actual'}
                                                    </button>
                                                </div>
                                                <div className="rounded-3xl overflow-hidden border-2 border-gray-100 shadow-inner h-[250px] relative">
                                                    {(() => {
                                                        const coords = formData.pickupSettings.latlong.split(',').map(c => parseFloat(c.trim()));
                                                        const lat = !isNaN(coords[0]) ? coords[0] : -0.1807;
                                                        const lng = !isNaN(coords[1]) ? coords[1] : -78.4678;
                                                        return (
                                                            <GoogleMap
                                                                latitude={lat}
                                                                longitude={lng}
                                                                height="100%"
                                                                draggable={true}
                                                                onLocationChange={handlePickupLocationChange}
                                                            />
                                                        );
                                                    })()}
                                                </div>
                                                <p className="text-[9px] font-bold text-gray-400 text-center uppercase tracking-widest">Puedes mover el marcador para ajustar la ubicación exacta</p>
                                            </div>

                                            {/* Foto del Local */}
                                            <div className="space-y-4">
                                                <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">Foto para Identificar el Local (Opcional)</label>
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                                                    <div
                                                        onDragOver={(e) => { e.preventDefault(); setDragActivePickup(true); }}
                                                        onDragLeave={() => setDragActivePickup(false)}
                                                        onDrop={(e) => {
                                                            e.preventDefault();
                                                            setDragActivePickup(false);
                                                            if (e.dataTransfer.files?.[0]) handlePickupPhotoChange(e.dataTransfer.files[0]);
                                                        }}
                                                        className={`aspect-video rounded-3xl border-2 border-dashed transition-all flex flex-col items-center justify-center gap-3 cursor-pointer overflow-hidden group ${dragActivePickup ? 'border-red-500 bg-red-50' : 'border-gray-100 bg-gray-50/50 hover:bg-white hover:border-red-200'}`}
                                                        onClick={() => document.getElementById('pickup-photo-input')?.click()}
                                                    >
                                                        {formData.pickupSettings.storePhotoUrl ? (
                                                            <div className="relative w-full h-full">
                                                                <img src={formData.pickupSettings.storePhotoUrl} alt="Store" className="w-full h-full object-cover" />
                                                                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                                                    <i className="bi bi-camera text-white text-2xl"></i>
                                                                </div>
                                                            </div>
                                                        ) : uploadingPickupPhoto ? (
                                                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-500"></div>
                                                        ) : (
                                                            <>
                                                                <i className="bi bi-camera text-2xl text-gray-300"></i>
                                                                <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Subir Foto</span>
                                                            </>
                                                        )}
                                                        <input
                                                            id="pickup-photo-input"
                                                            type="file"
                                                            className="hidden"
                                                            accept="image/*"
                                                            onChange={(e) => e.target.files?.[0] && handlePickupPhotoChange(e.target.files[0])}
                                                        />
                                                    </div>
                                                    <div className="flex flex-col justify-center gap-2">
                                                        <p className="text-xs font-bold text-gray-500 leading-relaxed italic">
                                                            "Una foto nítida de la fachada de tu local ayuda a los clientes a encontrarte más rápido."
                                                        </p>
                                                        {formData.pickupSettings.storePhotoUrl && (
                                                            <button
                                                                type="button"
                                                                onClick={() => handlePickupChange('storePhotoUrl', '')}
                                                                className="text-[10px] font-black text-red-600 uppercase tracking-widest text-left mt-2 hover:text-red-700 transition-colors"
                                                            >
                                                                Eliminar Foto
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Divisor */}
                                <div className="border-t border-dashed border-gray-200 pt-12">
                                    <DeliveryConfigSection
                                        businessId={business.id}
                                        defaultDeliveryId={formData.defaultDeliveryId}
                                        onDeliverySelect={(id) => setFormData(prev => ({ ...prev, defaultDeliveryId: id }))}
                                    />
                                </div>
                            </div>
                        )}

                        <div className="pt-8 flex flex-col sm:flex-row items-center gap-4">
                            <button
                                type="button"
                                onClick={handleSubmit}
                                disabled={saving || uploadingLogo || uploadingCover}
                                className="flex-1 w-full bg-red-600 hover:bg-black text-white font-black py-5 px-8 rounded-[2rem] shadow-2xl shadow-red-200 transition-all duration-500 transform hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed group overflow-hidden relative"
                            >
                                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000"></div>
                                {saving || uploadingLogo || uploadingCover ? (
                                    <>
                                        <div className="w-5 h-5 border-3 border-white/20 border-t-white rounded-full animate-spin"></div>
                                        <span className="uppercase tracking-widest text-xs">Guardando...</span>
                                    </>
                                ) : (
                                    <>
                                        <i className="bi bi-check2-circle text-xl"></i>
                                        <span className="uppercase tracking-widest text-xs">Guardar Cambios</span>
                                    </>
                                )}
                            </button>

                            <button
                                type="button"
                                onClick={onCancel}
                                className="px-8 py-5 text-gray-400 hover:text-gray-900 font-black uppercase tracking-widest text-[10px] transition-colors"
                            >
                                Cancelar
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <style jsx>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fadeIn {
          animation: fadeIn 0.3s ease-out;
        }
      `}</style>
        </div>
    )
}

/**
 * Sección de configuración de delivery y repartidores de la tienda
 */
const DeliveryConfigSection: React.FC<{
    businessId: string;
    defaultDeliveryId: string;
    onDeliverySelect: (id: string) => void;
}> = ({ businessId, defaultDeliveryId, onDeliverySelect }) => {
    const [myDeliveries, setMyDeliveries] = useState<Delivery[]>([])
    const [loadingMyDeliveries, setLoadingMyDeliveries] = useState(false)
    const [showForm, setShowForm] = useState(false)
    const [newDeliveryData, setNewDeliveryData] = useState({
        nombres: '',
        celular: '',
        email: ''
    })
    const [creating, setCreating] = useState(false)
    const [message, setMessage] = useState<{ text: string, type: 'success' | 'error' | 'info' } | null>(null)

    const showMessage = (text: string, type: 'success' | 'error' | 'info' = 'info') => {
        setMessage({ text, type })
        setTimeout(() => setMessage(null), 3000)
    }

    const loadMyDeliveries = async () => {
        if (!businessId) return
        setLoadingMyDeliveries(true)
        try {
            const list = await getDeliveriesByBusiness(businessId)
            setMyDeliveries(list)
        } catch (error) {
            console.error('Error loading store deliveries:', error)
        } finally {
            setLoadingMyDeliveries(false)
        }
    }

    useEffect(() => {
        loadMyDeliveries()
    }, [businessId])

    const handleUnlink = async (driver: Delivery) => {
        try {
            await unlinkDeliveryFromBusiness(driver.id, businessId)
            if (defaultDeliveryId === driver.id) {
                onDeliverySelect('')
            }
            showMessage(`Repartidor ${driver.nombres} eliminado de tu tienda`, 'info')
            await loadMyDeliveries()
        } catch (error) {
            console.error('Error unlinking delivery:', error)
            showMessage('Error al desvincular repartidor', 'error')
        }
    }

    const handleSaveDriver = async () => {
        const nameClean = newDeliveryData.nombres.trim()
        const phoneClean = newDeliveryData.celular.trim()
        const emailClean = newDeliveryData.email.trim()

        if (!nameClean || !phoneClean || phoneClean.length < 7) {
            showMessage('Completa el nombre y un celular válido de WhatsApp', 'error')
            return
        }

        setCreating(true)
        try {
            const existing = await searchDeliveryByPhone(phoneClean)
            let driverId = ''

            if (existing) {
                await linkDeliveryToBusiness(existing.id, businessId)
                driverId = existing.id
            } else {
                driverId = await createDelivery({
                    nombres: nameClean,
                    celular: phoneClean,
                    email: emailClean || `${phoneClean}@fuddi.delivery`,
                    estado: 'activo',
                    fechaRegistro: new Date().toISOString(),
                    businessId: businessId,
                    businessIds: [businessId]
                })
            }

            if (!defaultDeliveryId) {
                onDeliverySelect(driverId)
            }

            setNewDeliveryData({ nombres: '', celular: '', email: '' })
            setShowForm(false)
            showMessage('Repartidor registrado exitosamente en tu tienda', 'success')
            await loadMyDeliveries()
        } catch (error) {
            console.error('Error al guardar repartidor:', error)
            showMessage('Error al registrar el repartidor', 'error')
        } finally {
            setCreating(false)
        }
    }

    return (
        <div className="space-y-8 animate-fadeIn">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <span className="w-8 h-8 rounded-full bg-gray-900 text-white flex items-center justify-center text-xs font-black">6</span>
                    <h3 className="font-black text-gray-900 uppercase tracking-widest text-xs">Repartidores de la Tienda</h3>
                </div>

                {!showForm && (
                    <button
                        type="button"
                        onClick={() => setShowForm(true)}
                        className="px-4 py-2 bg-gray-900 hover:bg-black text-white text-xs font-black uppercase tracking-widest rounded-xl transition-all flex items-center gap-2 shadow-sm"
                    >
                        <i className="bi bi-plus-lg"></i>
                        Registrar Repartidor
                    </button>
                )}
            </div>

            {/* Mensajes de Feedback */}
            {message && (
                <div className={`p-4 rounded-2xl text-xs font-black uppercase tracking-widest animate-fadeIn ${
                    message.type === 'success' ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' :
                    message.type === 'error' ? 'bg-red-50 text-red-600 border border-red-100' :
                    'bg-blue-50 text-blue-600 border border-blue-100'
                }`}>
                    <i className={`bi ${message.type === 'success' ? 'bi-check-circle' : message.type === 'error' ? 'bi-exclamation-circle' : 'bi-info-circle'} me-2`}></i>
                    {message.text}
                </div>
            )}

            {/* Formulario de Registro Integrado */}
            {showForm && (
                <div className="p-6 bg-white border-2 border-red-500/20 rounded-3xl space-y-4 shadow-xl shadow-red-500/5 animate-fadeIn">
                    <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                        <h4 className="font-black text-gray-900 text-xs uppercase tracking-widest flex items-center gap-2">
                            <i className="bi bi-person-plus text-red-600 text-base"></i>
                            Registrar Nuevo Repartidor
                        </h4>
                        <button
                            type="button"
                            onClick={() => setShowForm(false)}
                            className="text-gray-400 hover:text-gray-600 text-sm font-bold"
                        >
                            <i className="bi bi-x-lg"></i>
                        </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest ml-1">Nombre Completo *</label>
                            <input
                                type="text"
                                value={newDeliveryData.nombres}
                                onChange={(e) => setNewDeliveryData(prev => ({ ...prev, nombres: e.target.value }))}
                                className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl focus:bg-white focus:border-red-500 transition-all font-bold text-sm text-gray-900"
                                placeholder="Ej: Carlos Mendoza"
                            />
                        </div>

                        <div className="space-y-1.5">
                            <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest ml-1">Teléfono / WhatsApp *</label>
                            <div className="relative">
                                <i className="bi bi-whatsapp absolute left-4 top-1/2 -translate-y-1/2 text-emerald-500 font-bold"></i>
                                <input
                                    type="tel"
                                    value={newDeliveryData.celular}
                                    onChange={(e) => setNewDeliveryData(prev => ({ ...prev, celular: e.target.value }))}
                                    className="w-full pl-11 pr-4 py-3 bg-gray-50 border border-gray-100 rounded-xl focus:bg-white focus:border-red-500 transition-all font-bold text-sm text-gray-900"
                                    placeholder="Ej: 0991234567"
                                />
                            </div>
                        </div>

                        <div className="sm:col-span-2 space-y-1.5">
                            <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest ml-1">Correo Electrónico (Opcional)</label>
                            <input
                                type="email"
                                value={newDeliveryData.email}
                                onChange={(e) => setNewDeliveryData(prev => ({ ...prev, email: e.target.value }))}
                                className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl focus:bg-white focus:border-red-500 transition-all font-bold text-sm text-gray-900"
                                placeholder="ejemplo@correo.com"
                            />
                        </div>
                    </div>

                    <div className="flex justify-end gap-3 pt-3 border-t border-gray-100">
                        <button
                            type="button"
                            onClick={() => setShowForm(false)}
                            className="px-5 py-3 text-[10px] font-black uppercase tracking-widest text-gray-400 hover:text-gray-600"
                        >
                            Cancelar
                        </button>
                        <button
                            type="button"
                            onClick={handleSaveDriver}
                            disabled={creating}
                            className="px-6 py-3 bg-red-600 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all shadow-lg shadow-red-200 disabled:opacity-50 flex items-center gap-2"
                        >
                            {creating ? <i className="bi bi-arrow-repeat animate-spin"></i> : <i className="bi bi-check-lg text-base"></i>}
                            Guardar Repartidor
                        </button>
                    </div>
                </div>
            )}

            {/* Lista de Repartidores de la Tienda */}
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">
                        Repartidores Registrados ({myDeliveries.length})
                    </label>
                    {loadingMyDeliveries && <i className="bi bi-arrow-repeat animate-spin text-xs text-gray-400"></i>}
                </div>

                {myDeliveries.length === 0 ? (
                    <div className="p-8 bg-gray-50 border-2 border-dashed border-gray-200 rounded-[2.5rem] text-center">
                        <div className="w-12 h-12 bg-white rounded-2xl shadow-sm flex items-center justify-center mx-auto mb-3 text-gray-300">
                            <i className="bi bi-person-badge text-2xl"></i>
                        </div>
                        <h4 className="font-black text-gray-900 uppercase tracking-widest text-xs mb-1">Sin Repartidores Registrados</h4>
                        <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest leading-relaxed mb-4">
                            Agrega los repartidores que se encargarán de llevar los pedidos de tu tienda.
                        </p>
                        {!showForm && (
                            <button
                                type="button"
                                onClick={() => setShowForm(true)}
                                className="px-5 py-3 bg-red-600 text-white text-xs font-black uppercase tracking-widest rounded-2xl hover:bg-black transition-all shadow-lg shadow-red-200 inline-flex items-center gap-2"
                            >
                                <i className="bi bi-plus-lg"></i>
                                Registrar Repartidor
                            </button>
                        )}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {myDeliveries.map((driver) => {
                            const isDefault = defaultDeliveryId === driver.id
                            return (
                                <div key={driver.id} className={`p-4 rounded-2xl border-2 transition-all flex items-center justify-between gap-3 ${isDefault ? 'border-emerald-500 bg-emerald-50/50 shadow-sm' : 'border-gray-100 bg-white hover:border-gray-200'}`}>
                                    <div className="flex items-center gap-3 min-w-0 flex-1">
                                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0 ${isDefault ? 'bg-emerald-600 text-white shadow-sm' : 'bg-gray-100 text-gray-500'}`}>
                                            <i className="bi bi-person-badge"></i>
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-1.5">
                                                <h5 className="font-bold text-gray-900 text-sm truncate">{driver.nombres}</h5>
                                                {isDefault && (
                                                    <span className="text-[9px] uppercase font-black px-1.5 py-0.5 rounded bg-emerald-600 text-white shrink-0">Predeterminado</span>
                                                )}
                                            </div>
                                            <p className="text-xs font-semibold text-gray-500 flex items-center gap-1">
                                                <i className="bi bi-whatsapp text-emerald-500"></i>
                                                {driver.celular}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                        {!isDefault && (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    onDeliverySelect(driver.id)
                                                    showMessage(`Asignado ${driver.nombres} como predeterminado`, 'success')
                                                }}
                                                className="p-2 text-xs font-bold text-emerald-600 hover:bg-emerald-100 rounded-lg transition-colors"
                                                title="Marcar como predeterminado"
                                            >
                                                <i className="bi bi-star"></i>
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => handleUnlink(driver)}
                                            className="p-2 text-xs font-bold text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                            title="Eliminar de la tienda"
                                        >
                                            <i className="bi bi-trash"></i>
                                        </button>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>

            <div className="p-4 bg-blue-50/50 border border-blue-100 rounded-2xl">
                <div className="flex gap-3">
                    <i className="bi bi-lightbulb text-blue-500 text-lg"></i>
                    <p className="text-[10px] text-blue-800 font-bold uppercase tracking-widest leading-relaxed italic">
                        Los repartidores que registres aquí estarán disponibles directamente para la entrega de tus pedidos.
                    </p>
                </div>
            </div>
        </div>
    )
}

export default BusinessProfileEditor
