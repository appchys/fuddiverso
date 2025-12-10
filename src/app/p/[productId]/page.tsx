'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { getProduct, getBusinessByProduct, getProductsByBusiness } from '@/lib/database'
import type { Product, Business } from '@/types/index'

export default function ProductPage() {
  const params = useParams()
  const productId = params.productId as string

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

        // Obtener el producto
        const productData = await getProduct(productId)
        if (!productData) {
          setError('Producto no encontrado')
          setLoading(false)
          return
        }

        setProduct(productData)

        // Obtener el negocio del producto
        const businessData = await getBusinessByProduct(productId)
        if (businessData) {
          setBusiness(businessData)

          // Obtener otros productos de la tienda
          const allProducts = await getProductsByBusiness(businessData.id)
          // Filtrar para excluir el producto actual, solo disponibles, y tomar máximo 10
          const otherProducts = allProducts
            .filter(p => p.id !== productId && p.isAvailable)
            .slice(0, 10)
          setRelatedProducts(otherProducts)
        }

        // Seleccionar la primera variante por defecto si existen variantes
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

  // Cargar carrito específico de esta tienda desde localStorage
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

      // Escuchar cambios en localStorage
      const handleStorageChange = () => loadCart()
      window.addEventListener('storage', handleStorageChange)

      // También verificar cada segundo para cambios locales
      const interval = setInterval(loadCart, 1000)

      return () => {
        window.removeEventListener('storage', handleStorageChange)
        clearInterval(interval)
      }
    }
  }, [business?.id])

  // Actualizar meta tags dinámicamente cuando se carga el producto
  useEffect(() => {
    if (product) {
      // Actualizar título
      document.title = `${product.name} - fuddi.shop`

      // Función helper para actualizar o crear meta tags
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

      // Meta tags básicos
      updateMetaTag('description', product.description || 'Descubre este producto en fuddi.shop', false)

      // Open Graph
      updateMetaTag('og:type', 'product')
      updateMetaTag('og:title', product.name)
      updateMetaTag('og:description', product.description || 'Descubre este producto en fuddi.shop')
      updateMetaTag('og:image', product.image || '')
      updateMetaTag('og:url', `https://fuddi.shop/p/${productId}`)
      updateMetaTag('og:site_name', 'fuddi.shop')
      updateMetaTag('og:locale', 'es_ES')

      // Twitter
      updateMetaTag('twitter:card', 'summary_large_image', false)
      updateMetaTag('twitter:title', product.name, false)
      updateMetaTag('twitter:description', product.description || 'Descubre este producto en fuddi.shop', false)
      updateMetaTag('twitter:image', product.image || '', false)
    }
  }, [product, productId])

  const handleAddToCart = () => {
    if (!product) return

    try {
      // Obtener el carrito actual del localStorage
      const cartsData = localStorage.getItem('carts')
      const allCarts = cartsData ? JSON.parse(cartsData) : {}

      // Asumimos que el producto pertenece a un negocio (necesitaríamos obtenerlo)
      // Por ahora usamos un ID genérico
      const businessIdForCart = business?.id || 'unknown'

      // Obtener o crear el carrito para este negocio
      const currentCart = allCarts[businessIdForCart] || []

      // Crear clave única para el item (considerando variante)
      const itemKey = selectedVariant ? `${product.id}-${selectedVariant}` : product.id

      // Buscar si el item ya existe en el carrito
      const existingItemIndex = currentCart.findIndex((item: any) => {
        const cartItemKey = item.variant ? `${item.id}-${item.variant}` : item.id
        return cartItemKey === itemKey
      })

      if (existingItemIndex >= 0) {
        // Incrementar cantidad del item existente
        currentCart[existingItemIndex].quantity += quantity
      } else {
        // Agregar nuevo item al carrito
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

      // Guardar carrito actualizado
      allCarts[businessIdForCart] = currentCart
      localStorage.setItem('carts', JSON.stringify(allCarts))

      // Mostrar confirmación
      alert(`${product.name}${selectedVariant ? ` - ${selectedVariant}` : ''} agregado al carrito`)

      // Resetear cantidad
      setQuantity(1)
    } catch (error) {
      console.error('Error adding to cart:', error)
      alert('Error al agregar al carrito')
    }
  }

  const removeFromCart = (productId: string) => {
    if (!business?.id) return

    const newCart = cart.filter(item => item.id !== productId)
    setCart(newCart)
    updateCartInStorage(business.id, newCart)
  }

  const updateQuantity = (productId: string, quantity: number) => {
    if (!business?.id) return

    if (quantity <= 0) {
      removeFromCart(productId)
      return
    }

    const newCart = cart.map(item =>
      item.id === productId
        ? { ...item, quantity }
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
            href="/"
            className="inline-block bg-red-600 hover:bg-red-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
          >
            Volver al inicio
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Contenido del producto */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Imagen del producto */}
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

          {/* Información del producto */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            {/* Categoría y nombre */}
            <div className="mb-4">
              {product.category && (
                <p className="text-sm text-gray-500 mb-2">{product.category}</p>
              )}
              <h1 className="text-3xl font-bold text-gray-900">{product.name}</h1>
            </div>

            {/* Descripción */}
            {product.description && (
              <p className="text-gray-600 mb-6 leading-relaxed">
                {product.description}
              </p>
            )}

            {/* Variantes */}
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

            {/* Precio (si no hay variantes) */}
            {(!product.variants || product.variants.length === 0) && (
              <div className="mb-6">
                <p className="text-4xl font-bold text-red-600">
                  ${product.price.toFixed(2)}
                </p>
              </div>
            )}

            {/* Cantidad */}
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

            {/* Botón agregar al carrito */}
            <button
              onClick={handleAddToCart}
              className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-4 rounded-lg transition-colors flex items-center justify-center space-x-2"
            >
              <i className="bi bi-bag-plus"></i>
              <span>Agregar al carrito</span>
            </button>

            {/* Disponibilidad */}
            <div className="mt-6 p-3 bg-gray-50 rounded-lg">
              <p className={`text-sm font-medium ${product.isAvailable ? 'text-green-600' : 'text-red-600'}`}>
                {product.isAvailable ? '✓ Disponible' : '✗ No disponible'}
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* Carrusel de productos relacionados */}
      {relatedProducts.length > 0 && (
        <section className="bg-white border-t mt-12">
          <div className="max-w-7xl mx-auto py-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-6 px-4 sm:px-6 lg:px-8">
              Otros productos de {business?.name}
            </h2>

            {/* Carrusel deslizable horizontal */}
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
                    href={`/p/${prod.id}`}
                    className="group flex-shrink-0 snap-start w-[160px] sm:w-[200px]"
                  >
                    <div className="bg-white rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-shadow duration-300 h-full">
                      {/* Contenedor de imagen con aspect ratio fijo */}
                      <div className="relative w-full aspect-square bg-gray-100 overflow-hidden">
                        {prod.image ? (
                          <img
                            src={prod.image}
                            alt={prod.name}
                            className="absolute inset-0 w-full h-full object-contain p-2 group-hover:scale-105 transition-transform duration-300"
                          />
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <i className="bi bi-image text-4xl text-gray-300"></i>
                          </div>
                        )}
                      </div>

                      {/* Información del producto */}
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

              {/* Indicador de deslizamiento */}
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

      {/* Floating Cart Button */}
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

      {/* Cart Sidebar */}
      {isCartOpen && (
        <div className="fixed inset-0 z-50 overflow-hidden">
          <div className="absolute inset-0 bg-black bg-opacity-50 transition-all duration-300" onClick={() => setIsCartOpen(false)} />
          <div className="absolute right-0 top-0 h-full w-full sm:w-96 bg-white shadow-2xl">
            <div className="flex flex-col h-full">
              {/* Header */}
              <div className="p-4 bg-gradient-to-r from-red-500 to-red-600 text-white">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold">Tu Pedido</h3>
                    <p className="text-red-100 text-sm">{business?.name}</p>
                  </div>
                  <button
                    onClick={() => setIsCartOpen(false)}
                    className="p-2 hover:bg-red-600 rounded-lg transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                {cart.length > 0 && (
                  <div className="mt-2 text-sm text-red-100">
                    {cartItemsCount} {cartItemsCount === 1 ? 'producto' : 'productos'}
                  </div>
                )}
              </div>

              {/* Cart Content */}
              <div className="flex-1 overflow-y-auto px-4 pt-4">
                {cart.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center px-4">
                    <div className="w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                      <i className="bi bi-cart text-4xl text-gray-400"></i>
                    </div>
                    <h4 className="text-lg font-medium text-gray-900 mb-2">Tu carrito está vacío</h4>
                    <p className="text-gray-500 text-sm">Agrega algunos productos para comenzar</p>
                  </div>
                ) : (
                  <div className="space-y-4 pb-4">
                    {(() => {
                      // Agrupar items por producto
                      const grouped: Record<string, any[]> = {}

                      cart.forEach(item => {
                        const key = item.productName || item.name
                        if (!grouped[key]) grouped[key] = []
                        grouped[key].push(item)
                      })

                      return Object.entries(grouped).map(([productName, items], groupIndex) => {
                        const firstItem = items[0]

                        return (
                          <div key={productName} className={groupIndex > 0 ? 'pt-4 border-t border-gray-200' : ''}>
                            {/* Header del producto */}
                            <div className="flex items-center gap-2 mb-2 px-2">
                              <div className="w-8 h-8 rounded-md overflow-hidden bg-gray-100 flex-shrink-0">
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
                              <h4 className="font-semibold text-sm text-gray-900">{productName}</h4>
                            </div>

                            {/* Items del producto */}
                            <div className="space-y-2">
                              {items.map((item) => (
                                <div
                                  key={item.id}
                                  className="flex items-center gap-2 p-3 rounded-lg transition-all bg-white border border-gray-200 hover:shadow-sm"
                                >
                                  {/* Nombre de variante o producto */}
                                  <div className="flex-1 min-w-0">
                                    <p className="font-medium text-sm leading-tight line-clamp-2 text-gray-900">
                                      {item.variantName || item.name}
                                    </p>
                                  </div>

                                  {/* Cantidad */}
                                  <div className="flex items-center border rounded-lg overflow-hidden bg-white flex-shrink-0">
                                    <button
                                      onClick={() => updateQuantity(item.id, item.quantity - 1)}
                                      className="px-1.5 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors"
                                    >
                                      −
                                    </button>
                                    <div className="px-2 py-1 min-w-[32px] text-center font-medium text-sm">
                                      {item.quantity}
                                    </div>
                                    <button
                                      onClick={() => updateQuantity(item.id, item.quantity + 1)}
                                      className="px-1.5 py-1 bg-red-500 text-white hover:bg-red-600 transition-colors"
                                    >
                                      +
                                    </button>
                                  </div>

                                  {/* Subtotal */}
                                  <div className="font-bold text-sm min-w-[50px] text-right flex-shrink-0 text-gray-900">
                                    ${(item.price * item.quantity).toFixed(2)}
                                  </div>

                                  {/* Eliminar */}
                                  <button
                                    onClick={() => removeFromCart(item.id)}
                                    className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition flex-shrink-0"
                                    title="Eliminar"
                                  >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )
                      })
                    })()}
                  </div>
                )}
              </div>

              {/* Footer con resumen y botón de checkout */}
              {cart.length > 0 && (
                <div className="border-t bg-white p-4 space-y-4">
                  {/* Resumen del pedido */}
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Subtotal ({cartItemsCount} productos)</span>
                      <span className="font-medium">${cartTotal.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Envío</span>
                      <span className="text-gray-500">A calcular</span>
                    </div>
                    <div className="border-t pt-2">
                      <div className="flex justify-between items-center">
                        <span className="font-semibold text-gray-900">Total</span>
                        <span className="font-bold text-xl text-red-600">${cartTotal.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Botón de checkout */}
                  <Link
                    href={`/checkout?businessId=${business!.id}`}
                    className="w-full bg-gradient-to-r from-red-500 to-red-600 text-white py-4 rounded-xl hover:from-red-600 hover:to-red-700 transition-all duration-200 flex items-center justify-center font-semibold text-lg shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
                    onClick={() => setIsCartOpen(false)}
                  >
                    <i className="bi bi-cart mr-2 text-xl"></i>
                    Continuar con el pedido
                  </Link>

                  {/* Texto informativo */}
                  <p className="text-xs text-gray-500 text-center">
                    Los costos de envío se calcularán en el siguiente paso
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
