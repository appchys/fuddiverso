'use client'

import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useBusinessAuth } from '@/contexts/BusinessAuthContext'
import { Business } from '@/types'
import { getBusinessesByOwner, updateBusiness, deleteBusiness, linkCurrentBusinessPasswordLogin } from '@/lib/database'

export default function AccountPage() {
    const router = useRouter()
    const { user, businessId, isAuthenticated, authLoading, logout } = useBusinessAuth()

    const [businesses, setBusinesses] = useState<Business[]>([])
    const [loading, setLoading] = useState(true)
    const [showDeleteModal, setShowDeleteModal] = useState<string | null>(null)
    const [actionLoading, setActionLoading] = useState<string | null>(null)
    const [passwordForm, setPasswordForm] = useState({ password: '', confirmPassword: '' })
    const [passwordLoading, setPasswordLoading] = useState(false)
    const [passwordMessage, setPasswordMessage] = useState('')
    const [passwordError, setPasswordError] = useState('')

    // Protección de ruta
    useEffect(() => {
        if (authLoading) return
        if (!isAuthenticated) {
            router.replace('/business/login')
        }
    }, [authLoading, isAuthenticated, router])

    // Cargar tiendas del usuario
    useEffect(() => {
        if (!user?.uid) return

        const loadBusinesses = async () => {
            try {
                const userBusinesses = await getBusinessesByOwner(user.uid)
                setBusinesses(userBusinesses)
            } catch (error) {
                console.error('Error loading businesses:', error)
            } finally {
                setLoading(false)
            }
        }

        loadBusinesses()
    }, [user?.uid])

    // Ocultar/Mostrar tienda
    const handleToggleVisibility = async (businessId: string, currentlyHidden: boolean) => {
        setActionLoading(businessId)
        try {
            await updateBusiness(businessId, { isHidden: !currentlyHidden })
            setBusinesses(prev => prev.map(b =>
                b.id === businessId ? { ...b, isHidden: !currentlyHidden } : b
            ))
        } catch (error) {
            console.error('Error toggling visibility:', error)
            alert('Error al cambiar la visibilidad de la tienda')
        } finally {
            setActionLoading(null)
        }
    }

    // Eliminar tienda
    const handleDeleteBusiness = async (businessId: string) => {
        setActionLoading(businessId)
        try {
            await deleteBusiness(businessId)
            setBusinesses(prev => prev.filter(b => b.id !== businessId))
            setShowDeleteModal(null)
        } catch (error) {
            console.error('Error deleting business:', error)
            alert('Error al eliminar la tienda')
        } finally {
            setActionLoading(null)
        }
    }

    const handlePasswordLink = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        setPasswordMessage('')
        setPasswordError('')

        if (!businessId) {
            setPasswordError('No se encontro una tienda activa para vincular.')
            return
        }

        if (passwordForm.password !== passwordForm.confirmPassword) {
            setPasswordError('Las contrasenas no coinciden.')
            return
        }

        setPasswordLoading(true)
        try {
            const result = await linkCurrentBusinessPasswordLogin(businessId, passwordForm.password)
            setPasswordForm({ password: '', confirmPassword: '' })
            setPasswordMessage(result === 'linked'
                ? 'Listo. Ya puedes iniciar sesion con tu correo o celular y esta contrasena.'
                : 'Contrasena actualizada. Puedes usarla en el login de negocios.'
            )
        } catch (error) {
            const message = error instanceof Error ? error.message : 'No se pudo activar el ingreso con contrasena.'
            setPasswordError(message)
        } finally {
            setPasswordLoading(false)
        }
    }


    if (authLoading || loading) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="text-center">
                    <div className="w-12 h-12 border-4 border-red-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                    <p className="text-gray-600">Cargando...</p>
                </div>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Header */}
            <header className="bg-white shadow-sm border-b sticky top-0 z-10">
                <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <button
                                onClick={() => router.push('/business/dashboard')}
                                className="p-2 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors"
                            >
                                <i className="bi bi-arrow-left text-xl"></i>
                            </button>
                            <div>
                                <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Mi Cuenta</h1>
                                <p className="text-sm text-gray-500">{user?.email}</p>
                            </div>
                        </div>
                        <button
                            onClick={logout}
                            className="flex items-center gap-2 px-4 py-2 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        >
                            <i className="bi bi-box-arrow-right"></i>
                            <span className="hidden sm:inline">Cerrar sesión</span>
                        </button>
                    </div>
                </div>
            </header>

            {/* Contenido principal */}
            <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
                {/* Sección de usuario */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-8">
                    <div className="flex items-center gap-4">
                        <div className="w-16 h-16 rounded-full overflow-hidden bg-gray-200 flex-shrink-0">
                            {user?.photoURL ? (
                                <img
                                    src={user.photoURL}
                                    alt={user.displayName || 'Usuario'}
                                    className="w-full h-full object-cover"
                                />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center bg-red-100">
                                    <i className="bi bi-person text-red-600 text-2xl"></i>
                                </div>
                            )}
                        </div>
                        <div>
                            {user?.displayName && (
                                <h2 className="text-xl font-semibold text-gray-900">{user.displayName}</h2>
                            )}
                            <p className="text-gray-500">{user?.email}</p>
                            <p className="text-sm text-gray-400 mt-1">
                                {businesses.length} {businesses.length === 1 ? 'tienda' : 'tiendas'} registradas
                            </p>
                        </div>
                    </div>
                </div>

                {/* Sección de acceso */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-8">
                    <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
                        <div className="max-w-xl">
                            <div className="flex items-center gap-3 mb-2">
                                <div className="w-10 h-10 rounded-lg bg-red-50 text-red-600 flex items-center justify-center">
                                    <i className="bi bi-shield-lock text-xl"></i>
                                </div>
                                <div>
                                    <h2 className="text-lg font-semibold text-gray-900">Ingreso con contrasena</h2>
                                    <p className="text-sm text-gray-500">Vincula tu cuenta para entrar tambien con correo o celular.</p>
                                </div>
                            </div>
                            <p className="text-sm text-gray-500 mt-3">
                                El celular sera el WhatsApp registrado en tu tienda. Si el mismo celular esta en varias tiendas, usa el correo para iniciar sesion.
                            </p>
                        </div>

                        <form onSubmit={handlePasswordLink} className="w-full lg:max-w-sm space-y-4">
                            {passwordMessage && (
                                <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
                                    {passwordMessage}
                                </div>
                            )}
                            {passwordError && (
                                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                                    {passwordError}
                                </div>
                            )}

                            <div>
                                <label htmlFor="new-password" className="block text-sm font-medium text-gray-700 mb-2">
                                    Nueva contrasena
                                </label>
                                <input
                                    id="new-password"
                                    type="password"
                                    value={passwordForm.password}
                                    onChange={(event) => setPasswordForm(prev => ({ ...prev, password: event.target.value }))}
                                    className="w-full rounded-lg border border-gray-300 px-4 py-3 text-gray-900 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-100"
                                    minLength={6}
                                    autoComplete="new-password"
                                    required
                                />
                            </div>

                            <div>
                                <label htmlFor="confirm-password" className="block text-sm font-medium text-gray-700 mb-2">
                                    Confirmar contrasena
                                </label>
                                <input
                                    id="confirm-password"
                                    type="password"
                                    value={passwordForm.confirmPassword}
                                    onChange={(event) => setPasswordForm(prev => ({ ...prev, confirmPassword: event.target.value }))}
                                    className="w-full rounded-lg border border-gray-300 px-4 py-3 text-gray-900 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-100"
                                    minLength={6}
                                    autoComplete="new-password"
                                    required
                                />
                            </div>

                            <button
                                type="submit"
                                disabled={passwordLoading}
                                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {passwordLoading ? (
                                    <>
                                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                        Guardando...
                                    </>
                                ) : (
                                    <>
                                        <i className="bi bi-key"></i>
                                        Activar o actualizar
                                    </>
                                )}
                            </button>
                        </form>
                    </div>
                </div>

                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-lg font-semibold text-gray-900">
                        <i className="bi bi-shop me-2"></i>
                        Mis Tiendas
                    </h2>
                    <button
                        onClick={() => router.push('/business/register')}
                        className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
                    >
                        <i className="bi bi-plus-lg"></i>
                        Nueva Tienda
                    </button>
                </div>

                {businesses.length === 0 ? (
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
                        <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <i className="bi bi-shop text-gray-400 text-3xl"></i>
                        </div>
                        <h3 className="text-lg font-medium text-gray-900 mb-2">No tienes tiendas</h3>
                        <p className="text-gray-500 mb-6">Crea tu primera tienda para empezar a vender</p>
                        <button
                            onClick={() => router.push('/business/register')}
                            className="inline-flex items-center gap-2 px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
                        >
                            <i className="bi bi-plus-lg"></i>
                            Crear mi primera tienda
                        </button>
                    </div>
                ) : (
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {businesses.map((business) => (
                            <div
                                key={business.id}
                                className={`bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden transition-all ${business.isHidden ? 'opacity-60' : ''
                                    }`}
                            >
                                {/* Imagen de portada */}
                                <div className="h-32 bg-gray-100 relative">
                                    {business.coverImage ? (
                                        <img
                                            src={business.coverImage}
                                            alt={business.name}
                                            className="w-full h-full object-cover"
                                        />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-red-100 to-red-200">
                                            <i className="bi bi-shop text-red-300 text-4xl"></i>
                                        </div>
                                    )}

                                    {/* Badge de estado */}
                                    {business.isHidden && (
                                        <div className="absolute top-3 right-3 bg-yellow-500 text-white px-2 py-1 rounded-full text-xs font-medium flex items-center gap-1">
                                            <i className="bi bi-eye-slash"></i>
                                            Oculta
                                        </div>
                                    )}
                                </div>

                                {/* Info de la tienda */}
                                <div className="p-4">
                                    <div className="flex items-start gap-3 mb-3">
                                        <div className="w-12 h-12 rounded-full overflow-hidden bg-gray-200 flex-shrink-0 border-2 border-white shadow -mt-8">
                                            {business.image ? (
                                                <img
                                                    src={business.image}
                                                    alt={business.name}
                                                    className="w-full h-full object-cover"
                                                />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center bg-red-100">
                                                    <i className="bi bi-shop text-red-600"></i>
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0 pt-1">
                                            <h3 className="font-semibold text-gray-900 truncate">{business.name}</h3>
                                            <p className="text-sm text-gray-500">@{business.username}</p>
                                        </div>
                                    </div>

                                    {business.description && (
                                        <p className="text-sm text-gray-600 mb-4 line-clamp-2">
                                            {business.description}
                                        </p>
                                    )}

                                    {/* Acciones */}
                                    <div className="flex gap-2 pt-3 border-t border-gray-100">
                                        <a
                                            href={`/business/dashboard`}
                                            onClick={() => localStorage.setItem('businessId', business.id)}
                                            className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors text-sm font-medium"
                                        >
                                            <i className="bi bi-speedometer2"></i>
                                            Dashboard
                                        </a>
                                        <button
                                            onClick={() => handleToggleVisibility(business.id, !!business.isHidden)}
                                            disabled={actionLoading === business.id}
                                            className={`px-3 py-2 rounded-lg transition-colors text-sm ${business.isHidden
                                                ? 'bg-green-50 text-green-600 hover:bg-green-100'
                                                : 'bg-yellow-50 text-yellow-600 hover:bg-yellow-100'
                                                }`}
                                            title={business.isHidden ? 'Mostrar tienda' : 'Ocultar tienda'}
                                        >
                                            {actionLoading === business.id ? (
                                                <i className="bi bi-hourglass-split animate-spin"></i>
                                            ) : (
                                                <i className={`bi ${business.isHidden ? 'bi-eye' : 'bi-eye-slash'}`}></i>
                                            )}
                                        </button>
                                        <button
                                            onClick={() => setShowDeleteModal(business.id)}
                                            disabled={actionLoading === business.id}
                                            className="px-3 py-2 bg-gray-50 text-gray-500 rounded-lg hover:bg-red-50 hover:text-red-600 transition-colors text-sm"
                                            title="Eliminar tienda"
                                        >
                                            <i className="bi bi-trash"></i>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </main>

            {/* Modal de confirmación para eliminar */}
            {showDeleteModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-xl shadow-xl max-w-sm w-full overflow-hidden">
                        <div className="p-6 text-center">
                            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                                <i className="bi bi-exclamation-triangle text-red-600 text-3xl"></i>
                            </div>
                            <h3 className="text-lg font-semibold text-gray-900 mb-2">
                                ¿Eliminar tienda?
                            </h3>
                            <p className="text-gray-500 text-sm">
                                Esta acción no se puede deshacer. Se eliminarán todos los productos, órdenes y datos asociados a esta tienda.
                            </p>
                        </div>

                        <div className="p-4 bg-gray-50 border-t border-gray-200 flex gap-3">
                            <button
                                onClick={() => setShowDeleteModal(null)}
                                className="flex-1 px-4 py-3 border border-gray-200 rounded-lg text-gray-700 hover:bg-gray-100 transition-colors font-medium"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={() => handleDeleteBusiness(showDeleteModal)}
                                disabled={actionLoading === showDeleteModal}
                                className="flex-1 px-4 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                {actionLoading === showDeleteModal ? (
                                    <>
                                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                        Eliminando...
                                    </>
                                ) : (
                                    <>
                                        <i className="bi bi-trash"></i>
                                        Eliminar
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
