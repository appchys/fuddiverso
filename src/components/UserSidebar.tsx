'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import {
    searchClientByPhone, createClient, updateClient, getClientLocations,
    serverTimestamp, createClientLocation, deleteLocation,
    getUserReferrals, getAllUserCredits, getOrdersByClient, getBusiness
} from '@/lib/database'
import { normalizeEcuadorianPhone, validateEcuadorianPhone } from '@/lib/validation'
import LocationSelectionModal from '@/components/LocationSelectionModal'
import OrderSidebar from '@/components/OrderSidebar'
import { ClientLocation } from '@/lib/database'

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
        <div className="space-y-3">
            <button
                onClick={() => setShowCarts(!showCarts)}
                className="w-full flex items-center justify-between p-4 bg-white rounded-2xl shadow-sm border border-gray-100 hover:border-gray-900 group transition-all"
            >
                <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center text-gray-400 group-hover:bg-gray-900 group-hover:text-white transition-all">
                        <i className="bi bi-cart3 text-xl"></i>
                    </div>
                    <span className="font-black text-gray-900">Mis Carritos</span>
                </div>
                <div className="flex items-center gap-3">
                    {totalItems > 0 && (
                        <span className="bg-orange-500 text-white text-[10px] rounded-full px-2 py-0.5 font-black">
                            {totalItems}
                        </span>
                    )}
                    <i className={`bi bi-chevron-${showCarts ? 'up' : 'down'} text-gray-300 group-hover:text-gray-900 transition-colors`}></i>
                </div>
            </button>

            {showCarts && activeCartsCount > 0 && (
                <div className="space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
                    {Object.entries(activeCarts).map(([businessId, cart]) => {
                        const cartTotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0)
                        const cartItemsCount = cart.reduce((sum, item) => sum + item.quantity, 0)
                        const businessName = cart[0]?.businessName || 'Tienda'
                        const logo = cart[0]?.businessImage || '/default-restaurant-og.svg'

                        return (
                            <div key={businessId} className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 ml-4 border-l-4 border-l-gray-900">
                                <div className="flex items-center justify-between mb-4">
                                    <div className="flex items-center min-w-0">
                                        <img src={logo} alt={businessName} className="w-10 h-10 rounded-xl object-cover mr-3 border border-gray-50" />
                                        <div className="min-w-0">
                                            <h4 className="font-black text-gray-900 text-sm truncate leading-tight">{businessName}</h4>
                                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{cartItemsCount} productos</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <span className="text-sm font-black text-orange-500">${cartTotal.toFixed(2)}</span>
                                        <button
                                            onClick={() => handleDeleteCart(businessId)}
                                            className="w-8 h-8 flex items-center justify-center text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                                        >
                                            <i className="bi bi-trash text-sm"></i>
                                        </button>
                                    </div>
                                </div>
                                <Link
                                    href={`/checkout?businessId=${businessId}`}
                                    className="block w-full text-center text-[10px] font-black uppercase tracking-[0.2em] bg-gray-900 text-white py-3 rounded-xl hover:bg-gray-800 transition-all active:scale-[0.98]"
                                    onClick={onClose}
                                >
                                    Finalizar Pedido
                                </Link>
                            </div>
                        )
                    })}
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
    const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number } | null>(null)
    const [savedLocation, setSavedLocation] = useState<{ referencia: string; lat: number; lng: number } | null>(null)

    const [userLocations, setUserLocations] = useState<any[]>([])
    const [activeOrders, setActiveOrders] = useState<any[]>([])
    const [loadingOrders, setLoadingOrders] = useState(false)

    const [orderSidebarOpen, setOrderSidebarOpen] = useState(false)
    const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null)


    // Modal states
    const [isLocationModalOpen, setIsLocationModalOpen] = useState(false)
    const [isAddingNewLocation, setIsAddingNewLocation] = useState(false)


    // Capturar y guardar coordenadas en localStorage al montar (oculto para el usuario)
    useEffect(() => {
        if (typeof window !== 'undefined') {
            // Intentar cargar coordenadas existentes
            const storedCoords = localStorage.getItem('userCoordinates')
            if (storedCoords) {
                try {
                    const coords = JSON.parse(storedCoords)
                    setCurrentLocation(coords)
                } catch (e) {
                    console.error('Error loading coordinates:', e)
                }
            }

            // Obtener ubicación actual
            if ('geolocation' in navigator) {
                navigator.geolocation.getCurrentPosition(
                    (position) => {
                        const coords = {
                            lat: position.coords.latitude,
                            lng: position.coords.longitude
                        }
                        setCurrentLocation(coords)
                        // Guardar en localStorage para filtrar tiendas cercanas
                        localStorage.setItem('userCoordinates', JSON.stringify(coords))
                    },
                    (error) => {
                        console.warn('Ubicación no detectada, usando ubicación por defecto:', error)
                        // Si falla y no hay guardada, usar coordenadas por defecto (Quito, Ecuador)
                        // Esto permite que el mapa funcione y el usuario pueda seleccionar manualmente
                        if (!storedCoords) {
                            const defaultCoords = {
                                lat: -0.180653,
                                lng: -78.467834
                            }
                            setCurrentLocation(defaultCoords)
                        }
                    },
                    {
                        enableHighAccuracy: true,
                        timeout: 5000,
                        maximumAge: 0
                    }
                )
            } else if (!storedCoords) {
                // Navegador no soporta geo y no hay guardada
                const defaultCoords = {
                    lat: -0.180653,
                    lng: -78.467834
                }
                setCurrentLocation(defaultCoords)
            }
        }
    }, [])

    // Cuando el usuario inicia sesión, cargar sus ubicaciones guardadas
    // Cuando el usuario inicia sesión, cargar sus ubicaciones guardadas
    useEffect(() => {
        if (user?.id) {
            getClientLocations(user.id).then(locs => {
                setUserLocations(locs)

                // Persistence Logic: Try to restore last selected location
                let foundMatch = false
                const storedCoordsStr = localStorage.getItem('userCoordinates')

                if (storedCoordsStr && locs && locs.length > 0) {
                    try {
                        const stored = JSON.parse(storedCoordsStr)
                        // Find match with strict tolerance
                        const match = locs.find(l => {
                            const [lat, lng] = l.latlong.split(',').map((n: string) => parseFloat(n.trim()))
                            return Math.abs(lat - stored.lat) < 0.0001 && Math.abs(lng - stored.lng) < 0.0001
                        })

                        if (match) {
                            handleSelectLocation(match)
                            foundMatch = true
                        }
                    } catch (e) {
                        console.error("Error restoring location persistency", e)
                    }
                }

                if (!foundMatch && locs && locs.length > 0) {
                    handleSelectLocation(locs[0])
                }
            }).catch(console.error)

            // Cargar órdenes activas
            if (user.celular) {
                setLoadingOrders(true)
                getOrdersByClient(user.celular)
                    .then(async (orders) => {
                        const active = orders.filter((o: any) =>
                            !['delivered', 'cancelled'].includes(o.status)
                        )

                        // Enriquecer con datos básicos del negocio para el logo/nombre
                        const enriched = await Promise.all(active.map(async (o: any) => {
                            const biz = await getBusiness(o.businessId)
                            return { ...o, businessName: biz?.name, businessImage: biz?.image }
                        }))

                        setActiveOrders(enriched)
                    })
                    .catch(console.error)
                    .finally(() => setLoadingOrders(false))
            }
        } else {
            // Si cierra sesión, limpiar datos
            setUserLocations([])
            setSavedLocation(null)
            setActiveOrders([])
        }
    }, [user])

    const handleLocationCreated = (newLocation: ClientLocation) => {
        setUserLocations(prev => [...prev, newLocation])
        handleSelectLocation(newLocation)
        setIsLocationModalOpen(false)
        setIsAddingNewLocation(false)
    }

    const handleSelectLocation = (loc: any) => {
        try {
            const [lat, lng] = loc.latlong.split(',').map((n: string) => parseFloat(n.trim()))
            const newLocation = {
                referencia: loc.referencia,
                lat,
                lng
            }
            setCurrentLocation({ lat, lng })
            setSavedLocation(newLocation)
            // Guardar en localStorage para persistencia
            localStorage.setItem('userCoordinates', JSON.stringify({ lat, lng }))

            // Close modal if open
            setIsLocationModalOpen(false)
        } catch (e) {
            console.error('Error parsing location:', e)
        }
    }



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
                // Actualizar fecha de último login
                if (clientFound.id) {
                    await updateClient(clientFound.id, {
                        lastLoginAt: serverTimestamp(),
                        loginSource: 'sidebar'
                    })
                }

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
                    pinHash,
                    lastLoginAt: serverTimestamp(), // También cuenta como login
                    loginSource: 'sidebar'
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

                // Actualizar lastRegistrationAt y lastLoginAt para el nuevo cliente
                if (newClient && newClient.id) {
                    await updateClient(newClient.id, {
                        lastRegistrationAt: serverTimestamp(),
                        lastLoginAt: serverTimestamp(),
                        loginSource: 'sidebar'
                    })
                }

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
                className={`absolute left-0 top-0 h-full w-full sm:w-[450px] bg-gray-50 shadow-2xl transform transition-transform duration-300 ease-out ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}
            >
                <div className="h-full flex flex-col overflow-y-auto scrollbar-hide">
                    {/* Header */}
                    <div className="px-6 pt-6 pb-4 bg-white sticky top-0 z-10 border-b border-gray-100 shadow-sm">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={onClose}
                                    className="p-2 -ml-2 text-gray-800 hover:bg-gray-100 rounded-full transition-colors"
                                >
                                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                                    </svg>
                                </button>
                                <h2 className="text-xl font-black text-gray-900 tracking-tight">Menú</h2>
                            </div>
                            {user && (
                                <Link
                                    href="/profile"
                                    onClick={onClose}
                                    className="relative w-9 h-9 rounded-full overflow-hidden bg-gray-100 border border-gray-200 hover:opacity-80 transition-opacity focus:ring-2 focus:ring-gray-900 focus:ring-offset-2"
                                >
                                    {user.photoURL ? (
                                        <img src={user.photoURL} alt={user.nombres} className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center bg-gray-900 text-white text-xs font-bold">
                                            {getInitials(user.nombres || 'U')}
                                        </div>
                                    )}
                                </Link>
                            )}
                        </div>
                    </div>

                    <div className="flex-1 flex flex-col">
                        {/* Location Section - Solo mostrar si el usuario está logueado */}
                        {user && (
                            <div className="px-6 py-4 border-b border-gray-100 bg-gradient-to-br from-blue-50/30 to-purple-50/30">
                                {savedLocation ? (
                                    /* Usuario tiene ubicación guardada */
                                    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                                        <div
                                            className="p-4 flex items-center gap-3 cursor-pointer group hover:bg-gray-50 transition-all"
                                            onClick={() => {
                                                setIsAddingNewLocation(false)
                                                setIsLocationModalOpen(true)
                                            }}
                                        >
                                            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center text-white shadow-md flex-shrink-0">
                                                <i className="bi bi-geo-alt-fill text-lg"></i>
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-[9px] font-bold uppercase tracking-widest text-green-600 mb-0.5">
                                                    {/* Mostrar el tipo (Casa/Trabajo) */}
                                                    {savedLocation.referencia.includes(' - ')
                                                        ? savedLocation.referencia.split(' - ')[0]
                                                        : 'Ubicación Activa'}
                                                </p>
                                                <p className="text-sm font-bold text-gray-900 truncate">
                                                    {/* Mostrar solo las referencias (después del guión) */}
                                                    {savedLocation.referencia.includes(' - ')
                                                        ? savedLocation.referencia.split(' - ')[1]
                                                        : savedLocation.referencia}
                                                </p>
                                            </div>
                                            <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center text-gray-400 group-hover:bg-gray-200 transition-all">
                                                <i className="bi bi-pencil-fill text-xs"></i>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    /* Usuario NO tiene ubicación - Mostrar botón para agregar con Modal */
                                    <button
                                        onClick={() => {
                                            setIsAddingNewLocation(true)
                                            setIsLocationModalOpen(true)
                                        }}
                                        className="w-full bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex items-center gap-4 group hover:shadow-md transition-all"
                                    >
                                        <div className="w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center text-blue-500 group-hover:bg-blue-500 group-hover:text-white transition-all">
                                            <i className="bi bi-geo-alt-fill text-xl"></i>
                                        </div>
                                        <div className="text-left">
                                            <h4 className="font-bold text-gray-900 text-sm">Agregar Dirección</h4>
                                            <p className="text-xs text-gray-500">Para ver tiendas cercanas</p>
                                        </div>
                                        <div className="ml-auto">
                                            <i className="bi bi-chevron-right text-gray-400"></i>
                                        </div>
                                    </button>
                                )}

                                <LocationSelectionModal
                                    isOpen={isLocationModalOpen}
                                    onClose={() => setIsLocationModalOpen(false)}
                                    clientLocations={userLocations}
                                    onSelect={(loc) => handleSelectLocation(loc)}
                                    onLocationCreated={handleLocationCreated}
                                    clientId={user.id}
                                    initialAddingState={isAddingNewLocation}
                                />
                            </div>
                        )}
                        {/* Profile Section */}
                        <div className="px-6 py-6 font-primary">
                            {!user && (
                                <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100 text-center">
                                    {!showAuthForm ? (
                                        <>
                                            <div className="w-20 h-20 rounded-full bg-gray-50 mx-auto flex items-center justify-center text-gray-300 mb-6 group-hover:scale-110 transition-transform">
                                                <i className="bi bi-person-circle text-4xl"></i>
                                            </div>
                                            <h4 className="text-xl font-black text-gray-900 mb-2 tracking-tight">¡Hola!</h4>
                                            <p className="text-sm text-gray-500 mb-8 leading-relaxed">Inicia sesión para gestionar tus pedidos y ver tus stickers favoritos.</p>

                                            <div className="space-y-3">
                                                <button
                                                    onClick={() => setShowAuthForm(true)}
                                                    className="w-full py-4 bg-gray-900 text-white rounded-2xl text-base font-bold hover:bg-gray-800 transition-all shadow-xl shadow-gray-200 active:scale-[0.98]"
                                                >
                                                    Iniciar Sesión
                                                </button>

                                                <div className="pt-6 border-t border-gray-50">
                                                    <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">¿Tienes un negocio?</p>
                                                    <Link
                                                        href="/business/dashboard"
                                                        onClick={onClose}
                                                        className="block w-full py-4 bg-white border-2 border-orange-500 text-orange-500 rounded-2xl text-base font-bold hover:bg-orange-50 transition-all active:scale-[0.98]"
                                                    >
                                                        Panel de Negocio
                                                    </Link>
                                                </div>
                                            </div>
                                        </>
                                    ) : (
                                        <div className="text-left space-y-5">
                                            <div className="flex items-center gap-3 mb-2">
                                                <button
                                                    onClick={() => setShowAuthForm(false)}
                                                    className="p-2 -ml-2 text-gray-400 hover:text-gray-900 transition-colors"
                                                >
                                                    <i className="bi bi-arrow-left text-xl"></i>
                                                </button>
                                                <h4 className="text-lg font-black text-gray-900">Iniciar Sesión</h4>
                                            </div>

                                            <div className="space-y-4">
                                                {/* Phone Input */}
                                                <div>
                                                    <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">
                                                        Número de WhatsApp
                                                    </label>
                                                    <div className="relative">
                                                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                                            <span className="text-xs font-bold text-gray-400">+593</span>
                                                        </div>
                                                        <input
                                                            type="tel"
                                                            value={customerData.phone}
                                                            onChange={(e) => {
                                                                const phone = e.target.value;
                                                                setCustomerData({ ...customerData, phone });
                                                                handlePhoneSearch(phone);
                                                            }}
                                                            placeholder="09XXXXXXXX"
                                                            className="w-full pl-12 pr-4 py-4 bg-gray-50 border-none rounded-2xl text-sm font-bold focus:ring-2 focus:ring-gray-900 focus:bg-white transition-all"
                                                        />
                                                    </div>
                                                </div>

                                                {clientSearching && (
                                                    <div className="flex items-center justify-center gap-2 py-4">
                                                        <i className="bi bi-arrow-repeat animate-spin text-gray-900"></i>
                                                        <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Buscando cuenta...</span>
                                                    </div>
                                                )}

                                                {!clientSearching && clientFound && clientFound.pinHash && (
                                                    <div className="space-y-4 pt-2">
                                                        <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
                                                            <p className="text-xs text-gray-500">Bienvenido de nuevo</p>
                                                            <p className="font-black text-gray-900">{clientFound.nombres || clientFound.celular}</p>
                                                        </div>
                                                        <div>
                                                            <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">
                                                                PIN de Seguridad
                                                            </label>
                                                            <input
                                                                type="password"
                                                                value={loginPin}
                                                                onChange={(e) => setLoginPin(e.target.value)}
                                                                maxLength={6}
                                                                placeholder="••••"
                                                                className="w-full px-4 py-4 bg-gray-50 border-none rounded-2xl text-center text-2xl tracking-[1em] font-black focus:ring-2 focus:ring-gray-900 focus:bg-white transition-all"
                                                                onKeyPress={(e) => e.key === 'Enter' && handleLoginWithPin()}
                                                            />
                                                            {loginPinError && (
                                                                <p className="text-[10px] font-bold text-red-500 mt-2 uppercase tracking-wide text-center">{loginPinError}</p>
                                                            )}
                                                        </div>
                                                        <button
                                                            onClick={handleLoginWithPin}
                                                            disabled={loginPinLoading || loginPin.length < 4}
                                                            className="w-full py-4 bg-gray-900 text-white rounded-2xl font-bold hover:bg-gray-800 transition-all shadow-xl shadow-gray-200 disabled:opacity-50 active:scale-[0.98]"
                                                        >
                                                            {loginPinLoading ? 'Verificando...' : 'Entrar ahora'}
                                                        </button>
                                                    </div>
                                                )}

                                                {!clientSearching && ((clientFound && !clientFound.pinHash) || (!clientFound && customerData.phone.length >= 8)) && (
                                                    <div className="space-y-4 pt-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
                                                        <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100">
                                                            <p className="text-xs font-bold text-blue-700 leading-relaxed">
                                                                {clientFound ? 'Hereda tu cuenta configurando un PIN para entrar desde cualquier lugar.' : 'Crea tu cuenta Fuddi en pocos segundos.'}
                                                            </p>
                                                        </div>
                                                        <div>
                                                            <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">
                                                                Tu Nombre
                                                            </label>
                                                            <input
                                                                type="text"
                                                                value={customerData.name}
                                                                onChange={(e) => setCustomerData({ ...customerData, name: e.target.value })}
                                                                placeholder="Ej. Juan Pérez"
                                                                className="w-full px-4 py-4 bg-gray-50 border-none rounded-2xl text-sm font-bold focus:ring-2 focus:ring-gray-900 focus:bg-white transition-all"
                                                            />
                                                        </div>
                                                        <div className="grid grid-cols-2 gap-3">
                                                            <div>
                                                                <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">
                                                                    Crea un PIN
                                                                </label>
                                                                <input
                                                                    type="password"
                                                                    value={registerPin}
                                                                    onChange={(e) => setRegisterPin(e.target.value)}
                                                                    maxLength={6}
                                                                    placeholder="••••"
                                                                    className="w-full px-4 py-4 bg-gray-50 border-none rounded-2xl text-center text-xl font-black focus:ring-2 focus:ring-gray-900 focus:bg-white transition-all"
                                                                />
                                                            </div>
                                                            <div>
                                                                <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">
                                                                    Repite PIN
                                                                </label>
                                                                <input
                                                                    type="password"
                                                                    value={registerPinConfirm}
                                                                    onChange={(e) => setRegisterPinConfirm(e.target.value)}
                                                                    maxLength={6}
                                                                    placeholder="••••"
                                                                    className="w-full px-4 py-4 bg-gray-50 border-none rounded-2xl text-center text-xl font-black focus:ring-2 focus:ring-gray-900 focus:bg-white transition-all"
                                                                />
                                                            </div>
                                                        </div>
                                                        {registerError && (
                                                            <p className="text-[10px] font-bold text-red-500 mt-1 uppercase tracking-wide text-center">{registerError}</p>
                                                        )}
                                                        <button
                                                            onClick={handleRegisterOrSetPin}
                                                            disabled={registerLoading || !customerData.name || registerPin.length < 4}
                                                            className="w-full py-4 bg-gray-900 text-white rounded-2xl font-bold hover:bg-gray-800 transition-all shadow-xl shadow-gray-200 disabled:opacity-50 active:scale-[0.98]"
                                                        >
                                                            {registerLoading ? 'Procesando...' : (clientFound ? 'Confirmar PIN' : 'Crear mi cuenta')}
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="flex-1 px-6 space-y-6">
                            {user && activeOrders.length > 0 && (
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between ml-4 mb-1">
                                        <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">Órdenes Activas</p>
                                        <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
                                    </div>

                                    <div className="space-y-3">
                                        {activeOrders.map((order) => (
                                            <button
                                                key={order.id}
                                                type="button"
                                                onClick={() => {
                                                    setSelectedOrderId(order.id)
                                                    setOrderSidebarOpen(true)
                                                }}
                                                className="w-full text-left flex items-center gap-4 p-3 bg-white rounded-2xl shadow-sm border border-emerald-100 hover:border-emerald-500 transition-all group"
                                            >
                                                <div className="w-12 h-12 rounded-2xl overflow-hidden bg-emerald-50 border border-emerald-100 flex-shrink-0">
                                                    <img
                                                        src={order.businessImage || '/default-restaurant-og.svg'}
                                                        alt={order.businessName || 'Tienda'}
                                                        className="w-full h-full object-cover"
                                                    />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center justify-between gap-2">
                                                        <h4 className="font-bold text-gray-900 text-[13px] truncate tracking-tight">
                                                            {order.businessName || 'Tienda'}
                                                        </h4>
                                                        <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full uppercase tracking-widest">
                                                            {order.status === 'pending' ? 'Pendiente' :
                                                                order.status === 'confirmed' ? 'Confirmado' :
                                                                    order.status === 'preparing' ? 'Preparando' :
                                                                        order.status === 'ready' ? 'Listo' : order.status}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center justify-between mt-1">
                                                        <p className="text-[10px] font-bold text-gray-400 truncate uppercase tracking-widest">
                                                            Total: <span className="text-gray-900">${(order.total || 0).toFixed(2)}</span>
                                                        </p>
                                                        <div className="ml-auto flex items-center gap-2">
                                                            <div className="w-7 h-7 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600 group-hover:bg-emerald-100 transition-colors">
                                                                <i className="bi bi-chevron-right"></i>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {user ? (
                                <div className="space-y-2">
                                    <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 ml-4 mb-3">Mi Actividad</p>

                                    <Link
                                        href="/profile?tab=recommendations"
                                        onClick={onClose}
                                        className="flex items-center justify-between p-4 bg-white rounded-2xl shadow-sm border border-gray-100 hover:border-gray-900 group transition-all"
                                    >
                                        <div className="flex items-center gap-4">
                                            <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600 group-hover:bg-emerald-500 group-hover:text-white transition-all">
                                                <i className="bi bi-gift text-xl"></i>
                                            </div>
                                            <span className="font-bold text-gray-900">Mis Recomendaciones</span>
                                        </div>
                                        <i className="bi bi-chevron-right text-gray-300 group-hover:text-gray-900 transition-colors"></i>
                                    </Link>

                                    <Link
                                        href="/my-orders"
                                        onClick={onClose}
                                        className="flex items-center justify-between p-4 bg-white rounded-2xl shadow-sm border border-gray-100 hover:border-gray-900 hover:shadow-md group transition-all"
                                    >
                                        <div className="flex items-center gap-4">
                                            <div className="w-10 h-10 rounded-xl bg-orange-50 flex items-center justify-center text-orange-500 group-hover:bg-orange-500 group-hover:text-white transition-all">
                                                <i className="bi bi-bag-check text-xl"></i>
                                            </div>
                                            <span className="font-bold text-gray-900">Mis Pedidos</span>
                                        </div>
                                        <i className="bi bi-chevron-right text-gray-300 group-hover:text-gray-900 transition-colors"></i>
                                    </Link>

                                    {/* Sección de Stickers o Extras */}

                                    <Link
                                        href="/collection"
                                        onClick={onClose}
                                        className="flex items-center justify-between p-4 bg-white rounded-2xl shadow-sm border border-gray-100 hover:border-gray-900 hover:shadow-md group transition-all"
                                    >
                                        <div className="flex items-center gap-4">
                                            <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center text-purple-500 group-hover:bg-purple-500 group-hover:text-white transition-all">
                                                <i className="bi bi-grid-1x2 text-xl"></i>
                                            </div>
                                            <span className="font-bold text-gray-900">Mis Stickers</span>
                                        </div>
                                        <i className="bi bi-chevron-right text-gray-300 group-hover:text-gray-900 transition-colors"></i>
                                    </Link>

                                    <Link
                                        href="/my-locations"
                                        onClick={onClose}
                                        className="flex items-center justify-between p-4 bg-white rounded-2xl shadow-sm border border-gray-100 hover:border-gray-900 hover:shadow-md group transition-all"
                                    >
                                        <div className="flex items-center gap-4">
                                            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-blue-500 group-hover:bg-blue-500 group-hover:text-white transition-all">
                                                <i className="bi bi-geo-alt text-xl"></i>
                                            </div>
                                            <span className="font-bold text-gray-900">Mis Ubicaciones</span>
                                        </div>
                                        <i className="bi bi-chevron-right text-gray-300 group-hover:text-gray-900 transition-colors"></i>
                                    </Link>
                                </div>
                            ) : null}

                            {/* Siempre mostrar "Mis Carritos" si hay carritos activos, 
                               pero con el nuevo estilo se integra mejor */}
                            <div className="pt-2">
                                <CartMenuOption onClose={onClose} />
                            </div>
                        </div>

                        {/* Footer / Logout */}
                        <div className="px-6 py-8 mt-auto bg-gray-50/80">
                            {user && (
                                <button
                                    onClick={handleLogout}
                                    className="w-full flex items-center justify-center gap-3 py-4 rounded-2xl bg-white text-red-500 font-black hover:bg-red-50 hover:text-red-600 transition-all border-2 border-transparent hover:border-red-100 shadow-sm"
                                >
                                    <i className="bi bi-box-arrow-right text-lg"></i>
                                    Cerrar Sesión
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            <OrderSidebar
                isOpen={orderSidebarOpen}
                onClose={() => setOrderSidebarOpen(false)}
                orderId={selectedOrderId}
            />
        </div>
    )
}
