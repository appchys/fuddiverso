"use client"

import React, { useState, useEffect } from 'react'
import { Business, Delivery, CoverageGroup, CoverageZone, BusinessZoneFeeConfig, BankAccount } from '@/types'
import { uploadImage, searchDeliveryByPhone, createDelivery, getDeliveryById, getCoverageGroups, getCoverageZoneForLocation, getDeliveriesByBusiness, linkDeliveryToBusiness, unlinkDeliveryFromBusiness, getCoverageZones, getCoverageZonesByGroup } from '@/lib/database'
import { optimizeImage } from '@/lib/image-utils'
import { GoogleMap, useCurrentLocation } from './GoogleMap'

interface BusinessProfileEditorProps {
    business: Business
    onSave: (updatedBusiness: Partial<Business>) => Promise<void>
    onCancel: () => void
    saving?: boolean
}

const ECUADORIAN_BANKS = [
    { id: 'Banco Pichincha', name: 'Banco Pichincha', icon: 'bi-bank', color: 'bg-yellow-50 text-yellow-800 border-yellow-200' },
    { id: 'Banco Guayaquil', name: 'Banco Guayaquil', icon: 'bi-bank', color: 'bg-pink-50 text-pink-800 border-pink-200' },
    { id: 'Banco del Pacífico', name: 'Banco del Pacífico', icon: 'bi-bank', color: 'bg-blue-50 text-blue-800 border-blue-200' },
    { id: 'Produbanco', name: 'Produbanco', icon: 'bi-bank', color: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
    { id: 'Banco Bolivariano', name: 'Banco Bolivariano', icon: 'bi-bank', color: 'bg-amber-50 text-amber-800 border-amber-200' },
    { id: 'Banco Internacional', name: 'Banco Internacional', icon: 'bi-bank', color: 'bg-orange-50 text-orange-800 border-orange-200' },
    { id: 'Banco del Austro', name: 'Banco del Austro', icon: 'bi-bank', color: 'bg-red-50 text-red-800 border-red-200' },
    { id: 'Cooperativa JEP', name: 'Cooperativa JEP', icon: 'bi-bank2', color: 'bg-teal-50 text-teal-800 border-teal-200' },
    { id: 'Cooperativa Policía Nacional', name: 'Cooperativa Policía Nacional', icon: 'bi-bank2', color: 'bg-indigo-50 text-indigo-800 border-indigo-200' },
    { id: 'Cooperativa 29 de Octubre', name: 'Cooperativa 29 de Octubre', icon: 'bi-bank2', color: 'bg-purple-50 text-purple-800 border-purple-200' },
    { id: 'Deuna!', name: 'Deuna! (Pichincha)', icon: 'bi-qr-code', color: 'bg-yellow-100 text-yellow-900 border-yellow-300' },
    { id: 'Otro', name: 'Otro banco o cooperativa', icon: 'bi-wallet', color: 'bg-gray-50 text-gray-800 border-gray-200' }
]

export const FUDDI_BANK_ACCOUNTS: BankAccount[] = [
    {
        id: 'pichincha',
        bankName: 'Banco Pichincha',
        accountType: 'Ahorros',
        accountNumber: '2203257517',
        accountHolder: 'Pedro Sánchez León',
        idNumber: '0929057636'
    },
    {
        id: 'pacifico',
        bankName: 'Banco del Pacífico',
        accountType: 'Ahorros',
        accountNumber: '1063889358',
        accountHolder: 'Pedro Sánchez León',
        idNumber: '0929057636'
    },
    {
        id: 'guayaquil',
        bankName: 'Banco Guayaquil',
        accountType: 'Ahorros',
        accountNumber: '0030697477',
        accountHolder: 'Pedro Sánchez León',
        idNumber: '0929057636'
    },
    {
        id: 'produbanco',
        bankName: 'Banco Produbanco',
        accountType: 'Ahorros',
        accountNumber: '20059842774',
        accountHolder: 'Pedro Sánchez León',
        idNumber: '0929057636'
    }
]

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
        deliveryAssignmentMode: (business.deliveryAssignmentMode || 'auto') as 'auto' | 'manual',
        groupId: business.groupId || '',
        zoneId: business.zoneId || '',
        pickupSettings: business.pickupSettings 
            ? { restrictToPrevious: false, ...business.pickupSettings } 
            : { enabled: false, restrictToPrevious: false, references: '', latlong: '', storePhotoUrl: '' }
    })

    const [coverageGroups, setCoverageGroups] = useState<CoverageGroup[]>([])
    const [availableZones, setAvailableZones] = useState<CoverageZone[]>([])
    const [loadingZones, setLoadingZones] = useState(false)
    const [storeDeliveries, setStoreDeliveries] = useState<Delivery[]>([])
    const [deliveryZoneConfigs, setDeliveryZoneConfigs] = useState<Record<string, BusinessZoneFeeConfig>>(() => {
        return business.deliveryZoneSettings?.zones || {}
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
    const [dragActivePickup, setDragActivePickup] = useState(false)
    const [uploadingPickupPhoto, setUploadingPickupPhoto] = useState(false)
    const [activeSection, setActiveSection] = useState<'identity' | 'contact' | 'schedule' | 'delivery_pickup' | 'payment_methods'>('identity')
    const [deliverySubSection, setDeliverySubSection] = useState<'delivery' | 'pickup'>('delivery')

    // Estado para Métodos de Pago y Cuentas Bancarias
    const [bankAccountMode, setBankAccountMode] = useState<'fuddi' | 'custom'>(business.bankAccountMode || 'fuddi')
    const [bankAccounts, setBankAccounts] = useState<BankAccount[]>(() => {
        if (Array.isArray(business.bankAccounts) && business.bankAccounts.length > 0) {
            return business.bankAccounts
        }
        if (business.bankAccount && business.bankAccount.accountNumber) {
            return [{
                id: 'acc_1',
                bankName: business.bankAccount.bankName || 'Banco Pichincha',
                accountType: business.bankAccount.accountType || 'Ahorros',
                accountNumber: business.bankAccount.accountNumber || '',
                accountHolder: business.bankAccount.accountHolder || '',
                idNumber: (business.bankAccount as any).idNumber || '',
                notes: ''
            }]
        }
        return []
    })

    const [isAccountFormOpen, setIsAccountFormOpen] = useState(false)
    const [editingAccountId, setEditingAccountId] = useState<string | null>(null)
    const [accountForm, setAccountForm] = useState({
        bankName: 'Banco Pichincha',
        customBankName: '',
        accountType: 'Ahorros',
        accountNumber: '',
        accountHolder: '',
        idNumber: '',
        notes: ''
    })
    const [accountFormError, setAccountFormError] = useState('')

    const handleOpenAddAccount = () => {
        setEditingAccountId(null)
        setAccountForm({
            bankName: 'Banco Pichincha',
            customBankName: '',
            accountType: 'Ahorros',
            accountNumber: '',
            accountHolder: '',
            idNumber: '',
            notes: ''
        })
        setAccountFormError('')
        setIsAccountFormOpen(true)
    }

    const handleOpenEditAccount = (acc: BankAccount) => {
        const isKnownBank = ECUADORIAN_BANKS.some(b => b.id === acc.bankName)
        setEditingAccountId(acc.id)
        setAccountForm({
            bankName: isKnownBank ? acc.bankName : 'Otro',
            customBankName: isKnownBank ? '' : acc.bankName,
            accountType: acc.accountType || 'Ahorros',
            accountNumber: acc.accountNumber || '',
            accountHolder: acc.accountHolder || '',
            idNumber: acc.idNumber || '',
            notes: acc.notes || ''
        })
        setAccountFormError('')
        setIsAccountFormOpen(true)
    }

    const handleCloseAccountForm = () => {
        setIsAccountFormOpen(false)
        setEditingAccountId(null)
        setAccountFormError('')
    }

    const handleSaveAccountForm = () => {
        const finalBankName = accountForm.bankName === 'Otro' 
            ? accountForm.customBankName.trim() 
            : accountForm.bankName.trim()

        if (!finalBankName) {
            setAccountFormError('Ingresa el nombre del banco o cooperativa.')
            return
        }
        if (!accountForm.accountNumber.trim()) {
            setAccountFormError('Ingresa el número de cuenta.')
            return
        }
        if (!accountForm.accountHolder.trim()) {
            setAccountFormError('Ingresa el nombre del titular de la cuenta.')
            return
        }

        const newAccountData: BankAccount = {
            id: editingAccountId || `acc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            bankName: finalBankName,
            accountType: accountForm.accountType,
            accountNumber: accountForm.accountNumber.trim(),
            accountHolder: accountForm.accountHolder.trim(),
            idNumber: accountForm.idNumber.trim(),
            notes: accountForm.notes.trim()
        }

        setBankAccounts(prev => {
            if (editingAccountId) {
                return prev.map(a => a.id === editingAccountId ? newAccountData : a)
            }
            return [...prev, newAccountData]
        })

        handleCloseAccountForm()
    }

    const handleDeleteAccount = (accId: string) => {
        if (!confirm('¿Seguro que deseas eliminar esta cuenta bancaria?')) return
        setBankAccounts(prev => prev.filter(a => a.id !== accId))
    }

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
        const loadGroupsAndZones = async () => {
            try {
                const groups = await getCoverageGroups()
                setCoverageGroups(groups)
            } catch (error) {
                console.error('Error loading coverage groups:', error)
            }

            // Cargar zonas de cobertura
            setLoadingZones(true)
            try {
                let z: CoverageZone[] = []
                if (business.groupId) {
                    z = await getCoverageZonesByGroup(business.groupId)
                }
                if (z.length === 0) {
                    const all = await getCoverageZones()
                    z = all.filter(item => !item.businessId && item.isActive)
                } else {
                    z = z.filter(item => item.isActive)
                }
                setAvailableZones(z)

                // Inicializar configuraciones de zonas para las no presentes con la tarifa creada por el admin
                setDeliveryZoneConfigs(prev => {
                    const next = { ...prev }
                    z.forEach(zone => {
                        const adminFee = typeof zone.deliveryFee === 'number' ? zone.deliveryFee : 0
                        if (!next[zone.id]) {
                            next[zone.id] = {
                                zoneId: zone.id,
                                enabled: true,
                                customFee: adminFee
                            }
                        } else if (typeof next[zone.id].customFee !== 'number' || isNaN(next[zone.id].customFee!)) {
                            next[zone.id] = {
                                ...next[zone.id],
                                customFee: adminFee
                            }
                        }
                    })
                    return next
                })
            } catch (error) {
                console.error('Error loading zones in editor:', error)
            } finally {
                setLoadingZones(false)
            }
        }
        loadGroupsAndZones()
        
        if (currentGeoLocation) {
            handlePickupLocationChange(currentGeoLocation.lat, currentGeoLocation.lng)
        }
    }, [currentGeoLocation, business.groupId])

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
            deliveryAssignmentMode: formData.deliveryAssignmentMode,
            groupId: finalGroupId,
            zoneId: finalZoneId,
            pickupSettings: formData.pickupSettings,
            bankAccountMode,
            bankAccounts,
            bankAccount: (() => {
                const first = bankAccounts[0]
                if (!first) return undefined
                return {
                    bankName: first.bankName,
                    accountType: first.accountType,
                    accountNumber: first.accountNumber,
                    accountHolder: first.accountHolder,
                    idNumber: first.idNumber
                }
            })(),
            deliveryZoneSettings: {
                useCustomFees: business.deliveryZoneSettings?.useCustomFees ?? (business.deliveryServiceType === 'self'),
                zones: deliveryZoneConfigs
            }
        })
    }

    const sectionNav = [
        { key: 'identity', label: 'Identidad', icon: 'bi-shop' },
        { key: 'contact', label: 'Contacto', icon: 'bi-telephone' },
        { key: 'schedule', label: 'Horario', icon: 'bi-clock' },
        { key: 'delivery_pickup', label: 'Entrega', icon: 'bi-box-seam' },
        { key: 'payment_methods', label: 'Métodos de pago', icon: 'bi-wallet2' }
    ]

    return (
        <div className="w-full max-w-3xl mx-auto">
            <div className="bg-white rounded-2xl sm:rounded-3xl shadow-sm border border-gray-100 p-4 sm:p-6">
                {/* Navegación de Secciones (Scrollable en móviles con etiquetas visibles) */}
                <div className="flex items-center gap-1.5 sm:gap-2 mb-5 sm:mb-6 overflow-x-auto no-scrollbar py-1 px-1 -mx-1 sm:justify-center">
                            {sectionNav.map((section) => (
                                <button
                                    key={section.key}
                                    type="button"
                                    onClick={() => setActiveSection(section.key as any)}
                                    className={`shrink-0 px-3 py-2 sm:px-4 sm:py-2.5 rounded-xl sm:rounded-2xl font-black text-[11px] sm:text-xs uppercase tracking-wider transition-all duration-300 flex items-center gap-1.5 sm:gap-2 ${activeSection === section.key
                                        ? 'bg-red-600 text-white shadow-md shadow-red-200 scale-[1.02]'
                                        : 'bg-gray-100/90 text-gray-500 hover:bg-gray-200'
                                        }`}
                                >
                                    <i className={`bi ${section.icon} text-xs sm:text-sm`}></i>
                                    <span className="inline">{section.label}</span>
                                </button>
                            ))}
                        </div>

                        {/* Sección: Identidad (Unificada con Visual) */}
                        {activeSection === 'identity' && (
                            <div className="space-y-4 sm:space-y-6 animate-fadeIn">
                                <div className="flex items-center gap-2.5 sm:gap-3 mb-2 sm:mb-4">
                                    <span className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-gray-900 text-white flex items-center justify-center text-xs font-black">1</span>
                                    <h3 className="font-black text-gray-900 uppercase tracking-wider text-xs sm:text-sm">Identidad e Imágenes del Negocio</h3>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
                                    {/* Nombre */}
                                    <div className="space-y-1.5">
                                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">Nombre Comercial</label>
                                        <input
                                            type="text"
                                            name="name"
                                            value={formData.name}
                                            onChange={handleChange}
                                            className="w-full px-4 py-3 sm:px-5 sm:py-4 bg-gray-50 border-2 border-transparent rounded-xl sm:rounded-2xl focus:bg-white focus:ring-4 focus:ring-red-500/5 focus:border-red-500 transition-all duration-300 font-bold text-sm text-gray-900 placeholder:text-gray-300"
                                            placeholder="Pizzería Don Mario"
                                        />
                                    </div>

                                    {/* Username */}
                                    <div className="space-y-1.5">
                                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">ID Único (URL)</label>
                                        <div className="relative group">
                                            <span className="absolute left-4 sm:left-5 top-1/2 -translate-y-1/2 text-gray-400 font-bold">@</span>
                                            <input
                                                type="text"
                                                name="username"
                                                value={formData.username}
                                                onChange={handleChange}
                                                className="w-full pl-9 pr-4 sm:pl-10 sm:pr-5 py-3 sm:py-4 bg-gray-50 border-2 border-transparent rounded-xl sm:rounded-2xl focus:bg-white focus:ring-4 focus:ring-red-500/5 focus:border-red-500 transition-all duration-300 font-bold text-sm text-gray-900 placeholder:text-gray-300"
                                                placeholder="username"
                                            />
                                        </div>
                                        <p className="text-gray-400 text-[9px] font-bold ml-1">fuddi.shop/@{formData.username || '...'}</p>
                                    </div>
                                </div>

                                {/* Tipo de Negocio */}
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">Tipo de Negocio</label>
                                    <div className="grid grid-cols-2 gap-3 sm:gap-4">
                                        <button
                                            type="button"
                                            onClick={() => setFormData(prev => ({ ...prev, businessType: 'food_store', category: '' }))}
                                            className={`p-3 sm:p-4 rounded-xl sm:rounded-2xl border-2 transition-all duration-300 flex flex-col items-center gap-1.5 sm:gap-2 ${formData.businessType === 'food_store'
                                                ? 'border-red-500 bg-red-50 shadow-md ring-1 ring-red-50'
                                                : 'border-gray-100 bg-gray-50/50 hover:border-gray-200'
                                                }`}
                                        >
                                            <i className={`bi bi-shop text-xl sm:text-2xl ${formData.businessType === 'food_store' ? 'text-red-500' : 'text-gray-400'}`}></i>
                                            <span className={`text-[10px] font-black uppercase tracking-wider text-center ${formData.businessType === 'food_store' ? 'text-red-600' : 'text-gray-500'}`}>Comida Preparada</span>
                                        </button>

                                        <button
                                            type="button"
                                            onClick={() => setFormData(prev => ({ ...prev, businessType: 'distributor', category: '' }))}
                                            className={`p-3 sm:p-4 rounded-xl sm:rounded-2xl border-2 transition-all duration-300 flex flex-col items-center gap-1.5 sm:gap-2 ${formData.businessType === 'distributor'
                                                ? 'border-red-500 bg-red-50 shadow-md ring-1 ring-red-50'
                                                : 'border-gray-100 bg-gray-50/50 hover:border-gray-200'
                                                }`}
                                        >
                                            <i className={`bi bi-box-seam text-xl sm:text-2xl ${formData.businessType === 'distributor' ? 'text-red-500' : 'text-gray-400'}`}></i>
                                            <span className={`text-[10px] font-black uppercase tracking-wider text-center ${formData.businessType === 'distributor' ? 'text-red-600' : 'text-gray-500'}`}>Proveedor</span>
                                        </button>
                                    </div>
                                </div>

                                {/* Categoría Dinámica */}
                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">
                                        {formData.businessType === 'food_store' ? 'Especialidad Gastronómica' : 'Rubro de Suministros'}
                                    </label>
                                    <div className="relative">
                                        <select
                                            name="category"
                                            value={formData.category}
                                            onChange={handleChange}
                                            className="w-full px-4 py-3 sm:px-5 sm:py-4 bg-gray-50 border-2 border-transparent rounded-xl sm:rounded-2xl focus:bg-white focus:ring-4 focus:ring-red-500/5 focus:border-red-500 transition-all duration-300 font-bold text-sm text-gray-900 appearance-none"
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
                                        <div className="absolute right-4 sm:right-5 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
                                            <i className="bi bi-chevron-down"></i>
                                        </div>
                                    </div>
                                </div>

                                {/* Descripción */}
                                <div className="space-y-1.5">
                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">Eslogan o Resumen</label>
                                    <textarea
                                        name="description"
                                        value={formData.description}
                                        onChange={handleChange}
                                        rows={2}
                                        className="w-full px-4 py-3 sm:px-5 sm:py-4 bg-gray-50 border-2 border-transparent rounded-xl sm:rounded-2xl focus:bg-white focus:ring-4 focus:ring-red-500/5 focus:border-red-500 transition-all duration-300 font-bold text-sm text-gray-900 placeholder:text-gray-300 resize-none"
                                        placeholder="Cuéntanos qué hace especial a tu negocio..."
                                    />
                                </div>

                                {/* Imágenes: Logo y Portada */}
                                <div className="pt-2">
                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1 block mb-3">Imágenes del Negocio</label>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
                                        {/* Logo */}
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] font-bold text-gray-500 ml-1">Logo</label>
                                            <div
                                                onDragEnter={handleDragLogo}
                                                onDragOver={handleDragLogo}
                                                onDragLeave={handleDragLogo}
                                                onDrop={handleDropLogo}
                                                className={`relative flex flex-col items-center justify-center p-4 rounded-xl sm:rounded-2xl border-2 border-dashed transition-all duration-300 aspect-[4/3] sm:aspect-square ${dragActiveLogo ? 'border-red-500 bg-red-50' : 'border-gray-100 bg-gray-50/50'}`}
                                            >
                                                <input
                                                    type="file"
                                                    accept="image/*"
                                                    onChange={(e) => e.target.files?.[0] && handleLogoChange(e.target.files[0])}
                                                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                                                />

                                                {logoPreview ? (
                                                    <div className="relative w-full h-full rounded-lg sm:rounded-xl overflow-hidden shadow-md">
                                                        <img src={logoPreview} className="w-full h-full object-cover" alt="Logo Preview" />
                                                        <div className="absolute inset-0 bg-black/20 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                                                            <i className="bi bi-pencil-square text-white text-xl"></i>
                                                        </div>
                                                        {uploadingLogo && (
                                                            <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                                                                <div className="w-7 h-7 border-3 border-white/20 border-t-white rounded-full animate-spin"></div>
                                                            </div>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <>
                                                        <div className="w-10 h-10 bg-white rounded-xl shadow-sm flex items-center justify-center text-gray-400 mb-1.5">
                                                            <i className="bi bi-image text-lg"></i>
                                                        </div>
                                                        <p className="text-gray-900 font-black text-xs">Subir Logo</p>
                                                        <p className="text-gray-400 text-[8px] font-bold uppercase tracking-wider mt-0.5 text-center">Cuadrado recomendado</p>
                                                    </>
                                                )}
                                            </div>
                                        </div>

                                        {/* Portada */}
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] font-bold text-gray-500 ml-1">Portada</label>
                                            <div
                                                onDragEnter={handleDragCover}
                                                onDragOver={handleDragCover}
                                                onDragLeave={handleDragCover}
                                                onDrop={handleDropCover}
                                                className={`relative flex flex-col items-center justify-center p-4 rounded-xl sm:rounded-2xl border-2 border-dashed transition-all duration-300 aspect-[4/3] sm:aspect-square ${dragActiveCover ? 'border-red-500 bg-red-50' : 'border-gray-100 bg-gray-50/50'}`}
                                            >
                                                <input
                                                    type="file"
                                                    accept="image/*"
                                                    onChange={(e) => e.target.files?.[0] && handleCoverChange(e.target.files[0])}
                                                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                                                />

                                                {coverPreview ? (
                                                    <div className="relative w-full h-full rounded-lg sm:rounded-xl overflow-hidden shadow-md">
                                                        <img src={coverPreview} className="w-full h-full object-cover" alt="Cover Preview" />
                                                        <div className="absolute inset-0 bg-black/20 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                                                            <i className="bi bi-pencil-square text-white text-xl"></i>
                                                        </div>
                                                        {uploadingCover && (
                                                            <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                                                                <div className="w-7 h-7 border-3 border-white/20 border-t-white rounded-full animate-spin"></div>
                                                            </div>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <>
                                                        <div className="w-10 h-10 bg-white rounded-xl shadow-sm flex items-center justify-center text-gray-400 mb-1.5">
                                                            <i className="bi bi-aspect-ratio text-lg"></i>
                                                        </div>
                                                        <p className="text-gray-900 font-black text-xs">Subir Portada</p>
                                                        <p className="text-gray-400 text-[8px] font-bold uppercase tracking-wider mt-0.5 text-center">Horizontal recomendado</p>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Estado del negocio */}
                                <div className="grid grid-cols-2 gap-3 sm:gap-4 pt-2">
                                    <div className="space-y-1.5">
                                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">Estado</label>
                                        <button
                                            type="button"
                                            onClick={() => setFormData(prev => ({ ...prev, isActive: !prev.isActive }))}
                                            className={`w-full p-3.5 sm:p-4 rounded-xl sm:rounded-2xl border-2 transition-all duration-300 flex items-center justify-center gap-2 ${formData.isActive
                                                ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                                                : 'border-gray-200 bg-gray-50 text-gray-500'
                                                }`}
                                        >
                                            <i className={`bi ${formData.isActive ? 'bi-check-circle-fill' : 'bi-x-circle'}`}></i>
                                            <span className="font-bold text-xs sm:text-sm">{formData.isActive ? 'Activo' : 'Inactivo'}</span>
                                        </button>
                                    </div>

                                    <div className="space-y-1.5">
                                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">Visibilidad</label>
                                        <button
                                            type="button"
                                            onClick={() => setFormData(prev => ({ ...prev, isHidden: !prev.isHidden }))}
                                            className={`w-full p-3.5 sm:p-4 rounded-xl sm:rounded-2xl border-2 transition-all duration-300 flex flex-row items-center justify-center gap-2 ${!formData.isHidden
                                                ? 'border-blue-500 bg-blue-50 text-blue-700'
                                                : 'border-gray-200 bg-gray-50 text-gray-500'
                                                }`}
                                        >
                                            <i className={`bi ${!formData.isHidden ? 'bi-eye-fill' : 'bi-eye-slash'}`}></i>
                                            <span className="font-bold text-xs sm:text-sm">{!formData.isHidden ? 'Visible' : 'Oculto'}</span>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Sección: Contacto */}
                        {activeSection === 'contact' && (
                            <div className="space-y-4 sm:space-y-6 animate-fadeIn">
                                <div className="flex items-center gap-2.5 sm:gap-3 mb-2 sm:mb-4">
                                    <span className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-gray-900 text-white flex items-center justify-center text-xs font-black">2</span>
                                    <h3 className="font-black text-gray-900 uppercase tracking-wider text-xs sm:text-sm">Contacto</h3>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
                                    {/* Teléfono */}
                                    <div className="space-y-1.5">
                                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">WhatsApp de Pedidos</label>
                                        <input
                                            type="tel"
                                            name="phone"
                                            value={formData.phone}
                                            onChange={handleChange}
                                            className="w-full px-4 py-3 sm:px-5 sm:py-4 bg-gray-50 border-2 border-transparent rounded-xl sm:rounded-2xl focus:bg-white focus:ring-4 focus:ring-red-500/5 focus:border-red-500 transition-all duration-300 font-bold text-sm text-gray-900 placeholder:text-gray-300"
                                            placeholder="09XXXXXXXX"
                                        />
                                    </div>

                                    {/* Email */}
                                    <div className="space-y-1.5">
                                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">Email</label>
                                        <input
                                            type="email"
                                            name="email"
                                            value={formData.email}
                                            onChange={handleChange}
                                            className="w-full px-4 py-3 sm:px-5 sm:py-4 bg-gray-50 border-2 border-transparent rounded-xl sm:rounded-2xl focus:bg-white focus:ring-4 focus:ring-red-500/5 focus:border-red-500 transition-all duration-300 font-bold text-sm text-gray-900 placeholder:text-gray-300"
                                            placeholder="correo@ejemplo.com"
                                        />
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Sección: Horario */}
                        {activeSection === 'schedule' && (
                            <div className="space-y-4 sm:space-y-6 animate-fadeIn">
                                <div className="flex items-center gap-2.5 sm:gap-3 mb-2 sm:mb-4">
                                    <span className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-gray-900 text-white flex items-center justify-center text-xs font-black">3</span>
                                    <h3 className="font-black text-gray-900 uppercase tracking-wider text-xs sm:text-sm">Horario de Atención</h3>
                                </div>

                                {/* Tarjeta de Tiempo de Entrega Optimizada */}
                                <div className="p-3.5 sm:p-5 bg-gradient-to-r from-red-50/70 to-orange-50/40 border border-red-100/80 rounded-2xl sm:rounded-3xl mb-4 sm:mb-6 shadow-sm">
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                                            <div className="w-9 h-9 sm:w-10 sm:h-10 bg-red-600 rounded-xl flex items-center justify-center text-white shadow-md shadow-red-200 shrink-0">
                                                <i className="bi bi-clock-history text-base sm:text-lg"></i>
                                            </div>
                                            <div className="min-w-0">
                                                <h4 className="text-xs sm:text-sm font-black text-gray-900 uppercase tracking-tight truncate">Tiempo de Preparación</h4>
                                                <p className="text-[10px] text-gray-500 font-medium truncate">Estimado en minutos</p>
                                            </div>
                                        </div>
                                        <div className="relative w-28 sm:w-32 shrink-0">
                                            <input
                                                type="number"
                                                name="deliveryTime"
                                                value={formData.deliveryTime}
                                                onChange={handleChange}
                                                min="1"
                                                className="w-full pl-3 pr-9 py-2 sm:py-2.5 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500/20 focus:border-red-500 transition-all font-black text-gray-900 text-center text-sm shadow-sm"
                                                placeholder="30"
                                            />
                                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 font-black text-[9px] uppercase pointer-events-none">MIN</span>
                                        </div>
                                    </div>
                                </div>

                                {/* Días de la Semana */}
                                <div className="space-y-2 sm:space-y-3">
                                    {days.map((day) => {
                                        const daySchedule = schedule[day.key] || { open: '09:00', close: '18:00', isOpen: true }
                                        return (
                                            <div key={day.key} className={`p-3 sm:p-4 rounded-xl sm:rounded-2xl transition-all duration-200 ${daySchedule.isOpen ? 'bg-emerald-50/40 border border-emerald-100/80' : 'bg-gray-50/60 border border-gray-100'}`}>
                                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3">
                                                    <div className="flex items-center gap-2.5">
                                                        <button
                                                            type="button"
                                                            onClick={() => handleScheduleChange(day.key, 'isOpen', !daySchedule.isOpen)}
                                                            className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center transition-all ${daySchedule.isOpen ? 'bg-emerald-500 text-white shadow-sm shadow-emerald-200' : 'bg-gray-200 text-gray-400'}`}
                                                        >
                                                            <i className={`bi ${daySchedule.isOpen ? 'bi-check-lg' : 'bi-x-lg'} text-base`}></i>
                                                        </button>
                                                        <span className={`font-bold text-xs sm:text-sm ${daySchedule.isOpen ? 'text-gray-900' : 'text-gray-400'}`}>{day.label}</span>
                                                    </div>

                                                    {daySchedule.isOpen && (
                                                        <div className="flex items-center gap-1.5 sm:gap-2 ml-11 sm:ml-0">
                                                            <input
                                                                type="time"
                                                                value={daySchedule.open}
                                                                onChange={(e) => handleScheduleChange(day.key, 'open', e.target.value)}
                                                                className="px-2.5 py-1.5 sm:px-3 sm:py-2 bg-white border border-gray-200 rounded-xl text-xs sm:text-sm font-bold text-gray-800 shadow-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none"
                                                            />
                                                            <span className="text-gray-400 text-xs font-bold px-0.5">a</span>
                                                            <input
                                                                type="time"
                                                                value={daySchedule.close}
                                                                onChange={(e) => handleScheduleChange(day.key, 'close', e.target.value)}
                                                                className="px-2.5 py-1.5 sm:px-3 sm:py-2 bg-white border border-gray-200 rounded-xl text-xs sm:text-sm font-bold text-gray-800 shadow-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none"
                                                            />
                                                        </div>
                                                    )}

                                                    {!daySchedule.isOpen && (
                                                        <span className="text-gray-400 text-xs font-bold uppercase tracking-wider ml-11 sm:ml-0">Cerrado</span>
                                                    )}
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Section: Entrega (Subpestañas: Retiro en tienda y Delivery) */}
                        {activeSection === 'delivery_pickup' && (
                            <div className="space-y-6 animate-fadeIn">
                                {/* Sub-pestañas internas */}
                                <div className="flex bg-gray-100/80 p-1 rounded-2xl gap-1 max-w-xs mx-auto">
                                    <button
                                        type="button"
                                        onClick={() => setDeliverySubSection('pickup')}
                                        className={`flex-1 py-2 px-3 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 ${
                                            deliverySubSection === 'pickup'
                                                ? 'bg-white text-gray-900 shadow-sm'
                                                : 'text-gray-500 hover:text-gray-700'
                                        }`}
                                    >
                                        <i className="bi bi-shop-window text-sm"></i>
                                        <span>Retiro en tienda</span>
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => setDeliverySubSection('delivery')}
                                        className={`flex-1 py-2 px-3 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 ${
                                            deliverySubSection === 'delivery'
                                                ? 'bg-white text-gray-900 shadow-sm'
                                                : 'text-gray-500 hover:text-gray-700'
                                        }`}
                                    >
                                        <i className="bi bi-scooter text-sm"></i>
                                        <span>Delivery</span>
                                    </button>
                                </div>

                                {/* CONTENIDO SUB-PESTAÑA 1: RETIRO EN TIENDA */}
                                {deliverySubSection === 'pickup' && (
                                    <div className="space-y-4 animate-fadeIn">
                                        {/* Selector de Estado de Retiro */}
                                        <div className="grid grid-cols-3 gap-2">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    handlePickupChange('enabled', false)
                                                    handlePickupChange('restrictToPrevious', false)
                                                }}
                                                className={`py-2.5 px-3 rounded-xl border text-center transition-all ${
                                                    !formData.pickupSettings.enabled
                                                        ? 'border-gray-900 bg-gray-900 text-white font-black shadow-sm'
                                                        : 'border-gray-200 bg-gray-50/50 text-gray-600 hover:bg-gray-100 font-bold'
                                                }`}
                                            >
                                                <span className="text-[11px] block">Desactivado</span>
                                            </button>

                                            <button
                                                type="button"
                                                onClick={() => {
                                                    handlePickupChange('enabled', true)
                                                    handlePickupChange('restrictToPrevious', false)
                                                }}
                                                className={`py-2.5 px-3 rounded-xl border text-center transition-all ${
                                                    formData.pickupSettings.enabled && !formData.pickupSettings.restrictToPrevious
                                                        ? 'border-gray-900 bg-gray-900 text-white font-black shadow-sm'
                                                        : 'border-gray-200 bg-gray-50/50 text-gray-600 hover:bg-gray-100 font-bold'
                                                }`}
                                            >
                                                <span className="text-[11px] block">Habilitado</span>
                                            </button>

                                            <button
                                                type="button"
                                                onClick={() => {
                                                    handlePickupChange('enabled', true)
                                                    handlePickupChange('restrictToPrevious', true)
                                                }}
                                                className={`py-2.5 px-3 rounded-xl border text-center transition-all ${
                                                    formData.pickupSettings.enabled && formData.pickupSettings.restrictToPrevious
                                                        ? 'border-gray-900 bg-gray-900 text-white font-black shadow-sm'
                                                        : 'border-gray-200 bg-gray-50/50 text-gray-600 hover:bg-gray-100 font-bold'
                                                }`}
                                            >
                                                <span className="text-[11px] block">Solo Frecuentes</span>
                                            </button>
                                        </div>

                                        {formData.pickupSettings.enabled && (
                                            <div className="space-y-4 pt-2 animate-fadeIn">
                                                {/* Referencias */}
                                                <div className="space-y-1">
                                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-wider ml-1">Instrucciones / Referencias de Retiro</label>
                                                    <input
                                                        type="text"
                                                        value={formData.pickupSettings.references}
                                                        onChange={(e) => handlePickupChange('references', e.target.value)}
                                                        className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:border-gray-900 font-bold text-xs text-gray-900 outline-none transition-all"
                                                        placeholder="Ej: Retirar por ventanilla lateral frente al parque"
                                                    />
                                                </div>

                                                {/* Mapa y Foto de Referencia de Fachada */}
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                    {/* Mapa */}
                                                    <div className="space-y-2">
                                                        <div className="flex items-center justify-between px-1">
                                                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Ubicación en el Mapa</label>
                                                            <button
                                                                type="button"
                                                                onClick={() => getCurrentLocation()}
                                                                disabled={locating}
                                                                className="text-[10px] font-black text-rose-600 hover:text-rose-700 uppercase tracking-wider flex items-center gap-1"
                                                            >
                                                                <i className={`bi ${locating ? 'animate-spin bi-arrow-repeat' : 'bi-geo-alt-fill'}`}></i>
                                                                {locating ? 'Localizando...' : 'Mi Ubicación'}
                                                            </button>
                                                        </div>
                                                        <div className="rounded-2xl overflow-hidden border border-gray-200 h-[190px] relative shadow-inner">
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
                                                    </div>

                                                    {/* Foto de Referencia de Fachada */}
                                                    <div className="space-y-2">
                                                        <div className="flex items-center justify-between px-1">
                                                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Foto de Referencia del Local</label>
                                                            {formData.pickupSettings.storePhotoUrl && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handlePickupChange('storePhotoUrl', '')}
                                                                    className="text-[10px] font-bold text-red-500 hover:text-red-700 uppercase tracking-wider"
                                                                >
                                                                    Eliminar
                                                                </button>
                                                            )}
                                                        </div>

                                                        <div
                                                            onDragOver={(e) => { e.preventDefault(); setDragActivePickup(true); }}
                                                            onDragLeave={() => setDragActivePickup(false)}
                                                            onDrop={(e) => {
                                                                e.preventDefault();
                                                                setDragActivePickup(false);
                                                                if (e.dataTransfer.files?.[0]) handlePickupPhotoChange(e.dataTransfer.files[0]);
                                                            }}
                                                            onClick={() => document.getElementById('pickup-photo-input')?.click()}
                                                            className={`h-[190px] rounded-2xl border-2 border-dashed transition-all flex flex-col items-center justify-center gap-2 cursor-pointer overflow-hidden relative group ${
                                                                dragActivePickup ? 'border-rose-500 bg-rose-50' : 'border-gray-200 bg-gray-50/70 hover:bg-white hover:border-gray-300'
                                                            }`}
                                                        >
                                                            {formData.pickupSettings.storePhotoUrl ? (
                                                                <div className="relative w-full h-full">
                                                                    <img
                                                                        src={formData.pickupSettings.storePhotoUrl}
                                                                        alt="Fachada del Local"
                                                                        className="w-full h-full object-cover"
                                                                    />
                                                                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs font-bold gap-1.5">
                                                                        <i className="bi bi-camera text-base"></i>
                                                                        <span>Cambiar Foto</span>
                                                                    </div>
                                                                </div>
                                                            ) : uploadingPickupPhoto ? (
                                                                <div className="flex flex-col items-center gap-2">
                                                                    <div className="w-6 h-6 border-2 border-gray-900 border-t-transparent rounded-full animate-spin"></div>
                                                                    <span className="text-[10px] font-bold text-gray-500">Subiendo...</span>
                                                                </div>
                                                            ) : (
                                                                <div className="flex flex-col items-center gap-1.5 text-center p-3">
                                                                    <div className="w-10 h-10 rounded-xl bg-white shadow-sm flex items-center justify-center text-gray-400 text-lg group-hover:scale-105 transition-transform">
                                                                        <i className="bi bi-camera"></i>
                                                                    </div>
                                                                    <span className="text-[11px] font-bold text-gray-600">Subir foto de la fachada</span>
                                                                    <span className="text-[10px] text-gray-400">Ayuda a tus clientes a identificar tu local</span>
                                                                </div>
                                                            )}
                                                            <input
                                                                id="pickup-photo-input"
                                                                type="file"
                                                                className="hidden"
                                                                accept="image/*"
                                                                onChange={(e) => e.target.files?.[0] && handlePickupPhotoChange(e.target.files[0])}
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* CONTENIDO SUB-PESTAÑA 2: DELIVERY */}
                                {deliverySubSection === 'delivery' && (
                                    <div className="space-y-6 animate-fadeIn">
                                        {/* Selector de Modo: Autogestión | Delivery Fuddi */}
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                            {/* Opción 1: Autogestión (Activa) */}
                                            <div className="p-3 rounded-2xl border-2 border-gray-900 bg-gray-900 text-white shadow-sm flex items-center justify-between gap-2">
                                                <div className="flex items-center gap-2.5 min-w-0">
                                                    <div className="w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
                                                        <i className="bi bi-person-gear"></i>
                                                    </div>
                                                    <div className="min-w-0">
                                                        <p className="font-black text-xs uppercase tracking-wider leading-tight">Autogestión</p>
                                                        <p className="text-[10px] text-gray-300 font-medium truncate">Tus repartidores y tarifas</p>
                                                    </div>
                                                </div>
                                                <div className="w-4 h-4 rounded-full bg-white text-gray-900 flex items-center justify-center text-[10px] font-black flex-shrink-0">
                                                    <i className="bi bi-check"></i>
                                                </div>
                                            </div>

                                            {/* Opción 2: Delivery Fuddi (Opaco por suscripción con botón WhatsApp) */}
                                            <div className="p-3 rounded-2xl border border-gray-200 bg-gray-50/80 text-gray-400 flex items-center justify-between gap-2">
                                                <div className="flex items-center gap-2.5 min-w-0 opacity-70">
                                                    <div className="w-7 h-7 rounded-lg bg-gray-200/80 flex items-center justify-center text-xs font-bold text-gray-500 flex-shrink-0">
                                                        <i className="bi bi-rocket-takeoff"></i>
                                                    </div>
                                                    <div className="min-w-0">
                                                        <div className="flex items-center gap-1.5 flex-wrap">
                                                            <p className="font-black text-xs uppercase tracking-wider text-gray-600 leading-tight">Delivery Fuddi</p>
                                                            <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-amber-100/90 text-amber-800 flex items-center gap-0.5">
                                                                <i className="bi bi-lock-fill text-[8px]"></i>
                                                                Suscripción
                                                            </span>
                                                        </div>
                                                        <p className="text-[10px] text-gray-400 font-medium truncate">Repartidores de la plataforma</p>
                                                    </div>
                                                </div>

                                                {/* Botón WhatsApp */}
                                                <a
                                                    href={`https://wa.me/593990815097?text=${encodeURIComponent('Hola, me gustaría suscribir mi tienda a la red de repartidores de Fuddi')}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    title="Solicitar suscripción por WhatsApp"
                                                    className="px-2.5 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-[10px] flex items-center gap-1.5 transition-all shadow-sm flex-shrink-0 hover:scale-105 active:scale-95"
                                                >
                                                    <i className="bi bi-whatsapp text-xs"></i>
                                                    <span>Solicitar</span>
                                                </a>
                                            </div>
                                        </div>

                                        {/* Modo de Asignación de Delivery al Confirmar Orden */}
                                        <div className="border-t border-gray-100 pt-5 space-y-3">
                                            <div className="px-1">
                                                <h3 className="font-black text-gray-900 uppercase tracking-wider text-xs">
                                                    Asignación de Delivery al Confirmar
                                                </h3>
                                                <p className="text-[11px] text-gray-500 font-medium mt-0.5">
                                                    Elige si deseas que el repartidor se asigne automáticamente al confirmar un pedido o asignarlo de forma manual.
                                                </p>
                                            </div>

                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                {/* Opción 1: Automática */}
                                                <button
                                                    type="button"
                                                    onClick={() => setFormData(prev => ({ ...prev, deliveryAssignmentMode: 'auto' }))}
                                                    className={`p-3.5 rounded-2xl border-2 text-left transition-all flex flex-col justify-between gap-3 cursor-pointer ${
                                                        formData.deliveryAssignmentMode !== 'manual'
                                                            ? 'border-gray-900 bg-gray-900 text-white shadow-sm'
                                                            : 'border-gray-200 bg-white hover:border-gray-300 text-gray-700'
                                                    }`}
                                                >
                                                    <div className="flex items-start justify-between gap-2 w-full">
                                                        <div className="flex items-center gap-2.5">
                                                            <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-sm font-bold flex-shrink-0 ${
                                                                formData.deliveryAssignmentMode !== 'manual'
                                                                    ? 'bg-white/10 text-amber-300'
                                                                    : 'bg-gray-100 text-gray-600'
                                                            }`}>
                                                                <i className="bi bi-lightning-charge-fill"></i>
                                                            </div>
                                                            <div>
                                                                <p className="font-black text-xs uppercase tracking-wider leading-tight">
                                                                    Automática
                                                                </p>
                                                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full inline-block mt-0.5 ${
                                                                    formData.deliveryAssignmentMode !== 'manual'
                                                                        ? 'bg-amber-400/20 text-amber-300'
                                                                        : 'bg-gray-100 text-gray-500'
                                                                }`}>
                                                                    Al confirmar orden
                                                                </span>
                                                            </div>
                                                        </div>
                                                        <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-black flex-shrink-0 mt-0.5 ${
                                                            formData.deliveryAssignmentMode !== 'manual'
                                                                ? 'bg-white text-gray-900'
                                                                : 'border border-gray-300 text-transparent'
                                                        }`}>
                                                            <i className="bi bi-check"></i>
                                                        </div>
                                                    </div>
                                                    <p className={`text-[11px] font-medium leading-relaxed ${
                                                        formData.deliveryAssignmentMode !== 'manual'
                                                            ? 'text-gray-300'
                                                            : 'text-gray-500'
                                                    }`}>
                                                        Al confirmar un pedido (desde Telegram, Dashboard o Correo), se asigna de inmediato el repartidor predeterminado.
                                                    </p>
                                                </button>

                                                {/* Opción 2: Manual */}
                                                <button
                                                    type="button"
                                                    onClick={() => setFormData(prev => ({ ...prev, deliveryAssignmentMode: 'manual' }))}
                                                    className={`p-3.5 rounded-2xl border-2 text-left transition-all flex flex-col justify-between gap-3 cursor-pointer ${
                                                        formData.deliveryAssignmentMode === 'manual'
                                                            ? 'border-gray-900 bg-gray-900 text-white shadow-sm'
                                                            : 'border-gray-200 bg-white hover:border-gray-300 text-gray-700'
                                                    }`}
                                                >
                                                    <div className="flex items-start justify-between gap-2 w-full">
                                                        <div className="flex items-center gap-2.5">
                                                            <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-sm font-bold flex-shrink-0 ${
                                                                formData.deliveryAssignmentMode === 'manual'
                                                                    ? 'bg-white/10 text-white'
                                                                    : 'bg-gray-100 text-gray-600'
                                                            }`}>
                                                                <i className="bi bi-hand-index-thumb"></i>
                                                            </div>
                                                            <div>
                                                                <p className="font-black text-xs uppercase tracking-wider leading-tight">
                                                                    Manual
                                                                </p>
                                                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full inline-block mt-0.5 ${
                                                                    formData.deliveryAssignmentMode === 'manual'
                                                                        ? 'bg-white/20 text-gray-200'
                                                                        : 'bg-gray-100 text-gray-500'
                                                                }`}>
                                                                    Tú decides cada orden
                                                                </span>
                                                            </div>
                                                        </div>
                                                        <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-black flex-shrink-0 mt-0.5 ${
                                                            formData.deliveryAssignmentMode === 'manual'
                                                                ? 'bg-white text-gray-900'
                                                                : 'border border-gray-300 text-transparent'
                                                        }`}>
                                                            <i className="bi bi-check"></i>
                                                        </div>
                                                    </div>
                                                    <p className={`text-[11px] font-medium leading-relaxed ${
                                                        formData.deliveryAssignmentMode === 'manual'
                                                            ? 'text-gray-300'
                                                            : 'text-gray-500'
                                                    }`}>
                                                        Al confirmar el pedido no se asigna ningún repartidor; queda pendiente para que lo elijas y asignes tú mismo desde el Dashboard.
                                                    </p>
                                                </button>
                                            </div>
                                        </div>

                                        {/* 1. Repartidores de la Tienda */}
                                        <div className="border-t border-gray-100 pt-5">
                                            <DeliveryConfigSection
                                                businessId={business.id}
                                                defaultDeliveryId={formData.defaultDeliveryId}
                                                onDeliverySelect={(id) => setFormData(prev => ({ ...prev, defaultDeliveryId: id }))}
                                                onDeliveriesLoaded={setStoreDeliveries}
                                            />
                                        </div>

                                        {/* 2. Tarifas por Sector (Formato Tabla Compacta con Repartidor por Zona) */}
                                        <div className="border-t border-gray-100 pt-6 space-y-3">
                                            <div className="flex items-center justify-between px-1">
                                                <h3 className="font-black text-gray-900 uppercase tracking-wider text-xs">Tarifas por Sector</h3>
                                                <span className="text-[11px] font-bold text-gray-400">
                                                    {availableZones.length} sectores
                                                </span>
                                            </div>

                                            {loadingZones ? (
                                                <div className="py-6 flex items-center justify-center text-gray-400 gap-2">
                                                    <div className="w-4 h-4 border-2 border-gray-900 border-t-transparent rounded-full animate-spin"></div>
                                                    <span className="text-xs font-bold">Cargando sectores...</span>
                                                </div>
                                            ) : availableZones.length === 0 ? (
                                                <div className="p-4 bg-gray-50 rounded-xl border border-dashed border-gray-200 text-center text-gray-500 text-xs font-bold">
                                                    No hay zonas registradas para tu ciudad.
                                                </div>
                                            ) : (
                                                <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
                                                    {/* Cabecera de la Tabla */}
                                                    <div className="flex items-center justify-between px-3.5 py-2 bg-gray-50/80 border-b border-gray-100 text-[10px] font-black uppercase tracking-wider text-gray-400">
                                                        <div className="flex-1 min-w-0">Sector</div>
                                                        <div className="w-28 sm:w-32 text-left px-1 flex-shrink-0">Repartidor</div>
                                                        <div className="w-13 text-center flex-shrink-0">Estado</div>
                                                        <div className="w-20 text-right flex-shrink-0 pr-0.5">Tarifa ($)</div>
                                                    </div>

                                                    {/* Filas de la Tabla */}
                                                    <div className="divide-y divide-gray-100 max-h-[320px] overflow-y-auto">
                                                        {availableZones.map((zone) => {
                                                            const defaultAdminFee = typeof zone.deliveryFee === 'number' ? zone.deliveryFee : 0
                                                            const config = deliveryZoneConfigs[zone.id] || {
                                                                zoneId: zone.id,
                                                                enabled: true,
                                                                customFee: defaultAdminFee
                                                            }
                                                            const isEnabled = config.enabled !== false
                                                            const currentFee = (typeof config.customFee === 'number' && !isNaN(config.customFee)) ? config.customFee : defaultAdminFee
                                                            const isCustomized = currentFee !== defaultAdminFee
                                                            const zoneDeliveryId = config.defaultDeliveryId || ''

                                                            return (
                                                                <div
                                                                    key={zone.id}
                                                                    className={`flex items-center justify-between px-3.5 py-2 gap-2 transition-colors ${
                                                                        !isEnabled ? 'bg-gray-50/60 opacity-60' : 'hover:bg-gray-50/50'
                                                                    }`}
                                                                >
                                                                    {/* Columna Sector */}
                                                                    <div className="flex-1 min-w-0 pr-1">
                                                                        <div className="flex items-center gap-1.5">
                                                                            <span className="font-bold text-xs text-gray-900 truncate" title={zone.name}>
                                                                                {zone.name}
                                                                            </span>
                                                                            {isCustomized && isEnabled && (
                                                                                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" title="Tarifa personalizada" />
                                                                            )}
                                                                        </div>
                                                                    </div>

                                                                    {/* Columna Repartidor por Sector */}
                                                                    <div className="w-28 sm:w-32 px-1 flex-shrink-0">
                                                                        {isEnabled ? (
                                                                            <select
                                                                                value={zoneDeliveryId}
                                                                                onChange={(e) => {
                                                                                    const selectedId = e.target.value
                                                                                    setDeliveryZoneConfigs(prev => ({
                                                                                        ...prev,
                                                                                        [zone.id]: {
                                                                                            zoneId: zone.id,
                                                                                            enabled: isEnabled,
                                                                                            customFee: currentFee,
                                                                                            defaultDeliveryId: selectedId ? selectedId : undefined
                                                                                        }
                                                                                    }))
                                                                                }}
                                                                                className={`w-full py-0.5 px-1.5 text-[10px] font-bold rounded-lg border outline-none transition-all cursor-pointer truncate ${
                                                                                    zoneDeliveryId
                                                                                        ? 'bg-blue-50/70 border-blue-200 text-blue-900 font-black'
                                                                                        : 'bg-gray-50 hover:bg-white border-gray-200 text-gray-600'
                                                                                }`}
                                                                            >
                                                                                <option value="">Predeterminado</option>
                                                                                {storeDeliveries.map((driver) => (
                                                                                    <option key={driver.id} value={driver.id}>
                                                                                        {driver.nombres}
                                                                                    </option>
                                                                                ))}
                                                                            </select>
                                                                        ) : (
                                                                            <span className="text-[10px] font-bold text-gray-300 pl-2">-</span>
                                                                        )}
                                                                    </div>

                                                                    {/* Columna Estado (Minimalista) */}
                                                                    <div className="w-13 flex justify-center flex-shrink-0">
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => {
                                                                                setDeliveryZoneConfigs(prev => ({
                                                                                    ...prev,
                                                                                    [zone.id]: {
                                                                                        zoneId: zone.id,
                                                                                        enabled: !isEnabled,
                                                                                        customFee: currentFee,
                                                                                        defaultDeliveryId: zoneDeliveryId || undefined
                                                                                    }
                                                                                }))
                                                                            }}
                                                                            className={`w-12 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider transition-all text-center ${
                                                                                isEnabled
                                                                                    ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200'
                                                                                    : 'bg-gray-100 text-gray-400 hover:bg-gray-200 border border-gray-200/60'
                                                                            }`}
                                                                        >
                                                                            {isEnabled ? 'Activo' : 'Pausa'}
                                                                        </button>
                                                                    </div>

                                                                    {/* Columna Tarifa */}
                                                                    <div className="w-20 flex items-center justify-end gap-1 flex-shrink-0">
                                                                        {isEnabled ? (
                                                                            <>
                                                                                <div className="relative w-[60px]">
                                                                                    <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-gray-400 text-[10px] font-bold pointer-events-none">$</span>
                                                                                    <input
                                                                                        type="number"
                                                                                        min="0"
                                                                                        step="0.25"
                                                                                        value={currentFee}
                                                                                        onChange={(e) => {
                                                                                            const raw = e.target.value
                                                                                            const val = raw === '' ? defaultAdminFee : parseFloat(raw)
                                                                                            setDeliveryZoneConfigs(prev => ({
                                                                                                ...prev,
                                                                                                [zone.id]: {
                                                                                                    zoneId: zone.id,
                                                                                                    enabled: isEnabled,
                                                                                                    customFee: isNaN(val) ? defaultAdminFee : Math.max(0, val),
                                                                                                    defaultDeliveryId: zoneDeliveryId || undefined
                                                                                                }
                                                                                            }))
                                                                                        }}
                                                                                        className="w-full pl-4 pr-1 py-0.5 bg-gray-50 focus:bg-white border border-gray-200 focus:border-gray-900 rounded-md text-xs font-black text-gray-900 text-right outline-none transition-all shadow-inner"
                                                                                        placeholder={defaultAdminFee.toFixed(2)}
                                                                                    />
                                                                                </div>

                                                                                {isCustomized && (
                                                                                    <button
                                                                                        type="button"
                                                                                        onClick={() => {
                                                                                            setDeliveryZoneConfigs(prev => ({
                                                                                                ...prev,
                                                                                                [zone.id]: {
                                                                                                    zoneId: zone.id,
                                                                                                    enabled: isEnabled,
                                                                                                    customFee: defaultAdminFee,
                                                                                                    defaultDeliveryId: zoneDeliveryId || undefined
                                                                                                }
                                                                                            }))
                                                                                        }}
                                                                                        title={`Restablecer al valor por defecto ($${defaultAdminFee.toFixed(2)})`}
                                                                                        className="p-0.5 text-gray-400 hover:text-gray-900 rounded transition-colors text-xs flex-shrink-0"
                                                                                    >
                                                                                        <i className="bi bi-arrow-counterclockwise"></i>
                                                                                    </button>
                                                                                )}
                                                                            </>
                                                                        ) : (
                                                                            <span className="text-xs font-bold text-gray-300 pr-3">-</span>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            )
                                                        })}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Sección: Métodos de Pago */}
                        {activeSection === 'payment_methods' && (
                            <div className="space-y-5 sm:space-y-6 animate-fadeIn">
                                {/* Encabezado */}
                                <div className="pb-3 border-b border-gray-100 flex items-center gap-2.5 sm:gap-3">
                                    <span className="w-8 h-8 rounded-full bg-gray-900 text-white flex items-center justify-center text-xs font-black shrink-0">
                                        <i className="bi bi-wallet2 text-xs"></i>
                                    </span>
                                    <div>
                                        <h3 className="font-black text-gray-900 uppercase tracking-wider text-xs sm:text-sm">
                                            Métodos de Pago y Transferencias
                                        </h3>
                                        <p className="text-[11px] text-gray-500 font-medium leading-tight">
                                            Elige qué cuentas bancarias se mostrarán a tus clientes al momento de pagar por transferencia.
                                        </p>
                                    </div>
                                </div>

                                {/* Selector de Modo: Cuentas de Fuddi vs Cuentas Propias */}
                                <div className="space-y-2">
                                    <label className="block text-[11px] font-black text-gray-700 uppercase tracking-wider">
                                        Origen de las Cuentas Bancarias
                                    </label>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        {/* Opción Fuddi */}
                                        <button
                                            type="button"
                                            onClick={() => setBankAccountMode('fuddi')}
                                            className={`p-4 rounded-2xl border-2 text-left transition-all flex flex-col justify-between gap-2.5 relative cursor-pointer ${
                                                bankAccountMode === 'fuddi'
                                                    ? 'border-gray-900 bg-gray-900 text-white shadow-md'
                                                    : 'border-gray-200 bg-white hover:border-gray-300 text-gray-700'
                                            }`}
                                        >
                                            <div className="flex items-start justify-between gap-2 w-full">
                                                <div className="flex items-center gap-2.5">
                                                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-base ${
                                                        bankAccountMode === 'fuddi' ? 'bg-white/20 text-white' : 'bg-red-50 text-red-600'
                                                    }`}>
                                                        <i className="bi bi-shield-check"></i>
                                                    </div>
                                                    <div>
                                                        <h4 className="font-black text-xs sm:text-sm tracking-tight leading-tight">
                                                            Cuentas de Fuddi
                                                        </h4>
                                                        <span className={`text-[9px] uppercase font-bold px-1.5 py-0.5 rounded-full inline-block mt-0.5 ${
                                                            bankAccountMode === 'fuddi' ? 'bg-white/20 text-gray-200' : 'bg-gray-100 text-gray-500'
                                                        }`}>
                                                            Por defecto
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-black flex-shrink-0 mt-0.5 ${
                                                    bankAccountMode === 'fuddi' ? 'bg-white text-gray-900' : 'border border-gray-300 text-transparent'
                                                }`}>
                                                    <i className="bi bi-check"></i>
                                                </div>
                                            </div>
                                            <p className={`text-[11px] font-medium leading-relaxed ${
                                                bankAccountMode === 'fuddi' ? 'text-gray-300' : 'text-gray-500'
                                            }`}>
                                                Se muestran las cuentas bancarias oficiales de Fuddi (Pichincha, Guayaquil, Pacífico, Produbanco).
                                            </p>
                                        </button>

                                        {/* Opción Cuentas Propias */}
                                        <button
                                            type="button"
                                            onClick={() => setBankAccountMode('custom')}
                                            className={`p-4 rounded-2xl border-2 text-left transition-all flex flex-col justify-between gap-2.5 relative cursor-pointer ${
                                                bankAccountMode === 'custom'
                                                    ? 'border-gray-900 bg-gray-900 text-white shadow-md'
                                                    : 'border-gray-200 bg-white hover:border-gray-300 text-gray-700'
                                            }`}
                                        >
                                            <div className="flex items-start justify-between gap-2 w-full">
                                                <div className="flex items-center gap-2.5">
                                                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-base ${
                                                        bankAccountMode === 'custom' ? 'bg-white/20 text-white' : 'bg-emerald-50 text-emerald-600'
                                                    }`}>
                                                        <i className="bi bi-shop"></i>
                                                    </div>
                                                    <div>
                                                        <h4 className="font-black text-xs sm:text-sm tracking-tight leading-tight">
                                                            Cuentas de mi Tienda
                                                        </h4>
                                                        <span className={`text-[9px] uppercase font-bold px-1.5 py-0.5 rounded-full inline-block mt-0.5 ${
                                                            bankAccountMode === 'custom' ? 'bg-emerald-400/20 text-emerald-300' : 'bg-emerald-50 text-emerald-700'
                                                        }`}>
                                                            Personalizado
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-black flex-shrink-0 mt-0.5 ${
                                                    bankAccountMode === 'custom' ? 'bg-white text-gray-900' : 'border border-gray-300 text-transparent'
                                                }`}>
                                                    <i className="bi bi-check"></i>
                                                </div>
                                            </div>
                                            <p className={`text-[11px] font-medium leading-relaxed ${
                                                bankAccountMode === 'custom' ? 'text-gray-300' : 'text-gray-500'
                                            }`}>
                                                Tus clientes te transferirán directamente a las cuentas bancarias que tú registres aquí.
                                            </p>
                                        </button>
                                    </div>
                                </div>

                                {/* VISTA CUANDO EL MODO ES FUDDI */}
                                {bankAccountMode === 'fuddi' && (
                                    <div className="space-y-4 pt-1 animate-fadeIn">
                                        <div className="p-3.5 bg-blue-50/80 border border-blue-200/80 rounded-2xl flex items-start gap-3">
                                            <i className="bi bi-info-circle-fill text-blue-600 text-base mt-0.5 shrink-0"></i>
                                            <div className="text-[11px] sm:text-xs text-blue-900 font-medium leading-relaxed">
                                                <p className="font-bold mb-0.5">Cuentas activas en el Checkout:</p>
                                                Tus clientes verán las cuentas corporativas de Fuddi para realizar la transferencia. Puedes cambiar a &quot;Cuentas de mi Tienda&quot; en cualquier momento para usar tus propias cuentas.
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                            {FUDDI_BANK_ACCOUNTS.map((account) => {
                                                const bankMeta = ECUADORIAN_BANKS.find(b => b.id === account.bankName)
                                                return (
                                                    <div
                                                        key={account.id}
                                                        className="p-3.5 rounded-2xl border border-gray-200 bg-gray-50/70 space-y-2"
                                                    >
                                                        <div className="flex items-center gap-2.5">
                                                            <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-sm font-black ${bankMeta?.color || 'bg-white text-gray-700 border border-gray-200'}`}>
                                                                <i className={`bi ${bankMeta?.icon || 'bi-bank'}`}></i>
                                                            </div>
                                                            <div>
                                                                <h4 className="font-black text-xs text-gray-900 leading-tight">{account.bankName}</h4>
                                                                <span className="text-[10px] text-gray-400 font-bold uppercase">{account.accountType}</span>
                                                            </div>
                                                        </div>
                                                        <div className="grid grid-cols-2 gap-2 text-xs pt-1">
                                                            <div>
                                                                <p className="text-[10px] text-gray-400 uppercase font-black">Cuenta</p>
                                                                <p className="font-mono font-bold text-gray-900 text-xs">{account.accountNumber}</p>
                                                            </div>
                                                            <div>
                                                                <p className="text-[10px] text-gray-400 uppercase font-black">Titular</p>
                                                                <p className="font-medium text-gray-800 text-xs truncate">{account.accountHolder}</p>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    </div>
                                )}

                                {/* VISTA CUANDO EL MODO ES PERSONALIZADO (CUENTAS DE LA TIENDA) */}
                                {bankAccountMode === 'custom' && (
                                    <div className="space-y-4 pt-1 animate-fadeIn">
                                        <div className="flex items-center justify-between pb-1">
                                            <div>
                                                <h4 className="font-black text-gray-900 text-xs uppercase tracking-wider">
                                                    Tus Cuentas Bancarias Registradas
                                                </h4>
                                                <p className="text-[11px] text-gray-500 font-medium">
                                                    Agrega las cuentas a las que tus clientes podrán transferir.
                                                </p>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={handleOpenAddAccount}
                                                className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-gray-900 hover:bg-black text-white text-xs font-black rounded-xl transition-all shadow-sm active:scale-95 shrink-0"
                                            >
                                                <i className="bi bi-plus-lg"></i>
                                                <span>Agregar Cuenta</span>
                                            </button>
                                        </div>

                                        {/* Modal / Formulario para Agregar o Editar Cuenta Propia */}
                                        {isAccountFormOpen && (
                                            <div className="bg-gray-50/90 border-2 border-gray-900/10 rounded-2xl sm:rounded-3xl p-4 sm:p-5 shadow-sm space-y-4 animate-fadeIn">
                                                <div className="flex items-center justify-between pb-2 border-b border-gray-200">
                                                    <h4 className="font-black text-gray-900 text-xs sm:text-sm uppercase tracking-wider flex items-center gap-2">
                                                        <i className="bi bi-bank2 text-red-600"></i>
                                                        {editingAccountId ? 'Editar Cuenta Bancaria' : 'Nueva Cuenta Bancaria'}
                                                    </h4>
                                                    <button
                                                        type="button"
                                                        onClick={handleCloseAccountForm}
                                                        className="w-7 h-7 rounded-full bg-white text-gray-400 hover:text-gray-700 flex items-center justify-center transition-colors"
                                                    >
                                                        <i className="bi bi-x-lg text-xs"></i>
                                                    </button>
                                                </div>

                                                {accountFormError && (
                                                    <div className="p-2.5 bg-red-50 border border-red-200 rounded-xl text-red-600 text-xs font-semibold flex items-center gap-2">
                                                        <i className="bi bi-exclamation-circle-fill"></i>
                                                        {accountFormError}
                                                    </div>
                                                )}

                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                                                    {/* Banco */}
                                                    <div>
                                                        <label className="block text-[11px] font-black text-gray-700 uppercase tracking-wider mb-1.5">
                                                            Banco o Cooperativa <span className="text-red-500">*</span>
                                                        </label>
                                                        <select
                                                            value={accountForm.bankName}
                                                            onChange={(e) => setAccountForm(prev => ({ ...prev, bankName: e.target.value }))}
                                                            className="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-xl text-xs font-bold text-gray-900 focus:outline-none focus:border-gray-900 transition-colors shadow-sm"
                                                        >
                                                            {ECUADORIAN_BANKS.map((b) => (
                                                                <option key={b.id} value={b.id}>{b.name}</option>
                                                            ))}
                                                        </select>
                                                    </div>

                                                    {/* Si es "Otro", especificar nombre */}
                                                    {accountForm.bankName === 'Otro' ? (
                                                        <div>
                                                            <label className="block text-[11px] font-black text-gray-700 uppercase tracking-wider mb-1.5">
                                                                Nombre de la entidad <span className="text-red-500">*</span>
                                                            </label>
                                                            <input
                                                                type="text"
                                                                value={accountForm.customBankName}
                                                                onChange={(e) => setAccountForm(prev => ({ ...prev, customBankName: e.target.value }))}
                                                                placeholder="Ej: Banco Solidario, Coop. Jep..."
                                                                className="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-xl text-xs font-medium text-gray-900 focus:outline-none focus:border-gray-900 transition-colors shadow-sm"
                                                            />
                                                        </div>
                                                    ) : (
                                                        /* Tipo de Cuenta */
                                                        <div>
                                                            <label className="block text-[11px] font-black text-gray-700 uppercase tracking-wider mb-1.5">
                                                                Tipo de cuenta <span className="text-red-500">*</span>
                                                            </label>
                                                            <div className="grid grid-cols-2 gap-2">
                                                                {['Ahorros', 'Corriente'].map((type) => (
                                                                    <button
                                                                        key={type}
                                                                        type="button"
                                                                        onClick={() => setAccountForm(prev => ({ ...prev, accountType: type }))}
                                                                        className={`py-2 px-3 rounded-xl text-xs font-black transition-all border ${
                                                                            accountForm.accountType === type
                                                                                ? 'bg-gray-900 text-white border-gray-900 shadow-sm'
                                                                                : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                                                                        }`}
                                                                    >
                                                                        {type}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* Número de cuenta */}
                                                    <div>
                                                        <label className="block text-[11px] font-black text-gray-700 uppercase tracking-wider mb-1.5">
                                                            Número de cuenta <span className="text-red-500">*</span>
                                                        </label>
                                                        <input
                                                            type="text"
                                                            value={accountForm.accountNumber}
                                                            onChange={(e) => setAccountForm(prev => ({ ...prev, accountNumber: e.target.value.replace(/\s+/g, '') }))}
                                                            placeholder="Ej: 2201928471"
                                                            className="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-xl text-xs font-mono font-bold text-gray-900 focus:outline-none focus:border-gray-900 transition-colors shadow-sm"
                                                        />
                                                    </div>

                                                    {/* Titular de la cuenta */}
                                                    <div>
                                                        <label className="block text-[11px] font-black text-gray-700 uppercase tracking-wider mb-1.5">
                                                            Titular de la cuenta <span className="text-red-500">*</span>
                                                        </label>
                                                        <input
                                                            type="text"
                                                            value={accountForm.accountHolder}
                                                            onChange={(e) => setAccountForm(prev => ({ ...prev, accountHolder: e.target.value }))}
                                                            placeholder="Nombre y Apellido o Razón Social"
                                                            className="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-xl text-xs font-medium text-gray-900 focus:outline-none focus:border-gray-900 transition-colors shadow-sm"
                                                        />
                                                    </div>

                                                    {/* Cédula o RUC */}
                                                    <div className="sm:col-span-2">
                                                        <label className="block text-[11px] font-black text-gray-700 uppercase tracking-wider mb-1.5">
                                                            Cédula / RUC del titular
                                                        </label>
                                                        <input
                                                            type="text"
                                                            value={accountForm.idNumber}
                                                            onChange={(e) => setAccountForm(prev => ({ ...prev, idNumber: e.target.value.trim() }))}
                                                            placeholder="Ej: 0928374615 ó 0928374615001"
                                                            className="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-xl text-xs font-mono font-medium text-gray-900 focus:outline-none focus:border-gray-900 transition-colors shadow-sm"
                                                        />
                                                    </div>
                                                </div>

                                                {/* Botones del Formulario */}
                                                <div className="pt-2 flex items-center justify-end gap-2.5 border-t border-gray-200">
                                                    <button
                                                        type="button"
                                                        onClick={handleCloseAccountForm}
                                                        className="px-4 py-2 bg-white text-gray-600 hover:text-gray-900 text-xs font-bold rounded-xl border border-gray-200 hover:border-gray-300 transition-colors"
                                                    >
                                                        Cancelar
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={handleSaveAccountForm}
                                                        className="px-5 py-2 bg-red-600 hover:bg-black text-white text-xs font-black rounded-xl shadow-md shadow-red-200 transition-all active:scale-95"
                                                    >
                                                        {editingAccountId ? 'Actualizar Cuenta' : 'Guardar Cuenta'}
                                                    </button>
                                                </div>
                                            </div>
                                        )}

                                        {/* Lista de Cuentas Bancarias Propias */}
                                        {bankAccounts.length === 0 ? (
                                            <div className="p-8 text-center bg-gray-50/80 border-2 border-dashed border-gray-200 rounded-3xl space-y-3">
                                                <div className="w-14 h-14 mx-auto rounded-full bg-white shadow-sm flex items-center justify-center text-gray-400 text-2xl">
                                                    <i className="bi bi-bank"></i>
                                                </div>
                                                <div>
                                                    <h4 className="font-black text-gray-900 text-sm">No tienes cuentas propias registradas</h4>
                                                    <p className="text-xs text-gray-500 max-w-sm mx-auto mt-1">
                                                        Agrega al menos una cuenta para que tus clientes puedan transferirte directamente.
                                                    </p>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={handleOpenAddAccount}
                                                    className="inline-flex items-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-black text-white text-xs font-black rounded-xl transition-all shadow-md shadow-red-200"
                                                >
                                                    <i className="bi bi-plus-lg"></i>
                                                    <span>Registrar cuenta propia</span>
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                                                {bankAccounts.map((account) => {
                                                    const bankMeta = ECUADORIAN_BANKS.find(b => b.id === account.bankName)
                                                    return (
                                                        <div
                                                            key={account.id}
                                                            className="p-4 rounded-2xl border-2 border-gray-200 bg-white hover:border-gray-300 transition-all flex flex-col justify-between gap-3 relative overflow-hidden"
                                                        >
                                                            {/* Cabecera de la tarjeta */}
                                                            <div className="flex items-start justify-between gap-2">
                                                                <div className="flex items-center gap-2.5">
                                                                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-base font-black ${bankMeta?.color || 'bg-gray-100 text-gray-800 border border-gray-200'}`}>
                                                                        <i className={`bi ${bankMeta?.icon || 'bi-bank'}`}></i>
                                                                    </div>
                                                                    <div>
                                                                        <h4 className="font-black text-gray-900 text-sm tracking-tight leading-tight">
                                                                            {account.bankName}
                                                                        </h4>
                                                                        <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">
                                                                            Cuenta de {account.accountType}
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            </div>

                                                            {/* Datos de la cuenta */}
                                                            <div className="space-y-1.5 pt-1">
                                                                <div>
                                                                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Número de Cuenta</p>
                                                                    <p className="font-mono font-bold text-sm text-gray-900 bg-gray-50 px-2 py-0.5 rounded-lg border border-gray-100 inline-block">
                                                                        {account.accountNumber}
                                                                    </p>
                                                                </div>

                                                                <div className="grid grid-cols-2 gap-2 pt-1 text-xs">
                                                                    <div>
                                                                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Titular</p>
                                                                        <p className="font-bold text-gray-800 truncate" title={account.accountHolder}>
                                                                            {account.accountHolder}
                                                                        </p>
                                                                    </div>
                                                                    {account.idNumber && (
                                                                        <div>
                                                                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Cédula / RUC</p>
                                                                            <p className="font-medium text-gray-700 font-mono">
                                                                                {account.idNumber}
                                                                            </p>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>

                                                            {/* Acciones de la cuenta */}
                                                            <div className="pt-2 border-t border-gray-100 flex items-center justify-end gap-1.5">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleOpenEditAccount(account)}
                                                                    className="p-1.5 text-xs text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-1 font-bold"
                                                                    title="Editar datos de cuenta"
                                                                >
                                                                    <i className="bi bi-pencil"></i>
                                                                    <span className="text-[11px]">Editar</span>
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleDeleteAccount(account.id)}
                                                                    className="p-1.5 text-xs text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                                                    title="Eliminar cuenta"
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
                                )}
                            </div>
                        )}

                        <div className="pt-6 sm:pt-8 flex flex-col sm:flex-row items-center gap-3 sm:gap-4">
                            <button
                                type="button"
                                onClick={handleSubmit}
                                disabled={saving || uploadingLogo || uploadingCover}
                                className="flex-1 w-full bg-red-600 hover:bg-black text-white font-black py-4 sm:py-5 px-6 sm:px-8 rounded-xl sm:rounded-[2rem] shadow-xl shadow-red-200 transition-all duration-300 transform active:scale-[0.98] flex items-center justify-center gap-2.5 disabled:opacity-50 disabled:cursor-not-allowed group overflow-hidden relative"
                            >
                                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000"></div>
                                {saving || uploadingLogo || uploadingCover ? (
                                    <>
                                        <div className="w-4 h-4 sm:w-5 sm:h-5 border-3 border-white/20 border-t-white rounded-full animate-spin"></div>
                                        <span className="uppercase tracking-wider text-xs">Guardando...</span>
                                    </>
                                ) : (
                                    <>
                                        <i className="bi bi-check2-circle text-lg sm:text-xl"></i>
                                        <span className="uppercase tracking-wider text-xs">Guardar Cambios</span>
                                    </>
                                )}
                            </button>

                            <button
                                type="button"
                                onClick={onCancel}
                                className="w-full sm:w-auto px-6 py-3 text-gray-400 hover:text-gray-900 font-black uppercase tracking-wider text-[10px] sm:text-[11px] transition-colors text-center"
                            >
                                Cancelar
                            </button>
                        </div>
                    </div>

            <style>{`
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
 * Sección de configuración de delivery y repartidores de la tienda (limpia y minimalista)
 */
const DeliveryConfigSection: React.FC<{
    businessId: string;
    defaultDeliveryId: string;
    onDeliverySelect: (id: string) => void;
    onDeliveriesLoaded?: (deliveries: Delivery[]) => void;
}> = ({ businessId, defaultDeliveryId, onDeliverySelect, onDeliveriesLoaded }) => {
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
            if (onDeliveriesLoaded) onDeliveriesLoaded(list)
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
            showMessage(`Repartidor ${driver.nombres} eliminado`, 'info')
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
            showMessage('Completa el nombre y un celular válido', 'error')
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
            showMessage('Repartidor registrado', 'success')
            await loadMyDeliveries()
        } catch (error) {
            console.error('Error al guardar repartidor:', error)
            showMessage('Error al registrar repartidor', 'error')
        } finally {
            setCreating(false)
        }
    }

    return (
        <div className="space-y-4 animate-fadeIn">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-xl bg-gray-900 text-white flex items-center justify-center text-sm font-bold shadow-sm">
                        <i className="bi bi-person-badge"></i>
                    </div>
                    <div>
                        <h3 className="font-black text-gray-900 uppercase tracking-wider text-xs">Repartidores de la Tienda</h3>
                        <p className="text-[11px] text-gray-500 font-medium">Asigna tu repartidor predeterminado o agrega nuevos.</p>
                    </div>
                </div>

                {!showForm && (
                    <button
                        type="button"
                        onClick={() => setShowForm(true)}
                        className="px-3 py-1.5 bg-gray-900 hover:bg-black text-white text-[10px] font-black uppercase tracking-wider rounded-xl transition-all flex items-center gap-1.5 shadow-sm"
                    >
                        <i className="bi bi-plus-lg"></i>
                        Agregar
                    </button>
                )}
            </div>

            {/* Mensajes de Feedback */}
            {message && (
                <div className={`p-3 rounded-xl text-xs font-bold animate-fadeIn ${
                    message.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' :
                    message.type === 'error' ? 'bg-red-50 text-red-700 border border-red-100' :
                    'bg-blue-50 text-blue-700 border border-blue-100'
                }`}>
                    {message.text}
                </div>
            )}

            {/* Formulario de Registro Integrado */}
            {showForm && (
                <div className="p-4 bg-gray-50 border border-gray-200 rounded-2xl space-y-3 animate-fadeIn">
                    <div className="flex items-center justify-between">
                        <h4 className="font-black text-gray-900 text-xs uppercase tracking-wider">Nuevo Repartidor</h4>
                        <button
                            type="button"
                            onClick={() => setShowForm(false)}
                            className="text-gray-400 hover:text-gray-600 text-xs font-bold"
                        >
                            <i className="bi bi-x-lg"></i>
                        </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <input
                            type="text"
                            value={newDeliveryData.nombres}
                            onChange={(e) => setNewDeliveryData(prev => ({ ...prev, nombres: e.target.value }))}
                            className="w-full px-3.5 py-2 bg-white border border-gray-200 rounded-xl focus:border-gray-900 font-bold text-xs text-gray-900 outline-none"
                            placeholder="Nombre completo *"
                        />

                        <input
                            type="tel"
                            value={newDeliveryData.celular}
                            onChange={(e) => setNewDeliveryData(prev => ({ ...prev, celular: e.target.value }))}
                            className="w-full px-3.5 py-2 bg-white border border-gray-200 rounded-xl focus:border-gray-900 font-bold text-xs text-gray-900 outline-none"
                            placeholder="WhatsApp (ej: 0991234567) *"
                        />
                    </div>

                    <div className="flex justify-end gap-2 pt-1">
                        <button
                            type="button"
                            onClick={() => setShowForm(false)}
                            className="px-3 py-1.5 text-xs font-bold text-gray-400 hover:text-gray-600"
                        >
                            Cancelar
                        </button>
                        <button
                            type="button"
                            onClick={handleSaveDriver}
                            disabled={creating}
                            className="px-4 py-1.5 bg-red-600 text-white rounded-xl font-bold text-xs hover:bg-black transition-all shadow-sm disabled:opacity-50"
                        >
                            {creating ? 'Guardando...' : 'Guardar'}
                        </button>
                    </div>
                </div>
            )}

            {/* Lista de Repartidores */}
            {myDeliveries.length === 0 ? (
                <div className="p-4 bg-gray-50 border border-dashed border-gray-200 rounded-2xl text-center text-gray-400 text-xs font-medium">
                    No tienes repartidores propios asignados todavía.
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {myDeliveries.map((driver) => {
                        const isDefault = defaultDeliveryId === driver.id
                        return (
                            <div
                                key={driver.id}
                                className={`p-3 rounded-2xl border transition-all flex items-center justify-between gap-3 ${
                                    isDefault ? 'border-emerald-500 bg-emerald-50/40 shadow-sm' : 'border-gray-200 bg-white hover:border-gray-300'
                                }`}
                            >
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5">
                                        <p className="font-black text-xs text-gray-900 truncate">{driver.nombres}</p>
                                        {isDefault && (
                                            <span className="text-[9px] uppercase font-black px-1.5 py-0.5 rounded bg-emerald-600 text-white shrink-0">
                                                Predeterminado
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-[11px] font-semibold text-gray-500 mt-0.5">
                                        {driver.celular}
                                    </p>
                                </div>

                                <div className="flex items-center gap-1 flex-shrink-0">
                                    {!isDefault && (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                onDeliverySelect(driver.id)
                                                showMessage(`Asignado como predeterminado`, 'success')
                                            }}
                                            className="px-2.5 py-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors border border-emerald-200"
                                            title="Establecer como predeterminado"
                                        >
                                            Asignar
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => handleUnlink(driver)}
                                        className="p-1.5 text-xs text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                        title="Eliminar repartidor"
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
    )
}

export default BusinessProfileEditor
