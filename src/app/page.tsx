'use client'

import React, { useState, useEffect, Suspense, useRef } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useSearchParams, useRouter } from 'next/navigation'
import { getAllBusinesses, searchBusinesses, getProductsByBusiness, getGlobalProducts, getCoverageZoneForLocation, getCoverageGroups, saveRestaurantRequest, generateReferralLink, userHasReferralForProduct, getProductsReferralCounts } from '@/lib/database'
import { ensureCartItemMetadata } from '@/lib/price-utils'
import { Business, Product, CoverageGroup } from '@/types'
import { getProductPublicPrice, formatPrice } from '@/lib/price-utils'
import { isStoreOpen } from '@/lib/store-utils'
import { useAuth } from '@/contexts/AuthContext'
import StarRating from '@/components/StarRating'
import ProductDetailSidebar from '@/components/ProductDetailSidebar'
import StoryProductDetail from '@/components/StoryProductDetail'
import CartSidebar from '@/components/CartSidebar' // Added import for CartSidebar
import ReferralModal from '@/components/ReferralModal'
import ClientLoginModal from '@/components/ClientLoginModal'
import StoreRatingModal from '@/components/StoreRatingModal'
import { BusinessAuthProvider, useBusinessAuth } from '@/contexts/BusinessAuthContext'
import { Flame } from 'lucide-react'

// Componente para imágenes con carga progresiva - usa next/image con fill
const ProgressiveImage: React.FC<{
  src: string
  alt: string
  className?: string
  fill?: boolean
  width?: number
  height?: number
  priority?: boolean
  sizes?: string
}> = ({
  src,
  alt,
  className = '',
  fill = false,
  width,
  height,
  priority = false,
  sizes = '100vw'
}) => {
    const [isLoaded, setIsLoaded] = useState(false)

    return (
      <>
        {/* Placeholder mientras carga - siempre visible hasta que la imagen cargue */}
        {!isLoaded && fill && (
          <div className="absolute inset-0 bg-gray-200 animate-pulse" />
        )}

        {/* Imagen con next/image */}
        <Image
          src={src}
          alt={alt}
          fill={fill}
          width={!fill ? width : undefined}
          height={!fill ? height : undefined}
          priority={priority}
          sizes={sizes}
          unoptimized={true}
          className={`transition-opacity duration-300 ${isLoaded ? 'opacity-100' : 'opacity-0'} ${className}`}
          onLoad={() => setIsLoaded(true)}
        />
      </>
    )
  }

export default function HomePage() {
  return (
    <BusinessAuthProvider>
      <Suspense fallback={<HomePageLoading />}>
        <HomePageContent />
      </Suspense>
    </BusinessAuthProvider>
  )
}

function HomePageLoading() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#aa1918] mx-auto"></div>
        <p className="mt-4 text-gray-600">Cargando...</p>
      </div>
    </div>
  )
}

