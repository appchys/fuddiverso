'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Business, Product } from '@/types'
import { getBusinessByUsername, getProductsByBusiness, incrementVisitFirestore } from '@/lib/database'

// Componente para mostrar variantes de producto
function ProductVariantSelector({ product, onAddToCart, getCartItemQuantity, updateQuantity, businessImage }: { 
  product: any, 
  onAddToCart: (item: any) => void,
  getCartItemQuantity: (id: string) => number,
  updateQuantity: (id: string, quantity: number) => void,
  businessImage?: string
}) {
  return (
    <div className="bg-white rounded-lg shadow-md overflow-hidden">
      <div className="w-full h-32 sm:h-40">
        <img
          src={product.image || businessImage}
          alt={product.name}
          className="w-full h-full object-cover"
          onError={(e) => {
            const target = e.target as HTMLImageElement;
            if (target.src !== businessImage && businessImage) {
              target.src = businessImage;
            }
          }}
        />
      </div>
      <div className="p-3 sm:p-4">
        <h4 className="font-semibold text-sm sm:text-base text-gray-900 line-clamp-2">{product.name}</h4>
        <p className="text-gray-600 text-xs sm:text-sm mt-1 line-clamp-2">{product.description}</p>
        <div className="flex flex-col gap-2 mt-3">
          {/* Mostrar precio */}
          {product.variants && product.variants.length > 0 ? (
            <span className="text-base sm:text-lg font-bold text-red-500">
              Desde ${Math.min(...product.variants.filter((v: any) => v.isAvailable).map((v: any) => v.price)).toFixed(2)}
            </span>
          ) : (
            <span className="text-base sm:text-lg font-bold text-red-500">${product.price.toFixed(2)}</span>
          )}
          
          {/* Botón agregar */}
          <button
            onClick={() => onAddToCart(product)}
            disabled={!product.isAvailable}
            className={`text-xs sm:text-sm font-medium px-3 py-2 rounded-lg ${
              product.isAvailable 
                ? 'bg-red-500 text-white hover:bg-red-600' 
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
            }`}
          >
            {product.isAvailable ? 'Agregar' : 'No disponible'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Modal para seleccionar variantes
function VariantModal({ product, isOpen, onClose, onAddToCart, businessImage }: {
  product: any;
  isOpen: boolean;
  onClose: () => void;
  onAddToCart: (item: any) => void;
  businessImage?: string;
}) {
  const [selectedVariant, setSelectedVariant] = useState<any>(null);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
        <div className="fixed inset-0 transition-opacity bg-gray-500 bg-opacity-75" onClick={onClose} />
        
        <div className="inline-block w-full max-w-md p-6 my-8 overflow-hidden text-left align-middle transition-all transform bg-white shadow-xl rounded-lg">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-medium text-gray-900">Selecciona una opción</h3>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-500"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Imagen del producto */}
          <div className="w-full h-48 mb-4">
            <img
              src={product?.image || businessImage}
              alt={product?.name}
              className="w-full h-full object-cover rounded-lg"
              onError={(e) => {
                const target = e.target as HTMLImageElement;
                if (target.src !== businessImage && businessImage) {
                  target.src = businessImage;
                }
              }}
            />
          </div>

          <h4 className="text-lg font-semibold text-gray-900 mb-2">{product?.name}</h4>
          <p className="text-gray-600 text-sm mb-4">{product?.description}</p>

          {/* Lista de variantes */}
          <div className="space-y-2 mb-6">
            {product?.variants?.filter((variant: any) => variant.isAvailable).map((variant: any, index: number) => (
              <button
                key={index}
                onClick={() => setSelectedVariant(variant)}
                className={`w-full p-3 rounded-lg border-2 text-left transition-colors ${
                  selectedVariant === variant
                    ? 'border-red-500 bg-red-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="flex justify-between items-center">
                  <div>
                    <h5 className="font-medium text-gray-900">{variant.name}</h5>
                    {variant.description && (
                      <p className="text-sm text-gray-600">{variant.description}</p>
                    )}
                  </div>
                  <span className="text-lg font-bold text-red-500">${variant.price.toFixed(2)}</span>
                </div>
              </button>
            ))}
          </div>

          {/* Botones de acción */}
          <div className="flex space-x-3">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition"
            >
              Cancelar
            </button>
            <button
              onClick={() => {
                if (selectedVariant) {
                  onAddToCart({
                    ...product,
                    selectedVariant,
                    variantName: selectedVariant.name,
                    productName: product.name,
                    price: selectedVariant.price,
                    uniqueId: `${product.id}_${selectedVariant.name.replace(/\s+/g, '_')}`
                  });
                  onClose();
                }
              }}
              disabled={!selectedVariant}
              className={`flex-1 px-4 py-2 rounded-lg transition ${
                selectedVariant
                  ? 'bg-red-500 text-white hover:bg-red-600'
                  : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }`}
            >
              Agregar al carrito
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Componente principal del Client Component
export default function BusinessPageClient({ username }: { username: string }) {
  const router = useRouter()
  const [business, setBusiness] = useState<Business | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  // Estados del carrito
  const [cartItems, setCartItems] = useState<any[]>([])
  const [isCartOpen, setIsCartOpen] = useState(false)
  
  // Estado para modal de variantes
  const [selectedProduct, setSelectedProduct] = useState<any>(null)
  const [isVariantModalOpen, setIsVariantModalOpen] = useState(false)

  useEffect(() => {
    console.log('🚀 Loading business data for username:', username);
    loadBusinessData()
  }, [username])

  // Contador de visitas: incrementar una vez por sesión usando sessionStorage
  // Helper para incrementar contador de visitas (puede llamarse desde cualquier punto)
  const incrementVisitCount = async (businessId?: string) => {
    try {
      if (!businessId) return

      const sessionKey = `visited:${businessId}`
      const visitKey = `visits:${businessId}`

      // Si ya se marcó la visita en esta sesión, no hacemos nada
      if (sessionStorage.getItem(sessionKey)) return

      // Marcar visita en la sesión para evitar duplicados
      sessionStorage.setItem(sessionKey, '1')

      // Intentar incrementar en Firestore
      try {
        await incrementVisitFirestore(businessId)
        console.log(`Visit counter incremented in Firestore for ${businessId}`)
      } catch (e) {
        // Fallback: si falla (offline o reglas), acumular en pendingVisits en localStorage
        console.warn('Firestore visit increment failed, accumulating pending visit locally:', e)
        try {
          const pendingRaw = localStorage.getItem('pendingVisits')
          const pending = pendingRaw ? JSON.parse(pendingRaw) : {}
          pending[businessId] = (pending[businessId] || 0) + 1
          localStorage.setItem('pendingVisits', JSON.stringify(pending))
          console.log('Pending visits stored locally for', businessId)
        } catch (err) {
          console.error('Error storing pending visits locally:', err)
        }
      }
    } catch (e) {
      console.error('Error updating visit counter:', e)
    }
  }

  // Efecto que ejecuta el incremento cuando `business.id` cambia
  useEffect(() => {
    // llamar sin await; la función maneja sus errores internamente
    void incrementVisitCount(business?.id)

    // Intentar enviar pending visits al montarse y cuando volvamos online
    const flushPendingVisits = async () => {
      try {
        const pendingRaw = localStorage.getItem('pendingVisits')
        if (!pendingRaw) return
        const pending = JSON.parse(pendingRaw)
        const entries = Object.entries(pending)
        if (!entries.length) return

        for (const [bId, cnt] of entries) {
          try {
            await incrementVisitFirestore(bId, Number(cnt))
            // si succeed, eliminar la entrada
            delete pending[bId]
          } catch (e) {
            console.warn('Error flushing pending visit for', bId, e)
          }
        }

        // Guardar lo que quede pendiente
        localStorage.setItem('pendingVisits', JSON.stringify(pending))
      } catch (e) {
        console.error('Error flushing pending visits:', e)
      }
    }

    // Flush inmediatamente
    void flushPendingVisits()

    // Flush cuando volvemos online
    const onOnline = () => {
      void flushPendingVisits()
    }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [business?.id])

  const loadBusinessData = async () => {
    try {
      setLoading(true)
      setError(null)

      console.log('🔍 Fetching business by username:', username);
      const businessData = await getBusinessByUsername(username)
      
      if (!businessData) {
        console.log('❌ Business not found');
        setError('Tienda no encontrada')
        setLoading(false)
        return
      }

      console.log('✅ Business found:', businessData);
      setBusiness(businessData)
      // Asegurar incremento de visitas inmediatamente después de cargar el negocio
      try {
        incrementVisitCount(businessData.id)
      } catch (e) {
        console.error('Error incrementing visit count after setting business:', e)
      }

      // Cargar productos del negocio
      console.log('🍽️ Loading products for business:', businessData.id);
      const productsData = await getProductsByBusiness(businessData.id)
      console.log('📦 Products loaded:', productsData.length);
      setProducts(productsData)

    } catch (error) {
      console.error('❌ Error loading business data:', error)
      setError('Error al cargar la información de la tienda')
    } finally {
      setLoading(false)
    }
  }

  // Cargar carrito desde localStorage
  useEffect(() => {
    if (business?.id) {
      const savedCarts = localStorage.getItem('carts')
      if (savedCarts) {
        try {
          const carts = JSON.parse(savedCarts)
          const businessCart = carts[business.id] || []
          setCartItems(businessCart)
        } catch (error) {
          console.error('Error loading cart from localStorage:', error)
        }
      }
    }
  }, [business?.id])

  // Guardar carrito en localStorage
  const saveCartToStorage = (items: any[]) => {
    if (business?.id) {
      const savedCarts = localStorage.getItem('carts')
      let carts = {}
      
      if (savedCarts) {
        try {
          carts = JSON.parse(savedCarts)
        } catch (error) {
          console.error('Error parsing saved carts:', error)
        }
      }
      
      carts = { ...carts, [business.id]: items }
      localStorage.setItem('carts', JSON.stringify(carts))
    }
  }

  // Funciones del carrito
  const addToCart = (product: any) => {
    // Si el producto tiene variantes, abrir modal
    if (product.variants && product.variants.length > 0 && product.variants.some((v: any) => v.isAvailable)) {
      setSelectedProduct(product)
      setIsVariantModalOpen(true)
      return
    }

    // Si no tiene variantes, agregar directamente
    const productToAdd = {
      ...product,
      variantName: null, // No tiene variante
      productName: product.name,
      uniqueId: product.uniqueId || product.id,
      businessId: business?.id,
      quantity: 1
    }

    const existingItemIndex = cartItems.findIndex(item => item.uniqueId === productToAdd.uniqueId)
    
    let newCartItems
    if (existingItemIndex >= 0) {
      newCartItems = cartItems.map((item, index) => 
        index === existingItemIndex 
          ? { ...item, quantity: item.quantity + 1 }
          : item
      )
    } else {
      newCartItems = [...cartItems, productToAdd]
    }
    
    setCartItems(newCartItems)
    saveCartToStorage(newCartItems)
  }

  const getCartItemQuantity = (productId: string) => {
    const item = cartItems.find(item => item.uniqueId === productId || item.id === productId)
    return item ? item.quantity : 0
  }

  const updateQuantity = (productId: string, quantity: number) => {
    if (quantity <= 0) {
      const newCartItems = cartItems.filter(item => item.uniqueId !== productId && item.id !== productId)
      setCartItems(newCartItems)
      saveCartToStorage(newCartItems)
    } else {
      const newCartItems = cartItems.map(item => 
        (item.uniqueId === productId || item.id === productId)
          ? { ...item, quantity }
          : item
      )
      setCartItems(newCartItems)
      saveCartToStorage(newCartItems)
    }
  }

  const removeFromCart = (productId: string) => {
    const newCartItems = cartItems.filter(item => item.uniqueId !== productId && item.id !== productId)
    setCartItems(newCartItems)
    saveCartToStorage(newCartItems)
  }

  const getCartTotal = () => {
    return cartItems.reduce((total, item) => total + (item.price * item.quantity), 0)
  }

  const goToCheckout = () => {
    if (business?.id && cartItems.length > 0) {
      router.push(`/checkout?businessId=${business.id}`)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-red-500 mx-auto"></div>
          <p className="mt-4 text-gray-600">Cargando información de la tienda...</p>
        </div>
      </div>
    )
  }

  if (error || !business) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-500 text-6xl mb-4">😔</div>
          <h1 className="text-2xl font-bold text-gray-800 mb-4">Tienda no encontrada</h1>
          <p className="text-gray-600 mb-6">{error || 'La tienda que buscas no está disponible'}</p>
          <Link 
            href="/"
            className="inline-block bg-red-500 text-white px-6 py-2 rounded-lg hover:bg-red-600 transition"
          >
            Volver al inicio
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header de la tienda */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Link href="/" className="text-red-500 hover:text-red-600">
              <i className="bi bi-arrow-left text-xl mr-2"></i>
              Volver
            </Link>
            
            {/* Carrito */}
            <button
              onClick={() => setIsCartOpen(true)}
              className="relative bg-red-500 text-white px-4 py-2 rounded-lg hover:bg-red-600 transition flex items-center"
            >
              <i className="bi bi-cart3 mr-2"></i>
              Carrito
              {cartItems.length > 0 && (
                <span className="absolute -top-2 -right-2 bg-red-600 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">
                  {cartItems.reduce((sum, item) => sum + item.quantity, 0)}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Información de la tienda */}
      <div className="bg-white">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex flex-col md:flex-row gap-6">
            <div className="md:w-1/3">
              <img
                src={business.image}
                alt={business.name}
                className="w-full h-48 md:h-64 object-cover rounded-lg shadow-md"
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  target.src = '/default-restaurant.jpg';
                }}
              />
            </div>
            <div className="md:w-2/3">
              <h1 className="text-2xl md:text-3xl font-bold text-gray-900 mb-2">{business.name}</h1>
              <p className="text-gray-600 mb-4">{business.description}</p>
              <div className="space-y-2 text-sm text-gray-600">
                <div className="flex items-center">
                  <i className="bi bi-geo-alt mr-2 text-red-500"></i>
                  {business.address}
                </div>
                <div className="flex items-center">
                  <i className="bi bi-telephone mr-2 text-red-500"></i>
                  {business.phone}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Productos */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        <h2 className="text-xl font-bold text-gray-900 mb-6">Nuestros Productos</h2>
        
        {products.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-gray-400 text-6xl mb-4">🍽️</div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No hay productos disponibles</h3>
            <p className="text-gray-600">Esta tienda aún no ha agregado productos a su menú.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-6">
            {products.map((product) => (
              <ProductVariantSelector
                key={product.id}
                product={product}
                onAddToCart={addToCart}
                getCartItemQuantity={getCartItemQuantity}
                updateQuantity={updateQuantity}
                businessImage={business.image}
              />
            ))}
          </div>
        )}
      </div>

      {/* Modal de variantes */}
      <VariantModal
        product={selectedProduct}
        isOpen={isVariantModalOpen}
        onClose={() => {
          setIsVariantModalOpen(false)
          setSelectedProduct(null)
        }}
        onAddToCart={addToCart}
        businessImage={business.image}
      />

      {/* Sidebar del carrito */}
      {isCartOpen && (
        <div className="fixed inset-0 z-50 overflow-hidden">
          <div className="absolute inset-0 bg-black bg-opacity-50" onClick={() => setIsCartOpen(false)} />
          <div className="absolute right-0 top-0 h-full w-full max-w-md bg-white shadow-xl">
            <div className="flex flex-col h-full">
              {/* Header del carrito */}
              <div className="flex items-center justify-between p-4 border-b">
                <h3 className="text-lg font-semibold">Tu Carrito</h3>
                <button
                  onClick={() => setIsCartOpen(false)}
                  className="text-gray-400 hover:text-gray-500"
                >
                  <i className="bi bi-x text-2xl"></i>
                </button>
              </div>

              {/* Items del carrito */}
              <div className="flex-1 overflow-y-auto p-4">
                {cartItems.length === 0 ? (
                  <div className="text-center py-8">
                    <div className="text-gray-400 text-4xl mb-4">🛒</div>
                    <p className="text-gray-600">Tu carrito está vacío</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {cartItems.map((item, index) => (
                      <div key={`${item.uniqueId || item.id}_${index}`} className="flex items-center space-x-3 bg-gray-50 p-3 rounded-lg">
                        <img
                          src={item.image || business.image}
                          alt={item.name}
                          className="w-12 h-12 object-cover rounded"
                        />
                        <div className="flex-1">
                          {/* Manejar tanto formato nuevo como antiguo */}
                          {item.variantName ? (
                            // Formato nuevo: campos separados
                            <>
                              <h4 className="font-medium text-sm">{item.variantName}</h4>
                              <p className="text-xs text-gray-600">{item.productName}</p>
                            </>
                          ) : item.name && item.name.includes(' - ') ? (
                            // Formato antiguo: extraer de nombre combinado
                            <>
                              <h4 className="font-medium text-sm">{item.name.split(' - ')[1]}</h4>
                              <p className="text-xs text-gray-600">{item.name.split(' - ')[0]}</p>
                            </>
                          ) : (
                            // Producto sin variante
                            <h4 className="font-medium text-sm">{item.productName || item.name}</h4>
                          )}
                          <p className="text-red-500 font-semibold">${item.price.toFixed(2)}</p>
                        </div>
                        <div className="flex items-center space-x-2">
                          <button
                            onClick={() => updateQuantity(item.uniqueId || item.id, item.quantity - 1)}
                            className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-300"
                          >
                            -
                          </button>
                          <span className="text-sm font-medium w-6 text-center">{item.quantity}</span>
                          <button
                            onClick={() => updateQuantity(item.uniqueId || item.id, item.quantity + 1)}
                            className="w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center hover:bg-red-600"
                          >
                            +
                          </button>
                        </div>
                        <button
                          onClick={() => removeFromCart(item.uniqueId || item.id)}
                          className="text-red-500 hover:text-red-600"
                        >
                          <i className="bi bi-trash text-sm"></i>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Footer del carrito */}
              {cartItems.length > 0 && (
                <div className="border-t p-4 space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-lg font-semibold">Total:</span>
                    <span className="text-xl font-bold text-red-500">${getCartTotal().toFixed(2)}</span>
                  </div>
                  <button
                    onClick={goToCheckout}
                    className="w-full bg-red-500 text-white py-3 rounded-lg hover:bg-red-600 transition font-medium"
                  >
                    Proceder al Checkout
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
