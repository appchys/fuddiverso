'use client'

import { useState, useEffect, useRef } from 'react'
import { Product, Business } from '@/types'
import { getProductPublicPrice, formatPrice, getPriceMetadata, ensureCartItemMetadata } from '@/lib/price-utils'

interface StoryProductDetailProps {
    isOpen: boolean
    onClose: () => void
    product: Product | null
    business: Business | null
    onAddToCart: (item: any) => void
    onOpenCart?: () => void
}

export default function StoryProductDetail({ isOpen, onClose, product, business, onAddToCart, onOpenCart }: StoryProductDetailProps) {
    const [selectedVariant, setSelectedVariant] = useState<string | null>(null)
    const [cart, setCart] = useState<any[]>([])
    const [notification, setNotification] = useState<{ show: boolean; message: string }>({ show: false, message: '' })
    const [dragY, setDragY] = useState(0)
    const [isDragging, setIsDragging] = useState(false)
    const touchStartRef = useRef<number>(0)
    const contentRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (product) {
            if (product.variants && product.variants.length > 0) {
                setSelectedVariant(product.variants[0].name)
            } else {
                setSelectedVariant(null)
            }
        }
    }, [product])

    useEffect(() => {
        if (isOpen) {
            document.body.style.overscrollBehaviorY = 'none'
            document.documentElement.style.overscrollBehaviorY = 'none'
        } else {
            document.body.style.overscrollBehaviorY = ''
            document.documentElement.style.overscrollBehaviorY = ''
        }
        return () => {
            document.body.style.overscrollBehaviorY = ''
            document.documentElement.style.overscrollBehaviorY = ''
        }
    }, [isOpen])

    useEffect(() => {
        if (business?.id && isOpen) {
            const loadCart = () => {
                const savedCarts = localStorage.getItem('carts')
                if (savedCarts) {
                    const allCarts = JSON.parse(savedCarts)
                    const businessCart = allCarts[business.id] || []
                    setCart(businessCart)
                }
            }
            loadCart()
            window.addEventListener('storage', loadCart)
            return () => window.removeEventListener('storage', loadCart)
        }
    }, [business?.id, isOpen])

    // Touch handlers for swipe to close
    const handleTouchStart = (e: React.TouchEvent) => {
        touchStartRef.current = e.touches[0].clientY
        setIsDragging(true)
    }

    const handleTouchMove = (e: React.TouchEvent) => {
        const currentY = e.touches[0].clientY
        const diff = currentY - touchStartRef.current
        
        // Solo permitir arrastrar hacia abajo
        if (diff > 0) {
            setDragY(diff)
            // Evitar pull-to-refresh o scroll del body
            if (contentRef.current && contentRef.current.scrollTop <= 0) {
                if (e.cancelable) e.preventDefault()
            }
        }
    }

    const handleTouchEnd = () => {
        setIsDragging(false)
        if (dragY > 120) {
            onClose()
        }
        setDragY(0)
    }

    const showNotification = (message: string) => {
        setNotification({ show: true, message })
        setTimeout(() => setNotification({ show: false, message: '' }), 2000)
    }

    if (!product || !business) return null

    return (
        <>
            {/* Backdrop */}
            <div 
                className={`fixed inset-0 z-[110] bg-black/30 backdrop-blur-[2px] transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                onClick={onClose}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
            />

            {/* Bottom Sheet */}
            <div 
                className={`fixed inset-x-0 bottom-0 z-[120] bg-white rounded-t-[3rem] shadow-2xl transition-transform ease-out flex flex-col max-h-[85vh] ${isOpen ? 'translate-y-0' : 'translate-y-full'}`}
                style={{ 
                    transform: isOpen ? `translateY(${dragY}px)` : 'translateY(100%)',
                    transitionDuration: isDragging ? '0ms' : '500ms',
                    touchAction: 'none',
                    overscrollBehaviorY: 'none'
                }}
            >
                {/* Handle / Drag Zone (Expanded to header area too) */}
                <div 
                    className="shrink-0"
                    onTouchStart={handleTouchStart}
                    onTouchMove={handleTouchMove}
                    onTouchEnd={handleTouchEnd}
                >
                    {/* Handle */}
                    <div className="w-full flex justify-center py-4 cursor-grab active:cursor-grabbing" onClick={onClose}>
                        <div className="w-12 h-1.5 bg-gray-200 rounded-full"></div>
                    </div>

                    {/* Header (Part of the drag-to-close zone) */}
                    <div className="px-6 mb-6 flex gap-4">
                        <div className="w-24 h-24 rounded-2xl overflow-hidden flex-shrink-0 bg-gray-50 border border-gray-100 shadow-sm pointer-events-none">
                            {product.image ? (
                                <img src={product.image} alt={product.name} className="w-full h-full object-cover" />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center text-gray-200">
                                    <i className="bi bi-image text-3xl"></i>
                                </div>
                            )}
                        </div>
                        <div className="flex-1 min-w-0 pointer-events-none">
                            <span className="inline-block px-2 py-0.5 bg-red-50 text-red-600 text-[10px] font-black uppercase tracking-widest rounded-full mb-1">
                                {product.category}
                            </span>
                            <h2 className="text-xl font-black text-gray-900 leading-tight line-clamp-2">{product.name}</h2>
                            <p className="text-lg font-black text-red-600 mt-1">
                                {formatPrice(getProductPublicPrice(selectedVariant ? product.variants?.find(v => v.name === selectedVariant) || product : product))}
                            </p>
                        </div>
                    </div>
                </div>

                <div 
                    ref={contentRef} 
                    className="overflow-y-auto px-6 pb-12 overscroll-contain"
                    onTouchStart={(e) => {
                        if (contentRef.current && contentRef.current.scrollTop <= 0) {
                            handleTouchStart(e)
                        }
                    }}
                    onTouchMove={(e) => {
                        if (isDragging) {
                            handleTouchMove(e)
                        }
                    }}
                    onTouchEnd={handleTouchEnd}
                >
                    {/* Description (Also triggers drag if at top) */}
                    {product.description && (
                        <div className="mb-6 pointer-events-none">
                            <p className="text-sm text-gray-500 font-medium leading-relaxed">{product.description}</p>
                        </div>
                    )}

                    {/* Variants */}
                    {product.variants && product.variants.length > 0 && (
                        <div className="mb-8">
                            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">
                                Selecciona una opción
                            </label>
                            <div className="grid grid-cols-1 gap-2">
                                {product.variants.map((v) => (
                                    <button
                                        key={v.name}
                                        onClick={() => setSelectedVariant(v.name)}
                                        className={`flex items-center justify-between p-4 rounded-2xl border transition-all ${selectedVariant === v.name ? 'border-[#aa1918] bg-[#aa1918]/5' : 'border-gray-100 bg-white'}`}
                                    >
                                        <span className={`text-sm font-bold ${selectedVariant === v.name ? 'text-[#aa1918]' : 'text-gray-900'}`}>{v.name}</span>
                                        <span className="text-sm font-black text-gray-900">{formatPrice(getProductPublicPrice(v))}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Action Buttons */}
                    <div className="flex gap-3">
                        <button
                            onClick={() => {
                                const variant = selectedVariant ? product.variants?.find(v => v.name === selectedVariant) : null
                                const itemToAdd = {
                                    id: product.id,
                                    name: product.name,
                                    variantName: selectedVariant,
                                    price: getProductPublicPrice(variant || product),
                                    ...getPriceMetadata(variant || product),
                                    image: product.image,
                                    businessId: business.id,
                                    businessName: business.name,
                                    businessImage: business.image,
                                    category: product.category
                                }
                                onAddToCart(itemToAdd)
                                showNotification('¡Agregado al carrito!')
                            }}
                            disabled={!product.isAvailable}
                            className="flex-1 bg-[#aa1918] text-white font-black py-4 rounded-2xl shadow-lg shadow-red-900/10 hover:shadow-red-900/20 active:scale-[0.98] transition-all flex items-center justify-center gap-3 uppercase tracking-wider text-sm"
                        >
                            <i className="bi bi-bag-plus-fill"></i>
                            Agregar al Pedido
                        </button>
                        
                        {cart.length > 0 && (
                            <button
                                onClick={() => {
                                    onOpenCart?.()
                                    onClose()
                                }}
                                className="bg-gray-900 text-white font-black py-4 px-4 rounded-2xl shadow-lg shadow-gray-900/10 hover:shadow-gray-900/20 active:scale-[0.98] transition-all relative"
                            >
                                <i className="bi bi-cart3 text-lg"></i>
                                {cart.length > 0 && (
                                    <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center">
                                        {cart.reduce((sum, item) => sum + item.quantity, 0)}
                                    </span>
                                )}
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Notification */}
            {notification.show && (
                <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[150] animate-in fade-in slide-in-from-top-4 duration-300">
                    <div className="bg-gray-900 text-white px-6 py-3 rounded-full text-xs font-black uppercase tracking-widest shadow-2xl">
                        {notification.message}
                    </div>
                </div>
            )}
        </>
    )
}
