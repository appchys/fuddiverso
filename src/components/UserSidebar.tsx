'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'

interface UserSidebarProps {
    isOpen: boolean
    onClose: () => void
    onLogin?: () => void
}

function CartMenuOption({ onClose }: { onClose: () => void }) {
    const [activeCarts, setActiveCarts] = useState<{ [key: string]: any[] }>({})
    const [showCarts, setShowCarts] = useState(false)

    useEffect(() => {
        const loadCarts = () => {
            const cartsData = localStorage.getItem('carts')
            if (cartsData) {
                try {
                    const allCarts = JSON.parse(cartsData)
                    const filteredCarts: { [key: string]: any[] } = {}
                    Object.entries(allCarts).forEach(([businessId, cart]: [string, any]) => {
                        if (Array.isArray(cart) && cart.length > 0) {
                            filteredCarts[businessId] = cart
                        }
                    })
                    setActiveCarts(filteredCarts)
                } catch (e) {
                    console.error('Error parsing carts:', e)
                }
            }
        }

        loadCarts()
        const handleStorageChange = () => loadCarts()
        window.addEventListener('storage', handleStorageChange)
        const interval = setInterval(loadCarts, 1000)

        return () => {
            window.removeEventListener('storage', handleStorageChange)
            clearInterval(interval)
        }
    }, [])

    const activeCartsCount = Object.keys(activeCarts).length
    const totalItems = Object.values(activeCarts).reduce((total, cart) =>
        total + cart.reduce((sum, item) => sum + item.quantity, 0), 0
    )

    const handleDeleteCart = (businessId: string) => {
        try {
            const cartsData = localStorage.getItem('carts')
            if (!cartsData) return
            const allCarts = JSON.parse(cartsData)
            if (allCarts[businessId]) {
                delete allCarts[businessId]
                localStorage.setItem('carts', JSON.stringify(allCarts))
                setActiveCarts(prev => {
                    const copy = { ...prev }
                    delete copy[businessId]
                    return copy
                })
                window.dispatchEvent(new Event('storage'))
            }
        } catch (e) {
            console.error('Error deleting cart:', e)
        }
    }

    return (
        <div className="border-t border-gray-100">
            <button
                onClick={() => setShowCarts(!showCarts)}
                className="w-full text-left px-6 py-4 text-sm font-medium text-gray-700 hover:bg-gray-50 flex items-center justify-between transition-colors"
            >
                <div className="flex items-center">
                    <i className="bi bi-cart3 mr-3 text-lg text-gray-400"></i>
                    Mis Carritos
                </div>
                <div className="flex items-center gap-2">
                    {totalItems > 0 && (
                        <span className="bg-red-500 text-white text-[10px] rounded-full px-2 py-0.5 font-bold">
                            {totalItems}
                        </span>
                    )}
                    <i className={`bi bi-chevron-${showCarts ? 'up' : 'down'} text-xs text-gray-400`}></i>
                </div>
            </button>

            {showCarts && activeCartsCount > 0 && (
                <div className="bg-gray-50/50 border-b border-gray-100">
                    <div className="divide-y divide-gray-100">
                        {Object.entries(activeCarts).map(([businessId, cart]) => {
                            const cartTotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0)
                            const cartItemsCount = cart.reduce((sum, item) => sum + item.quantity, 0)
                            const businessName = cart[0]?.businessName || 'Tienda'
                            const logo = cart[0]?.businessImage || '/default-restaurant-og.svg'

                            return (
                                <div key={businessId} className="p-4 pl-8">
                                    <div className="flex items-center justify-between mb-3">
                                        <div className="flex items-center min-w-0">
                                            <img src={logo} alt={businessName} className="w-8 h-8 rounded-lg object-cover mr-3 border border-gray-100" />
                                            <div className="min-w-0">
                                                <h4 className="font-bold text-gray-900 text-xs truncate">{businessName}</h4>
                                                <p className="text-[10px] text-gray-500">{cartItemsCount} productos</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <span className="text-xs font-bold text-red-500">${cartTotal.toFixed(2)}</span>
                                            <button
                                                onClick={() => handleDeleteCart(businessId)}
                                                className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                                            >
                                                <i className="bi bi-trash text-sm"></i>
                                            </button>
                                        </div>
                                    </div>
                                    <Link
                                        href={`/checkout?businessId=${businessId}`}
                                        className="block w-full text-center text-[10px] font-bold uppercase tracking-wider bg-white border border-gray-200 text-gray-700 py-2 rounded-lg hover:border-gray-900 hover:text-gray-900 transition-all"
                                        onClick={onClose}
                                    >
                                        Finalizar Pedido
                                    </Link>
                                </div>
                            )
                        })}
                    </div>
                </div>
            )}
        </div>
    )
}

