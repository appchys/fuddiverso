'use client'

import { useState, useEffect, useMemo, useTransition } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import {
  getAllBusinesses,
  updateBusiness,
  createBusinessFromForm,
  getCoverageGroups,
  invalidateBusinessCache
} from '@/lib/database'
import { isStoreOpen } from '@/lib/store-utils'
import { normalizeEcuadorianPhone } from '@/lib/validation'
import { Business } from '@/types'
import AdminStoresMap, { extractBusinessCoords, StoreCoordinates } from '@/components/AdminStoresMap'

export default function AdminBusinessesPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [businesses, setBusinesses] = useState<Business[]>([])
  const [coverageGroups, setCoverageGroups] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [viewMode, setViewMode] = useState<'list' | 'map'>(() =>
    searchParams?.get('tab') === 'map' || searchParams?.get('view') === 'map' ? 'map' : 'list'
  )
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'visible' | 'hidden' | 'open' | 'closed'>('all')
  const [groupFilter, setGroupFilter] = useState<string>('all')
  const [updatingBusinessId, setUpdatingBusinessId] = useState<string | null>(null)
  const [showNewStoreModal, setShowNewStoreModal] = useState(false)
  const [openPopover, setOpenPopover] = useState<{
    businessId: string
    top: number
    right: number
    openUpwards: boolean
  } | null>(null)
  const [, startTransition] = useTransition()

  // Estado del formulario de nuevo negocio
  const [newStoreData, setNewStoreData] = useState({
    name: '',
    username: '',
    phone: '',
    email: '',
    description: '',
    groupId: '',
    deliveryServiceType: 'fuddi' as 'fuddi' | 'self'
  })
  const [creatingStore, setCreatingStore] = useState(false)
  const [formError, setFormError] = useState('')

  // Toast feedback
  const [toast, setToast] = useState<{ show: boolean; message: string; type: 'success' | 'error' }>({
    show: false,
    message: '',
    type: 'success'
  })

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ show: true, message, type })
    setTimeout(() => {
      setToast(prev => ({ ...prev, show: false }))
    }, 3200)
  }

  // Carga ultra rápida: sólo negocios y grupos de cobertura
  const loadData = async (isInitial = false) => {
    if (isInitial) setLoading(true)
    else setRefreshing(true)

    try {
      if (!isInitial) {
        invalidateBusinessCache()
      }

      const [businessesData, groupsData] = await Promise.all([
        getAllBusinesses(),
        getCoverageGroups()
      ])

      const validBusinesses = businessesData
        .filter(b => b && b.id && b.name)
        .map(b => ({
          ...b,
          isOpen: isStoreOpen(b)
        }))
        .sort((a, b) => a.name.localeCompare(b.name))

      setBusinesses(validBusinesses)
      setCoverageGroups(groupsData || [])
    } catch (error) {
      console.error('Error al cargar negocios:', error)
      showToast('Error al conectar con la base de datos', 'error')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    const tabParam = searchParams?.get('tab') || searchParams?.get('view')
    if (tabParam === 'map') {
      setViewMode('map')
    } else {
      setViewMode('list')
    }
  }, [searchParams])

  const handleSwitchViewMode = (mode: 'list' | 'map') => {
    setViewMode(mode)
    if (mode === 'map') {
      router.replace('/admin?tab=map', { scroll: false })
    } else {
      router.replace('/admin', { scroll: false })
    }
  }

  useEffect(() => {
    loadData(true)

    // Recalcular estado abierto/cerrado cada 60s en base al horario local sin volver a consultar la BD
    const interval = setInterval(() => {
      setBusinesses(prev => prev.map(b => ({
        ...b,
        isOpen: isStoreOpen(b)
      })))
    }, 60000)

    return () => clearInterval(interval)
  }, [])

  // Cerrar popover al hacer scroll, redimensionar o presionar Escape
  useEffect(() => {
    if (!openPopover) return
    const handleClose = () => setOpenPopover(null)
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenPopover(null)
    }
    window.addEventListener('scroll', handleClose, true)
    window.addEventListener('resize', handleClose)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('scroll', handleClose, true)
      window.removeEventListener('resize', handleClose)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [openPopover])

  // Auto-generación de slug amigable al escribir el nombre
  const handleNameChange = (name: string) => {
    const generatedSlug = name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')

    setNewStoreData(prev => ({
      ...prev,
      name,
      username: prev.username === '' || prev.username === generatedSlug.slice(0, -1) ? generatedSlug : prev.username
    }))
  }

  // Toggle rápido de Mostrar / Ocultar tienda con actualización optimista
  const handleToggleStoreVisibility = async (business: Business) => {
    if (updatingBusinessId === business.id) return

    const nextHidden = !business.isHidden
    setUpdatingBusinessId(business.id)
    setOpenPopover(null)

    setBusinesses(prev => prev.map(b => (b.id === business.id ? { ...b, isHidden: nextHidden } : b)))

    try {
      await updateBusiness(business.id, {
        isHidden: nextHidden
      })
      showToast(
        nextHidden
          ? `🙈 "${business.name}" oculta del catálogo`
          : `👁️ "${business.name}" visible en el catálogo`,
        'success'
      )
    } catch (error) {
      console.error('Error al actualizar visibilidad:', error)
      setBusinesses(prev => prev.map(b => (b.id === business.id ? { ...b, isHidden: business.isHidden } : b)))
      showToast(`No se pudo cambiar la visibilidad de ${business.name}`, 'error')
    } finally {
      setUpdatingBusinessId(null)
    }
  }

  // Toggle rápido de Apertura / Cierre manual con actualización optimista
  const handleToggleStoreStatus = async (business: Business) => {
    if (updatingBusinessId === business.id) return

    const currentlyOpen = business.isOpen
    const nextManualStatus: 'open' | 'closed' = currentlyOpen ? 'closed' : 'open'

    // Actualización optimista inmediata en UI (0ms)
    setUpdatingBusinessId(business.id)
    setOpenPopover(null)
    setBusinesses(prev => prev.map(b => {
      if (b.id !== business.id) return b
      return {
        ...b,
        manualStoreStatus: nextManualStatus,
        isOpen: nextManualStatus === 'open'
      }
    }))

    try {
      await updateBusiness(business.id, {
        manualStoreStatus: nextManualStatus
      })
      showToast(
        nextManualStatus === 'open'
          ? `🟢 "${business.name}" abierta manualmente`
          : `⚪ "${business.name}" cerrada manualmente`,
        'success'
      )
    } catch (error) {
      console.error('Error al actualizar estado:', error)
      // Revertir optimismo en caso de fallo
      setBusinesses(prev => prev.map(b => {
        if (b.id !== business.id) return b
        return {
          ...b,
          manualStoreStatus: business.manualStoreStatus,
          isOpen: isStoreOpen(business)
        }
      }))
      showToast(`No se pudo cambiar el estado de ${business.name}`, 'error')
    } finally {
      setUpdatingBusinessId(null)
    }
  }

  // Restablecer al horario automático
  const handleResetToAutomaticSchedule = async (business: Business) => {
    if (updatingBusinessId === business.id) return

    setUpdatingBusinessId(business.id)
    setOpenPopover(null)
    try {
      await updateBusiness(business.id, {
        manualStoreStatus: null
      })

      setBusinesses(prev => prev.map(b => {
        if (b.id !== business.id) return b
        const updated = { ...b, manualStoreStatus: null }
        return {
          ...updated,
          isOpen: isStoreOpen(updated)
        }
      }))

      showToast(`"${business.name}" volvió al horario automático`, 'success')
    } catch (error) {
      console.error('Error al restablecer horario:', error)
      showToast('Error al restablecer horario automático', 'error')
    } finally {
      setUpdatingBusinessId(null)
    }
  }

  // Cambiar Zona / Grupo directamente desde la tabla
  const handleChangeBusinessGroup = async (business: Business, nextGroupId: string) => {
    if (updatingBusinessId === business.id) return
    const previousGroupId = business.groupId || 'external'
    if (previousGroupId === nextGroupId) return

    setUpdatingBusinessId(business.id)
    setBusinesses(prev => prev.map(b => (b.id === business.id ? { ...b, groupId: nextGroupId } : b)))

    try {
      await updateBusiness(business.id, {
        groupId: nextGroupId
      })
      const label = groupNameMap[nextGroupId] || 'Otras Ubicaciones'
      showToast(`📍 "${business.name}" asignada a ${label}`, 'success')
    } catch (error) {
      console.error('Error al actualizar zona:', error)
      setBusinesses(prev => prev.map(b => (b.id === business.id ? { ...b, groupId: previousGroupId } : b)))
      showToast(`No se pudo cambiar la zona de ${business.name}`, 'error')
    } finally {
      setUpdatingBusinessId(null)
    }
  }

  // Toggle rápido de Métodos de Pago (Efectivo / Transferencia) desde la tabla
  const handleTogglePaymentMethod = async (business: Business, method: 'cash' | 'transfer') => {
    if (updatingBusinessId === business.id) return

    const currentCash = business.paymentMethods?.cash ?? true
    const currentTransfer = business.paymentMethods?.transfer ?? true
    const nextPaymentMethods = {
      cash: method === 'cash' ? !currentCash : currentCash,
      transfer: method === 'transfer' ? !currentTransfer : currentTransfer
    }

    setUpdatingBusinessId(business.id)
    setBusinesses(prev =>
      prev.map(b => (b.id === business.id ? { ...b, paymentMethods: nextPaymentMethods } : b))
    )

    try {
      await updateBusiness(business.id, {
        paymentMethods: nextPaymentMethods
      })
      const methodLabel = method === 'cash' ? 'Efectivo' : 'Transferencia'
      const isEnabled = nextPaymentMethods[method]
      showToast(
        `${isEnabled ? '✅' : '⚪'} ${methodLabel} ${isEnabled ? 'activado' : 'desactivado'} en "${business.name}"`,
        'success'
      )
    } catch (error) {
      console.error('Error al actualizar métodos de pago:', error)
      setBusinesses(prev =>
        prev.map(b => (b.id === business.id ? { ...b, paymentMethods: business.paymentMethods } : b))
      )
      showToast(`No se pudo actualizar métodos de pago de ${business.name}`, 'error')
    } finally {
      setUpdatingBusinessId(null)
    }
  }

  // Crear nuevo negocio
  const handleCreateBusiness = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError('')

    if (!newStoreData.name.trim()) {
      setFormError('Ingresa el nombre del negocio')
      return
    }
    if (!newStoreData.phone.trim()) {
      setFormError('Ingresa el teléfono del negocio')
      return
    }
    if (!newStoreData.username.trim()) {
      setFormError('Ingresa el usuario / enlace de la tienda')
      return
    }

    const email = newStoreData.email.trim() || `${newStoreData.username}@fuddi.shop`

    setCreatingStore(true)
    try {
      const createdId = await createBusinessFromForm({
        name: newStoreData.name.trim(),
        username: newStoreData.username.trim(),
        phone: newStoreData.phone.trim(),
        email: email,
        description: newStoreData.description.trim() || 'Negocio registrado en Fuddi',
        category: 'Restaurante'
      })

      // Actualizar campos adicionales como groupId y tipo de delivery
      if (newStoreData.groupId || newStoreData.deliveryServiceType) {
        await updateBusiness(createdId, {
          groupId: newStoreData.groupId || 'external',
          deliveryServiceType: newStoreData.deliveryServiceType
        })
      }

      showToast(`¡Tienda "${newStoreData.name}" creada con éxito!`, 'success')
      setShowNewStoreModal(false)
      setNewStoreData({
        name: '',
        username: '',
        phone: '',
        email: '',
        description: '',
        groupId: '',
        deliveryServiceType: 'fuddi'
      })

      // Recargar negocios
      loadData()
    } catch (err: any) {
      console.error('Error al crear tienda:', err)
      setFormError(err.message || 'No se pudo crear la tienda. Verifica los datos.')
    } finally {
      setCreatingStore(false)
    }
  }

  // Guardar ubicación GPS o solo Grupo de Cobertura de una tienda desde el mapa de administración
  const handleSaveStoreLocation = async (
    business: Business,
    coords: StoreCoordinates | null,
    references: string,
    groupId?: string
  ) => {
    const nextGroupId = groupId || business.groupId || 'external'

    // Si se eligió solo el Grupo de Cobertura (sin referencias ni coordenadas)
    if (!coords) {
      try {
        await updateBusiness(business.id, {
          groupId: nextGroupId
        })

        setBusinesses(prev =>
          prev.map(b =>
            b.id === business.id
              ? {
                  ...b,
                  groupId: nextGroupId
                }
              : b
          )
        )

        const groupLabel = groupNameMap[nextGroupId] || 'Otras Ubicaciones'
        showToast(`🏷️ "${business.name}" asignada a ${groupLabel}`, 'success')
        return
      } catch (error) {
        console.error('Error al actualizar grupo de cobertura de la tienda:', error)
        showToast(`No se pudo guardar el grupo de ${business.name}`, 'error')
        throw error
      }
    }

    const latlongStr = `${coords.lat}, ${coords.lng}`
    const nextPickupSettings = {
      enabled: business.pickupSettings?.enabled ?? false,
      restrictToPrevious: business.pickupSettings?.restrictToPrevious ?? false,
      storePhotoUrl: business.pickupSettings?.storePhotoUrl || '',
      references: references || business.pickupSettings?.references || '',
      latlong: latlongStr
    }
    const nextMapLocation = {
      lat: coords.lat,
      lng: coords.lng
    }

    try {
      await updateBusiness(business.id, {
        pickupSettings: nextPickupSettings,
        mapLocation: nextMapLocation,
        groupId: nextGroupId
      })

      setBusinesses(prev =>
        prev.map(b =>
          b.id === business.id
            ? {
                ...b,
                pickupSettings: nextPickupSettings,
                mapLocation: nextMapLocation,
                groupId: nextGroupId
              }
            : b
        )
      )

      showToast(`📍 Ubicación de "${business.name}" guardada correctamente`, 'success')
    } catch (error) {
      console.error('Error al actualizar ubicación de la tienda:', error)
      showToast(`No se pudo guardar la ubicación de ${business.name}`, 'error')
      throw error
    }
  }

  // Estadísticas para las cards de resumen
  const stats = useMemo(() => {
    const total = businesses.length
    const visibleCount = businesses.filter(b => !b.isHidden).length
    const hiddenCount = total - visibleCount
    const openCount = businesses.filter(b => !b.isHidden && b.isOpen).length
    const closedCount = businesses.filter(b => !b.isHidden && !b.isOpen).length
    const fuddiDeliveryCount = businesses.filter(b => !b.isHidden && (b.deliveryServiceType ?? 'fuddi') === 'fuddi').length
    const withLocationCount = businesses.filter(b => !!extractBusinessCoords(b)).length
    const withoutLocationCount = total - withLocationCount
    return {
      total,
      visibleCount,
      hiddenCount,
      openCount,
      closedCount,
      fuddiDeliveryCount,
      withLocationCount,
      withoutLocationCount
    }
  }, [businesses])

  // Filtrado reactivo en 0ms
  const filteredBusinesses = useMemo(() => {
    const query = searchTerm.toLowerCase().trim()

    return businesses.filter(business => {
      const matchesSearch =
        !query ||
        business.name.toLowerCase().includes(query) ||
        (business.username && business.username.toLowerCase().includes(query)) ||
        (business.phone && business.phone.includes(query))

      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'visible' && !business.isHidden) ||
        (statusFilter === 'hidden' && !!business.isHidden) ||
        (statusFilter === 'open' && !business.isHidden && business.isOpen) ||
        (statusFilter === 'closed' && !business.isHidden && !business.isOpen)

      const matchesGroup =
        groupFilter === 'all' ||
        (business.groupId || 'external') === groupFilter

      return matchesSearch && matchesStatus && matchesGroup
    })
  }, [businesses, searchTerm, statusFilter, groupFilter])

  // Mapa de nombres de grupos
  const groupNameMap = useMemo(() => {
    const map: Record<string, string> = { external: 'Otras Ubicaciones' }
    coverageGroups.forEach(g => {
      if (g.id && g.name) map[g.id] = g.name
    })
    return map
  }, [coverageGroups])

  return (
    <div className="space-y-4 md:space-y-6 animate-fadeIn max-w-6xl mx-auto">
      {/* Toast Notification */}
      {toast.show && (
        <div className={`fixed top-4 right-4 z-[90] flex items-center gap-3 px-4 py-3 rounded-2xl shadow-xl border text-xs sm:text-sm font-bold transition-all duration-300 transform animate-in slide-in-from-top-2 ${
          toast.type === 'success'
            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
            : 'bg-rose-50 border-rose-200 text-rose-800'
        }`}>
          <i className={`bi ${toast.type === 'success' ? 'bi-check-circle-fill text-emerald-500' : 'bi-exclamation-triangle-fill text-rose-500'} text-base`}></i>
          {toast.message}
        </div>
      )}

      {/* Header Principal */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-black text-gray-900 tracking-tight leading-tight">
              Negocios
            </h1>
            <span className="bg-blue-50 text-blue-700 text-[11px] font-black px-2.5 py-0.5 rounded-full border border-blue-200/60">
              {businesses.length}
            </span>
          </div>
          <p className="text-xs sm:text-sm font-medium text-gray-500 mt-0.5 leading-relaxed">
            Administra apertura, estado en vivo y configuración directa de tus tiendas
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Selector de Vista: Tabla vs Mapa de Ubicaciones */}
          <div className="inline-flex bg-gray-200/75 p-1 rounded-2xl border border-gray-200/80">
            <button
              type="button"
              onClick={() => handleSwitchViewMode('list')}
              className={`px-3 py-1.5 rounded-xl text-xs font-black flex items-center gap-1.5 transition-all active:scale-95 ${
                viewMode === 'list'
                  ? 'bg-white text-gray-900 shadow-xs'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <i className="bi bi-table text-xs"></i>
              <span>Lista</span>
            </button>

            <button
              type="button"
              onClick={() => handleSwitchViewMode('map')}
              className={`px-3 py-1.5 rounded-xl text-xs font-black flex items-center gap-1.5 transition-all active:scale-95 ${
                viewMode === 'map'
                  ? 'bg-white text-blue-600 shadow-xs'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <i className="bi bi-geo-alt-fill text-xs"></i>
              <span>Mapa</span>
              {!loading && stats.withoutLocationCount > 0 && (
                <span
                  className="px-1.5 py-0.2 rounded-full text-[10px] font-black bg-amber-100 text-amber-800 border border-amber-200/80"
                  title={`${stats.withoutLocationCount} tiendas sin ubicación GPS`}
                >
                  {stats.withoutLocationCount} sin GPS
                </span>
              )}
            </button>
          </div>

          <button
            onClick={() => loadData(false)}
            disabled={refreshing || loading}
            className="w-10 h-10 sm:w-auto sm:px-3.5 sm:py-2.5 flex items-center justify-center gap-1.5 bg-white border border-gray-200/80 hover:border-gray-300 text-gray-700 rounded-2xl text-xs font-bold shadow-xs active:scale-95 transition-all disabled:opacity-50"
            title="Refrescar lista"
          >
            <i className={`bi bi-arrow-clockwise text-base ${refreshing ? 'animate-spin text-blue-600' : ''}`}></i>
            <span className="hidden sm:inline">Refrescar</span>
          </button>

          <button
            onClick={() => setShowNewStoreModal(true)}
            className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white rounded-2xl text-xs sm:text-sm font-bold shadow-md shadow-blue-600/20 active:scale-95 transition-all"
          >
            <i className="bi bi-plus-lg text-sm"></i>
            <span>Nuevo Negocio</span>
          </button>
        </div>
      </div>

      {/* Tarjetas de Métricas Rápidas (Grid 2x2 en celular, 4 cols en desktop) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
        {/* Total */}
        <div className="bg-white p-3.5 sm:p-4 rounded-3xl border border-gray-200/70 shadow-xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center text-lg shrink-0">
            <i className="bi bi-shop"></i>
          </div>
          <div className="min-w-0">
            <span className="text-[10px] sm:text-xs font-bold text-gray-400 uppercase tracking-wider block truncate">
              Total Tiendas
            </span>
            <span className="text-lg sm:text-2xl font-black text-gray-900 leading-tight">
              {loading ? '-' : stats.total}
            </span>
          </div>
        </div>

        {/* Abiertas Ahora */}
        <button
          onClick={() => setStatusFilter(prev => prev === 'open' ? 'all' : 'open')}
          className={`p-3.5 sm:p-4 rounded-3xl border text-left transition-all active:scale-95 flex items-center gap-3 ${
            statusFilter === 'open'
              ? 'bg-emerald-50/70 border-emerald-300 ring-2 ring-emerald-400/20'
              : 'bg-white border-gray-200/70 shadow-xs hover:border-emerald-200'
          }`}
        >
          <div className="w-10 h-10 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center text-lg shrink-0 relative">
            <i className="bi bi-door-open-fill"></i>
            <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-emerald-500 rounded-full animate-ping"></span>
            <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-emerald-500 rounded-full"></span>
          </div>
          <div className="min-w-0">
            <span className="text-[10px] sm:text-xs font-bold text-emerald-700 uppercase tracking-wider block truncate">
              Abiertas
            </span>
            <span className="text-lg sm:text-2xl font-black text-emerald-800 leading-tight">
              {loading ? '-' : stats.openCount}
            </span>
          </div>
        </button>

        {/* Cerradas */}
        <button
          onClick={() => setStatusFilter(prev => prev === 'closed' ? 'all' : 'closed')}
          className={`p-3.5 sm:p-4 rounded-3xl border text-left transition-all active:scale-95 flex items-center gap-3 ${
            statusFilter === 'closed'
              ? 'bg-slate-100 border-slate-300 ring-2 ring-slate-400/20'
              : 'bg-white border-gray-200/70 shadow-xs hover:border-gray-300'
          }`}
        >
          <div className="w-10 h-10 rounded-2xl bg-slate-100 text-slate-500 flex items-center justify-center text-lg shrink-0">
            <i className="bi bi-door-closed-fill"></i>
          </div>
          <div className="min-w-0">
            <span className="text-[10px] sm:text-xs font-bold text-gray-500 uppercase tracking-wider block truncate">
              Cerradas
            </span>
            <span className="text-lg sm:text-2xl font-black text-gray-700 leading-tight">
              {loading ? '-' : stats.closedCount}
            </span>
          </div>
        </button>

        {/* Delivery Fuddi */}
        <div className="bg-white p-3.5 sm:p-4 rounded-3xl border border-gray-200/70 shadow-xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center text-lg shrink-0">
            <i className="bi bi-scooter"></i>
          </div>
          <div className="min-w-0">
            <span className="text-[10px] sm:text-xs font-bold text-gray-400 uppercase tracking-wider block truncate">
              Delivery Fuddi
            </span>
            <span className="text-lg sm:text-2xl font-black text-indigo-900 leading-tight">
              {loading ? '-' : stats.fuddiDeliveryCount}
            </span>
          </div>
        </div>
      </div>

      {/* Buscador y Píldoras de Filtro (Diseño Móvil Cómodo) */}
      <div className="bg-white p-3 sm:p-4 rounded-3xl border border-gray-200/80 shadow-xs space-y-3">
        {/* Input de Búsqueda */}
        <div className="relative">
          <i className="bi bi-search absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm"></i>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar por nombre, @usuario o teléfono..."
            className="w-full bg-gray-50 border border-gray-200/60 rounded-2xl pl-10 pr-9 py-2.5 text-xs sm:text-sm font-medium text-gray-900 placeholder-gray-400 focus:outline-none focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 transition-all"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-gray-200 text-gray-600 flex items-center justify-center text-[10px]"
            >
              <i className="bi bi-x"></i>
            </button>
          )}
        </div>

        {/* Píldoras de Filtro Táctiles con Scroll Horizontal Suave */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none text-xs">
          <button
            onClick={() => setStatusFilter('all')}
            className={`px-3 py-1.5 rounded-xl font-bold whitespace-nowrap transition-all active:scale-95 ${
              statusFilter === 'all'
                ? 'bg-gray-900 text-white shadow-xs'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Todas ({businesses.length})
          </button>

          <button
            onClick={() => setStatusFilter('visible')}
            className={`px-3 py-1.5 rounded-xl font-bold whitespace-nowrap flex items-center gap-1.5 transition-all active:scale-95 ${
              statusFilter === 'visible'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-blue-50 text-blue-700 border border-blue-200/80 hover:bg-blue-100'
            }`}
          >
            <i className="bi bi-eye-fill text-[11px]"></i>
            Visibles ({stats.visibleCount})
          </button>

          <button
            onClick={() => setStatusFilter('hidden')}
            className={`px-3 py-1.5 rounded-xl font-bold whitespace-nowrap flex items-center gap-1.5 transition-all active:scale-95 ${
              statusFilter === 'hidden'
                ? 'bg-amber-600 text-white shadow-xs'
                : 'bg-amber-50 text-amber-700 border border-amber-200/80 hover:bg-amber-100'
            }`}
          >
            <i className="bi bi-eye-slash-fill text-[11px]"></i>
            Ocultas ({stats.hiddenCount})
          </button>

          <button
            onClick={() => setStatusFilter('open')}
            className={`px-3 py-1.5 rounded-xl font-bold whitespace-nowrap flex items-center gap-1.5 transition-all active:scale-95 ${
              statusFilter === 'open'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'bg-emerald-50 text-emerald-700 border border-emerald-200/80 hover:bg-emerald-100'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${statusFilter === 'open' ? 'bg-white' : 'bg-emerald-500'}`}></span>
            Abiertas ({stats.openCount})
          </button>

          <button
            onClick={() => setStatusFilter('closed')}
            className={`px-3 py-1.5 rounded-xl font-bold whitespace-nowrap flex items-center gap-1.5 transition-all active:scale-95 ${
              statusFilter === 'closed'
                ? 'bg-slate-700 text-white shadow-xs'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${statusFilter === 'closed' ? 'bg-white' : 'bg-gray-400'}`}></span>
            Cerradas ({stats.closedCount})
          </button>

          {/* Selector de Ciudad / Grupo */}
          {coverageGroups.length > 0 && (
            <div className="ml-auto flex items-center shrink-0">
              <select
                value={groupFilter}
                onChange={(e) => setGroupFilter(e.target.value)}
                className="bg-gray-100 border-none text-[11px] font-bold text-gray-700 rounded-xl px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="all">Todas las Zonas</option>
                {coverageGroups.map(g => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
                <option value="external">Otras Ubicaciones</option>
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Vista de Mapa o Lista de Negocios */}
      {loading ? (
        <div className="bg-white rounded-3xl border border-gray-200/80 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/70">
                  <th className="px-4 sm:px-5 py-3.5 text-[11px] font-bold uppercase tracking-wider text-gray-400">Negocio</th>
                  <th className="px-3.5 py-3.5 text-[11px] font-bold uppercase tracking-wider text-gray-400">Visibilidad</th>
                  <th className="px-3.5 py-3.5 text-[11px] font-bold uppercase tracking-wider text-gray-400">Estado</th>
                  <th className="px-3.5 py-3.5 text-[11px] font-bold uppercase tracking-wider text-gray-400">Métodos de Pago</th>
                  <th className="px-3.5 py-3.5 text-[11px] font-bold uppercase tracking-wider text-gray-400">Zona</th>
                  <th className="px-4 sm:px-5 py-3.5 text-[11px] font-bold uppercase tracking-wider text-gray-400 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {[1, 2, 3, 4, 5, 6].map(idx => (
                  <tr key={idx} className="animate-pulse">
                    <td className="px-4 sm:px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-gray-200 rounded-xl shrink-0"></div>
                        <div className="space-y-1.5">
                          <div className="w-32 h-3.5 bg-gray-200 rounded-md"></div>
                          <div className="w-24 h-2.5 bg-gray-100 rounded-md"></div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3.5 py-3.5"><div className="w-20 h-6 bg-gray-100 rounded-full"></div></td>
                    <td className="px-3.5 py-3.5"><div className="w-20 h-6 bg-gray-100 rounded-full"></div></td>
                    <td className="px-3.5 py-3.5"><div className="w-32 h-6 bg-gray-100 rounded-lg"></div></td>
                    <td className="px-3.5 py-3.5"><div className="w-28 h-7 bg-gray-100 rounded-xl"></div></td>
                    <td className="px-4 sm:px-5 py-3.5 text-right"><div className="w-8 h-8 bg-gray-100 rounded-xl ml-auto"></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : viewMode === 'map' ? (
        <AdminStoresMap
          businesses={filteredBusinesses}
          coverageGroups={coverageGroups}
          groupNameMap={groupNameMap}
          onSaveStoreLocation={handleSaveStoreLocation}
        />
      ) : filteredBusinesses.length === 0 ? (
        <div className="bg-white rounded-3xl p-8 border border-gray-200/80 text-center space-y-3 shadow-xs">
          <div className="w-14 h-14 rounded-2xl bg-gray-100 text-gray-400 flex items-center justify-center mx-auto text-2xl">
            <i className="bi bi-shop"></i>
          </div>
          <h3 className="text-base font-black text-gray-900 tracking-tight">No se encontraron negocios</h3>
          <p className="text-xs font-medium text-gray-500 max-w-sm mx-auto">
            {searchTerm || statusFilter !== 'all' || groupFilter !== 'all'
              ? 'Prueba ajustando los filtros o el término de búsqueda.'
              : 'Aún no tienes ningún negocio registrado en la plataforma.'}
          </p>
          {(searchTerm || statusFilter !== 'all' || groupFilter !== 'all') && (
            <button
              onClick={() => {
                setSearchTerm('')
                setStatusFilter('all')
                setGroupFilter('all')
              }}
              className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-bold transition-all"
            >
              Limpiar filtros
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-3xl border border-gray-200/80 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/70">
                  <th className="px-4 sm:px-5 py-3.5 text-[11px] font-bold uppercase tracking-wider text-gray-400">Negocio</th>
                  <th className="px-3.5 py-3.5 text-[11px] font-bold uppercase tracking-wider text-gray-400">Visibilidad</th>
                  <th className="px-3.5 py-3.5 text-[11px] font-bold uppercase tracking-wider text-gray-400">Estado</th>
                  <th className="px-3.5 py-3.5 text-[11px] font-bold uppercase tracking-wider text-gray-400">Métodos de Pago</th>
                  <th className="px-3.5 py-3.5 text-[11px] font-bold uppercase tracking-wider text-gray-400">Zona</th>
                  <th className="px-4 sm:px-5 py-3.5 text-[11px] font-bold uppercase tracking-wider text-gray-400 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredBusinesses.map(business => {
                  const isUpdating = updatingBusinessId === business.id
                  const hasManualOverride = business.manualStoreStatus === 'open' || business.manualStoreStatus === 'closed'
                  const phoneDigits = business.phone ? normalizeEcuadorianPhone(business.phone) : ''
                  const isPopoverOpen = openPopover?.businessId === business.id
                  const acceptsCash = business.paymentMethods?.cash ?? true
                  const acceptsTransfer = business.paymentMethods?.transfer ?? true

                  return (
                    <tr
                      key={business.id}
                      className={`hover:bg-gray-50/60 transition-colors group ${business.isHidden ? 'bg-gray-50/40' : ''}`}
                    >
                      {/* Negocio (Logo + Nombre + Enlace + WhatsApp) */}
                      <td className="px-4 sm:px-5 py-3">
                        <div className="flex items-center gap-3 min-w-[210px]">
                          <div className={`relative w-10 h-10 rounded-xl overflow-hidden bg-gray-100 border border-gray-200/70 shrink-0 aspect-square ${business.isHidden ? 'opacity-60' : ''}`}>
                            {business.image ? (
                              <img
                                src={business.image}
                                alt={business.name}
                                className="w-full h-full object-cover aspect-square"
                                loading="lazy"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-gray-400 text-base bg-gray-50">
                                <i className="bi bi-shop"></i>
                              </div>
                            )}
                            <span
                              className={`absolute bottom-0.5 right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white ${
                                business.isOpen ? 'bg-emerald-500' : 'bg-gray-400'
                              }`}
                              title={business.isOpen ? 'Abierta' : 'Cerrada'}
                            ></span>
                          </div>

                          <div className="min-w-0">
                            <Link
                              href={`/admin/stores/${business.id}`}
                              className={`text-sm font-black tracking-tight leading-tight hover:text-blue-600 transition-colors truncate block max-w-[200px] ${
                                business.isHidden ? 'text-gray-500' : 'text-gray-900'
                              }`}
                            >
                              {business.name}
                            </Link>
                            <div className="flex items-center gap-2 mt-0.5">
                              {business.username && (
                                <a
                                  href={`/${business.username}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[11px] font-bold text-blue-600 hover:underline inline-flex items-center gap-0.5 truncate max-w-[140px]"
                                  title="Abrir tienda pública"
                                >
                                  <span className="truncate">@{business.username}</span>
                                  <i className="bi bi-arrow-up-right text-[9px] shrink-0"></i>
                                </a>
                              )}
                              {business.phone && (
                                <a
                                  href={`https://wa.me/593${phoneDigits.startsWith('0') ? phoneDigits.slice(1) : phoneDigits}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 hover:underline shrink-0"
                                  title={`WhatsApp: ${business.phone}`}
                                >
                                  <i className="bi bi-whatsapp"></i>
                                  <span>{business.phone}</span>
                                </a>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Visibilidad (Toggle directo Visible / Oculta) */}
                      <td className="px-3.5 py-3 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleToggleStoreVisibility(business)}
                          disabled={isUpdating}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-black transition-all active:scale-95 shadow-2xs ${
                            business.isHidden
                              ? 'bg-amber-50 text-amber-700 border border-amber-200/80 hover:bg-amber-100'
                              : 'bg-blue-50 text-blue-700 border border-blue-200/80 hover:bg-blue-100'
                          }`}
                          title={business.isHidden ? 'Clic para mostrar tienda en el inicio' : 'Clic para ocultar tienda del inicio'}
                        >
                          <i className={`bi ${business.isHidden ? 'bi-eye-slash-fill' : 'bi-eye-fill'} text-[11px]`}></i>
                          <span>{business.isHidden ? 'Oculta' : 'Visible'}</span>
                        </button>
                      </td>

                      {/* Estado (Toggle Manual Abierto / Cerrado + Restablecer Horario) */}
                      <td className="px-3.5 py-3 whitespace-nowrap">
                        <div className="flex flex-col items-start gap-0.5">
                          <button
                            type="button"
                            onClick={() => handleToggleStoreStatus(business)}
                            disabled={isUpdating}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-black transition-all active:scale-95 shadow-2xs ${
                              business.isOpen
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/80 hover:bg-emerald-100'
                                : 'bg-slate-100 text-slate-700 border border-slate-200/80 hover:bg-slate-200'
                            }`}
                            title={business.isOpen ? 'Clic para cerrar manualmente' : 'Clic para abrir manualmente'}
                          >
                            {isUpdating ? (
                              <div className="animate-spin rounded-full h-3 w-3 border-2 border-current border-t-transparent"></div>
                            ) : (
                              <span className={`w-1.5 h-1.5 rounded-full ${business.isOpen ? 'bg-emerald-500 animate-pulse' : 'bg-gray-400'}`}></span>
                            )}
                            <span>{business.isOpen ? 'Abierto' : 'Cerrado'}</span>
                          </button>

                          {hasManualOverride && (
                            <button
                              type="button"
                              onClick={() => handleResetToAutomaticSchedule(business)}
                              className="text-[10px] text-gray-400 hover:text-blue-600 underline font-medium pl-1"
                              title="Restablecer al horario programado"
                            >
                              Manual • Usar horario
                            </button>
                          )}
                        </div>
                      </td>

                      {/* Métodos de Pago (Toggles directos de Efectivo y Transferencia) */}
                      <td className="px-3.5 py-3 whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleTogglePaymentMethod(business, 'cash')}
                            disabled={isUpdating}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-[11px] font-bold border transition-all active:scale-95 ${
                              acceptsCash
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200/80 hover:bg-emerald-100'
                                : 'bg-gray-50 text-gray-400 border-gray-200/60 hover:bg-gray-100 hover:text-gray-600'
                            }`}
                            title={acceptsCash ? 'Efectivo activado (clic para desactivar)' : 'Efectivo desactivado (clic para activar)'}
                          >
                            <i className="bi bi-cash-coin text-xs"></i>
                            <span>Efectivo</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleTogglePaymentMethod(business, 'transfer')}
                            disabled={isUpdating}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-[11px] font-bold border transition-all active:scale-95 ${
                              acceptsTransfer
                                ? 'bg-indigo-50 text-indigo-700 border-indigo-200/80 hover:bg-indigo-100'
                                : 'bg-gray-50 text-gray-400 border-gray-200/60 hover:bg-gray-100 hover:text-gray-600'
                            }`}
                            title={acceptsTransfer ? 'Transferencia activada (clic para desactivar)' : 'Transferencia desactivada (clic para activar)'}
                          >
                            <i className="bi bi-bank text-xs"></i>
                            <span>Transf.</span>
                          </button>
                        </div>
                      </td>

                      {/* Zona / Ciudad (Selector directo en la tabla) */}
                      <td className="px-3.5 py-3 whitespace-nowrap">
                        <select
                          value={business.groupId || 'external'}
                          disabled={isUpdating}
                          onChange={(e) => handleChangeBusinessGroup(business, e.target.value)}
                          className="bg-gray-100/90 hover:bg-gray-200/70 border border-gray-200/80 text-[11px] font-bold text-gray-700 rounded-xl px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors cursor-pointer disabled:opacity-50"
                          title="Cambiar zona a la que pertenece la tienda"
                        >
                          {coverageGroups.map(g => (
                            <option key={g.id} value={g.id}>{g.name}</option>
                          ))}
                          <option value="external">Otras Ubicaciones</option>
                        </select>
                      </td>

                      {/* Acciones (Popover de 3 puntos) */}
                      <td className="px-4 sm:px-5 py-3 whitespace-nowrap text-right">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            if (isPopoverOpen) {
                              setOpenPopover(null)
                              return
                            }
                            const rect = e.currentTarget.getBoundingClientRect()
                            const openUpwards = window.innerHeight - rect.bottom < 220
                            setOpenPopover({
                              businessId: business.id,
                              top: openUpwards ? rect.top - 6 : rect.bottom + 6,
                              right: Math.max(12, window.innerWidth - rect.right),
                              openUpwards
                            })
                          }}
                          className={`w-8 h-8 rounded-xl inline-flex items-center justify-center transition-all active:scale-95 ${
                            isPopoverOpen
                              ? 'bg-gray-900 text-white shadow-xs'
                              : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                          }`}
                          title="Acciones de la tienda"
                          aria-label="Acciones de la tienda"
                        >
                          <i className="bi bi-three-dots-vertical text-sm"></i>
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Popover Flotante de Acciones de Tienda */}
      {openPopover && (() => {
        const targetBusiness = businesses.find(b => b.id === openPopover.businessId)
        if (!targetBusiness) return null
        const isUpdating = updatingBusinessId === targetBusiness.id
        const hasManualOverride = targetBusiness.manualStoreStatus === 'open' || targetBusiness.manualStoreStatus === 'closed'

        return (
          <>
            <div
              className="fixed inset-0 z-[70]"
              onClick={() => setOpenPopover(null)}
            />
            <div
              style={{
                top: openPopover.openUpwards ? undefined : openPopover.top,
                bottom: openPopover.openUpwards ? window.innerHeight - openPopover.top : undefined,
                right: openPopover.right
              }}
              className="fixed z-[75] w-56 bg-white rounded-2xl shadow-xl border border-gray-200/90 py-1.5 animate-in fade-in zoom-in-95 duration-150"
            >
              <div className="px-3 py-1.5 border-b border-gray-100">
                <p className="text-[11px] font-black text-gray-900 truncate">{targetBusiness.name}</p>
                <p className="text-[10px] font-medium text-gray-400 truncate">
                  {targetBusiness.isHidden ? 'Tienda oculta' : 'Tienda en funcionamiento'}
                </p>
              </div>

              <div className="py-1">
                <Link
                  href={`/admin/stores/${targetBusiness.id}`}
                  onClick={() => setOpenPopover(null)}
                  className="w-full px-3 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50 hover:text-gray-900 flex items-center gap-2.5 transition-colors"
                >
                  <i className="bi bi-gear-fill text-gray-400 text-sm"></i>
                  <span>Gestionar tienda</span>
                </Link>

                <a
                  href={`/${targetBusiness.username || targetBusiness.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setOpenPopover(null)}
                  className="w-full px-3 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50 hover:text-gray-900 flex items-center gap-2.5 transition-colors"
                >
                  <i className="bi bi-box-arrow-up-right text-gray-400 text-sm"></i>
                  <span>Ver tienda pública</span>
                </a>
              </div>

              <div className="border-t border-gray-100 py-1">
                <button
                  type="button"
                  disabled={isUpdating}
                  onClick={() => handleToggleStoreVisibility(targetBusiness)}
                  className={`w-full px-3 py-2 text-xs font-bold flex items-center gap-2.5 transition-colors text-left ${
                    targetBusiness.isHidden
                      ? 'text-emerald-700 hover:bg-emerald-50/70'
                      : 'text-amber-700 hover:bg-amber-50/70'
                  }`}
                >
                  <i className={`bi ${targetBusiness.isHidden ? 'bi-eye-fill text-emerald-600' : 'bi-eye-slash-fill text-amber-600'} text-sm`}></i>
                  <span>{targetBusiness.isHidden ? 'Mostrar tienda' : 'Ocultar tienda'}</span>
                </button>

                <button
                  type="button"
                  disabled={isUpdating}
                  onClick={() => handleToggleStoreStatus(targetBusiness)}
                  className="w-full px-3 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50 hover:text-gray-900 flex items-center gap-2.5 transition-colors text-left"
                >
                  <i className={`bi ${targetBusiness.isOpen ? 'bi-door-closed-fill text-slate-500' : 'bi-door-open-fill text-emerald-600'} text-sm`}></i>
                  <span>{targetBusiness.isOpen ? 'Cerrar manualmente' : 'Abrir manualmente'}</span>
                </button>

                {hasManualOverride && (
                  <button
                    type="button"
                    disabled={isUpdating}
                    onClick={() => handleResetToAutomaticSchedule(targetBusiness)}
                    className="w-full px-3 py-2 text-xs font-bold text-blue-600 hover:bg-blue-50/60 flex items-center gap-2.5 transition-colors text-left"
                  >
                    <i className="bi bi-clock-history text-blue-500 text-sm"></i>
                    <span>Usar horario automático</span>
                  </button>
                )}
              </div>
            </div>
          </>
        )
      })()}

      {/* Modal / Bottom Sheet para Nuevo Negocio */}
      {showNewStoreModal && (
        <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200"
            onClick={() => !creatingStore && setShowNewStoreModal(false)}
          ></div>

          <div className="relative bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl p-5 sm:p-6 shadow-2xl max-h-[90vh] overflow-y-auto z-10 animate-in slide-in-from-bottom duration-300">
            <div className="w-12 h-1.5 bg-gray-300 rounded-full mx-auto mb-4 sm:hidden"></div>

            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-black text-gray-900 tracking-tight">Crear Nuevo Negocio</h3>
                <p className="text-xs text-gray-500 font-medium">Registra una tienda en pocos segundos</p>
              </div>
              <button
                type="button"
                onClick={() => setShowNewStoreModal(false)}
                disabled={creatingStore}
                className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 hover:text-gray-900"
              >
                <i className="bi bi-x-lg text-xs"></i>
              </button>
            </div>

            {formError && (
              <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs font-bold rounded-2xl mb-4 flex items-center gap-2">
                <i className="bi bi-exclamation-circle-fill"></i>
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleCreateBusiness} className="space-y-3.5">
              <div>
                <label className="block text-[11px] font-bold text-gray-700 uppercase tracking-wider mb-1">
                  Nombre del Negocio *
                </label>
                <input
                  type="text"
                  required
                  value={newStoreData.name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="Ej: Burger House Express"
                  className="w-full bg-gray-50 border border-gray-200 rounded-2xl px-3.5 py-2.5 text-xs sm:text-sm font-medium text-gray-900 focus:bg-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-gray-700 uppercase tracking-wider mb-1">
                  Usuario / Enlace URL (@slug) *
                </label>
                <div className="flex items-center bg-gray-50 border border-gray-200 rounded-2xl px-3.5 py-2.5">
                  <span className="text-xs font-bold text-gray-400 select-none mr-1">fuddi.shop/</span>
                  <input
                    type="text"
                    required
                    value={newStoreData.username}
                    onChange={(e) => setNewStoreData(prev => ({ ...prev, username: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))}
                    placeholder="burger-house"
                    className="w-full bg-transparent text-xs sm:text-sm font-bold text-blue-600 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-gray-700 uppercase tracking-wider mb-1">
                    Teléfono Celular *
                  </label>
                  <input
                    type="tel"
                    required
                    value={newStoreData.phone}
                    onChange={(e) => setNewStoreData(prev => ({ ...prev, phone: e.target.value }))}
                    placeholder="0987654321"
                    className="w-full bg-gray-50 border border-gray-200 rounded-2xl px-3.5 py-2.5 text-xs sm:text-sm font-medium text-gray-900 focus:bg-white focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-gray-700 uppercase tracking-wider mb-1">
                    Email de Contacto
                  </label>
                  <input
                    type="email"
                    value={newStoreData.email}
                    onChange={(e) => setNewStoreData(prev => ({ ...prev, email: e.target.value }))}
                    placeholder="opcional@negocio.com"
                    className="w-full bg-gray-50 border border-gray-200 rounded-2xl px-3.5 py-2.5 text-xs sm:text-sm font-medium text-gray-900 focus:bg-white focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-gray-700 uppercase tracking-wider mb-1">
                    Grupo de Cobertura / Ciudad
                  </label>
                  <select
                    value={newStoreData.groupId}
                    onChange={(e) => setNewStoreData(prev => ({ ...prev, groupId: e.target.value }))}
                    className="w-full bg-gray-50 border border-gray-200 rounded-2xl px-3 py-2.5 text-xs sm:text-sm font-medium text-gray-900 focus:bg-white focus:outline-none focus:border-blue-500"
                  >
                    <option value="">Seleccionar ciudad/grupo</option>
                    {coverageGroups.map(g => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                    <option value="external">Otras Ubicaciones</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-gray-700 uppercase tracking-wider mb-1">
                    Tipo de Entrega
                  </label>
                  <select
                    value={newStoreData.deliveryServiceType}
                    onChange={(e) => setNewStoreData(prev => ({ ...prev, deliveryServiceType: e.target.value as any }))}
                    className="w-full bg-gray-50 border border-gray-200 rounded-2xl px-3 py-2.5 text-xs sm:text-sm font-medium text-gray-900 focus:bg-white focus:outline-none focus:border-blue-500"
                  >
                    <option value="fuddi">Delivery Fuddi (Red de Repartidores)</option>
                    <option value="self">Autogestión (Tienda entrega por su cuenta)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-gray-700 uppercase tracking-wider mb-1">
                  Descripción Breve
                </label>
                <textarea
                  rows={2}
                  value={newStoreData.description}
                  onChange={(e) => setNewStoreData(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Especialistas en hamburguesas artesanales..."
                  className="w-full bg-gray-50 border border-gray-200 rounded-2xl px-3.5 py-2 text-xs sm:text-sm font-medium text-gray-900 focus:bg-white focus:outline-none focus:border-blue-500"
                ></textarea>
              </div>

              <div className="pt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowNewStoreModal(false)}
                  disabled={creatingStore}
                  className="flex-1 py-3 rounded-2xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold transition-all active:scale-95"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={creatingStore}
                  className="flex-1 py-3 rounded-2xl bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white text-xs font-bold shadow-md shadow-blue-600/30 transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {creatingStore ? (
                    <>
                      <div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-white border-t-transparent"></div>
                      <span>Creando...</span>
                    </>
                  ) : (
                    <span>Guardar Tienda</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
