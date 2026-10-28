'use client'

import { useDeliveryAuth } from '@/contexts/DeliveryAuthContext'
import { useDeliveryUI } from '@/contexts/DeliveryUIContext'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect } from 'react'

export default function DeliverySidebar() {
  const { user, logout, isAuthenticated } = useDeliveryAuth()
  const { isSidebarOpen, closeSidebar, activeAssignedOrdersCount } = useDeliveryUI()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const currentView = searchParams?.get('view') || 'orders'
  const isMapActive = pathname === '/delivery/dashboard' && currentView === 'map'
  const isOrdersActive = pathname === '/delivery/dashboard' && currentView !== 'map'

  // Cerrar el drawer con la tecla Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isSidebarOpen) {
        closeSidebar()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isSidebarOpen, closeSidebar])

  // Bloquear scroll del body cuando el sidebar esté abierto
  useEffect(() => {
    if (isSidebarOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isSidebarOpen])

  if (!isAuthenticated || pathname === '/delivery/login') return null

  return (
    <>
      {/* Backdrop oscuro */}
      <div
        className={`fixed inset-0 bg-black/60 backdrop-blur-sm z-50 transition-opacity duration-300 ${
          isSidebarOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={closeSidebar}
        aria-hidden="true"
      />

      {/* Drawer lateral */}
      <aside
        className={`fixed top-0 left-0 bottom-0 w-80 max-w-[85vw] bg-white z-50 shadow-2xl flex flex-col transition-transform duration-300 ease-out transform ${
          isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-label="Menú lateral de repartidor"
      >
        {/* Cabecera del Sidebar */}
        <div className="p-5 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-blue-50/50 via-white to-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-md shadow-blue-500/20">
              <i className="bi bi-bicycle text-xl"></i>
            </div>
            <div>
              <h2 className="text-base font-black text-gray-900 tracking-tight leading-tight">
                Fuddi <span className="text-blue-600">Delivery</span>
              </h2>
              <p className="text-[11px] font-medium text-gray-500">Panel del Repartidor</p>
            </div>
          </div>
          <button
            onClick={closeSidebar}
            className="w-9 h-9 rounded-xl flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            title="Cerrar menú"
            aria-label="Cerrar menú"
          >
            <i className="bi bi-x-lg text-lg"></i>
          </button>
        </div>

        {/* Tarjeta del Repartidor */}
        <div className="p-4 mx-4 mt-4 rounded-2xl bg-gradient-to-br from-gray-50 to-blue-50/30 border border-gray-100 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full border-2 border-blue-200 p-0.5 overflow-hidden shadow-sm flex-shrink-0 bg-white">
              {user?.photoURL ? (
                <img
                  src={user.photoURL}
                  alt={user.displayName || 'Repartidor'}
                  className="w-full h-full rounded-full object-cover"
                />
              ) : (
                <div className="w-full h-full rounded-full bg-blue-600 flex items-center justify-center text-white text-base font-black">
                  {user?.displayName?.charAt(0) || 'R'}
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-black text-gray-900 truncate tracking-tight">
                {user?.displayName || 'Repartidor'}
              </p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                <span className="text-[11px] font-semibold text-emerald-700">En servicio</span>
              </div>
            </div>
          </div>
        </div>

        {/* Enlaces de Navegación */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
          <p className="px-3 text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">
            Vistas principales
          </p>

          {/* Opción 1: Lista de Pedidos */}
          <Link
            href="/delivery/dashboard"
            onClick={closeSidebar}
            className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl font-medium transition-all text-sm ${
              isOrdersActive
                ? 'bg-blue-600 text-white shadow-md shadow-blue-500/25 font-bold'
                : 'text-gray-700 hover:bg-gray-100/80 active:bg-gray-100'
            }`}
          >
            <div className="flex items-center gap-3">
              <i className={`bi bi-box-seam text-lg ${isOrdersActive ? 'text-white' : 'text-blue-600'}`}></i>
              <span className="tracking-tight">Lista de Pedidos</span>
            </div>
            <i className={`bi bi-chevron-right text-xs ${isOrdersActive ? 'text-blue-200' : 'text-gray-400'}`}></i>
          </Link>

          {/* Opción 2: Mapa de pedidos asignados (Solicitud explícita del usuario) */}
          <Link
            href="/delivery/dashboard?view=map"
            onClick={closeSidebar}
            className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl font-medium transition-all text-sm ${
              isMapActive
                ? 'bg-blue-600 text-white shadow-md shadow-blue-500/25 font-bold'
                : 'text-gray-700 hover:bg-gray-100/80 active:bg-gray-100'
            }`}
          >
            <div className="flex items-center gap-3">
              <i className={`bi bi-geo-alt-fill text-lg ${isMapActive ? 'text-white' : 'text-rose-500'}`}></i>
              <span className="tracking-tight">Mapa de pedidos asignados</span>
            </div>
            {activeAssignedOrdersCount > 0 && (
              <span
                className={`px-2 py-0.5 rounded-full text-xs font-black ${
                  isMapActive ? 'bg-white text-blue-600' : 'bg-rose-500 text-white shadow-sm'
                }`}
              >
                {activeAssignedOrdersCount}
              </span>
            )}
          </Link>
        </div>

        {/* Footer del Sidebar con botón de Cerrar sesión */}
        <div className="p-4 border-t border-gray-100 bg-gray-50/50">
          <button
            onClick={() => {
              closeSidebar()
              logout()
            }}
            className="w-full flex items-center justify-center gap-2.5 px-4 py-3 rounded-xl text-sm font-bold text-red-600 hover:bg-red-50 hover:text-red-700 transition-colors border border-red-100 active:scale-[0.99]"
          >
            <i className="bi bi-box-arrow-right text-base"></i>
            <span>Cerrar sesión</span>
          </button>
        </div>
      </aside>
    </>
  )
}
