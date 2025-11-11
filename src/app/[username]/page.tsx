'use client'

import { useState, useEffect, Suspense } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import Head from 'next/head'
import { Business, Product } from '@/types'
import { getBusinessByUsername, getProductsByBusiness, incrementVisitFirestore } from '@/lib/database'
import { PremioFloatingButton } from '@/components/PremioFloatingButton'

// Componente para structured data JSON-LD
function BusinessStructuredData({ business }: { business: Business }) {
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    "name": business.name,
    "description": business.description,
    "image": business.image,
    "url": `https://fuddi.shop/${business.username}`,
    "telephone": business.phone,
    "email": business.email,
    "address": {
      "@type": "PostalAddress",
      "streetAddress": business.address,
      "addressCountry": "EC"
    },
    "servesCuisine": business.categories || [],
    "priceRange": "$$",
    "acceptsReservations": "False",
    "hasDeliveryService": "True",
    "hasOnlineOrdering": "True",
    "paymentAccepted": ["Cash", "Credit Card", "Bank Transfer"],
    "currenciesAccepted": "USD",
    "openingHours": business.schedule ? Object.entries(business.schedule).map(([day, hours]: [string, any]) => 
      hours?.isOpen ? `${day.substring(0, 2).toUpperCase()} ${hours.open}-${hours.close}` : null
    ).filter(Boolean) : [],
    "aggregateRating": {
      "@type": "AggregateRating",
      "ratingValue": "4.5",
      "reviewCount": "10"
    },
    "potentialAction": {
      "@type": "OrderAction",
      "target": {
        "@type": "EntryPoint",
        "urlTemplate": `https://fuddi.shop/${business.username}`,
        "actionPlatform": [
          "http://schema.org/DesktopWebPlatform",
          "http://schema.org/MobileWebPlatform"
        ]
      },
      "deliveryMethod": [
        "http://purl.org/goodrelations/v1#DeliveryModePickup",
        "http://purl.org/goodrelations/v1#DeliveryModeDirectDownload"
      ]
    },
    "sameAs": [
      `https://fuddi.shop/${business.username}`,
      // Aquí se pueden agregar redes sociales del negocio cuando las tengamos
    ]
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      {/* Meta tags adicionales para WhatsApp en el head */}
      <meta property="og:rich_attachment" content="true" />
      <meta property="og:locale" content="es_ES" />
      <meta property="og:locale:alternate" content="es_EC" />
      <meta name="twitter:app:name:iphone" content="fuddi.shop" />
      <meta name="twitter:app:name:googleplay" content="fuddi.shop" />
    </>
  )
}

