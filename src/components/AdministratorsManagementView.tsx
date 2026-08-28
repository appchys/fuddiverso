'use client'

import React, { useState } from 'react'
import { Business, BusinessAdministrator } from '@/types'

interface AdministratorsManagementViewProps {
    business: Business
    currentUserEmail?: string | null
    currentUserRole?: 'owner' | 'admin' | 'manager' | 'atencion_cliente' | null
    onAddAdmin: (adminData: {
        email: string
        password?: string
        role: 'admin' | 'manager' | 'atencion_cliente'
        permissions: BusinessAdministrator['permissions']
    }) => Promise<void>
    onUpdateAdmin: (adminData: {
        email: string
        role: 'admin' | 'manager' | 'atencion_cliente'
        permissions: BusinessAdministrator['permissions']
    }) => Promise<void>
    onSaveAdminPassword: (email: string, password: string) => Promise<void>
    onRemoveAdmin: (email: string) => Promise<void>
    onTransferOwnership?: (admin: BusinessAdministrator) => Promise<void>
}

const ROLE_PRESETS: Record<'atencion_cliente' | 'admin' | 'manager', { label: string; permissions: BusinessAdministrator['permissions'] }> = {
    atencion_cliente: {
        label: 'Atención al Cliente',
        permissions: {
            manageOrders: true,
            deleteOrders: true,
            manageProducts: true,
            managePromotions: false,
            viewReports: false,
            manageInventory: false,
            viewFinances: false,
            editBusiness: false,
            manageAdmins: false
        }
    },
    admin: {
        label: 'Administrador',
        permissions: {
            manageOrders: true,
            deleteOrders: true,
            manageProducts: true,
            managePromotions: true,
            viewReports: true,
            manageInventory: true,
            viewFinances: true,
            editBusiness: true,
            manageAdmins: false
        }
    },
    manager: {
        label: 'Gerente',
        permissions: {
            manageOrders: true,
            deleteOrders: true,
            manageProducts: true,
            managePromotions: true,
            viewReports: true,
            manageInventory: true,
            viewFinances: false,
            editBusiness: false,
            manageAdmins: false
        }
    }
}

