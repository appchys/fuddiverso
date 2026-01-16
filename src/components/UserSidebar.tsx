'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { searchClientByPhone, createClient, updateClient, getClientLocations, serverTimestamp, createClientLocation, deleteLocation } from '@/lib/database'
import { normalizeEcuadorianPhone, validateEcuadorianPhone } from '@/lib/validation'
import { GoogleMap } from '@/components/GoogleMap'

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
    const [locationReference, setLocationReference] = useState('')
    const [savingLocation, setSavingLocation] = useState(false)
    const [savedLocation, setSavedLocation] = useState<{ referencia: string; lat: number; lng: number } | null>(null)

    const [userLocations, setUserLocations] = useState<any[]>([])
    const [showLocationsList, setShowLocationsList] = useState(false)
    const [locationType, setLocationType] = useState<'Casa' | 'Trabajo'>('Casa')


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
                        console.error('Error getting location:', error)
                    }
                )
            }
        }
    }, [])

    // Cuando el usuario inicia sesión, cargar sus ubicaciones guardadas
    useEffect(() => {
        if (user?.id) {
            getClientLocations(user.id).then(locs => {
                setUserLocations(locs)
                // Si tiene ubicaciones, seleccionar la primera
                if (locs && locs.length > 0) {
                    handleSelectLocation(locs[0])
                }
            }).catch(console.error)
        } else {
            // Si cierra sesión, limpiar ubicaciones
            setUserLocations([])
            setSavedLocation(null)
        }
    }, [user])

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
            setShowLocationsList(false)
        } catch (e) {
            console.error('Error parsing location:', e)
        }
    }

    const handleSaveLocation = async () => {
        if (!user || !currentLocation || !locationReference.trim()) return

        setSavingLocation(true)
        try {
            // Combinar tipo de ubicación con referencias
            const fullReference = `${locationType} - ${locationReference.trim()}`

            const newId = await createClientLocation({
                id_cliente: user.id, // User is FirestoreClient which has id
                latlong: `${currentLocation.lat}, ${currentLocation.lng}`,
                referencia: fullReference,
                sector: 'Ubicación actual',
                tarifa: '1'
            })

            const newLocation = {
                id: newId,
                id_cliente: user.id || '',
                referencia: fullReference,
                sector: 'Ubicación actual',
                tarifa: '1',
                latlong: `${currentLocation.lat}, ${currentLocation.lng}`,
                photo: ''
            }

            setUserLocations(prev => [...prev, newLocation])

            const newSavedLocation = {
                referencia: fullReference,
                lat: currentLocation.lat,
                lng: currentLocation.lng
            }
            setSavedLocation(newSavedLocation)
            // Guardar coordenadas en localStorage
            localStorage.setItem('userCoordinates', JSON.stringify({ lat: currentLocation.lat, lng: currentLocation.lng }))
            setLocationReference('')
            setLocationType('Casa') // Reset to default
        } catch (error) {
            console.error('Error saving location:', error)
        } finally {
            setSavingLocation(false)
        }
    }

    const handleDeleteLocation = async (locationId: string) => {
        if (!user?.id) return

        try {
            // Eliminar de Firebase
            await deleteLocation(locationId)

            // Eliminar de la lista local
            const updatedLocations = userLocations.filter(loc => loc.id !== locationId)
            setUserLocations(updatedLocations)

            // Si la ubicación eliminada era la seleccionada, seleccionar la primera disponible
            if (savedLocation && userLocations.find(loc => loc.id === locationId)?.referencia === savedLocation.referencia) {
                if (updatedLocations.length > 0) {
                    handleSelectLocation(updatedLocations[0])
                } else {
                    setSavedLocation(null)
                    // No eliminar userCoordinates, solo la ubicación guardada
                }
            }
        } catch (error) {
            console.error('Error deleting location:', error)
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
                                            onClick={() => setShowLocationsList(!showLocationsList)}
                                        >
                                            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center text-white shadow-md flex-shrink-0">
                                                <i className="bi bi-geo-alt-fill text-lg"></i>
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-[9px] font-black uppercase tracking-widest text-green-600 mb-0.5">
                                                    {/* Mostrar el tipo (Casa/Trabajo) */}
                                                    {savedLocation.referencia.includes(' - ')
                                                        ? savedLocation.referencia.split(' - ')[0]
                                                        : 'Ubicación Activa'}
                                                </p>
                                                <p className="text-sm font-black text-gray-900 truncate">
                                                    {/* Mostrar solo las referencias (después del guión) */}
                                                    {savedLocation.referencia.includes(' - ')
                                                        ? savedLocation.referencia.split(' - ')[1]
                                                        : savedLocation.referencia}
                                                </p>
                                            </div>
                                            <div className={`w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center text-gray-400 group-hover:bg-gray-200 transition-all ${showLocationsList ? 'rotate-180' : ''}`}>
                                                <i className="bi bi-chevron-down text-sm"></i>
                                            </div>
                                        </div>

                                        {/* Dropdown de ubicaciones */}
                                        {showLocationsList && (
                                            <div className="border-t border-gray-100 bg-gray-50/50 animate-in slide-in-from-top-2 duration-300">
                                                <p className="px-4 py-2 text-[9px] font-black uppercase tracking-widest text-gray-400">
                                                    Cambiar ubicación
                                                </p>

                                                {/* Botón para agregar nueva */}
                                                <button
                                                    onClick={() => {
                                                        setSavedLocation(null)
                                                        setLocationReference('')
                                                        setShowLocationsList(false)
                                                    }}
                                                    className="w-full text-left px-4 py-3 flex items-center gap-3 border-b border-gray-100 hover:bg-white transition-all"
                                                >
                                                    <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
                                                        <i className="bi bi-plus-lg text-sm font-bold"></i>
                                                    </div>
                                                    <span className="text-xs font-bold text-gray-700">Nueva ubicación</span>
                                                </button>

                                                {/* Otras ubicaciones */}
                                                {userLocations
                                                    .filter(loc => loc.referencia !== savedLocation.referencia)
                                                    .map((loc) => (
                                                        <div
                                                            key={loc.id}
                                                            className="flex items-center border-b border-gray-100 last:border-0 hover:bg-white transition-all group"
                                                        >
                                                            <button
                                                                onClick={() => handleSelectLocation(loc)}
                                                                className="flex-1 text-left px-4 py-3 flex items-center gap-3"
                                                            >
                                                                <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 group-hover:bg-gray-900 group-hover:text-white transition-all">
                                                                    <i className="bi bi-geo-alt-fill text-xs"></i>
                                                                </div>
                                                                <div className="flex-1 min-w-0">
                                                                    <p className="text-[9px] text-gray-400 font-bold uppercase">
                                                                        {/* Tipo de ubicación */}
                                                                        {loc.referencia.includes(' - ')
                                                                            ? loc.referencia.split(' - ')[0]
                                                                            : 'Ubicación'}
                                                                    </p>
                                                                    <p className="text-xs font-bold text-gray-700 truncate">
                                                                        {/* Solo referencias */}
                                                                        {loc.referencia.includes(' - ')
                                                                            ? loc.referencia.split(' - ')[1]
                                                                            : loc.referencia}
                                                                    </p>
                                                                </div>
                                                            </button>
                                                            <button
                                                                onClick={() => handleDeleteLocation(loc.id)}
                                                                className="p-2 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all mr-2"
                                                            >
                                                                <i className="bi bi-trash text-sm"></i>
                                                            </button>
                                                        </div>
                                                    ))}

                                                {userLocations.filter(loc => loc.referencia !== savedLocation.referencia).length === 0 && (
                                                    <p className="px-4 py-3 text-center text-[10px] text-gray-400">
                                                        No tienes más ubicaciones
                                                    </p>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    /* Usuario NO tiene ubicación - Mostrar formulario horizontal */
                                    <div className="bg-white rounded-2xl shadow-sm border border-blue-100 overflow-hidden">
                                        <div className="p-4">
                                            {/* Fila superior: Mapa | Selector + Referencias | Botón */}
                                            <div className="flex items-center gap-4">
                                                {/* Mapa circular pequeño */}
                                                <div className="relative w-20 h-20 rounded-full overflow-hidden border-4 border-white shadow-lg flex-shrink-0">
                                                    {currentLocation ? (
                                                        <GoogleMap
                                                            latitude={currentLocation.lat}
                                                            longitude={currentLocation.lng}
                                                            height="100%"
                                                            width="100%"
                                                            zoom={15}
                                                            marker={true}
                                                            draggable={true}
                                                            onLocationChange={(lat, lng) => {
                                                                setCurrentLocation({ lat, lng })
                                                                localStorage.setItem('userCoordinates', JSON.stringify({ lat, lng }))
                                                            }}
                                                        />
                                                    ) : (
                                                        <div className="w-full h-full bg-gradient-to-br from-blue-100 to-blue-200 flex items-center justify-center">
                                                            <i className="bi bi-geo-alt text-2xl text-blue-400"></i>
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Selector y referencias */}
                                                <div className="flex-1 space-y-2">
                                                    {/* Selector desplegable Casa/Trabajo */}
                                                    <div className="relative">
                                                        <select
                                                            value={locationType}
                                                            onChange={(e) => setLocationType(e.target.value as 'Casa' | 'Trabajo')}
                                                            className="w-full appearance-none bg-white border border-gray-200 rounded-xl px-3 py-2 pr-8 text-sm font-black text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all cursor-pointer"
                                                        >
                                                            <option value="Casa">Casa</option>
                                                            <option value="Trabajo">Trabajo</option>
                                                        </select>
                                                        <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                                                            <i className="bi bi-chevron-down text-xs text-gray-400"></i>
                                                        </div>
                                                    </div>

                                                    {/* Campo de referencias */}
                                                    <input
                                                        type="text"
                                                        value={locationReference}
                                                        onChange={(e) => setLocationReference(e.target.value)}
                                                        placeholder="Ej: Av. Principal #123, Edificio azul..."
                                                        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all placeholder:text-gray-400"
                                                    />
                                                </div>

                                                {/* Botón guardar */}
                                                <button
                                                    onClick={handleSaveLocation}
                                                    disabled={!locationReference.trim() || savingLocation || !currentLocation}
                                                    className="px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-black hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm active:scale-95 whitespace-nowrap self-start"
                                                >
                                                    {savingLocation ? (
                                                        <>
                                                            <i className="bi bi-arrow-repeat animate-spin mr-1"></i>
                                                            Guardando
                                                        </>
                                                    ) : (
                                                        <>
                                                            <i className="bi bi-check-circle mr-1"></i>
                                                            Guardar
                                                        </>
                                                    )}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                        {/* Profile Section */}
                        <div className="px-6 py-6 font-primary">
                            {user ? (
                                <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex items-center gap-4 group transition-all hover:shadow-md">
                                    <div className="w-16 h-16 rounded-full overflow-hidden bg-gray-900 flex items-center justify-center text-white ring-4 ring-gray-50 shadow-sm flex-shrink-0">
                                        {user.photoURL ? (
                                            <img src={user.photoURL} alt={user.nombres} className="w-full h-full object-cover" />
                                        ) : (
                                            <span className="text-xl font-black">{getInitials(user.nombres || 'U')}</span>
                                        )}
                                    </div>
                                    <div className="min-w-0">
                                        <p className="font-black text-lg text-gray-900 truncate leading-tight">{user.nombres}</p>
                                        <p className="text-sm text-gray-500 font-bold mt-0.5">{user.celular}</p>
                                        <div className="flex gap-2 mt-2">
                                            <Link
                                                href="/profile"
                                                onClick={onClose}
                                                className="text-[10px] uppercase tracking-widest font-black text-gray-400 hover:text-gray-900 transition-colors"
                                            >
                                                Ver mi cuenta
                                            </Link>
                                        </div>
                                    </div>
                                </div>
                            ) : (
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

                        {/* Navigation Links */}
                        <div className="flex-1 px-6 space-y-4">
                            {user ? (
                                <div className="space-y-2">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 ml-4 mb-3">Mi Actividad</p>

                                    <Link
                                        href="/my-orders"
                                        onClick={onClose}
                                        className="flex items-center justify-between p-4 bg-white rounded-2xl shadow-sm border border-gray-100 hover:border-gray-900 group transition-all"
                                    >
                                        <div className="flex items-center gap-4">
                                            <div className="w-10 h-10 rounded-xl bg-orange-50 flex items-center justify-center text-orange-500 group-hover:bg-orange-500 group-hover:text-white transition-all">
                                                <i className="bi bi-bag-check text-xl"></i>
                                            </div>
                                            <span className="font-black text-gray-900">Mis Pedidos</span>
                                        </div>
                                        <i className="bi bi-chevron-right text-gray-300 group-hover:text-gray-900 transition-colors"></i>
                                    </Link>

                                    <Link
                                        href="/collection"
                                        onClick={onClose}
                                        className="flex items-center justify-between p-4 bg-white rounded-2xl shadow-sm border border-gray-100 hover:border-gray-900 group transition-all"
                                    >
                                        <div className="flex items-center gap-4">
                                            <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center text-purple-500 group-hover:bg-purple-500 group-hover:text-white transition-all">
                                                <i className="bi bi-grid-1x2 text-xl"></i>
                                            </div>
                                            <span className="font-black text-gray-900">Mis Stickers</span>
                                        </div>
                                        <i className="bi bi-chevron-right text-gray-300 group-hover:text-gray-900 transition-colors"></i>
                                    </Link>

                                    <Link
                                        href="/my-locations"
                                        onClick={onClose}
                                        className="flex items-center justify-between p-4 bg-white rounded-2xl shadow-sm border border-gray-100 hover:border-gray-900 group transition-all"
                                    >
                                        <div className="flex items-center gap-4">
                                            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-blue-500 group-hover:bg-blue-500 group-hover:text-white transition-all">
                                                <i className="bi bi-geo-alt text-xl"></i>
                                            </div>
                                            <span className="font-black text-gray-900">Mis Ubicaciones</span>
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
                        <div className="px-6 py-8 mt-auto sticky bottom-0 bg-gray-50/80 backdrop-blur-md">
                            {user && (
                                <button
                                    onClick={handleLogout}
                                    className="w-full flex items-center justify-center gap-3 py-4 rounded-2xl bg-white text-red-500 font-black hover:bg-red-50 hover:text-red-600 transition-all border-2 border-transparent hover:border-red-100 shadow-sm"
                                >
                                    <i className="bi bi-box-arrow-right text-lg"></i>
                                    Cerrar Sesión
                                </button>
                            )}
                            <div className="mt-6 text-center space-y-1">
                                <p className="text-[10px] text-gray-400 font-black uppercase tracking-[0.2em]">Fuddi Ecuador</p>
                                <p className="text-[9px] text-gray-300 font-bold uppercase tracking-widest">v1.5.0 • © 2026</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