// Componente para mostrar variantes de producto
function ProductVariantSelector({ product, onAddToCart, getCartItemQuantity, updateQuantity, businessImage }: { 
  product: any, 
  onAddToCart: (item: any) => void,
  getCartItemQuantity: (id: string) => number,
  updateQuantity: (id: string, quantity: number) => void,
  businessImage?: string
}) {
  const handleCardClick = () => onAddToCart(product)

  return (
    <div onClick={handleCardClick} className="bg-white rounded-lg shadow-sm overflow-hidden cursor-pointer hover:bg-gray-50 transition flex items-center p-3 border-b border-gray-100">
      {/* Imagen cuadrada */}
      <div className="w-16 h-16 sm:w-20 sm:h-20 flex-shrink-0 rounded-lg overflow-hidden bg-gray-100">
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
      
      {/* Nombre y descripción */}
      <div className="flex-1 min-w-0 ml-3 sm:ml-4">
        <h4 className="font-medium text-sm sm:text-base text-gray-900 truncate">{product.name}</h4>
        <p className="text-gray-500 text-xs sm:text-sm mt-1 line-clamp-2">{product.description}</p>
      </div>
      
      {/* Precio y botón */}
      <div className="flex flex-col items-end ml-2 sm:ml-4 w-24 sm:w-28 flex-shrink-0">
        {product.variants && product.variants.length > 0 ? (
          <span className="text-sm sm:text-base font-bold text-red-500 whitespace-nowrap">
            ${Math.min(...product.variants.filter((v: any) => v.isAvailable).map((v: any) => v.price)).toFixed(2)}
          </span>
        ) : (
          <span className="text-sm sm:text-base font-bold text-red-500 whitespace-nowrap">
            ${product.price.toFixed(2)}
          </span>
        )}
        
        <button
          onClick={(e) => { e.stopPropagation(); onAddToCart(product) }}
          disabled={!product.isAvailable}
          className={`mt-1 flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 rounded-lg ${
            product.isAvailable 
              ? 'bg-red-500 text-white hover:bg-red-600' 
              : 'bg-gray-200 text-gray-500 cursor-not-allowed'
          }`}
          title={product.isAvailable ? (product.variants?.length ? 'Ver opciones' : 'Agregar al carrito') : 'Agotado'}
        >
          {product.variants?.length ? (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}

// Modal para seleccionar variantes
function VariantModal({ product, isOpen, onClose, onAddToCart, businessImage, getCartItemQuantity, updateQuantity }: {
  product: any;
  isOpen: boolean;
  onClose: () => void;
  onAddToCart: (item: any) => void;
  businessImage?: string;
  getCartItemQuantity: (id: string) => number;
  updateQuantity: (id: string, quantity: number) => void;
}) {
  const [selectedVariant, setSelectedVariant] = useState<any>(null)

  if (!isOpen || !product) return null

  const makeUid = (variant: any) => `${product.id}-${variant.id}`

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:items-center sm:pt-0 sm:pb-0">
        <div className="fixed inset-0 transition-opacity bg-gray-500 bg-opacity-75" onClick={onClose} />

        <div className="relative inline-block w-full h-full sm:max-h-[90vh] sm:max-w-md sm:my-8 sm:rounded-lg flex flex-col overflow-hidden text-left align-middle transition-all transform bg-white shadow-xl">
          {/* Header fijo */}
          <div className="p-4 sm:p-6 pb-0 flex-shrink-0">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-gray-900">Selecciona una opción</h3>
              <button onClick={onClose} className="text-gray-400 hover:text-gray-500">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="w-full h-32 mb-3">
              <img 
                src={product?.image || businessImage} 
                alt={product?.name} 
                className="w-full h-full object-cover rounded-lg" 
                onError={(e) => { 
                  const target = e.target as HTMLImageElement; 
                  if (target.src !== businessImage && businessImage) target.src = businessImage 
                }} 
              />
            </div>

            <h4 className="text-lg font-semibold text-gray-900 mb-1">{product?.name}</h4>
            {product?.description && (
              <p className="text-gray-600 text-sm mb-3 line-clamp-2">{product.description}</p>
            )}
          </div>

          {/* Sección de variantes desplazable */}
          <div className="px-4 sm:px-6 pb-4 overflow-y-auto flex-1 max-h-[60vh] sm:max-h-[40vh] custom-scrollbar">
            <div className="space-y-3 pr-2">
              {product?.variants?.filter((v: any) => v.isAvailable).map((variant: any, i: number) => {
                const uid = makeUid(variant)
                const qty = getCartItemQuantity(uid)

                return (
                  <div 
                    key={i} 
                    onClick={() => setSelectedVariant(variant)} 
                    className={`w-full p-3 rounded-lg border-2 flex items-center justify-between transition-colors ${
                      selectedVariant === variant ? 'border-red-500 bg-red-50' : 'border-gray-200 hover:border-gray-300 cursor-pointer'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <h5 className="font-medium text-gray-900 truncate">{variant.name}</h5>
                      {variant.description && (
                        <p className="text-sm text-gray-600 truncate">{variant.description}</p>
                      )}
                      <div className="text-red-500 font-bold mt-1">${variant.price.toFixed(2)}</div>
                    </div>

                    <div className="flex-shrink-0 ml-2" onClick={(e) => e.stopPropagation()}>
                      {qty > 0 ? (
                        <div className="flex items-center border rounded-lg overflow-hidden bg-white">
                          <button 
                            onClick={() => updateQuantity(uid, qty - 1)} 
                            className="px-3 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors"
                          >
                            -
                          </button>
                          <div className="px-3 py-1 min-w-[30px] text-center">
                            {qty}
                          </div>
                          <button 
                            onClick={() => updateQuantity(uid, qty + 1)}
                            className="px-3 py-1 bg-red-500 text-white hover:bg-red-600 transition-colors"
                          >
                            +
                          </button>
                        </div>
                      ) : (
                        <button 
                          onClick={() => onAddToCart({
                            id: uid,
                            name: `${product.name} - ${variant.name}`,
                            variantName: variant.name,
                            productName: product.name,
                            price: variant.price,
                            image: product.image,
                            description: variant.description || product.description,
                            businessId: product.businessId,
                            productId: product.id,
                            variantId: variant.id
                          })} 
                          className="px-3 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors whitespace-nowrap text-sm"
                        >
                          Agregar
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Footer fijo */}
          <div className="p-4 border-t border-gray-100 flex-shrink-0 bg-white sticky bottom-0">
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

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
  const [selectedProduct, setSelectedProduct] = useState<any>(null)
  const [isVariantModalOpen, setIsVariantModalOpen] = useState(false)
  const [notification, setNotification] = useState<{ show: boolean; message: string; type: 'success' | 'error' }>({
    show: false,
    message: '',
    type: 'success'
  })
  const [premioAgregado, setPremioAgregado] = useState(false)

  useEffect(() => {
    const loadRestaurantData = async () => {
      try {
        setLoading(true)
        console.log('🔍 Loading restaurant data for username:', username)
        
        const businessData = await getBusinessByUsername(username)
        console.log('📊 Business data received:', businessData)
        
        if (!businessData) {
          setError('Restaurante no encontrado')
          return
        }

        setBusiness(businessData)
        // Asegurar incremento de visitas (Firestore) al cargar la página pública
        try {
          // Usar sessionStorage para evitar duplicados por sesión
          const sessionKey = `visited:${businessData.id}`
          if (!sessionStorage.getItem(sessionKey)) {
            sessionStorage.setItem(sessionKey, '1')
            try {
              await incrementVisitFirestore(businessData.id)
              console.log('Visit counter incremented in Firestore for', businessData.id)
            } catch (e) {
              // Fallback: acumular en pendingVisits
              const pendingRaw = localStorage.getItem('pendingVisits')
              const pending = pendingRaw ? JSON.parse(pendingRaw) : {}
              pending[businessData.id] = (pending[businessData.id] || 0) + 1
              localStorage.setItem('pendingVisits', JSON.stringify(pending))
              console.warn('Failed to increment visit in Firestore, stored pendingVisits locally')
            }
          }
        } catch (e) {
          console.error('Error handling visit increment:', e)
        }
        console.log('🖼️ Cover image from business:', businessData.coverImage)
        
        const productsData = await getProductsByBusiness(businessData.id)
        console.log('📦 Products data received:', productsData.length, 'products')
        
        // Filtrar solo productos disponibles
        const availableProducts = productsData.filter(product => product.isAvailable)
        console.log('✅ Available products:', availableProducts.length, 'of', productsData.length)
        
        setProducts(availableProducts)
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

  // Flush pending visits stored locally when we mount and when we go online
  useEffect(() => {
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
            delete pending[bId]
          } catch (e) {
            console.warn('Error flushing pending visit for', bId, e)
          }
        }

        localStorage.setItem('pendingVisits', JSON.stringify(pending))
      } catch (e) {
        console.error('Error flushing pending visits:', e)
      }
    }

    void flushPendingVisits()
    const onOnline = () => void flushPendingVisits()
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [])

  // Cargar carrito específico de esta tienda desde localStorage
  useEffect(() => {
    if (business?.id) {
      const savedCarts = localStorage.getItem('carts')
      if (savedCarts) {
        const allCarts = JSON.parse(savedCarts)
        const businessCart = allCarts[business.id] || []
        setCart(businessCart)
        // Verificar si el premio ya está en el carrito
        const tienePremio = businessCart.some((item: any) => item.esPremio === true)
        setPremioAgregado(tienePremio)
      }
    }
  }, [business?.id])

  // Función para mostrar notificaciones temporales
  const showNotification = (message: string, type: 'success' | 'error' = 'success') => {
    setNotification({ show: true, message, type })
    setTimeout(() => {
      setNotification({ show: false, message: '', type: 'success' })
    }, 3000)
  }

  const addToCart = (product: any) => {
    if (!business?.id) return;

    // Si el producto tiene variantes, abrir modal
    if (product.variants && product.variants.length > 0) {
      setSelectedProduct(product)
      setIsVariantModalOpen(true)
      return
    }

    // Si no tiene variantes, agregar directamente
    const cartItem = {
      id: product.id,
      name: product.name,
      variantName: null, // No tiene variante
      productName: product.name,
      price: product.price,
      image: product.image,
      description: product.description,
      businessId: business.id,
      businessName: business.name,
      businessImage: business.image
    }

    const existingItem = cart.find(item => item.id === cartItem.id)
    let newCart

    if (existingItem) {
      newCart = cart.map(item =>
        item.id === cartItem.id
          ? { ...item, quantity: item.quantity + 1 }
          : item
      )
      showNotification(`Se agregó otra ${product.name} al carrito`)
    } else {
      newCart = [...cart, { 
        ...cartItem, 
        quantity: 1
      }]
      showNotification(`${product.name} agregado al carrito`)
    }

    setCart(newCart)
    updateCartInStorage(business.id, newCart)
  }

  const addVariantToCart = (product: any) => {
    if (!business?.id) return;

    const existingItem = cart.find(item => item.id === product.id)
    let newCart

    if (existingItem) {
      newCart = cart.map(item =>
        item.id === product.id
          ? { ...item, quantity: item.quantity + 1 }
          : item
      )
      showNotification(`Se agregó otra ${product.name} al carrito`)
    } else {
      newCart = [...cart, { 
        ...product, 
        quantity: 1, 
        businessId: business.id,
        businessName: business.name,
        businessImage: business.image
      }]
      showNotification(`${product.name} agregado al carrito`)
    }

    setCart(newCart)
    updateCartInStorage(business.id, newCart)
  }

  const removeFromCart = (productId: string) => {
    if (!business?.id) return;

    // Verificar si el ítem a eliminar es un premio
    const itemToRemove = cart.find(item => item.id === productId)
    const isPremio = itemToRemove?.esPremio === true

    const newCart = cart.filter(item => item.id !== productId)
    setCart(newCart)
    updateCartInStorage(business.id, newCart)

    // Si se eliminó un premio, permitir reclamarlo de nuevo
    if (isPremio) {
      setPremioAgregado(false)
    }
  }

  const updateQuantity = (productId: string, quantity: number) => {
    if (!business?.id) return;

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

  // Función para actualizar el carrito en localStorage
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

  const getCartItemQuantity = (productId: string) => {
    const item = cart.find(item => item.id === productId)
    return item ? item.quantity : 0
  }

  const cartTotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0)
  const cartItemsCount = cart.reduce((sum, item) => sum + item.quantity, 0)

  const manejarAgregarPremio = () => {
    if (!business?.id) return;

    const premioEspecial = {
      id: 'premio-especial-' + Date.now(),
      name: '🎁 5 wantancitos',
      variantName: null,
      productName: '🎁 5 wantancitos',
      description: '¡Felicidades! Has reclamado tu premio especial gratis',
      price: 0,
      isAvailable: true,
      esPremio: true,
      quantity: 1,
      image: business.image || 'https://via.placeholder.com/150?text=Premio',
      businessId: business.id,
      businessName: business.name,
      businessImage: business.image
    }

    const newCart = [...cart, premioEspecial]
    setCart(newCart)
    setPremioAgregado(true)
    updateCartInStorage(business.id, newCart)
    showNotification('¡Premio especial agregado al carrito! 🎉', 'success')
  }

  // Función para determinar si la tienda está abierta
  const isStoreOpen = () => {
    if (!business?.schedule) return false;
    
    const now = new Date();
    const currentDay = now.toLocaleDateString('en', { weekday: 'long' }).toLowerCase();
    const currentTime = now.toLocaleTimeString('en-GB', { hour12: false }).slice(0, 5);
    
    const todaySchedule = business.schedule[currentDay];
    if (!todaySchedule || !todaySchedule.isOpen) return false;
    
    return currentTime >= todaySchedule.open && currentTime <= todaySchedule.close;
  };

  // Función para copiar enlace
  const copyStoreLink = async () => {
    const url = `${window.location.origin}/${business?.username}`;
    try {
      // Intentar con Clipboard API primero
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(url);
        showNotification('Enlace copiado al portapapeles', 'success');
      } else {
        // Fallback para navegadores sin soporte o contextos no seguros
        const textArea = document.createElement('textarea');
        textArea.value = url;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        showNotification('Enlace copiado al portapapeles', 'success');
      }
    } catch (err) {
      console.error('Error al copiar enlace:', err);
      showNotification('Error al copiar enlace', 'error');
    }
  };

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

  // Agrupar productos por categoría, respetando el orden definido en business.categories
  const productsByCategory: Record<string, Product[]> = {}
  
  // Primero, obtenemos todos los productos disponibles
  const availableProducts = products.filter(product => product.isAvailable)
  
  // Si hay categorías definidas en el negocio, usamos ese orden
  if (business.categories?.length) {
    // Creamos las categorías en el orden definido
    business.categories.forEach(category => {
      const categoryProducts = availableProducts.filter(p => p.category === category)
      if (categoryProducts.length > 0) {
        productsByCategory[category] = categoryProducts
      }
    })
    
    // Agregamos productos sin categoría a 'Otros' si existen
    const uncategorizedProducts = availableProducts.filter(p => !p.category || !business.categories?.includes(p.category))
    if (uncategorizedProducts.length > 0) {
      productsByCategory['Otros'] = uncategorizedProducts
    }
  } else {
    // Si no hay categorías definidas, agrupamos normalmente
    availableProducts.forEach(product => {
      const category = product.category || 'Otros'
      if (!productsByCategory[category]) {
        productsByCategory[category] = []
      }
      productsByCategory[category].push(product)
    })
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Structured Data for SEO */}
      <BusinessStructuredData business={business} />
      
      {/* Hero Section */}
      <div className="bg-white shadow-sm">
        {/* Portada con logo superpuesto */}
        <div className="relative w-full h-36 sm:h-48 bg-gray-200">
          {business.coverImage ? (
            <img
              src={business.coverImage}
              alt={`Portada de ${business.name}`}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-orange-100 to-orange-200" />
          )}
          {/* Botón copiar enlace como ícono (mejor para móviles) */}
          <button
            onClick={copyStoreLink}
            aria-label="Copiar enlace de la tienda"
            className="absolute right-3 top-3 z-10 p-2 bg-white/90 hover:bg-white rounded-full shadow text-gray-700"
          >
            <i className="bi bi-share"></i>
          </button>
          {business.image && (
            <div className="absolute left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2 z-10">
              <img
                src={business.image}
                alt={business.name}
                className="w-24 h-24 sm:w-28 sm:h-28 rounded-full border-4 border-white shadow-lg object-cover"
              />
            </div>
          )}
        </div>
        
        {/* Contenido debajo de la portada */}
        <div className="max-w-3xl mx-auto px-4 pt-12 sm:pt-14 pb-4 text-center">
          <div className="flex flex-col items-center">
            <div className="w-full">
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900">{business.name}</h1>
              {/* Descripción */}
              {business.description && (
                <p className="text-gray-600 text-sm mt-1 max-w-2xl mx-auto">
                  {business.description}
                </p>
              )}
              <div className="flex flex-col sm:flex-row items-center justify-center gap-2 mt-2">
                {/* Estado de la tienda */}
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                  isStoreOpen() 
                    ? 'bg-green-100 text-green-800' 
                    : 'bg-red-100 text-red-800'
                }`}>
                  <i className={`bi ${isStoreOpen() ? 'bi-clock' : 'bi-clock-history'} mr-1`}></i>
                  {isStoreOpen() ? 'Abierta' : 'Cerrada'}
                </span>
                {/* Dirección */}
                {business.address && (
                  <span className="text-xs text-gray-500 inline-flex items-center">
                    <i className="bi bi-geo-alt mr-1"></i>
                    {business.address}
                  </span>
                )}
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
            <div className="space-y-3">
              {categoryProducts.map((product) => (
                <ProductVariantSelector
                  key={product.id}
                  product={product}
                  onAddToCart={addToCart}
                  getCartItemQuantity={getCartItemQuantity}
                  updateQuantity={updateQuantity}
                  businessImage={business?.image}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Floating Cart Button */}
      {cart.length > 0 && (
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
                <div className="text-sm font-semibold leading-none">${cartTotal.toFixed(2)}</div>
                <div className="text-xs text-red-100 leading-none mt-0.5">Ver carrito</div>
              </div>
            </div>
          </button>
        </div>
      )}

      {/* Cart Sidebar */}
      {isCartOpen && (
        <div className="fixed inset-0 z-50 overflow-hidden">
          <div className="absolute inset-0 bg-black bg-opacity-50 cart-backdrop transition-all duration-300" onClick={() => setIsCartOpen(false)} />
          <div className="absolute right-0 top-0 h-full w-full sm:w-96 bg-white shadow-2xl cart-slide-in">
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
              <div className="flex-1 overflow-y-auto">
                {cart.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full px-4 text-center">
                    <div className="w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                      <i className="bi bi-cart text-4xl text-gray-400"></i>
                    </div>
                    <h4 className="text-lg font-medium text-gray-900 mb-2">Tu carrito está vacío</h4>
                    <p className="text-gray-500 text-sm">Agrega algunos productos deliciosos para comenzar</p>
                  </div>
                ) : (
                  <div className="p-4 space-y-3">
                    {cart.map((item, index) => (
                      <div 
                        key={item.id} 
                        className={`group rounded-xl p-3 transition-all duration-200 ${
                          item.esPremio 
                            ? 'bg-gradient-to-r from-amber-50 to-yellow-50 border-2 border-amber-300 shadow-md' 
                            : 'bg-white border border-gray-100 hover:shadow-md'
                        }`}
                      >
                        <div className="flex items-center space-x-3">
                          {/* Imagen del producto */}
                          <div className={`w-16 h-16 flex-shrink-0 rounded-lg overflow-hidden ${
                            item.esPremio ? 'ring-2 ring-amber-400' : 'bg-gray-100'
                          }`}>
                            <img
                              src={item.image || business?.image}
                              alt={item.name}
                              className="w-full h-full object-cover"
                              onError={(e) => {
                                const target = e.target as HTMLImageElement;
                                if (target.src !== business?.image) {
                                  target.src = business?.image || '';
                                }
                              }}
                            />
                          </div>
                          
                          {/* Información del producto */}
                          <div className="flex-1 min-w-0">
                            <h4 className={`font-medium text-sm line-clamp-2 leading-tight ${
                              item.esPremio ? 'text-amber-900' : 'text-gray-900'
                            }`}>
                              {item.name}
                            </h4>
                            {item.esPremio && (
                              <span className="inline-block mt-1 text-xs bg-amber-200 text-amber-900 px-2 py-0.5 rounded-full font-semibold">
                                ¡Premio Especial!
                              </span>
                            )}
                            <div className="flex items-center justify-between mt-1">
                              <span className={`font-semibold ${
                                item.esPremio ? 'text-amber-700 text-base' : 'text-red-600'
                              }`}>
                                {item.price > 0 ? `$${item.price.toFixed(2)}` : '¡Gratis!'}
                              </span>
                              {!item.esPremio && (
                                <span className="text-xs text-gray-500">
                                  c/u
                                </span>
                              )}
                            </div>
                            
                            {/* Controles de cantidad - No mostrar para premios */}
                            {!item.esPremio && (
                              <div className="flex items-center justify-between mt-2">
                                <div className="flex items-center bg-gray-100 rounded-lg overflow-hidden">
                                  <button
                                    onClick={() => updateQuantity(item.id, item.quantity - 1)}
                                    className="w-8 h-8 flex items-center justify-center text-gray-600 hover:bg-gray-200 transition-colors"
                                  >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                                    </svg>
                                  </button>
                                  <span className="px-3 py-1 text-sm font-medium min-w-[40px] text-center bg-white">
                                    {item.quantity}
                                  </span>
                                  <button
                                    onClick={() => updateQuantity(item.id, item.quantity + 1)}
                                    className="w-8 h-8 flex items-center justify-center text-gray-600 hover:bg-gray-200 transition-colors"
                                  >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                                    </svg>
                                  </button>
                                </div>
                                
                                {/* Subtotal del producto */}
                                <div className="text-right">
                                  <div className="text-sm font-semibold text-gray-900">
                                    ${(item.price * item.quantity).toFixed(2)}
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                          
                          {/* Botón eliminar */}
                          <button
                            onClick={() => removeFromCart(item.id)}
                            className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    ))}
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
                  
                  {/* Botón de checkout o agregar más */}
                  {cartTotal > 0 ? (
                    <Link
                      href={`/checkout?businessId=${business.id}`}
                      className="w-full bg-gradient-to-r from-red-500 to-red-600 text-white py-4 rounded-xl hover:from-red-600 hover:to-red-700 transition-all duration-200 flex items-center justify-center font-semibold text-lg shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
                      onClick={() => setIsCartOpen(false)}
                    >
                      <i className="bi bi-cart mr-2 text-xl"></i>
                      Continuar con el pedido
                    </Link>
                  ) : (
                    <button
                      onClick={() => setIsCartOpen(false)}
                      className="w-full bg-gradient-to-r from-gray-500 to-gray-600 text-white py-4 rounded-xl hover:from-gray-600 hover:to-gray-700 transition-all duration-200 flex items-center justify-center font-semibold text-lg shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
                    >
                      <i className="bi bi-plus-circle mr-2 text-xl"></i>
                      Agrega más productos
                    </button>
                  )}
                  
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

      {/* Botón Flotante de Premio */}
      <PremioFloatingButton 
        onAgregarPremio={manejarAgregarPremio}
        premioYaAgregado={premioAgregado}
        businessName={business.name}
        show={true}
      />

      {/* Modal de variantes */}
      <VariantModal
        product={selectedProduct}
        isOpen={isVariantModalOpen}
        onClose={() => {
          setIsVariantModalOpen(false)
          setSelectedProduct(null)
        }}
        onAddToCart={addVariantToCart}
        businessImage={business?.image}
        getCartItemQuantity={getCartItemQuantity}
        updateQuantity={updateQuantity}
      />

      {/* Notificación temporal */}
      {notification.show && (
        <div className="fixed top-20 right-4 z-50 animate-pulse">
          <div className={`rounded-lg px-4 py-3 shadow-lg text-white font-medium ${
            notification.type === 'success' ? 'bg-green-500' : 'bg-red-500'
          }`}>
            <div className="flex items-center space-x-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-sm">{notification.message}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}