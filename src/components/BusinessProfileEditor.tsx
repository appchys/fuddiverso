"use client"

import React, { useState, useEffect } from 'react'
import { Business } from '@/types'
import { uploadImage } from '@/lib/database'
import { optimizeImage } from '@/lib/image-utils'

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
        address: business.address || '',
        references: business.references || '',
        category: business.category || '',
        businessType: (business.businessType || 'food_store') as 'food_store' | 'distributor',
        isActive: business.isActive ?? true,
        isHidden: business.isHidden ?? false
    })

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
    const [activeSection, setActiveSection] = useState<'identity' | 'contact' | 'visual' | 'schedule'>('identity')

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

        await onSave({
            name: formData.name,
            username: formData.username,
            description: formData.description,
            phone: formData.phone,
            email: formData.email,
            address: formData.address,
            references: formData.references,
            category: formData.category,
            businessType: formData.businessType,
            isActive: formData.isActive,
            isHidden: formData.isHidden,
            image: logoUrl,
            coverImage: coverUrl,
            schedule
        })
    }

    const sectionNav = [
        { key: 'identity', label: 'Identidad', icon: 'bi-shop' },
        { key: 'contact', label: 'Contacto', icon: 'bi-telephone' },
        { key: 'visual', label: 'Visual', icon: 'bi-image' },
        { key: 'schedule', label: 'Horario', icon: 'bi-clock' }
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

                                {/* Dirección */}
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">Dirección</label>
                                    <input
                                        type="text"
                                        name="address"
                                        value={formData.address}
                                        onChange={handleChange}
                                        className="w-full px-5 py-4 bg-gray-50 border-2 border-transparent rounded-2xl focus:bg-white focus:ring-4 focus:ring-red-500/5 focus:border-red-500 transition-all duration-300 font-bold text-gray-900 placeholder:text-gray-300"
                                        placeholder="Dirección completa del negocio"
                                    />
                                </div>

                                {/* Referencias */}
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">Referencias de Ubicación</label>
                                    <textarea
                                        name="references"
                                        value={formData.references}
                                        onChange={handleChange}
                                        rows={2}
                                        className="w-full px-5 py-4 bg-gray-50 border-2 border-transparent rounded-2xl focus:bg-white focus:ring-4 focus:ring-red-500/5 focus:border-red-500 transition-all duration-300 font-bold text-gray-900 placeholder:text-gray-300 resize-none"
                                        placeholder="Cerca del centro comercial, frente al parque..."
                                    />
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

                        {/* Botones de Acción */}
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

export default BusinessProfileEditor
