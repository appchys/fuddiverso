'use client'

import { useState, useEffect, useMemo, use } from 'react'
import { useRouter } from 'next/navigation'
import { Business, Product, Delivery, BusinessAdministrator, CommissionType } from '@/types'
import {
  getBusiness,
  updateBusiness,
  getProductsByBusiness,
  uploadImage,
  getAllDeliveries,
  addBusinessAdministrator,
  removeBusinessAdministrator,
  applyCommissionTypeToBusinessProducts,
  subscribeToBusiness,
  getCachedBusinessById
} from '@/lib/database'
import { optimizeImage } from '@/lib/image-utils'
import { isStoreOpen } from '@/lib/store-utils'
import dynamic from 'next/dynamic'
import { useCurrentLocation } from '@/components/GoogleMap'

const ProductList = dynamic(() => import('@/components/ProductList'), { ssr: false })
const NotificationSettings = dynamic(() => import('@/components/NotificationSettings'), { ssr: false })
const GoogleMap = dynamic(() => import('@/components/GoogleMap').then(m => m.GoogleMap), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex flex-col items-center justify-center bg-gray-50 text-gray-400 gap-2">
      <div className="animate-spin rounded-full h-6 w-6 border-2 border-blue-600 border-t-transparent" />
      <span className="text-xs font-semibold">Cargando mapa...</span>
    </div>
  )
})

const DAYS_ES: Record<string, string> = {
  monday: 'Lunes',
  tuesday: 'Martes',
  wednesday: 'Miércoles',
  thursday: 'Jueves',
  friday: 'Viernes',
  saturday: 'Sábado',
  sunday: 'Domingo',
}
const DAY_ORDER = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

type Tab = 'info' | 'schedule' | 'products' | 'delivery' | 'notifications' | 'danger' | 'admins'

