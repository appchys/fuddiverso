'use client'

import { useState, useEffect, use } from 'react'
import { useRouter } from 'next/navigation'
import { Business, Product, Delivery } from '@/types'
import {
  getBusiness,
  updateBusiness,
  getProductsByBusiness,
  uploadImage,
  getAllDeliveries,
} from '@/lib/database'
import { isStoreOpen } from '@/lib/store-utils'
import dynamic from 'next/dynamic'

const ProductList = dynamic(() => import('@/components/ProductList'), { ssr: false })
const NotificationSettings = dynamic(() => import('@/components/NotificationSettings'), { ssr: false })

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

type Tab = 'info' | 'schedule' | 'products' | 'delivery' | 'notifications' | 'danger'

export default function AdminStorePage({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = use(params)
  const router = useRouter()

  const [business, setBusiness] = useState<Business | null>(null)
  const [edited, setEdited] = useState<Business | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [tab, setTab] = useState<Tab>('info')
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [uploadingCover, setUploadingCover] = useState(false)
  const [uploadingProfile, setUploadingProfile] = useState(false)
  const [deliveries, setDeliveries] = useState<Delivery[]>([])
  const [loadingDeliveries, setLoadingDeliveries] = useState(false)
  const [savingDelivery, setSavingDelivery] = useState(false)
  const [deliverySaved, setDeliverySaved] = useState(false)

  useEffect(() => {
    loadBusiness()
  }, [businessId])

  const loadBusiness = async () => {
    try {
      setLoading(true)
      const data = await getBusiness(businessId)
      if (!data) { router.push('/admin'); return }
      const withOpen = { ...data, isOpen: isStoreOpen(data) }
      setBusiness(withOpen)
      setEdited(withOpen)
      setCategories(data.categories || [])
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

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
      })
      setBusiness(prev => prev ? { ...prev, deliveryServiceType: edited.deliveryServiceType, defaultDeliveryId: edited.defaultDeliveryId } : null)
      setDeliverySaved(true)
      setTimeout(() => setDeliverySaved(false), 2500)
    } catch { alert('Error al guardar configuración de delivery') }
    finally { setSavingDelivery(false) }
  }

  const handleSave = async () => {
    if (!edited) return
    setSaving(true)
    try {
      await updateBusiness(businessId, { ...edited, updatedAt: new Date() })
      setBusiness(edited)
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
      const url = await uploadImage(file, `businesses/covers/${businessId}_${Date.now()}`)
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
      const url = await uploadImage(file, `businesses/profiles/${businessId}_${Date.now()}`)
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

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
    </div>
  )

  if (!business || !edited) return (
    <div className="text-center py-20 text-gray-500">Tienda no encontrada.</div>
  )

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'info', label: 'Información', icon: 'bi-info-circle' },
    { id: 'schedule', label: 'Horarios', icon: 'bi-clock' },
    { id: 'products', label: 'Productos', icon: 'bi-box-seam' },
    { id: 'delivery', label: 'Delivery', icon: 'bi-scooter' },
    { id: 'notifications', label: 'Notificaciones', icon: 'bi-bell' },
    { id: 'danger', label: 'Configuración', icon: 'bi-gear' },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => router.push('/admin')}
          className="w-9 h-9 flex items-center justify-center bg-white border border-gray-200 rounded-xl text-gray-500 hover:text-gray-800 hover:border-gray-300 transition-all shadow-sm"
        >
          <i className="bi bi-arrow-left" />
        </button>
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="w-12 h-12 rounded-xl overflow-hidden bg-gray-100 flex-shrink-0 border border-gray-200">
            {business.image
              ? <img src={business.image} alt={business.name} className="w-full h-full object-cover" />
              : <div className="w-full h-full flex items-center justify-center"><i className="bi bi-shop text-gray-400 text-xl" /></div>}
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-black text-gray-900 truncate">{business.name}</h1>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${business.isOpen ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${business.isOpen ? 'bg-green-500' : 'bg-gray-400'}`} />
                {business.isOpen ? 'Abierto' : 'Cerrado'}
              </span>
              {!business.isActive && <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700">Inactivo</span>}
              {business.isHidden && <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700"><i className="bi bi-eye-slash" /> Oculto</span>}
            </div>
          </div>
        </div>
        <a
          href={`/business/${business.username || business.id}/dashboard`}
          target="_blank"
          className="hidden md:flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-all shadow-sm"
        >
          <i className="bi bi-box-arrow-up-right" />
          Dashboard
        </a>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl border border-gray-200 overflow-x-auto scrollbar-hide">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-shrink-0 flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg transition-all ${tab === t.id ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <i className={`bi ${t.icon}`} />
            <span className="hidden sm:inline">{t.label}</span>
          </button>
        ))}
      </div>

      {/* ── TAB: INFO ── */}
      {tab === 'info' && (
        <div className="space-y-6">
          {/* Cover & Logo */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="relative h-40 bg-gray-100 group">
              {business.coverImage
                ? <img src={business.coverImage} className="w-full h-full object-cover" alt="Portada" />
                : <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-100 to-gray-200"><i className="bi bi-image text-gray-300 text-4xl" /></div>}
              <label className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 cursor-pointer transition-opacity">
                {uploadingCover
                  ? <div className="animate-spin rounded-full h-8 w-8 border-2 border-white border-t-transparent" />
                  : <span className="text-white text-sm font-semibold flex items-center gap-2"><i className="bi bi-camera" />Cambiar portada</span>}
                <input type="file" accept="image/*" className="hidden" onChange={handleCoverUpload} />
              </label>
            </div>
            <div className="px-6 pb-6 -mt-10 relative">
              <label className="w-20 h-20 rounded-2xl bg-white border-4 border-white shadow-lg overflow-hidden block cursor-pointer group/logo relative">
                {business.image
                  ? <img src={business.image} className="w-full h-full object-cover" alt="Logo" />
                  : <div className="w-full h-full flex items-center justify-center bg-gray-100"><i className="bi bi-shop text-gray-400 text-2xl" /></div>}
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover/logo:opacity-100 transition-opacity">
                  {uploadingProfile
                    ? <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent" />
                    : <i className="bi bi-camera text-white" />}
                </div>
                <input type="file" accept="image/*" className="hidden" onChange={handleProfileUpload} />
              </label>
            </div>
          </div>

          {/* Fields */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-4">
            <h3 className="font-bold text-gray-900 text-sm uppercase tracking-wider">Información General</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {([
                { label: 'Nombre', field: 'name' as keyof Business, type: 'text' },
                { label: 'Username (URL)', field: 'username' as keyof Business, type: 'text' },
                { label: 'Email', field: 'email' as keyof Business, type: 'email' },
                { label: 'Teléfono / WhatsApp', field: 'phone' as keyof Business, type: 'text' },
                { label: 'Categoría', field: 'category' as keyof Business, type: 'text' },
                { label: 'Tiempo de entrega (min)', field: 'deliveryTime' as keyof Business, type: 'number' },
              ]).map(({ label, field, type }) => (
                <div key={field as string}>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">{label}</label>
                  <input
                    type={type}
                    value={(edited[field] as any) ?? ''}
                    onChange={e => handleField(field, type === 'number' ? Number(e.target.value) : e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              ))}
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Descripción</label>
              <textarea
                value={(edited.description as any) ?? ''}
                onChange={e => handleField('description', e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Dirección</label>
              <input
                type="text"
                value={(edited.address as any) ?? ''}
                onChange={e => handleField('address', e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {/* Commission */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-gray-100">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Comisión Fuddi (%)</label>
                <input
                  type="number"
                  min={0} max={100} step={0.5}
                  value={edited.commissionRate ?? 10}
                  onChange={e => handleField('commissionRate', Number(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Tipo de Comisión</label>
                <select
                  value={edited.defaultCommissionType ?? 'fuddi_assumed_by_customer'}
                  onChange={e => handleField('defaultCommissionType', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                >
                  <option value="fuddi_assumed_by_customer">Asumida por cliente</option>
                  <option value="fuddi_assumed_by_store">Asumida por tienda</option>
                  <option value="no_commission">Sin comisión</option>
                </select>
              </div>
            </div>
          </div>

          {/* Save */}
          <div className="flex justify-end">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-xl text-sm font-bold transition-all shadow-sm"
            >
              {saving
                ? <><div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />Guardando...</>
                : saved
                  ? <><i className="bi bi-check2" />¡Guardado!</>
                  : <><i className="bi bi-floppy" />Guardar cambios</>}
            </button>
          </div>
        </div>
      )}

      {/* ── TAB: SCHEDULE ── */}
      {tab === 'schedule' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-4">
            <h3 className="font-bold text-gray-900 text-sm uppercase tracking-wider">Horarios de Atención</h3>
            <div className="space-y-3">
              {DAY_ORDER.map(day => {
                const daySchedule = edited.schedule?.[day] || { open: '09:00', close: '18:00', isOpen: true }
                return (
                  <div key={day} className={`flex items-center gap-4 p-4 rounded-xl border transition-all ${daySchedule.isOpen ? 'border-blue-100 bg-blue-50/40' : 'border-gray-100 bg-gray-50/50'}`}>
                    <button
                      onClick={() => handleScheduleField(day, 'isOpen', !daySchedule.isOpen)}
                      className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${daySchedule.isOpen ? 'bg-blue-600' : 'bg-gray-300'}`}
                    >
                      <span className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${daySchedule.isOpen ? 'translate-x-5' : ''}`} />
                    </button>
                    <span className={`w-24 text-sm font-bold ${daySchedule.isOpen ? 'text-gray-900' : 'text-gray-400'}`}>{DAYS_ES[day]}</span>
                    <div className={`flex items-center gap-2 flex-1 ${!daySchedule.isOpen ? 'opacity-40 pointer-events-none' : ''}`}>
                      <input
                        type="time"
                        value={daySchedule.open}
                        onChange={e => handleScheduleField(day, 'open', e.target.value)}
                        className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <span className="text-gray-400 text-sm">→</span>
                      <input
                        type="time"
                        value={daySchedule.close}
                        onChange={e => handleScheduleField(day, 'close', e.target.value)}
                        className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    {!daySchedule.isOpen && <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Cerrado</span>}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Manual status */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-4">
            <h3 className="font-bold text-gray-900 text-sm uppercase tracking-wider">Estado Manual</h3>
            <p className="text-xs text-gray-500">Override temporal del horario automático.</p>
            <div className="grid grid-cols-3 gap-3">
              {[
                { val: null, label: 'Automático', color: 'gray' },
                { val: 'open', label: 'Forzar Abierto', color: 'green' },
                { val: 'closed', label: 'Forzar Cerrado', color: 'red' },
              ].map(({ val, label, color }) => {
                const current = edited.manualStoreStatus ?? null
                const active = current === val
                const colorMap: Record<string, string> = {
                  gray: active ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400',
                  green: active ? 'bg-green-600 text-white border-green-600' : 'bg-white text-green-700 border-green-200 hover:border-green-400',
                  red: active ? 'bg-red-600 text-white border-red-600' : 'bg-white text-red-700 border-red-200 hover:border-red-400',
                }
                return (
                  <button
                    key={label}
                    onClick={() => handleField('manualStoreStatus', val)}
                    className={`py-2.5 px-3 rounded-xl border text-xs font-bold transition-all ${colorMap[color]}`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex justify-end">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-xl text-sm font-bold transition-all shadow-sm"
            >
              {saving ? <><div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />Guardando...</> : saved ? <><i className="bi bi-check2" />¡Guardado!</> : <><i className="bi bi-floppy" />Guardar horarios</>}
            </button>
          </div>
        </div>
      )}

      {/* ── TAB: PRODUCTS ── */}
      {tab === 'products' && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
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
        <div className="space-y-5">
          {/* Service type selector */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-5">
            <div>
              <h3 className="font-bold text-gray-900 text-sm uppercase tracking-wider mb-1">Tipo de Servicio de Delivery</h3>
              <p className="text-xs text-gray-500">Define cómo se gestionan las entregas de esta tienda.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Self-managed */}
              <button
                onClick={() => handleField('deliveryServiceType', 'self')}
                className={`relative flex flex-col gap-3 p-5 rounded-2xl border-2 text-left transition-all ${
                  (edited.deliveryServiceType ?? 'fuddi') === 'self'
                    ? 'border-orange-500 bg-orange-50'
                    : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
              >
                {(edited.deliveryServiceType ?? 'fuddi') === 'self' && (
                  <span className="absolute top-3 right-3 w-5 h-5 rounded-full bg-orange-500 flex items-center justify-center">
                    <i className="bi bi-check text-white text-xs" />
                  </span>
                )}
                <div className="w-12 h-12 rounded-xl bg-orange-100 flex items-center justify-center">
                  <i className="bi bi-person-badge text-orange-600 text-2xl" />
                </div>
                <div>
                  <p className="font-bold text-gray-900 text-sm">Autogestión</p>
                  <p className="text-xs text-gray-500 mt-1">La tienda gestiona sus propias entregas con su repartidor asignado. Fuddi no interviene en la búsqueda.</p>
                </div>
              </button>

              {/* Fuddi delivery */}
              <button
                onClick={() => handleField('deliveryServiceType', 'fuddi')}
                className={`relative flex flex-col gap-3 p-5 rounded-2xl border-2 text-left transition-all ${
                  (edited.deliveryServiceType ?? 'fuddi') === 'fuddi'
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
              >
                {(edited.deliveryServiceType ?? 'fuddi') === 'fuddi' && (
                  <span className="absolute top-3 right-3 w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center">
                    <i className="bi bi-check text-white text-xs" />
                  </span>
                )}
                <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center">
                  <i className="bi bi-scooter text-blue-600 text-2xl" />
                </div>
                <div>
                  <p className="font-bold text-gray-900 text-sm">Delivery Fuddi</p>
                  <p className="text-xs text-gray-500 mt-1">Fuddi asigna automáticamente un repartidor de la red según zona y disponibilidad.</p>
                </div>
              </button>
            </div>

            {/* Info banner */}
            <div className={`flex items-start gap-3 p-4 rounded-xl text-sm ${
              (edited.deliveryServiceType ?? 'fuddi') === 'self'
                ? 'bg-orange-50 border border-orange-100 text-orange-800'
                : 'bg-blue-50 border border-blue-100 text-blue-800'
            }`}>
              <i className={`bi bi-info-circle-fill mt-0.5 flex-shrink-0 ${
                (edited.deliveryServiceType ?? 'fuddi') === 'self' ? 'text-orange-500' : 'text-blue-500'
              }`} />
              <p className="text-xs leading-relaxed">
                {(edited.deliveryServiceType ?? 'fuddi') === 'self'
                  ? 'En modo Autogestión, los pedidos se asignarán al repartidor predeterminado configurado abajo. Si no hay uno definido, la tienda deberá asignar manualmente cada pedido.'
                  : 'En modo Fuddi, el sistema buscará automáticamente un repartidor disponible según la zona del cliente y la configuración de zonas de cobertura.'}
              </p>
            </div>
          </div>

          {/* Default delivery picker */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-4">
            <div>
              <h3 className="font-bold text-gray-900 text-sm uppercase tracking-wider mb-1">Repartidor Predeterminado</h3>
              <p className="text-xs text-gray-500">
                {(edited.deliveryServiceType ?? 'fuddi') === 'self'
                  ? 'Todos los pedidos se asignarán a este repartidor automáticamente.'
                  : 'Opcional. Si se configura, tiene prioridad sobre la asignación automática por zonas.'}
              </p>
            </div>

            {loadingDeliveries ? (
              <div className="flex items-center gap-3 py-4 text-gray-400">
                <div className="animate-spin rounded-full h-5 w-5 border-2 border-gray-300 border-t-blue-600" />
                <span className="text-sm">Cargando repartidores...</span>
              </div>
            ) : deliveries.length === 0 ? (
              <div className="py-6 text-center">
                <i className="bi bi-person-x text-3xl text-gray-300 block mb-2" />
                <p className="text-sm text-gray-400">No hay repartidores activos registrados.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {/* No default option */}
                <button
                  onClick={() => handleField('defaultDeliveryId', undefined)}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${
                    !edited.defaultDeliveryId
                      ? 'border-gray-400 bg-gray-50'
                      : 'border-gray-100 hover:border-gray-200'
                  }`}
                >
                  <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
                    <i className="bi bi-slash-circle text-gray-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-700">Sin predeterminado</p>
                    <p className="text-xs text-gray-400">Se usará la asignación automática por zonas</p>
                  </div>
                  {!edited.defaultDeliveryId && (
                    <span className="w-5 h-5 rounded-full bg-gray-600 flex items-center justify-center flex-shrink-0">
                      <i className="bi bi-check text-white text-xs" />
                    </span>
                  )}
                </button>

                {/* Deliveries list */}
                {deliveries.map(d => (
                  <button
                    key={d.id}
                    onClick={() => handleField('defaultDeliveryId', d.id)}
                    className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${
                      edited.defaultDeliveryId === d.id
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-100 hover:border-gray-200'
                    }`}
                  >
                    <div className="w-9 h-9 rounded-full overflow-hidden bg-gray-100 flex-shrink-0">
                      {d.fotoUrl
                        ? <img src={d.fotoUrl} alt={d.nombres} className="w-full h-full object-cover" />
                        : <div className="w-full h-full flex items-center justify-center"><i className="bi bi-person text-gray-400" /></div>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-gray-900 truncate">{d.nombres}</p>
                      <p className="text-xs text-gray-400">{d.celular}</p>
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      d.estado === 'activo' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {d.estado === 'activo' ? 'Activo' : 'Inactivo'}
                    </span>
                    {edited.defaultDeliveryId === d.id && (
                      <span className="w-5 h-5 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0">
                        <i className="bi bi-check text-white text-xs" />
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Save */}
          <div className="flex justify-end">
            <button
              onClick={handleSaveDelivery}
              disabled={savingDelivery}
              className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-xl text-sm font-bold transition-all shadow-sm"
            >
              {savingDelivery
                ? <><div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />Guardando...</>
                : deliverySaved
                  ? <><i className="bi bi-check2" />¡Guardado!</>
                  : <><i className="bi bi-floppy" />Guardar configuración</>}
            </button>
          </div>
        </div>
      )}

      {/* ── TAB: NOTIFICATIONS ── */}
      {tab === 'notifications' && (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
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
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
            <h3 className="font-bold text-gray-900 mb-1">Visibilidad de la Tienda</h3>
            <p className="text-sm text-gray-500 mb-4">Controla si la tienda aparece en el catálogo público.</p>
            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl">
              <div>
                <p className="font-semibold text-gray-900 text-sm">Tienda oculta</p>
                <p className="text-xs text-gray-500 mt-0.5">{business.isHidden ? 'Los clientes no pueden ver esta tienda' : 'La tienda es visible en el catálogo'}</p>
              </div>
              <button
                onClick={handleToggleHidden}
                className={`relative w-12 h-6 rounded-full transition-colors ${business.isHidden ? 'bg-yellow-500' : 'bg-gray-300'}`}
              >
                <span className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${business.isHidden ? 'translate-x-6' : ''}`} />
              </button>
            </div>
          </div>

          {/* Active status */}
          <div className={`bg-white rounded-2xl border shadow-sm p-6 ${business.isActive ? 'border-gray-200' : 'border-red-200'}`}>
            <h3 className="font-bold text-gray-900 mb-1">Estado de Activación</h3>
            <p className="text-sm text-gray-500 mb-4">Desactivar impide el acceso al dashboard de la tienda y detiene las notificaciones.</p>
            <div className="flex items-center justify-between p-4 rounded-xl bg-gray-50">
              <div>
                <p className="font-semibold text-sm text-gray-900">{business.isActive ? 'Tienda activa' : 'Tienda inactiva'}</p>
                <p className="text-xs text-gray-500 mt-0.5">{business.isActive ? 'El negocio puede operar normalmente' : 'El negocio está desactivado'}</p>
              </div>
              <button
                onClick={handleToggleActive}
                className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${business.isActive ? 'bg-red-100 text-red-700 hover:bg-red-200' : 'bg-green-100 text-green-700 hover:bg-green-200'}`}
              >
                {business.isActive ? 'Desactivar' : 'Activar'}
              </button>
            </div>
          </div>

          {/* Dashboard link */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
            <h3 className="font-bold text-gray-900 mb-1">Accesos Rápidos</h3>
            <div className="flex flex-wrap gap-3 mt-4">
              <a
                href={`/business/${business.username || business.id}/dashboard`}
                target="_blank"
                className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-700 rounded-xl text-sm font-semibold hover:bg-blue-100 transition-all"
              >
                <i className="bi bi-speedometer2" /> Ver Dashboard
              </a>
              <a
                href={`/${business.username || business.id}`}
                target="_blank"
                className="flex items-center gap-2 px-4 py-2 bg-gray-50 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-100 transition-all"
              >
                <i className="bi bi-shop" /> Ver Tienda Pública
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