export default function AdministratorsManagementView({
    business,
    currentUserEmail,
    currentUserRole,
    onAddAdmin,
    onUpdateAdmin,
    onSaveAdminPassword,
    onRemoveAdmin,
    onTransferOwnership
}: AdministratorsManagementViewProps) {
    const [isAddModalOpen, setIsAddModalOpen] = useState(false)
    const [editingAdmin, setEditingAdmin] = useState<BusinessAdministrator | null>(null)
    const [passwordModalAdmin, setPasswordModalAdmin] = useState<BusinessAdministrator | null>(null)
    const [adminPasswordInput, setAdminPasswordInput] = useState('')

    // Estado del formulario (crear / editar)
    const [formData, setFormData] = useState({
        email: '',
        password: '',
        role: 'atencion_cliente' as 'atencion_cliente' | 'admin' | 'manager',
        permissions: { ...ROLE_PRESETS.atencion_cliente.permissions }
    })

    const [saving, setSaving] = useState(false)

    const isOwner = currentUserRole === 'owner'

    const handleOpenAddModal = () => {
        setFormData({
            email: '',
            password: '',
            role: 'atencion_cliente',
            permissions: { ...ROLE_PRESETS.atencion_cliente.permissions }
        })
        setIsAddModalOpen(true)
    }

    const handleOpenEditModal = (admin: BusinessAdministrator) => {
        const role = (admin.role as any) === 'atencion_cliente' ? 'atencion_cliente' : (admin.role || 'admin')
        setEditingAdmin(admin)
        setFormData({
            email: admin.email,
            password: '',
            role,
            permissions: {
                ...ROLE_PRESETS[role as keyof typeof ROLE_PRESETS]?.permissions,
                ...admin.permissions
            }
        })
    }

    const handleRoleChange = (newRole: 'atencion_cliente' | 'admin' | 'manager') => {
        setFormData(prev => ({
            ...prev,
            role: newRole,
            permissions: { ...ROLE_PRESETS[newRole].permissions }
        }))
    }

    const handlePermissionToggle = (key: keyof BusinessAdministrator['permissions']) => {
        setFormData(prev => ({
            ...prev,
            permissions: {
                ...prev.permissions,
                [key]: !prev.permissions[key]
            }
        }))
    }

    const handleSubmitAdd = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!formData.email.trim()) return

        setSaving(true)
        try {
            await onAddAdmin({
                email: formData.email.trim().toLowerCase(),
                password: formData.password ? formData.password.trim() : undefined,
                role: formData.role,
                permissions: formData.permissions
            })
            setIsAddModalOpen(false)
        } catch (error: any) {
            alert(error.message || 'Error al guardar administrador')
        } finally {
            setSaving(false)
        }
    }

    const handleSubmitEdit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!editingAdmin) return

        setSaving(true)
        try {
            await onUpdateAdmin({
                email: editingAdmin.email,
                role: formData.role,
                permissions: formData.permissions
            })
            setEditingAdmin(null)
        } catch (error: any) {
            alert(error.message || 'Error al actualizar administrador')
        } finally {
            setSaving(false)
        }
    }

    const handleSubmitPassword = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!passwordModalAdmin || !adminPasswordInput.trim()) return

        setSaving(true)
        try {
            await onSaveAdminPassword(passwordModalAdmin.email, adminPasswordInput.trim())
            setPasswordModalAdmin(null)
            setAdminPasswordInput('')
        } catch (error: any) {
            alert(error.message || 'Error al cambiar contraseña')
        } finally {
            setSaving(false)
        }
    }

    const administrators = business.administrators || []

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            {/* Header minimalista */}
            <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-gray-100 text-gray-700 flex items-center justify-center text-lg font-bold">
                        <i className="bi bi-people"></i>
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-gray-900">Administradores y Equipo</h2>
                        <p className="text-xs text-gray-500">Gestión de accesos y permisos para tu tienda</p>
                    </div>
                </div>

                <button
                    onClick={handleOpenAddModal}
                    className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors shadow-sm"
                >
                    <i className="bi bi-plus-lg"></i>
                    <span>Agregar Administrador</span>
                </button>
            </div>

            {/* Listado de Administradores */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden divide-y divide-gray-100">
                {/* Dueño de la Tienda */}
                <div className="p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-gray-50/50">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-lg bg-red-50 text-red-600 border border-red-100 flex items-center justify-center font-bold text-sm">
                            <i className="bi bi-shield-check"></i>
                        </div>
                        <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-bold text-gray-900 truncate">
                                    {business.email || 'Propietario de la tienda'}
                                </span>
                                <span className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-red-50 text-red-700 border border-red-100">
                                    Propietario
                                </span>
                            </div>
                            <p className="text-xs text-gray-500">Control total del negocio</p>
                        </div>
                    </div>
                    <span className="text-xs text-gray-400 font-medium">Acceso Completo</span>
                </div>

                {/* Administradores Registrados */}
                {administrators.length === 0 ? (
                    <div className="p-8 text-center">
                        <div className="w-10 h-10 rounded-full bg-gray-100 text-gray-400 flex items-center justify-center mx-auto mb-2">
                            <i className="bi bi-person-plus text-lg"></i>
                        </div>
                        <p className="text-sm font-medium text-gray-700">No hay otros administradores asignados</p>
                        <p className="text-xs text-gray-400 mt-0.5">Puedes agregar encargados de atención al cliente o gerentes</p>
                    </div>
                ) : (
                    administrators.map((admin) => {
                        const roleKey = (admin.role as any) === 'atencion_cliente' ? 'atencion_cliente' : (admin.role || 'admin')
                        const isAtencion = roleKey === 'atencion_cliente'
                        const isManager = roleKey === 'manager'

                        return (
                            <div key={admin.email} className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 hover:bg-gray-50/50 transition-colors">
                                <div className="space-y-2 min-w-0 flex-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="text-sm font-bold text-gray-900 truncate" title={admin.email}>
                                            {admin.email}
                                        </span>
                                        <span className={`px-2 py-0.5 rounded-md text-[11px] font-medium border ${
                                            isAtencion
                                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                                : isManager
                                                    ? 'bg-purple-50 text-purple-700 border-purple-200'
                                                    : 'bg-blue-50 text-blue-700 border-blue-200'
                                        }`}>
                                            {ROLE_PRESETS[roleKey as keyof typeof ROLE_PRESETS]?.label || admin.role}
                                        </span>
                                    </div>

                                    {/* Permisos activos compactos */}
                                    <div className="flex flex-wrap gap-1.5 pt-1">
                                        {admin.permissions?.manageOrders && (
                                            <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-600 text-[11px] font-medium">
                                                Pedidos hoy e historial
                                            </span>
                                        )}
                                        {admin.permissions?.deleteOrders && (
                                            <span className="px-2 py-0.5 rounded bg-red-50 text-red-600 text-[11px] font-medium">
                                                Eliminar pedidos
                                            </span>
                                        )}
                                        {admin.permissions?.manageProducts && (
                                            <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-600 text-[11px] font-medium">
                                                Productos y menú
                                            </span>
                                        )}
                                        {admin.permissions?.managePromotions && (
                                            <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-600 text-[11px] font-medium">
                                                Promociones
                                            </span>
                                        )}
                                        {admin.permissions?.viewFinances && (
                                            <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-600 text-[11px] font-medium">
                                                Finanzas
                                            </span>
                                        )}
                                        {admin.permissions?.manageInventory && (
                                            <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-600 text-[11px] font-medium">
                                                Inventario
                                            </span>
                                        )}
                                        {admin.permissions?.viewReports && (
                                            <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-600 text-[11px] font-medium">
                                                Reportes
                                            </span>
                                        )}
                                        {admin.permissions?.editBusiness && (
                                            <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-600 text-[11px] font-medium">
                                                Configuración
                                            </span>
                                        )}
                                        {admin.permissions?.manageAdmins && (
                                            <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-600 text-[11px] font-medium">
                                                Gestionar Admins
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {/* Acciones */}
                                <div className="flex items-center gap-2 flex-shrink-0 pt-2 lg:pt-0 border-t lg:border-t-0 border-gray-100">
                                    <button
                                        onClick={() => handleOpenEditModal(admin)}
                                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                                        title="Editar rol y permisos"
                                    >
                                        <i className="bi bi-pencil"></i>
                                        <span>Editar</span>
                                    </button>

                                    <button
                                        onClick={() => {
                                            setPasswordModalAdmin(admin)
                                            setAdminPasswordInput('')
                                        }}
                                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                                        title="Asignar o cambiar contraseña"
                                    >
                                        <i className="bi bi-key"></i>
                                        <span>Clave</span>
                                    </button>

                                    {isOwner && onTransferOwnership && admin.uid && (
                                        <button
                                            onClick={() => onTransferOwnership(admin)}
                                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg transition-colors"
                                            title="Transferir propiedad de la tienda"
                                        >
                                            <i className="bi bi-arrow-left-right"></i>
                                            <span>Transferir</span>
                                        </button>
                                    )}

                                    <button
                                        onClick={() => onRemoveAdmin(admin.email)}
                                        className="flex items-center justify-center p-2 text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
                                        title="Eliminar administrador"
                                    >
                                        <i className="bi bi-trash"></i>
                                    </button>
                                </div>
                            </div>
                        )
                    })
                )}
            </div>

            {/* MODAL: AGREGAR ADMINISTRADOR */}
            {isAddModalOpen && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 animate-in fade-in duration-150">
                    <div className="bg-white rounded-xl max-w-lg w-full p-6 shadow-xl border border-gray-100 space-y-5 max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between pb-3 border-b border-gray-100">
                            <h3 className="text-base font-bold text-gray-900">Agregar Administrador</h3>
                            <button
                                onClick={() => setIsAddModalOpen(false)}
                                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg"
                            >
                                <i className="bi bi-x-lg"></i>
                            </button>
                        </div>

                        <form onSubmit={handleSubmitAdd} className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-gray-700 mb-1">
                                    Correo electrónico
                                </label>
                                <input
                                    type="email"
                                    required
                                    value={formData.email}
                                    onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-red-500"
                                    placeholder="usuario@ejemplo.com"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-gray-700 mb-1">
                                    Contraseña de acceso (opcional)
                                </label>
                                <input
                                    type="password"
                                    value={formData.password}
                                    onChange={(e) => setFormData(prev => ({ ...prev, password: e.target.value }))}
                                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-red-500"
                                    placeholder="Mínimo 6 caracteres"
                                    autoComplete="new-password"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-gray-700 mb-1">
                                    Rol
                                </label>
                                <div className="grid grid-cols-3 gap-2">
                                    {(['atencion_cliente', 'admin', 'manager'] as const).map((r) => {
                                        const isSelected = formData.role === r
                                        return (
                                            <button
                                                key={r}
                                                type="button"
                                                onClick={() => handleRoleChange(r)}
                                                className={`py-2 px-3 text-xs font-bold rounded-lg border text-center transition-all ${
                                                    isSelected
                                                        ? 'bg-red-50 border-red-300 text-red-700'
                                                        : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                                                }`}
                                            >
                                                {ROLE_PRESETS[r].label}
                                            </button>
                                        )
                                    })}
                                </div>
                            </div>

                            {/* Permisos Configurados */}
                            <div>
                                <label className="block text-xs font-bold text-gray-700 mb-2">
                                    Permisos asignados
                                </label>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 bg-gray-50 p-3 rounded-lg border border-gray-100">
                                    {[
                                        { key: 'manageOrders', label: 'Pedidos de hoy e historial' },
                                        { key: 'deleteOrders', label: 'Crear, editar y eliminar pedidos' },
                                        { key: 'manageProducts', label: 'Productos y menú' },
                                        { key: 'managePromotions', label: 'Promociones' },
                                        { key: 'viewFinances', label: 'Gastos y Saldo' },
                                        { key: 'manageInventory', label: 'Inventario' },
                                        { key: 'viewReports', label: 'Reportes y estadísticas' },
                                        { key: 'editBusiness', label: 'Configuración de tienda' },
                                        { key: 'manageAdmins', label: 'Gestionar administradores' },
                                    ].map(({ key, label }) => {
                                        const checked = !!(formData.permissions as any)[key]
                                        return (
                                            <label key={key} className="flex items-center gap-2 cursor-pointer py-1">
                                                <input
                                                    type="checkbox"
                                                    checked={checked}
                                                    onChange={() => handlePermissionToggle(key as any)}
                                                    className="w-4 h-4 text-red-600 rounded border-gray-300 focus:ring-red-500"
                                                />
                                                <span className="text-xs text-gray-700 font-medium">{label}</span>
                                            </label>
                                        )
                                    })}
                                </div>
                            </div>

                            <div className="pt-3 border-t border-gray-100 flex items-center justify-end gap-2">
                                <button
                                    type="button"
                                    onClick={() => setIsAddModalOpen(false)}
                                    className="px-4 py-2 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    disabled={saving || !formData.email.trim()}
                                    className="px-4 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-50"
                                >
                                    {saving ? 'Guardando...' : 'Guardar Administrador'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* MODAL: EDITAR ADMINISTRADOR */}
            {editingAdmin && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 animate-in fade-in duration-150">
                    <div className="bg-white rounded-xl max-w-lg w-full p-6 shadow-xl border border-gray-100 space-y-5 max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between pb-3 border-b border-gray-100">
                            <div>
                                <h3 className="text-base font-bold text-gray-900">Editar Permisos</h3>
                                <p className="text-xs text-gray-500">{editingAdmin.email}</p>
                            </div>
                            <button
                                onClick={() => setEditingAdmin(null)}
                                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg"
                            >
                                <i className="bi bi-x-lg"></i>
                            </button>
                        </div>

                        <form onSubmit={handleSubmitEdit} className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-gray-700 mb-1">
                                    Rol
                                </label>
                                <div className="grid grid-cols-3 gap-2">
                                    {(['atencion_cliente', 'admin', 'manager'] as const).map((r) => {
                                        const isSelected = formData.role === r
                                        return (
                                            <button
                                                key={r}
                                                type="button"
                                                onClick={() => handleRoleChange(r)}
                                                className={`py-2 px-3 text-xs font-bold rounded-lg border text-center transition-all ${
                                                    isSelected
                                                        ? 'bg-red-50 border-red-300 text-red-700'
                                                        : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                                                }`}
                                            >
                                                {ROLE_PRESETS[r].label}
                                            </button>
                                        )
                                    })}
                                </div>
                            </div>

                            {/* Permisos Configurados */}
                            <div>
                                <label className="block text-xs font-bold text-gray-700 mb-2">
                                    Permisos asignados
                                </label>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 bg-gray-50 p-3 rounded-lg border border-gray-100">
                                    {[
                                        { key: 'manageOrders', label: 'Pedidos de hoy e historial' },
                                        { key: 'deleteOrders', label: 'Crear, editar y eliminar pedidos' },
                                        { key: 'manageProducts', label: 'Productos y menú' },
                                        { key: 'managePromotions', label: 'Promociones' },
                                        { key: 'viewFinances', label: 'Gastos y Saldo' },
                                        { key: 'manageInventory', label: 'Inventario' },
                                        { key: 'viewReports', label: 'Reportes y estadísticas' },
                                        { key: 'editBusiness', label: 'Configuración de tienda' },
                                        { key: 'manageAdmins', label: 'Gestionar administradores' },
                                    ].map(({ key, label }) => {
                                        const checked = !!(formData.permissions as any)[key]
                                        return (
                                            <label key={key} className="flex items-center gap-2 cursor-pointer py-1">
                                                <input
                                                    type="checkbox"
                                                    checked={checked}
                                                    onChange={() => handlePermissionToggle(key as any)}
                                                    className="w-4 h-4 text-red-600 rounded border-gray-300 focus:ring-red-500"
                                                />
                                                <span className="text-xs text-gray-700 font-medium">{label}</span>
                                            </label>
                                        )
                                    })}
                                </div>
                            </div>

                            <div className="pt-3 border-t border-gray-100 flex items-center justify-end gap-2">
                                <button
                                    type="button"
                                    onClick={() => setEditingAdmin(null)}
                                    className="px-4 py-2 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    disabled={saving}
                                    className="px-4 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-50"
                                >
                                    {saving ? 'Guardando...' : 'Actualizar Permisos'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* MODAL: CAMBIAR CONTRASEÑA */}
            {passwordModalAdmin && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 animate-in fade-in duration-150">
                    <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl border border-gray-100 space-y-4">
                        <div className="flex items-center justify-between pb-3 border-b border-gray-100">
                            <div>
                                <h3 className="text-base font-bold text-gray-900">Cambiar Contraseña</h3>
                                <p className="text-xs text-gray-500">{passwordModalAdmin.email}</p>
                            </div>
                            <button
                                onClick={() => {
                                    setPasswordModalAdmin(null)
                                    setAdminPasswordInput('')
                                }}
                                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg"
                            >
                                <i className="bi bi-x-lg"></i>
                            </button>
                        </div>

                        <form onSubmit={handleSubmitPassword} className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-gray-700 mb-1">
                                    Nueva contraseña
                                </label>
                                <input
                                    type="password"
                                    required
                                    value={adminPasswordInput}
                                    onChange={(e) => setAdminPasswordInput(e.target.value)}
                                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-red-500"
                                    placeholder="Mínimo 6 caracteres"
                                    autoComplete="new-password"
                                />
                            </div>

                            <div className="pt-3 border-t border-gray-100 flex items-center justify-end gap-2">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setPasswordModalAdmin(null)
                                        setAdminPasswordInput('')
                                    }}
                                    className="px-4 py-2 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    disabled={saving || adminPasswordInput.length < 6}
                                    className="px-4 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-50"
                                >
                                    {saving ? 'Guardando...' : 'Guardar Contraseña'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    )
}
