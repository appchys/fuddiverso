"use client"

import { useState, useEffect } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { getProduct, getProductBySlug, getBusinessByProduct, getProductsByBusiness, unredeemQRCodePrize, trackReferralClick } from '@/lib/database'
import { normalizeEcuadorianPhone } from '@/lib/validation'
import type { Product, Business } from '@/types/index'
import CartSidebar from '@/components/CartSidebar'
import UserSidebar from '@/components/UserSidebar'
import ClientLoginModal from '@/components/ClientLoginModal'
import InstagramBrowserBanner from '@/components/InstagramBrowserBanner'

export default function ProductPageByUsername() {
  const params = useParams()
  const productSlug = params.productSlug as string
  const username = params.username as string

  const [product, setProduct] = useState<Product | null>(null)
  const [business, setBusiness] = useState<Business | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedVariant, setSelectedVariant] = useState<string | null>(null)
  const [quantity, setQuantity] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const [relatedProducts, setRelatedProducts] = useState<Product[]>([])
  const [cart, setCart] = useState<any[]>([])
  const [isCartOpen, setIsCartOpen] = useState(false)
  const [copySuccess, setCopySuccess] = useState(false)
  const [notification, setNotification] = useState<{ show: boolean; message: string; type: 'success' | 'error' }>({
    show: false,
    message: '',
    type: 'success'
  })
  const [isUserSidebarOpen, setIsUserSidebarOpen] = useState(false)
  const [showLoginModal, setShowLoginModal] = useState(false)
  const [clientPhone, setClientPhone] = useState<string | null>(null)

  useEffect(() => {
    const loadProduct = async () => {
      try {
        setLoading(true)
        setError(null)

        let productData = await getProductBySlug(productSlug)

        // Fallback para IDs antiguos
        if (!productData) {
          productData = await getProduct(productSlug)
        }

        if (!productData) {
          setError('Producto no encontrado')
          setLoading(false)
          return
        }

        setProduct(productData)
        const productId = productData.id

        const businessData = await getBusinessByProduct(productId)
        if (businessData) {
          setBusiness(businessData)

          const allProducts = await getProductsByBusiness(businessData.id)

          // Ordenar productos según el orden de la categoría definido en business.categories (uso interno)
          const categoryOrder: string[] = Array.isArray(businessData.categories) ? businessData.categories : []
          const getCategoryIndex = (category: string | undefined) => {
            if (!category) return Number.MAX_SAFE_INTEGER
            const index = categoryOrder.indexOf(category)
            return index === -1 ? Number.MAX_SAFE_INTEGER : index
          }

          const otherProducts = allProducts
            .filter(p => p.id !== productId && p.isAvailable)
            .sort((a, b) => getCategoryIndex(a.category) - getCategoryIndex(b.category))
            .slice(0, 10)

          setRelatedProducts(otherProducts)
        }

        if (productData.variants && productData.variants.length > 0) {
          setSelectedVariant(productData.variants[0].name)
        }
      } catch (error) {
        console.error('Error loading product:', error)
        setError('Error al cargar el producto')
      } finally {
        setLoading(false)
      }
    }

    if (productSlug) {
      loadProduct()
    }
  }, [productSlug])

  // Detectar código de referido en URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const ref = params.get('ref')

    if (ref) {
      // Guardar en localStorage
      localStorage.setItem('pendingReferral', ref)

      // Registrar click
      trackReferralClick(ref).catch(console.error)
    }
  }, [])

  useEffect(() => {
    if (business?.id) {
      const loadCart = () => {
        const savedCarts = localStorage.getItem('carts')
        if (savedCarts) {
          const allCarts = JSON.parse(savedCarts)
          const businessCart = allCarts[business.id] || []
          setCart(businessCart)
        }
      }

      loadCart()

      const handleStorageChange = () => loadCart()
      window.addEventListener('storage', handleStorageChange)

      const interval = setInterval(loadCart, 1000)

      return () => {
        window.removeEventListener('storage', handleStorageChange)
        clearInterval(interval)
      }
    }
  }, [business?.id])

  useEffect(() => {
    if (product) {
      const storeName = business?.name || 'fuddi.shop'
      const title = `${product.name} - ${storeName}`

      // Format description based on variants
      let descriptionPrefix = ''
      if (product.variants && product.variants.length > 0) {
        const minPrice = Math.min(...product.variants.map(v => v.price))
        descriptionPrefix = `Desde $${minPrice.toFixed(2)} - `
      } else {
        descriptionPrefix = `$${product.price.toFixed(2)} - `
      }

      const description = `${descriptionPrefix}${product.description || `Descubre ${product.name} en ${storeName}`}`

      document.title = title

      const updateMetaTag = (property: string, content: string, isProperty = true) => {
        const attribute = isProperty ? 'property' : 'name'
        let element = document.querySelector(`meta[${attribute}="${property}"]`)

        if (!element) {
          element = document.createElement('meta')
          element.setAttribute(attribute, property)
          document.head.appendChild(element)
        }

        element.setAttribute('content', content)
      }

      updateMetaTag('description', description, false)

      const canonicalUrl = `https://fuddi.shop/${username}/${product.slug || product.id}`

      updateMetaTag('og:type', 'product')
      updateMetaTag('og:title', title)
      updateMetaTag('og:description', description)
      updateMetaTag('og:image', product.image || '')
      updateMetaTag('og:url', canonicalUrl)
      updateMetaTag('og:site_name', 'fuddi.shop')
      updateMetaTag('og:locale', 'es_ES')

      updateMetaTag('twitter:card', 'summary_large_image', false)
      updateMetaTag('twitter:title', title, false)
      updateMetaTag('twitter:description', description, false)
      updateMetaTag('twitter:image', product.image || '', false)
    }
  }, [product, business?.name, username])

  const showNotification = (message: string, type: 'success' | 'error' = 'success') => {
    setNotification({ show: true, message, type })
    setTimeout(() => {
      setNotification({ show: false, message: '', type: 'success' })
    }, 3000)
  }

  const handleAddToCart = () => {
    if (!product) return

    try {
      const cartsData = localStorage.getItem('carts')
      const allCarts = cartsData ? JSON.parse(cartsData) : {}
      const businessIdForCart = business?.id || product.businessId || 'unknown'
      const currentCart = allCarts[businessIdForCart] || []

      const variantData = selectedVariant && product.variants
        ? product.variants.find((v: any) => v.name === selectedVariant)
        : null

      const cartItem = {
        id: product.id,
        name: `${product.name}${selectedVariant ? ` - ${selectedVariant}` : ''}`,
        variantName: selectedVariant || null,
        productName: product.name,
        price: variantData ? variantData.price : product.price,
        image: product.image,
        description: variantData?.description || product.description,
        businessId: businessIdForCart,
        businessName: business?.name || product.businessName,
        businessImage: business?.image || product.businessImage,
        category: product.category
      }

      // Buscar si el producto con ESA VARIANTE ya existe
      const existingItemIndex = currentCart.findIndex((item: any) =>
        item.id === product.id && item.variantName === (selectedVariant || null)
      )

      if (existingItemIndex > -1) {
        currentCart[existingItemIndex].quantity += quantity
      } else {
        currentCart.push({ ...cartItem, quantity })
      }

      allCarts[businessIdForCart] = currentCart
      localStorage.setItem('carts', JSON.stringify(allCarts))

      showNotification(`${product.name}${selectedVariant ? ` - ${selectedVariant}` : ''} agregado al carrito`)

      setQuantity(1)
    } catch (error) {
      console.error('Error adding to cart:', error)
      showNotification('Error al agregar al carrito', 'error')
    }
  }

  const handleCopyProductLink = async () => {
    const productUrl = `${window.location.origin}/${username}/${product?.slug || product?.id}`
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

  const clearCart = () => {
    if (!business?.id) return
    setCart([])
    updateCartInStorage(business.id, [])
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
  }

  const cartTotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0)
  const cartItemsCount = cart.reduce((sum, item) => sum + (item.esPremio ? 0 : item.quantity), 0)

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-red-500 mb-4"></div>
          <p className="text-gray-600">Cargando producto...</p>
        </div>
      </div>
    )
  }

  if (error || !product) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center max-w-md">
          <i className="bi bi-exclamation-circle text-6xl text-red-500 mb-4 block"></i>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            {error || 'Producto no encontrado'}
          </h1>
          <p className="text-gray-600 mb-6">
            El producto que buscas no existe o ha sido eliminado.
          </p>
          <Link
            href={business?.username ? `/${business.username}` : '/'}
            className="inline-block bg-red-600 hover:bg-red-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
          >
            Volver a la tienda
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white">
      <InstagramBrowserBanner />
      
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {business && (
          <div className="mb-8">
            <Link
              href={`/${username}`}
              className="inline-flex items-center space-x-4 group p-2 rounded-2xl hover:bg-gray-50 transition-all duration-300"
            >
              <div className="w-12 h-12 rounded-full overflow-hidden bg-gray-100 flex items-center justify-center border-2 border-white shadow-md ring-1 ring-gray-100 group-hover:shadow-lg transition-all">
                {business.image ? (
                  <img
                    src={business.image}
                    alt={business.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-lg font-black text-gray-400">
                    {business.name.charAt(0).toUpperCase()}
                  </span>
                )}
              </div>
              <div className="flex flex-col">
                <span className="text-base font-black text-gray-900 tracking-tight leading-tight group-hover:text-red-600 transition-colors">
                  {business.name}
                </span>
                {business.username && (
                  <span className="text-xs font-bold text-gray-400">
                    @{business.username}
                  </span>
                )}
              </div>
            </Link>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
          <div className="w-full">
            <div className="w-full aspect-square bg-white rounded-[2.5rem] overflow-hidden shadow-xl shadow-gray-100 border border-gray-50 transition-all hover:shadow-2xl hover:shadow-gray-200 duration-500">
              {product.image ? (
                <img
                  src={product.image}
                  alt={product.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-gray-50">
                  <i className="bi bi-image text-7xl text-gray-200"></i>
                </div>
              )}
            </div>

            {/* Botón de compartir refinado */}
            <div className="mt-6 flex justify-center sm:justify-end">
              <button
                onClick={handleCopyProductLink}
                className="flex items-center gap-2 px-6 py-3 text-xs font-bold uppercase tracking-widest text-gray-500 hover:text-gray-900 bg-white hover:bg-gray-50 border border-gray-100 rounded-2xl shadow-sm transition-all active:scale-95"
                title="Compartir producto"
              >
                <i className={`bi ${copySuccess ? 'bi-check-circle-fill text-emerald-500' : 'bi-share'} text-lg`}></i>
                <span>{copySuccess ? 'Enlace copiado' : 'Compartir'}</span>
              </button>
            </div>
          </div>

          <div className="flex flex-col">
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-3">
                {product.category && (
                  <span className="px-3 py-1 bg-red-50 text-red-600 text-[10px] font-black uppercase tracking-widest rounded-full">
                    {product.category}
                  </span>
                )}
                <span className={`px-3 py-1 text-[10px] font-black uppercase tracking-widest rounded-full ${product.isAvailable ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
                  {product.isAvailable ? '✓ Disponible' : '✗ No disponible'}
                </span>
              </div>
              <h1 className="text-3xl sm:text-4xl font-black text-gray-900 tracking-tight leading-tight mb-4">
                {product.name}
              </h1>
              {product.description && (
                <p className="text-gray-500 text-sm sm:text-base leading-relaxed mb-6 font-medium">
                  {product.description}
                </p>
              )}
            </div>

            {product.variants && product.variants.length > 0 ? (
              <div className="mb-8">
                <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-4">
                  Selecciona una opción
                </label>
                <div className="grid grid-cols-1 gap-3">
                  {product.variants.map((variant) => {
                    const cartItem = cart.find(item => item.id === product.id && item.variantName === variant.name);
                    const qty = cartItem ? cartItem.quantity : 0;

                    return (
                      <div
                        key={variant.name}
                        className={`w-full flex items-center justify-between p-4 rounded-2xl border-2 transition-all duration-300 ${qty > 0
                          ? 'border-red-500 bg-red-50 shadow-md ring-1 ring-red-500/10'
                          : 'border-gray-100 bg-white hover:border-gray-200'
                          }`}
                      >
                        <div className="flex-1 min-w-0 pr-4">
                          <span className="block font-bold text-gray-900">
                            {variant.name}
                          </span>
                          <span className="text-lg font-black text-red-600">
                            ${variant.price.toFixed(2)}
                          </span>
                        </div>

                        <div className="flex-shrink-0">
                          {qty > 0 ? (
                            <div className="flex items-center bg-gray-100 rounded-xl p-1 gap-1">
                              <button
                                onClick={() => updateQuantity(product.id, qty - 1, variant.name)}
                                className="w-8 h-8 flex items-center justify-center bg-white rounded-lg text-gray-600 shadow-sm hover:text-red-500 transition-all"
                              >
                                <span className="text-lg">−</span>
                              </button>
                              <span className="w-8 text-center font-black text-sm text-gray-900">
                                {qty}
                              </span>
                              <button
                                onClick={() => updateQuantity(product.id, qty + 1, variant.name)}
                                className="w-8 h-8 flex items-center justify-center bg-white rounded-lg text-gray-600 shadow-sm hover:text-green-600 transition-all"
                              >
                                <span className="text-lg">+</span>
                              </button>
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
                                  businessId: business?.id || product.businessId,
                                  businessName: business?.name || product.businessName,
                                  businessImage: business?.image || product.businessImage,
                                  category: product.category
                                };

                                const cartsData = localStorage.getItem('carts');
                                const allCarts = cartsData ? JSON.parse(cartsData) : {};
                                const businessIdForCart = business?.id || product.businessId || 'unknown';
                                const currentCart = allCarts[businessIdForCart] || [];

                                currentCart.push({ ...itemToAdd, quantity: 1 });
                                allCarts[businessIdForCart] = currentCart;
                                localStorage.setItem('carts', JSON.stringify(allCarts));
                                setCart([...currentCart]);
                                showNotification(`${product.name} - ${variant.name} agregado`);
                              }}
                              disabled={!product.isAvailable}
                              className="w-10 h-10 flex items-center justify-center bg-gray-900 text-white rounded-xl shadow-lg hover:bg-black transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <i className="bi bi-plus-lg text-sm"></i>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="mb-8">
                <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 p-6 bg-gray-50 rounded-[2rem] border border-gray-100">
                  <div className="inline-flex flex-col">
                    <span className="text-xs font-black text-gray-400 uppercase tracking-widest mb-1">Precio</span>
                    <p className="text-4xl font-black text-red-600 tracking-tight">
                      ${product.price.toFixed(2)}
                    </p>
                  </div>

                  {(() => {
                    const cartItem = cart.find(item => item.id === product.id && item.variantName === null);
                    const qty = cartItem ? cartItem.quantity : 0;

                    return (
                      <div className="flex-shrink-0">
                        {qty > 0 ? (
                          <div className="flex items-center bg-white rounded-2xl p-2 gap-2 shadow-sm border border-gray-100">
                            <button
                              onClick={() => updateQuantity(product.id, qty - 1, null)}
                              className="w-12 h-12 flex items-center justify-center bg-gray-50 rounded-xl text-gray-600 hover:text-red-500 transition-all"
                            >
                              <i className="bi bi-dash text-xl"></i>
                            </button>
                            <span className="w-10 text-center font-black text-xl text-gray-900">
                              {qty}
                            </span>
                            <button
                              onClick={() => updateQuantity(product.id, qty + 1, null)}
                              className="w-12 h-12 flex items-center justify-center bg-gray-50 rounded-xl text-gray-600 hover:text-green-600 transition-all"
                            >
                              <i className="bi bi-plus text-xl"></i>
                            </button>
                          </div>
                        ) : (
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
                                businessId: business?.id || product.businessId,
                                businessName: business?.name || product.businessName,
                                businessImage: business?.image || product.businessImage,
                                category: product.category
                              };

                              const cartsData = localStorage.getItem('carts');
                              const allCarts = cartsData ? JSON.parse(cartsData) : {};
                              const businessIdForCart = business?.id || product.businessId || 'unknown';
                              const currentCart = allCarts[businessIdForCart] || [];

                              currentCart.push({ ...itemToAdd, quantity: 1 });
                              allCarts[businessIdForCart] = currentCart;
                              localStorage.setItem('carts', JSON.stringify(allCarts));
                              setCart([...currentCart]);
                              showNotification(`${product.name} agregado`);
                            }}
                            disabled={!product.isAvailable}
                            className="bg-gray-900 hover:bg-black text-white font-black py-4 px-8 rounded-2xl shadow-xl transition-all active:scale-95 flex items-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <i className="bi bi-bag-plus-fill text-lg"></i>
                            <span className="uppercase tracking-widest text-xs">Agregar</span>
                          </button>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      {relatedProducts.length > 0 && (
        <section className="bg-white border-t border-gray-100 mt-12 pb-20">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
            <div className="flex items-center gap-4 mb-8">
              <h2 className="text-xl sm:text-2xl font-black text-gray-900 tracking-tight">
                Otros productos de {business?.name}
              </h2>
              <div className="flex-1 h-px bg-gradient-to-r from-gray-100 to-transparent"></div>
            </div>

            <div className="relative">
              <div
                className="flex gap-5 overflow-x-auto snap-x snap-mandatory scrollbar-hide pb-6"
                style={{
                  scrollbarWidth: 'none',
                  msOverflowStyle: 'none',
                  WebkitOverflowScrolling: 'touch'
                }}
              >
                {relatedProducts.map((prod) => (
                  <Link
                    key={prod.id}
                    href={`/${username}/${prod.slug || prod.id}`}
                    className="group flex-shrink-0 snap-start w-[180px] sm:w-[220px]"
                  >
                    <div className="bg-white rounded-[2rem] overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300 h-full border border-gray-50 group-hover:border-red-50 group-hover:ring-1 group-hover:ring-red-50 translate-z-0">
                      <div className="relative w-full aspect-square bg-gray-50 overflow-hidden">
                        {prod.image ? (
                          <img
                            src={prod.image}
                            alt={prod.name}
                            className="absolute inset-0 w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                          />
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <i className="bi bi-image text-5xl text-gray-200"></i>
                          </div>
                        )}
                        <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                          <div className="bg-white/90 backdrop-blur-sm p-1.5 rounded-full shadow-sm">
                            <i className="bi bi-arrow-right-short text-gray-900 text-xl"></i>
                          </div>
                        </div>
                      </div>

                      <div className="p-4 flex flex-col items-center text-center">
                        <h3 className="font-bold text-gray-900 text-sm mb-2 line-clamp-2 transition-colors min-h-[2.5rem] tracking-tight group-hover:text-red-600">
                          {prod.name}
                        </h3>
                        <p className="text-red-500 font-black text-lg tracking-tight">
                          ${prod.price.toFixed(2)}
                        </p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>

              {relatedProducts.length > 2 && (
                <div className="absolute right-0 top-0 bottom-6 w-20 pointer-events-none bg-gradient-to-l from-white via-white/50 to-transparent flex items-center justify-end pr-2">
                  <div className="animate-pulse bg-white/80 p-2 rounded-full shadow-sm backdrop-blur-sm">
                    <i className="bi bi-chevron-right text-xl text-gray-400"></i>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Floating Cart Button - Ultra Modern (Synchronized with Store Page) */}
      {cartItemsCount > 0 && (
        <div className="fixed bottom-8 right-6 z-40">
          <button
            onClick={() => setIsCartOpen(true)}
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
      )}

      <CartSidebar
        isOpen={isCartOpen}
        onClose={() => setIsCartOpen(false)}
        cart={cart}
        business={business}
        removeFromCart={removeFromCart}
        updateQuantity={updateQuantity}
        clearCart={clearCart}
        addItemToCart={(item: any) => {
          if (!business?.id) return

          const existingItem = cart.find((i: any) => i.id === item.id && i.variantName === (item.variantName ?? null))
          const newCart = existingItem
            ? cart.map((i: any) => (i.id === item.id && i.variantName === (item.variantName ?? null))
              ? { ...i, quantity: (i.quantity || 1) + (item.quantity || 1) }
              : i
            )
            : [...cart, { ...item, quantity: item.quantity || 1 }]

          setCart(newCart)
          updateCartInStorage(business.id, newCart)
        }}
        onOpenUserSidebar={() => setIsUserSidebarOpen(true)}
      />

      <UserSidebar
        isOpen={isUserSidebarOpen}
        onClose={() => setIsUserSidebarOpen(false)}
        onLogin={() => setShowLoginModal(true)}
      />

      <ClientLoginModal
        isOpen={showLoginModal}
        onClose={() => setShowLoginModal(false)}
        onLoginSuccess={(phone) => {
          setClientPhone(phone)
          setShowLoginModal(false)
        }}
      />

      {/* Notificación temporal - Premium Toast */}
      {notification.show && (
        <div className="fixed top-8 left-1/2 -translate-x-1/2 z-[100] w-[calc(100%-2rem)] max-w-xs pointer-events-none animate-[slideDown_0.3s_ease-out]">
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

