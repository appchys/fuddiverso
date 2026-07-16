'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Product, Business } from '@/types'
import { normalizeEcuadorianPhone } from '@/lib/validation'
import { unredeemQRCodePrize, getProductsByBusiness } from '@/lib/database'
import { getProductPublicPrice, formatPrice, getPriceMetadata, ensureCartItemMetadata } from '@/lib/price-utils'

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
    const [comboSelection, setComboSelection] = useState<Record<string, number>>({})
    const [cart, setCart] = useState<any[]>([])
    const [selectedOptions, setSelectedOptions] = useState<Record<string, { name: string, price: number }[]>>({})
    const [notification, setNotification] = useState<{ show: boolean; message: string; type: 'success' | 'error' }>({
        show: false,
        message: '',
        type: 'success'
    })
    const [copySuccess, setCopySuccess] = useState(false)
    const [otherProducts, setOtherProducts] = useState<Product[]>([])
    const sidebarContentRef = useRef<HTMLDivElement>(null)
    const [currentImgIndex, setCurrentImgIndex] = useState(0)

    const allImages = useMemo(() => {
        const imgs: string[] = []
        if (product?.image) imgs.push(product.image)
        product?.variants?.forEach((v: any) => {
            if (v.image && !imgs.includes(v.image)) imgs.push(v.image)
        })
        if (imgs.length === 0 && business?.image) imgs.push(business.image)
        return imgs
    }, [product, business])

    useEffect(() => {
        if (!isOpen || allImages.length <= 1) return
        const interval = setInterval(() => {
            setCurrentImgIndex((prev) => (prev + 1) % allImages.length)
        }, 2000)
        return () => clearInterval(interval)
    }, [allImages, isOpen])

    useEffect(() => {
        setCurrentImgIndex(0)
    }, [product?.id])

    const availableVariants = useMemo(() => {
        return product?.variants?.filter(v => v.isAvailable !== false) || []
    }, [product])

    const anyVariantHasImage = useMemo(() => {
        return availableVariants.some(v => !!v.image)
    }, [availableVariants])

    const comboPrice = useMemo(() => {
        if (!product || !product.isCombo) return 0;
        return Object.entries(comboSelection).reduce((total, [variantName, qty]) => {
            const variant = availableVariants.find(v => v.name === variantName);
            if (variant && qty > 0) {
                return total + (getProductPublicPrice(variant) * qty);
            }
            return total;
        }, 0);
    }, [product, comboSelection, availableVariants]);

    const activeVariantObj = useMemo(() => {
        if (!product || !product.variants || !selectedVariant) return null;
        return product.variants.find(v => v.name === selectedVariant) || null;
    }, [product, selectedVariant]);

    const optionsPrice = useMemo(() => {
        if (!product || !product.optionGroups) return 0;
        return Object.values(selectedOptions).reduce((sum, groupSelections) => {
            return sum + groupSelections.reduce((gSum, opt) => gSum + (opt.price || 0), 0);
        }, 0);
    }, [product, selectedOptions]);

    const isOptionsSelectionComplete = useMemo(() => {
        if (!product || !product.optionGroups) return true;
        return product.optionGroups.every(group => {
            const count = (selectedOptions[group.id] || []).length;
            return count >= group.minSelect;
        });
    }, [product, selectedOptions]);

    const baseProductPrice = useMemo(() => {
        if (!product) return 0;
        return activeVariantObj ? getProductPublicPrice(activeVariantObj) : getProductPublicPrice(product);
    }, [product, activeVariantObj]);


    // Reset state when product changes
    useEffect(() => {
        if (product) {
            if (product.variants && product.variants.length > 0) {
                setSelectedVariant(product.variants[0].name)
            } else {
                setSelectedVariant(null)
            }
            setQuantity(1)
            setComboSelection({})
            setSelectedOptions({})

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
            // Listen for storage changes and custom cart updates
            const handleStorageChange = () => loadCart()
            window.addEventListener('storage', handleStorageChange)
            window.addEventListener('cart-updated', handleStorageChange)
            window.addEventListener('pageshow', handleStorageChange)
            return () => {
                window.removeEventListener('storage', handleStorageChange)
                window.removeEventListener('cart-updated', handleStorageChange)
                window.removeEventListener('pageshow', handleStorageChange)
            }
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
        // Dispatch events for other components to update
        window.dispatchEvent(new Event('storage'))
        window.dispatchEvent(new Event('cart-updated'))
    }

    const handleAddOptionProductToCart = () => {
        if (!product || !business) return;

        if (!isOptionsSelectionComplete) {
            alert('Por favor selecciona las opciones obligatorias');
            return;
        }

        const basePriceMeta = activeVariantObj 
            ? getPriceMetadata(activeVariantObj) 
            : getPriceMetadata(product);

        // Format selectedOptions as a variant string
        const optionsList: string[] = [];
        Object.entries(selectedOptions).forEach(([groupId, selections]) => {
            const group = product.optionGroups?.find(g => g.id === groupId);
            if (selections.length > 0) {
                const groupSelections = selections.map(s => {
                    const priceStr = s.price > 0 ? ` (+$${s.price.toFixed(2)})` : '';
                    return `${s.name}${priceStr}`;
                }).join(', ');
                optionsList.push(`${group?.name || 'Opción'}: ${groupSelections}`);
            }
        });
        const optionsStr = optionsList.join(' | ');
        
        let finalVariantName = '';
        if (activeVariantObj) {
            finalVariantName = optionsStr ? `${activeVariantObj.name} (${optionsStr})` : activeVariantObj.name;
        } else {
            finalVariantName = optionsStr;
        }

        // Generate cartItemId using the combined variant name
        const cleanHash = finalVariantName.replace(/[^a-zA-Z0-9]/g, '');
        const cartItemId = cleanHash ? `${product.id}-${cleanHash}` : product.id;

        const itemToAdd = {
            id: cartItemId,
            productId: product.id, // ID original del producto para verificar disponibilidad en el carrito
            name: product.name,
            variantName: finalVariantName || null,
            productName: product.name,
            price: baseProductPrice + optionsPrice,
            ...basePriceMeta,
            // Include options price in basePrice and storeReceives
            basePrice: (basePriceMeta.basePrice || baseProductPrice) + optionsPrice,
            storeReceives: (basePriceMeta.storeReceives || baseProductPrice) + optionsPrice,
            image: activeVariantObj?.image || product.image,
            description: activeVariantObj?.description || product.description,
            businessId: business.id,
            businessName: business.name,
            businessImage: business.image,
            category: product.category,
            imagePosition: product.imagePosition || 'center 50%'
        };

        const currentCart = [...cart];
        const existingItemIndex = currentCart.findIndex(item => item.id === cartItemId);
        
        if (existingItemIndex > -1) {
            currentCart[existingItemIndex].quantity += quantity;
        } else {
            currentCart.push({ ...itemToAdd, quantity });
        }
        
        setCart(currentCart);
        updateCartInStorage(business.id, currentCart);
        showNotification(`${product.name} agregado`);
        
        // Reset states
        setSelectedOptions({});
        setQuantity(1);
        onClose();
        onOpenCart?.();
    };

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
                        {business && (
                            <Link 
                                href={`/${business.username}`}
                                onClick={onClose}
                                className="mb-6 flex items-center gap-3 pr-12 group/header hover:opacity-85 transition-opacity inline-flex cursor-pointer"
                            >
                                <div className="w-10 h-10 rounded-full overflow-hidden border border-gray-100 flex-shrink-0 bg-white shadow-sm ring-1 ring-gray-100 group-hover/header:shadow-md transition-all">
                                    {business.image ? (
                                        <img src={business.image} alt={business.name} className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center bg-gray-50 text-gray-400 font-bold">
                                            {business.name.charAt(0)}
                                        </div>
                                    )}
                                </div>
                                <div>
                                    <h3 className="text-sm font-black text-gray-900 leading-tight group-hover/header:text-red-600 transition-colors">{business.name}</h3>
                                    {business.username && <p className="text-xs text-gray-400">@{business.username}</p>}
                                </div>
                            </Link>
                        )}

                        {/* Product Image */}
                        <div className="w-full aspect-square bg-gray-50 rounded-[2rem] overflow-hidden shadow-sm border border-gray-100 mb-6 relative">
                            {allImages.length > 0 ? (
                                <img src={allImages[currentImgIndex]} alt={product.name} className="w-full h-full object-cover transition-all duration-700" style={{ objectPosition: allImages[currentImgIndex] === product.image ? (product.imagePosition || 'center') : 'center' }} />
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
                            {product.optionGroups && product.optionGroups.length > 0 ? (
                                <div className="space-y-6">
                                    {/* 1. Si hay opciones y también variantes, renderizarlas como un radio list */}
                                    {product.variants && product.variants.length > 0 && (
                                        <div>
                                            <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-3">
                                                Selecciona una opción
                                            </label>
                                            <div className="space-y-2">
                                                {availableVariants.map((variant) => {
                                                    const isSelected = selectedVariant === variant.name;
                                                    return (
                                                        <label
                                                            key={variant.name}
                                                            className={`flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer ${
                                                                isSelected 
                                                                    ? 'border-red-500 bg-red-50/50' 
                                                                    : 'border-gray-100 bg-white hover:border-gray-200'
                                                            }`}
                                                        >
                                                            <div className="flex items-center gap-3">
                                                                <input
                                                                    type="radio"
                                                                    name="product-variant-radio"
                                                                    checked={isSelected}
                                                                    onChange={() => setSelectedVariant(variant.name)}
                                                                    className="w-4 h-4 text-red-600 focus:ring-red-500 border-gray-300"
                                                                />
                                                                <span className="font-bold text-gray-900 text-sm">{variant.name}</span>
                                                            </div>
                                                            <span className="text-sm font-black text-red-600">
                                                                {formatPrice(getProductPublicPrice(variant))}
                                                            </span>
                                                        </label>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    {/* 2. Renderizar los grupos de opciones/modificadores */}
                                    <div className="space-y-6">
                                        {product.optionGroups.map((group) => {
                                            const selections = selectedOptions[group.id] || []
                                            const isGroupAtMax = selections.length >= group.maxSelect

                                            return (
                                                <div key={group.id} className="space-y-3">
                                                    <div className="flex items-center justify-between">
                                                        <div>
                                                            <span className="block text-sm font-black text-gray-900 leading-tight">
                                                                {group.name}
                                                            </span>
                                                            <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mt-0.5">
                                                                {group.minSelect > 0 
                                                                    ? `Obligatorio · Elige ${group.minSelect === group.maxSelect ? group.minSelect : `de ${group.minSelect} a ${group.maxSelect}`}` 
                                                                    : `Opcional · Elige hasta ${group.maxSelect}`}
                                                            </span>
                                                        </div>
                                                        {selections.length > 0 && (
                                                            <span className="text-[10px] bg-red-50 text-red-600 px-2 py-0.5 rounded-full font-black">
                                                                {selections.length}/{group.maxSelect}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="space-y-2">
                                                        {group.options.filter(opt => opt.isAvailable !== false).map((opt) => {
                                                            const isSelected = selections.some(s => s.name === opt.name)
                                                            const disabled = !isSelected && isGroupAtMax

                                                            return (
                                                                <label
                                                                    key={opt.name}
                                                                    className={`flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer ${
                                                                        isSelected 
                                                                            ? 'border-red-500 bg-red-50/50' 
                                                                            : disabled 
                                                                                ? 'border-gray-50 bg-gray-50/30 opacity-60 cursor-not-allowed' 
                                                                                : 'border-gray-100 bg-white hover:border-gray-200'
                                                                    }`}
                                                                >
                                                                    <div className="flex items-center gap-3">
                                                                        <input
                                                                            type={group.maxSelect === 1 ? 'radio' : 'checkbox'}
                                                                            name={group.id}
                                                                            checked={isSelected}
                                                                            disabled={disabled}
                                                                            onChange={() => {
                                                                                if (group.maxSelect === 1) {
                                                                                    setSelectedOptions(prev => ({
                                                                                        ...prev,
                                                                                        [group.id]: [{ name: opt.name, price: opt.price }]
                                                                                    }))
                                                                                } else {
                                                                                    setSelectedOptions(prev => {
                                                                                        const current = prev[group.id] || []
                                                                                        const exists = current.some(s => s.name === opt.name)
                                                                                        let updated
                                                                                        if (exists) {
                                                                                            updated = current.filter(s => s.name !== opt.name)
                                                                                        } else {
                                                                                            if (current.length >= group.maxSelect) return prev
                                                                                            updated = [...current, { name: opt.name, price: opt.price }]
                                                                                        }
                                                                                        return { ...prev, [group.id]: updated }
                                                                                    })
                                                                                }
                                                                            }}
                                                                            className="w-4 h-4 text-red-600 focus:ring-red-500 border-gray-300 rounded"
                                                                        />
                                                                        <span className="font-bold text-gray-900 text-sm">{opt.name}</span>
                                                                    </div>
                                                                    {opt.price > 0 && (
                                                                        <span className="text-xs font-black text-gray-500">
                                                                            +{formatPrice(opt.price)}
                                                                        </span>
                                                                    )}
                                                                </label>
                                                            )
                                                        })}
                                                    </div>
                                                </div>
                                            )
                                        })}
                                    </div>

                                    {/* 3. Panel de control de cantidad y botón Agregar para modificadores */}
                                    <div className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-100">
                                        <div>
                                            <span className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-1">Precio</span>
                                            <span className="text-3xl font-black text-red-600 tracking-tight">{formatPrice((baseProductPrice + optionsPrice) * quantity)}</span>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <div className="flex items-center gap-2 bg-white rounded-xl p-1 shadow-sm border border-gray-100">
                                                <button
                                                    onClick={() => setQuantity(q => Math.max(1, q - 1))}
                                                    className="w-8 h-8 flex items-center justify-center bg-gray-50 rounded-lg text-gray-600 hover:text-red-500 text-lg"
                                                >
                                                    <i className="bi bi-dash"></i>
                                                </button>
                                                <span className="text-lg font-black w-6 text-center">{quantity}</span>
                                                <button
                                                    onClick={() => setQuantity(q => q + 1)}
                                                    className="w-8 h-8 flex items-center justify-center bg-gray-50 rounded-lg text-gray-600 hover:text-green-600 text-lg"
                                                >
                                                    <i className="bi bi-plus"></i>
                                                </button>
                                            </div>
                                            <button
                                                onClick={handleAddOptionProductToCart}
                                                disabled={!isOptionsSelectionComplete || !product.isAvailable}
                                                className="px-6 py-3 bg-gray-900 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-black transition-all shadow-lg active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                            >
                                                <i className="bi bi-bag-plus-fill"></i>
                                                Agregar
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ) : product.variants && product.variants.length > 0 ? (
                                <div>
                                    <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-3">
                                        Opciones
                                    </label>
                                    <div className="space-y-3">
                                        {availableVariants.map((variant) => {
                                            const cartItem = cart.find(item => item.id === product.id && item.variantName === variant.name);
                                            const qty = product.isCombo ? (comboSelection[variant.name] || 0) : (cartItem ? cartItem.quantity : 0);

                                            return (
                                                <div key={variant.name} className={`flex items-center justify-between p-3 rounded-xl border transition-all ${qty > 0 ? 'border-red-500 bg-red-50' : 'border-gray-100 bg-white'}`}>
                                                    <div className="flex items-center gap-3 flex-1 min-w-0 pr-4">
                                                        {anyVariantHasImage && (
                                                            <div className="w-12 h-12 flex-shrink-0 rounded-lg overflow-hidden bg-white border border-gray-100 flex items-center justify-center">
                                                                <img
                                                                    src={variant.image || product.image || business.image}
                                                                    alt={variant.name}
                                                                    className="w-full h-full object-cover"
                                                                />
                                                            </div>
                                                        )}
                                                        <div className="flex-1 min-w-0">
                                                            <span className="block font-bold text-gray-900 text-sm">{variant.name}</span>
                                                            {variant.description && (
                                                                <p className="text-[11px] text-gray-500 line-clamp-2 leading-tight mt-0.5 mb-1">
                                                                    {variant.description}
                                                                </p>
                                                            )}
                                                            <span className="text-sm font-black text-red-600">{formatPrice(getProductPublicPrice(variant))}</span>
                                                        </div>
                                                    </div>
                                                    <div>
                                                        {qty > 0 ? (
                                                            <div className="flex items-center gap-2 bg-white rounded-lg p-1 shadow-sm">
                                                                <button
                                                                    onClick={() => {
                                                                        if (product.isCombo) {
                                                                            setComboSelection(prev => ({ ...prev, [variant.name]: Math.max(0, qty - 1) }))
                                                                        } else {
                                                                            updateQuantity(product.id, qty - 1, variant.name)
                                                                        }
                                                                    }}
                                                                    className="w-6 h-6 flex items-center justify-center text-gray-500 hover:text-red-500"
                                                                >
                                                                    <i className="bi bi-dash"></i>
                                                                </button>
                                                                <span className="text-xs font-black w-4 text-center">{qty}</span>
                                                                <button
                                                                    onClick={() => {
                                                                        if (product.isCombo) {
                                                                            setComboSelection(prev => ({ ...prev, [variant.name]: qty + 1 }))
                                                                        } else {
                                                                            updateQuantity(product.id, qty + 1, variant.name)
                                                                        }
                                                                    }}
                                                                    className="w-6 h-6 flex items-center justify-center text-gray-500 hover:text-green-600"
                                                                >
                                                                    <i className="bi bi-plus"></i>
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <button
                                                                onClick={() => {
                                                                    if (product.isCombo) {
                                                                        setComboSelection(prev => ({ ...prev, [variant.name]: 1 }))
                                                                    } else {
                                                                        const itemToAdd = {
                                                                            id: product.id,
                                                                            name: product.name,            // Nombre base del producto
                                                                            variant: variant.name,        // Nombre de la variante
                                                                            variantName: variant.name,    // Nombre de la variante
                                                                            productName: product.name,    // Nombre base (redundante pero claro)
                                                                            price: getProductPublicPrice(variant),
                                                                            ...getPriceMetadata(variant),
                                                                            image: product.image,
                                                                            imagePosition: product.imagePosition || 'center 50%',
                                                                            description: variant.description || product.description,
                                                                            businessId: business.id,
                                                                            businessName: business.name,
                                                                            businessImage: business.image,
                                                                            category: product.category
                                                                        };

                                                                        const enriched = ensureCartItemMetadata(itemToAdd)
                                                                        const currentCart = [...cart];
                                                                        currentCart.push({ ...enriched, quantity: 1 });
                                                                        setCart(currentCart);
                                                                        updateCartInStorage(business.id, currentCart);
                                                                        showNotification(`${product.name} - ${variant.name} agregado`);
                                                                    }
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
                                        <span className="text-3xl font-black text-red-600 tracking-tight">{formatPrice(getProductPublicPrice(product))}</span>
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
                                                                price: getProductPublicPrice(product),
                                                                ...getPriceMetadata(product),
                                                                image: product.image,
                                                                imagePosition: product.imagePosition || 'center 50%',
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
                                                            style={{ objectPosition: otherProduct.imagePosition || 'center' }}
                                                        />
                                                    ) : (
                                                        <div className="w-full h-full flex items-center justify-center text-gray-200">
                                                            <i className="bi bi-image text-2xl"></i>
                                                        </div>
                                                    )}
                                                    {otherProduct.price > 0 && (
                                                        <div className="absolute top-1 right-1 bg-white/90 backdrop-blur-sm px-1.5 py-0.5 rounded text-[10px] font-bold shadow-sm">
                                                            {formatPrice(getProductPublicPrice(otherProduct))}
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

                        {/* Spacer for fixed footer */}
                        <div className="h-32"></div>
                    </div>
                </div>

                {/* Fixed Footer for Actions */}
                <div className="absolute bottom-0 left-0 right-0 p-6 bg-white border-t border-gray-100 shadow-[0_-10px_40px_rgba(0,0,0,0.05)] z-40">
                    {(() => {
                        const cartTotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0)
                        const cartItemsCount = cart.reduce((sum, item) => sum + (item.esPremio ? 0 : item.quantity), 0)
                        const totalComboSelected = product.isCombo ? Object.values(comboSelection).reduce((a, b) => a + b, 0) : 0;
                        const isComboComplete = !product.isCombo || totalComboSelected >= (product.minComboItems || 1);
                        const selectedVariantsStr = Object.entries(comboSelection)
                            .filter(([_, q]) => q > 0)
                            .map(([name, q]) => `${q}x ${name}`)
                            .join(', ');

                        const cartButton = cartItemsCount > 0 && (
                            <button
                                onClick={() => {
                                    if (onOpenCart) {
                                        onOpenCart()
                                    } else {
                                        router.push(`/${business.username || `restaurant/${business.id}`}`)
                                    }
                                }}
                                className="flex-1 bg-gray-900 text-white rounded-2xl shadow-lg hover:bg-black transition-all duration-300 transform active:scale-95 overflow-hidden"
                            >
                                <div className="flex items-center justify-center gap-3 px-5 py-4">
                                    <div className="relative">
                                        <i className="bi bi-cart3 text-xl"></i>
                                        <span className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 text-[9px] font-black flex items-center justify-center border-2 border-gray-900 shadow-lg">
                                            {cartItemsCount}
                                        </span>
                                    </div>
                                    <div className="text-left">
                                        <div className="text-[10px] font-black uppercase tracking-widest opacity-70 leading-none mb-0.5">Ver carrito</div>
                                        <div className="text-base font-black leading-none">{formatPrice(cartTotal)}</div>
                                    </div>
                                </div>
                            </button>
                        )

                        return (
                            <div className="space-y-4">
                                {product.isCombo && comboPrice > 0 && (
                                    <div className="flex items-center justify-between gap-4">
                                        <div className="flex-1 min-w-0">
                                            <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">Tu selección</span>
                                            <p className="text-xs font-bold text-gray-600 line-clamp-2 leading-tight uppercase">
                                                {selectedVariantsStr}
                                            </p>
                                        </div>
                                        <div className="text-right flex-shrink-0">
                                            <span className="text-2xl font-black text-red-600 tracking-tight block leading-none">{formatPrice(comboPrice)}</span>
                                            <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Total Combo</span>
                                        </div>
                                    </div>
                                )}

                                <div className="flex items-center gap-3">
                                    {product.isCombo ? (
                                        <button
                                            onClick={() => {
                                                if (!isComboComplete) return;

                                                const comboMeta = Object.entries(comboSelection).reduce((acc, [variantName, qty]) => {
                                                    const variant = availableVariants.find(v => v.name === variantName);
                                                    if (variant && qty > 0) {
                                                        const meta = getPriceMetadata(variant);
                                                        return {
                                                            basePrice: acc.basePrice + (meta.basePrice * qty),
                                                            commission: acc.commission + (meta.commission * qty),
                                                            publicPrice: acc.publicPrice + (meta.publicPrice * qty),
                                                            storeReceives: acc.storeReceives + (meta.storeReceives * qty),
                                                        };
                                                    }
                                                    return acc;
                                                }, { basePrice: 0, commission: 0, publicPrice: 0, storeReceives: 0 });

                                                const itemToAdd = {
                                                    id: `${product.id}-combo-${Date.now()}`,
                                                    name: product.name,
                                                    variantName: `Combo: ${selectedVariantsStr}`,
                                                    productName: product.name,
                                                    price: comboMeta.publicPrice,
                                                    basePrice: comboMeta.basePrice,
                                                    commission: comboMeta.commission,
                                                    storeReceives: comboMeta.storeReceives,
                                                    commissionType: product.commissionType || 'no_commission',
                                                    image: product.image,
                                                    imagePosition: product.imagePosition || 'center 50%',
                                                    description: product.description,
                                                    businessId: business.id,
                                                    businessName: business.name,
                                                    businessImage: business.image,
                                                    category: product.category,
                                                    isCombo: true,
                                                    comboSelection: comboSelection
                                                };

                                                const currentCart = [...cart];
                                                currentCart.push({ ...itemToAdd, quantity: 1 });
                                                setCart(currentCart);
                                                updateCartInStorage(business.id, currentCart);
                                                showNotification(`${product.name} (Combo) agregado`);
                                                setComboSelection({});
                                                onClose();
                                                onOpenCart?.();
                                            }}
                                            disabled={!isComboComplete}
                                            className="flex-1 py-4 bg-gray-900 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-black transition-all shadow-lg active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                        >
                                            <i className={`bi ${isComboComplete ? 'bi-bag-plus-fill' : 'bi-info-circle'}`}></i>
                                            {isComboComplete ? 'Agregar Combo' : `Arma tu combo (${totalComboSelected}/${product.minComboItems})`}
                                        </button>
                                    ) : (
                                        <button
                                            onClick={onClose}
                                            className={`flex-shrink-0 flex items-center justify-center bg-gray-100 text-gray-500 font-bold rounded-2xl hover:bg-gray-200 transition-all active:scale-[0.98] ${cartItemsCount > 0 ? 'w-12 h-14' : 'flex-1 py-4'}`}
                                            title="Cerrar"
                                        >
                                            {cartItemsCount > 0
                                                ? <i className="bi bi-x-lg text-base"></i>
                                                : 'Cerrar'
                                            }
                                        </button>
                                    )}
                                    {cartButton}
                                </div>
                            </div>
                        )
                    })()}
                </div>
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
