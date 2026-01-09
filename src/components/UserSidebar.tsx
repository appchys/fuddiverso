'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { searchClientByPhone, createClient, updateClient, getClientLocations } from '@/lib/database'
import { normalizeEcuadorianPhone, validateEcuadorianPhone } from '@/lib/validation'

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
    const { user, logout, login } = useAuth()
    const router = useRouter()

    // Authentication states
    const [customerData, setCustomerData] = useState({ name: '', phone: '' })
    const [clientFound, setClientFound] = useState<any>(null)
    const [clientSearching, setClientSearching] = useState(false)
    const [showNameField, setShowNameField] = useState(false)
    const [loginPin, setLoginPin] = useState('')
    const [loginPinLoading, setLoginPinLoading] = useState(false)
    const [loginPinError, setLoginPinError] = useState('')
    const [registerPin, setRegisterPin] = useState('')
    const [registerPinConfirm, setRegisterPinConfirm] = useState('')
    const [registerLoading, setRegisterLoading] = useState(false)
    const [registerError, setRegisterError] = useState('')
    const [pinAttempted, setPinAttempted] = useState(false)
const [showAuthForm, setShowAuthForm] = useState(false)

    // Phone search function
    async function handlePhoneSearch(phone: string) {
        const normalizedPhone = normalizeEcuadorianPhone(phone);
        
        if (!validateEcuadorianPhone(normalizedPhone)) {
            setClientFound(null);
            setShowNameField(false);
            return;
        }

        setClientSearching(true);
        try {
            const client = await searchClientByPhone(normalizedPhone);
            if (client) {
                setClientFound(client);
                setCustomerData(prev => ({
                    ...prev,
                    name: client.pinHash ? (client.nombres || '') : '',
                    phone: normalizedPhone
                }));
                setShowNameField(!client.pinHash);
            } else {
                setClientFound(null);
                setShowNameField(true);
                setCustomerData(prev => ({
                    ...prev,
                    name: '',
                    phone: normalizedPhone
                }));
            }
        } catch (error) {
            console.error('Error searching client:', error);
            setClientFound(null);
            setShowNameField(true);
        } finally {
            setClientSearching(false);
        }
    }

    // PIN hash function
    async function hashPin(pin: string): Promise<string> {
        const simpleHash = (str: string): string => {
            let hash = 0
            for (let i = 0; i < str.length; i++) {
                const char = str.charCodeAt(i)
                hash = ((hash << 5) - hash) + char
                hash = hash & hash
            }
            return Math.abs(hash).toString(16).padStart(8, '0')
        }

        try {
            if (typeof window !== 'undefined' && window.crypto?.subtle?.digest) {
                if (clientFound?.pinHash?.length === 64) {
                    const encoder = new TextEncoder()
                    const data = encoder.encode(pin)
                    const hashBuffer = await window.crypto.subtle.digest('SHA-256', data)
                    const hashArray = Array.from(new Uint8Array(hashBuffer))
                    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
                }
            }
        } catch (e) {
            console.warn('Error using Web Crypto API, using simple hash', e)
        }

        return simpleHash(pin)
    }

    // Login with PIN
    const handleLoginWithPin = async () => {
        setLoginPinError('')
        setPinAttempted(true)
        
        if (!clientFound) return
        if (!/^[0-9]{4,6}$/.test(loginPin)) {
            setLoginPinError('PIN inválido')
            return
        }
        
        setLoginPinLoading(true)
        try {
            const pinHash = await hashPin(loginPin)
            if (pinHash === clientFound.pinHash) {
                login(clientFound as any)
                setCustomerData(prev => ({ 
                    ...prev, 
                    name: clientFound.nombres || '', 
                    phone: normalizeEcuadorianPhone(prev.phone) 
                }))
                setShowNameField(false)
                setLoginPin('')
                setShowAuthForm(false)
            } else {
                setLoginPinError('PIN incorrecto')
            }
        } catch (error) {
            console.error('Error validating PIN:', error)
            setLoginPinError('Error al verificar PIN')
        } finally {
            setLoginPinLoading(false)
        }
    }

    // Register or set PIN
    const handleRegisterOrSetPin = async () => {
        setRegisterError('')
        const requireName = !clientFound || (clientFound && !clientFound.pinHash)
        if (requireName && (!customerData.name || !customerData.name.trim())) {
            setRegisterError('Ingresa tu nombre')
            return
        }
        if (!/^[0-9]{4,6}$/.test(registerPin)) {
            setRegisterError('El PIN debe contener entre 4 y 6 dígitos')
            return
        }
        if (registerPin !== registerPinConfirm) {
            setRegisterError('Los PIN no coinciden')
            return
        }

        setRegisterLoading(true)
        try {
            const pinHash = await hashPin(registerPin)
            const normalizedPhone = normalizeEcuadorianPhone(customerData.phone)

            if (clientFound && clientFound.id) {
                await updateClient(clientFound.id, { 
                    nombres: customerData.name.trim(),
                    pinHash 
                })
                const updatedClient = { ...clientFound, nombres: customerData.name.trim(), pinHash }
                login(updatedClient as any)
            } else {
                const newClient = await createClient({
                    celular: normalizedPhone,
                    nombres: customerData.name,
                    pinHash,
                    fecha_de_registro: new Date().toISOString()
                })
                login(newClient as any)
            }

            setShowAuthForm(false)
            setRegisterPin('')
            setRegisterPinConfirm('')
        } catch (error) {
            console.error('Error in registration:', error)
            setRegisterError('Error al procesar registro')
        } finally {
            setRegisterLoading(false)
        }
    }

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
                            <div className="bg-gray-50 p-6 rounded-2xl border border-dashed border-gray-200">
                                {!showAuthForm ? (
                                    <div className="text-center">
                                        <div className="w-16 h-16 rounded-full bg-white mx-auto flex items-center justify-center text-gray-300 mb-3 shadow-sm">
                                            <i className="bi bi-person text-3xl"></i>
                                        </div>
                                        <p className="text-sm font-bold text-gray-900 mb-1">¡Bienvenido a Fuddi!</p>
                                        <p className="text-xs text-gray-500 mb-4">Inicia sesión para ver tu perfil y pedidos.</p>
                                        <button
                                            onClick={() => setShowAuthForm(true)}
                                            className="w-full py-2.5 bg-gray-900 text-white rounded-xl text-xs font-bold hover:bg-gray-800 transition-all active:scale-95"
                                        >
                                            Iniciar Sesión
                                        </button>
                                        <div className="mt-4 pt-4 border-t border-gray-200">
                                            <p className="text-xs text-gray-600 mb-2">¿Tienes un negocio?</p>
                                            <Link
                                                href="/business/dashboard"
                                                onClick={onClose}
                                                className="block w-full py-2 bg-orange-500 text-white rounded-xl text-xs font-bold hover:bg-orange-600 transition-all active:scale-95"
                                            >
                                                Regístrate aquí
                                            </Link>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        <div className="text-center mb-4">
                                            <p className="text-sm font-bold text-gray-900">Iniciar Sesión</p>
                                        </div>
                                        
                                        {/* Phone Input */}
                                        <div>
                                            <label className="block text-xs font-medium text-gray-700 mb-2">
                                                Teléfono *
                                            </label>
                                            <input
                                                type="tel"
                                                value={customerData.phone}
                                                onChange={(e) => {
                                                    const phone = e.target.value;
                                                    setCustomerData({ ...customerData, phone });
                                                    handlePhoneSearch(phone);
                                                }}
                                                onBlur={(e) => {
                                                    const phone = e.target.value;
                                                    const normalizedPhone = normalizeEcuadorianPhone(phone);
                                                    if (validateEcuadorianPhone(normalizedPhone)) {
                                                        setCustomerData({ ...customerData, phone: normalizedPhone });
                                                    }
                                                }}
                                                placeholder="0987654321"
                                                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                                            />
                                        </div>

                                        {/* Client Search Loading */}
                                        {clientSearching && (
                                            <div className="text-center py-2">
                                                <i className="bi bi-hourglass-split text-gray-400 animate-spin"></i>
                                                <p className="text-xs text-gray-500 mt-1">Buscando cliente...</p>
                                            </div>
                                        )}

                                        {/* Existing Client with PIN */}
                                        {!clientSearching && clientFound && clientFound.pinHash && (
                                            <div className="space-y-3">
                                                <p className="text-xs text-gray-700">
                                                    Hola <strong>{clientFound.nombres || clientFound.celular}</strong>
                                                </p>
                                                <div>
                                                    <label className="block text-xs font-medium text-gray-700 mb-2">
                                                        Ingresa tu PIN
                                                    </label>
                                                    <input
                                                        type="password"
                                                        value={loginPin}
                                                        onChange={(e) => setLoginPin(e.target.value)}
                                                        maxLength={6}
                                                        placeholder="••••"
                                                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                                                        onKeyPress={(e) => e.key === 'Enter' && handleLoginWithPin()}
                                                    />
                                                    {loginPinError && (
                                                        <p className="text-xs text-red-500 mt-1">{loginPinError}</p>
                                                    )}
                                                </div>
                                                <button
                                                    onClick={handleLoginWithPin}
                                                    disabled={loginPinLoading || !loginPin}
                                                    className="w-full py-2 bg-gray-900 text-white rounded-lg text-xs font-bold hover:bg-gray-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                                >
                                                    {loginPinLoading ? 'Verificando...' : 'Iniciar sesión'}
                                                </button>
                                            </div>
                                        )}

                                        {/* Existing Client without PIN or New Client */}
                                        {!clientSearching && ((clientFound && !clientFound.pinHash) || (!clientFound && customerData.phone.trim())) && (
                                            <div className="space-y-3">
                                                <div>
                                                    <label className="block text-xs font-medium text-gray-700 mb-2">
                                                        Nombre Completo *
                                                    </label>
                                                    <input
                                                        type="text"
                                                        value={customerData.name}
                                                        onChange={(e) => setCustomerData({ ...customerData, name: e.target.value })}
                                                        placeholder="Tu nombre"
                                                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-medium text-gray-700 mb-2">
                                                        Crea un PIN (4-6 dígitos)
                                                    </label>
                                                    <input
                                                        type="password"
                                                        value={registerPin}
                                                        onChange={(e) => setRegisterPin(e.target.value)}
                                                        maxLength={6}
                                                        placeholder="••••"
                                                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-medium text-gray-700 mb-2">
                                                        Confirmar PIN
                                                    </label>
                                                    <input
                                                        type="password"
                                                        value={registerPinConfirm}
                                                        onChange={(e) => setRegisterPinConfirm(e.target.value)}
                                                        maxLength={6}
                                                        placeholder="••••"
                                                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                                                    />
                                                </div>
                                                {registerError && (
                                                    <p className="text-xs text-red-500">{registerError}</p>
                                                )}
                                                <button
                                                    onClick={handleRegisterOrSetPin}
                                                    disabled={registerLoading || !customerData.name || !registerPin || !registerPinConfirm}
                                                    className="w-full py-2 bg-gray-900 text-white rounded-lg text-xs font-bold hover:bg-gray-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                                >
                                                    {registerLoading ? 'Procesando...' : (clientFound ? 'Guardar PIN' : 'Registrarse')}
                                                </button>
                                            </div>
                                        )}

                                        <button
                                            onClick={() => {
                                                setShowAuthForm(false)
                                                setCustomerData({ name: '', phone: '' })
                                                setClientFound(null)
                                                setShowNameField(false)
                                                setLoginPin('')
                                                setRegisterPin('')
                                                setRegisterPinConfirm('')
                                                setLoginPinError('')
                                                setRegisterError('')
                                            }}
                                            className="w-full py-2 text-xs text-gray-500 hover:text-gray-700 transition-colors"
                                        >
                                            Cancelar
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

{/* Links Section - Only show when user is logged in */}
                    {user && (
                        <div className="flex-1 overflow-y-auto py-6 space-y-1">
                            <Link
                                href="/profile"
                                onClick={onClose}
                                className="flex items-center px-6 py-4 text-gray-700 hover:bg-white hover:text-gray-900 group transition-all border-l-4 border-transparent hover:border-orange-500"
                            >
                                <i className="bi bi-person-circle mr-4 text-xl text-gray-400 group-hover:text-orange-500 transition-colors"></i>
                                <span className="font-semibold">Mi Perfil</span>
                            </Link>

                            <Link
                                href="/my-orders"
                                onClick={onClose}
                                className="flex items-center px-6 py-4 text-gray-700 hover:bg-white hover:text-gray-900 group transition-all border-l-4 border-transparent hover:border-orange-500"
                            >
                                <i className="bi bi-bag-check mr-4 text-xl text-gray-400 group-hover:text-orange-500 transition-colors"></i>
                                <span className="font-semibold">Mis Pedidos</span>
                            </Link>

                            <Link
                                href="/my-locations"
                                onClick={onClose}
                                className="flex items-center px-6 py-4 text-gray-700 hover:bg-white hover:text-gray-900 group transition-all border-l-4 border-transparent hover:border-orange-500"
                            >
                                <i className="bi bi-geo-alt mr-4 text-xl text-gray-400 group-hover:text-orange-500 transition-colors"></i>
                                <span className="font-semibold">Mis Ubicaciones</span>
                            </Link>

                            <Link
                                href="/collection"
                                onClick={onClose}
                                className="flex items-center px-6 py-4 text-gray-700 hover:bg-white hover:text-gray-900 group transition-all border-l-4 border-transparent hover:border-orange-500"
                            >
                                <i className="bi bi-grid-1x2 mr-4 text-xl text-gray-400 group-hover:text-orange-500 transition-colors"></i>
                                <span className="font-semibold">Mis Stickers</span>
                            </Link>

                            {/* Cart Dropdown Item */}
                            <CartMenuOption onClose={onClose} />
                        </div>
                    )}

{/* Logout Section - Only show when user is logged in */}
                    {user && (
                        <div className="p-6 bg-white border-t border-gray-100">
                            <button
                                onClick={handleLogout}
                                className="w-full flex items-center justify-center gap-3 py-4 rounded-2xl bg-red-50 text-red-600 font-bold hover:bg-red-100 transition-all border border-red-100"
                            >
                                <i className="bi bi-box-arrow-right text-lg"></i>
                                Cerrar Sesión
                            </button>
                            <p className="text-center text-[10px] text-gray-400 mt-6 font-bold uppercase tracking-widest">
                                v1.5.0 • Fuddi
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
