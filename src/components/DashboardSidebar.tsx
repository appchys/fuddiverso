'use client'

import React from 'react'

interface DashboardSidebarProps {
    sidebarOpen: boolean
    setSidebarOpen: (open: boolean) => void
    activeTab: 'orders' | 'profile' | 'admins' | 'reports' | 'inventory' | 'qrcodes'
    setActiveTab: (tab: 'orders' | 'profile' | 'admins' | 'reports' | 'inventory' | 'qrcodes') => void
    profileSubTab: 'general' | 'products' | 'fidelizacion' | 'notifications'
    setProfileSubTab: (tab: 'general' | 'products' | 'fidelizacion' | 'notifications') => void
    reportsSubTab: 'general' | 'deliveries' | 'costs'
    setReportsSubTab: (tab: 'general' | 'deliveries' | 'costs') => void
    isTiendaMenuOpen: boolean
    setIsTiendaMenuOpen: (open: boolean) => void
    isReportsMenuOpen: boolean
    setIsReportsMenuOpen: (open: boolean) => void
    ordersCount: number
    isIOS: boolean
    needsUserAction: boolean
    requestPermission: () => void
    // User info
    user: {
        email?: string | null
        photoURL?: string | null
        displayName?: string | null
    } | null
    onLogout: () => void
}

