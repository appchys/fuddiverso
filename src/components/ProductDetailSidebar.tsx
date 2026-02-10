'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Product, Business } from '@/types'
import { normalizeEcuadorianPhone } from '@/lib/validation'
import { unredeemQRCodePrize, getProductsByBusiness } from '@/lib/database'

interface ProductDetailSidebarProps {
    isOpen: boolean
    onClose: () => void
    product: Product | null
    business: Business | null
    onProductSelect: (product: Product) => void
    onOpenCart?: () => void
}

export default function ProductDetailSidebar({ isOpen, onClose, product, business, onProductSelect, onOpenCart }: ProductDetailSidebarProps) {
    const router = useRouter()
    const [selectedVariant, setSelectedVariant] = useState<string | null>(null)
    const [quantity, setQuantity] = useState(1)
    const [cart, setCart] = useState<any[]>([])
    const [notification, setNotification] = useState<{ show: boolean; message: string; type: 'success' | 'error' }>({
        show: false,
        message: '',
        type: 'success'
    })
    const [copySuccess, setCopySuccess] = useState(false)
    const [otherProducts, setOtherProducts] = useState<Product[]>([])
    const sidebarContentRef = useRef<HTMLDivElement>(null)

    // Reset state when product changes
    useEffect(() => {
        if (product) {
            if (product.variants && product.variants.length > 0) {
                setSelectedVariant(product.variants[0].name)
            } else {
                setSelectedVariant(null)
            }
            setQuantity(1)

            // Scroll to top
            if (sidebarContentRef.current) {
                sidebarContentRef.current.scrollTo({ top: 0, behavior: 'smooth' })
            }
        }
    }, [product])

    // Manage body scroll
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden'
        } else {
            document.body.style.overflow = ''
        }
        return () => {
            document.body.style.overflow = ''
        }
    }, [isOpen])

    // Load cart for specific business
    useEffect(() => {
        if (business?.id && isOpen) {
            const loadCart = () => {
                const savedCarts = localStorage.getItem('carts')
                if (savedCarts) {
                    const allCarts = JSON.parse(savedCarts)
                    const businessCart = allCarts[business.id] || []
                    setCart(businessCart)
                } else {
                    setCart([])
                }
            }

            loadCart()
            // Listen for storage changes in case cart is updated elsewhere
            const handleStorageChange = () => loadCart()
            window.addEventListener('storage', handleStorageChange)
            return () => window.removeEventListener('storage', handleStorageChange)
        }
    }, [business?.id, isOpen])

    // Load other products for the business
    useEffect(() => {
        if (business?.id && isOpen && product?.id) {
            const fetchOtherProducts = async () => {
                try {
                    const products = await getProductsByBusiness(business.id)
                    setOtherProducts(products.filter(p => p.id !== product.id && p.isAvailable).slice(0, 10))
                } catch (error) {
                    console.error("Error fetching other products:", error)
                }
            }
            fetchOtherProducts()
        }
    }, [business?.id, isOpen, product?.id])


    const showNotification = (message: string, type: 'success' | 'error' = 'success') => {
        setNotification({ show: true, message, type })
        setTimeout(() => {
            setNotification({ show: false, message: '', type: 'success' })
        }, 3000)
    }

    const updateQuantity = (productIdToUpdate: string, newQuantity: number, variantName?: string | null) => {
        if (!business?.id) return

        if (newQuantity <= 0) {
            removeFromCart(productIdToUpdate, variantName)
            return
        }

        const newCart = cart.map(item =>
            (item.id === productIdToUpdate && item.variantName === variantName)
                ? { ...item, quantity: newQuantity }
                : item
        )

        setCart(newCart)
        updateCartInStorage(business.id, newCart)
    }

    const removeFromCart = (productIdToRemove: string, variantName?: string | null) => {
        if (!business?.id) return

        const itemToRemove = cart.find(item => item.id === productIdToRemove && item.variantName === variantName)
        const isPremioQr = itemToRemove?.esPremio === true && (itemToRemove?.qrCodeId || String(itemToRemove?.id || '').startsWith('premio-qr-'))
        const qrCodeIdToUnredeem = itemToRemove?.qrCodeId || (typeof itemToRemove?.id === 'string' && itemToRemove.id.startsWith('premio-qr-')
            ? itemToRemove.id.replace('premio-qr-', '')
            : null)

        const newCart = cart.filter(item => !(item.id === productIdToRemove && item.variantName === variantName))
        setCart(newCart)
        updateCartInStorage(business.id, newCart)

        if (isPremioQr && qrCodeIdToUnredeem) {
            try {
                const rawPhone = localStorage.getItem('loginPhone') || ''
                const phone = normalizeEcuadorianPhone(rawPhone)
                if (phone) {
                    void unredeemQRCodePrize(phone, business.id, qrCodeIdToUnredeem)
                        .catch((e) => console.error('Error unredeeming QR prize after cart removal:', e))
                }
            } catch (e) {
                console.error('Error reading loginPhone for unredeem:', e)
            }
        }
    }

    const updateCartInStorage = (businessId: string, businessCart: any[]) => {
        const savedCarts = localStorage.getItem('carts')
        const allCarts = savedCarts ? JSON.parse(savedCarts) : {}

        if (businessCart.length === 0) {
            delete allCarts[businessId]
        } else {
            allCarts[businessId] = businessCart
        }

        localStorage.setItem('carts', JSON.stringify(allCarts))
        // Dispatch storage event for other components to update
        window.dispatchEvent(new Event('storage'))
    }

    const handleCopyProductLink = async () => {
        if (!product || !business) return
        const productUrl = `${window.location.origin}/${business.username || `restaurant/${business.id}`}/${product.slug || product.id}`
        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(productUrl)
            } else {
                const textArea = document.createElement('textarea')
                textArea.value = productUrl
                textArea.style.position = 'fixed'
                textArea.style.opacity = '0'
                document.body.appendChild(textArea)
                textArea.focus()
                textArea.select()
                document.execCommand('copy')
                document.body.removeChild(textArea)
            }
            setCopySuccess(true)
            setTimeout(() => setCopySuccess(false), 2000)
        } catch (err) {
            console.error('Error al copiar enlace:', err)
        }
    }

    if (!isOpen || !product || !business) return null

    return (
        <div className="fixed inset-0 z-[120] overflow-hidden">
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300"
                onClick={onClose}
            />

            <div
                className={`fixed right-0 top-0 h-full w-full sm:w-[500px] bg-white shadow-2xl transform transition-transform duration-300 ease-in-out z-[130] ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
            >
                <div ref={sidebarContentRef} className="h-full overflow-y-auto scrollbar-hide bg-white">
                    <div className="min-h-full flex flex-col p-6 relative">

                        {/* Close Button */}
                        <button
                            onClick={onClose}
                            className="absolute top-4 right-4 w-10 h-10 rounded-full flex items-center justify-center bg-gray-100/80 hover:bg-gray-200 text-gray-600 transition-colors z-20 backdrop-blur-sm"
                            aria-label="Cerrar"
                        >
                            <i className="bi bi-x-lg"></i>
                        </button>

                        {/* Business Header */}
                        <div className="mb-6 flex items-center gap-3 pr-12">
                            <div className="w-10 h-10 rounded-full overflow-hidden border border-gray-100 flex-shrink-0 bg-white shadow-sm">
                                {business.image ? (
                                    <img src={business.image} alt={business.name} className="w-full h-full object-cover" />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center bg-gray-50 text-gray-400 font-bold">
                                        {business.name.charAt(0)}
                                    </div>
                                )}
                            </div>
                            <div>
                                <h3 className="text-sm font-black text-gray-900 leading-tight">{business.name}</h3>
                                {business.username && <p className="text-xs text-gray-400">@{business.username}</p>}
                            </div>
                        </div>

                        {/* Product Image */}
                        <div className="w-full aspect-square bg-gray-50 rounded-[2rem] overflow-hidden shadow-sm border border-gray-100 mb-6 relative">
                            {product.image ? (
                                <img src={product.image} alt={product.name} className="w-full h-full object-cover" />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center text-gray-200">
                                    <i className="bi bi-image text-6xl"></i>
                                </div>
                            )}
                            {/* Share Button */}
                            <button
                                onClick={handleCopyProductLink}
                                className="absolute bottom-4 right-4 bg-white/90 backdrop-blur-md p-2 rounded-full shadow-sm text-gray-500 hover:text-gray-900 transition-colors"
                                title="Compartir"
                            >
                                <i className={`bi ${copySuccess ? 'bi-check-lg text-emerald-500' : 'bi-share'}`}></i>
                            </button>
                        </div>

                        {/* Product Info */}
                        <div className="mb-6">
                            <div className="flex items-center gap-2 mb-2">
                                {product.category && (
                                    <span className="px-2 py-0.5 bg-red-50 text-red-600 text-[10px] font-black uppercase tracking-widest rounded-full">
                                        {product.category}
                                    </span>
                                )}
                                <span className={`px-2 py-0.5 text-[10px] font-black uppercase tracking-widest rounded-full ${product.isAvailable ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
                                    {product.isAvailable ? 'Disponible' : 'No disponible'}
                                </span>
                            </div>
                            <h2 className="text-2xl font-black text-gray-900 leading-tight mb-2">{product.name}</h2>
                            {product.description && (
                                <p className="text-sm text-gray-500 font-medium leading-relaxed">{product.description}</p>
                            )}
                        </div>

                        {/* Variants & Actions */}
                        <div className="space-y-4">
                            {product.variants && product.variants.length > 0 ? (
                                <div>
                                    <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-3">
                                        Opciones
                                    </label>
                                    <div className="space-y-3">
                                        {product.variants.map((variant) => {
                                            const cartItem = cart.find(item => item.id === product.id && item.variantName === variant.name);
                                            const qty = cartItem ? cartItem.quantity : 0;

                                            return (
                                                <div key={variant.name} className={`flex items-center justify-between p-3 rounded-xl border transition-all ${qty > 0 ? 'border-red-500 bg-red-50' : 'border-gray-100 bg-white'}`}>
                                                    <div>
                                                        <span className="block font-bold text-gray-900 text-sm">{variant.name}</span>
                                                        <span className="text-sm font-black text-red-600">${variant.price.toFixed(2)}</span>
                                                    </div>
                                                    <div>
                                                        {qty > 0 ? (
                                                            <div className="flex items-center gap-2 bg-white rounded-lg p-1 shadow-sm">
                                                                <button onClick={() => updateQuantity(product.id, qty - 1, variant.name)} className="w-6 h-6 flex items-center justify-center text-gray-500 hover:text-red-500"><i className="bi bi-dash"></i></button>
                                                                <span className="text-xs font-black w-4 text-center">{qty}</span>
                                                                <button onClick={() => updateQuantity(product.id, qty + 1, variant.name)} className="w-6 h-6 flex items-center justify-center text-gray-500 hover:text-green-600"><i className="bi bi-plus"></i></button>
                                                            </div>
                                                        ) : (
                                                            <button
                                                                onClick={() => {
                                                                    const itemToAdd = {
                                                                        id: product.id,
                                                                        name: `${product.name} - ${variant.name}`,
                                                                        variantName: variant.name,
                                                                        productName: product.name,
                                                                        price: variant.price,
                                                                        image: product.image,
                                                                        description: variant.description || product.description,
                                                                        businessId: business.id,
                                                                        businessName: business.name,
                                                                        businessImage: business.image,
                                                                        category: product.category
                                                                    };

                                                                    const currentCart = [...cart];
                                                                    currentCart.push({ ...itemToAdd, quantity: 1 });
                                                                    setCart(currentCart);
                                                                    updateCartInStorage(business.id, currentCart);
                                                                    showNotification(`${product.name} - ${variant.name} agregado`);
                                                                }}
                                                                disabled={!product.isAvailable}
                                                                className="w-8 h-8 rounded-lg bg-gray-900 text-white flex items-center justify-center hover:bg-black transition-colors disabled:opacity-50"
                                                            >
                                                                <i className="bi bi-plus-lg"></i>
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            )
                                        })}
                                    </div>
                                </div>
                            ) : (
                                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-100">
                                    <div>
                                        <span className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-1">Precio</span>
                                        <span className="text-3xl font-black text-red-600 tracking-tight">${product.price.toFixed(2)}</span>
                                    </div>
                                    <div>
                                        {(() => {
                                            const cartItem = cart.find(item => item.id === product.id && item.variantName === null);
                                            const qty = cartItem ? cartItem.quantity : 0;

                                            if (qty > 0) {
                                                return (
                                                    <div className="flex items-center gap-3 bg-white rounded-xl p-2 shadow-sm border border-gray-100">
                                                        <button onClick={() => updateQuantity(product.id, qty - 1, null)} className="w-8 h-8 flex items-center justify-center bg-gray-50 rounded-lg text-gray-600 hover:text-red-500 text-lg"><i className="bi bi-dash"></i></button>
                                                        <span className="text-lg font-black w-6 text-center">{qty}</span>
                                                        <button onClick={() => updateQuantity(product.id, qty + 1, null)} className="w-8 h-8 flex items-center justify-center bg-gray-50 rounded-lg text-gray-600 hover:text-green-600 text-lg"><i className="bi bi-plus"></i></button>
                                                    </div>
                                                )
                                            } else {
                                                return (
                                                    <button
                                                        onClick={() => {
                                                            const itemToAdd = {
                                                                id: product.id,
                                                                name: product.name,
                                                                variantName: null,
                                                                productName: product.name,
                                                                price: product.price,
                                                                image: product.image,
                                                                description: product.description,
                                                                businessId: business.id,
                                                                businessName: business.name,
                                                                businessImage: business.image,
                                                                category: product.category
                                                            };

                                                            const currentCart = [...cart];
                                                            currentCart.push({ ...itemToAdd, quantity: 1 });
                                                            setCart(currentCart);
                                                            updateCartInStorage(business.id, currentCart);
                                                            showNotification(`${product.name} agregado`);
                                                        }}
                                                        disabled={!product.isAvailable}
                                                        className="px-6 py-3 bg-gray-900 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-black transition-all shadow-lg active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                                    >
                                                        <i className="bi bi-bag-plus-fill"></i>
                                                        Agregar
                                                    </button>
                                                )
                                            }
                                        })()}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Other Products Section */}
                        {otherProducts.length > 0 && (
                            <div className="mt-8 border-t border-gray-100 pt-6">
                                <h4 className="text-sm font-black text-gray-900 mb-4 uppercase tracking-tight">
                                    Otros productos de {business.name}
                                </h4>
                                <div className="relative">
                                    <div
                                        className="flex gap-3 overflow-x-auto snap-x snap-mandatory scrollbar-hide pb-4"
                                        style={{
                                            scrollbarWidth: 'none',
                                            msOverflowStyle: 'none',
                                            WebkitOverflowScrolling: 'touch'
                                        }}
                                    >
                                        {otherProducts.map((otherProduct) => (
                                            <div
                                                key={otherProduct.id}
                                                onClick={() => onProductSelect(otherProduct)}
                                                className="group cursor-pointer bg-gray-50 rounded-xl p-2 border border-blue-50 hover:border-blue-200 transition-all hover:bg-white hover:shadow-sm flex-shrink-0 snap-start w-[140px]"
                                            >
                                                <div className="aspect-square rounded-lg overflow-hidden bg-white mb-2 relative">
                                                    {otherProduct.image ? (
                                                        <img
                                                            src={otherProduct.image}
                                                            alt={otherProduct.name}
                                                            className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                                                        />
                                                    ) : (
                                                        <div className="w-full h-full flex items-center justify-center text-gray-200">
                                                            <i className="bi bi-image text-2xl"></i>
                                                        </div>
                                                    )}
                                                    {otherProduct.price > 0 && (
                                                        <div className="absolute top-1 right-1 bg-white/90 backdrop-blur-sm px-1.5 py-0.5 rounded text-[10px] font-bold shadow-sm">
                                                            ${otherProduct.price}
                                                        </div>
                                                    )}
                                                </div>
                                                <h5 className="text-xs font-bold text-gray-900 line-clamp-2 leading-tight group-hover:text-blue-600 transition-colors h-[2.5em]">
                                                    {otherProduct.name}
                                                </h5>
                                            </div>
                                        ))}
                                    </div>
                                    {otherProducts.length > 2 && (
                                        <div className="absolute right-0 top-0 bottom-4 w-12 pointer-events-none bg-gradient-to-l from-white via-white/50 to-transparent flex items-center justify-end pr-1">
                                            <div className="animate-pulse bg-white/80 p-1 rounded-full shadow-sm backdrop-blur-sm">
                                                <i className="bi bi-chevron-right text-gray-400 text-xs"></i>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Spacer for floating cart button */}
                        <div className="h-24"></div>

                    </div>
                </div>

                {/* Floating Cart Button inside Sidebar */}
                {(() => {
                    const cartTotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0)
                    const cartItemsCount = cart.reduce((sum, item) => sum + (item.esPremio ? 0 : item.quantity), 0)

                    if (cartItemsCount > 0) {
                        return (
                            <div className="absolute bottom-6 right-6 z-50">
                                <button
                                    onClick={() => {
                                        if (onOpenCart) {
                                            onOpenCart()
                                        } else {
                                            router.push(`/${business.username || `restaurant/${business.id}`}`)
                                        }
                                    }}
                                    className="relative bg-gray-900 text-white rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.3)] hover:bg-black transition-all duration-300 transform hover:scale-105 active:scale-95 group overflow-hidden"
                                >
                                    {/* Glossy Effect */}
                                    <div className="absolute inset-0 bg-gradient-to-tr from-white/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>

                                    <div className="flex items-center px-6 py-4 space-x-3">
                                        <div className="relative">
                                            <i className="bi bi-cart3 text-2xl"></i>
                                            <span className="absolute -top-3 -right-3 bg-red-500 text-white rounded-full w-6 h-6 text-[10px] font-black flex items-center justify-center border-2 border-gray-900 shadow-lg animate-bounce">
                                                {cartItemsCount}
                                            </span>
                                        </div>
                                        <div className="text-left">
                                            <div className="text-xs text-gray-400 font-bold uppercase tracking-widest leading-none mb-1 text-[8px]">Total</div>
                                            <div className="text-lg font-black leading-none">${cartTotal.toFixed(2)}</div>
                                        </div>
                                        <div className="pl-2 border-l border-white/10 group-hover:translate-x-1 transition-transform">
                                            <i className="bi bi-chevron-right text-gray-400"></i>
                                        </div>
                                    </div>
                                </button>
                            </div>
                        )
                    }
                    return null
                })()}
            </div>

            {notification.show && (
                <div className="fixed top-8 left-1/2 -translate-x-1/2 z-[140] w-[calc(100%-2rem)] max-w-xs pointer-events-none animate-[slideDown_0.3s_ease-out]">
                    <div className="bg-gray-900/95 backdrop-blur-xl border border-white/10 rounded-[2rem] px-6 py-4 shadow-[0_20px_50px_rgba(0,0,0,0.5)] flex items-center gap-4">
                        <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
                            <i className="bi bi-bag-check-fill text-emerald-400 text-lg"></i>
                        </div>
                        <div className="flex-1">
                            <p className="text-white font-black text-[10px] uppercase tracking-[0.2em] leading-tight">
                                {notification.message}
                            </p>
                        </div>
                    </div>
                    <style jsx>{`
            @keyframes slideDown {
              from { transform: translateY(-20px); opacity: 0; }
              to { transform: translateY(0); opacity: 1; }
            }
          `}</style>
                </div>
            )}
        </div>
    )
}