function HomePageContent() {
  const { user } = useAuth()
  const { user: businessUser } = useBusinessAuth()
  const searchParams = useSearchParams()
  const router = useRouter()

  const [businesses, setBusinesses] = useState<Business[]>([])
  const [loading, setLoading] = useState(true)
  const [isRatingModalOpen, setIsRatingModalOpen] = useState(false)
  const [selectedRatingBusiness, setSelectedRatingBusiness] = useState<Business | null>(null)
  const [ratingNotification, setRatingNotification] = useState<{ show: boolean; message: string }>({ show: false, message: '' })


  // Swipe State for Stories
  const touchStartXRef = useRef<number>(0)
  const touchStartYRef = useRef<number>(0)
  const touchStartTimeRef = useRef<number>(0)

  const [searchTerm, setSearchTerm] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [followedBusinesses, setFollowedBusinesses] = useState<Set<string>>(new Set())
  const [categories, setCategories] = useState<string[]>(['all'])
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null)
  const [randomProducts, setRandomProducts] = useState<Product[]>([])
  const [productsByBusiness, setProductsByBusiness] = useState<Record<string, Product[]>>({})
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [selectedProductBusiness, setSelectedProductBusiness] = useState<Business | null>(null)
  const [isProductSidebarOpen, setIsProductSidebarOpen] = useState(false)
  const [groupId, setGroupId] = useState<string | null>(null)
  const [detectedGroupName, setDetectedGroupName] = useState<string | null>('Daule')
  const [coverageGroups, setCoverageGroups] = useState<CoverageGroup[]>([])
  const [loadingProducts, setLoadingProducts] = useState(false)
  const [showGroupSelector, setShowGroupSelector] = useState(false)
  const groupSelectorRef = useRef<HTMLDivElement>(null)
  const [isOutOfCoverage, setIsOutOfCoverage] = useState(false)
  const [showAllRestaurants, setShowAllRestaurants] = useState(false)
  const [surveySubmitted, setSurveySubmitted] = useState(false)
  const [requestName, setRequestName] = useState('')
  const [requestWhatsapp, setRequestWhatsapp] = useState('')
  const [isSubmittingSurvey, setIsSubmittingSurvey] = useState(false)
  const [showLoginModal, setShowLoginModal] = useState(false)

  // Use useMemo for story businesses to ensure a stable random order per session/businesses-update
  const storyBusinesses = React.useMemo(() => {
    return businesses
      .filter(b => !b.isHidden && b.businessType !== 'distributor')
      .filter(b => {
        const products = productsByBusiness[b.id]
        return products && products.length > 0
      })
      .sort((a, b) => {
        const aOpen = isStoreOpen(a)
        const bOpen = isStoreOpen(b)
        if (aOpen !== bOpen) return aOpen ? -1 : 1
        
        const aLastEdit = productsByBusiness[a.id]?.[0]?.updatedAt?.getTime() || 0
        const bLastEdit = productsByBusiness[b.id]?.[0]?.updatedAt?.getTime() || 0
        return bLastEdit - aLastEdit
      })
  }, [businesses, productsByBusiness])

  const sortedRestaurants = React.useMemo(() => {
    return businesses
      .filter(b => b.businessType !== 'distributor')
      .filter(b => {
        const products = productsByBusiness[b.id]
        return products && products.length > 0
      })
      .sort((a, b) => {
        const aOpen = isStoreOpen(a)
        const bOpen = isStoreOpen(b)
        if (aOpen !== bOpen) return aOpen ? -1 : 1
        
        const aLastEdit = productsByBusiness[a.id]?.[0]?.updatedAt?.getTime() || 0
        const bLastEdit = productsByBusiness[b.id]?.[0]?.updatedAt?.getTime() || 0
        return bLastEdit - aLastEdit
      })
  }, [businesses, productsByBusiness])

  const sortedDistributors = React.useMemo(() => {
    return businesses
      .filter(b => b.businessType === 'distributor')
      .filter(b => {
        const products = productsByBusiness[b.id]
        return products && products.length > 0
      })
      .sort((a, b) => {
        const aLastEdit = productsByBusiness[a.id]?.[0]?.updatedAt?.getTime() || 0
        const bLastEdit = productsByBusiness[b.id]?.[0]?.updatedAt?.getTime() || 0
        return bLastEdit - aLastEdit
      })
  }, [businesses, productsByBusiness])

  // Story Modal State
  const [isStoryModalOpen, setIsStoryModalOpen] = useState(false)
  const [isStoryPaused, setIsStoryPaused] = useState(false) // Modal de detalle abierto
  const [isStoryHeld, setIsStoryHeld] = useState(false) // Pantalla presionada
  const [selectedStoryBusiness, setSelectedStoryBusiness] = useState<Business | null>(null)
  const [storyProducts, setStoryProducts] = useState<Product[]>([])
  const [currentStoryIndex, setCurrentStoryIndex] = useState(0)
  const [loadingStoryProducts, setLoadingStoryProducts] = useState(false)
  const [storyProgress, setStoryProgress] = useState<Record<string, number>>({})

  // Update progress when story index changes
  useEffect(() => {
    if (selectedStoryBusiness && isStoryModalOpen) {
      setStoryProgress(prev => ({
        ...prev,
        [selectedStoryBusiness.id]: currentStoryIndex
      }))
    }
  }, [currentStoryIndex, selectedStoryBusiness?.id, isStoryModalOpen])

  // Automatic Story Progression
  useEffect(() => {
    let interval: NodeJS.Timeout
    if (isStoryModalOpen && storyProducts.length > 0 && !loadingStoryProducts && !isStoryPaused && !isStoryHeld) {
      interval = setInterval(() => {
        if (currentStoryIndex < storyProducts.length - 1) {
          setCurrentStoryIndex(prev => prev + 1)
        } else {
          openNextBusinessStory()
        }
      }, 5000)
    }
    return () => clearInterval(interval)
  }, [isStoryModalOpen, currentStoryIndex, storyProducts.length, loadingStoryProducts, isStoryPaused, isStoryHeld])

  // Disable pull-to-refresh and history navigation when story is open
  useEffect(() => {
    if (isStoryModalOpen) {
      document.body.style.overscrollBehaviorY = 'none'
      document.body.style.overscrollBehaviorX = 'none'
    } else {
      document.body.style.overscrollBehaviorY = ''
      document.body.style.overscrollBehaviorX = ''
    }
    return () => {
      document.body.style.overscrollBehaviorY = ''
      document.body.style.overscrollBehaviorX = ''
    }
  }, [isStoryModalOpen])

  // Pre-load next story images for smoother navigation
  useEffect(() => {
    if (isStoryModalOpen && storyProducts.length > 0) {
      // Pre-cargar la siguiente imagen
      const nextIndex = currentStoryIndex + 1
      if (nextIndex < storyProducts.length && storyProducts[nextIndex].image) {
        const img = document.createElement('img')
        img.src = storyProducts[nextIndex].image!
      }

      // Pre-cargar la subsiguiente para mayor fluidez
      const nextNextIndex = currentStoryIndex + 2
      if (nextNextIndex < storyProducts.length && storyProducts[nextNextIndex].image) {
        const img2 = document.createElement('img')
        img2.src = storyProducts[nextNextIndex].image!
      }
    }
  }, [currentStoryIndex, storyProducts, isStoryModalOpen])

  // Cart State
  const [cart, setCart] = useState<any[]>([])
  const [isCartOpen, setIsCartOpen] = useState(false)

  // Referral Modal State
  const [referralModalOpen, setReferralModalOpen] = useState(false)
  const [selectedProductForReferral, setSelectedProductForReferral] = useState<any>(null)
  const [generatedReferralLink, setGeneratedReferralLink] = useState<string>('')
  const [referralBusinessName, setReferralBusinessName] = useState<string>('')
  const [generatedReferralProducts, setGeneratedReferralProducts] = useState<Set<string>>(new Set())
  const [referralCounts, setReferralCounts] = useState<Record<string, number>>({})

  // Load Cart Logic
  useEffect(() => {
    // Priorizar el negocio de la historia si está abierta, sino usar el de productos seleccionados
    const currentBusinessId = selectedStoryBusiness?.id || selectedProductBusiness?.id

    if (currentBusinessId) {
      const loadCart = () => {
        const savedCarts = localStorage.getItem('carts')
        if (savedCarts) {
          const allCarts = JSON.parse(savedCarts)
          const businessCart = allCarts[currentBusinessId] || []
          setCart(businessCart)
        } else {
          setCart([])
        }
      }

      loadCart()
      const handleStorageChange = () => loadCart()
      window.addEventListener('storage', handleStorageChange)
      // Custom event for same-window updates
      window.addEventListener('cart-updated', handleStorageChange)

      return () => {
        window.removeEventListener('storage', handleStorageChange)
        window.removeEventListener('cart-updated', handleStorageChange)
      }
    }
  }, [selectedStoryBusiness?.id, selectedProductBusiness?.id, isCartOpen])

  // Cargar productos que el usuario ya ha recomendado + contadores globales
  useEffect(() => {
    const loadRecommendedProducts = async () => {
      if (!user?.id || Object.keys(productsByBusiness).length === 0) return

      const allProducts = Object.values(productsByBusiness).flat()
      const productIds = allProducts.map(p => p.id)
      const recommendedSet = new Set<string>()

      await Promise.all(
        productIds.map(async (productId) => {
          const hasReferral = await userHasReferralForProduct(user.id, productId)
          if (hasReferral) {
            recommendedSet.add(productId)
          }
        })
      )

      setGeneratedReferralProducts(recommendedSet)

      // Cargar contadores de recomendaciones
      const counts = await getProductsReferralCounts(productIds)
      setReferralCounts(counts)
    }

    loadRecommendedProducts()
  }, [user?.id, productsByBusiness])

  const updateCartInStorage = (businessId: string, businessCart: any[]) => {
    const savedCarts = localStorage.getItem('carts')
    const allCarts = savedCarts ? JSON.parse(savedCarts) : {}

    if (businessCart.length === 0) {
      delete allCarts[businessId]
    } else {
      allCarts[businessId] = businessCart
    }

    localStorage.setItem('carts', JSON.stringify(allCarts))
    window.dispatchEvent(new Event('storage'))
    window.dispatchEvent(new Event('cart-updated'))
  }

  const updateQuantity = (productId: string, quantity: number, variantName?: string | null) => {
    // Priorizar el negocio de la historia si está abierta, sino usar el de productos seleccionados
    const currentBusinessId = selectedStoryBusiness?.id || selectedProductBusiness?.id
    if (!currentBusinessId) return

    if (quantity <= 0) {
      removeFromCart(productId, variantName)
      return
    }

    const newCart = cart.map(item =>
      (item.id === productId && item.variantName === variantName)
        ? { ...item, quantity }
        : item
    )

    setCart(newCart)
    updateCartInStorage(currentBusinessId, newCart)
  }

  const removeFromCart = (productId: string, variantName?: string | null) => {
    // Priorizar el negocio de la historia si está abierta, sino usar el de productos seleccionados
    const currentBusinessId = selectedStoryBusiness?.id || selectedProductBusiness?.id
    if (!currentBusinessId) return

    // Note: unredeem logic normally here, but for now we implement basic removal
    // (CartSidebar handles unredeem logic for QR prizes internally via useEffects usually, or we can copy it if needed)

    const newCart = cart.filter(item => !(item.id === productId && item.variantName === variantName))
    setCart(newCart)
    updateCartInStorage(currentBusinessId, newCart)
  }

  const addItemToCart = (item: any) => {
    // Priorizar el negocio de la historia si está abierta, sino usar el de productos seleccionados
    const currentBusinessId = selectedStoryBusiness?.id || selectedProductBusiness?.id
    if (!currentBusinessId) return

    const existingItemIndex = cart.findIndex((cartItem) =>
      cartItem.id === item.id && cartItem.variantName === item.variantName
    )

    let newCart: any[]
    if (existingItemIndex >= 0) {
      newCart = [...cart]
      newCart[existingItemIndex].quantity += 1
    } else {
      const enriched = ensureCartItemMetadata({ ...item })
      newCart = [...cart, { ...enriched, quantity: 1 }]
    }

    setCart(newCart)
    updateCartInStorage(currentBusinessId, newCart)
  }

  const clearCart = () => {
    // Priorizar el negocio de la historia si está abierta, sino usar el de productos seleccionados
    const currentBusinessId = selectedStoryBusiness?.id || selectedProductBusiness?.id
    if (!currentBusinessId) return
    setCart([])
    updateCartInStorage(currentBusinessId, [])
  }

  // Función para generar link de referido
  const handleGenerateReferral = async (product: any, business: Business) => {
    if (!business?.id) return

    try {
      const { code, isNew } = await generateReferralLink(
        product.id,
        business.id,
        user?.id || undefined,
        product.name,
        product.image,
        business.name,
        business.username,
        product.slug
      )

      const referralUrl = `${window.location.origin}/${business.username}/${product.slug}?ref=${code}`
      setGeneratedReferralLink(referralUrl)
      setSelectedProductForReferral(product)
      setReferralBusinessName(business.name)
      setGeneratedReferralProducts(prev => new Set(prev).add(product.id))
      // Actualizar contador local solo si es nuevo
      if (isNew) {
        setReferralCounts(prev => ({
          ...prev,
          [product.id]: (prev[product.id] || 0) + 1
        }))
      }
      setReferralModalOpen(true)
    } catch (error) {
      console.error('Error generating referral:', error)
    }
  }

  // Cargar productos de negocios (tanto restaurantes como proveedores)
  useEffect(() => {
    const fetchBusinessProducts = async () => {
      if (businesses.length === 0) return

      try {
        setLoadingProducts(true)
        const productsMap: Record<string, Product[]> = {}
        // Ejecutamos en paralelo para máxima velocidad, pero limitamos a los negocios visibles
        const targetBusinesses = businesses.slice(0, 60); // Limitar para evitar saturación de red

        await Promise.all(targetBusinesses.map(async (business) => {
          const products = await getProductsByBusiness(business.id)
          // Filtrar y ordenar por edición más reciente
          const sorted = products
            .filter(p => p.isAvailable && p.image)
            .sort((a, b) => {
              const dateA = a.updatedAt?.getTime() || 0
              const dateB = b.updatedAt?.getTime() || 0
              return dateB - dateA
            })
          productsMap[business.id] = sorted.slice(0, 10)
        }))
        setProductsByBusiness(prev => ({ ...prev, ...productsMap }))
      } catch (error) {
        console.error("Error loading business products:", error)
      } finally {
        setLoadingProducts(false)
      }
    }

    if (businesses.length > 0) {
      fetchBusinessProducts()
    }
  }, [businesses])

  // Helper: detectar grupo por coordenadas y actualizar estado
  const detectGroupFromCoords = async (coords: { lat: number; lng: number }, groupsReference?: CoverageGroup[]) => {
    try {
      console.log('[LOCATION] Detecting group for:', coords)
      const zone = await getCoverageZoneForLocation(coords)
      console.log('[LOCATION] Zone found:', zone)

      if (zone?.groupId) {
        setGroupId(zone.groupId)
        setIsOutOfCoverage(false)
        localStorage.setItem('lastDetectedGroupId', zone.groupId)

        // Usar los grupos pasados o los del estado
        const groups = groupsReference || (coverageGroups.length > 0 ? coverageGroups : await getCoverageGroups())
        const found = groups.find(g => g.id === zone.groupId)
        console.log('[LOCATION] Group confirmed:', found?.name)
        setDetectedGroupName(found?.name || null)
      } else {
        console.log('[LOCATION] No coverage for these coords')
        // Si hay coordenadas pero no hay zona, mostramos fuera de cobertura
        setGroupId(null)
        setIsOutOfCoverage(true)
        setDetectedGroupName(null)
        localStorage.removeItem('lastDetectedGroupId')
      }
    } catch (err) {
      console.error('[LOCATION] Error in detection:', err)
    }
  }

  // Cerrar dropdown al hacer clic fuera
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (groupSelectorRef.current && !groupSelectorRef.current.contains(event.target as Node)) {
        setShowGroupSelector(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Sistema de inicialización de grupos y ubicación (Solo selector manual)
  useEffect(() => {
    const initLocation = async () => {
      try {
        // 1. Cargar grupos de cobertura
        const groups = await getCoverageGroups()
        const activeGroups = groups.filter(g => g.isActive)
        setCoverageGroups(activeGroups)

        // 2. Buscar el grupo Daule por defecto y establecerlo
        const daule = activeGroups.find(g => g.name.toLowerCase().includes('daule'))
        if (daule) {
          setGroupId(daule.id)
          setDetectedGroupName(daule.name)
          localStorage.setItem('lastDetectedGroupId', daule.id)
        }
      } catch (err) {
        console.error('Error in location system init:', err)
      }
    }

    initLocation()

    // Listeners para cambios externos
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'userCoordinates' && e.newValue) {
        try {
          const coords = JSON.parse(e.newValue)
          setUserLocation(coords)
          detectGroupFromCoords(coords)
        } catch (err) {
          console.warn('Error parsing updated coordinates:', err)
        }
      }
    }

    window.addEventListener('storage', handleStorageChange)

    return () => {
      window.removeEventListener('storage', handleStorageChange)
    }
  }, [])

  // Cargar categorías únicas solo una vez al inicio
  useEffect(() => {
    const init = async () => {
      try {
        const allBusinesses = await getAllBusinesses()
        const visibleBusinesses = allBusinesses.filter(b => !b.isHidden)

        // Aplicar filtro de grupo si existe o si estamos en una ciudad específica
        let filteredForCategories = visibleBusinesses;
        if (showAllRestaurants) {
        } else if (groupId) {
          filteredForCategories = filteredForCategories.filter(b => b.groupId === groupId)
        } else {
          filteredForCategories = filteredForCategories.filter(b => !b.groupId)
        }

        // Extraer categorías de los productos de los negocios filtrados por ubicación
        const uniqueCategories = new Set<string>()

        // Primero agregar categorías de los negocios (rápido, no bloquea)
        filteredForCategories.forEach(b => {
          b.categories?.forEach(c => uniqueCategories.add(c))
        })

        // Set inicial de categorías para mostrar UI rápido (mejora FCP)
        const initialCategories = Array.from(uniqueCategories).sort(() => 0.5 - Math.random())
        setCategories(['all', ...initialCategories])

        // Luego cargar más categorías de productos en background (no bloquea render)
        const businessIds = filteredForCategories.map(b => b.id)
        if (businessIds.length > 0) {
          // No bloquear - cargar en background
          getGlobalProducts('all', 100, showAllRestaurants ? 'ALL' : (groupId || undefined))
            .then(products => {
              const extraCategories = new Set<string>(uniqueCategories)
              products.forEach(p => {
                if (p.category) extraCategories.add(p.category)
              })
              const shuffled = Array.from(extraCategories).sort(() => 0.5 - Math.random())
              setCategories(['all', ...shuffled])
            })
            .catch(error => {
              console.error('Error loading product categories:', error)
            })
        }

        // Cargar negocios iniciales (si no hay búsqueda en la URL)
        const urlSearch = searchParams.get('search') || ''
        const urlCategory = searchParams.get('category') || 'all'

        // Aplicar filtro de grupo si existe o si estamos en una ciudad específica
        let filtered = visibleBusinesses;

        if (showAllRestaurants) {
        } else if (groupId) {
          filtered = filtered.filter(b => b.groupId === groupId)
        } else {
          filtered = filtered.filter(b => !b.groupId)
        }

        setBusinesses(filtered)
        setLoading(false)
        if (user) loadFollowedBusinesses()
      } catch (err) {
        console.error('Error in init:', err)
        setLoading(false)
      }
    }
    init()
  }, [groupId, showAllRestaurants])

  // Sincronizar parámetros de la URL
  useEffect(() => {
    const urlSearch = searchParams.get('search') || ''
    const urlCategory = searchParams.get('category') || 'all'
    if (urlSearch !== searchTerm || urlCategory !== selectedCategory) {
      setSearchTerm(urlSearch)
      setSelectedCategory(urlCategory)
      loadBusinessesWithParams(urlSearch, urlCategory)
    }
  }, [searchParams])

  // Cargar productos aleatorios de forma EFICIENTE (una sola query)
  const loadRandomProducts = async (category: string = 'all') => {
    try {
      const selected = await getGlobalProducts(category, 24, showAllRestaurants ? 'ALL' : (groupId || undefined))
      setRandomProducts(selected)
    } catch (error) {
      console.error('Error loading random products:', error)
    }
  }

  useEffect(() => {
    loadRandomProducts(selectedCategory)
  }, [selectedCategory, groupId, showAllRestaurants])

  const loadBusinessesWithParams = async (search: string, category: string) => {
    try {
      setLoading(true)
      const data = search || category !== 'all' || (groupId && !showAllRestaurants)
        ? await searchBusinesses(search, category, showAllRestaurants ? undefined : (groupId || undefined))
        : await getAllBusinesses()

      // Filtrar negocios ocultos
      let visibleBusinesses = data.filter(b => !b.isHidden)

      // Si usamos getAllBusinesses, el groupId no se filtró en la query
      if (!search && category === 'all' && !showAllRestaurants) {
        if (groupId) {
          visibleBusinesses = visibleBusinesses.filter(b => b.groupId === groupId)
        } else {
          visibleBusinesses = visibleBusinesses.filter(b => !b.groupId)
        }
      }

      setBusinesses(visibleBusinesses)
    } finally {
      setLoading(false)
    }
  }

  // Recargar negocios cuando cambia el groupId (detección de ubicación)
  useEffect(() => {
    const urlSearch = searchParams.get('search') || ''
    const urlCategory = searchParams.get('category') || 'all'
    loadBusinessesWithParams(urlSearch, urlCategory)
  }, [groupId, showAllRestaurants])

  const handleCategoryChange = async (category: string) => {
    setSelectedCategory(category)
    const newUrl = category === 'all' ? '/' : `/?category=${category}`
    router.push(newUrl)
    await loadBusinessesWithParams(searchTerm, category)
  }

  const handleOpenRatingModal = (business: Business) => {
    setSelectedRatingBusiness(business)
    setIsRatingModalOpen(true)
  }

  const handleRatingSuccess = (message: string) => {
    setRatingNotification({ show: true, message })
    setTimeout(() => setRatingNotification({ show: false, message: '' }), 3000)
  }

  const loadFollowedBusinesses = () => {
    if (typeof window !== 'undefined' && user) {
      const saved = localStorage.getItem(`followedBusinesses_${user.id}`)
      if (saved) setFollowedBusinesses(new Set(JSON.parse(saved)))
    }
  }

  // Sincronizar lectura de favoritos al cargar el usuario (Auth asíncrono)
  useEffect(() => {
    if (user) {
      loadFollowedBusinesses()
    }
  }, [user])

  const handleFollowToggle = (id: string, e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault()
      e.stopPropagation()
    }

    if (!user) {
      setShowLoginModal(true)
      return
    }
    const updated = new Set(followedBusinesses)
    updated.has(id) ? updated.delete(id) : updated.add(id)
    setFollowedBusinesses(updated)
    localStorage.setItem(`followedBusinesses_${user.id}`, JSON.stringify(Array.from(updated)))
  }

  const handleProductClick = (product: Product, business?: Business) => {
    if (!business) {
      // Intentar encontrar el negocio si no se pasa explícitamente (para random products)
      business = businesses.find(b => b.id === product.businessId)
    }

    if (business) {
      setSelectedProduct(product)
      setSelectedProductBusiness(business)
      if (isStoryModalOpen) {
        setIsStoryPaused(true)
      } else {
        setIsProductSidebarOpen(true)
      }
    } else {
      // Fallback a navegación si no se encuentra el negocio (no debería pasar)
      const productLink = `/product/${product.id}` // Link genérico o manejar error
      router.push(productLink)
    }
  }

  const handleOpenStory = async (business: Business) => {
    setSelectedStoryBusiness(business)
    setIsStoryModalOpen(true)

    // Set initial index from saved progress
    const savedIndex = storyProgress[business.id] || 0
    setCurrentStoryIndex(savedIndex)

    setLoadingStoryProducts(true)
    try {
      const products = await getProductsByBusiness(business.id)
      // Filter only products with images for stories, max 10
      const productsWithImage = products.filter(p => p.image && p.isAvailable).slice(0, 10)
      setStoryProducts(productsWithImage)

      // Safety check: if saved index is now out of bounds because products changed
      if (savedIndex >= productsWithImage.length && productsWithImage.length > 0) {
        setCurrentStoryIndex(0)
      }
    } catch (error) {
      console.error("Error loading story products:", error)
    } finally {
      setLoadingStoryProducts(false)
    }
  }

  const openPrevBusinessStory = () => {
    const currentIndex = storyBusinesses.findIndex(b => b.id === selectedStoryBusiness?.id)
    if (currentIndex > 0) {
      handleOpenStory(storyBusinesses[currentIndex - 1])
    }
  }

  const openNextBusinessStory = () => {
    const currentIndex = storyBusinesses.findIndex(b => b.id === selectedStoryBusiness?.id)
    if (currentIndex > -1 && currentIndex < storyBusinesses.length - 1) {
      handleOpenStory(storyBusinesses[currentIndex + 1])
    } else {
      setIsStoryModalOpen(false)
    }
  }

  const filteredRandomProducts = randomProducts.filter(product => {
    const business = businesses.find(b => b.id === product.businessId)
    return business?.businessType !== 'distributor' && !!product.image
  })

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Indicador de zona (FUERA de la sección de stories para evitar overflow-hidden) */}
      {(detectedGroupName || coverageGroups.length > 0) && (
        <div className="max-w-6xl mx-auto px-6 pt-4 pb-2 relative">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-3xl sm:text-4xl font-black text-gray-900 tracking-tight leading-tight">

              </h2>
            </div>
            <div className="flex items-center gap-2">
              {showAllRestaurants && (
                <button
                  onClick={() => {
                    setShowAllRestaurants(false)
                    setShowGroupSelector(false)
                  }}
                  className="text-[10px] font-bold text-gray-400 uppercase tracking-widest hover:text-gray-600 transition-colors"
                >
                  Ver solo mi zona
                </button>
              )}
              <button
                onClick={() => setShowGroupSelector(!showGroupSelector)}
                className="text-xs font-black text-[#aa1918] bg-red-50 px-3 py-1 rounded-full hover:bg-red-100 transition-colors flex items-center gap-1"
              >
                <i className="bi bi-geo-alt-fill text-sm"></i>
                {detectedGroupName || 'Daule'}
                <i className={`bi bi-chevron-${showGroupSelector ? 'up' : 'down'} text-[10px]`}></i>
              </button>
            </div>
          </div>

          {/* Dropdown de grupos */}
          {showGroupSelector && coverageGroups.length > 0 && (
            <div ref={groupSelectorRef} className="absolute top-full right-4 mt-1 bg-white rounded-xl shadow-xl border border-gray-100 py-2 z-[9999] min-w-[200px]">
              {coverageGroups.map(group => (
                <button
                  key={group.id}
                  onClick={() => {
                    setGroupId(group.id)
                    setDetectedGroupName(group.name)
                    setShowGroupSelector(false)
                    setShowAllRestaurants(false)
                    localStorage.setItem('lastDetectedGroupId', group.id)
                  }}
                  className={`w-full text-left px-4 py-2 text-sm font-medium hover:bg-gray-50 transition-colors flex items-center gap-2 ${groupId === group.id ? 'text-[#aa1918] bg-red-50' : 'text-gray-700'
                    }`}
                >
                  <i className={`bi bi-${groupId === group.id ? 'check-circle-fill text-[#aa1918]' : 'circle text-gray-300'} text-xs`}></i>
                  {group.name}
                </button>
              ))}
              <div className="border-t border-gray-100 mt-1 pt-1">
                <button
                  onClick={() => {
                    setGroupId(null)
                    setDetectedGroupName(null)
                    setShowAllRestaurants(true)
                    setShowGroupSelector(false)
                    localStorage.removeItem('lastDetectedGroupId')
                  }}
                  className={`w-full text-left px-4 py-2 text-sm font-medium hover:bg-gray-50 transition-colors flex items-center gap-2 ${!groupId && showAllRestaurants ? 'text-[#aa1918] bg-red-50' : 'text-gray-500'
                    }`}
                >
                  <i className="bi bi-globe text-xs"></i>
                  Todos los restaurantes
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* STORE STORIES (Instagram style) */}
      <section className="pt-1 pb-1 bg-gray-50">
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex gap-4 overflow-x-auto scrollbar-hide pb-2 px-2 items-start">
            {loading || loadingProducts ? (
              <div className="w-full h-20 flex items-center justify-center text-gray-400"></div>
            ) : (
              storyBusinesses.map((b) => {
                return (
                  <button
                    key={b.id}
                    onClick={() => handleOpenStory(b)}
                    className="flex flex-col items-center gap-1.5 flex-shrink-0 w-20 group transition-transform active:scale-95 text-left"
                  >
                    <div className={`relative p-[2.5px] rounded-full shadow-sm group-hover:shadow-md transition-all ${isStoreOpen(b)
                      ? 'bg-emerald-400'
                      : 'bg-gray-200'}`}>
                      <div className="p-0.5 bg-white rounded-full">
                        <div className="relative w-16 h-16 rounded-full overflow-hidden border border-gray-100 bg-gray-50 flex items-center justify-center">
                          {b.image ? (
                            <ProgressiveImage
                              src={b.image}
                              alt={b.name}
                              fill
                              sizes="64px"
                              priority
                              className="object-cover group-hover:scale-110 transition-transform duration-500"
                            />
                          ) : (
                            <i className="bi bi-shop text-2xl text-gray-400"></i>
                          )}
                        </div>
                      </div>
                    </div>
                    <span className="text-[10px] font-bold text-gray-600 text-center line-clamp-1 w-full px-1 group-hover:text-[#aa1918] transition-colors">
                      {b.name}
                    </span>
                  </button>
                )
              })
            )}
          </div>
        </div>
      </section>

      {/* PRODUCTOS ALEATORIOS */}
      <section className="py-2 pb-1">
        <div className="max-w-6xl mx-auto px-6">
          <div className="relative">
            <div className="flex gap-4 overflow-x-auto scrollbar-hide pb-4 random-products-carousel">
              {filteredRandomProducts.map((product) => {
                const business = businesses.find(b => b.id === product.businessId)
                const businessLink = business?.username ? `/${business.username}` : `/restaurant/${product.businessId}`
                const productLink = `${businessLink}/${product.slug || product.id}`

                return (
                  <div
                    key={product.id}
                    onClick={() => handleProductClick(product, business)}
                    className="flex-shrink-0 w-64 bg-white rounded-2xl shadow-sm hover:shadow-md transition-all overflow-hidden border border-gray-100 cursor-pointer"
                  >
                    <div className="relative h-40 bg-gray-100 flex items-center justify-center overflow-hidden">
                      {product.image ? (
                        <ProgressiveImage
                          src={product.image}
                          alt={product.name}
                          fill
                          sizes="256px"
                          className="object-cover"
                        />
                      ) : (
                        <div className="w-full h-full bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center">
                          <i className="bi bi-bag text-4xl text-gray-400"></i>
                        </div>
                      )}
                      {product.price > 0 && (
                        <div className="absolute top-3 right-3 bg-[#aa1918] text-white px-2 py-1 rounded-full text-xs font-bold">
                          {formatPrice(getProductPublicPrice(product))}
                        </div>
                      )}
                    </div>
                    <div className="p-4">
                      <div className="flex gap-3 mb-2">
                        <div className="relative w-8 h-8 rounded-full overflow-hidden border border-gray-100 flex-shrink-0 bg-white">
                          {business?.image ? (
                            <ProgressiveImage
                              src={business.image}
                              alt={business.name}
                              fill
                              sizes="32px"
                              className="object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center bg-gray-50">
                              <i className="bi bi-shop text-gray-400"></i>
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="text-sm font-bold text-gray-900 line-clamp-1">
                            {product.name}
                          </h3>
                          {business && (
                            <p className="text-xs text-gray-500 line-clamp-1">
                              {business.name}
                            </p>
                          )}
                        </div>
                      </div>
                      {product.description && (
                        <p className="text-xs text-gray-600 line-clamp-2">
                          {product.description}
                        </p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Flechas de navegación */}
            <button
              onClick={() => {
                const container = document.querySelector('.random-products-carousel')
                if (container) {
                  container.scrollLeft -= 300
                }
              }}
              className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-4 w-10 h-10 bg-white rounded-full shadow-lg flex items-center justify-center text-gray-700 hover:bg-gray-50 transition-all z-10"
            >
              <i className="bi bi-chevron-left"></i>
            </button>
            <button
              onClick={() => {
                const container = document.querySelector('.random-products-carousel')
                if (container) {
                  container.scrollLeft += 300
                }
              }}
              className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-4 w-10 h-10 bg-white rounded-full shadow-lg flex items-center justify-center text-gray-700 hover:bg-gray-50 transition-all z-10"
            >
              <i className="bi bi-chevron-right"></i>
            </button>
          </div>
        </div>
      </section>


      {/* LISTA DE RESTAURANTES */}
      <section className="py-4 bg-gray-50">
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex justify-between items-end mb-8">
            <div>
              <h2 className="text-3xl sm:text-4xl font-black text-gray-900 tracking-tight leading-tight">
                {detectedGroupName ? `Restaurantes en ${detectedGroupName}` : 'Restaurantes cerca de ti'}
              </h2>
              {detectedGroupName && (
                <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                  <i className="bi bi-geo-alt-fill text-[#aa1918]"></i>
                  Mostrando tiendas en tu ciudad
                </p>
              )}
            </div>
          </div>

          {loading || loadingProducts ? (
            <div className="text-center py-16">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#aa1918] mx-auto"></div>
              <p className="mt-4 text-gray-600">Cargando restaurantes...</p>
            </div>
          ) : (isOutOfCoverage || sortedRestaurants.length === 0) ? (
            <div className="max-w-xl mx-auto py-12 px-6 bg-white rounded-3xl shadow-sm border border-gray-100">
              {surveySubmitted ? (
                <div className="text-center animate-in fade-in zoom-in duration-500">
                  <div className="text-6xl mb-4">🚀</div>
                  <h3 className="text-2xl font-black text-gray-900 mb-2">¡Pedido recibido!</h3>
                  <p className="text-gray-600 mb-6">Gracias por ayudarnos a crecer. ¡Pronto estaremos en tu zona!</p>
                  <button
                    onClick={() => setSurveySubmitted(false)}
                    className="text-[#aa1918] font-bold text-sm hover:underline"
                  >
                    Enviar otra sugerencia
                  </button>
                </div>
              ) : (
                <div className="text-center">
                  <div className="text-6xl mb-6">🍽️</div>
                  <h3 className="text-2xl font-black text-gray-900 mb-3 leading-tight">
                    Aún no estamos repartiendo en tu zona, pero tú mandas.
                  </h3>
                  <p className="text-gray-500 mb-8 font-medium">¿Qué restaurante nos falta aquí?</p>

                  <form onSubmit={async (e) => {
                    e.preventDefault();
                    if (!requestName.trim()) return;

                    setIsSubmittingSurvey(true);
                    try {
                      await saveRestaurantRequest({
                        restaurantName: requestName,
                        whatsapp: requestWhatsapp,
                        location: userLocation,
                        groupId: groupId
                      });
                      setSurveySubmitted(true);
                      setRequestName('');
                      setRequestWhatsapp('');
                    } catch (err) {
                      alert('Error al enviar la sugerencia. Inténtalo de nuevo.');
                    } finally {
                      setIsSubmittingSurvey(false);
                    }
                  }} className="space-y-4">
                    <div className="text-left">
                      <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 ml-1">
                        Nombre del Restaurante
                      </label>
                      <input
                        type="text"
                        value={requestName}
                        onChange={(e) => setRequestName(e.target.value)}
                        placeholder="Ej: Las Burguesas de la Esquina"
                        required
                        className="w-full bg-gray-50 border-none rounded-2xl px-5 py-4 text-sm focus:ring-2 focus:ring-[#aa1918]/20 transition-all"
                      />
                    </div>

                    <div className="text-left">
                      <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 ml-1">
                        Tu WhatsApp (Opcional)
                      </label>
                      <p className="text-[10px] text-gray-500 mb-2 ml-1">
                        Te avisaremos en cuanto los sumemos y te enviaremos un cupón de regalo 🎁
                      </p>
                      <input
                        type="tel"
                        value={requestWhatsapp}
                        onChange={(e) => setRequestWhatsapp(e.target.value)}
                        placeholder="0987654321"
                        className="w-full bg-gray-50 border-none rounded-2xl px-5 py-4 text-sm focus:ring-2 focus:ring-[#aa1918]/20 transition-all"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={isSubmittingSurvey || !requestName.trim()}
                      className={`w-full bg-[#aa1918] text-white font-black py-4 rounded-2xl shadow-lg shadow-red-900/10 hover:shadow-red-900/20 active:scale-[0.98] transition-all flex items-center justify-center gap-2 group ${isSubmittingSurvey ? 'opacity-70 cursor-not-allowed' : ''}`}
                    >
                      {isSubmittingSurvey ? (
                        <div className="h-5 w-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                      ) : (
                        <>
                          Enviar Sugerencia
                          <i className="bi bi-arrow-right group-hover:translate-x-1 transition-transform"></i>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setIsOutOfCoverage(false)
                        setShowAllRestaurants(true)
                      }}
                      className="w-full text-gray-400 font-bold text-xs uppercase tracking-widest border border-gray-100 py-3 rounded-2xl hover:bg-gray-50 transition-all"
                    >
                      Ver todos los restaurantes
                    </button>
                  </form>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-12">
              {sortedRestaurants.map((b) => {
                const link = b.username ? `/${b.username}` : `/restaurant/${b.id}`
                const followed = followedBusinesses.has(b.id)
                const products = productsByBusiness[b.id] || []

                return (
                  <div key={b.id} className="animate-in fade-in slide-in-from-bottom-4 duration-700">
                    {/* Header del Restaurante: Logo, Nombre y Reseñas */}
                    <div className="flex items-start justify-between mb-5 px-1">
                      <div className="flex items-start gap-4">
                        <Link href={link} className="group">
                          <div className="w-16 h-16 rounded-full overflow-hidden border-2 border-white shadow-xl bg-gray-50 flex-shrink-0 group-hover:scale-105 transition-transform duration-300">
                            {b.image ? (
                              <img
                                src={b.image}
                                alt={b.name}
                                loading="lazy"
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <i className="bi bi-shop text-3xl text-gray-300"></i>
                              </div>
                            )}
                          </div>
                        </Link>
                        <div className="flex-1 min-w-0">
                          <Link href={link} className="group">
                            <h3 className="text-xl font-black text-gray-900 line-clamp-1 group-hover:text-[#aa1918] transition-colors tracking-tight">
                              {b.name}
                            </h3>
                          </Link>
                          {b.description && (
                            <p className="text-xs text-gray-400 mt-1 line-clamp-1">
                              {b.description}
                            </p>
                          )}
                          {/* Estrellas justo debajo del nombre y descripción */}
                          <div>
                            {b.ratingAverage ? (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleOpenRatingModal(b)
                                }}
                                className="flex items-center gap-1 hover:opacity-80 transition-opacity cursor-pointer"
                              >
                                <StarRating rating={b.ratingAverage} size="sm" />
                                <span className="text-xs font-bold text-gray-400 ml-1">({b.ratingCount || 0})</span>
                              </button>
                            ) : (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleOpenRatingModal(b)
                                }}
                                className="flex items-center gap-1 hover:opacity-80 transition-opacity cursor-pointer"
                              >
                                <StarRating rating={0} size="sm" showGrayStars />
                                <span className="text-[10px] font-bold text-gray-300 uppercase tracking-widest ml-1">Sin reseñas</span>
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-1">
                        <button
                          onClick={(e) => handleFollowToggle(b.id, e)}
                          className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${followed ? 'bg-red-50 text-[#aa1918]' : 'bg-gray-100 text-gray-400 hover:bg-gray-200'}`}
                        >
                          <i className={`bi bi-heart${followed ? '-fill' : ''} text-lg`}></i>
                        </button>
                      </div>
                    </div>

                    {/* Carrusel de Productos Aleatorios */}
                    <div className="relative group/carousel">
                      <div className="flex gap-4 overflow-x-auto scrollbar-hide pb-2 px-1">
                        {products.length > 0 ? (
                          products.map((product) => (
                            <div
                              key={product.id}
                              onClick={() => handleProductClick(product, b)}
                              className="flex-shrink-0 w-72 bg-white rounded-2xl shadow-sm hover:shadow-md transition-all overflow-hidden border border-gray-100 cursor-pointer group/product"
                            >
                              <div className="relative h-40 bg-gray-100 flex items-center justify-center overflow-hidden">
                                {product.image ? (
                                  <ProgressiveImage
                                    src={product.image}
                                    alt={product.name}
                                    fill
                                    sizes="288px"
                                    className="object-cover group-hover/product:scale-105 transition-transform duration-500"
                                  />
                                ) : (
                                  <div className="w-full h-full bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
                                    <i className="bi bi-bag text-3xl text-gray-300"></i>
                                  </div>
                                )}
                                {product.price > 0 && (
                                  <div className="absolute top-3 right-3 bg-[#aa1918] text-white px-2 py-1 rounded-full text-xs font-bold shadow-sm">
                                    {formatPrice(getProductPublicPrice(product))}
                                  </div>
                                )}
                              </div>
                              <div className="p-4">
                                <h4 className="text-sm font-bold text-gray-900 line-clamp-1 group-hover/product:text-[#aa1918] transition-colors mb-1">{product.name}</h4>
                                <div className="flex items-start justify-between gap-2">
                                  <p className="text-xs text-gray-500 line-clamp-2 leading-snug flex-1">
                                    {product.description || 'Delicioso plato preparado con los mejores ingredientes.'}
                                  </p>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      handleGenerateReferral(product, b)
                                    }}
                                    className={`flex items-center gap-1 flex-shrink-0 transition-all ${generatedReferralProducts.has(product.id) ? '' : 'text-gray-400 hover:text-[#aa1918]'}`}
                                    title="Recomendar"
                                  >
                                    <Flame size={16} strokeWidth={generatedReferralProducts.has(product.id) ? 3 : 1.5} color={generatedReferralProducts.has(product.id) ? '#F59E0B' : undefined} />
                                    {referralCounts[product.id] !== undefined && referralCounts[product.id] > 0 && (
                                      <span className="text-[10px] font-bold text-gray-500">
                                        {referralCounts[product.id]}
                                      </span>
                                    )}
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))
                        ) : null}

                        {/* Botón "Ver Todos" al final del carrusel */}
                        {products.length > 0 && (
                          <Link
                            href={link}
                            className="flex-shrink-0 w-24 sm:w-28 flex flex-col items-center justify-center group/all"
                          >
                            <div className="w-12 h-12 rounded-full bg-red-50 text-[#aa1918] flex items-center justify-center mb-2 group-hover/all:bg-[#aa1918] group-hover/all:text-white transition-all shadow-sm">
                              <i className="bi bi-arrow-right text-xl"></i>
                            </div>
                            <span className="text-[10px] font-black text-gray-400 line-clamp-1 uppercase tracking-widest text-center">Ver todo el menú</span>
                          </Link>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>

      {/* PEQUEÑA SECCIÓN DE REGISTRO (CONVERTIDA) */}
      <section className="py-8 bg-white border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-6">
          <div className="bg-gradient-to-r from-red-600 to-orange-500 rounded-3xl p-6 sm:p-10 text-white shadow-xl flex flex-col sm:flex-row items-center justify-between gap-6 overflow-hidden relative group">
            <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full -mr-20 -mt-20 blur-3xl group-hover:bg-white/20 transition-all duration-500"></div>
            <div className="relative z-10 text-center sm:text-left">
              <h2 className="text-2xl sm:text-3xl font-black mb-2 tracking-tight">¿Tienes un negocio?</h2>
              <p className="text-red-50 font-medium text-sm sm:text-base opacity-90">
                Empieza hoy mismo, vende tus productos y encuentra los mejores proveedores.
              </p>
            </div>
            <div className="relative z-10 flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
              <Link
                href="/business/dashboard"
                className="bg-white text-red-600 px-8 py-3 rounded-2xl font-black text-sm uppercase tracking-widest hover:bg-red-50 transition-all shadow-lg active:scale-95 text-center"
              >
                Vende aquí
              </Link>
              <button
                onClick={() => {
                  const el = document.getElementById('suppliers-section');
                  el?.scrollIntoView({ behavior: 'smooth' });
                }}
                className="bg-red-700/30 backdrop-blur-md text-white border border-white/30 px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-red-700/50 transition-all text-center"
              >
                Proveedores
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* SECCIÓN PROVEEDORES (NUEVA) */}
      {sortedDistributors.length > 0 && (
        <section id="suppliers-section" className="py-12 bg-white border-t border-gray-100">
          <div className="max-w-6xl mx-auto px-6">
            <div className="flex justify-between items-end mb-8">
              <h2 className="text-3xl sm:text-4xl font-black text-gray-900 tracking-tight leading-tight">Proveedores Aliados</h2>
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest bg-gray-100 px-3 py-1 rounded-full">{sortedDistributors.length} aliados</span>
            </div>

            <div className="space-y-10">
              {sortedDistributors.map((b) => {
                const link = b.username ? `/${b.username}` : `/restaurant/${b.id}`
                const products = productsByBusiness[b.id] || []

                return (
                  <div key={b.id} className="group">
                    {/* Header del Proveedor */}
                    <div className="mb-4 px-2">
                      <Link href={link} className="flex items-center gap-3 hover:opacity-80 transition-all group/header">
                        <div className="relative w-12 h-12 rounded-full overflow-hidden border-2 border-orange-50 bg-orange-50 shadow-sm flex-shrink-0 group-hover/header:border-orange-500 transition-colors">
                          {b.image ? <ProgressiveImage src={b.image} alt={b.name} fill sizes="48px" className="object-cover" /> : <div className="w-full h-full flex items-center justify-center bg-orange-50 text-orange-200"><i className="bi bi-shop text-xl"></i></div>}
                        </div>
                        <div>
                          <h3 className="text-lg font-black text-gray-900 uppercase tracking-tighter leading-none mb-1 group-hover/header:text-orange-600 transition-colors">{b.name}</h3>
                          {b.description && (
                            <p className="text-[10px] font-medium text-gray-500 line-clamp-1">{b.description}</p>
                          )}
                        </div>
                      </Link>
                    </div>

                    {/* Carrusel Horizontal de Productos */}
                    <div className="relative">
                      <div className="flex gap-4 overflow-x-auto scrollbar-hide pb-4 px-2">
                        {products.length > 0 ? (
                          products.map((product) => (
                            <div
                              key={product.id}
                              onClick={() => handleProductClick(product, b)}
                              className="flex-shrink-0 w-36 sm:w-44 bg-white rounded-2xl p-3 border border-gray-100 shadow-sm hover:shadow-xl hover:scale-[1.02] transition-all duration-300 group/product cursor-pointer"
                            >
                              <div className="relative aspect-square rounded-xl overflow-hidden bg-gray-50 mb-3 flex items-center justify-center">
                                {product.image ? (
                                  <ProgressiveImage src={product.image} alt={product.name} fill sizes="(max-width: 640px) 144px, 176px" className="object-cover group-hover/product:scale-110 transition-transform duration-500" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-gray-200 bg-gray-50">
                                    <i className="bi bi-box text-5xl"></i>
                                  </div>
                                )}
                                {product.price > 0 && (
                                  <div className="absolute top-3 right-3 bg-white/90 backdrop-blur-md text-gray-900 px-3 py-1 rounded-full text-[10px] font-black shadow-sm ring-1 ring-black/5">
                                    {formatPrice(getProductPublicPrice(product))}
                                  </div>
                                )}
                              </div>
                              <h4 className="text-xs font-bold text-gray-900 line-clamp-1 mb-1 group-hover/product:text-orange-600 transition-colors uppercase tracking-tight">{product.name}</h4>
                              <p className="text-[10px] text-gray-400 line-clamp-1 leading-none">{product.description || 'Sin descripción'}</p>
                            </div>
                          ))
                        ) : (
                          [...Array(4)].map((_, i) => (
                            <div key={i} className="flex-shrink-0 w-36 sm:w-44 aspect-[4/5] bg-gray-50 rounded-2xl border border-dashed border-gray-200 flex flex-col items-center justify-center p-4 text-center">
                              <i className="bi bi-box text-3xl text-gray-200 mb-2"></i>
                              <p className="text-[10px] font-bold text-gray-300 uppercase tracking-widest">Catálogo próximamente</p>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </section>
      )}

      {/* FOOTER */}
      <footer className="bg-gray-900 text-gray-400 py-10">
        <div className="max-w-6xl mx-auto px-6 text-center space-y-4">
          <Link href="/" className="text-2xl font-bold text-[#aa1918]">Fuddi</Link>
          <p className="max-w-xl mx-auto text-sm">Conectamos restaurantes con clientes hambrientos.</p>
          <div className="flex justify-center gap-4 text-gray-500">
            <a href="https://instagram.com/fuddi.shop" target="_blank" rel="noopener noreferrer"><i className="bi bi-instagram text-lg hover:text-white"></i></a>
            <a href="https://wa.me/593984612236" target="_blank" rel="noopener noreferrer"><i className="bi bi-whatsapp text-lg hover:text-white"></i></a>
          </div>
          <p className="text-xs text-gray-500 pt-4 border-t border-gray-800">© 2025 Fuddi. Todos los derechos reservados.</p>
        </div>
      </footer>

      {/* MODALES ADICIONALES */}
      {isStoryModalOpen && selectedStoryBusiness && (
        <div className="fixed inset-0 z-[100] bg-black flex items-center justify-center overflow-hidden touch-none h-screen w-screen select-none" style={{ overscrollBehaviorX: 'none' }}>
          <div className="relative w-full h-full max-w-lg mx-auto bg-black flex flex-col items-center justify-center">
            {/* Progress Bars */}
            <div className="absolute top-4 left-0 right-0 z-20 flex gap-1 px-4">
              {storyProducts.length > 0 ? (
                storyProducts.map((_, i) => (
                  <div key={i} className="flex-1 h-0.5 bg-white/30 rounded-full overflow-hidden">
                    <div
                      className={`h-full bg-white ${i < currentStoryIndex
                          ? 'w-full'
                          : i === currentStoryIndex
                            ? 'animate-story-progress'
                            : 'w-0'
                        }`}
                      style={{
                        animationPlayState: (isStoryPaused || isStoryHeld) ? 'paused' : 'running'
                      }}
                    ></div>
                  </div>
                ))
              ) : (
                <div className="flex-1 h-0.5 bg-white/30 rounded-full"></div>
              )}
            </div>

            {/* Header */}
            <div className="absolute top-10 left-0 right-0 z-20 flex items-center justify-between px-4">
              <div className="flex items-center gap-3">
                <Link
                  href={selectedStoryBusiness.username ? `/${selectedStoryBusiness.username}` : `/restaurant/${selectedStoryBusiness.id}`}
                  className="flex items-center gap-3 transition-opacity active:opacity-70"
                >
                  <div className="w-10 h-10 rounded-full border-2 border-white overflow-hidden bg-white shadow-lg">
                    <img src={selectedStoryBusiness.image} alt={selectedStoryBusiness.name} loading="lazy" className="w-full h-full object-cover" />
                  </div>
                  <div className="drop-shadow-md">
                    <h4 className="text-white text-sm font-bold leading-none">{selectedStoryBusiness.name}</h4>
                    <p className="text-[10px] text-white/70">Hace un momento</p>
                  </div>
                </Link>
                <button
                  onClick={(e) => handleFollowToggle(selectedStoryBusiness.id, e)}
                  className={`w-10 h-10 flex items-center justify-center transition-all ${followedBusinesses.has(selectedStoryBusiness.id) ? 'text-[#aa1918]' : 'text-white/70 hover:text-[#aa1918]'}`}
                >
                  <i className={`bi bi-heart${followedBusinesses.has(selectedStoryBusiness.id) ? '-fill' : ''} text-xl`}></i>
                </button>
              </div>
              <button
                onClick={() => setIsStoryModalOpen(false)}
                className="w-10 h-10 flex items-center justify-center text-white drop-shadow-md"
              >
                <i className="bi bi-x-lg text-2xl"></i>
              </button>
            </div>

            {/* Content Player */}
            <div className="w-full h-full relative overflow-hidden flex items-center justify-center bg-black">
              {loadingStoryProducts ? (
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mb-8"></div>
              ) : storyProducts.length > 0 ? (
                <>
                  {/* Layered Images for Zero Flicker */}
                  {storyProducts.map((p, idx) => (
                    <img
                      key={p.id}
                      src={p.image}
                      alt={p.name}
                      loading={idx === currentStoryIndex ? "eager" : "lazy"}
                      className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${idx === currentStoryIndex ? 'opacity-100' : 'opacity-0'}`}
                    />
                  ))}

                  {/* Overlay Gradient Background (Subtle) */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/20 pointer-events-none"></div>

                  {/* Navigation Zones */}
                  <div
                    className="absolute inset-0 flex"
                    onMouseDown={() => setIsStoryHeld(true)}
                    onMouseUp={() => setIsStoryHeld(false)}
                    onMouseLeave={() => setIsStoryHeld(false)}
                    onTouchStart={(e) => {
                      touchStartXRef.current = e.touches[0].clientX
                      touchStartYRef.current = e.touches[0].clientY
                      touchStartTimeRef.current = Date.now()
                      setIsStoryHeld(true)
                    }}
                    onTouchMove={(e) => {
                      // Prevenir la navegación del navegador si es un deslizamiento horizontal
                      const currentX = e.touches[0].clientX
                      const deltaX = currentX - touchStartXRef.current
                      if (Math.abs(deltaX) > 10) {
                        // Solo prevenimos si el movimiento es principalmente horizontal
                        const deltaY = e.touches[0].clientY - touchStartYRef.current
                        if (Math.abs(deltaX) > Math.abs(deltaY)) {
                          if (e.cancelable) e.preventDefault()
                        }
                      }
                    }}
                    onTouchEnd={(e) => {
                      setIsStoryHeld(false)
                      const deltaX = e.changedTouches[0].clientX - touchStartXRef.current
                      const deltaY = e.changedTouches[0].clientY - touchStartYRef.current
                      const deltaTime = Date.now() - touchStartTimeRef.current

                      // Si es un deslizamiento horizontal claro (más que vertical y mayor a 60px)
                      if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 60) {
                        if (deltaX > 0) {
                          openPrevBusinessStory()
                        } else {
                          openNextBusinessStory()
                        }
                      }
                      // Si es un deslizamiento vertical hacia abajo para cerrar
                      else if (deltaY > 100 && Math.abs(deltaX) < 50) {
                        setIsStoryModalOpen(false)
                      }
                    }}
                  >
                    <div
                      className="w-1/3 h-full cursor-pointer"
                      onClick={(e) => {
                        if (currentStoryIndex > 0) {
                          setCurrentStoryIndex(prev => prev - 1)
                        }
                      }}
                    ></div>
                    <div
                      className="w-2/3 h-full cursor-pointer"
                      onClick={(e) => {
                        if (currentStoryIndex < storyProducts.length - 1) {
                          setCurrentStoryIndex(prev => prev + 1)
                        } else {
                          openNextBusinessStory()
                        }
                      }}
                    ></div>
                  </div>

                  {/* Product Info & Action (Using current index for dynamic info) */}
                  <div className="absolute bottom-32 left-0 right-0 px-6 flex flex-col items-center">
                    <div className="flex items-center gap-1 mb-1">
                      <h3 className="text-white text-xl font-bold text-center drop-shadow-md">
                        {storyProducts[currentStoryIndex].name}
                      </h3>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleGenerateReferral(storyProducts[currentStoryIndex], selectedStoryBusiness)
                        }}
                        className={`flex items-center gap-1 flex-shrink-0 transition-all ${generatedReferralProducts.has(storyProducts[currentStoryIndex].id)
                            ? 'text-amber-400'
                            : 'text-white/60 hover:text-amber-400'
                          }`}
                        title="Recomendar"
                      >
                        <Flame size={16} strokeWidth={generatedReferralProducts.has(storyProducts[currentStoryIndex].id) ? 3 : 1.5} />
                        {referralCounts[storyProducts[currentStoryIndex].id] !== undefined && referralCounts[storyProducts[currentStoryIndex].id] > 0 && (
                          <span className="text-xs font-bold text-white/70">
                            {referralCounts[storyProducts[currentStoryIndex].id]}
                          </span>
                        )}
                      </button>
                    </div>
                    {storyProducts[currentStoryIndex].variants && storyProducts[currentStoryIndex].variants.length > 0 ? (
                      <div className="flex flex-col items-center gap-1.5 mb-6">
                        {storyProducts[currentStoryIndex].variants.slice(0, 2).map((variant, vIdx) => (
                          <div key={vIdx} className="text-[11px] font-bold text-white/80 flex gap-2 items-center">
                            <span className="text-white/60 uppercase tracking-tighter">{variant.name}</span>
                            <span className="text-white">{formatPrice(getProductPublicPrice(variant))}</span>
                          </div>
                        ))}
                        {storyProducts[currentStoryIndex].variants.length > 2 && (
                          <button
                            onClick={() => handleProductClick(storyProducts[currentStoryIndex], selectedStoryBusiness)}
                            className="text-white/70 text-[11px] font-bold flex items-center gap-1 mt-1 hover:text-white transition-colors"
                          >
                            Ver más <i className="bi bi-chevron-down text-[10px]"></i>
                          </button>
                        )}
                      </div>
                    ) : (
                      <p className="text-white/90 text-sm mb-6 font-bold bg-white/20 backdrop-blur-md px-4 py-1 rounded-full border border-white/20">
                        {formatPrice(getProductPublicPrice(storyProducts[currentStoryIndex]))}
                      </p>
                    )}

                    <div className="flex gap-3 w-full">
                      <button
                        onClick={() => {
                          handleProductClick(storyProducts[currentStoryIndex], selectedStoryBusiness)
                        }}
                        className="flex-1 bg-white text-black font-black py-4 rounded-2xl shadow-xl active:scale-95 transition-all text-sm uppercase tracking-wider"
                      >
                        Ver Detalle / Comprar
                      </button>

                      {cart.length > 0 && (
                        <button
                          onClick={() => {
                            setIsCartOpen(true)
                            setIsStoryModalOpen(false)
                          }}
                          className="bg-black text-white font-black py-4 px-4 rounded-2xl shadow-xl active:scale-95 transition-all relative"
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
                </>
              ) : (
                <div className="text-center text-white px-10">
                  <i className="bi bi-image text-5xl mb-4 opacity-30"></i>
                  <h4 className="text-xl font-bold mb-2">Próximamente...</h4>
                  <p className="text-sm opacity-70 mb-8">Esta tienda pronto tendrá nuevas historias para ti.</p>
                  <button
                    onClick={() => setIsStoryModalOpen(false)}
                    className="w-full bg-white text-black font-bold py-3 rounded-xl"
                  >
                    Cerrar
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <ProductDetailSidebar
        isOpen={isProductSidebarOpen}
        onClose={() => setIsProductSidebarOpen(false)}
        product={selectedProduct}
        business={selectedProductBusiness!}
        onProductSelect={handleProductClick}
        onOpenCart={() => setIsCartOpen(true)}
      />

      <StoryProductDetail
        isOpen={isStoryPaused}
        onClose={() => setIsStoryPaused(false)}
        product={selectedProduct}
        business={selectedProductBusiness}
        onAddToCart={addItemToCart}
        onOpenCart={() => {
          setIsCartOpen(true)
          setIsStoryModalOpen(false)
        }}
        onGenerateReferral={selectedProduct && selectedProductBusiness ? () => handleGenerateReferral(selectedProduct, selectedProductBusiness) : undefined}
        hasRecommended={selectedProduct ? generatedReferralProducts.has(selectedProduct.id) : false}
        referralCount={selectedProduct ? referralCounts[selectedProduct.id] : undefined}
      />

      <CartSidebar
        isOpen={isCartOpen}
        onClose={() => setIsCartOpen(false)}
        cart={cart}
        business={selectedProductBusiness}
        removeFromCart={removeFromCart}
        updateQuantity={updateQuantity}
        clearCart={clearCart}
        addItemToCart={addItemToCart}
      />

      <ReferralModal
        isOpen={referralModalOpen}
        onClose={() => setReferralModalOpen(false)}
        product={selectedProductForReferral}
        referralLink={generatedReferralLink}
        businessName={referralBusinessName}
      />

      <ClientLoginModal
        isOpen={showLoginModal}
        onClose={() => setShowLoginModal(false)}
        onLoginSuccess={() => setShowLoginModal(false)}
      />

      {/* Rating Modal */}
      {selectedRatingBusiness && (
        <StoreRatingModal
          isOpen={isRatingModalOpen}
          onClose={() => setIsRatingModalOpen(false)}
          business={selectedRatingBusiness}
          clientPhone={null}
          clientUser={user}
          businessUser={businessUser}
          businessOwnerId={selectedRatingBusiness.ownerId || null}
          onSuccess={handleRatingSuccess}
        />
      )}

      {/* Rating Notification */}
      {ratingNotification.show && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[250] animate-in fade-in slide-in-from-top-4 duration-300">
          <div className="bg-gray-900 text-white px-6 py-3 rounded-full text-xs font-black uppercase tracking-widest shadow-2xl">
            {ratingNotification.message}
          </div>
        </div>
      )}
    </div>
  )
}
