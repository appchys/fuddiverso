"use client"

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { getProduct, getBusinessByProduct, getProductsByBusiness } from '@/lib/database'
import type { Product, Business } from '@/types/index'
import CartSidebar from '@/components/CartSidebar'

export default function ProductPageByUsername() {
  const params = useParams()
  const productId = params.productId as string
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

  useEffect(() => {
    const loadProduct = async () => {
      try {
        setLoading(true)
        setError(null)

        const productData = await getProduct(productId)
        if (!productData) {
          setError('Producto no encontrado')
          setLoading(false)
          return
        }

        setProduct(productData)

        const businessData = await getBusinessByProduct(productId)
        if (businessData) {
          setBusiness(businessData)

          const allProducts = await getProductsByBusiness(businessData.id)
          const otherProducts = allProducts
            .filter(p => p.id !== productId && p.isAvailable)
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

    if (productId) {
      loadProduct()
    }
  }, [productId])

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
      document.title = `${product.name} - fuddi.shop`

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

      updateMetaTag('description', product.description || 'Descubre este producto en fuddi.shop', false)

      const canonicalUrl = `https://fuddi.shop/${username}/${productId}`

      updateMetaTag('og:type', 'product')
      updateMetaTag('og:title', product.name)
      updateMetaTag('og:description', product.description || 'Descubre este producto en fuddi.shop')
      updateMetaTag('og:image', product.image || '')
      updateMetaTag('og:url', canonicalUrl)
      updateMetaTag('og:site_name', 'fuddi.shop')
      updateMetaTag('og:locale', 'es_ES')

      updateMetaTag('twitter:card', 'summary_large_image', false)
      updateMetaTag('twitter:title', product.name, false)
      updateMetaTag('twitter:description', product.description || 'Descubre este producto en fuddi.shop', false)
      updateMetaTag('twitter:image', product.image || '', false)
    }
  }, [product, productId, username])

  const handleAddToCart = () => {
    if (!product) return

    try {
      const cartsData = localStorage.getItem('carts')
      const allCarts = cartsData ? JSON.parse(cartsData) : {}

      const businessIdForCart = business?.id || 'unknown'

      const currentCart = allCarts[businessIdForCart] || []

      const itemKey = selectedVariant ? `${product.id}-${selectedVariant}` : product.id

      const existingItemIndex = currentCart.findIndex((item: any) => {
        const cartItemKey = item.variant ? `${item.id}-${item.variant}` : item.id
        return cartItemKey === itemKey
      })

      if (existingItemIndex >= 0) {
        currentCart[existingItemIndex].quantity += quantity
      } else {
        const variantData = selectedVariant && product.variants
          ? product.variants.find(v => v.name === selectedVariant)
          : null

        currentCart.push({
          id: product.id,
          productName: product.name,
          variantName: selectedVariant || null,
          name: selectedVariant ? `${product.name} - ${selectedVariant}` : product.name,
          price: variantData ? variantData.price : product.price,
          quantity,
          image: product.image,
          category: product.category,
          variant: selectedVariant || null
        })
      }

      allCarts[businessIdForCart] = currentCart
      localStorage.setItem('carts', JSON.stringify(allCarts))

      alert(`${product.name}${selectedVariant ? ` - ${selectedVariant}` : ''} agregado al carrito`)

      setQuantity(1)
    } catch (error) {
      console.error('Error adding to cart:', error)
      alert('Error al agregar al carrito')
    }
  }

  const removeFromCart = (productIdToRemove: string) => {
    if (!business?.id) return

    const newCart = cart.filter(item => item.id !== productIdToRemove)
    setCart(newCart)
    updateCartInStorage(business.id, newCart)
  }

  const updateQuantity = (productIdToUpdate: string, newQuantity: number) => {
    if (!business?.id) return

    if (newQuantity <= 0) {
      removeFromCart(productIdToUpdate)
      return
    }

    const newCart = cart.map(item =>
      item.id === productIdToUpdate
        ? { ...item, quantity: newQuantity }
        : item
    )

    setCart(newCart)
    updateCartInStorage(business.id, newCart)
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
  const cartItemsCount = cart.reduce((sum, item) => sum + item.quantity, 0)

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
    <div className="min-h-screen bg-gray-50">
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="w-full aspect-square bg-white rounded-lg overflow-hidden shadow-sm">
            {product.image ? (
              <img
                src={product.image}
                alt={product.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gray-100">
                <i className="bi bi-image text-6xl text-gray-300"></i>
              </div>
            )}
          </div>

          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="mb-4">
              {product.category && (
                <p className="text-sm text-gray-500 mb-2">{product.category}</p>
              )}
              <h1 className="text-3xl font-bold text-gray-900">{product.name}</h1>
            </div>

            {product.description && (
              <p className="text-gray-600 mb-6 leading-relaxed">
                {product.description}
              </p>
            )}

            {product.variants && product.variants.length > 0 && (
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-900 mb-3">
                  Selecciona una opción:
                </label>
                <div className="space-y-2">
                  {product.variants.map((variant) => (
                    <button
                      key={variant.name}
                      onClick={() => setSelectedVariant(variant.name)}
                      className={`w-full flex items-center justify-between p-3 rounded-lg border-2 transition-colors ${selectedVariant === variant.name
                        ? 'border-red-500 bg-red-50'
                        : 'border-gray-200 hover:border-gray-300'
                        }`}
                    >
                      <span className="font-medium text-gray-900">{variant.name}</span>
                      <span className="text-lg font-semibold text-red-600">
                        ${variant.price.toFixed(2)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {(!product.variants || product.variants.length === 0) && (
              <div className="mb-6">
                <p className="text-4xl font-bold text-red-600">
                  ${product.price.toFixed(2)}
                </p>
              </div>
            )}

            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-900 mb-3">
                Cantidad:
              </label>
              <div className="flex items-center space-x-3">
                <button
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  className="w-10 h-10 flex items-center justify-center border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <i className="bi bi-dash"></i>
                </button>
                <input
                  type="number"
                  value={quantity}
                  onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-16 text-center border border-gray-300 rounded-lg py-2 px-3 focus:ring-red-500 focus:border-red-500"
                  min="1"
                />
                <button
                  onClick={() => setQuantity(quantity + 1)}
                  className="w-10 h-10 flex items-center justify-center border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <i className="bi bi-plus"></i>
                </button>
              </div>
            </div>

            <button
              onClick={handleAddToCart}
              className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-4 rounded-lg transition-colors flex items-center justify-center space-x-2"
            >
              <i className="bi bi-bag-plus"></i>
              <span>Agregar al carrito</span>
            </button>

            <div className="mt-6 p-3 bg-gray-50 rounded-lg">
              <p className={`text-sm font-medium ${product.isAvailable ? 'text-green-600' : 'text-red-600'}`}>
                {product.isAvailable ? '✓ Disponible' : '✗ No disponible'}
              </p>
            </div>
          </div>
        </div>
      </main>

      {relatedProducts.length > 0 && (
        <section className="bg-white border-t mt-12">
          <div className="max-w-7xl mx-auto py-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-6 px-4 sm:px-6 lg:px-8">
              Otros productos de {business?.name}
            </h2>

            <div className="relative">
              <div
                className="flex gap-4 overflow-x-auto snap-x snap-mandatory scrollbar-hide px-4 sm:px-6 lg:px-8 pb-4"
                style={{
                  scrollbarWidth: 'none',
                  msOverflowStyle: 'none',
                  WebkitOverflowScrolling: 'touch'
                }}
              >
                {relatedProducts.map((prod) => (
                  <Link
                    key={prod.id}
                    href={`/${username}/${prod.id}`}
                    className="group flex-shrink-0 snap-start w-[160px] sm:w-[200px]"
                  >
                    <div className="bg-white rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-shadow duration-300 h-full">
                      <div className="relative w-full aspect-square bg-gray-100 overflow-hidden">
                        {prod.image ? (
                          <img
                            src={prod.image}
                            alt={prod.name}
                            className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <i className="bi bi-image text-4xl text-gray-300"></i>
                          </div>
                        )}
                      </div>

                      <div className="p-3">
                        <h3 className="font-semibold text-gray-900 text-sm mb-2 line-clamp-2 group-hover:text-red-600 transition-colors min-h-[2.5rem]">
                          {prod.name}
                        </h3>
                        <p className="text-red-600 font-bold text-base">
                          ${prod.price.toFixed(2)}
                        </p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>

              {relatedProducts.length > 2 && (
                <div className="absolute right-0 top-0 bottom-4 w-16 pointer-events-none bg-gradient-to-l from-white via-white/80 to-transparent flex items-center justify-end pr-2">
                  <div className="animate-pulse">
                    <i className="bi bi-chevron-right text-2xl text-gray-400"></i>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {cart.length > 0 && business && (
        <div className="fixed bottom-6 right-6 z-40">
          <button
            onClick={() => setIsCartOpen(true)}
            className="bg-gradient-to-r from-red-500 to-red-600 text-white rounded-full shadow-2xl hover:from-red-600 hover:to-red-700 transition-all duration-300 transform hover:scale-105 group"
          >
            <div className="flex items-center px-4 py-3 space-x-2">
              <div className="relative">
                <i className="bi bi-cart text-xl"></i>
                <span className="absolute -top-2 -right-2 bg-yellow-400 text-red-900 rounded-full w-5 h-5 text-xs font-bold flex items-center justify-center animate-pulse">
                  {cartItemsCount}
                </span>
              </div>
              <div className="hidden sm:block text-left">
                <div className="text-sm font-semibold leading-none">
                  ${cartTotal.toFixed(2)}
                </div>
                <div className="text-xs text-red-100 leading-none mt-0.5">Ver carrito</div>
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
      />
    </div>
  )
}