export default function AdminStorePage({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = use(params)
  const router = useRouter()

  const [business, setBusiness] = useState<Business | null>(() => {
    const cached = getCachedBusinessById(businessId)
    return cached ? { ...cached, isOpen: isStoreOpen(cached) } : null
  })
  const [edited, setEdited] = useState<Business | null>(() => {
    const cached = getCachedBusinessById(businessId)
    return cached ? { ...cached, isOpen: isStoreOpen(cached) } : null
  })
  const [loading, setLoading] = useState<boolean>(() => !getCachedBusinessById(businessId))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [tab, setTab] = useState<Tab>('info')
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<string[]>(() => {
    const cached = getCachedBusinessById(businessId)
    return cached?.categories || []
  })
  const [uploadingCover, setUploadingCover] = useState(false)
  const [uploadingProfile, setUploadingProfile] = useState(false)
  const [deliveries, setDeliveries] = useState<Delivery[]>([])
  const [loadingDeliveries, setLoadingDeliveries] = useState(false)
  const [savingDelivery, setSavingDelivery] = useState(false)
  const [deliverySaved, setDeliverySaved] = useState(false)
  const [isApplyingCommission, setIsApplyingCommission] = useState(false)
  const [commissionFeedback, setCommissionFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // Estado e información de pickup
  const [uploadingPickupPhoto, setUploadingPickupPhoto] = useState(false)
  const { location: currentLocation, loading: locatingPickup, getCurrentLocation: getPickupLocation } = useCurrentLocation()

  // Estados para administradores
  const [showAddAdminModal, setShowAddAdminModal] = useState(false)
  const [addingAdmin, setAddingAdmin] = useState(false)
  const [newAdminData, setNewAdminData] = useState({
    email: '',
    password: '',
    role: 'admin' as 'admin' | 'manager',
    permissions: {
      manageProducts: true,
      manageOrders: true,
      manageAdmins: false,
      viewReports: true,
      editBusiness: false
    }
  })
  
  // Editar contraseña de administrador
  const [passwordAdminEmail, setPasswordAdminEmail] = useState<string | null>(null)
  const [adminPassword, setAdminPassword] = useState('')
  const [savingAdminPassword, setSavingAdminPassword] = useState(false)

  // Magic links
  const [loadingLink, setLoadingLink] = useState<{ [email: string]: boolean }>({})
  const [copiedLink, setCopiedLink] = useState<{ [email: string]: boolean }>({})

  const handleCopyMagicLink = async (email: string) => {
    setLoadingLink(prev => ({ ...prev, [email]: true }))
    try {
      const response = await fetch(
        `/api/business/magic-link?businessId=${encodeURIComponent(businessId)}&email=${encodeURIComponent(email)}`,
        {
          headers: {
            'x-admin-password': 'admin123'
          }
        }
      )

      const data = await response.json()
      if (!response.ok || !data.token) {
        throw new Error(data.error || 'Error al obtener el enlace de acceso rápido.')
      }

      const magicLinkUrl = `${window.location.origin}/l/${data.token}`
      await navigator.clipboard.writeText(magicLinkUrl)

      setCopiedLink(prev => ({ ...prev, [email]: true }))
      setTimeout(() => {
        setCopiedLink(prev => ({ ...prev, [email]: false }))
      }, 2000)
    } catch (error: any) {
      console.error('Error al copiar link:', error)
      alert(error.message || 'No se pudo generar el enlace de acceso rápido.')
    } finally {
      setLoadingLink(prev => ({ ...prev, [email]: false }))
    }
  }

  const handleRegenerateMagicLink = async (email: string) => {
    if (!confirm('¿Estás seguro de que quieres regenerar el enlace de acceso directo? El enlace anterior se invalidará de inmediato.')) {
      return
    }

    setLoadingLink(prev => ({ ...prev, [email]: true }))
    try {
      const response = await fetch('/api/business/magic-link', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-password': 'admin123'
        },
        body: JSON.stringify({
          businessId,
          email,
          action: 'regenerate',
        }),
      })

      const data = await response.json()
      if (!response.ok || !data.token) {
        throw new Error(data.error || 'Error al regenerar el enlace de acceso rápido.')
      }

      const magicLinkUrl = `${window.location.origin}/l/${data.token}`
      await navigator.clipboard.writeText(magicLinkUrl)

      alert('¡Se ha generado un nuevo enlace de acceso directo y se copió al portapapeles! El enlace anterior ya no es válido.')

      setCopiedLink(prev => ({ ...prev, [email]: true }))
      setTimeout(() => {
        setCopiedLink(prev => ({ ...prev, [email]: false }))
      }, 2000)
    } catch (error: any) {
      console.error('Error al regenerar link:', error)
      alert(error.message || 'No se pudo regenerar el enlace.')
    } finally {
      setLoadingLink(prev => ({ ...prev, [email]: false }))
    }
  }

  const handleAddAdmin = async () => {
    if (!business || !newAdminData.email.trim()) return

    setAddingAdmin(true)
    try {
      if (newAdminData.password.trim()) {
        const response = await fetch('/api/business/admin-password', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-admin-password': 'admin123'
          },
          body: JSON.stringify({
            businessId,
            email: newAdminData.email.trim(),
            password: newAdminData.password,
            role: newAdminData.role,
            permissions: newAdminData.permissions
          })
        })
        const result = await response.json()

        if (!response.ok) {
          throw new Error(result.error || 'Error al crear el acceso del administrador')
        }
      } else {
        await addBusinessAdministrator(
          businessId,
          newAdminData.email.trim(),
          newAdminData.role,
          newAdminData.permissions,
          'super-admin'
        )
      }

      await loadBusiness()

      setNewAdminData({
        email: '',
        password: '',
        role: 'admin',
        permissions: {
          manageProducts: true,
          manageOrders: true,
          manageAdmins: false,
          viewReports: true,
          editBusiness: false
        }
      })
      setShowAddAdminModal(false)
      alert('Administrador agregado exitosamente')
    } catch (error: any) {
      alert(error.message || 'Error al agregar administrador')
    } finally {
      setAddingAdmin(false)
    }
  }

  const handleSaveAdminPassword = async () => {
    if (!business || !passwordAdminEmail || !adminPassword.trim()) return

    setSavingAdminPassword(true)
    try {
      const response = await fetch('/api/business/admin-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-password': 'admin123'
        },
        body: JSON.stringify({
          businessId,
          email: passwordAdminEmail,
          password: adminPassword
        })
      })
      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Error al guardar la contraseña')
      }

      await loadBusiness()
      setPasswordAdminEmail(null)
      setAdminPassword('')
      alert('Contraseña actualizada exitosamente')
    } catch (error: any) {
      alert(error.message || 'Error al guardar la contraseña')
    } finally {
      setSavingAdminPassword(false)
    }
  }

  const handleRemoveAdmin = async (adminEmail: string) => {
    if (!business || !confirm('¿Estás seguro de que quieres remover este administrador?')) return
    try {
      await removeBusinessAdministrator(businessId, adminEmail)
      await loadBusiness()
      alert('Administrador removido exitosamente')
    } catch (error: any) {
      alert(error.message || 'Error al remover administrador')
    }
  }

  useEffect(() => {
    if (!businessId) return

    // 1. Si estaba en caché local, asegurar que se muestre inmediatamente
    const cached = getCachedBusinessById(businessId)
    if (cached) {
      const withOpen = { ...cached, isOpen: isStoreOpen(cached) }
      setBusiness(prev => prev ?? withOpen)
      setEdited(prev => prev ?? withOpen)
      setCategories(prev => prev.length > 0 ? prev : (cached.categories || []))
      setLoading(false)
    }

    // 2. Suscripción en tiempo real (IndexedDB local emite en <5ms, luego el servidor)
    const unsubscribe = subscribeToBusiness(
      businessId,
      (data) => {
        if (!data) {
          router.push('/admin')
          return
        }
        const withOpen = { ...data, isOpen: isStoreOpen(data) }
        setBusiness(withOpen)
        setEdited(prev => prev ?? withOpen)
        setCategories(prev => prev.length > 0 ? prev : (data.categories || []))
        setLoading(false)
      },
      (error) => {
        console.error('Error suscribiendo al negocio:', error)
        setLoading(false)
      }
    )

    return () => {
      unsubscribe()
    }
  }, [businessId, router])

  const loadBusiness = async () => {
    try {
      const data = await getBusiness(businessId, true)
      if (!data) { router.push('/admin'); return }
      const withOpen = { ...data, isOpen: isStoreOpen(data) }
      setBusiness(withOpen)
      setEdited(withOpen)
      setCategories(data.categories || [])
    } catch (e) {
      console.error(e)
    }
  }

  const hasChanges = useMemo(() => {
    if (!business || !edited) return false
    return (
      business.name !== edited.name ||
      business.username !== edited.username ||
      business.email !== edited.email ||
      business.phone !== edited.phone ||
      business.category !== edited.category ||
      business.deliveryTime !== edited.deliveryTime ||
      business.description !== edited.description ||
      business.commissionRate !== edited.commissionRate ||
      business.defaultCommissionType !== edited.defaultCommissionType ||
      business.hasPackagingFee !== edited.hasPackagingFee ||
      business.packagingFee !== edited.packagingFee ||
      JSON.stringify(business.pickupSettings || {}) !== JSON.stringify(edited.pickupSettings || {}) ||
      JSON.stringify(business.schedule || {}) !== JSON.stringify(edited.schedule || {}) ||
      business.manualStoreStatus !== edited.manualStoreStatus
    )
  }, [business, edited])

  const loadProducts = async () => {
    try {
      const prods = await getProductsByBusiness(businessId)
      setProducts(prods)
    } catch (e) { console.error(e) }
  }

  useEffect(() => {
    if (tab === 'products') loadProducts()
    if (tab === 'delivery') loadDeliveries()
  }, [tab])

  const loadDeliveries = async () => {
    setLoadingDeliveries(true)
    try {
      const all = await getAllDeliveries()
      setDeliveries(all.filter(d => d.estado === 'activo'))
    } catch (e) { console.error(e) }
    finally { setLoadingDeliveries(false) }
  }

  const handleSaveDelivery = async () => {
    if (!edited) return
    setSavingDelivery(true)
    try {
      await updateBusiness(businessId, {
        deliveryServiceType: edited.deliveryServiceType,
        defaultDeliveryId: edited.defaultDeliveryId,
        deliveryZoneSettings: edited.deliveryZoneSettings,
      })
      setBusiness(prev => prev ? { 
        ...prev, 
        deliveryServiceType: edited.deliveryServiceType, 
        defaultDeliveryId: edited.defaultDeliveryId,
        deliveryZoneSettings: edited.deliveryZoneSettings 
      } : null)
      setDeliverySaved(true)
      setTimeout(() => setDeliverySaved(false), 2500)
    } catch { alert('Error al guardar configuración de delivery') }
    finally { setSavingDelivery(false) }
  }

  const handleSave = async () => {
    if (!edited) return
    setSaving(true)
    try {
      const dataToSave: Business = {
        ...edited,
        hasPackagingFee: !!edited.hasPackagingFee,
        packagingFee: edited.hasPackagingFee
          ? (typeof edited.packagingFee === 'number' && !Number.isNaN(edited.packagingFee) ? edited.packagingFee : parseFloat(String(edited.packagingFee || 0.50)))
          : (edited.packagingFee || 0),
        updatedAt: new Date()
      }
      await updateBusiness(businessId, dataToSave)
      setBusiness(dataToSave)
      setEdited(dataToSave)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      alert('Error al guardar. Intenta de nuevo.')
    } finally {
      setSaving(false)
    }
  }

  const handleField = (field: keyof Business, value: any) => {
    setEdited(prev => prev ? { ...prev, [field]: value } : null)
  }

  const handleApplyCommissionToAllProducts = async (commissionTypeToApply?: CommissionType, commissionRateToApply?: number) => {
    if (!businessId) return
    const targetType = commissionTypeToApply ?? (edited?.defaultCommissionType || 'fuddi_assumed_by_customer')
    const targetRate = targetType === 'subscription' ? 0 : (commissionRateToApply ?? edited?.commissionRate ?? 10)

    setIsApplyingCommission(true)
    setCommissionFeedback(null)
    try {
      const result = await applyCommissionTypeToBusinessProducts(businessId, targetType, targetRate, true)

      setBusiness(prev => prev ? { ...prev, defaultCommissionType: targetType, commissionRate: targetRate } : null)
      setEdited(prev => prev ? { ...prev, defaultCommissionType: targetType, commissionRate: targetRate } : null)
      setProducts(result.products)

      setCommissionFeedback({
        type: 'success',
        message: `Comisión aplicada correctamente a ${result.updatedCount} producto${result.updatedCount === 1 ? '' : 's'}.`
      })
      setTimeout(() => {
        setCommissionFeedback(null)
      }, 5000)
    } catch (err: any) {
      console.error('Error aplicando comisión a los productos:', err)
      setCommissionFeedback({
        type: 'error',
        message: err.message || 'Error al aplicar el tipo de comisión a los productos.'
      })
    } finally {
      setIsApplyingCommission(false)
    }
  }

  const handlePickupField = (field: string, value: any) => {
    setEdited(prev => {
      if (!prev) return null
      const current = prev.pickupSettings || {
        enabled: false,
        restrictToPrevious: false,
        references: '',
        latlong: '',
        storePhotoUrl: ''
      }
      return {
        ...prev,
        pickupSettings: {
          ...current,
          [field]: value
        }
      }
    })
  }

  const handlePickupLocationChange = (lat: number, lng: number) => {
    handlePickupField('latlong', `${lat}, ${lng}`)
  }

  useEffect(() => {
    if (currentLocation) {
      handlePickupLocationChange(currentLocation.lat, currentLocation.lng)
    }
  }, [currentLocation])

  const handlePickupPhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !businessId) return

    setUploadingPickupPhoto(true)
    try {
      const optimized = await optimizeImage(file, 800, 0.7)
      const url = await uploadImage(optimized as File, `businesses/${businessId}/pickup_photo_${Date.now()}`)
      handlePickupField('storePhotoUrl', url)
    } catch (error) {
      console.error('Error al subir foto de retiro:', error)
      alert('Error al subir la foto de retiro')
    } finally {
      setUploadingPickupPhoto(false)
    }
  }

  const handleScheduleField = (day: string, key: 'open' | 'close' | 'isOpen', value: any) => {
    setEdited(prev => {
      if (!prev) return null
      const schedule = { ...(prev.schedule || {}) }
      schedule[day] = { ...(schedule[day] || { open: '09:00', close: '18:00', isOpen: true }), [key]: value }
      return { ...prev, schedule }
    })
  }

  const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !business) return
    setUploadingCover(true)
    try {
      const optimized = await optimizeImage(file, 1200, 0.7)
      const url = await uploadImage(optimized as File, `businesses/covers/${businessId}_${Date.now()}`)
      await updateBusiness(businessId, { coverImage: url })
      setBusiness(prev => prev ? { ...prev, coverImage: url } : null)
      setEdited(prev => prev ? { ...prev, coverImage: url } : null)
    } catch { alert('Error al subir portada') }
    finally { setUploadingCover(false) }
  }

  const handleProfileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !business) return
    setUploadingProfile(true)
    try {
      const optimized = await optimizeImage(file, 500, 0.8)
      const url = await uploadImage(optimized as File, `businesses/profiles/${businessId}_${Date.now()}`)
      await updateBusiness(businessId, { image: url })
      setBusiness(prev => prev ? { ...prev, image: url } : null)
      setEdited(prev => prev ? { ...prev, image: url } : null)
    } catch { alert('Error al subir logo') }
    finally { setUploadingProfile(false) }
  }

  const handleToggleActive = async () => {
    if (!business) return
    const newVal = !business.isActive
    if (!confirm(`¿${newVal ? 'Activar' : 'Desactivar'} la tienda "${business.name}"?`)) return
    try {
      await updateBusiness(businessId, { isActive: newVal })
      setBusiness(prev => prev ? { ...prev, isActive: newVal } : null)
      setEdited(prev => prev ? { ...prev, isActive: newVal } : null)
    } catch { alert('Error al cambiar estado') }
  }

  const handleToggleHidden = async () => {
    if (!business) return
    const newVal = !business.isHidden
    try {
      await updateBusiness(businessId, { isHidden: newVal })
      setBusiness(prev => prev ? { ...prev, isHidden: newVal } : null)
      setEdited(prev => prev ? { ...prev, isHidden: newVal } : null)
    } catch { alert('Error') }
  }

  const handleNotificationUpdate = async (field: keyof Business, value: any) => {
    try {
      await updateBusiness(businessId, { [field]: value })
      setBusiness(prev => prev ? { ...prev, [field]: value } : null)
      setEdited(prev => prev ? { ...prev, [field]: value } : null)
    } catch { alert('Error al guardar') }
  }

  const handleDirectUpdate = async (field: keyof Business, value: any) => {
    try {
      await updateBusiness(businessId, { [field]: value })
      setBusiness(prev => prev ? { ...prev, [field]: value } : null)
      setEdited(prev => prev ? { ...prev, [field]: value } : null)
    } catch { alert('Error al guardar') }
  }

  if (loading && !business) {
    return (
      <div className="space-y-4 md:space-y-6 max-w-6xl mx-auto animate-pulse pb-16 pt-2">
        {/* Header Skeleton */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gray-200 shrink-0" />
          <div className="w-12 h-12 rounded-2xl bg-gray-200 shrink-0" />
          <div className="space-y-2 flex-1 min-w-0">
            <div className="h-6 w-48 bg-gray-200 rounded-xl" />
            <div className="h-4 w-28 bg-gray-100 rounded-full" />
          </div>
        </div>

        {/* Tabs Skeleton */}
        <div className="h-11 bg-gray-200/70 rounded-2xl w-full" />

        {/* Main Card Skeleton */}
        <div className="bg-white rounded-3xl border border-gray-200/80 p-4 sm:p-6 space-y-4 shadow-xs">
          <div className="h-28 sm:h-44 bg-gray-100 rounded-2xl" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            <div className="h-10 bg-gray-100 rounded-2xl" />
            <div className="h-10 bg-gray-100 rounded-2xl" />
            <div className="h-10 bg-gray-100 rounded-2xl" />
            <div className="h-10 bg-gray-100 rounded-2xl" />
          </div>
        </div>
      </div>
    )
  }

  if (!business || !edited) return (
    <div className="text-center py-20 text-gray-500 font-medium">
      <i className="bi bi-shop text-4xl text-gray-300 block mb-2" />
      Tienda no encontrada.
    </div>
  )

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'info', label: 'Información', icon: 'bi-info-circle' },
    { id: 'schedule', label: 'Horarios', icon: 'bi-clock' },
    { id: 'products', label: 'Productos', icon: 'bi-box-seam' },
    { id: 'delivery', label: 'Delivery', icon: 'bi-scooter' },
    { id: 'notifications', label: 'Notificaciones', icon: 'bi-bell' },
    { id: 'admins', label: 'Administradores', icon: 'bi-people' },
    { id: 'danger', label: 'Configuración', icon: 'bi-gear' },
  ]

  return (
    <div className="space-y-4 md:space-y-6 max-w-6xl mx-auto pb-24 sm:pb-10 animate-fadeIn">
      {/* Header Principal con estética /admin */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => router.push('/admin')}
            className="w-10 h-10 flex items-center justify-center bg-white border border-gray-200/80 rounded-2xl text-gray-700 hover:text-gray-900 hover:border-gray-300 transition-all shadow-xs active:scale-95 shrink-0"
            title="Volver a lista de tiendas"
          >
            <i className="bi bi-arrow-left text-base" />
          </button>

          <div className="w-12 h-12 rounded-2xl overflow-hidden bg-gray-100 flex-shrink-0 border border-gray-200/80 shadow-xs relative">
            {business.image ? (
              <img src={business.image} alt={business.name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <i className="bi bi-shop text-gray-400 text-xl" />
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <h1 className="text-xl sm:text-2xl font-black text-gray-900 tracking-tight leading-tight truncate">
              {business.name}
            </h1>
            <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
              <span className={`inline-flex items-center gap-1 text-[10px] font-black px-2.5 py-0.5 rounded-full border ${
                business.isOpen
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200/60'
                  : 'bg-gray-100 text-gray-500 border-gray-200'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${business.isOpen ? 'bg-emerald-500' : 'bg-gray-400'}`} />
                {business.isOpen ? 'Abierto' : 'Cerrado'}
              </span>

              {!business.isActive && (
                <span className="inline-flex items-center gap-1 text-[10px] font-black px-2.5 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200/60">
                  Inactivo
                </span>
              )}

              {business.isHidden && (
                <span className="inline-flex items-center gap-1 text-[10px] font-black px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200/60">
                  <i className="bi bi-eye-slash text-[9px]" /> Oculto
                </span>
              )}

              {business.username && (
                <span className="text-[11px] font-medium text-gray-400 truncate max-w-[150px]">
                  @{business.username}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Acciones del Header */}
        <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
          <a
            href={`/business/${business.username || business.id}/dashboard`}
            target="_blank"
            className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200/80 hover:border-gray-300 rounded-2xl text-xs font-bold text-gray-700 transition-all shadow-xs active:scale-95"
            title="Abrir Dashboard de la tienda"
          >
            <i className="bi bi-box-arrow-up-right text-gray-400" />
            <span className="hidden sm:inline">Dashboard</span>
          </a>

          <a
            href={`/${business.username || business.id}`}
            target="_blank"
            className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200/80 hover:border-gray-300 rounded-2xl text-xs font-bold text-gray-700 transition-all shadow-xs active:scale-95"
            title="Ver tienda pública"
          >
            <i className="bi bi-shop text-gray-400" />
            <span className="hidden sm:inline">Ver Tienda</span>
          </a>

          <button
            onClick={handleSave}
            disabled={saving}
            className="hidden sm:flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 disabled:opacity-60 text-white rounded-2xl text-xs font-bold shadow-md shadow-blue-600/20 active:scale-95 transition-all"
          >
            {saving ? (
              <>
                <div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-white border-t-transparent" />
                <span>Guardando...</span>
              </>
            ) : saved ? (
              <>
                <i className="bi bi-check2 text-base text-emerald-300" />
                <span>¡Guardado!</span>
              </>
            ) : (
              <>
                <i className="bi bi-floppy" />
                <span>Guardar cambios</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Tabs Píldoras con Scroll Horizontal Táctil */}
      <div className="flex gap-1.5 bg-gray-100/90 p-1.5 rounded-2xl border border-gray-200/80 overflow-x-auto scrollbar-none -mx-1 px-1 sm:mx-0">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all active:scale-95 shrink-0 ${
              tab === t.id
                ? 'bg-white text-blue-600 shadow-sm font-black'
                : 'text-gray-500 hover:text-gray-800 hover:bg-white/50'
            }`}
          >
            <i className={`bi ${t.icon} text-sm ${tab === t.id ? 'text-blue-600' : 'text-gray-400'}`} />
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {/* ── TAB: INFO ── */}
      {tab === 'info' && (
        <div className="space-y-4 sm:space-y-6">
          {/* Cover & Logo */}
          <div className="bg-white rounded-3xl border border-gray-200/80 shadow-xs overflow-hidden">
            <div className="relative h-28 sm:h-44 bg-gray-100 group">
              {business.coverImage ? (
                <img src={business.coverImage} className="w-full h-full object-cover" alt="Portada" />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-100 to-gray-200">
                  <i className="bi bi-image text-gray-300 text-3xl sm:text-4xl" />
                </div>
              )}
              <label className="absolute bottom-2.5 right-2.5 sm:inset-0 sm:group-hover:bg-black/40 flex items-center justify-center bg-black/60 sm:bg-transparent text-white rounded-xl sm:rounded-none px-2.5 py-1.5 sm:px-0 sm:py-0 text-xs font-bold cursor-pointer transition-all sm:opacity-0 sm:group-hover:opacity-100">
                {uploadingCover ? (
                  <div className="animate-spin rounded-full h-5 w-5 sm:h-8 sm:w-8 border-2 border-white border-t-transparent" />
                ) : (
                  <span className="flex items-center gap-1.5">
                    <i className="bi bi-camera text-sm" />
                    <span className="text-[11px] sm:text-xs">Cambiar portada</span>
                  </span>
                )}
                <input type="file" accept="image/*" className="hidden" onChange={handleCoverUpload} />
              </label>
            </div>

            <div className="px-4 sm:px-6 pb-4 sm:pb-6 -mt-8 sm:-mt-10 relative flex items-end justify-between">
              <label className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-white border-4 border-white shadow-md overflow-hidden block cursor-pointer group/logo relative shrink-0">
                {business.image ? (
                  <img src={business.image} className="w-full h-full object-cover" alt="Logo" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gray-100">
                    <i className="bi bi-shop text-gray-400 text-xl sm:text-2xl" />
                  </div>
                )}
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover/logo:opacity-100 transition-opacity">
                  {uploadingProfile ? (
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                  ) : (
                    <i className="bi bi-camera text-white text-sm" />
                  )}
                </div>
                <input type="file" accept="image/*" className="hidden" onChange={handleProfileUpload} />
              </label>
              <span className="text-[10px] sm:text-xs text-gray-400 font-medium">Toca para cambiar foto</span>
            </div>
          </div>

          {/* Form Fields */}
          <div className="bg-white rounded-3xl border border-gray-200/80 shadow-xs p-4 sm:p-6 space-y-4">
            <h3 className="font-black text-gray-900 text-sm sm:text-base uppercase tracking-wider">Información General</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              {([
                { label: 'Nombre', field: 'name' as keyof Business, type: 'text' },
                { label: 'Username (URL)', field: 'username' as keyof Business, type: 'text' },
                { label: 'Email', field: 'email' as keyof Business, type: 'email' },
                { label: 'Teléfono / WhatsApp', field: 'phone' as keyof Business, type: 'text' },
                { label: 'Categoría', field: 'category' as keyof Business, type: 'text' },
                { label: 'Tiempo de entrega (min)', field: 'deliveryTime' as keyof Business, type: 'number' },
              ]).map(({ label, field, type }) => (
                <div key={field as string}>
                  <label className="block text-[11px] sm:text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">{label}</label>
                  <input
                    type={type}
                    value={(edited[field] as any) ?? ''}
                    onChange={e => handleField(field, type === 'number' ? Number(e.target.value) : e.target.value)}
                    className="w-full px-3.5 py-2.5 sm:py-2 bg-gray-50/70 border border-gray-200 rounded-2xl text-xs sm:text-sm font-medium text-gray-900 focus:outline-none focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 transition-all"
                  />
                </div>
              ))}
            </div>
            <div>
              <label className="block text-[11px] sm:text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Descripción</label>
              <textarea
                value={(edited.description as any) ?? ''}
                onChange={e => handleField('description', e.target.value)}
                rows={3}
                className="w-full px-3.5 py-2.5 sm:py-2 bg-gray-50/70 border border-gray-200 rounded-2xl text-xs sm:text-sm font-medium text-gray-900 focus:outline-none focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 transition-all resize-none"
              />
            </div>

            {/* Commission */}
            <div className="space-y-3 pt-4 border-t border-gray-100">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div>
                  <label className="block text-[11px] sm:text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Comisión Fuddi (%)</label>
                  <input
                    type="number"
                    min={0} max={100} step={0.5}
                    value={edited.defaultCommissionType === 'subscription' ? 0 : (edited.commissionRate ?? 10)}
                    disabled={edited.defaultCommissionType === 'subscription' || isApplyingCommission}
                    onChange={e => handleField('commissionRate', Number(e.target.value))}
                    className={`w-full px-3.5 py-2.5 sm:py-2 border border-gray-200 rounded-2xl text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${edited.defaultCommissionType === 'subscription' || isApplyingCommission ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-gray-50/70'}`}
                  />
                </div>
                <div>
                  <label className="block text-[11px] sm:text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Tipo de Comisión</label>
                  <select
                    value={edited.defaultCommissionType ?? 'fuddi_assumed_by_customer'}
                    disabled={isApplyingCommission}
                    onChange={async e => {
                      const val = e.target.value as CommissionType
                      const rate = val === 'subscription' ? 0 : (edited.commissionRate ?? 10)
                      if (val === 'subscription') {
                        setEdited(prev => prev ? { ...prev, defaultCommissionType: val, commissionRate: 0 } : null)
                      } else {
                        handleField('defaultCommissionType', val)
                      }
                      await handleApplyCommissionToAllProducts(val, rate)
                    }}
                    className={`w-full px-3.5 py-2.5 sm:py-2 border border-gray-200 rounded-2xl text-xs sm:text-sm font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white ${isApplyingCommission ? 'opacity-70 cursor-not-allowed' : ''}`}
                  >
                    <option value="fuddi_assumed_by_customer">Asumida por cliente</option>
                    <option value="fuddi_assumed_by_store">Asumida por tienda</option>
                    <option value="no_commission">Sin comisión</option>
                    <option value="fixed_commission">Comisión fija</option>
                    <option value="subscription">Suscripción</option>
                  </select>
                </div>
              </div>

              {/* Estado de sincronización automática de comisión en productos */}
              <div className="space-y-2">
                {isApplyingCommission && (
                  <div className="flex items-center gap-2.5 text-xs font-semibold text-blue-700 bg-blue-50 px-3.5 py-2.5 rounded-xl border border-blue-200/70 animate-pulse">
                    <div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-blue-600 border-t-transparent flex-shrink-0" />
                    <span>Aplicando tipo de comisión automáticamente a todos los productos de la tienda...</span>
                  </div>
                )}

                {commissionFeedback && !isApplyingCommission && (
                  <div className={`flex items-center gap-2 text-xs font-semibold px-3.5 py-2.5 rounded-xl border ${
                    commissionFeedback.type === 'success'
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                      : 'bg-rose-50 text-rose-800 border-rose-200'
                  }`}>
                    <i className={`bi ${commissionFeedback.type === 'success' ? 'bi-check-circle-fill text-emerald-600 text-sm' : 'bi-exclamation-triangle-fill text-rose-600 text-sm'} flex-shrink-0`} />
                    <span>{commissionFeedback.message}</span>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500 font-medium">
                  <span className="flex items-center gap-1.5">
                    <i className="bi bi-info-circle text-gray-400" />
                    Al seleccionar el tipo de comisión se aplica automáticamente a todos los productos de esta tienda.
                  </span>
                  <button
                    type="button"
                    disabled={isApplyingCommission}
                    onClick={() => handleApplyCommissionToAllProducts()}
                    className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700 font-bold transition-colors disabled:opacity-50 text-xs cursor-pointer"
                    title="Aplica la comisión y porcentaje actual a todos los productos"
                  >
                    <i className="bi bi-arrow-repeat" />
                    Reaplicar a productos
                  </button>
                </div>
              </div>
            </div>

            {/* Recargo por Empaque / Para Llevar */}
            <div className="pt-4 border-t border-gray-100 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-bold text-gray-900 text-xs uppercase tracking-wider flex items-center gap-1.5">
                    <i className="bi bi-box-seam text-amber-600 text-sm"></i>
                    Recargo por Empaque / Para Llevar
                  </h4>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Suma este valor al precio público de cada producto para cubrir empaque en pedidos de la app.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const nextVal = !edited.hasPackagingFee;
                    handleField('hasPackagingFee', nextVal);
                    if (nextVal && (!edited.packagingFee || edited.packagingFee <= 0)) {
                      handleField('packagingFee', 0.50);
                    }
                  }}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    edited.hasPackagingFee ? 'bg-amber-500' : 'bg-gray-200'
                  }`}
                  role="switch"
                  aria-checked={!!edited.hasPackagingFee}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      edited.hasPackagingFee ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {edited.hasPackagingFee && (
                <div className="bg-amber-50/60 p-4 rounded-xl border border-amber-200/60 grid grid-cols-1 md:grid-cols-2 gap-4 animate-fadeIn">
                  <div>
                    <label className="block text-xs font-bold text-amber-900 mb-1">
                      Monto del Recargo por Producto ($)
                    </label>
                    <input
                      type="number"
                      min={0}
                      step={0.05}
                      value={edited.packagingFee ?? 0.50}
                      onChange={e => handleField('packagingFee', Math.max(0, Number(e.target.value)))}
                      className="w-full px-3 py-2 border border-amber-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white font-bold text-amber-900"
                      placeholder="0.50"
                    />
                  </div>
                  <div className="flex items-center text-xs text-amber-800 leading-relaxed font-medium">
                    <i className="bi bi-info-circle-fill text-amber-600 text-base mr-2 flex-shrink-0"></i>
                    <span>
                      Ejemplo: Si un producto cuesta $3.00, con recargo de $0.50 el cliente verá el producto a $3.50 en la app.
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Información de Retiro en Tienda (Pickup) */}
          <div className="bg-white rounded-3xl border border-gray-200/80 shadow-xs p-4 sm:p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-100 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-red-50 border border-red-100 flex items-center justify-center text-red-600 shadow-xs shrink-0">
                  <i className="bi bi-shop-window text-xl" />
                </div>
                <div>
                  <h3 className="font-black text-gray-900 text-sm uppercase tracking-wider">Información de Retiro en Tienda (Pickup)</h3>
                  <p className="text-xs text-gray-500">Configura la disponibilidad, referencias, foto de fachada y ubicación GPS para retiro en local.</p>
                </div>
              </div>
              {edited.pickupSettings?.enabled && (
                <span className={`inline-flex items-center gap-1.5 text-xs font-black px-3 py-1 rounded-full shrink-0 ${
                  edited.pickupSettings.restrictToPrevious ? 'bg-amber-50 text-amber-800 border border-amber-200' : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                }`}>
                  <span className={`w-2 h-2 rounded-full ${edited.pickupSettings.restrictToPrevious ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                  {edited.pickupSettings.restrictToPrevious ? 'Solo Clientes Históricos' : 'Retiro Activo (Todos)'}
                </span>
              )}
            </div>

            {/* Estatus del Servicio de Retiro */}
            <div className="space-y-2">
              <label className="block text-[11px] sm:text-xs font-bold text-gray-700 uppercase tracking-wider">
                Estatus del Servicio de Retiro
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 sm:gap-3">
                {/* Opción: Desactivado */}
                <button
                  type="button"
                  onClick={() => {
                    handlePickupField('enabled', false)
                    handlePickupField('restrictToPrevious', false)
                  }}
                  className={`p-3.5 rounded-2xl border-2 text-left transition-all active:scale-95 flex flex-col justify-between ${
                    !edited.pickupSettings?.enabled
                      ? 'border-red-500 bg-red-50/60 text-red-900 shadow-xs'
                      : 'border-gray-200/80 bg-white text-gray-600 hover:border-gray-300'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-black text-xs uppercase tracking-wider">Desactivado</span>
                      {!edited.pickupSettings?.enabled && <i className="bi bi-check-circle-fill text-red-600 text-sm" />}
                    </div>
                    <p className="text-xs text-gray-500 leading-snug">Los clientes no podrán seleccionar retiro en tienda.</p>
                  </div>
                </button>

                {/* Opción: Activado (Todos) */}
                <button
                  type="button"
                  onClick={() => {
                    handlePickupField('enabled', true)
                    handlePickupField('restrictToPrevious', false)
                  }}
                  className={`p-3.5 rounded-2xl border-2 text-left transition-all active:scale-95 flex flex-col justify-between ${
                    edited.pickupSettings?.enabled && !edited.pickupSettings?.restrictToPrevious
                      ? 'border-emerald-600 bg-emerald-50/60 text-emerald-900 shadow-xs'
                      : 'border-gray-200/80 bg-white text-gray-600 hover:border-gray-300'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-black text-xs uppercase tracking-wider">Activado (Todos)</span>
                      {edited.pickupSettings?.enabled && !edited.pickupSettings?.restrictToPrevious && (
                        <i className="bi bi-check-circle-fill text-emerald-600 text-sm" />
                      )}
                    </div>
                    <p className="text-xs text-gray-500 leading-snug">Cualquier cliente puede elegir la opción de retiro en local.</p>
                  </div>
                </button>

                {/* Opción: Solo Históricos */}
                <button
                  type="button"
                  onClick={() => {
                    handlePickupField('enabled', true)
                    handlePickupField('restrictToPrevious', true)
                  }}
                  className={`p-3.5 rounded-2xl border-2 text-left transition-all active:scale-95 flex flex-col justify-between ${
                    edited.pickupSettings?.enabled && edited.pickupSettings?.restrictToPrevious
                      ? 'border-amber-600 bg-amber-50/60 text-amber-900 shadow-xs'
                      : 'border-gray-200/80 bg-white text-gray-600 hover:border-gray-300'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-black text-xs uppercase tracking-wider">Solo Históricos</span>
                      {edited.pickupSettings?.enabled && edited.pickupSettings?.restrictToPrevious && (
                        <i className="bi bi-check-circle-fill text-amber-600 text-sm" />
                      )}
                    </div>
                    <p className="text-xs text-gray-500 leading-snug">Solo clientes que hayan comprado antes en la tienda.</p>
                  </div>
                </button>
              </div>
            </div>

            {/* Detalles de Pickup */}
            <div className="space-y-4 pt-2">
              {/* Referencias / Instrucciones */}
              <div>
                <label className="block text-[11px] sm:text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                  Instrucciones de Retiro / Referencias del Local
                </label>
                <textarea
                  value={edited.pickupSettings?.references || ''}
                  onChange={e => handlePickupField('references', e.target.value)}
                  rows={3}
                  className="w-full px-3.5 py-2.5 bg-gray-50/70 border border-gray-200 rounded-2xl text-xs sm:text-sm font-medium text-gray-900 focus:outline-none focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 transition-all resize-none"
                  placeholder="Ej: Retirar en la ventanilla lateral frente al parque central..."
                />
              </div>

              {/* Foto Fachada del Local */}
              <div>
                <label className="block text-[11px] sm:text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                  Foto del Local / Fachada (Opcional)
                </label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
                  <div
                    onClick={() => document.getElementById('admin-pickup-photo-input')?.click()}
                    className="relative h-40 rounded-2xl border-2 border-dashed border-gray-200/80 hover:border-blue-400 bg-gray-50/70 flex items-center justify-center cursor-pointer overflow-hidden group transition-all"
                  >
                    {edited.pickupSettings?.storePhotoUrl ? (
                      <>
                        <img
                          src={edited.pickupSettings.storePhotoUrl}
                          alt="Fachada para Retiro"
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                          <span className="text-white text-xs font-bold flex items-center gap-1.5 bg-black/60 px-3 py-1.5 rounded-xl">
                            <i className="bi bi-camera" /> Cambiar foto
                          </span>
                        </div>
                      </>
                    ) : uploadingPickupPhoto ? (
                      <div className="flex flex-col items-center gap-2">
                        <div className="animate-spin rounded-full h-7 w-7 border-2 border-blue-600 border-t-transparent" />
                        <span className="text-xs text-gray-500 font-semibold">Subiendo foto...</span>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-1.5 text-gray-400 group-hover:text-blue-600 transition-colors">
                        <i className="bi bi-camera text-2xl" />
                        <span className="text-xs font-bold">Toca para subir foto del local</span>
                        <span className="text-[10px] text-gray-400">Ayuda a los clientes a ubicar la fachada</span>
                      </div>
                    )}
                    <input
                      id="admin-pickup-photo-input"
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={e => handlePickupPhotoUpload(e)}
                    />
                  </div>

                  <div className="space-y-2">
                    {edited.pickupSettings?.storePhotoUrl && (
                      <div className="flex flex-col gap-2">
                        <span className="text-xs font-bold text-emerald-700 flex items-center gap-1">
                          <i className="bi bi-check-circle-fill text-emerald-600" /> Foto de fachada configurada
                        </span>
                        <div className="flex items-center gap-2">
                          <a
                            href={edited.pickupSettings.storePhotoUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-xl text-xs font-bold text-gray-700 flex items-center gap-1 transition-all"
                          >
                            <i className="bi bi-box-arrow-up-right" /> Ver completa
                          </a>
                          <button
                            type="button"
                            onClick={() => handlePickupField('storePhotoUrl', '')}
                            className="px-3 py-1.5 bg-red-50 hover:bg-red-100 rounded-xl text-xs font-bold text-red-600 flex items-center gap-1 transition-all"
                          >
                            <i className="bi bi-trash" /> Eliminar foto
                          </button>
                        </div>
                      </div>
                    )}
                    <p className="text-xs text-gray-500 leading-relaxed font-medium">
                      Una foto clara del establecimiento facilita que los clientes identifiquen la tienda física al momento de retirar su compra.
                    </p>
                  </div>
                </div>
              </div>

              {/* Ubicación GPS & Mapa */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[11px] sm:text-xs font-bold text-gray-700 uppercase tracking-wider flex items-center gap-1.5">
                    <i className="bi bi-geo-alt-fill text-red-500" />
                    Ubicación Exacta de Retiro (Latitud, Longitud)
                  </label>
                  <button
                    type="button"
                    onClick={() => getPickupLocation()}
                    disabled={locatingPickup}
                    className="flex items-center gap-1 text-xs font-bold text-blue-600 hover:text-blue-800 transition-colors disabled:opacity-50"
                  >
                    <i className={`bi ${locatingPickup ? 'animate-spin bi-arrow-repeat' : 'bi-crosshair'}`} />
                    {locatingPickup ? 'Obteniendo GPS...' : 'Usar mi GPS actual'}
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mb-3">
                  <div className="sm:col-span-2">
                    <input
                      type="text"
                      value={edited.pickupSettings?.latlong || ''}
                      onChange={e => handlePickupField('latlong', e.target.value)}
                      placeholder="Ej: -0.180653, -78.467834"
                      className="w-full px-3.5 py-2.5 bg-gray-50/70 border border-gray-200 rounded-2xl text-xs sm:text-sm font-mono text-gray-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    />
                  </div>
                  {edited.pickupSettings?.latlong ? (
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(edited.pickupSettings.latlong)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-1.5 px-3 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200/60 rounded-2xl text-xs font-bold transition-all active:scale-95"
                    >
                      <i className="bi bi-map-fill" /> Abrir en Maps
                    </a>
                  ) : (
                    <div className="flex items-center justify-center px-3 py-2 bg-gray-100 text-gray-400 rounded-2xl text-xs font-medium">
                      Sin coordenadas
                    </div>
                  )}
                </div>

                {/* Mapa interactivo */}
                <div className="rounded-2xl overflow-hidden border border-gray-200/80 shadow-inner h-52 sm:h-64 relative bg-gray-50">
                  {(() => {
                    const rawLatlong = edited.pickupSettings?.latlong || ''
                    const coords = rawLatlong.split(',').map((c: string) => parseFloat(c.trim()))
                    const lat = !isNaN(coords[0]) ? coords[0] : -0.1807
                    const lng = !isNaN(coords[1]) ? coords[1] : -78.4678

                    return (
                      <GoogleMap
                        latitude={lat}
                        longitude={lng}
                        height="100%"
                        draggable={true}
                        fixedCenterMarker={true}
                        onLocationChange={handlePickupLocationChange}
                      />
                    )
                  })()}
                </div>
                <p className="text-[11px] text-gray-400 font-medium mt-1.5 text-center">
                  Arrastra el mapa para ajustar la ubicación exacta del pin.
                </p>
              </div>
            </div>
          </div>

          {/* Save */}
          <div className="flex justify-end pt-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 disabled:opacity-60 text-white rounded-2xl text-sm font-bold shadow-md shadow-blue-600/20 active:scale-95 transition-all"
            >
              {saving ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                  Guardando...
                </>
              ) : saved ? (
                <>
                  <i className="bi bi-check2 text-base text-emerald-300" />
                  ¡Guardado!
                </>
              ) : (
                <>
                  <i className="bi bi-floppy" />
                  Guardar cambios
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ── TAB: SCHEDULE ── */}
      {tab === 'schedule' && (
        <div className="space-y-4">
          <div className="bg-white rounded-3xl border border-gray-200/80 shadow-xs p-4 sm:p-6 space-y-4">
            <h3 className="font-black text-gray-900 text-sm sm:text-base uppercase tracking-wider">Horarios de Atención</h3>
            <div className="space-y-2.5">
              {DAY_ORDER.map(day => {
                const daySchedule = edited.schedule?.[day] || { open: '09:00', close: '18:00', isOpen: true }
                return (
                  <div key={day} className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 sm:p-4 rounded-2xl border transition-all ${daySchedule.isOpen ? 'border-blue-100 bg-blue-50/40' : 'border-gray-200/60 bg-gray-50/50'}`}>
                    <div className="flex items-center justify-between sm:justify-start gap-3">
                      <button
                        onClick={() => handleScheduleField(day, 'isOpen', !daySchedule.isOpen)}
                        className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${daySchedule.isOpen ? 'bg-blue-600' : 'bg-gray-300'}`}
                      >
                        <span className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${daySchedule.isOpen ? 'translate-x-5' : ''}`} />
                      </button>
                      <span className="text-xs sm:text-sm font-black text-gray-900">{DAYS_ES[day]}</span>
                      {!daySchedule.isOpen && <span className="text-[10px] font-black text-gray-400 uppercase tracking-wider bg-gray-200/60 px-2 py-0.5 rounded-full sm:hidden">Cerrado</span>}
                    </div>
                    <div className={`flex items-center gap-2 ${!daySchedule.isOpen ? 'opacity-40 pointer-events-none' : ''}`}>
                      <input
                        type="time"
                        value={daySchedule.open}
                        onChange={e => handleScheduleField(day, 'open', e.target.value)}
                        className="px-2.5 py-1.5 bg-white border border-gray-200 rounded-xl text-xs sm:text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <span className="text-gray-400 text-xs">→</span>
                      <input
                        type="time"
                        value={daySchedule.close}
                        onChange={e => handleScheduleField(day, 'close', e.target.value)}
                        className="px-2.5 py-1.5 bg-white border border-gray-200 rounded-xl text-xs sm:text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    {!daySchedule.isOpen && <span className="hidden sm:inline text-xs font-bold text-gray-400 uppercase tracking-wider">Cerrado</span>}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Manual status */}
          <div className="bg-white rounded-3xl border border-gray-200/80 shadow-xs p-4 sm:p-6 space-y-4">
            <h3 className="font-black text-gray-900 text-sm sm:text-base uppercase tracking-wider">Estado Manual</h3>
            <p className="text-xs text-gray-500 font-medium">Override temporal del horario automático.</p>
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              {[
                { val: null, label: 'Automático', color: 'gray' },
                { val: 'open', label: 'Forzar Abierto', color: 'green' },
                { val: 'closed', label: 'Forzar Cerrado', color: 'red' },
              ].map(({ val, label, color }) => {
                const current = edited.manualStoreStatus ?? null
                const active = current === val
                const colorMap: Record<string, string> = {
                  gray: active ? 'bg-gray-900 text-white border-gray-900 shadow-sm' : 'bg-white text-gray-600 border-gray-200/80 hover:border-gray-300',
                  green: active ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm' : 'bg-white text-emerald-700 border-emerald-200/80 hover:border-emerald-300',
                  red: active ? 'bg-rose-600 text-white border-rose-600 shadow-sm' : 'bg-white text-rose-700 border-rose-200/80 hover:border-rose-300',
                }
                return (
                  <button
                    key={label}
                    onClick={() => handleField('manualStoreStatus', val)}
                    className={`py-2.5 px-2 sm:px-3 rounded-2xl border text-[11px] sm:text-xs font-bold transition-all active:scale-95 ${colorMap[color]}`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 disabled:opacity-60 text-white rounded-2xl text-sm font-bold shadow-md shadow-blue-600/20 active:scale-95 transition-all"
            >
              {saving ? <><div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />Guardando...</> : saved ? <><i className="bi bi-check2" />¡Guardado!</> : <><i className="bi bi-floppy" />Guardar horarios</>}
            </button>
          </div>
        </div>
      )}

      {/* ── TAB: PRODUCTS ── */}
      {tab === 'products' && (
        <div className="bg-white rounded-3xl border border-gray-200/80 shadow-xs p-3.5 sm:p-6">
          <ProductList
            business={business}
            products={products}
            categories={categories}
            onProductsChange={setProducts}
            onCategoriesChange={setCategories}
            onDirectUpdate={handleDirectUpdate}
          />
        </div>
      )}

      {/* ── TAB: DELIVERY ── */}
      {tab === 'delivery' && (
        <div className="space-y-4 sm:space-y-6">
          {/* Service type selector */}
          <div className="bg-white rounded-3xl border border-gray-200/80 shadow-xs p-4 sm:p-6 space-y-4 sm:space-y-5">
            <div>
              <h3 className="text-xs font-black text-gray-900 uppercase tracking-wider mb-1">Tipo de Servicio de Delivery</h3>
              <p className="text-xs text-gray-500 font-medium">Define cómo se gestionan las entregas de esta tienda.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              {/* Self-managed */}
              <button
                onClick={() => handleField('deliveryServiceType', 'self')}
                className={`relative flex flex-col gap-3 p-4 sm:p-5 rounded-2xl border-2 text-left transition-all active:scale-[0.99] ${
                  (edited.deliveryServiceType ?? 'fuddi') === 'self'
                    ? 'border-orange-500 bg-orange-50/70 shadow-xs'
                    : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
              >
                {(edited.deliveryServiceType ?? 'fuddi') === 'self' && (
                  <span className="absolute top-3.5 right-3.5 w-5 h-5 rounded-full bg-orange-500 flex items-center justify-center shadow-xs">
                    <i className="bi bi-check text-white text-xs font-bold" />
                  </span>
                )}
                <div className="w-11 h-11 rounded-xl bg-orange-100 flex items-center justify-center">
                  <i className="bi bi-person-badge text-orange-600 text-xl" />
                </div>
                <div>
                  <p className="font-bold text-gray-900 text-sm">Autogestión</p>
                  <p className="text-xs text-gray-500 mt-1 leading-relaxed font-normal">La tienda gestiona sus propias entregas con su repartidor asignado. Fuddi no interviene en la búsqueda.</p>
                </div>
              </button>

              {/* Fuddi delivery */}
              <button
                onClick={() => handleField('deliveryServiceType', 'fuddi')}
                className={`relative flex flex-col gap-3 p-4 sm:p-5 rounded-2xl border-2 text-left transition-all active:scale-[0.99] ${
                  (edited.deliveryServiceType ?? 'fuddi') === 'fuddi'
                    ? 'border-blue-600 bg-blue-50/70 shadow-xs'
                    : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
              >
                {(edited.deliveryServiceType ?? 'fuddi') === 'fuddi' && (
                  <span className="absolute top-3.5 right-3.5 w-5 h-5 rounded-full bg-blue-600 flex items-center justify-center shadow-xs">
                    <i className="bi bi-check text-white text-xs font-bold" />
                  </span>
                )}
                <div className="w-11 h-11 rounded-xl bg-blue-100 flex items-center justify-center">
                  <i className="bi bi-scooter text-blue-600 text-xl" />
                </div>
                <div>
                  <p className="font-bold text-gray-900 text-sm">Delivery Fuddi</p>
                  <p className="text-xs text-gray-500 mt-1 leading-relaxed font-normal">Fuddi asigna automáticamente un repartidor de la red según zona y disponibilidad.</p>
                </div>
              </button>
            </div>

            {/* Info banner */}
            <div className={`flex items-start gap-3 p-3.5 sm:p-4 rounded-2xl text-sm ${
              (edited.deliveryServiceType ?? 'fuddi') === 'self'
                ? 'bg-orange-50/80 border border-orange-200/60 text-orange-900'
                : 'bg-blue-50/80 border border-blue-200/60 text-blue-900'
            }`}>
              <i className={`bi bi-info-circle-fill mt-0.5 flex-shrink-0 text-base ${
                (edited.deliveryServiceType ?? 'fuddi') === 'self' ? 'text-orange-500' : 'text-blue-600'
              }`} />
              <p className="text-xs leading-relaxed font-medium">
                {(edited.deliveryServiceType ?? 'fuddi') === 'self'
                  ? 'En modo Autogestión, los pedidos se asignarán al repartidor predeterminado configurado abajo. Si no hay uno definido, la tienda deberá asignar manualmente cada pedido.'
                  : 'En modo Fuddi, el sistema buscará automáticamente un repartidor disponible según la zona del cliente y la configuración de zonas de cobertura.'}
              </p>
            </div>
          </div>

          {/* Control de Tarifas de Envío por Zona (Administrador) */}
          <div className="bg-white rounded-3xl border border-gray-200/80 shadow-xs p-4 sm:p-6">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 pr-2">
                <h3 className="text-xs font-black text-gray-900 uppercase tracking-wider mb-1">Tarifas de Envío de la Tienda</h3>
                <p className="text-xs text-gray-500 font-medium leading-relaxed">
                  Permite que esta tienda defina sus propios precios de delivery por zona geográfica en su panel. Si está desactivado, el checkout cobrará las tarifas estándar de Fuddi.
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
                <input
                  type="checkbox"
                  checked={edited.deliveryZoneSettings?.useCustomFees ?? (edited.deliveryServiceType === 'self')}
                  onChange={(e) => {
                    const checked = e.target.checked
                    setEdited(prev => prev ? {
                      ...prev,
                      deliveryZoneSettings: {
                        useCustomFees: checked,
                        zones: prev.deliveryZoneSettings?.zones || {}
                      }
                    } : null)
                  }}
                  className="sr-only peer"
                />
                <div className="w-12 h-6.5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5.5 after:w-5.5 after:transition-all peer-checked:bg-blue-600 shadow-inner"></div>
              </label>
            </div>
          </div>

          {/* Default delivery picker */}
          <div className="bg-white rounded-3xl border border-gray-200/80 shadow-xs p-4 sm:p-6 space-y-4">
            <div>
              <h3 className="text-xs font-black text-gray-900 uppercase tracking-wider mb-1">Repartidor Predeterminado</h3>
              <p className="text-xs text-gray-500 font-medium">
                {(edited.deliveryServiceType ?? 'fuddi') === 'self'
                  ? 'Todos los pedidos se asignarán a este repartidor automáticamente.'
                  : 'Opcional. Si se configura, tiene prioridad sobre la asignación automática por zonas.'}
              </p>
            </div>

            {loadingDeliveries ? (
              <div className="flex items-center gap-3 py-6 text-gray-400 justify-center">
                <div className="animate-spin rounded-full h-5 w-5 border-2 border-gray-300 border-t-blue-600" />
                <span className="text-xs font-medium">Cargando repartidores...</span>
              </div>
            ) : deliveries.length === 0 ? (
              <div className="py-8 text-center bg-gray-50/60 rounded-2xl border border-dashed border-gray-200">
                <i className="bi bi-person-x text-3xl text-gray-300 block mb-2" />
                <p className="text-xs font-semibold text-gray-500">No hay repartidores activos registrados.</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {/* No default option */}
                <button
                  onClick={() => handleField('defaultDeliveryId', undefined)}
                  className={`w-full flex items-center gap-3 p-3.5 rounded-2xl border transition-all text-left active:scale-[0.99] ${
                    !edited.defaultDeliveryId
                      ? 'border-gray-900 bg-gray-50 text-gray-900 font-semibold'
                      : 'border-gray-200/80 bg-white hover:border-gray-300 text-gray-600'
                  }`}
                >
                  <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center flex-shrink-0 text-gray-400">
                    <i className="bi bi-slash-circle text-lg" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-gray-900 truncate">Sin predeterminado</p>
                    <p className="text-[11px] text-gray-400 truncate">Se usará la asignación automática por zonas</p>
                  </div>
                  {!edited.defaultDeliveryId && (
                    <span className="w-5 h-5 rounded-full bg-gray-900 flex items-center justify-center flex-shrink-0">
                      <i className="bi bi-check text-white text-xs font-bold" />
                    </span>
                  )}
                </button>

                {/* Deliveries list */}
                {deliveries.map(d => (
                  <button
                    key={d.id}
                    onClick={() => handleField('defaultDeliveryId', d.id)}
                    className={`w-full flex items-center gap-3 p-3.5 rounded-2xl border transition-all text-left active:scale-[0.99] ${
                      edited.defaultDeliveryId === d.id
                        ? 'border-blue-600 bg-blue-50/60'
                        : 'border-gray-200/80 bg-white hover:border-gray-300'
                    }`}
                  >
                    <div className="w-10 h-10 rounded-xl overflow-hidden bg-gray-100 flex-shrink-0 border border-gray-200/50">
                      {d.fotoUrl
                        ? <img src={d.fotoUrl} alt={d.nombres} className="w-full h-full object-cover" />
                        : <div className="w-full h-full flex items-center justify-center"><i className="bi bi-person text-gray-400 text-lg" /></div>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-black text-gray-900 truncate">{d.nombres}</p>
                      <p className="text-[11px] text-gray-400 truncate font-mono">{d.celular}</p>
                    </div>
                    <span className={`text-[10px] font-black px-2.5 py-1 rounded-full uppercase tracking-wider shrink-0 ${
                      d.estado === 'activo' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/60' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {d.estado === 'activo' ? 'Activo' : 'Inactivo'}
                    </span>
                    {edited.defaultDeliveryId === d.id && (
                      <span className="w-5 h-5 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0 shadow-xs">
                        <i className="bi bi-check text-white text-xs font-bold" />
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Save Delivery */}
          <div className="flex justify-end pt-2">
            <button
              onClick={handleSaveDelivery}
              disabled={savingDelivery}
              className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-2xl text-xs font-black tracking-wide transition-all shadow-sm active:scale-95"
            >
              {savingDelivery
                ? <><div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />Guardando...</>
                : deliverySaved
                  ? <><i className="bi bi-check2 text-base text-emerald-300" />¡Configuración guardada!</>
                  : <><i className="bi bi-floppy" />Guardar configuración de delivery</>}
            </button>
          </div>
        </div>
      )}

      {/* ── TAB: NOTIFICATIONS ── */}
      {tab === 'notifications' && (
        <div className="bg-white rounded-3xl border border-gray-200/80 shadow-xs p-4 sm:p-6">
          <NotificationSettings
            business={edited}
            onBusinessFieldChange={handleNotificationUpdate}
          />
        </div>
      )}

      {/* ── TAB: DANGER / SETTINGS ── */}
      {tab === 'danger' && (
        <div className="space-y-4">
          {/* Visibility */}
          <div className="bg-white rounded-3xl border border-gray-200/80 shadow-xs p-4 sm:p-6">
            <h3 className="text-xs font-black text-gray-900 uppercase tracking-wider mb-1">Visibilidad de la Tienda</h3>
            <p className="text-xs text-gray-500 mb-4 font-medium">Controla si la tienda aparece en el catálogo público y buscadores.</p>
            <div className="flex items-center justify-between p-4 bg-gray-50/80 rounded-2xl border border-gray-200/60">
              <div className="min-w-0 pr-3">
                <p className="font-bold text-gray-900 text-xs sm:text-sm">Tienda oculta</p>
                <p className="text-[11px] text-gray-500 mt-0.5">{business.isHidden ? 'Los clientes no pueden ver esta tienda' : 'La tienda es visible en el catálogo'}</p>
              </div>
              <button
                onClick={handleToggleHidden}
                className={`relative w-12 h-6.5 rounded-full transition-colors flex-shrink-0 ${business.isHidden ? 'bg-amber-500' : 'bg-gray-300'}`}
              >
                <span className={`absolute top-1 left-1 w-4.5 h-4.5 bg-white rounded-full shadow transition-transform ${business.isHidden ? 'translate-x-5.5' : ''}`} />
              </button>
            </div>
          </div>

          {/* Active status */}
          <div className={`bg-white rounded-3xl border shadow-xs p-4 sm:p-6 ${business.isActive ? 'border-gray-200/80' : 'border-rose-200 bg-rose-50/20'}`}>
            <h3 className="text-xs font-black text-gray-900 uppercase tracking-wider mb-1">Estado de Activación</h3>
            <p className="text-xs text-gray-500 mb-4 font-medium">Desactivar impide el acceso al dashboard de la tienda y detiene la recepción de pedidos.</p>
            <div className="flex items-center justify-between p-4 rounded-2xl bg-gray-50/80 border border-gray-200/60">
              <div className="min-w-0 pr-3">
                <p className="font-bold text-xs sm:text-sm text-gray-900">{business.isActive ? 'Tienda activa' : 'Tienda inactiva'}</p>
                <p className="text-[11px] text-gray-500 mt-0.5">{business.isActive ? 'El negocio puede operar normalmente' : 'El negocio está desactivado'}</p>
              </div>
              <button
                onClick={handleToggleActive}
                className={`px-4 py-2.5 rounded-xl text-xs font-black transition-all active:scale-95 shrink-0 ${business.isActive ? 'bg-rose-100 text-rose-700 hover:bg-rose-200' : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'}`}
              >
                {business.isActive ? 'Desactivar' : 'Activar'}
              </button>
            </div>
          </div>

          {/* Dashboard link */}
          <div className="bg-white rounded-3xl border border-gray-200/80 shadow-xs p-4 sm:p-6">
            <h3 className="text-xs font-black text-gray-900 uppercase tracking-wider mb-1">Accesos Rápidos</h3>
            <p className="text-xs text-gray-500 mb-4 font-medium">Navega directamente a los paneles externos del negocio.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <a
                href={`/business/${business.username || business.id}/dashboard`}
                target="_blank"
                className="flex items-center justify-center gap-2 px-4 py-3 bg-blue-50/80 text-blue-700 rounded-2xl text-xs font-bold hover:bg-blue-100 transition-all border border-blue-100"
              >
                <i className="bi bi-speedometer2 text-base" /> Ver Dashboard de Tienda
              </a>
              <a
                href={`/${business.username || business.id}`}
                target="_blank"
                className="flex items-center justify-center gap-2 px-4 py-3 bg-gray-50 text-gray-700 rounded-2xl text-xs font-bold hover:bg-gray-100 transition-all border border-gray-200/60"
              >
                <i className="bi bi-shop text-base" /> Ver Catálogo Público
              </a>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: ADMINS ── */}
      {tab === 'admins' && (
        <div className="space-y-5">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <div>
              <h2 className="text-base sm:text-lg font-black text-gray-900 tracking-tight">Propietario y Administradores</h2>
              <p className="text-xs text-gray-500 font-medium">Gestiona accesos, permisos y enlaces de acceso directo para esta tienda.</p>
            </div>
            <button
              onClick={() => setShowAddAdminModal(true)}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl text-xs font-black transition-all shadow-sm active:scale-95"
            >
              <i className="bi bi-person-plus-fill" /> Agregar Administrador
            </button>
          </div>

          <div className="bg-white rounded-3xl border border-gray-200/80 shadow-xs overflow-hidden divide-y divide-gray-100">
            {/* Propietario */}
            <div className="p-4 sm:p-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-gray-50/50">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 bg-amber-100/80 rounded-2xl flex items-center justify-center flex-shrink-0 text-amber-700">
                  <i className="bi bi-crown-fill text-base" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs sm:text-sm font-black text-gray-900 truncate">{business.email}</p>
                  <p className="text-[11px] text-gray-400 font-medium">Propietario principal</p>
                </div>
              </div>
              
              <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-between sm:justify-end">
                {/* Magic Link Controls */}
                <div className="flex items-center border border-gray-200 bg-white rounded-xl p-1 shadow-2xs">
                  <button
                    onClick={() => handleCopyMagicLink(business.email)}
                    disabled={loadingLink[business.email]}
                    className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-bold text-gray-700 hover:text-gray-900 transition-colors disabled:opacity-50"
                    title="Copiar enlace de acceso directo"
                  >
                    {loadingLink[business.email] ? (
                      <span className="w-3.5 h-3.5 border-2 border-gray-400 border-t-gray-700 rounded-full animate-spin me-1.5"></span>
                    ) : copiedLink[business.email] ? (
                      <i className="bi bi-check-lg text-emerald-600 me-1.5"></i>
                    ) : (
                      <i className="bi bi-link-45deg text-sm me-1"></i>
                    )}
                    {copiedLink[business.email] ? '¡Copiado!' : 'Acceso Directo'}
                  </button>
                  <button
                    onClick={() => handleRegenerateMagicLink(business.email)}
                    disabled={loadingLink[business.email]}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
                    title="Regenerar enlace de acceso directo (invalida el anterior)"
                  >
                    <i className="bi bi-arrow-clockwise text-xs"></i>
                  </button>
                </div>
                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-100/70 text-amber-900 border border-amber-200/50">
                  Acceso Total
                </span>
              </div>
            </div>

            {/* Administradores */}
            {business.administrators && business.administrators.length > 0 ? (
              business.administrators.map((admin, index) => (
                <div key={index} className="p-4 sm:p-6 space-y-3">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 bg-blue-100/70 rounded-2xl flex items-center justify-center flex-shrink-0 text-blue-600">
                        <i className="bi bi-person-fill text-lg" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs sm:text-sm font-black text-gray-900 truncate">{admin.email}</p>
                        <p className="text-[11px] text-gray-400 font-medium capitalize">{admin.role === 'admin' ? 'Administrador' : 'Gerente'}</p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                      {/* Magic Link Controls */}
                      <div className="flex items-center border border-gray-200 bg-white rounded-xl p-1 shadow-2xs">
                        <button
                          onClick={() => handleCopyMagicLink(admin.email)}
                          disabled={loadingLink[admin.email]}
                          className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-bold text-gray-700 hover:text-gray-900 transition-colors disabled:opacity-50"
                          title="Copiar enlace de acceso directo"
                        >
                          {loadingLink[admin.email] ? (
                            <span className="w-3.5 h-3.5 border-2 border-gray-400 border-t-gray-700 rounded-full animate-spin me-1.5"></span>
                          ) : copiedLink[admin.email] ? (
                            <i className="bi bi-check-lg text-emerald-600 me-1.5"></i>
                          ) : (
                            <i className="bi bi-link-45deg text-sm me-1"></i>
                          )}
                          {copiedLink[admin.email] ? '¡Copiado!' : 'Acceso Directo'}
                        </button>
                        <button
                          onClick={() => handleRegenerateMagicLink(admin.email)}
                          disabled={loadingLink[admin.email]}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
                          title="Regenerar enlace de acceso directo (invalida el anterior)"
                        >
                          <i className="bi bi-arrow-clockwise text-xs"></i>
                        </button>
                      </div>

                      <button
                        onClick={() => { setPasswordAdminEmail(admin.email); setAdminPassword(''); }}
                        className="px-3 py-1.5 bg-white border border-gray-200 text-gray-700 hover:text-gray-900 rounded-xl text-xs font-bold transition-all shadow-2xs flex items-center gap-1.5"
                      >
                        <i className="bi bi-key" /> Acceso
                      </button>

                      <button
                        onClick={() => handleRemoveAdmin(admin.email)}
                        className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5"
                      >
                        <i className="bi bi-trash" />
                      </button>
                    </div>
                  </div>

                  {/* Permisos */}
                  <div className="pl-0 sm:pl-13">
                    <p className="text-[10px] font-black uppercase tracking-wider text-gray-400 mb-1.5">Permisos asignados:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {admin.permissions.manageProducts && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-100">
                          Productos
                        </span>
                      )}
                      {admin.permissions.manageOrders && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-100">
                          Pedidos
                        </span>
                      )}
                      {admin.permissions.viewReports && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-100">
                          Reportes
                        </span>
                      )}
                      {admin.permissions.editBusiness && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-100">
                          Editar Tienda
                        </span>
                      )}
                      {admin.permissions.manageAdmins && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-100">
                          Administradores
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="py-10 text-center text-gray-400">
                <i className="bi bi-people text-4xl block mb-2 text-gray-300" />
                <p className="text-xs font-semibold">No hay administradores adicionales registrados.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── MODAL: AGREGAR ADMINISTRADOR ── */}
      {showAddAdminModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl max-w-md w-full border border-gray-200 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="px-5 sm:px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
              <h3 className="text-sm font-black text-gray-900 tracking-tight">Agregar Administrador</h3>
              <button onClick={() => setShowAddAdminModal(false)} className="text-gray-400 hover:text-gray-600 p-1.5"><i className="bi bi-x-lg" /></button>
            </div>

            <div className="p-5 sm:p-6 space-y-4">
              <div>
                <label className="block text-xs font-black text-gray-700 uppercase tracking-wider mb-1.5">Email del Usuario</label>
                <input
                  type="email"
                  value={newAdminData.email}
                  onChange={e => setNewAdminData(prev => ({ ...prev, email: e.target.value }))}
                  className="w-full px-3.5 py-2.5 border border-gray-200 rounded-2xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                  placeholder="usuario@ejemplo.com"
                />
              </div>

              <div>
                <label className="block text-xs font-black text-gray-700 uppercase tracking-wider mb-1.5">Contraseña de acceso</label>
                <input
                  type="password"
                  value={newAdminData.password}
                  onChange={e => setNewAdminData(prev => ({ ...prev, password: e.target.value }))}
                  className="w-full px-3.5 py-2.5 border border-gray-200 rounded-2xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                  placeholder="Mínimo 6 caracteres"
                  autoComplete="new-password"
                />
                <p className="text-[10px] text-gray-400 mt-1 font-medium">Si la dejas vacía, solo se agregará el permiso y se podrá configurar la contraseña después.</p>
              </div>

              <div>
                <label className="block text-xs font-black text-gray-700 uppercase tracking-wider mb-1.5">Rol</label>
                <select
                  value={newAdminData.role}
                  onChange={e => setNewAdminData(prev => ({ ...prev, role: e.target.value as any }))}
                  className="w-full px-3.5 py-2.5 border border-gray-200 rounded-2xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white font-medium"
                >
                  <option value="admin">Administrador</option>
                  <option value="manager">Gerente</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-black text-gray-700 uppercase tracking-wider mb-1.5">Permisos</label>
                <div className="space-y-2 bg-gray-50/80 p-3.5 rounded-2xl border border-gray-200/60">
                  {[
                    { key: 'manageProducts', label: 'Gestionar Productos' },
                    { key: 'manageOrders', label: 'Gestionar Pedidos' },
                    { key: 'viewReports', label: 'Ver Reportes' },
                    { key: 'editBusiness', label: 'Editar Información de Tienda' },
                    { key: 'manageAdmins', label: 'Gestionar Administradores' },
                  ].map(({ key, label }) => (
                    <label key={key} className="flex items-center text-xs font-bold text-gray-700 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={newAdminData.permissions[key as keyof typeof newAdminData.permissions]}
                        onChange={e => setNewAdminData(prev => ({
                          ...prev,
                          permissions: { ...prev.permissions, [key]: e.target.checked }
                        }))}
                        className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 me-2.5"
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="px-5 sm:px-6 py-4 bg-gray-50/50 border-t border-gray-100 flex justify-end gap-2">
              <button
                onClick={() => setShowAddAdminModal(false)}
                className="px-4 py-2.5 border border-gray-200 hover:bg-gray-100 rounded-2xl text-xs font-bold text-gray-600 transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={handleAddAdmin}
                disabled={addingAdmin || !newAdminData.email.trim() || (!!newAdminData.password && newAdminData.password.length < 6)}
                className="flex items-center gap-1.5 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-2xl text-xs font-black transition-all shadow-sm active:scale-95"
              >
                {addingAdmin ? <><div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-white border-t-transparent" />Guardando...</> : 'Guardar Administrador'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: EDITAR CONTRASEÑA DE ADMINISTRADOR ── */}
      {passwordAdminEmail && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl max-w-md w-full border border-gray-200 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="px-5 sm:px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
              <h3 className="text-sm font-black text-gray-900 tracking-tight">Editar Contraseña de Acceso</h3>
              <button onClick={() => setPasswordAdminEmail(null)} className="text-gray-400 hover:text-gray-600 p-1.5"><i className="bi bi-x-lg" /></button>
            </div>

            <div className="p-5 sm:p-6 space-y-4">
              <p className="text-xs text-gray-500 font-medium">
                Estás configurando una nueva contraseña de acceso para: <strong className="text-gray-900 font-bold">{passwordAdminEmail}</strong>
              </p>

              <div>
                <label className="block text-xs font-black text-gray-700 uppercase tracking-wider mb-1.5">Nueva Contraseña</label>
                <input
                  type="password"
                  value={adminPassword}
                  onChange={e => setAdminPassword(e.target.value)}
                  className="w-full px-3.5 py-2.5 border border-gray-200 rounded-2xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                  placeholder="Mínimo 6 caracteres"
                  autoComplete="new-password"
                />
              </div>
            </div>

            <div className="px-5 sm:px-6 py-4 bg-gray-50/50 border-t border-gray-100 flex justify-end gap-2">
              <button
                onClick={() => setPasswordAdminEmail(null)}
                className="px-4 py-2.5 border border-gray-200 hover:bg-gray-100 rounded-2xl text-xs font-bold text-gray-600 transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveAdminPassword}
                disabled={savingAdminPassword || adminPassword.length < 6}
                className="flex items-center gap-1.5 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-2xl text-xs font-black transition-all shadow-sm active:scale-95"
              >
                {savingAdminPassword ? <><div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-white border-t-transparent" />Guardando...</> : 'Actualizar Contraseña'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Floating Action Bar */}
      {hasChanges && (
        <div className="fixed bottom-4 left-4 right-4 z-40 sm:hidden">
          <div className="bg-gray-900/95 backdrop-blur-md text-white p-3.5 rounded-2xl shadow-2xl border border-gray-800 flex items-center justify-between gap-3 animate-in slide-in-from-bottom-3 duration-200">
            <div className="min-w-0 pl-1">
              <p className="text-xs font-black text-white truncate">
                Cambios sin guardar
              </p>
              <p className="text-[10px] text-gray-400 font-medium">
                Toca guardar para aplicar
              </p>
            </div>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2.5 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 disabled:opacity-60 text-white rounded-xl text-xs font-black shadow-md shadow-blue-600/30 active:scale-95 transition-all shrink-0"
            >
              {saving ? (
                <>
                  <div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-white border-t-transparent" />
                  <span>Guardando...</span>
                </>
              ) : saved ? (
                <>
                  <i className="bi bi-check2 text-base text-emerald-400" />
                  <span>¡Guardado!</span>
                </>
              ) : (
                <>
                  <i className="bi bi-floppy" />
                  <span>Guardar</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
