'use client'

import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { QRCode, UserQRProgress } from '@/types'
import { getQRCodesByBusiness, getUserQRProgress, redeemQRCodePrize, unredeemQRCodePrize } from '@/lib/database'
import { normalizeEcuadorianPhone } from '@/lib/validation'
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
    const { user } = useAuth()

    const [view, setView] = useState<'cart' | 'checkout'>('cart')

    const [localClientId, setLocalClientId] = useState<string | null>(null)
    const [localClientProfile, setLocalClientProfile] = useState<any | null>(null)

    const [qrCodes, setQrCodes] = useState<QRCode[]>([])
    const [qrProgress, setQrProgress] = useState<UserQRProgress | null>(null)
    const [loadingQr, setLoadingQr] = useState(false)
    const [redeemingQrId, setRedeemingQrId] = useState<string | null>(null)
    const [qrError, setQrError] = useState<string>('')
    const [lastQrPrizeIdInCart, setLastQrPrizeIdInCart] = useState<string[]>([])

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
                                <div className="space-y-6">
                                    {(() => {
                                        const grouped: Record<string, any[]> = {}
                                        cart.forEach(item => {
                                            if (item.esPremio) {
                                                if (!grouped['___premio___']) grouped['___premio___'] = []
                                                grouped['___premio___'].push(item)
                                                return
                                            }
                                            const key = item.productName || item.name
                                            if (!grouped[key]) grouped[key] = []
                                            grouped[key].push(item)
                                        })

                                        return Object.entries(grouped)
                                            .sort(([a]) => (a === '___premio___' ? 1 : -1))
                                            .map(([productName, items], groupIndex) => {
                                                const isPremio = productName === '___premio___'
                                                const firstItem = items[0]

                                                return (
                                                    <div key={productName} className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                                                        {/* Header del producto */}
                                                        {!isPremio && (
                                                            <div className="flex items-center gap-3 mb-4 pb-3 border-b border-gray-50">
                                                                <div className="w-10 h-10 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
                                                                    <img
                                                                        src={firstItem.image || business?.image}
                                                                        alt={productName}
                                                                        className="w-full h-full object-cover"
                                                                        onError={(e) => {
                                                                            const target = e.target as HTMLImageElement
                                                                            if (target.src !== business?.image) target.src = business?.image || ''
                                                                        }}
                                                                    />
                                                                </div>
                                                                <h4 className="font-bold text-gray-900">{productName}</h4>
                                                            </div>
                                                        )}

                                                        {/* Items del producto */}
                                                        <div className="space-y-3">
                                                            {items.map((item) => (
                                                                <div
                                                                    key={`${item.id}-${item.variantName || 'original'}`}
                                                                    className={`flex items-start gap-3 ${item.esPremio ? 'bg-amber-50/50 p-3 rounded-xl border border-amber-100' : ''}`}
                                                                >
                                                                    {/* Info */}
                                                                    <div className="flex-1 min-w-0 pt-1">
                                                                        <div className="flex items-center gap-2">
                                                                            <p className={`font-medium text-sm leading-snug ${item.esPremio ? 'text-amber-900' : 'text-gray-700'}`}>
                                                                                {item.esPremio ? item.name : (item.variantName || item.name)}
                                                                            </p>
                                                                            {item.esPremio && (
                                                                                <span className="text-[10px] bg-amber-200 text-amber-800 px-1.5 py-0.5 rounded font-bold uppercase tracking-wide">
                                                                                    Regalo
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                        <div className="font-bold text-gray-900 mt-1">
                                                                            {item.price === 0 ? 'Gratis' : `$${(item.price * item.quantity).toFixed(2)}`}
                                                                        </div>
                                                                    </div>

                                                                    {/* Controles */}
                                                                    <div className="flex items-center gap-3">
                                                                        {!item.esPremio ? (
                                                                            <div className="flex items-center bg-gray-100 rounded-lg p-1">
                                                                                <button
                                                                                    onClick={() => updateQuantity(item.id, item.quantity - 1, item.variantName)}
                                                                                    className="w-7 h-7 flex items-center justify-center bg-white rounded-md text-gray-600 shadow-sm hover:text-red-500 transition-colors disabled:opacity-50"
                                                                                    disabled={item.quantity <= 1}
                                                                                >
                                                                                    −
                                                                                </button>
                                                                                <span className="w-8 text-center font-bold text-sm text-gray-900">
                                                                                    {item.quantity}
                                                                                </span>
                                                                                <button
                                                                                    onClick={() => updateQuantity(item.id, item.quantity + 1, item.variantName)}
                                                                                    className="w-7 h-7 flex items-center justify-center bg-white rounded-md text-gray-600 shadow-sm hover:text-green-600 transition-colors"
                                                                                >
                                                                                    +
                                                                                </button>
                                                                            </div>
                                                                        ) : (
                                                                            <span className="font-bold text-amber-900 text-sm px-2">x1</span>
                                                                        )}

                                                                        <button
                                                                            onClick={() => removeFromCart(item.id, item.variantName)}
                                                                            className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                                                                        >
                                                                            <i className="bi bi-trash"></i>
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )
                                            })
                                    })()}
                                </div>
                            )}

                            {view === 'cart' && clientId && (
                                <div className="mt-8">
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
