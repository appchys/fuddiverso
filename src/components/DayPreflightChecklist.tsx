'use client'

import React, { useState, useMemo } from 'react'
import { Business, Order } from '@/types'
import { isStoreOpen, getStoreStatusDescription } from '@/lib/store-utils'

interface DayPreflightChecklistProps {
    business: Business | null
    onToggleStoreStatus: () => void
    updatingStoreStatus: boolean
    onUpdateDeliveryTime: (minutes: number) => void
    updatingDeliveryTime: boolean
    onGoToProducts: () => void
    historicalOrders?: Order[]
}

export default function DayPreflightChecklist({
    business,
    onToggleStoreStatus,
    updatingStoreStatus,
    onUpdateDeliveryTime,
    updatingDeliveryTime,
    onGoToProducts,
    historicalOrders = []
}: DayPreflightChecklistProps) {
    const storeOpen = isStoreOpen(business)
    const statusDescription = getStoreStatusDescription(business)
    const deliveryTime = business?.deliveryTime || 30
    const [linkCopied, setLinkCopied] = useState(false)

    // Get greeting based on time of day
    const hour = new Date().getHours()
    const greeting = hour < 12 ? '¡Buenos días' : hour < 18 ? '¡Buenas tardes' : '¡Buenas noches'

    // Build store URL dynamically
    const storeUrl = typeof window !== 'undefined' && business?.username
        ? `${window.location.origin}/${business.username}`
        : ''

    // Top 3 best-selling products from historical orders
    const topProducts = useMemo(() => {
        const counts: Record<string, { name: string; slug?: string; productId: string; quantity: number; image?: string }> = {}

        historicalOrders.forEach(order => {
            order.items?.forEach(item => {
                const itemAny = item as any
                const productId = itemAny.productId || item.product?.id
                if (!productId) return

                // Handle variants logic: Group by ProductID + VariantName
                // If variant exists, use it as unique key part
                const variantName = itemAny.variant // e.g. "Grande", "Pollo", etc.
                const key = variantName ? `${productId}-${variantName}` : productId

                // Determine display name
                // User requirement: "si tiene variante, mostrar variante como principal. Si no, nombre producto"
                const productName = itemAny.name || item.product?.name
                const displayName = variantName ? variantName : productName

                if (!displayName) return

                if (!counts[key]) {
                    counts[key] = {
                        name: displayName,
                        slug: itemAny.slug || item.product?.slug,
                        productId: key, // Use composite key as unique ID for rendering
                        quantity: 0,
                        image: itemAny.image || item.product?.image
                    }
                }
                counts[key].quantity += (item.quantity || 1)
            })
        })

        return Object.values(counts)
            .sort((a, b) => b.quantity - a.quantity)
            .slice(0, 3)
    }, [historicalOrders])

    const handleCopyLink = async () => {
        if (!storeUrl) return
        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(storeUrl)
            } else {
                const textArea = document.createElement('textarea')
                textArea.value = storeUrl
                textArea.style.position = 'fixed'
                textArea.style.opacity = '0'
                document.body.appendChild(textArea)
                textArea.focus()
                textArea.select()
                document.execCommand('copy')
                document.body.removeChild(textArea)
            }
            setLinkCopied(true)
            setTimeout(() => setLinkCopied(false), 2000)
        } catch (err) {
            console.error('Error copying link:', err)
        }
    }

    const handleShareWhatsApp = () => {
        if (!storeUrl || !business) return
        const message = `¡Hola! 👋 Mira nuestro menú de hoy en ${business.name} aquí: ${storeUrl}`
        window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank')
    }

    const handlePromoteProduct = (product: { name: string; slug?: string; productId: string }) => {
        if (!storeUrl || !business) return
        // Extract raw productId if it's a composite key (though URL usually takes ID or slug)
        // If it's a variant, we might want to link to main product. 
        // Our key is "ID-Variant". slug might be just plain slug.
        // Usually slug points to product page.
        const productUrl = `${storeUrl}/${product.slug || product.productId.split('-')[0]}`
        const message = `¡El favorito de hoy! 🔥 Nuestro ${product.name} es lo más pedido. Pide el tuyo aquí: ${productUrl}`
        window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank')
    }

    return (
        <div className="space-y-6 animate-fade-in max-w-4xl mx-auto pb-8">
            {/* Hero Header with OrderPublicClient style */}
            <div className="relative overflow-hidden bg-gradient-to-br from-red-500 to-rose-600 rounded-3xl shadow-xl mx-4 sm:mx-0">
                {/* Decorative backgrounds */}
                <div className="absolute top-0 right-0 w-40 h-40 bg-white/10 rounded-full -translate-y-1/2 translate-x-1/2"></div>
                <div className="absolute bottom-0 left-0 w-32 h-32 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/2"></div>

                <div className="relative z-10 px-6 py-8 text-center text-white">
                    <div className="text-4xl mb-3 filter drop-shadow-md">☀️</div>
                    <h2 className="text-2xl font-black uppercase tracking-tight mb-2">
                        {greeting}, {business?.name || 'Tienda'}!
                    </h2>
                    <p className="text-red-100 font-medium text-sm">Prepárate para recibir pedidos. Revisa tu operación antes de empezar.</p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 px-4 sm:px-0">
                {/* Card 1: Estado del Local */}
                <div className={`rounded-2xl border p-5 transition-all shadow-sm group hover:shadow-md ${storeOpen
                    ? 'bg-white border-green-100'
                    : 'bg-white border-orange-100'
                    }`}>
                    <div className="flex items-center gap-3 mb-4">
                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-xl shadow-sm border transaction-colors ${storeOpen
                            ? 'bg-green-50 text-green-600 border-green-100'
                            : 'bg-orange-50 text-orange-600 border-orange-100'
                            }`}>
                            <i className={`bi ${storeOpen ? 'bi-shop' : 'bi-shop-window'}`}></i>
                        </div>
                        <div>
                            <h3 className="font-black text-gray-900 text-xs uppercase tracking-widest">Estado del Local</h3>
                            <p className={`text-sm font-bold ${storeOpen ? 'text-green-600' : 'text-orange-600'}`}>
                                {statusDescription}
                            </p>
                        </div>
                    </div>

                    {storeOpen ? (
                        <div className="flex items-center gap-3 bg-green-50/50 rounded-xl px-4 py-3 border border-green-100">
                            <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                                <i className="bi bi-check-lg text-green-600 text-xs font-black"></i>
                            </div>
                            <span className="text-xs font-bold text-green-700 leading-tight">
                                Tienda lista para vender
                            </span>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <p className="text-xs text-gray-500 leading-relaxed font-medium">
                                Tu tienda está cerrada. ¿Deseas abrirla manualmente?
                            </p>
                            <button
                                onClick={onToggleStoreStatus}
                                disabled={updatingStoreStatus}
                                className="w-full py-2.5 px-4 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-xl font-bold text-xs uppercase tracking-wider hover:shadow-lg hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50 shadow-md shadow-green-200"
                            >
                                {updatingStoreStatus ? (
                                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                                ) : (
                                    <>
                                        <i className="bi bi-unlock-fill"></i>
                                        Abrir tienda
                                    </>
                                )}
                            </button>
                        </div>
                    )}
                </div>

                {/* Card 2: Tiempo de Entrega */}
                <div className="rounded-2xl border border-gray-100 bg-white p-5 transition-all shadow-sm hover:shadow-md group">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center text-xl shadow-sm border border-blue-100">
                            <i className="bi bi-clock-history"></i>
                        </div>
                        <div>
                            <h3 className="font-black text-gray-900 text-xs uppercase tracking-widest">Tiempo de Entrega</h3>
                            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Estimación manual</p>
                        </div>
                    </div>

                    <div className="flex items-center justify-center gap-3 mb-3 bg-gray-50 rounded-2xl p-2 border border-gray-100">
                        <button
                            onClick={() => onUpdateDeliveryTime(-5)}
                            disabled={updatingDeliveryTime || deliveryTime <= 10}
                            className="w-10 h-10 rounded-xl bg-white text-gray-600 border border-gray-200 shadow-sm font-black text-lg hover:text-blue-600 hover:border-blue-200 active:scale-95 transition-all disabled:opacity-30 flex items-center justify-center"
                        >
                            −
                        </button>
                        <div className="text-center min-w-[70px]">
                            <span className="text-2xl font-black text-gray-900">{deliveryTime}</span>
                            <span className="text-[10px] text-gray-400 block font-bold uppercase tracking-wider -mt-1">min</span>
                        </div>
                        <button
                            onClick={() => onUpdateDeliveryTime(5)}
                            disabled={updatingDeliveryTime}
                            className="w-10 h-10 rounded-xl bg-white text-gray-600 border border-gray-200 shadow-sm font-black text-lg hover:text-blue-600 hover:border-blue-200 active:scale-95 transition-all disabled:opacity-30 flex items-center justify-center"
                        >
                            +
                        </button>
                    </div>

                    {deliveryTime !== 30 && (
                        <button
                            onClick={() => onUpdateDeliveryTime(0)}
                            disabled={updatingDeliveryTime}
                            className="w-full text-[10px] text-blue-500 font-bold uppercase tracking-widest hover:text-blue-600 disabled:opacity-50 transition-all flex items-center justify-center gap-1"
                        >
                            <i className="bi bi-arrow-counterclockwise"></i>
                            Restaurar a 30 min
                        </button>
                    )}
                </div>

                {/* Card 3: Revisar Productos */}
                <div className="rounded-2xl border border-gray-100 bg-white p-5 transition-all shadow-sm hover:shadow-md group">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-12 h-12 rounded-2xl bg-purple-50 text-purple-600 flex items-center justify-center text-xl shadow-sm border border-purple-100">
                            <i className="bi bi-box-seam"></i>
                        </div>
                        <div>
                            <h3 className="font-black text-gray-900 text-xs uppercase tracking-widest">Inventario</h3>
                            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Disponibilidad</p>
                        </div>
                    </div>

                    <p className="text-xs text-gray-500 mb-4 leading-relaxed font-medium">
                        Verifica precios y stock para evitar cancelaciones.
                    </p>

                    <button
                        onClick={onGoToProducts}
                        className="w-full py-2.5 px-4 bg-purple-50 text-purple-700 border border-purple-100 rounded-xl font-bold text-xs uppercase tracking-wider hover:bg-purple-100 active:scale-[0.98] transition-all flex items-center justify-center gap-2 group-hover:border-purple-200"
                    >
                        <i className="bi bi-check2-square text-lg"></i>
                        Revisar ahora
                    </button>
                </div>
            </div>

            {/* Marketing Section: Impulsa tus ventas hoy */}
            {business?.username && (
                <div className="mx-4 sm:mx-0 rounded-3xl border border-red-100 bg-gradient-to-b from-white to-red-50/30 p-6 shadow-sm overflow-hidden relative group">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-red-50/50 to-orange-50/50 rounded-full blur-3xl -z-10 translate-x-1/3 -translate-y-1/3 pointer-events-none"></div>

                    <div className="flex items-center gap-4 mb-6">
                        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-red-500 to-orange-500 text-white flex items-center justify-center shadow-lg shadow-red-200">
                            <i className="bi bi-megaphone-fill text-xl"></i>
                        </div>
                        <div>
                            <h3 className="font-black text-gray-900 uppercase tracking-tight text-lg">Impulsa tus ventas</h3>
                            <p className="text-sm text-gray-500 font-medium">Comparte tu tienda y consigue más pedidos</p>
                        </div>
                    </div>

                    {/* Share Row */}
                    <div className="flex flex-col sm:flex-row gap-3 mb-8">
                        {/* Store Link Display */}
                        <div className="flex-1 flex items-center bg-white rounded-xl border border-gray-200 px-4 py-3 min-w-0 shadow-sm">
                            <i className="bi bi-link-45deg text-gray-400 mr-3 text-xl flex-shrink-0"></i>
                            <span className="text-sm text-gray-600 truncate font-mono font-medium">{storeUrl}</span>
                        </div>

                        {/* Copy Link */}
                        <button
                            onClick={handleCopyLink}
                            className={`px-6 py-3 rounded-xl font-bold text-sm uppercase tracking-wider flex items-center justify-center gap-2 transition-all active:scale-[0.97] flex-shrink-0 shadow-sm ${linkCopied
                                ? 'bg-green-50 text-green-700 border border-green-200'
                                : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 hover:border-gray-300'
                                }`}
                        >
                            <i className={`bi ${linkCopied ? 'bi-check-lg' : 'bi-clipboard'}`}></i>
                            {linkCopied ? 'Copiado' : 'Copiar'}
                        </button>

                        {/* Share on WhatsApp */}
                        <button
                            onClick={handleShareWhatsApp}
                            className="px-6 py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-xl font-bold text-sm uppercase tracking-wider hover:shadow-lg hover:shadow-green-200 active:scale-[0.97] transition-all flex items-center justify-center gap-2 flex-shrink-0 shadow-md"
                        >
                            <i className="bi bi-whatsapp"></i>
                            Compartir
                        </button>
                    </div>

                    {/* Top Products */}
                    {topProducts.length > 0 && (
                        <div>
                            <div className="flex items-center gap-2 mb-4">
                                <i className="bi bi-trophy-fill text-amber-400"></i>
                                <p className="text-xs font-black text-gray-400 uppercase tracking-widest">
                                    Tus más vendidos
                                </p>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                {topProducts.map((product, idx) => (
                                    <div
                                        key={product.productId}
                                        className="flex items-center justify-between bg-white rounded-2xl border border-gray-100 p-3 hover:border-red-100 hover:shadow-md transition-all group/item"
                                    >
                                        <div className="flex items-center gap-3 min-w-0">
                                            {/* Product Image or Rank Badge */}
                                            {product.image ? (
                                                <div className="relative w-10 h-10 flex-shrink-0">
                                                    <img
                                                        src={product.image}
                                                        alt={product.name}
                                                        className="w-full h-full object-cover rounded-xl shadow-sm border border-gray-100"
                                                    />
                                                    <div className={`absolute -top-1 -left-1 w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-black border border-white ${idx === 0 ? 'bg-amber-400 text-amber-900' :
                                                        idx === 1 ? 'bg-gray-400 text-white' :
                                                            'bg-orange-400 text-white'
                                                        }`}>
                                                        #{idx + 1}
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className={`w-10 h-10 flex items-center justify-center rounded-xl text-sm font-black flex-shrink-0 shadow-sm ${idx === 0 ? 'bg-gradient-to-br from-amber-100 to-amber-50 text-amber-700' :
                                                    idx === 1 ? 'bg-gray-100 text-gray-600' :
                                                        'bg-orange-50 text-orange-600'
                                                    }`}>
                                                    #{idx + 1}
                                                </div>
                                            )}

                                            <div className="min-w-0">
                                                <p className="text-sm font-bold text-gray-900 truncate">{product.name}</p>
                                                <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">{product.quantity} ventas</p>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => handlePromoteProduct(product)}
                                            className="w-10 h-10 rounded-xl bg-green-50 text-green-600 hover:bg-green-500 hover:text-white hover:shadow-lg hover:shadow-green-200 transition-all flex items-center justify-center flex-shrink-0"
                                            title="Promocionar en WhatsApp"
                                        >
                                            <i className="bi bi-whatsapp text-lg"></i>
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
