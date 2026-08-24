'use client'

import React, { useState, useEffect } from 'react'
import { Business } from '@/types'
import { getBranchesForBusiness, createBusinessBranch, unlinkBusinessBranch } from '@/lib/database'

interface BranchManagementViewProps {
  currentBusiness: Business
  onSwitchBusiness?: (businessId: string) => void
  userRole?: 'owner' | 'admin' | 'manager' | null
}

export default function BranchManagementView({
  currentBusiness,
  onSwitchBusiness,
  userRole
}: BranchManagementViewProps) {
  const [branches, setBranches] = useState<Business[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [creating, setCreating] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  const [formData, setFormData] = useState({
    name: currentBusiness.name || '',
    branchName: '',
    username: '',
    phone: currentBusiness.phone || '',
    address: '',
    email: currentBusiness.email || ''
  })

  const loadBranches = async () => {
    setLoading(true)
    try {
      const list = await getBranchesForBusiness(currentBusiness.id)
      setBranches(list)
    } catch (error) {
      console.error('Error loading branches:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (currentBusiness?.id) {
      loadBranches()
    }
  }, [currentBusiness?.id])

  const handleOpenCreateModal = () => {
    setFormData({
      name: currentBusiness.name || '',
      branchName: '',
      username: `${currentBusiness.username || 'sucursal'}-`,
      phone: currentBusiness.phone || '',
      address: '',
      email: currentBusiness.email || ''
    })
    setErrorMessage('')
    setShowCreateModal(true)
  }

  const handleCreateBranch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.name.trim() || !formData.branchName.trim() || !formData.username.trim()) {
      setErrorMessage('Por favor completa todos los campos requeridos.')
      return
    }

    setCreating(true)
    setErrorMessage('')
    try {
      const rootParentId = currentBusiness.parentBusinessId || currentBusiness.id
      const newBranchId = await createBusinessBranch(rootParentId, {
        name: formData.name.trim(),
        branchName: formData.branchName.trim(),
        username: formData.username.toLowerCase().trim(),
        phone: formData.phone.trim(),
        address: formData.address.trim(),
        email: formData.email.trim(),
        references: formData.address.trim()
      })

      setSuccessMessage('¡Sucursal creada con éxito!')
      setShowCreateModal(false)
      await loadBranches()
      setTimeout(() => setSuccessMessage(''), 3500)
    } catch (error: any) {
      console.error('Error creating branch:', error)
      setErrorMessage(error.message || 'Error al crear la sucursal. Revisa que el nombre de usuario no esté duplicado.')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-rose-500 via-red-600 to-amber-500 rounded-2xl p-6 sm:p-8 text-white shadow-xl shadow-red-500/10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/20 backdrop-blur-md rounded-full text-xs font-bold uppercase tracking-wider mb-3">
            <i className="bi bi-diagram-3-fill"></i>
            Red de Sucursales
          </div>
          <h2 className="text-2xl sm:text-3xl font-black tracking-tight leading-tight">
            Sucursales de {currentBusiness.name}
          </h2>
          <p className="text-white/80 font-medium text-sm mt-1 max-w-xl leading-relaxed">
            Administra los diferentes locales de tu negocio. Cada sucursal dispone de su propio menú, horario, zonas de delivery y reportes independientes.
          </p>
        </div>
        <button
          onClick={handleOpenCreateModal}
          className="self-start sm:self-center px-5 py-3 bg-white text-gray-900 hover:bg-rose-50 rounded-xl font-black text-sm tracking-tight transition-all duration-200 shadow-lg hover:shadow-xl hover:scale-105 active:scale-95 flex items-center gap-2 cursor-pointer flex-shrink-0"
        >
          <i className="bi bi-plus-circle-fill text-red-600 text-lg"></i>
          <span>Nueva Sucursal</span>
        </button>
      </div>

      {successMessage && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-sm font-bold flex items-center gap-2 shadow-sm animate-fade-in">
          <i className="bi bi-check-circle-fill text-emerald-600 text-lg"></i>
          <span>{successMessage}</span>
        </div>
      )}

      {/* Lista de Sucursales */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-black tracking-tight text-gray-900 flex items-center gap-2">
            <span>Locales Registrados</span>
            <span className="text-xs font-bold text-gray-500 bg-gray-100 px-2.5 py-0.5 rounded-full">
              {branches.length}
            </span>
          </h3>
        </div>

        {loading ? (
          <div className="py-16 text-center bg-white rounded-2xl border border-gray-100 shadow-sm">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-600 mx-auto"></div>
            <p className="text-sm font-medium text-gray-500 mt-3">Cargando sucursales...</p>
          </div>
        ) : branches.length === 0 ? (
          <div className="py-12 px-6 text-center bg-white rounded-2xl border border-dashed border-gray-200 shadow-sm">
            <div className="w-14 h-14 bg-rose-50 text-rose-500 rounded-2xl flex items-center justify-center mx-auto mb-3 text-2xl">
              <i className="bi bi-shop"></i>
            </div>
            <h4 className="font-black text-gray-900 text-base">Aún no hay sucursales registradas</h4>
            <p className="text-gray-500 text-sm font-medium mt-1 max-w-md mx-auto">
              Crea tu primera sucursal para gestionar menús específicos por sector y despachar pedidos organizadamente.
            </p>
            <button
              onClick={handleOpenCreateModal}
              className="mt-4 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold text-xs uppercase tracking-wider transition-all"
            >
              Crear Primera Sucursal
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {branches.map((branch) => {
              const isCurrent = branch.id === currentBusiness.id
              const isRoot = !branch.parentBusinessId || branch.id === currentBusiness.parentBusinessId

              return (
                <div
                  key={branch.id}
                  className={`bg-white rounded-2xl border transition-all duration-200 p-5 flex flex-col justify-between shadow-sm hover:shadow-md ${
                    isCurrent ? 'border-rose-300 ring-2 ring-rose-500/20 bg-gradient-to-b from-rose-50/20 to-white' : 'border-gray-100 hover:border-gray-200'
                  }`}
                >
                  <div>
                    {/* Header Card */}
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-xl bg-gray-100 overflow-hidden border border-gray-200/80 flex-shrink-0">
                          {branch.image ? (
                            <img src={branch.image} alt={branch.name} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-gray-400 text-xl">
                              <i className="bi bi-shop"></i>
                            </div>
                          )}
                        </div>
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="font-black text-gray-900 text-base tracking-tight leading-tight">
                              {branch.name}
                            </h4>
                            {isRoot ? (
                              <span className="text-[10px] font-black uppercase tracking-wider bg-gray-900 text-white px-2 py-0.5 rounded-md">
                                Matriz
                              </span>
                            ) : (
                              <span className="text-[10px] font-black uppercase tracking-wider bg-rose-100 text-rose-700 px-2 py-0.5 rounded-md">
                                Sucursal
                              </span>
                            )}
                          </div>
                          {branch.branchName && (
                            <p className="text-xs font-bold text-rose-600 mt-0.5">
                              {branch.branchName}
                            </p>
                          )}
                        </div>
                      </div>

                      {isCurrent && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full text-xs font-black flex-shrink-0">
                          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                          Activo
                        </span>
                      )}
                    </div>

                    {/* Info */}
                    <div className="space-y-1.5 text-xs text-gray-600 font-medium my-3 bg-gray-50/70 p-3 rounded-xl">
                      <div className="flex items-center gap-2 truncate">
                        <i className="bi bi-link-45deg text-gray-400 text-sm"></i>
                        <span className="text-gray-500">URL:</span>
                        <a
                          href={`/${branch.username}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-rose-600 hover:underline font-bold truncate"
                        >
                          fuddi.shop/{branch.username}
                        </a>
                      </div>
                      {branch.phone && (
                        <div className="flex items-center gap-2">
                          <i className="bi bi-telephone text-gray-400"></i>
                          <span className="text-gray-500">Tel:</span>
                          <span className="text-gray-800 font-semibold">{branch.phone}</span>
                        </div>
                      )}
                      {branch.pickupSettings?.references && (
                        <div className="flex items-center gap-2 truncate">
                          <i className="bi bi-geo-alt text-gray-400"></i>
                          <span className="text-gray-500">Dirección:</span>
                          <span className="text-gray-800 truncate">{branch.pickupSettings.references}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Acciones */}
                  <div className="flex items-center gap-2 pt-3 border-t border-gray-100 mt-2">
                    {!isCurrent ? (
                      <button
                        onClick={() => onSwitchBusiness?.(branch.id)}
                        className="flex-1 px-3.5 py-2 bg-gray-900 hover:bg-black text-white rounded-xl font-bold text-xs tracking-tight transition-all duration-150 flex items-center justify-center gap-1.5 cursor-pointer shadow-sm hover:shadow"
                      >
                        <i className="bi bi-arrow-repeat"></i>
                        <span>Cambiar a esta sucursal</span>
                      </button>
                    ) : (
                      <div className="flex-1 text-center py-2 bg-rose-50 text-rose-600 rounded-xl text-xs font-black">
                        Panel de esta sucursal abierto
                      </div>
                    )}

                    <a
                      href={`/${branch.username}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-2 text-gray-500 hover:text-rose-600 hover:bg-rose-50 rounded-xl border border-gray-200 transition-colors"
                      title="Ver catálogo público de la sucursal"
                    >
                      <i className="bi bi-box-arrow-up-right text-sm"></i>
                    </a>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Modal Crear Sucursal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full shadow-2xl overflow-hidden animate-scale-up">
            {/* Modal Header */}
            <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-rose-50 to-white">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center font-bold">
                  <i className="bi bi-shop text-lg"></i>
                </div>
                <div>
                  <h3 className="text-lg font-black text-gray-900 tracking-tight leading-tight">
                    Registrar Nueva Sucursal
                  </h3>
                  <p className="text-xs font-medium text-gray-500">
                    Vincular un nuevo local a {currentBusiness.name}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowCreateModal(false)}
                className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-full transition-colors"
              >
                <i className="bi bi-x-lg"></i>
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleCreateBranch} className="p-6 space-y-4">
              {errorMessage && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs font-bold flex items-center gap-2">
                  <i className="bi bi-exclamation-circle-fill"></i>
                  <span>{errorMessage}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                  Nombre de la Marca *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Ej: La parada de Bolillo"
                  className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-sm font-bold text-gray-900 focus:ring-2 focus:ring-rose-500 focus:border-rose-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                  Nombre o Identificador de la Sucursal *
                </label>
                <input
                  type="text"
                  value={formData.branchName}
                  onChange={(e) => {
                    const bName = e.target.value
                    const baseUser = currentBusiness.username || 'sucursal'
                    const slug = bName.toLowerCase().replace(/[^a-z0-9]/g, '-')
                    setFormData({
                      ...formData,
                      branchName: bName,
                      username: `${baseUser}-${slug}`
                    })
                  }}
                  placeholder="Ej: Sucursal Kennedy / Norte / Mall"
                  className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-sm font-bold text-gray-900 focus:ring-2 focus:ring-rose-500 focus:border-rose-500"
                  required
                />
                <p className="text-[11px] text-gray-500 mt-1 font-medium">
                  Este nombre aparecerá en el selector de pedidos y catálogo para diferenciar el local.
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                  URL amigable (fuddi.shop/...) *
                </label>
                <div className="flex rounded-xl overflow-hidden border border-gray-300 focus-within:ring-2 focus-within:ring-rose-500">
                  <span className="bg-gray-100 text-gray-500 px-3 py-2.5 text-xs font-semibold flex items-center select-none border-r border-gray-200">
                    fuddi.shop/
                  </span>
                  <input
                    type="text"
                    value={formData.username}
                    onChange={(e) => setFormData({ ...formData, username: e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, '') })}
                    placeholder="ej: laparadadebolillo-norte"
                    className="w-full px-3 py-2.5 text-sm font-bold text-gray-900 focus:outline-none"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                    Teléfono de la Sucursal
                  </label>
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    placeholder="Ej: 0987654321"
                    className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-sm font-medium text-gray-900 focus:ring-2 focus:ring-rose-500 focus:border-rose-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                    Email de contacto
                  </label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="sucursal@ejemplo.com"
                    className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-sm font-medium text-gray-900 focus:ring-2 focus:ring-rose-500 focus:border-rose-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                  Dirección o Referencias del Local
                </label>
                <input
                  type="text"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  placeholder="Ej: Av. Francisco de Orellana frente a la gasolinera"
                  className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-sm font-medium text-gray-900 focus:ring-2 focus:ring-rose-500 focus:border-rose-500"
                />
              </div>

              {/* Botones de acción */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  disabled={creating}
                  className="px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-bold text-xs uppercase tracking-wider transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="px-5 py-2.5 bg-gradient-to-r from-rose-500 to-red-600 hover:from-rose-600 hover:to-red-700 text-white rounded-xl font-bold text-xs uppercase tracking-wider transition-all shadow-md hover:shadow-lg disabled:opacity-50 flex items-center gap-2"
                >
                  {creating && (
                    <span className="inline-block h-3.5 w-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                  )}
                  <span>{creating ? 'Guardando...' : 'Crear Sucursal'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