export default function UserSidebar({ isOpen, onClose, onLogin }: UserSidebarProps) {
    const { user, logout } = useAuth()
    const router = useRouter()

    const handleLogout = () => {
        logout()
        localStorage.removeItem('loginPhone')
        localStorage.removeItem('clientData')
        onClose()
        router.push('/')
    }

    const getInitials = (name: string) => {
        if (!name) return 'U'
        return name
            .split(' ')
            .filter(Boolean)
            .map(word => word.charAt(0))
            .join('')
            .toUpperCase()
            .slice(0, 2)
    }

    return (
        <div className={`fixed inset-0 z-[60] overflow-hidden ${isOpen ? 'pointer-events-auto' : 'pointer-events-none'}`}>
            {/* Overlay */}
            <div
                className={`absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0'}`}
                onClick={onClose}
            />

            {/* Sidebar Content */}
            <div
                className={`absolute left-0 top-0 h-full w-full sm:w-[350px] bg-white shadow-2xl transform transition-transform duration-300 ease-out ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}
            >
                <div className="h-full flex flex-col bg-gray-50/30">

                    {/* Header del Sidebar */}
                    <div className="bg-white p-6 border-b border-gray-100">
                        <div className="flex items-center justify-between mb-8">
                            <h2 className="text-xl font-black text-gray-900 tracking-tight">Menú</h2>
                            <button
                                onClick={onClose}
                                className="p-2 text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded-full transition-all"
                            >
                                <i className="bi bi-x-lg text-lg"></i>
                            </button>
                        </div>

                        {/* Profile Section */}
                        {user ? (
                            <div className="flex items-center gap-4 bg-gray-50 p-4 rounded-2xl border border-gray-100">
                                <div className="w-14 h-14 rounded-full overflow-hidden bg-orange-500 flex items-center justify-center text-white ring-4 ring-white shadow-sm flex-shrink-0">
                                    {user.photoURL ? (
                                        <img src={user.photoURL} alt={user.nombres} className="w-full h-full object-cover" />
                                    ) : (
                                        <span className="text-xl font-bold">{getInitials(user.nombres || 'U')}</span>
                                    )}
                                </div>
                                <div className="min-w-0">
                                    <p className="font-bold text-gray-900 truncate">{user.nombres}</p>
                                    <p className="text-sm text-gray-500 font-medium">{user.celular}</p>
                                </div>
                            </div>
                        ) : (
                            <div className="bg-gray-50 p-6 rounded-2xl border border-dashed border-gray-200 text-center">
                                <div className="w-16 h-16 rounded-full bg-white mx-auto flex items-center justify-center text-gray-300 mb-3 shadow-sm">
                                    <i className="bi bi-person text-3xl"></i>
                                </div>
                                <p className="text-sm font-bold text-gray-900 mb-1">¡Bienvenido a Fuddi!</p>
                                <p className="text-xs text-gray-500 mb-4">Inicia sesión para ver tu perfil y pedidos.</p>
                                <button
                                    onClick={() => {
                                        onClose()
                                        onLogin?.()
                                    }}
                                    className="w-full py-2.5 bg-gray-900 text-white rounded-xl text-xs font-bold hover:bg-gray-800 transition-all active:scale-95"
                                >
                                    Iniciar Sesión
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Links Section */}
                    <div className="flex-1 overflow-y-auto py-6 space-y-1">
                        <Link
                            href={user ? "/profile" : "#"}
                            onClick={(e) => {
                                if (!user) {
                                    e.preventDefault()
                                    onLogin?.()
                                } else {
                                    onClose()
                                }
                            }}
                            className="flex items-center px-6 py-4 text-gray-700 hover:bg-white hover:text-gray-900 group transition-all border-l-4 border-transparent hover:border-orange-500"
                        >
                            <i className="bi bi-person-circle mr-4 text-xl text-gray-400 group-hover:text-orange-500 transition-colors"></i>
                            <span className="font-semibold">Mi Perfil</span>
                            {!user && <span className="ml-auto text-[8px] bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded uppercase font-bold tracking-tighter">Login</span>}
                        </Link>

                        <Link
                            href={user ? "/my-orders" : "#"}
                            onClick={(e) => {
                                if (!user) {
                                    e.preventDefault()
                                    onLogin?.()
                                } else {
                                    onClose()
                                }
                            }}
                            className="flex items-center px-6 py-4 text-gray-700 hover:bg-white hover:text-gray-900 group transition-all border-l-4 border-transparent hover:border-orange-500"
                        >
                            <i className="bi bi-bag-check mr-4 text-xl text-gray-400 group-hover:text-orange-500 transition-colors"></i>
                            <span className="font-semibold">Mis Pedidos</span>
                            {!user && <span className="ml-auto text-[8px] bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded uppercase font-bold tracking-tighter">Login</span>}
                        </Link>

                        <Link
                            href={user ? "/my-locations" : "#"}
                            onClick={(e) => {
                                if (!user) {
                                    e.preventDefault()
                                    onLogin?.()
                                } else {
                                    onClose()
                                }
                            }}
                            className="flex items-center px-6 py-4 text-gray-700 hover:bg-white hover:text-gray-900 group transition-all border-l-4 border-transparent hover:border-orange-500"
                        >
                            <i className="bi bi-geo-alt mr-4 text-xl text-gray-400 group-hover:text-orange-500 transition-colors"></i>
                            <span className="font-semibold">Mis Ubicaciones</span>
                            {!user && <span className="ml-auto text-[8px] bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded uppercase font-bold tracking-tighter">Login</span>}
                        </Link>

                        <Link
                            href={user ? "/collection" : "#"}
                            onClick={(e) => {
                                if (!user) {
                                    e.preventDefault()
                                    onLogin?.()
                                } else {
                                    onClose()
                                }
                            }}
                            className="flex items-center px-6 py-4 text-gray-700 hover:bg-white hover:text-gray-900 group transition-all border-l-4 border-transparent hover:border-orange-500"
                        >
                            <i className="bi bi-grid-1x2 mr-4 text-xl text-gray-400 group-hover:text-orange-500 transition-colors"></i>
                            <span className="font-semibold">Mis Stickers</span>
                            {!user && <span className="ml-auto text-[8px] bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded uppercase font-bold tracking-tighter">Login</span>}
                        </Link>

                        {/* Cart Dropdown Item */}
                        <CartMenuOption onClose={onClose} />
                    </div>

                    {/* Logout/Login Section */}
                    <div className="p-6 bg-white border-t border-gray-100">
                        {user ? (
                            <button
                                onClick={handleLogout}
                                className="w-full flex items-center justify-center gap-3 py-4 rounded-2xl bg-red-50 text-red-600 font-bold hover:bg-red-100 transition-all border border-red-100"
                            >
                                <i className="bi bi-box-arrow-right text-lg"></i>
                                Cerrar Sesión
                            </button>
                        ) : (
                            <button
                                onClick={() => {
                                    onClose()
                                    onLogin?.()
                                }}
                                className="w-full flex items-center justify-center gap-3 py-4 rounded-2xl bg-gray-900 text-white font-bold hover:bg-gray-800 transition-all shadow-lg shadow-gray-200"
                            >
                                <i className="bi bi-person-fill"></i>
                                Iniciar Sesión / Registrarse
                            </button>
                        )}
                        <p className="text-center text-[10px] text-gray-400 mt-6 font-bold uppercase tracking-widest">
                            v1.5.0 • Fuddi
                        </p>
                    </div>
                </div>
            </div>
        </div>
    )
}
