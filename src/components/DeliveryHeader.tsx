'use client'

import { useDeliveryAuth } from '@/contexts/DeliveryAuthContext'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function DeliveryHeader() {
    const { user, logout, isAuthenticated } = useDeliveryAuth()
    const pathname = usePathname()

    // No mostrar nada si no está autenticado o estamos en la página de login
    if (!isAuthenticated || pathname === '/delivery/login') return null

    return (
        <header className="bg-white border-b sticky top-0 left-0 right-0 z-40 h-16 shadow-sm">
            <div className="max-w-5xl mx-auto px-4 h-full flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Link href="/delivery/dashboard" className="flex items-center gap-2">
                        <div className="bg-blue-600 text-white p-2 rounded-lg">
                            <i className="bi bi-bicycle text-xl"></i>
                        </div>
                        <h1 className="text-xl font-bold text-gray-900 tracking-tight">Fuddi <span className="text-blue-600">Delivery</span></h1>
                    </Link>
                </div>

                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-3 pr-4 border-r border-gray-100">
                        <div className="text-right hidden sm:block">
                            <p className="text-sm font-bold text-gray-900 leading-none">{user?.displayName || 'Repartidor'}</p>
                            <p className="text-[10px] text-gray-500 font-medium mt-1">En servicio</p>
                        </div>
                        <div className="w-10 h-10 rounded-full border-2 border-blue-100 p-0.5 overflow-hidden shadow-sm">
                            {user?.photoURL ? (
                                <img src={user.photoURL} alt={user.displayName || 'Repartidor'} className="w-full h-full rounded-full object-cover" />
                            ) : (
                                <div className="w-full h-full rounded-full bg-blue-500 flex items-center justify-center text-white text-xs font-bold">
                                    {user?.displayName?.charAt(0) || 'R'}
                                </div>
                            )}
                        </div>
                    </div>

                    <button
                        onClick={() => logout()}
                        className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                        title="Cerrar sesión"
                    >
                        <i className="bi bi-box-arrow-right text-xl"></i>
                    </button>
                </div>
            </div>
        </header>
    )
}
