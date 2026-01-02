'use client'

import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { QRCode, UserQRProgress } from '@/types'
import {
    getQRCodesByBusiness,
    getUserQRProgress,
    redeemQRCodePrize,
    unredeemQRCodePrize,
    searchClientByPhone,
    setClientPin,
    clearClientPin,
    registerClientForgotPin,
    createClient,
    updateClient
} from '@/lib/database'
import { normalizeEcuadorianPhone, validateEcuadorianPhone } from '@/lib/validation'
import { CheckoutContent } from '@/components/CheckoutContent'

interface CartSidebarProps {
    isOpen: boolean
    onClose: () => void
    cart: any[]
    business: any
    removeFromCart: (productId: string, variantName?: string | null) => void
    updateQuantity: (productId: string, quantity: number, variantName?: string | null) => void
    addItemToCart: (item: any) => void
}

export default function CartSidebar({
    isOpen,
    onClose,
    cart,
    business,
    removeFromCart,
    updateQuantity,
    addItemToCart
}: CartSidebarProps) {
    const { user, login } = useAuth()

    const [view, setView] = useState<'cart' | 'checkout'>('cart')

    const [localClientId, setLocalClientId] = useState<string | null>(null)
    const [localClientProfile, setLocalClientProfile] = useState<any | null>(null)

    const [qrCodes, setQrCodes] = useState<QRCode[]>([])
    const [qrProgress, setQrProgress] = useState<UserQRProgress | null>(null)
    const [loadingQr, setLoadingQr] = useState(false)
    const [redeemingQrId, setRedeemingQrId] = useState<string | null>(null)
    const [qrError, setQrError] = useState<string>('')
    const [lastQrPrizeIdInCart, setLastQrPrizeIdInCart] = useState<string[]>([])

    // Login states
    const [customerData, setCustomerData] = useState({ name: '', phone: '' })
    const [loginPin, setLoginPin] = useState('')
    const [loginPinError, setLoginPinError] = useState('')
    const [loginPinLoading, setLoginPinLoading] = useState(false)
    const [pinAttempted, setPinAttempted] = useState(false)
    const [clientFound, setClientFound] = useState<any | null>(null)
    const [clientSearching, setClientSearching] = useState(false)
    const [showNameField, setShowNameField] = useState(false)
    const [registerPin, setRegisterPin] = useState('')
    const [registerPinConfirm, setRegisterPinConfirm] = useState('')
    const [registerError, setRegisterError] = useState('')
    const [registerLoading, setRegisterLoading] = useState(false)

    const cartTotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0)
    const cartItemsCount = cart.reduce((sum, item) => sum + item.quantity, 0)

    useEffect(() => {
        if (!isOpen) return
        setView('cart')
        if (typeof window === 'undefined') return

        try {
            const fromLoginPhone = localStorage.getItem('loginPhone')
            const fromClientData = localStorage.getItem('clientData')
            const fromAuthUser = localStorage.getItem('fuddi_shop_user')

            if (fromLoginPhone) {
                setLocalClientId(fromLoginPhone)
            }

            if (fromClientData) {
                const parsed = JSON.parse(fromClientData)
                if (parsed) {
                    setLocalClientProfile(parsed)
                    if (parsed?.celular) {
                        setLocalClientId(parsed.celular)
                    }
                }
            }

            if (fromAuthUser) {
                const parsed = JSON.parse(fromAuthUser)
                if (parsed) {
                    setLocalClientProfile(parsed)
                    if (parsed?.celular) {
                        setLocalClientId(parsed.celular)
                    }
                }
            }

            if (!fromLoginPhone && !fromClientData && !fromAuthUser) {
                setLocalClientId(null)
                setLocalClientProfile(null)
            }
        } catch (e) {
            console.error('Error reading local client data for cart sidebar:', e)
            setLocalClientId(null)
            setLocalClientProfile(null)
        }
    }, [isOpen])

    useEffect(() => {
        if (user) return

        setLocalClientId(null)
        setLocalClientProfile(null)
    }, [user])

    const rawClientId = ((user as any)?.celular as string | undefined) || (localClientId || undefined)
    const clientId = rawClientId ? normalizeEcuadorianPhone(rawClientId) : undefined
    const businessId = business?.id as string | undefined

    useEffect(() => {
        const loadQrData = async () => {
            if (!isOpen) return
            if (!businessId || !clientId) {
                setQrCodes([])
                setQrProgress(null)
                setQrError('')
                return
            }

            try {
                setLoadingQr(true)
                setQrError('')
                const [codes, progress] = await Promise.all([
                    getQRCodesByBusiness(businessId, true),
                    getUserQRProgress(clientId, businessId)
                ])
                setQrCodes(codes)
                setQrProgress(progress)
            } catch (e) {
                console.error('Error loading QR data for cart sidebar:', e)
                setQrCodes([])
                setQrProgress(null)
                setQrError('No se pudieron cargar tus tarjetas')
            } finally {
                setLoadingQr(false)
            }
        }

        void loadQrData()
    }, [isOpen, businessId, clientId])

    const eligibleQrPrizes = useMemo(() => {
        if (!qrProgress) return []
        const redeemed = qrProgress.redeemedPrizeCodes || []
        return qrCodes
            .filter(c => qrProgress.scannedCodes?.includes(c.id))
            .filter(c => !!c.prize?.trim())
            .filter(c => !redeemed.includes(c.id))
    }, [qrCodes, qrProgress])

    const scannedQrCards = useMemo(() => {
        if (!qrProgress) return []
        const scanned = qrProgress.scannedCodes || []
        return qrCodes.filter(c => scanned.includes(c.id))
    }, [qrCodes, qrProgress])

    const qrPrizeIdsInCart = useMemo(() => {
        return cart
            .filter((i: any) => i?.esPremio === true && (i?.qrCodeId || String(i?.id || '').startsWith('premio-qr-')))
            .map((item: any) => {
                if (item.qrCodeId) return String(item.qrCodeId)
                if (typeof item.id === 'string' && item.id.startsWith('premio-qr-')) return item.id.replace('premio-qr-', '')
                return null
            })
            .filter(Boolean) as string[]
    }, [cart])

    const hasQrPrizeInCart = useMemo(() => qrPrizeIdsInCart.length > 0, [qrPrizeIdsInCart])

    const visibleQrCards = useMemo(() => {
        const redeemed = qrProgress?.redeemedPrizeCodes || []
        return scannedQrCards.filter((c) => {
            const isRedeemed = redeemed.includes(c.id)
            if (!isRedeemed) return true
            return qrPrizeIdsInCart.includes(c.id)
        })
    }, [qrProgress, scannedQrCards, qrPrizeIdsInCart])

    useEffect(() => {
        if (!isOpen) return
        setLastQrPrizeIdInCart(qrPrizeIdsInCart)
    }, [isOpen, qrPrizeIdsInCart])

    useEffect(() => {
        if (!isOpen) return
        if (!businessId || !clientId) return

        const prevIds = lastQrPrizeIdInCart
        const currentIds = qrPrizeIdsInCart
        const removedIds = prevIds.filter((id: string) => !currentIds.includes(id))
        if (removedIds.length === 0) return

        void Promise.all(removedIds.map((id: string) => unredeemQRCodePrize(clientId, businessId, id)))
            .catch((e) => console.error('Error auto-unredeeming QR prizes from cart sidebar:', e))
            .finally(() => {
                void getUserQRProgress(clientId, businessId)
                    .then((p) => setQrProgress(p))
                    .catch((e) => console.error('Error refreshing QR progress after auto-unredeem:', e))
                setLastQrPrizeIdInCart(currentIds)
            })
    }, [isOpen, businessId, clientId, lastQrPrizeIdInCart, qrPrizeIdsInCart])

    useEffect(() => {
        if (!isOpen) return
        if (!businessId || !clientId) return

        void getUserQRProgress(clientId, businessId)
            .then((p) => setQrProgress(p))
            .catch((e) => console.error('Error refreshing QR progress after cart change:', e))
    }, [isOpen, businessId, clientId, cart])

    const handleRedeemQrPrize = async (qrCode: QRCode) => {
        if (!businessId || !clientId) return
        if (!qrCode.prize?.trim()) {
            setQrError('Este código no tiene premio configurado')
            return
        }

        if (qrPrizeIdsInCart.includes(qrCode.id)) {
            setQrError('Esta tarjeta ya está agregada en tu carrito')
            return
        }

        setRedeemingQrId(qrCode.id)
        setQrError('')
        try {
            const result = await redeemQRCodePrize(clientId, businessId, qrCode.id)
            if (!result.success) {
                setQrError(result.message || 'No se pudo canjear la tarjeta')
                return
            }

            const premioId = `premio-qr-${qrCode.id}`
            addItemToCart({
                id: premioId,
                name: `🎁 ${qrCode.prize}`,
                variantName: null,
                productName: `🎁 ${qrCode.prize}`,
                description: `Premio canjeado por tarjeta: ${qrCode.name}`,
                price: 0,
                isAvailable: true,
                esPremio: true,
                quantity: 1,
                image: business?.image || 'https://via.placeholder.com/150?text=Premio',
                businessId: businessId,
                businessName: business?.name,
                businessImage: business?.image,
                qrCodeId: qrCode.id
            })

            const refreshed = await getUserQRProgress(clientId, businessId)
            setQrProgress(refreshed)
        } catch (e) {
            console.error('Error redeeming QR prize from cart sidebar:', e)
            setQrError('Error al canjear la tarjeta')
        } finally {
            setRedeemingQrId(null)
        }
    }

    // Función para hashear el PIN de manera consistente (misma lógica que CheckoutContent)
    const hashPin = async (pin: string): Promise<string> => {
        // Implementación de hash simple pero consistente
        const simpleHash = (str: string): string => {
            let hash = 0
            for (let i = 0; i < str.length; i++) {
                const char = str.charCodeAt(i)
                hash = ((hash << 5) - hash) + char
                hash = hash & hash // Convierte a 32bit entero
            }
            return Math.abs(hash).toString(16).padStart(8, '0')
        }

        // Para compatibilidad con hashes existentes, intentar usar SHA-256
        try {
            if (typeof window !== 'undefined' && window.crypto?.subtle?.digest) {
                // Si el hash existente del cliente tiene 64 caracteres, asumimos SHA-256
                if (clientFound?.pinHash?.length === 64) {
                    const encoder = new TextEncoder()
                    const data = encoder.encode(pin)
                    const hashBuffer = await window.crypto.subtle.digest('SHA-256', data)
                    const hashArray = Array.from(new Uint8Array(hashBuffer))
                    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
                }
            }
        } catch (e) {
            console.warn('Error usando Web Crypto API, usando hash simple', e)
        }

        // Por defecto, usar el hash simple
        return simpleHash(pin)
    }

    // Función para buscar cliente por teléfono (Misma lógica que CheckoutContent)
    async function handlePhoneSearch(phone: string) {
        if (!phone.trim()) {
            setClientFound(null);
            setShowNameField(false);
            return;
        }

        const normalizedPhone = normalizeEcuadorianPhone(phone);
        setPinAttempted(false);

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
            console.error('Error searching client in cart:', error);
            setClientFound(null);
            setShowNameField(true);
        } finally {
            setClientSearching(false);
        }
    }

    // Handle registering or setting PIN from cart (Misma lógica que CheckoutContent)
    const handleCheckoutRegisterOrSetPin = async () => {
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
                try {
                    if (customerData.name && customerData.name.trim()) {
                        await updateClient(clientFound.id, { nombres: customerData.name.trim() })
                    }
                } catch (e) {
                    console.warn('Could not update client name before setting PIN in cart', e)
                }
                await setClientPin(clientFound.id, pinHash)
                const updated = await searchClientByPhone(normalizedPhone)
                if (updated) {
                    login(updated as any)
                    setClientFound(updated)
                    setShowNameField(false)

                    // Actualizar sesión local
                    localStorage.setItem('loginPhone', normalizedPhone)
                    localStorage.setItem('clientData', JSON.stringify(updated))
                    setLocalClientId(normalizedPhone)
                    setLocalClientProfile(updated)
                }
            } else {
                const newClient = await createClient({ celular: normalizedPhone, nombres: customerData.name, pinHash })
                login(newClient as any)
                setClientFound(newClient as any)
                setShowNameField(false)

                // Actualizar sesión local
                localStorage.setItem('loginPhone', normalizedPhone)
                localStorage.setItem('clientData', JSON.stringify(newClient))
                setLocalClientId(normalizedPhone)
                setLocalClientProfile(newClient)
            }
        } catch (e: any) {
            console.error('Error in cart registration:', e)
            setRegisterError('Error al procesar el registro: ' + (e.message || 'Intenta de nuevo'))
        } finally {
            setRegisterLoading(false)
        }
    }

    // Función para login con PIN
    const handleCheckoutLoginWithPin = async () => {
        if (!loginPin || loginPin.length < 4) {
            setLoginPinError('El PIN debe tener al menos 4 dígitos')
            setPinAttempted(true)
            return
        }

        setLoginPinLoading(true)
        setLoginPinError('')

        try {
            const normalizedPhone = normalizeEcuadorianPhone(customerData.phone)

            // Ya deberíamos tener clientFound por handlePhoneSearch, pero por seguridad verificamos
            const client = clientFound || await searchClientByPhone(normalizedPhone)

            if (!client) {
                setLoginPinError('No se encontró un cliente con este teléfono')
                setPinAttempted(true)
                setLoginPinLoading(false)
                return
            }

            if (!client.pinHash) {
                setLoginPinError('Este cliente no tiene un PIN configurado')
                setPinAttempted(true)
                setLoginPinLoading(false)
                return
            }

            const currentHash = await hashPin(loginPin)

            if (currentHash === client.pinHash) {
                // Éxito
                localStorage.setItem('loginPhone', normalizedPhone)
                localStorage.setItem('clientData', JSON.stringify(client))
                setLocalClientId(normalizedPhone)
                setLocalClientProfile(client)

                // Sincronizar con AuthContext global
                login(client)

                // Resetear estados locales
                setLoginPin('')
                setLoginPinError('')
                setPinAttempted(false)
            } else {
                setLoginPinError('PIN incorrecto')
                setPinAttempted(true)
            }
        } catch (error) {
            console.error('Error during checkout login:', error)
            setLoginPinError('Ocurrió un error al verificar el PIN')
        } finally {
            setLoginPinLoading(false)
        }
    }

    // Función para resetear PIN (Misma lógica que CheckoutContent)
    const handleCheckoutResetPin = async () => {
        if (!clientFound?.id) return;

        const confirmReset = confirm('¿Estás seguro de que quieres resetear tu PIN? Se eliminará tu PIN actual y deberás crear uno nuevo.')
        if (!confirmReset) return

        try {
            setLoginPinLoading(true)
            await registerClientForgotPin(clientFound.id)
            await clearClientPin(clientFound.id)

            // Refrescar UI para mostrar flujo de crear PIN
            setClientFound((prev: any | null) => (prev ? { ...prev, pinHash: null } : prev))
            setLoginPin('')
            setLoginPinError('')
            setShowNameField(true)

            alert('Tu PIN ha sido eliminado. Ahora puedes crear uno nuevo.')
        } catch (e) {
            console.error('Error al limpiar PIN en carrito:', e)
            setLoginPinError('No se pudo restablecer el PIN. Intenta nuevamente.')
        } finally {
            setLoginPinLoading(false)
        }
    }

    const clientProfile = (user as any) || localClientProfile
    const clientDisplayName = (clientProfile?.nombres || '').trim() || 'Cliente'
    const clientInitials = clientDisplayName
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map((p: string) => p[0]?.toUpperCase())
        .join('')

    const isDarkColor = (hex?: string) => {
        if (!hex) return false
        const c = hex.replace('#', '')
        if (c.length !== 6) return false
        const r = parseInt(c.slice(0, 2), 16)
        const g = parseInt(c.slice(2, 4), 16)
        const b = parseInt(c.slice(4, 6), 16)
        const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
        return luminance < 0.55
    }

    if (!isOpen) return null

    return (
        <div className="fixed inset-0 z-50 overflow-hidden">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300" onClick={onClose} />
            <div className="absolute right-0 top-0 h-full w-full sm:w-[450px] bg-gray-50 shadow-2xl transform transition-transform duration-300">
                <div className="h-full overflow-y-auto scrollbar-hide">
                    <div className="min-h-full flex flex-col">

                        {/* Header */}
                        <div className="px-6 pt-6 pb-4 bg-white sticky top-0 z-10 border-b border-gray-100 shadow-sm">
                            <div className="flex items-center justify-between">
                                {/* Left: Back Button + Store Name */}
                                <div className="flex items-center gap-3">
                                    <button
                                        onClick={() => {
                                            if (view === 'checkout') {
                                                setView('cart')
                                            } else {
                                                onClose()
                                            }
                                        }}
                                        className="p-2 -ml-2 text-gray-800 hover:bg-gray-100 rounded-full transition-colors"
                                    >
                                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                                        </svg>
                                    </button>
                                    <h3 className="text-lg font-bold text-gray-900 leading-none">
                                        {view === 'checkout' ? 'Checkout' : business?.name}
                                    </h3>
                                </div>

                                {/* Right: User Profile */}
                                {(clientProfile || clientId) && (
                                    <div className="w-10 h-10 rounded-full overflow-hidden border border-gray-200 bg-gray-100 flex items-center justify-center">
                                        {clientProfile?.photoURL ? (
                                            <img
                                                src={clientProfile.photoURL}
                                                alt={clientDisplayName}
                                                className="w-full h-full object-cover"
                                                onError={(e) => {
                                                    const target = e.target as HTMLImageElement
                                                    target.style.display = 'none'
                                                }}
                                            />
                                        ) : clientInitials ? (
                                            <span className="text-xs font-black text-gray-700">{clientInitials}</span>
                                        ) : (
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
                                                <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                                            </svg>
                                        )}
                                    </div>
                                )}
                            </div>


                        </div>

                        {/* Cart Content */}
                        <div className="flex-1 px-6 py-6">
                            {view === 'checkout' ? (
                                <CheckoutContent
                                    embeddedBusinessId={business?.id}
                                    embeddedBusiness={business}
                                    embeddedCartItems={cart}
                                    onEmbeddedBack={() => setView('cart')}
                                    onClearCart={() => {
                                        setView('cart')
                                        onClose()
                                    }}
                                />
                            ) : cart.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-20 text-center">
                                    <div className="w-32 h-32 bg-white rounded-full shadow-sm flex items-center justify-center mb-6">
                                        <i className="bi bi-cart text-5xl text-gray-300"></i>
                                    </div>
                                    <h4 className="text-xl font-bold text-gray-900 mb-2">Tu carrito está vacío</h4>
                                    <p className="text-gray-500 max-w-[200px]">¡Descubre nuestros productos y empieza a llenar tu pedido!</p>
                                    <button
                                        onClick={onClose}
                                        className="mt-8 px-8 py-3 bg-gray-900 text-white rounded-xl font-medium hover:bg-gray-800 transition-colors shadow-lg shadow-gray-200"
                                    >
                                        Explorar Menú
                                    </button>
                                </div>
                            ) : (
                                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                                    <div className="divide-y divide-gray-50">
                                        {[...cart]
                                            .sort((a, b) => {
                                                if (a.esPremio && !b.esPremio) return 1;
                                                if (!a.esPremio && b.esPremio) return -1;
                                                return 0;
                                            })
                                            .map((item, index) => {
                                                const isTarjeta = !!item.qrCodeId;
                                                const isRegalo = item.esPremio && !isTarjeta;
                                                // Se muestra solo la variante si existe, o el nombre del producto si es único
                                                const displayName = isRegalo || isTarjeta
                                                    ? item.name
                                                    : (item.variantName ? item.variantName : (item.productName || item.name));

                                                return (
                                                    <div
                                                        key={`${item.id}-${item.variantName || index}`}
                                                        className={`p-4 flex items-center gap-3 transition-all ${isTarjeta ? 'bg-blue-50/30' : isRegalo ? 'bg-amber-50/30' : ''}`}
                                                    >
                                                        {/* Imagen del producto */}
                                                        <div className="w-12 h-12 rounded-xl overflow-hidden bg-gray-50 flex-shrink-0 border border-gray-100">
                                                            <img
                                                                src={item.image || business?.image}
                                                                alt={displayName}
                                                                className="w-full h-full object-cover"
                                                                onError={(e) => {
                                                                    const target = e.target as HTMLImageElement
                                                                    if (target.src !== business?.image) target.src = business?.image || ''
                                                                }}
                                                            />
                                                        </div>

                                                        {/* Información del item */}
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center flex-wrap gap-x-2 gap-y-1">
                                                                <p className={`font-bold text-sm leading-tight ${isTarjeta ? 'text-blue-900' : isRegalo ? 'text-amber-900' : 'text-gray-900'}`}>
                                                                    {displayName}
                                                                </p>
                                                                {isTarjeta ? (
                                                                    <span className="text-[9px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-black uppercase tracking-wider border border-blue-200">
                                                                        Tarjeta
                                                                    </span>
                                                                ) : isRegalo ? (
                                                                    <span className="text-[9px] bg-amber-200 text-amber-800 px-1.5 py-0.5 rounded font-black uppercase tracking-wider">
                                                                        Regalo
                                                                    </span>
                                                                ) : null}
                                                            </div>
                                                            <div className="flex items-center justify-between mt-1">
                                                                <span className="font-medium text-gray-600 text-sm">
                                                                    {item.price === 0 ? 'Gratis' : `$${(item.price * item.quantity).toFixed(2)}`}
                                                                </span>
                                                            </div>
                                                        </div>

                                                        {/* Controles de cantidad y eliminar */}
                                                        <div className="flex items-center gap-2">
                                                            {!item.esPremio ? (
                                                                <div className="flex items-center bg-gray-100 rounded-lg p-0.5 scale-90">
                                                                    <button
                                                                        onClick={() => updateQuantity(item.id, item.quantity - 1, item.variantName)}
                                                                        className="w-7 h-7 flex items-center justify-center bg-white rounded-md text-gray-600 shadow-sm hover:text-red-500 disabled:opacity-50"
                                                                        disabled={item.quantity <= 1}
                                                                    >
                                                                        −
                                                                    </button>
                                                                    <span className="w-7 text-center font-bold text-sm text-gray-900">
                                                                        {item.quantity}
                                                                    </span>
                                                                    <button
                                                                        onClick={() => updateQuantity(item.id, item.quantity + 1, item.variantName)}
                                                                        className="w-7 h-7 flex items-center justify-center bg-white rounded-md text-gray-600 shadow-sm hover:text-green-600"
                                                                    >
                                                                        +
                                                                    </button>
                                                                </div>
                                                            ) : (
                                                                <span className={`font-bold text-xs px-2 ${isTarjeta ? 'text-blue-900' : 'text-amber-900'}`}>x1</span>
                                                            )}

                                                            <button
                                                                onClick={() => removeFromCart(item.id, item.variantName)}
                                                                className="w-8 h-8 flex items-center justify-center text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                                                            >
                                                                <i className="bi bi-trash"></i>
                                                            </button>
                                                        </div>
                                                    </div>
                                                )
                                            })}
                                    </div>
                                </div>
                            )}

                            {view === 'cart' && (
                                <div className="mt-8">
                                    {/* Si no hay usuario loggeado, mostrar prompt de login para QR */}
                                    {!clientId ? (
                                        <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
                                            <div className="flex items-center gap-3 mb-4">
                                                <div className="w-10 h-10 rounded-full bg-amber-50 flex items-center justify-center border border-amber-100">
                                                    <i className="bi bi-gift-fill text-xl text-amber-600"></i>
                                                </div>
                                                <div className="flex-1">
                                                    <h4 className="font-bold text-gray-900">¿Tienes un QR canjeable?</h4>
                                                    <p className="text-xs text-gray-500 mt-0.5">Inicia sesión para ver tus tarjetas</p>
                                                </div>
                                            </div>

                                            <div className="space-y-4">
                                                <div>
                                                    <label className="block text-sm font-medium text-gray-700 mb-2">Número de Celular</label>
                                                    <div className="flex gap-2">
                                                        <div className="relative flex-1">
                                                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                                                                <i className="bi bi-phone"></i>
                                                            </span>
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
                                                                className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent transition-all"
                                                                placeholder="0912345678"
                                                                maxLength={10}
                                                                disabled={!!clientFound}
                                                            />
                                                        </div>
                                                        {clientFound && (
                                                            <button
                                                                onClick={() => {
                                                                    setClientFound(null)
                                                                    setCustomerData({ name: '', phone: '' })
                                                                    setShowNameField(false)
                                                                    setPinAttempted(false)
                                                                }}
                                                                className="px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded-xl transition-colors"
                                                            >
                                                                Cambiar
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>

                                                {customerData.phone.trim() && (
                                                    <div className="animate-fadeIn">
                                                        {clientSearching && (
                                                            <p className="text-blue-500 text-xs mb-2">Buscando cliente...</p>
                                                        )}

                                                        {!clientSearching && clientFound && clientFound.pinHash && (
                                                            <div className="space-y-3">
                                                                <p className="text-sm text-gray-700">Hola <strong>{clientFound.nombres || clientFound.celular}</strong></p>
                                                                <label className="block text-sm font-medium text-gray-700">Ingresa tu PIN</label>
                                                                <input
                                                                    type="password"
                                                                    value={loginPin}
                                                                    onChange={(e) => setLoginPin(e.target.value)}
                                                                    maxLength={6}
                                                                    className="w-full px-3 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500"
                                                                    placeholder="••••"
                                                                    onKeyPress={(e) => e.key === 'Enter' && loginPin.length >= 4 && handleCheckoutLoginWithPin()}
                                                                />
                                                                {pinAttempted && (
                                                                    <div className="text-right">
                                                                        <button
                                                                            type="button"
                                                                            onClick={handleCheckoutResetPin}
                                                                            className="text-xs text-gray-500 hover:text-red-500 transition-colors"
                                                                        >
                                                                            ¿Olvidaste tu PIN?
                                                                        </button>
                                                                    </div>
                                                                )}
                                                                {loginPinError && <p className="text-red-500 text-xs">{loginPinError}</p>}
                                                                <button
                                                                    onClick={handleCheckoutLoginWithPin}
                                                                    disabled={loginPin.length < 4 || loginPinLoading}
                                                                    className="w-full px-4 py-2 bg-red-500 text-white rounded-xl hover:bg-red-600 transition-colors disabled:opacity-50"
                                                                >
                                                                    {loginPinLoading ? 'Verificando...' : 'Iniciar sesión'}
                                                                </button>
                                                            </div>
                                                        )}

                                                        {!clientSearching && (showNameField || (clientFound && !clientFound.pinHash)) && (
                                                            <div className="space-y-3">
                                                                {clientFound && (
                                                                    <p className="text-sm text-gray-700">Hola <strong>{clientFound.celular}</strong>. Por favor completa tus datos:</p>
                                                                )}
                                                                <div>
                                                                    <label className="block text-sm font-medium text-gray-700 mb-1">Nombre Completo *</label>
                                                                    <input
                                                                        type="text"
                                                                        value={customerData.name}
                                                                        onChange={(e) => setCustomerData({ ...customerData, name: e.target.value })}
                                                                        className="w-full px-3 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500"
                                                                        placeholder="Juan Pérez"
                                                                    />
                                                                </div>
                                                                <div>
                                                                    <label className="block text-sm font-medium text-gray-700 mb-1">Crea un PIN (4-6 dígitos)</label>
                                                                    <input
                                                                        type="password"
                                                                        value={registerPin}
                                                                        onChange={(e) => setRegisterPin(e.target.value)}
                                                                        maxLength={6}
                                                                        className="w-full px-3 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500"
                                                                        placeholder="••••"
                                                                    />
                                                                </div>
                                                                <div>
                                                                    <label className="block text-sm font-medium text-gray-700 mb-1">Confirmar PIN</label>
                                                                    <input
                                                                        type="password"
                                                                        value={registerPinConfirm}
                                                                        onChange={(e) => setRegisterPinConfirm(e.target.value)}
                                                                        maxLength={6}
                                                                        className="w-full px-3 py-2 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500"
                                                                        placeholder="••••"
                                                                    />
                                                                </div>
                                                                {registerError && <p className="text-red-500 text-xs">{registerError}</p>}
                                                                <button
                                                                    onClick={handleCheckoutRegisterOrSetPin}
                                                                    disabled={registerLoading}
                                                                    className="w-full px-4 py-2 bg-red-500 text-white rounded-xl hover:bg-red-600 transition-colors disabled:opacity-50"
                                                                >
                                                                    {registerLoading ? 'Procesando...' : (clientFound ? 'Activar cuenta' : 'Registrarse')}
                                                                </button>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ) : (
                                        <div>
                                            <div className="flex items-center justify-between mb-3">
                                                <h4 className="font-bold text-gray-900">Tarjetas escaneadas</h4>
                                                {loadingQr && (
                                                    <span className="text-xs text-gray-400 font-bold">Cargando...</span>
                                                )}
                                            </div>

                                            {qrError && (
                                                <div className="mb-3 text-xs text-red-600 font-bold">
                                                    {qrError}
                                                </div>
                                            )}

                                            {!loadingQr && (!qrProgress || visibleQrCards.length === 0) ? (
                                                <p className="text-sm text-gray-500">
                                                    Aún no tienes tarjetas escaneadas.
                                                </p>
                                            ) : (
                                                <div className="overflow-x-auto scrollbar-hide -mx-6 px-6">
                                                    <div className="flex gap-4 pb-2 snap-x snap-mandatory">
                                                        {visibleQrCards.map((code) => {
                                                            const redeemed = (qrProgress?.redeemedPrizeCodes || []).includes(code.id)
                                                            const hasPrize = !!code.prize?.trim()
                                                            const isBeingRedeemedInThisOrder = qrPrizeIdsInCart.includes(code.id)
                                                            const canRedeem = hasPrize && !redeemed && !isBeingRedeemedInThisOrder
                                                            const dark = isDarkColor(code.color)
                                                            const cardBg = isBeingRedeemedInThisOrder ? '#E5E7EB' : (code.color || '#F3F4F6')
                                                            const cardTextDark = isBeingRedeemedInThisOrder ? false : dark

                                                            return (
                                                                <div
                                                                    key={code.id}
                                                                    className="min-w-[260px] max-w-[260px] snap-start rounded-2xl p-4 shadow-sm border border-black/5"
                                                                    style={{ backgroundColor: cardBg }}
                                                                >
                                                                    <div className="flex items-center gap-3">
                                                                        <div className="w-12 h-12 rounded-xl overflow-hidden bg-white/80 border border-white/40 flex-shrink-0">
                                                                            <img
                                                                                src={code.image || business?.image || 'https://via.placeholder.com/80?text=QR'}
                                                                                alt={code.prize || code.name}
                                                                                className="w-full h-full object-cover"
                                                                                loading="lazy"
                                                                                decoding="async"
                                                                                onError={(e) => {
                                                                                    const target = e.target as HTMLImageElement
                                                                                    target.src = business?.image || 'https://via.placeholder.com/80?text=QR'
                                                                                }}
                                                                            />
                                                                        </div>

                                                                        <div className="min-w-0 flex-1">
                                                                            <p className={`text-sm font-black truncate ${cardTextDark ? 'text-white' : 'text-gray-900'}`}>🎫 {code.name}</p>
                                                                            {hasPrize ? (
                                                                                <p className={`text-xs truncate ${cardTextDark ? 'text-white/90' : 'text-gray-700'}`}>Premio: {code.prize}</p>
                                                                            ) : (
                                                                                <p className={`text-xs truncate ${cardTextDark ? 'text-white/70' : 'text-gray-500'}`}>Sin premio configurado</p>
                                                                            )}
                                                                            {isBeingRedeemedInThisOrder ? (
                                                                                <p className="text-[10px] font-black uppercase tracking-widest mt-1 text-gray-500">En canje</p>
                                                                            ) : redeemed ? (
                                                                                <p className={`text-[10px] font-black uppercase tracking-widest mt-1 ${cardTextDark ? 'text-white/70' : 'text-gray-500'}`}>Canjeado</p>
                                                                            ) : null}
                                                                        </div>
                                                                    </div>

                                                                    <div className="mt-4">
                                                                        <button
                                                                            onClick={() => handleRedeemQrPrize(code)}
                                                                            disabled={!canRedeem || redeemingQrId === code.id || isBeingRedeemedInThisOrder}
                                                                            className={`w-full px-3 py-2 rounded-xl text-[10px] font-black uppercase transition-colors disabled:cursor-not-allowed ${dark
                                                                                ? 'bg-white text-gray-900 hover:bg-white/90 disabled:bg-white/50'
                                                                                : 'bg-gray-900 text-white hover:bg-black disabled:bg-gray-300'
                                                                                }`}
                                                                        >
                                                                            {isBeingRedeemedInThisOrder
                                                                                ? 'En carrito'
                                                                                : (redeemingQrId === code.id ? 'Canjeando...' : (hasPrize ? 'Canjear' : 'No disponible'))}
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            )
                                                        })}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Footer */}
                        {cart.length > 0 && view === 'cart' && (
                            <div className="mt-auto bg-white border-t border-gray-100 p-6 pb-8 space-y-6">
                                {/* Resumen */}
                                <div className="space-y-3">
                                    <div className="flex justify-between text-gray-600">
                                        <span>Subtotal</span>
                                        <span className="font-medium text-gray-900">${cartTotal.toFixed(2)}</span>
                                    </div>
                                    <div className="flex justify-between text-gray-600">
                                        <span>Envío</span>
                                        <span className="text-gray-400 text-sm">Calculado al finalizar</span>
                                    </div>
                                    <div className="pt-4 border-t border-gray-100 flex justify-between items-end">
                                        <div>
                                            <span className="block text-sm text-gray-500 mb-1">Total a pagar</span>
                                            <span className="text-3xl font-bold text-gray-900 tracking-tight">${cartTotal.toFixed(2)}</span>
                                        </div>
                                    </div>
                                </div>

                                {/* Actions */}
                                {cartTotal > 0 ? (
                                    <button
                                        type="button"
                                        className="block w-full bg-gray-900 text-white py-4 rounded-2xl hover:bg-gray-800 transition-all duration-200 text-center font-bold text-lg shadow-xl shadow-gray-200 transform active:scale-[0.98]"
                                        onClick={() => setView('checkout')}
                                    >
                                        Continuar con el pedido
                                    </button>
                                ) : (
                                    <button
                                        onClick={onClose}
                                        className="block w-full bg-gray-100 text-gray-500 py-4 rounded-2xl hover:bg-gray-200 transition-all duration-200 font-medium text-lg"
                                    >
                                        Agrega productos para continuar
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
