'use client'

import React from 'react'

interface DashboardSidebarProps {
    sidebarOpen: boolean
    setSidebarOpen: (open: boolean) => void
    activeTab: 'orders' | 'profile' | 'admins' | 'reports' | 'inventory' | 'qrcodes' | 'stats' | 'wallet' | 'checklist' | 'expenses'
    setActiveTab: (tab: 'orders' | 'profile' | 'admins' | 'reports' | 'inventory' | 'qrcodes' | 'stats' | 'wallet' | 'checklist' | 'expenses') => void
    profileSubTab: 'general' | 'products' | 'fidelizacion' | 'notifications' | 'admins' | 'configuracion' | 'sucursales'
    setProfileSubTab: (tab: 'general' | 'products' | 'fidelizacion' | 'notifications' | 'admins' | 'configuracion' | 'sucursales') => void
    reportsSubTab: 'general' | 'costs'
    setReportsSubTab: (tab: 'general' | 'costs') => void
    isTiendaMenuOpen?: boolean
    setIsTiendaMenuOpen?: (open: boolean) => void
    isReportsMenuOpen: boolean
    setIsReportsMenuOpen: (open: boolean) => void
    ordersCount: number
    isIOS: boolean
    needsUserAction: boolean
    requestPermission: () => void
    ordersSubTab?: 'today' | 'history'
    setOrdersSubTab?: (tab: 'today' | 'history') => void
    user: {
        email?: string | null
        photoURL?: string | null
        displayName?: string | null
    } | null
    onLogout: () => void
    currentBusinessName?: string
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
    isReportsMenuOpen,
    setIsReportsMenuOpen,
    ordersCount,
    isIOS,
    needsUserAction,
    requestPermission,
    user,
    onLogout,
    ordersSubTab = 'today',
    setOrdersSubTab,
    currentBusinessName
}: DashboardSidebarProps) {

    return (
        <aside
            className={`
                w-72 bg-white/95 backdrop-blur-xl border-r border-gray-100 fixed inset-y-0 left-0 h-full z-50 
                transition-transform duration-300 ease-in-out flex flex-col justify-between shadow-xl shadow-gray-200/40 select-none
                ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
            `}
        >
            {/* Header del Sidebar con título Fuddi.shop */}
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <span className="text-2xl font-black tracking-tighter text-red-600 font-sans leading-none">
                    Fuddi<span className="text-gray-900">.shop</span>
                </span>
                <button
                    onClick={() => setSidebarOpen(false)}
                    className="p-1.5 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors lg:hidden"
                    aria-label="Cerrar menú"
                >
                    <i className="bi bi-x-lg text-lg"></i>
                </button>
            </div>

            {/* Navegación Principal Organizada por Secciones (Tema Claro) */}
            <div
                className="flex-1 overflow-y-auto px-4 py-4 space-y-6 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
                style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            >
                {/* SECCIÓN 1: PEDIDOS */}
                <div className="space-y-1">
                    <div className="px-3 pb-2 text-[11px] font-bold text-gray-400 tracking-wider uppercase flex items-center gap-2">
                        <span>Pedidos</span>
                        <div className="h-px bg-gray-100 flex-1"></div>
                    </div>

                    {/* Pedidos de hoy */}
                    <button
                        onClick={() => {
                            setActiveTab('orders')
                            setOrdersSubTab?.('today')
                            setSidebarOpen(false)
                        }}
                        className={`
                            group relative w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-bold transition-all duration-200
                            ${activeTab === 'orders' && ordersSubTab === 'today'
                                ? 'bg-gradient-to-r from-rose-500 to-red-600 text-white shadow-lg shadow-rose-500/25'
                                : 'text-gray-700 hover:bg-rose-50/60 hover:text-rose-600'
                            }
                        `}
                    >
                        <i className={`bi bi-receipt-cutoff text-lg transition-transform group-hover:scale-110 ${
                            activeTab === 'orders' && ordersSubTab === 'today' ? 'text-white' : 'text-gray-400 group-hover:text-rose-500'
                        }`}></i>
                        <span className="tracking-tight flex-1 text-left">Pedidos de hoy</span>
                        <span className={`
                            px-2 py-0.5 text-xs font-bold rounded-full transition-colors
                            ${activeTab === 'orders' && ordersSubTab === 'today'
                                ? 'bg-white/20 text-white'
                                : ordersCount > 0
                                    ? 'bg-rose-100 text-rose-600 border border-rose-200 animate-pulse'
                                    : 'bg-gray-100 text-gray-500'
                            }
                        `}>
                            {ordersCount}
                        </span>
                    </button>

                    {/* Historial de pedidos */}
                    <button
                        onClick={() => {
                            setActiveTab('orders')
                            setOrdersSubTab?.('history')
                            setSidebarOpen(false)
                        }}
                        className={`
                            group relative w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-bold transition-all duration-200
                            ${activeTab === 'orders' && ordersSubTab === 'history'
                                ? 'bg-gradient-to-r from-rose-500 to-red-600 text-white shadow-lg shadow-rose-500/25'
                                : 'text-gray-700 hover:bg-rose-50/60 hover:text-rose-600'
                            }
                        `}
                    >
                        <i className={`bi bi-clock-history text-lg transition-transform group-hover:scale-110 ${
                            activeTab === 'orders' && ordersSubTab === 'history' ? 'text-white' : 'text-gray-400 group-hover:text-rose-500'
                        }`}></i>
                        <span className="tracking-tight text-left">Historial de pedidos</span>
                    </button>
                </div>

                {/* SECCIÓN 2: TIENDA */}
                <div className="space-y-1">
                    <div className="px-3 pb-2 text-[11px] font-bold text-gray-400 tracking-wider uppercase flex items-center gap-2">
                        <span>Tienda</span>
                        <div className="h-px bg-gray-100 flex-1"></div>
                    </div>

                    {/* Productos y menú */}
                    <button
                        onClick={() => {
                            setActiveTab('profile')
                            setProfileSubTab('products')
                            setSidebarOpen(false)
                        }}
                        className={`
                            group relative w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-bold transition-all duration-200
                            ${activeTab === 'profile' && profileSubTab === 'products'
                                ? 'bg-gradient-to-r from-rose-500 to-red-600 text-white shadow-lg shadow-rose-500/25'
                                : 'text-gray-700 hover:bg-rose-50/60 hover:text-rose-600'
                            }
                        `}
                    >
                        <i className={`bi bi-shop text-lg transition-transform group-hover:scale-110 ${
                            activeTab === 'profile' && profileSubTab === 'products' ? 'text-white' : 'text-gray-400 group-hover:text-rose-500'
                        }`}></i>
                        <span className="tracking-tight text-left">Productos y menú</span>
                    </button>

                    {/* Promociones */}
                    <button
                        onClick={() => {
                            setActiveTab('profile')
                            setProfileSubTab('fidelizacion')
                            setSidebarOpen(false)
                        }}
                        className={`
                            group relative w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-bold transition-all duration-200
                            ${activeTab === 'profile' && profileSubTab === 'fidelizacion'
                                ? 'bg-gradient-to-r from-rose-500 to-red-600 text-white shadow-lg shadow-rose-500/25'
                                : 'text-gray-700 hover:bg-rose-50/60 hover:text-rose-600'
                            }
                        `}
                    >
                        <i className={`bi bi-gift text-lg transition-transform group-hover:scale-110 ${
                            activeTab === 'profile' && profileSubTab === 'fidelizacion' ? 'text-white' : 'text-gray-400 group-hover:text-rose-500'
                        }`}></i>
                        <span className="tracking-tight text-left">Promociones</span>
                    </button>

                    {/* Sucursales */}
                    <button
                        onClick={() => {
                            setActiveTab('profile')
                            setProfileSubTab('sucursales')
                            setSidebarOpen(false)
                        }}
                        className={`
                            group relative w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-bold transition-all duration-200
                            ${activeTab === 'profile' && profileSubTab === 'sucursales'
                                ? 'bg-gradient-to-r from-rose-500 to-red-600 text-white shadow-lg shadow-rose-500/25'
                                : 'text-gray-700 hover:bg-rose-50/60 hover:text-rose-600'
                            }
                        `}
                    >
                        <i className={`bi bi-diagram-3 text-lg transition-transform group-hover:scale-110 ${
                            activeTab === 'profile' && profileSubTab === 'sucursales' ? 'text-white' : 'text-gray-400 group-hover:text-rose-500'
                        }`}></i>
                        <span className="tracking-tight text-left">Sucursales</span>
                    </button>
                </div>

                {/* SECCIÓN 3: FINANZAS */}
                <div className="space-y-1">
                    <div className="px-3 pb-2 text-[11px] font-bold text-gray-400 tracking-wider uppercase flex items-center gap-2">
                        <span>Finanzas</span>
                        <div className="h-px bg-gray-100 flex-1"></div>
                    </div>

                    {/* Gastos */}
                    <button
                        onClick={() => {
                            setActiveTab('expenses')
                            setSidebarOpen(false)
                        }}
                        className={`
                            group relative w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-bold transition-all duration-200
                            ${activeTab === 'expenses'
                                ? 'bg-gradient-to-r from-rose-500 to-red-600 text-white shadow-lg shadow-rose-500/25'
                                : 'text-gray-700 hover:bg-rose-50/60 hover:text-rose-600'
                            }
                        `}
                    >
                        <i className={`bi bi-credit-card-2-front text-lg transition-transform group-hover:scale-110 ${
                            activeTab === 'expenses' ? 'text-white' : 'text-gray-400 group-hover:text-rose-500'
                        }`}></i>
                        <span className="tracking-tight text-left">Gastos</span>
                    </button>

                    {/* Saldo */}
                    <button
                        onClick={() => {
                            setActiveTab('wallet')
                            setSidebarOpen(false)
                        }}
                        className={`
                            group relative w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-bold transition-all duration-200
                            ${activeTab === 'wallet'
                                ? 'bg-gradient-to-r from-rose-500 to-red-600 text-white shadow-lg shadow-rose-500/25'
                                : 'text-gray-700 hover:bg-rose-50/60 hover:text-rose-600'
                            }
                        `}
                    >
                        <i className={`bi bi-wallet2 text-lg transition-transform group-hover:scale-110 ${
                            activeTab === 'wallet' ? 'text-white' : 'text-gray-400 group-hover:text-rose-500'
                        }`}></i>
                        <span className="tracking-tight text-left">Saldo</span>
                    </button>

                    {/* Inventario */}
                    <button
                        onClick={() => {
                            setActiveTab('inventory')
                            setSidebarOpen(false)
                        }}
                        className={`
                            group relative w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-bold transition-all duration-200
                            ${activeTab === 'inventory'
                                ? 'bg-gradient-to-r from-rose-500 to-red-600 text-white shadow-lg shadow-rose-500/25'
                                : 'text-gray-700 hover:bg-rose-50/60 hover:text-rose-600'
                            }
                        `}
                    >
                        <i className={`bi bi-boxes text-lg transition-transform group-hover:scale-110 ${
                            activeTab === 'inventory' ? 'text-white' : 'text-gray-400 group-hover:text-rose-500'
                        }`}></i>
                        <span className="tracking-tight text-left">Inventario</span>
                    </button>

                    {/* Estadísticas */}
                    <button
                        onClick={() => {
                            setActiveTab('stats')
                            setSidebarOpen(false)
                        }}
                        className={`
                            group relative w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-bold transition-all duration-200
                            ${activeTab === 'stats'
                                ? 'bg-gradient-to-r from-rose-500 to-red-600 text-white shadow-lg shadow-rose-500/25'
                                : 'text-gray-700 hover:bg-rose-50/60 hover:text-rose-600'
                            }
                        `}
                    >
                        <i className={`bi bi-bar-chart-line text-lg transition-transform group-hover:scale-110 ${
                            activeTab === 'stats' ? 'text-white' : 'text-gray-400 group-hover:text-rose-500'
                        }`}></i>
                        <span className="tracking-tight text-left">Estadísticas</span>
                    </button>
                </div>

                {/* SECCIÓN 4: AJUSTES */}
                <div className="space-y-1">
                    <div className="px-3 pb-2 text-[11px] font-bold text-gray-400 tracking-wider uppercase flex items-center gap-2">
                        <span>Ajustes</span>
                        <div className="h-px bg-gray-100 flex-1"></div>
                    </div>

                    {/* Ajustes de tienda */}
                    <button
                        onClick={() => {
                            setActiveTab('profile')
                            setProfileSubTab('general')
                            setSidebarOpen(false)
                        }}
                        className={`
                            group relative w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-bold transition-all duration-200
                            ${activeTab === 'profile' && profileSubTab === 'general'
                                ? 'bg-gradient-to-r from-rose-500 to-red-600 text-white shadow-lg shadow-rose-500/25'
                                : 'text-gray-700 hover:bg-rose-50/60 hover:text-rose-600'
                            }
                        `}
                    >
                        <i className={`bi bi-shop-window text-lg transition-transform group-hover:scale-110 ${
                            activeTab === 'profile' && profileSubTab === 'general' ? 'text-white' : 'text-gray-400 group-hover:text-rose-500'
                        }`}></i>
                        <span className="tracking-tight text-left">Ajustes de tienda</span>
                    </button>

                    {/* Configuración */}
                    <button
                        onClick={() => {
                            setActiveTab('profile')
                            setProfileSubTab('configuracion')
                            setSidebarOpen(false)
                        }}
                        className={`
                            group relative w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-bold transition-all duration-200
                            ${activeTab === 'profile' && profileSubTab === 'configuracion'
                                ? 'bg-gradient-to-r from-rose-500 to-red-600 text-white shadow-lg shadow-rose-500/25'
                                : 'text-gray-700 hover:bg-rose-50/60 hover:text-rose-600'
                            }
                        `}
                    >
                        <i className={`bi bi-gear text-lg transition-transform group-hover:scale-110 ${
                            activeTab === 'profile' && profileSubTab === 'configuracion' ? 'text-white' : 'text-gray-400 group-hover:text-rose-500'
                        }`}></i>
                        <span className="tracking-tight text-left">Configuración</span>
                    </button>
                </div>

                {/* Notificaciones del dispositivo (si aplica) */}
                {!isIOS && needsUserAction && (
                    <div className="pt-2">
                        <button
                            onClick={requestPermission}
                            className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-bold transition-all bg-gradient-to-r from-blue-50 to-indigo-50 text-blue-600 border border-blue-100 hover:border-blue-300"
                        >
                            <i className="bi bi-bell-fill text-lg text-blue-500"></i>
                            <span className="text-left flex-1">Activar Notificaciones</span>
                        </button>
                    </div>
                )}
            </div>

            {/* Footer con información del Usuario y Acciones (Tema Claro) */}
            {user && (
                <div className="p-4 border-t border-gray-100 bg-gray-50/60 backdrop-blur-md">
                    <div className="flex items-center gap-2">
                        {/* Tarjeta de usuario clicable a Mi Cuenta */}
                        <a
                            href="/business/account"
                            className="flex-1 bg-white rounded-2xl p-3 border border-gray-200/80 shadow-sm hover:border-rose-300 hover:shadow-rose-500/10 transition-all flex items-center gap-3 min-w-0 group"
                        >
                            <div className="w-9 h-9 rounded-full overflow-hidden bg-rose-50 ring-2 ring-rose-500/20 flex-shrink-0 flex items-center justify-center group-hover:ring-rose-500/40 transition-all">
                                {user.photoURL ? (
                                    <img
                                        src={user.photoURL}
                                        alt={user.displayName || 'Usuario'}
                                        className="w-full h-full object-cover"
                                    />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-rose-500 to-red-600 text-white font-bold text-sm">
                                        {(user.email || user.displayName || 'U')[0].toUpperCase()}
                                    </div>
                                )}
                            </div>

                            <div className="flex-1 min-w-0">
                                <p className="text-xs font-bold text-gray-900 truncate group-hover:text-rose-600 transition-colors" title={user.email || ''}>
                                    {user.email || 'Usuario'}
                                </p>
                                <p className="text-[11px] font-medium text-gray-400 group-hover:text-rose-500 transition-colors">
                                    Mi cuenta
                                </p>
                            </div>
                        </a>

                        {/* Botón Cerrar Sesión */}
                        <button
                            onClick={onLogout}
                            className="p-3.5 bg-white hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 border border-gray-200/80 text-gray-400 rounded-2xl flex items-center justify-center transition-all shadow-sm self-stretch"
                            title="Cerrar sesión"
                        >
                            <i className="bi bi-box-arrow-right text-base"></i>
                        </button>
                    </div>
                </div>
            )}
        </aside>
    )
}