export default function DashboardSidebar({
    sidebarOpen,
    setSidebarOpen,
    activeTab,
    setActiveTab,
    profileSubTab,
    setProfileSubTab,
    reportsSubTab,
    setReportsSubTab,
    isTiendaMenuOpen,
    setIsTiendaMenuOpen,
    isReportsMenuOpen,
    setIsReportsMenuOpen,
    ordersCount,
    isIOS,
    needsUserAction,
    requestPermission,
    user,
    onLogout
}: DashboardSidebarProps) {
    return (
        <div className={`
      w-64 bg-white shadow-sm border-r border-gray-200 fixed h-full overflow-y-auto z-50 transition-transform duration-300 ease-in-out flex flex-col
      ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
    `}>
            <div className="p-4 flex-1">
                {/* Header del sidebar */}
                <div className="flex justify-between items-center mb-4">
                    <span className="font-semibold text-gray-900">Menú</span>
                    <button
                        onClick={() => setSidebarOpen(false)}
                        className="p-2 rounded-lg text-gray-600 hover:bg-gray-100"
                    >
                        <i className="bi bi-x-lg"></i>
                    </button>
                </div>

                <nav className="space-y-2">
                    <button
                        onClick={() => {
                            setActiveTab('orders')
                            setSidebarOpen(false)
                        }}
                        className={`w-full flex items-center px-4 py-3 text-left rounded-lg transition-colors ${activeTab === 'orders'
                            ? 'bg-red-50 text-red-600 border-l-4 border-red-500'
                            : 'text-gray-700 hover:bg-gray-50'
                            }`}
                    >
                        <i className="bi bi-clipboard-check me-3 text-lg"></i>
                        <span className="font-medium">Pedidos</span>
                        <span className="ml-auto bg-gray-100 text-gray-600 px-2 py-1 rounded-full text-xs">
                            {ordersCount}
                        </span>
                    </button>

                    <div>
                        <button
                            onClick={() => setIsTiendaMenuOpen(!isTiendaMenuOpen)}
                            className={`w-full flex items-center px-4 py-3 text-left rounded-lg transition-colors ${activeTab === 'profile'
                                ? 'bg-red-50 text-red-600'
                                : 'text-gray-700 hover:bg-gray-50'
                                }`}
                        >
                            <i className="bi bi-shop me-3 text-lg"></i>
                            <span className="font-medium">Tienda</span>
                            <i className={`bi bi-chevron-down ml-auto transition-transform ${isTiendaMenuOpen ? 'rotate-180' : ''}`}></i>
                        </button>

                        {(isTiendaMenuOpen || activeTab === 'profile') && (
                            <div className="ml-9 mt-1 space-y-1">
                                {[
                                    { id: 'general', label: 'Generales', icon: 'bi-info-circle' },
                                    { id: 'products', label: 'Productos', icon: 'bi-box-seam' },
                                    { id: 'fidelizacion', label: 'Fidelización', icon: 'bi-gift' },
                                    { id: 'notifications', label: 'Notificaciones', icon: 'bi-bell' }
                                ].map((sub) => (
                                    <button
                                        key={sub.id}
                                        onClick={() => {
                                            setActiveTab('profile')
                                            setProfileSubTab(sub.id as any)
                                            setSidebarOpen(false)
                                        }}
                                        className={`w-full flex items-center px-3 py-2 text-sm rounded-lg transition-colors ${activeTab === 'profile' && profileSubTab === sub.id
                                            ? 'text-red-600 bg-red-50 font-bold'
                                            : 'text-gray-600 hover:bg-gray-50'
                                            }`}
                                    >
                                        <i className={`bi ${sub.icon} me-2`}></i>
                                        {sub.label}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    <button
                        onClick={() => {
                            setActiveTab('admins')
                            setSidebarOpen(false)
                        }}
                        className={`w-full flex items-center px-4 py-3 text-left rounded-lg transition-colors ${activeTab === 'admins'
                            ? 'bg-red-50 text-red-600 border-l-4 border-red-500'
                            : 'text-gray-700 hover:bg-gray-50'
                            }`}
                    >
                        <i className="bi bi-people me-3 text-lg"></i>
                        <span className="font-medium">Administradores</span>
                    </button>

                    <div>
                        <button
                            onClick={() => setIsReportsMenuOpen(!isReportsMenuOpen)}
                            className={`w-full flex items-center px-4 py-3 text-left rounded-lg transition-colors ${activeTab === 'reports'
                                ? 'bg-red-50 text-red-600'
                                : 'text-gray-700 hover:bg-gray-50'
                                }`}
                        >
                            <i className="bi bi-graph-up me-3 text-lg"></i>
                            <span className="font-medium">Reportes</span>
                            <i className={`bi bi-chevron-down ml-auto transition-transform ${isReportsMenuOpen ? 'rotate-180' : ''}`}></i>
                        </button>

                        {(isReportsMenuOpen || activeTab === 'reports') && (
                            <div className="ml-9 mt-1 space-y-1">
                                {[
                                    { id: 'general', label: 'General', icon: 'bi-graph-up' },
                                    { id: 'deliveries', label: 'Por delivery', icon: 'bi-truck' },
                                    { id: 'costs', label: 'Costos e ingredientes', icon: 'bi-basket' }
                                ].map((sub) => (
                                    <button
                                        key={sub.id}
                                        onClick={() => {
                                            setActiveTab('reports')
                                            setReportsSubTab(sub.id as any)
                                            setSidebarOpen(false)
                                        }}
                                        className={`w-full flex items-center px-3 py-2 text-sm rounded-lg transition-colors ${activeTab === 'reports' && reportsSubTab === sub.id
                                            ? 'text-red-600 bg-red-50 font-bold'
                                            : 'text-gray-600 hover:bg-gray-50'
                                            }`}
                                    >
                                        <i className={`bi ${sub.icon} me-2`}></i>
                                        {sub.label}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    <button
                        onClick={() => {
                            setActiveTab('inventory')
                            setSidebarOpen(false)
                        }}
                        className={`w-full flex items-center px-4 py-3 text-left rounded-lg transition-colors ${activeTab === 'inventory'
                            ? 'bg-red-50 text-red-600 border-l-4 border-red-500'
                            : 'text-gray-700 hover:bg-gray-50'
                            }`}
                    >
                        <i className="bi bi-box-seam me-3 text-lg"></i>
                        <span className="font-medium">Inventario / Stock</span>
                    </button>

                    <button
                        onClick={() => {
                            setActiveTab('qrcodes')
                            setSidebarOpen(false)
                        }}
                        className={`w-full flex items-center px-4 py-3 text-left rounded-lg transition-colors ${activeTab === 'qrcodes'
                            ? 'bg-red-50 text-red-600 border-l-4 border-red-500'
                            : 'text-gray-700 hover:bg-gray-50'
                            }`}
                    >
                        <i className="bi bi-qr-code me-3 text-lg"></i>
                        <span className="font-medium">Códigos QR</span>
                    </button>

                    {/* Botón de Notificaciones - solo si no es iOS y necesita acción */}
                    {!isIOS && needsUserAction && (
                        <button
                            onClick={requestPermission}
                            className="w-full flex items-center px-4 py-3 text-left rounded-lg transition-colors bg-blue-50 text-blue-600 hover:bg-blue-100 border-l-4 border-blue-500"
                        >
                            <i className="bi bi-bell me-3 text-lg"></i>
                            <span className="font-medium">Activar Notificaciones</span>
                        </button>
                    )}
                </nav>
            </div>

            {/* Sección de usuario en la parte inferior */}
            {user && (
                <div className="p-4 border-t border-gray-200 bg-gray-50">
                    <div className="flex items-center gap-3 mb-3">
                        {/* Foto de perfil */}
                        <div className="w-10 h-10 rounded-full overflow-hidden bg-gray-200 flex-shrink-0">
                            {user.photoURL ? (
                                <img
                                    src={user.photoURL}
                                    alt={user.displayName || 'Usuario'}
                                    className="w-full h-full object-cover"
                                />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center bg-red-100">
                                    <i className="bi bi-person text-red-600 text-lg"></i>
                                </div>
                            )}
                        </div>

                        {/* Info del usuario */}
                        <div className="flex-1 min-w-0">
                            {user.displayName && (
                                <p className="text-sm font-medium text-gray-900 truncate">
                                    {user.displayName}
                                </p>
                            )}
                            <p className="text-xs text-gray-500 truncate">
                                {user.email}
                            </p>
                        </div>
                    </div>

                    {/* Botones de acción */}
                    <div className="flex gap-2">
                        <a
                            href="/business/account"
                            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg text-gray-700 hover:bg-gray-100 transition-colors text-sm font-medium"
                        >
                            <i className="bi bi-person-gear"></i>
                            Mi cuenta
                        </a>
                        <button
                            onClick={onLogout}
                            className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-gray-500 hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors"
                            title="Cerrar sesión"
                        >
                            <i className="bi bi-box-arrow-right"></i>
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}
