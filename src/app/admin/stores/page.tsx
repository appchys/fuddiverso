'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { getAllBusinesses, getAllDeliveries, updateBusiness } from '@/lib/database'
import { Business, Delivery } from '@/types'

export default function AdminStoresDeliveryPage() {
  const [businesses, setBusinesses] = useState<Business[]>([])
  const [deliveries, setDeliveries] = useState<Delivery[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [filterType, setFilterType] = useState<'all' | 'fuddi' | 'self'>('all')
  const [updatingStoreId, setUpdatingStoreId] = useState<string | null>(null)
  const [toast, setToast] = useState<{ show: boolean; message: string; type: 'success' | 'error' }>({
    show: false,
    message: '',
    type: 'success'
  })

  // Cargar datos
  const loadData = async () => {
    setLoading(true)
    try {
      const [fetchedBusinesses, fetchedDeliveries] = await Promise.all([
        getAllBusinesses(),
        getAllDeliveries()
      ])
      
      // Ordenar negocios alfabéticamente
      const sortedBusinesses = [...fetchedBusinesses].sort((a, b) => 
        a.name.localeCompare(b.name)
      )
      
      setBusinesses(sortedBusinesses)
      
      // Filtrar solo deliveries activos para el selector
      const activeDeliveries = fetchedDeliveries.filter(d => d.estado === 'activo')
      setDeliveries(activeDeliveries)
    } catch (error) {
      console.error('Error al cargar datos:', error)
      showToast('Error al cargar la información. Intenta de nuevo.', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ show: true, message, type })
    setTimeout(() => {
      setToast(prev => ({ ...prev, show: false }))
    }, 3000)
  }

  // Modificar tipo de servicio de delivery
  const handleUpdateServiceType = async (businessId: string, type: 'fuddi' | 'self') => {
    setUpdatingStoreId(businessId)
    try {
      await updateBusiness(businessId, { deliveryServiceType: type })
      
      // Actualizar estado local
      setBusinesses(prev => prev.map(b => 
        b.id === businessId ? { ...b, deliveryServiceType: type } : b
      ))
      
      showToast('Tipo de servicio actualizado correctamente', 'success')
    } catch (error) {
      console.error('Error al actualizar tipo de servicio:', error)
      showToast('No se pudo actualizar el tipo de servicio', 'error')
    } finally {
      setUpdatingStoreId(null)
    }
  }

  // Modificar repartidor predeterminado
  const handleUpdateDefaultDelivery = async (businessId: string, deliveryId: string) => {
    setUpdatingStoreId(businessId)
    const newDeliveryId = deliveryId === 'none' ? '' : deliveryId
    try {
      await updateBusiness(businessId, { defaultDeliveryId: newDeliveryId })
      
      // Actualizar estado local
      setBusinesses(prev => prev.map(b => 
        b.id === businessId ? { ...b, defaultDeliveryId: newDeliveryId } : b
      ))
      
      showToast('Repartidor predeterminado actualizado', 'success')
    } catch (error) {
      console.error('Error al actualizar repartidor predeterminado:', error)
      showToast('No se pudo actualizar el repartidor', 'error')
    } finally {
      setUpdatingStoreId(null)
    }
  }

  // Filtrar y buscar tiendas
  const filteredBusinesses = useMemo(() => {
    return businesses.filter(b => {
      const matchesSearch = b.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                            b.username.toLowerCase().includes(searchTerm.toLowerCase())
      
      const currentServiceType = b.deliveryServiceType ?? 'fuddi' // Fuddi por defecto
      const matchesFilter = filterType === 'all' || currentServiceType === filterType

      return matchesSearch && matchesFilter
    })
  }, [businesses, searchTerm, filterType])

  // Estadísticas rápidas
  const stats = useMemo(() => {
    const total = businesses.length
    const fuddi = businesses.filter(b => (b.deliveryServiceType ?? 'fuddi') === 'fuddi').length
    const self = total - fuddi
    return { total, fuddi, self }
  }, [businesses])

  return (
    <div className="space-y-8 animate-fadeIn">
      {/* Toast Notification */}
      {toast.show && (
        <div className={`fixed bottom-5 right-5 z-50 flex items-center gap-3 px-5 py-4 rounded-2xl shadow-xl border text-sm font-bold transition-all duration-300 transform translate-y-0 ${
          toast.type === 'success' 
            ? 'bg-emerald-50 border-emerald-100 text-emerald-800' 
            : 'bg-rose-50 border-rose-100 text-rose-800'
        }`}>
          <i className={`bi ${toast.type === 'success' ? 'bi-check-circle-fill text-emerald-500' : 'bi-exclamation-triangle-fill text-rose-500'} text-lg`}></i>
          {toast.message}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-gray-900 tracking-tight">Gestión de Deliveries por Tienda</h1>
          <p className="text-gray-500 text-sm mt-1">Configura el tipo de entrega y el repartidor predeterminado para cada tienda.</p>
        </div>
        <button 
          onClick={loadData}
          disabled={loading}
          className="self-start md:self-auto flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-200 hover:border-gray-300 text-gray-700 rounded-2xl text-sm font-bold shadow-sm transition-all active:scale-95 disabled:opacity-50"
        >
          <i className={`bi bi-arrow-clockwise ${loading ? 'animate-spin' : ''}`}></i>
          Recargar
        </button>
      </div>

      {/* Stats Panel */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center text-xl">
            <i className="bi bi-shop"></i>
          </div>
          <div>
            <p className="text-xs text-gray-400 font-bold uppercase tracking-wider">Total Tiendas</p>
            <p className="text-2xl font-black text-gray-900 mt-0.5">{stats.total}</p>
          </div>
        </div>

        <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center text-xl">
            <i className="bi bi-rocket-takeoff-fill"></i>
          </div>
          <div>
            <p className="text-xs text-gray-400 font-bold uppercase tracking-wider">Delivery Fuddi</p>
            <p className="text-2xl font-black text-gray-900 mt-0.5">{stats.fuddi}</p>
          </div>
        </div>

        <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 bg-amber-50 text-amber-600 rounded-2xl flex items-center justify-center text-xl">
            <i className="bi bi-person-fill-gear"></i>
          </div>
          <div>
            <p className="text-xs text-gray-400 font-bold uppercase tracking-wider">Autogestión (Self)</p>
            <p className="text-2xl font-black text-gray-900 mt-0.5">{stats.self}</p>
          </div>
        </div>
      </div>

      {/* Filters and Search */}
      <div className="bg-white p-4 rounded-3xl border border-gray-100 shadow-sm flex flex-col sm:flex-row gap-4 justify-between items-center">
        <div className="relative w-full sm:w-80">
          <i className="bi bi-search absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"></i>
          <input
            type="text"
            placeholder="Buscar por nombre o URL..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-gray-50 border-none rounded-2xl pl-11 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all text-gray-900 placeholder-gray-400"
          />
        </div>

        <div className="flex bg-gray-100 p-1 rounded-2xl w-full sm:w-auto">
          <button
            onClick={() => setFilterType('all')}
            className={`flex-1 sm:flex-initial px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              filterType === 'all'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            Todos
          </button>
          <button
            onClick={() => setFilterType('fuddi')}
            className={`flex-1 sm:flex-initial px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              filterType === 'fuddi'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            Fuddi
          </button>
          <button
            onClick={() => setFilterType('self')}
            className={`flex-1 sm:flex-initial px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              filterType === 'self'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            Autogestión
          </button>
        </div>
      </div>

      {/* Table Card */}
      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-20 flex flex-col items-center justify-center gap-3">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
            <p className="text-sm font-bold text-gray-500">Cargando tiendas...</p>
          </div>
        ) : filteredBusinesses.length === 0 ? (
          <div className="p-20 text-center text-gray-500">
            <i className="bi bi-shop text-4xl block text-gray-300 mb-3"></i>
            <p className="font-bold text-lg">No se encontraron tiendas</p>
            <p className="text-sm mt-1">Prueba cambiando tu búsqueda o filtros.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="px-6 py-4.5 text-xs font-bold uppercase tracking-wider text-gray-400">Tienda</th>
                  <th className="px-6 py-4.5 text-xs font-bold uppercase tracking-wider text-gray-400">Tipo de Delivery</th>
                  <th className="px-6 py-4.5 text-xs font-bold uppercase tracking-wider text-gray-400">Delivery Predeterminado</th>
                  <th className="px-6 py-4.5 text-xs font-bold uppercase tracking-wider text-gray-400 text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredBusinesses.map((store) => {
                  const currentServiceType = store.deliveryServiceType ?? 'fuddi'
                  const isUpdating = updatingStoreId === store.id

                  return (
                    <tr key={store.id} className="hover:bg-gray-50/50 transition-colors group">
                      {/* Tienda Info */}
                      <td className="px-6 py-5">
                        <div className="flex items-center gap-3.5">
                          {store.image ? (
                            <img
                              src={store.image}
                              alt={store.name}
                              className="w-11 h-11 rounded-2xl object-cover border border-gray-100 shadow-sm"
                            />
                          ) : (
                            <div className="w-11 h-11 bg-gradient-to-tr from-blue-500 to-cyan-400 rounded-2xl flex items-center justify-center text-white font-black text-sm shadow-sm">
                              {store.name.slice(0, 2).toUpperCase()}
                            </div>
                          )}
                          <div>
                            <p className="font-bold text-gray-900 group-hover:text-blue-600 transition-colors">
                              {store.name}
                            </p>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-xs text-gray-400">@{store.username}</span>
                              <span className="text-[10px] text-gray-300">•</span>
                              <Link 
                                href={`/${store.username}`} 
                                target="_blank"
                                className="text-xs text-blue-500 hover:text-blue-600 flex items-center gap-1 font-semibold"
                              >
                                Ver tienda <i className="bi bi-box-arrow-up-right text-[10px]"></i>
                              </Link>
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Tipo de Delivery Selector */}
                      <td className="px-6 py-5">
                        <div className="flex items-center gap-2">
                          <div className="inline-flex bg-gray-100 p-0.5 rounded-xl border border-gray-200/50">
                            <button
                              disabled={isUpdating}
                              onClick={() => handleUpdateServiceType(store.id, 'fuddi')}
                              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                                currentServiceType === 'fuddi'
                                  ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
                                  : 'text-gray-500 hover:text-gray-800'
                              }`}
                            >
                              <i className="bi bi-rocket-takeoff-fill"></i>
                              Fuddi
                            </button>
                            <button
                              disabled={isUpdating}
                              onClick={() => handleUpdateServiceType(store.id, 'self')}
                              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                                currentServiceType === 'self'
                                  ? 'bg-amber-500 text-white shadow-md shadow-amber-500/20'
                                  : 'text-gray-500 hover:text-gray-800'
                              }`}
                            >
                              <i className="bi bi-person-fill-gear"></i>
                              Autogestión
                            </button>
                          </div>
                          {isUpdating && updatingStoreId === store.id && (
                            <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-blue-600"></div>
                          )}
                        </div>
                      </td>

                      {/* Delivery Predeterminado Selector */}
                      <td className="px-6 py-5">
                        <div className="relative w-64">
                          <select
                            disabled={isUpdating}
                            value={store.defaultDeliveryId || 'none'}
                            onChange={(e) => handleUpdateDefaultDelivery(store.id, e.target.value)}
                            className="w-full bg-gray-50 border border-gray-200/50 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:bg-white text-gray-800 appearance-none cursor-pointer transition-all hover:border-gray-300"
                          >
                            <option value="none">Sin asignar (Aleatorio / Manual)</option>
                            {deliveries.map((delivery) => (
                              <option key={delivery.id} value={delivery.id}>
                                {delivery.nombres}
                              </option>
                            ))}
                          </select>
                          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-gray-400">
                            <i className="bi bi-chevron-down text-[10px]"></i>
                          </div>
                        </div>
                      </td>

                      {/* Configuración completa */}
                      <td className="px-6 py-5 text-right">
                        <Link
                          href={`/admin/stores/${store.id}`}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 hover:bg-gray-100 text-gray-700 hover:text-gray-900 rounded-xl text-xs font-bold border border-gray-200/40 transition-all active:scale-95"
                        >
                          <i className="bi bi-gear-fill"></i>
                          Detalles
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
