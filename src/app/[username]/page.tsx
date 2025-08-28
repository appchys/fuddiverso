'use client'

import { useState, useEffect, Suspense } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Business, Product } from '@/types'
import { getBusinessByUsername, getProductsByBusiness } from '@/lib/database'

export default function RestaurantPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-red-500 mx-auto"></div>
          <p className="mt-4 text-gray-600">Cargando restaurante...</p>
        </div>
      </div>
    }>
      <RestaurantContent />
    </Suspense>
  )
}

function RestaurantContent() {
  const params = useParams()
  const router = useRouter()
  const username = params.username as string

  const [business, setBusiness] = useState<Business | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cart, setCart] = useState<any[]>([])
  const [isCartOpen, setIsCartOpen] = useState(false)

  useEffect(() => {
    const loadRestaurantData = async () => {
      try {
        setLoading(true)
        const businessData = await getBusinessByUsername(username)
        
        if (!businessData) {
          setError('Restaurante no encontrado')
          return
        }

        setBusiness(businessData)
        const productsData = await getProductsByBusiness(businessData.id)
        setProducts(productsData)
      } catch (err) {
        console.error('Error loading restaurant data:', err)
        setError('Error al cargar el restaurante')
      } finally {
        setLoading(false)
      }
    }

    if (username) {
      loadRestaurantData()
    }
  }, [username])

  // Cargar carrito desde localStorage
  useEffect(() => {
    const savedCart = localStorage.getItem('cart')
    if (savedCart) {
      setCart(JSON.parse(savedCart))
    }
  }, [])

  const addToCart = (product: Product) => {
    const existingItem = cart.find(item => item.id === product.id)
    let newCart

    if (existingItem) {
      newCart = cart.map(item =>
        item.id === product.id
          ? { ...item, quantity: item.quantity + 1 }
          : item
      )
    } else {
      newCart = [...cart, { 
        ...product, 
        quantity: 1, 
        businessId: business?.id 
      }]
    }

    setCart(newCart)
    localStorage.setItem('cart', JSON.stringify(newCart))
  }

  const removeFromCart = (productId: string) => {
    const newCart = cart.filter(item => item.id !== productId)
    setCart(newCart)
    localStorage.setItem('cart', JSON.stringify(newCart))
  }

  const updateQuantity = (productId: string, quantity: number) => {
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
    localStorage.setItem('cart', JSON.stringify(newCart))
  }

  const getCartItemQuantity = (productId: string) => {
    const item = cart.find(item => item.id === productId)
    return item ? item.quantity : 0
  }

  const cartTotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0)
  const cartItemsCount = cart.reduce((sum, item) => sum + item.quantity, 0)

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-red-500 mx-auto"></div>
          <p className="mt-4 text-gray-600">Cargando...</p>
        </div>
      </div>
    )
  }

  if (error || !business) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">
            {error || 'Restaurante no encontrado'}
          </h1>
          <Link
            href="/"
            className="inline-block bg-red-500 text-white px-6 py-3 rounded-lg hover:bg-red-600"
          >
            Volver al inicio
          </Link>
        </div>
      </div>
    )
  }

  // Agrupar productos por categoría
  const productsByCategory = products.reduce((acc, product) => {
    const category = product.category || 'Otros'
    if (!acc[category]) {
      acc[category] = []
    }
    acc[category].push(product)
    return acc
  }, {} as Record<string, Product[]>)

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Hero Section */}
      <div className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-6 sm:py-8">
          <div className="flex flex-col sm:flex-row items-center sm:items-start space-y-4 sm:space-y-0 sm:space-x-6">
            {business.image && (
              <img
                src={business.image}
                alt={business.name}
                className="w-20 h-20 sm:w-24 sm:h-24 rounded-lg object-cover"
              />
            )}
            <div className="flex-1 text-center sm:text-left">
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">{business.name}</h1>
              <p className="text-gray-600 mt-2">{business.description}</p>
              <div className="flex flex-col sm:flex-row items-center sm:items-start sm:space-x-4 mt-4 text-sm text-gray-500 space-y-1 sm:space-y-0">
                <span className="flex items-center">📍 {business.address}</span>
                <span className="flex items-center">📞 {business.phone}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Menu Content */}
      <div className="max-w-7xl mx-auto px-4 py-6 sm:py-8">
        <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-6">Nuestro Menú</h2>
        
        {Object.entries(productsByCategory).map(([category, categoryProducts]) => (
          <div key={category} className="mb-8">
            <h3 className="text-lg sm:text-xl font-semibold text-gray-800 mb-4">{category}</h3>
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
              {categoryProducts.map((product) => (
                <div key={product.id} className="bg-white rounded-lg shadow-md overflow-hidden">
                  {product.image && (
                    <img
                      src={product.image}
                      alt={product.name}
                      className="w-full h-32 sm:h-40 object-cover"
                    />
                  )}
                  <div className="p-3 sm:p-4">
                    <h4 className="font-semibold text-sm sm:text-base text-gray-900 line-clamp-2">{product.name}</h4>
                    <p className="text-gray-600 text-xs sm:text-sm mt-1 line-clamp-2">{product.description}</p>
                    <div className="flex flex-col gap-2 mt-3">
                      <span className="text-base sm:text-lg font-bold text-red-500">${product.price}</span>
                      
                      {getCartItemQuantity(product.id) > 0 ? (
                        <div className="flex items-center justify-center space-x-2">
                          <button
                            onClick={() => updateQuantity(product.id, getCartItemQuantity(product.id) - 1)}
                            className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-red-500 text-white flex items-center justify-center hover:bg-red-600 text-sm"
                          >
                            -
                          </button>
                          <span className="font-medium text-sm">{getCartItemQuantity(product.id)}</span>
                          <button
                            onClick={() => updateQuantity(product.id, getCartItemQuantity(product.id) + 1)}
                            className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-red-500 text-white flex items-center justify-center hover:bg-red-600 text-sm"
                          >
                            +
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => addToCart(product)}
                          className="bg-red-500 text-white px-3 py-2 rounded-lg hover:bg-red-600 text-xs sm:text-sm font-medium"
                        >
                          Agregar
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Floating Cart Button */}
      {cart.length > 0 && (
        <button
          onClick={() => setIsCartOpen(true)}
          className="fixed bottom-6 right-6 bg-red-500 text-white rounded-full w-14 h-14 sm:w-16 sm:h-16 flex items-center justify-center shadow-lg hover:bg-red-600 transition-all z-40"
        >
          <div className="relative">
            <svg className="w-6 h-6 sm:w-7 sm:h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4m0 0L7 13m0 0l-1.8 9H19M7 13v6a2 2 0 002 2h6a2 2 0 002-2v-6M7 13H5" />
            </svg>
            {cartItemsCount > 0 && (
              <span className="absolute -top-2 -right-2 bg-yellow-400 text-red-900 rounded-full w-5 h-5 text-xs font-bold flex items-center justify-center">
                {cartItemsCount}
              </span>
            )}
          </div>
        </button>
      )}

      {/* Cart Sidebar */}
      {isCartOpen && (
        <div className="fixed inset-0 z-50 overflow-hidden">
          <div className="absolute inset-0 bg-black bg-opacity-50" onClick={() => setIsCartOpen(false)} />
          <div className="absolute right-0 top-0 h-full w-full sm:w-96 bg-white shadow-xl transform transition-transform">
            <div className="flex flex-col h-full">
              {/* Header */}
              <div className="p-4 border-b bg-red-500 text-white flex items-center justify-between">
                <h3 className="text-lg font-semibold">Tu Pedido</h3>
                <button
                  onClick={() => setIsCartOpen(false)}
                  className="text-white hover:text-gray-200"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Cart Content */}
              <div className="flex-1 overflow-y-auto p-4">
                {cart.length === 0 ? (
                  <div className="text-center py-8">
                    <svg className="w-16 h-16 mx-auto text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4m0 0L7 13m0 0l-1.8 9H19M7 13v6a2 2 0 002 2h6a2 2 0 002-2v-6M7 13H5" />
                    </svg>
                    <p className="text-gray-500">Tu carrito está vacío</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {cart.map((item) => (
                      <div key={item.id} className="flex items-center space-x-3 p-3 bg-gray-50 rounded-lg">
                        <div className="flex-1">
                          <p className="font-medium text-sm">{item.name}</p>
                          <p className="text-xs text-gray-500">${item.price} c/u</p>
                        </div>
                        <div className="flex items-center space-x-2">
                          <button
                            onClick={() => updateQuantity(item.id, item.quantity - 1)}
                            className="w-7 h-7 rounded-full bg-gray-200 text-gray-600 flex items-center justify-center hover:bg-gray-300"
                          >
                            -
                          </button>
                          <span className="text-sm font-medium min-w-[20px] text-center">{item.quantity}</span>
                          <button
                            onClick={() => updateQuantity(item.id, item.quantity + 1)}
                            className="w-7 h-7 rounded-full bg-gray-200 text-gray-600 flex items-center justify-center hover:bg-gray-300"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Footer */}
              {cart.length > 0 && (
                <div className="p-4 border-t bg-white">
                  <div className="flex justify-between items-center mb-4">
                    <span className="font-semibold">Total:</span>
                    <span className="font-bold text-lg text-red-500">${cartTotal.toFixed(2)}</span>
                  </div>
                  <Link
                    href={`/checkout?businessId=${business.id}`}
                    className="w-full bg-red-500 text-white py-3 rounded-lg hover:bg-red-600 block text-center font-medium"
                    onClick={() => setIsCartOpen(false)}
                  >
                    Ir al Checkout
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
