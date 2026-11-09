'use client'

import React, { useState, useEffect, Suspense, useRef } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import {
  getAllBusinesses,
  getProductsByBusiness,
  getProductsByBusinessesBatch,
  generateReferralLink,
  getGlobalProductReviews,
  GlobalProductReviewItem
} from '@/lib/database'
import { ensureCartItemMetadata, getProductPublicPrice, formatPrice } from '@/lib/price-utils'
import { Business, Product } from '@/types'
import { isStoreOpen, formatBusinessName, getNextOpeningMessage } from '@/lib/store-utils'
import { formatRelativeTime } from '@/lib/date-utils'
import { useAuth } from '@/contexts/AuthContext'
import StarRating from '@/components/StarRating'
import { Star } from 'lucide-react'
import dynamic from 'next/dynamic'

const ProductDetailSidebar = dynamic(() => import('@/components/ProductDetailSidebar'), { ssr: false })
const StoryProductDetail = dynamic(() => import('@/components/StoryProductDetail'), { ssr: false })
const CartSidebar = dynamic(() => import('@/components/CartSidebar'), { ssr: false })
const ReferralModal = dynamic(() => import('@/components/ReferralModal'), { ssr: false })
const ClientLoginModal = dynamic(() => import('@/components/ClientLoginModal'), { ssr: false })
const StoreRatingModal = dynamic(() => import('@/components/StoreRatingModal'), { ssr: false })

// Componente para imágenes directas de alto rendimiento y cero parpadeo
const ProgressiveImage: React.FC<{
  src: string
  alt: string
  className?: string
  fill?: boolean
  width?: number
  height?: number
  priority?: boolean
  sizes?: string
  style?: React.CSSProperties
}> = ({
  src,
  alt,
  className = '',
  fill = false,
  width,
  height,
  priority = false,
  style
}) => {
  const [hasError, setHasError] = useState(false)

  useEffect(() => {
    setHasError(false)
  }, [src])

  if (hasError) {
    return (
      <div
        className={`flex items-center justify-center bg-gray-100 text-gray-300 ${fill ? 'absolute inset-0 w-full h-full' : ''} ${className}`}
        style={style}
      >
        <i className="bi bi-card-image text-2xl opacity-40"></i>
      </div>
    )
  }

  return (
    <img
      src={src}
      alt={alt}
      width={!fill ? width : undefined}
      height={!fill ? height : undefined}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      className={`${fill ? 'absolute inset-0 w-full h-full object-cover' : ''} ${className}`}
      style={style}
      onError={() => setHasError(true)}
    />
  )
}

export default function HomePage() {
  return (
    <Suspense fallback={<HomePageLoading />}>
      <HomePageContent />
    </Suspense>
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

// Dibuja el encuadre suavizado para contenedores rectangulares (menos altos) en el Home
function getDampenedImagePosition(position: string | undefined): string {
  if (!position) return 'center'
  const parts = position.split(' ')
  if (parts.length < 2) return position
  const pctStr = parts[1].replace('%', '')
  const pct = parseInt(pctStr, 10)
  if (isNaN(pct)) return position
  const dampenedPct = Math.round(50 + (pct - 50) * 0.6)
  return `center ${dampenedPct}%`
}

// Función de hash determinista para rotación aleatoria estable por sesión (0 Layout Shifts)
function getSessionHash(str: string, seed: number = 42): number {
  let hash = seed
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
  }
  return hash
}

function getSafeTime(value: any): number {
  if (!value) return 0
  if (value instanceof Date) return value.getTime()
  if (typeof value?.toDate === 'function') return value.toDate().getTime()
  const parsed = new Date(value).getTime()
  return isNaN(parsed) ? 0 : parsed
}

function HomePageContent() {
  const { user } = useAuth()
  const searchParams = useSearchParams()
  const router = useRouter()
  const sessionSeedRef = useRef<number>(Math.floor(Math.random() * 10000) + 1)

  const [businesses, setBusinesses] = useState<Business[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingProducts, setLoadingProducts] = useState(true)
  const [newestProducts, setNewestProducts] = useState<Product[]>([])
  const [bestSellersProducts, setBestSellersProducts] = useState<Product[]>([])
  const [productsByBusiness, setProductsByBusiness] = useState<Record<string, Product[]>>({})
  const [recentReviews, setRecentReviews] = useState<GlobalProductReviewItem[]>([])

  const [followedBusinesses, setFollowedBusinesses] = useState<Set<string>>(new Set())
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [selectedProductBusiness, setSelectedProductBusiness] = useState<Business | null>(null)
  const [isProductSidebarOpen, setIsProductSidebarOpen] = useState(false)
  const [hasOpenedProductSidebar, setHasOpenedProductSidebar] = useState(false)
  const [showLoginModal, setShowLoginModal] = useState(false)
  const [isRatingModalOpen, setIsRatingModalOpen] = useState(false)
  const [selectedRatingBusiness, setSelectedRatingBusiness] = useState<Business | null>(null)
  const [ratingNotification, setRatingNotification] = useState<{ show: boolean; message: string }>({ show: false, message: '' })

  // Swipe State for Stories
  const touchStartXRef = useRef<number>(0)
  const touchStartYRef = useRef<number>(0)
  const touchStartTimeRef = useRef<number>(0)

  const searchTerm = (searchParams?.get('search') || '').trim().toLowerCase()
  const selectedCategory = searchParams?.get('category') || 'all'

  // Carga inicial unificada (Caché instantáneo + Firestore en paralelo sin cascadas)
  useEffect(() => {
    let isMounted = true

    // 1. Restaurar caché de sesión en 0ms
    try {
      const savedBiz = sessionStorage.getItem('home_businesses_v2')
      if (savedBiz) {
        const parsedBiz = JSON.parse(savedBiz)
        if (Array.isArray(parsedBiz) && parsedBiz.length > 0) {
          setBusinesses(parsedBiz.filter((b: Business) => !b.isHidden))
          setLoading(false)
        }
      }

      const savedByBiz = sessionStorage.getItem('home_products_by_biz_v2')
      if (savedByBiz) {
        const parsedMap = JSON.parse(savedByBiz)
        if (parsedMap && Object.keys(parsedMap).length > 0) {
          setProductsByBusiness(parsedMap)
          setLoadingProducts(false)
        }
      }

      const savedNew = sessionStorage.getItem('home_newest_products_v2')
      if (savedNew) {
        const parsedNew = JSON.parse(savedNew)
        if (Array.isArray(parsedNew) && parsedNew.length > 0) {
          setNewestProducts(parsedNew)
          setLoadingProducts(false)
        }
      }

      const savedBest = sessionStorage.getItem('home_bestsellers_products_v2')
      if (savedBest) {
        const parsedBest = JSON.parse(savedBest)
        if (Array.isArray(parsedBest) && parsedBest.length > 0) {
          setBestSellersProducts(parsedBest)
        }
      }

      const savedReviews = sessionStorage.getItem('home_recent_reviews_v2')
      if (savedReviews) {
        const parsedRev = JSON.parse(savedReviews)
        if (Array.isArray(parsedRev) && parsedRev.length > 0) {
          setRecentReviews(parsedRev)
        }
      }
    } catch {}

    // Helper para procesar productos en una sola pasada en memoria
    const buildCatalog = (targetBusinesses: Business[], rawProducts: Product[]) => {
      const bizMap = new Map(targetBusinesses.map(b => [b.id, b]))
      const grouped: Record<string, Product[]> = {}
      targetBusinesses.forEach(b => { grouped[b.id] = [] })

      const eligibleForHighlights: Product[] = []

      for (const product of rawProducts) {
        if (!product.image || !product.isAvailable) continue
        const biz = bizMap.get(product.businessId)
        if (grouped[product.businessId]) {
          grouped[product.businessId].push(product)
        }
        if (biz && !biz.isHidden && biz.businessType !== 'distributor') {
          eligibleForHighlights.push({
            ...product,
            businessName: product.businessName || biz.name,
            businessImage: product.businessImage || biz.image
          })
        }
      }

      const sortedMap: Record<string, Product[]> = {}
      for (const biz of targetBusinesses) {
        const master = biz.categories || []
        const bizProducts = grouped[biz.id] || []
        const fromProducts = Array.from(new Set(bizProducts.map(p => p.category).filter(Boolean))) as string[]
        const extras = fromProducts.filter(c => !master.includes(c))
        const categoryOrder = [...master, ...extras]
        if (bizProducts.some(p => !p.category || p.category === 'Sin categoría') && !categoryOrder.includes('Sin categoría')) {
          categoryOrder.push('Sin categoría')
        }

        sortedMap[biz.id] = bizProducts
          .sort((a, b) => {
            const catA = categoryOrder.indexOf(a.category || 'Sin categoría')
            const catB = categoryOrder.indexOf(b.category || 'Sin categoría')
            const idxA = catA !== -1 ? catA : 9999
            const idxB = catB !== -1 ? catB : 9999
            if (idxA !== idxB) return idxA - idxB

            const orderA = a.order ?? 0
            const orderB = b.order ?? 0
            if (orderA !== orderB) return orderA - orderB

            return getSafeTime(b.updatedAt) - getSafeTime(a.updatedAt)
          })
          .slice(0, 10)
      }

      const sortedByNew = [...eligibleForHighlights].sort(
        (a, b) => getSafeTime(b.createdAt) - getSafeTime(a.createdAt)
      )
      const sortedBySales = [...eligibleForHighlights].sort((a, b) => {
        const salesDiff = (b.salesCount || 0) - (a.salesCount || 0)
        if (salesDiff !== 0) return salesDiff
        return getSafeTime(b.createdAt) - getSafeTime(a.createdAt)
      })

      return { sortedMap, sortedByNew, sortedBySales }
    }

    // 2. Cargar tiendas y productos en un único flujo directo
    const loadMainData = async () => {
      try {
        const allBiz = await getAllBusinesses()
        if (!isMounted) return

        const visibleBiz = allBiz.filter(b => !b.isHidden)
        setBusinesses(visibleBiz)
        setLoading(false)

        try {
          sessionStorage.setItem('home_businesses_v2', JSON.stringify(visibleBiz))
        } catch {}

        if (visibleBiz.length === 0) {
          setLoadingProducts(false)
          return
        }

        // Priorizar tiendas abiertas para que el primer lote pinte la pantalla principal de inmediato
        const prioritizedBiz = [...visibleBiz].sort((a, b) => {
          const aOpen = isStoreOpen(a)
          const bOpen = isStoreOpen(b)
          return aOpen === bOpen ? 0 : aOpen ? -1 : 1
        })

        const priorityBiz = prioritizedBiz.slice(0, 8)
        const secondaryBiz = prioritizedBiz.slice(8, 24)

        const priorityProducts = await getProductsByBusinessesBatch(priorityBiz.map(b => b.id))
        if (!isMounted) return

        const initialCatalog = buildCatalog(priorityBiz, priorityProducts)
        setProductsByBusiness(prev => ({ ...prev, ...initialCatalog.sortedMap }))
        if (initialCatalog.sortedByNew.length > 0) setNewestProducts(initialCatalog.sortedByNew)
        if (initialCatalog.sortedBySales.length > 0) setBestSellersProducts(initialCatalog.sortedBySales)
        setLoadingProducts(false)

        let allProducts = priorityProducts
        let allTargetBiz = priorityBiz

        if (secondaryBiz.length > 0) {
          const secondaryProducts = await getProductsByBusinessesBatch(secondaryBiz.map(b => b.id))
          if (!isMounted) return
          allProducts = [...priorityProducts, ...secondaryProducts]
          allTargetBiz = [...priorityBiz, ...secondaryBiz]
        }

        const fullCatalog = buildCatalog(allTargetBiz, allProducts)
        setProductsByBusiness(prev => {
          const merged = { ...prev, ...fullCatalog.sortedMap }
          try {
            sessionStorage.setItem('home_products_by_biz_v2', JSON.stringify(merged))
          } catch {}
          return merged
        })
        setNewestProducts(fullCatalog.sortedByNew)
        setBestSellersProducts(fullCatalog.sortedBySales)

        try {
          sessionStorage.setItem('home_newest_products_v2', JSON.stringify(fullCatalog.sortedByNew.slice(0, 24)))
          sessionStorage.setItem('home_bestsellers_products_v2', JSON.stringify(fullCatalog.sortedBySales.slice(0, 24)))
        } catch {}
      } catch (error) {
        console.error('Error loading home data:', error)
      } finally {
        if (isMounted) {
          setLoading(false)
          setLoadingProducts(false)
        }
      }
    }

    // 3. Cargar reseñas recientes en paralelo sin bloquear el catálogo
    const loadReviews = async () => {
      try {
        const items = await getGlobalProductReviews(12)
        if (!isMounted) return
        const validReviews = items
          .filter(r => (r.comment && r.comment.trim().length > 0) || r.image)
          .slice(0, 8)
        setRecentReviews(validReviews)
        try {
          sessionStorage.setItem('home_recent_reviews_v2', JSON.stringify(validReviews))
        } catch {}
      } catch (error) {
        console.error('Error fetching recent reviews:', error)
      }
    }

    loadMainData()
    loadReviews()

    return () => { isMounted = false }
  }, [])

  // Filtrado en memoria por búsqueda y categoría (0ms de latencia)
  const filteredBusinesses = React.useMemo(() => {
    return businesses.filter(b => {
      if (b.isHidden) return false
      if (selectedCategory !== 'all') {
        const hasCatInBiz = b.categories?.includes(selectedCategory)
        const hasCatInProds = (productsByBusiness[b.id] || []).some(p => p.category === selectedCategory)
        if (!hasCatInBiz && !hasCatInProds) return false
      }
      if (searchTerm) {
        const nameMatch = b.name?.toLowerCase().includes(searchTerm)
        const descMatch = b.description?.toLowerCase().includes(searchTerm)
        const prodMatch = (productsByBusiness[b.id] || []).some(
          p => p.name?.toLowerCase().includes(searchTerm) || p.description?.toLowerCase().includes(searchTerm)
        )
        if (!nameMatch && !descMatch && !prodMatch) return false
      }
      return true
    })
  }, [businesses, productsByBusiness, selectedCategory, searchTerm])

  const storyBusinesses = React.useMemo(() => {
    return filteredBusinesses
      .filter(b => b.businessType !== 'distributor' && !!b.image)
      .filter(b => {
        const products = productsByBusiness[b.id]
        return products !== undefined ? products.length > 0 : true
      })
      .sort((a, b) => {
        const aOpen = isStoreOpen(a)
        const bOpen = isStoreOpen(b)
        if (aOpen !== bOpen) return aOpen ? -1 : 1
        const aLastEdit = getSafeTime(productsByBusiness[a.id]?.[0]?.updatedAt)
        const bLastEdit = getSafeTime(productsByBusiness[b.id]?.[0]?.updatedAt)
        return bLastEdit - aLastEdit
      })
  }, [filteredBusinesses, productsByBusiness])

  const sortedRestaurants = React.useMemo(() => {
    const filtered = filteredBusinesses
      .filter(b => b.businessType !== 'distributor')
      .filter(b => {
        const products = productsByBusiness[b.id]
        return products && products.length > 0
      })

    const open = filtered.filter(b => isStoreOpen(b))
    const closed = filtered.filter(b => !isStoreOpen(b))

    const seed = sessionSeedRef.current
    const shuffledOpen = [...open].sort((a, b) => getSessionHash(a.id, seed) - getSessionHash(b.id, seed))

    const sortedClosed = closed.sort((a, b) => {
      const aLastEdit = getSafeTime(productsByBusiness[a.id]?.[0]?.updatedAt)
      const bLastEdit = getSafeTime(productsByBusiness[b.id]?.[0]?.updatedAt)
      return bLastEdit - aLastEdit
    })

    return [...shuffledOpen, ...sortedClosed]
  }, [filteredBusinesses, productsByBusiness])

  const sortedDistributors = React.useMemo(() => {
    return filteredBusinesses
      .filter(b => b.businessType === 'distributor')
      .filter(b => {
        const products = productsByBusiness[b.id]
        return products && products.length > 0
      })
      .sort((a, b) => {
        const aLastEdit = getSafeTime(productsByBusiness[a.id]?.[0]?.updatedAt)
        const bLastEdit = getSafeTime(productsByBusiness[b.id]?.[0]?.updatedAt)
        return bLastEdit - aLastEdit
      })
  }, [filteredBusinesses, productsByBusiness])

  // Story Modal State
  const [isStoryModalOpen, setIsStoryModalOpen] = useState(false)
  const [isStoryPaused, setIsStoryPaused] = useState(false)
  const [isStoryHeld, setIsStoryHeld] = useState(false)
  const [selectedStoryBusiness, setSelectedStoryBusiness] = useState<Business | null>(null)
  const [storyProducts, setStoryProducts] = useState<Product[]>([])
  const [currentStoryIndex, setCurrentStoryIndex] = useState(0)
  const [loadingStoryProducts, setLoadingStoryProducts] = useState(false)
  const [storyProgress, setStoryProgress] = useState<Record<string, number>>({})

  useEffect(() => {
    if (selectedStoryBusiness && isStoryModalOpen) {
      setStoryProgress(prev => ({
        ...prev,
        [selectedStoryBusiness.id]: currentStoryIndex
      }))
    }
  }, [currentStoryIndex, selectedStoryBusiness?.id, isStoryModalOpen])

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

  useEffect(() => {
    if (isStoryModalOpen && storyProducts.length > 0) {
      const nextIndex = currentStoryIndex + 1
      if (nextIndex < storyProducts.length && storyProducts[nextIndex].image) {
        const img = document.createElement('img')
        img.src = storyProducts[nextIndex].image!
      }
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

  useEffect(() => {
    const currentBusinessId = selectedStoryBusiness?.id || selectedProductBusiness?.id
    if (!currentBusinessId) return

    const loadCart = () => {
      const savedCarts = localStorage.getItem('carts')
      if (savedCarts) {
        const allCarts = JSON.parse(savedCarts)
        setCart(allCarts[currentBusinessId] || [])
      } else {
        setCart([])
      }
    }

    loadCart()
    window.addEventListener('storage', loadCart)
    window.addEventListener('cart-updated', loadCart)

    return () => {
      window.removeEventListener('storage', loadCart)
      window.removeEventListener('cart-updated', loadCart)
    }
  }, [selectedStoryBusiness?.id, selectedProductBusiness?.id, isCartOpen])

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
    const currentBusinessId = selectedStoryBusiness?.id || selectedProductBusiness?.id
    if (!currentBusinessId) return

    const newCart = cart.filter(item => !(item.id === productId && item.variantName === variantName))
    setCart(newCart)
    updateCartInStorage(currentBusinessId, newCart)
  }

  const addItemToCart = (item: any) => {
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
    const currentBusinessId = selectedStoryBusiness?.id || selectedProductBusiness?.id
    if (!currentBusinessId) return
    setCart([])
    updateCartInStorage(currentBusinessId, [])
  }

  const handleGenerateReferral = async (product: any, business: Business) => {
    if (!business?.id) return

    setSelectedProductForReferral(product)
    setSelectedProductBusiness(business)
    setReferralBusinessName(business.name)
    setGeneratedReferralLink('')
    setReferralModalOpen(true)

    if (user?.id || user?.celular) {
      try {
        const { code, isNew } = await generateReferralLink(
          product.id,
          business.id,
          user.id || user.celular,
          product.name,
          product.image,
          business.name,
          business.username,
          product.slug
        )

        const referralUrl = `${window.location.origin}/${business.username}/${product.slug}?ref=${code}`
        setGeneratedReferralLink(referralUrl)
        setGeneratedReferralProducts(prev => new Set(prev).add(product.id))
        if (isNew) {
          setReferralCounts(prev => ({
            ...prev,
            [product.id]: (prev[product.id] || 0) + 1
          }))
        }
      } catch (error) {
        console.error('Error generating referral:', error)
      }
    }
  }

  const handleOpenRatingModal = (business: Business) => {
    setSelectedRatingBusiness(business)
    setIsRatingModalOpen(true)
  }

  const handleRatingSuccess = (message: string) => {
    setRatingNotification({ show: true, message })
    setTimeout(() => setRatingNotification({ show: false, message: '' }), 3000)
  }

  useEffect(() => {
    if (typeof window !== 'undefined' && user) {
      const saved = localStorage.getItem(`followedBusinesses_${user.id}`)
      if (saved) setFollowedBusinesses(new Set(JSON.parse(saved)))
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
    const effectiveBusiness = business || businesses.find(b => b.id === product.businessId) || ({
      id: product.businessId,
      name: product.businessName || product.originalBusinessName || 'Tienda',
      image: product.businessImage || product.originalBusinessImage || '',
      username: '',
      categories: [],
      isOpen: true,
      rating: 5,
      reviewCount: 0
    } as unknown as Business)

    setSelectedProduct(product)
    setSelectedProductBusiness(effectiveBusiness)
    if (isStoryModalOpen) {
      setIsStoryPaused(true)
    } else {
      setHasOpenedProductSidebar(true)
      setIsProductSidebarOpen(true)
    }
  }

  const handleOpenStory = async (business: Business) => {
    setSelectedStoryBusiness(business)
    setIsStoryModalOpen(true)

    const savedIndex = storyProgress[business.id] || 0
    setCurrentStoryIndex(savedIndex)

    // Si ya tenemos los productos en memoria, mostrarlos en 0ms sin spinner
    const preloaded = productsByBusiness[business.id]
    if (preloaded && preloaded.length > 0) {
      setStoryProducts(preloaded)
      setLoadingStoryProducts(false)
      if (savedIndex >= preloaded.length) {
        setCurrentStoryIndex(0)
      }
      return
    }

    setLoadingStoryProducts(true)
    try {
      const products = await getProductsByBusiness(business.id)
      const productsWithImage = products.filter(p => p.image && p.isAvailable).slice(0, 10)
      setStoryProducts(productsWithImage)

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

  const filteredNewestProducts = React.useMemo(() => {
    const seenNewestBusinesses = new Set<string>()
    const filtered = newestProducts.filter(product => {
      if (selectedCategory !== 'all' && product.category !== selectedCategory) return false
      if (searchTerm) {
        const pMatch = product.name?.toLowerCase().includes(searchTerm) || product.description?.toLowerCase().includes(searchTerm)
        const bMatch = product.businessName?.toLowerCase().includes(searchTerm)
        if (!pMatch && !bMatch) return false
      }
      const business = businesses.find(b => b.id === product.businessId)
      if (business && business.isHidden) return false
      const isEligible = business ? (business.businessType !== 'distributor' && !!product.image) : !!product.image
      if (!isEligible) return false

      if (seenNewestBusinesses.has(product.businessId)) return false
      seenNewestBusinesses.add(product.businessId)
      return true
    })

    if (businesses.length === 0) return filtered

    const openProducts = filtered.filter(product => {
      const business = businesses.find(b => b.id === product.businessId)
      return business ? isStoreOpen(business) : true
    })

    const closedProducts = filtered.filter(product => {
      const business = businesses.find(b => b.id === product.businessId)
      return business ? !isStoreOpen(business) : false
    })

    return [...openProducts, ...closedProducts]
  }, [newestProducts, businesses, selectedCategory, searchTerm])

  const filteredBestSellers = React.useMemo(() => {
    const seenBestBusinesses = new Set<string>()
    return bestSellersProducts.filter(product => {
      if (selectedCategory !== 'all' && product.category !== selectedCategory) return false
      if (searchTerm) {
        const pMatch = product.name?.toLowerCase().includes(searchTerm) || product.description?.toLowerCase().includes(searchTerm)
        const bMatch = product.businessName?.toLowerCase().includes(searchTerm)
        if (!pMatch && !bMatch) return false
      }
      const business = businesses.find(b => b.id === product.businessId)
      if (business && business.isHidden) return false
      const isEligible = business ? (business.businessType !== 'distributor' && !!product.image) : !!product.image
      if (!isEligible) return false

      if (seenBestBusinesses.has(product.businessId)) return false
      seenBestBusinesses.add(product.businessId)
      return true
    })
  }, [bestSellersProducts, businesses, selectedCategory, searchTerm])

  return (
    <div className="min-h-screen bg-gray-50">
      {/* STORE STORIES (Instagram style) */}
      <section className="pt-3 pb-1 bg-gray-50">
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex gap-4 overflow-x-auto scrollbar-hide pb-2 px-2 items-start">
            {storyBusinesses.length === 0 && (loading || loadingProducts) ? (
              <div className="flex gap-4 items-start py-1">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <div key={i} className="flex flex-col items-center gap-1.5 flex-shrink-0 w-20 animate-pulse">
                    <div className="w-16 h-16 rounded-full bg-gray-200 border-2 border-white shadow-xs" />
                    <div className="w-12 h-2.5 bg-gray-200 rounded-full" />
                  </div>
                ))}
              </div>
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
                      {formatBusinessName(b.name)}
                    </span>
                  </button>
                )
              })
            )}
          </div>
        </div>
      </section>

      {/* SKELETON VISUAL DE PRODUCTOS (cuando aún no hay datos y está cargando) */}
      {loadingProducts && filteredNewestProducts.length === 0 && (
        <section className="py-6 bg-white border-b border-gray-100">
          <div className="max-w-6xl mx-auto px-6">
            <div className="mb-4">
              <div className="flex items-center gap-2">
                <h2 className="text-xl sm:text-2xl font-black text-gray-900 tracking-tight leading-none">
                  Lo más nuevo
                </h2>
                <span className="bg-red-50 text-[#aa1918] border border-red-100 text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full">
                  Novedades
                </span>
              </div>
              <p className="text-xs font-medium text-gray-500 mt-1 leading-relaxed">
                Platos y productos agregados recientemente por las tiendas.
              </p>
            </div>
            <div className="flex gap-4 overflow-x-auto scrollbar-hide pb-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="flex-shrink-0 w-64 bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden animate-pulse">
                  <div className="h-40 bg-gray-200" />
                  <div className="p-4 space-y-2.5">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-gray-200" />
                      <div className="flex-1 space-y-1">
                        <div className="h-3.5 bg-gray-200 rounded w-3/4" />
                        <div className="h-2.5 bg-gray-100 rounded w-1/2" />
                      </div>
                    </div>
                    <div className="h-3 bg-gray-100 rounded w-full" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* LO MÁS NUEVO */}
      {filteredNewestProducts.length > 0 && (
        <section className="py-6 bg-white border-b border-gray-100">
          <div className="max-w-6xl mx-auto px-6">
            <div className="mb-4">
              <div className="flex items-center gap-2">
                <h2 className="text-xl sm:text-2xl font-black text-gray-900 tracking-tight leading-none">
                  Lo más nuevo
                </h2>
                <span className="bg-red-50 text-[#aa1918] border border-red-100 text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full">
                  Novedades
                </span>
              </div>
              <p className="text-xs font-medium text-gray-500 mt-1 leading-relaxed">
                Platos y productos agregados recientemente por las tiendas.
              </p>
            </div>

            <div className="relative">
              <div className="flex gap-4 overflow-x-auto scrollbar-hide pb-4 newest-products-carousel">
                {filteredNewestProducts.map((product) => {
                  const business = businesses.find(b => b.id === product.businessId)
                  const businessName = business?.name || product.businessName || product.originalBusinessName || ''
                  const businessImage = business?.image || product.businessImage || product.originalBusinessImage || ''
                  const effectiveBusiness = business || (businessName ? ({ id: product.businessId, name: businessName, image: businessImage } as Business) : undefined)

                  return (
                    <div
                      key={product.id}
                      onClick={() => handleProductClick(product, effectiveBusiness)}
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
                            style={{ objectPosition: getDampenedImagePosition(product.imagePosition) }}
                          />
                        ) : (
                          <div className="w-full h-full bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center">
                            <i className="bi bi-bag text-4xl text-gray-400"></i>
                          </div>
                        )}
                        {product.price > 0 && (
                          <div className="absolute top-3 right-3 bg-[#aa1918] text-white px-2 py-1 rounded-full text-xs font-bold">
                            {formatPrice(getProductPublicPrice(product, effectiveBusiness))}
                          </div>
                        )}
                      </div>
                      <div className="p-4">
                        <div className="flex gap-3 mb-2">
                          <div className="relative w-8 h-8 rounded-full overflow-hidden border border-gray-100 flex-shrink-0 bg-white">
                            {businessImage ? (
                              <ProgressiveImage
                                src={businessImage}
                                alt={businessName || 'Tienda'}
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
                            <h3 className="text-sm font-black text-gray-900 line-clamp-1 tracking-tight leading-tight">
                              {product.name}
                            </h3>
                            {businessName ? (
                              <p className="text-xs font-medium text-gray-500 line-clamp-1">
                                {formatBusinessName(businessName)}
                              </p>
                            ) : null}
                          </div>
                        </div>
                        {product.description && (
                          <p className="text-xs font-medium text-gray-500 line-clamp-2 leading-relaxed">
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
                  const container = document.querySelector('.newest-products-carousel')
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
                  const container = document.querySelector('.newest-products-carousel')
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
      )}

      {/* LOS MÁS VENDIDOS */}
      {filteredBestSellers.length > 0 && (
        <section className="py-6 bg-gray-50 border-b border-gray-100">
          <div className="max-w-6xl mx-auto px-6">
            <div className="mb-4">
              <div className="flex items-center gap-2">
                <h2 className="text-xl sm:text-2xl font-black text-gray-900 tracking-tight leading-none">
                  Los más vendidos
                </h2>
                <span className="bg-amber-50 text-amber-700 border border-amber-100 text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full flex items-center gap-1">
                  <i className="bi bi-fire text-xs text-amber-500"></i>
                  Popular
                </span>
              </div>
              <p className="text-xs font-medium text-gray-500 mt-1 leading-relaxed">
                Platos preferidos y más pedidos por nuestra comunidad.
              </p>
            </div>

            <div className="relative">
              <div className="flex gap-4 overflow-x-auto scrollbar-hide pb-4 best-sellers-carousel">
                {filteredBestSellers.map((product) => {
                  const business = businesses.find(b => b.id === product.businessId)
                  const businessName = business?.name || product.businessName || product.originalBusinessName || ''
                  const businessImage = business?.image || product.businessImage || product.originalBusinessImage || ''
                  const effectiveBusiness = business || (businessName ? ({ id: product.businessId, name: businessName, image: businessImage } as Business) : undefined)

                  return (
                    <div
                      key={product.id}
                      onClick={() => handleProductClick(product, effectiveBusiness)}
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
                            style={{ objectPosition: getDampenedImagePosition(product.imagePosition) }}
                          />
                        ) : (
                          <div className="w-full h-full bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center">
                            <i className="bi bi-bag text-4xl text-gray-400"></i>
                          </div>
                        )}
                        {product.price > 0 && (
                          <div className="absolute top-3 right-3 bg-[#aa1918] text-white px-2 py-1 rounded-full text-xs font-bold">
                            {formatPrice(getProductPublicPrice(product, effectiveBusiness))}
                          </div>
                        )}
                      </div>
                      <div className="p-4">
                        <div className="flex gap-3 mb-2">
                          <div className="relative w-8 h-8 rounded-full overflow-hidden border border-gray-100 flex-shrink-0 bg-white">
                            {businessImage ? (
                              <ProgressiveImage
                                src={businessImage}
                                alt={businessName || 'Tienda'}
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
                            {businessName ? (
                              <p className="text-xs font-medium text-gray-500 line-clamp-1">
                                {formatBusinessName(businessName)}
                              </p>
                            ) : null}
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
                  const container = document.querySelector('.best-sellers-carousel')
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
                  const container = document.querySelector('.best-sellers-carousel')
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
      )}

      {/* SECCIÓN SOCIAL: OPINIONES Y COMUNIDAD FUDDIES */}
      {recentReviews.length > 0 && (
        <section className="py-6 bg-white border-b border-gray-100">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl sm:text-2xl font-black text-gray-900 tracking-tight leading-none">
                    Fuddiverso
                  </h2>
                  <span className="bg-red-50 text-[#aa1918] border border-red-100 text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#aa1918] animate-pulse"></span>
                    En vivo
                  </span>
                </div>
                <p className="text-xs font-medium text-gray-500 mt-1 leading-relaxed">
                  Opiniones y fotos reales compartidas por nuestra comunidad.
                </p>
              </div>
              <Link
                href="/fuddiverso"
                className="inline-flex items-center gap-1 text-xs font-bold text-[#aa1918] hover:text-[#8a1413] bg-red-50/80 hover:bg-red-100/80 px-3 py-1.5 rounded-xl transition-all flex-shrink-0"
              >
                <span>Ver todo</span>
                <i className="bi bi-arrow-right text-xs"></i>
              </Link>
            </div>

            <div className="relative">
              <div className="flex gap-4 overflow-x-auto scrollbar-hide pb-4 recent-reviews-carousel">
                {recentReviews.map((review) => {
                  const reviewLink = review.businessUsername 
                    ? `/${review.businessUsername}` 
                    : (review.businessId ? `/restaurant/${review.businessId}` : '/fuddiverso')

                  return (
                    <div
                      key={review.id}
                      onClick={() => {
                        router.push(`/fuddiverso?post=${encodeURIComponent(review.id)}`)
                      }}
                      onMouseEnter={() => {
                        router.prefetch(`/fuddiverso?post=${encodeURIComponent(review.id)}`)
                      }}
                      onTouchStart={() => {
                        router.prefetch(`/fuddiverso?post=${encodeURIComponent(review.id)}`)
                      }}
                      className="flex-shrink-0 w-72 sm:w-80 bg-gray-50/80 hover:bg-white rounded-2xl p-4 transition-all duration-300 border border-gray-100/80 hover:border-red-200 hover:shadow-lg flex flex-col justify-between cursor-pointer group"
                    >
                      <div>
                        {/* Cabecera: Usuario > Tienda / Fecha | Calificación */}
                        <div className="flex items-start gap-2.5 mb-2.5">
                          {/* Avatar del Cliente */}
                          <div className="w-9 h-9 rounded-full bg-amber-100/80 text-amber-800 font-black text-xs flex items-center justify-center border border-amber-200/60 flex-shrink-0 overflow-hidden mt-0.5">
                            {review.clientPhotoURL ? (
                              <img
                                src={review.clientPhotoURL}
                                alt={review.clientName || 'Cliente'}
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                  (e.currentTarget as HTMLElement).style.display = 'none'
                                }}
                              />
                            ) : (
                              <span>{review.clientName?.charAt(0)?.toUpperCase() || 'C'}</span>
                            )}
                          </div>

                          <div className="min-w-0 flex-1">
                            {/* Línea 1: Nombre del usuario > Nombre de la tienda */}
                            <p className="text-xs leading-tight truncate">
                              <span className="font-black text-gray-900">{review.clientName || 'Cliente'}</span>
                              <span className="mx-1.5 text-gray-300 font-medium">›</span>
                              <Link
                                href={reviewLink}
                                onClick={(e) => e.stopPropagation()}
                                className="font-bold text-gray-600 hover:text-[#aa1918] transition-colors"
                              >
                                {review.businessName ? formatBusinessName(review.businessName) : 'Tienda'}
                              </Link>
                            </p>

                            {/* Línea 2: Fecha de publicación | Calificación */}
                            <div className="flex items-center gap-0 mt-1">
                              <span className="text-[10px] text-gray-400 font-medium">
                                {review.createdAt ? formatRelativeTime(review.createdAt) : 'Reciente'}
                              </span>
                              <span className="mx-1.5 text-gray-300 text-[10px]">|</span>
                              <div className="flex items-center gap-0.5">
                                <Star size={11} className="fill-amber-400 text-amber-400 flex-shrink-0" />
                                <span className="text-[10px] font-black text-amber-700 leading-none">
                                  {typeof review.rating === 'number' && review.rating > 0 ? review.rating.toFixed(1) : '5.0'}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Comentario */}
                        {review.comment && (
                          <p className="text-xs font-medium text-gray-700 line-clamp-3 leading-relaxed mb-3">
                            "{review.comment}"
                          </p>
                        )}

                        {/* Foto si tiene con Chip del Producto SUPERPUESTO */}
                        {review.image ? (
                          <div className="relative aspect-[4/3] w-full rounded-2xl overflow-hidden mb-1 bg-gray-100 group/img">
                            <img
                              src={review.image}
                              alt="Foto de reseña"
                              loading="lazy"
                              className="w-full h-full object-cover group-hover/img:scale-105 transition-transform duration-500"
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent pointer-events-none" />
                            
                            {/* Info del Producto/Tienda Superpuesta sobre la imagen (sin fondo) */}
                            <div className="absolute bottom-2 left-2 right-2 z-10">
                              <div className="w-full text-left flex items-center justify-between gap-2 p-1 text-white group/chip transition-opacity hover:opacity-90">
                                <div className="flex items-center gap-2 min-w-0">
                                  {review.productImage || review.businessLogo ? (
                                    <div className="w-6 h-6 rounded-lg overflow-hidden flex-shrink-0 border border-white/40 shadow-xs">
                                      <img
                                        src={review.productImage || review.businessLogo}
                                        alt={review.productName || review.businessName || 'Producto'}
                                        className="w-full h-full object-cover"
                                        onError={(e) => {
                                          const target = e.currentTarget
                                          if (review.businessLogo && target.src !== review.businessLogo) {
                                            target.src = review.businessLogo
                                          } else {
                                            target.style.display = 'none'
                                          }
                                        }}
                                      />
                                    </div>
                                  ) : (
                                    <div className="w-6 h-6 rounded-lg bg-red-600 text-white flex items-center justify-center text-xs flex-shrink-0 shadow-xs">
                                      <i className="bi bi-shop"></i>
                                    </div>
                                  )}
                                  <div className="min-w-0 drop-shadow-sm">
                                    <p className="text-[11px] font-bold text-white line-clamp-1 group-hover/chip:underline decoration-white/60 leading-none">
                                      {review.productName || (review.businessName ? formatBusinessName(review.businessName) : 'Ver tienda')}
                                    </p>
                                    {review.productName && review.businessName && (
                                      <p className="text-[9px] font-medium text-white/90 line-clamp-1 mt-0.5">
                                        en {formatBusinessName(review.businessName)}
                                      </p>
                                    )}
                                  </div>
                                </div>
                                <i className="bi bi-chevron-right text-[11px] text-white/90 group-hover/chip:translate-x-0.5 transition-transform drop-shadow-xs"></i>
                              </div>
                            </div>
                          </div>
                        ) : null}
                      </div>

                      {/* Chip del Producto / Tienda (solo cuando NO hay imagen) */}
                      {!review.image && (
                        <div className="pt-2 border-t border-gray-200/60 mt-auto">
                          <div className="w-full text-left flex items-center justify-between gap-2 p-1.5 rounded-xl bg-white hover:bg-gray-100/80 transition-colors border border-gray-100 group">
                            <div className="flex items-center gap-2 min-w-0">
                              {review.productImage || review.businessLogo ? (
                                <div className="w-6 h-6 rounded-lg overflow-hidden flex-shrink-0 bg-gray-50 border border-gray-100">
                                  <img
                                    src={review.productImage || review.businessLogo}
                                    alt={review.productName || review.businessName || 'Producto'}
                                    className="w-full h-full object-cover"
                                    onError={(e) => {
                                      const target = e.currentTarget
                                      if (review.businessLogo && target.src !== review.businessLogo) {
                                        target.src = review.businessLogo
                                      } else {
                                        target.style.display = 'none'
                                      }
                                    }}
                                  />
                                </div>
                              ) : (
                                <div className="w-full h-full flex items-center justify-center bg-red-50 text-[#aa1918] text-xs flex-shrink-0">
                                  <i className="bi bi-shop"></i>
                                </div>
                              )}
                              <div className="min-w-0">
                                <p className="text-[11px] font-bold text-gray-800 line-clamp-1 group-hover:text-[#aa1918] transition-colors leading-none">
                                  {review.productName || (review.businessName ? formatBusinessName(review.businessName) : 'Ver tienda')}
                                </p>
                                {review.productName && review.businessName && (
                                  <p className="text-[9px] font-medium text-gray-400 line-clamp-1 mt-0.5">
                                    en {formatBusinessName(review.businessName)}
                                  </p>
                                )}
                              </div>
                            </div>
                            <i className="bi bi-chevron-right text-[10px] text-gray-400 group-hover:text-[#aa1918] group-hover:translate-x-0.5 transition-all"></i>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}

                {/* Tarjeta final "Únete a la comunidad" */}
                <div className="flex-shrink-0 w-64 bg-gradient-to-br from-red-500 to-[#aa1918] rounded-2xl p-5 text-white flex flex-col justify-between shadow-sm">
                  <div>
                    <div className="w-10 h-10 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center text-white text-lg mb-3">
                      <i className="bi bi-chat-heart-fill"></i>
                    </div>
                    <h4 className="text-base font-black tracking-tight leading-snug mb-1">
                      ¿Probaste algo rico?
                    </h4>
                    <p className="text-xs text-red-100 font-medium leading-relaxed">
                      Comparte tu foto y reseña con miles de personas en Fuddiverso.
                    </p>
                  </div>
                  <Link
                    href="/fuddiverso"
                    className="mt-4 w-full py-2.5 px-4 bg-white text-[#aa1918] hover:bg-red-50 font-black text-xs rounded-xl text-center transition-all shadow-sm active:scale-95 flex items-center justify-center gap-1.5"
                  >
                    <span>Publicar opinión</span>
                    <i className="bi bi-plus-circle-fill text-xs"></i>
                  </Link>
                </div>
              </div>

              {/* Flechas de navegación para desktop */}
              <button
                onClick={() => {
                  const container = document.querySelector('.recent-reviews-carousel')
                  if (container) {
                    container.scrollLeft -= 300
                  }
                }}
                className="hidden sm:flex absolute left-0 top-1/2 -translate-y-1/2 -translate-x-4 w-9 h-9 bg-white rounded-full shadow-md items-center justify-center text-gray-700 hover:bg-gray-50 transition-all z-10 border border-gray-100"
                aria-label="Anterior"
              >
                <i className="bi bi-chevron-left text-sm"></i>
              </button>
              <button
                onClick={() => {
                  const container = document.querySelector('.recent-reviews-carousel')
                  if (container) {
                    container.scrollLeft += 300
                  }
                }}
                className="hidden sm:flex absolute right-0 top-1/2 -translate-y-1/2 translate-x-4 w-9 h-9 bg-white rounded-full shadow-md items-center justify-center text-gray-700 hover:bg-gray-50 transition-all z-10 border border-gray-100"
                aria-label="Siguiente"
              >
                <i className="bi bi-chevron-right text-sm"></i>
              </button>
            </div>
          </div>
        </section>
      )}

      {/* LISTA DE RESTAURANTES */}
      <section className="py-2 bg-gray-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between gap-3 mb-5">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-xl sm:text-2xl font-black text-gray-900 tracking-tight leading-none">
                  Restaurantes
                </h2>
                <span className="bg-red-50 text-[#aa1918] border border-red-100 text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full">
                  Tiendas
                </span>
              </div>
            </div>
            <Link
              href="/business/register"
              className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[#aa1918] hover:text-white bg-red-50 hover:bg-[#aa1918] px-3 py-1.5 rounded-xl transition-all border border-red-100 flex-shrink-0"
            >
              <i className="bi bi-plus-circle text-xs"></i>
              <span>Publica tu menú</span>
            </Link>
          </div>

          {loading || loadingProducts ? (
            <div className="text-center py-16">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#aa1918] mx-auto"></div>
              <p className="mt-4 text-gray-600">Cargando restaurantes...</p>
            </div>
          ) : sortedRestaurants.length === 0 ? (
            <div className="max-w-xl mx-auto py-12 px-6 bg-white rounded-3xl shadow-sm border border-gray-100 text-center">
              <i className="bi bi-shop text-4xl text-gray-300 mb-3 block"></i>
              <h3 className="text-lg font-black text-gray-900 mb-1">No se encontraron restaurantes</h3>
              <p className="text-xs font-medium text-gray-500">Intenta con otra búsqueda o categoría.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-8 sm:gap-10">
              {sortedRestaurants.map((b) => {
                const link = b.username ? `/${b.username}` : `/restaurant/${b.id}`
                const followed = followedBusinesses.has(b.id)
                const products = productsByBusiness[b.id] || []

                return (
                  <div key={b.id} className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                    {/* Header del Restaurante Compacto */}
                    <div className="flex items-center justify-between gap-2.5 mb-2 px-0.5">
                      <Link href={link} className="flex items-center gap-2.5 min-w-0 flex-1 group">
                        <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-full overflow-hidden border border-gray-200/80 shadow-xs bg-gray-50 flex-shrink-0 group-hover:scale-105 transition-transform duration-200">
                          {b.image ? (
                            <img
                              src={b.image}
                              alt={b.name}
                              loading="lazy"
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <i className="bi bi-shop text-lg text-gray-300"></i>
                            </div>
                          )}
                        </div>
                        
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <h3 className="text-sm sm:text-base font-black text-gray-900 line-clamp-1 group-hover:text-[#aa1918] transition-colors tracking-tight leading-none">
                              {formatBusinessName(b.name)}
                            </h3>
                            {isStoreOpen(b) ? (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider flex-shrink-0 bg-emerald-50 text-emerald-700 border border-emerald-100">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                Abierto
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold tracking-tight flex-shrink-0 bg-rose-50 text-rose-700 border border-rose-100">
                                <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" />
                                <span>{getNextOpeningMessage(b) || 'Cerrado'}</span>
                              </span>
                            )}
                          </div>

                          {b.description && (
                            <p className="text-[11px] font-medium text-gray-500 line-clamp-1 leading-tight">
                              {b.description}
                            </p>
                          )}

                          {/* Estrellas compacto */}
                          <div className="flex items-center leading-none">
                            {b.ratingAverage ? (
                              <button
                                onClick={(e) => {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  handleOpenRatingModal(b)
                                }}
                                className="flex items-center gap-1 hover:opacity-80 transition-opacity"
                              >
                                <StarRating rating={b.ratingAverage} size="sm" showRatingText={false} />
                                <span className="text-[11px] font-bold text-gray-600 ml-0.5">
                                  {b.ratingAverage.toFixed(1)}
                                </span>
                                <span className="text-[10px] text-gray-400">
                                  ({b.ratingCount || 0})
                                </span>
                              </button>
                            ) : (
                              <button
                                onClick={(e) => {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  handleOpenRatingModal(b)
                                }}
                                className="flex items-center gap-1 hover:opacity-80 transition-opacity text-[10px] font-medium text-gray-400"
                              >
                                <StarRating rating={0} size="sm" showGrayStars showRatingText={false} />
                                <span className="ml-0.5">Sin opiniones</span>
                              </button>
                            )}
                          </div>
                        </div>
                      </Link>

                      <div className="flex items-center flex-shrink-0">
                        <button
                          onClick={(e) => handleFollowToggle(b.id, e)}
                          className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                            followed
                              ? 'bg-red-50 text-[#aa1918]'
                              : 'bg-gray-50 text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                          }`}
                          aria-label="Seguir tienda"
                        >
                          <i className={`bi bi-heart${followed ? '-fill' : ''} text-sm`}></i>
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
                                    style={{ objectPosition: getDampenedImagePosition(product.imagePosition) }}
                                  />
                                ) : (
                                  <div className="w-full h-full bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
                                    <i className="bi bi-bag text-3xl text-gray-300"></i>
                                  </div>
                                )}
                                {product.price > 0 && (
                                  <div className="absolute top-3 right-3 bg-[#aa1918] text-white px-2 py-1 rounded-full text-xs font-bold shadow-sm">
                                    {formatPrice(getProductPublicPrice(product, b))}
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
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={generatedReferralProducts.has(product.id) ? '#F59E0B' : 'currentColor'} strokeWidth={generatedReferralProducts.has(product.id) ? 3 : 1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" /></svg>
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
            <div className="flex justify-between items-end mb-8 flex-wrap gap-4">
              <div>
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h2 className="text-2xl sm:text-3xl font-black text-gray-900 tracking-tight leading-none">
                    Proveedores Aliados
                  </h2>
                  <span className="bg-orange-50 text-orange-700 border border-orange-100 text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full">
                    B2B
                  </span>
                </div>
                <p className="text-xs font-medium text-gray-500 mt-1.5 leading-relaxed">
                  Distribuidores e insumos directos para negocios
                </p>
              </div>
              <span className="text-[10px] font-black text-gray-500 uppercase tracking-wider bg-gray-100 px-3 py-1 rounded-full">
                {sortedDistributors.length} aliados
              </span>
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
                          <h3 className="text-lg font-black text-gray-900 uppercase tracking-tighter leading-none mb-1 group-hover/header:text-orange-600 transition-colors">
                            {formatBusinessName(b.name)}
                          </h3>
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
                                  <ProgressiveImage src={product.image} alt={product.name} fill sizes="(max-width: 640px) 144px, 176px" className="object-cover group-hover/product:scale-110 transition-transform duration-500" style={{ objectPosition: product.imagePosition || 'center' }} />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-gray-200 bg-gray-50">
                                    <i className="bi bi-box text-5xl"></i>
                                  </div>
                                )}
                                {product.price > 0 && (
                                  <div className="absolute top-3 right-3 bg-white/90 backdrop-blur-md text-gray-900 px-3 py-1 rounded-full text-[10px] font-black shadow-sm ring-1 ring-black/5">
                                    {formatPrice(getProductPublicPrice(product, b))}
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
                    <h4 className="text-white text-sm font-bold leading-none">{formatBusinessName(selectedStoryBusiness.name)}</h4>
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
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={generatedReferralProducts.has(storyProducts[currentStoryIndex].id) ? 3 : 1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" /></svg>
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

      {/* Modals & Sidebars */}
      {(hasOpenedProductSidebar || isProductSidebarOpen) && (
        <ProductDetailSidebar
          isOpen={isProductSidebarOpen}
          onClose={() => setIsProductSidebarOpen(false)}
          product={selectedProduct}
          business={selectedProductBusiness}
          onProductSelect={handleProductClick}
          onOpenCart={() => setIsCartOpen(true)}
          onGenerateReferral={selectedProduct && selectedProductBusiness ? () => handleGenerateReferral(selectedProduct, selectedProductBusiness) : undefined}
          hasRecommended={selectedProduct ? generatedReferralProducts.has(selectedProduct.id) : false}
          referralCount={selectedProduct ? referralCounts[selectedProduct.id] : undefined}
          onOpenRatingModal={() => {
            if (selectedProductBusiness) {
              setSelectedRatingBusiness(selectedProductBusiness)
              setIsRatingModalOpen(true)
            }
          }}
        />
      )}

      {isStoryPaused && (
        <StoryProductDetail
          isOpen={true}
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
      )}

      {isCartOpen && (
        <CartSidebar
          isOpen={true}
          onClose={() => setIsCartOpen(false)}
          cart={cart}
          business={selectedProductBusiness}
          removeFromCart={removeFromCart}
          updateQuantity={updateQuantity}
          clearCart={clearCart}
          addItemToCart={addItemToCart}
          onShowProductDetails={(p: Product) => handleProductClick(p, selectedProductBusiness || undefined)}
        />
      )}

      {referralModalOpen && (
        <ReferralModal
          isOpen={true}
          onClose={() => setReferralModalOpen(false)}
          product={selectedProductForReferral}
          referralLink={generatedReferralLink}
          businessName={referralBusinessName}
          businessId={selectedProductBusiness?.id}
          businessUsername={selectedProductBusiness?.username}
          productSlug={selectedProductForReferral?.slug}
        />
      )}

      {showLoginModal && (
        <ClientLoginModal
          isOpen={true}
          onClose={() => setShowLoginModal(false)}
          onLoginSuccess={() => setShowLoginModal(false)}
        />
      )}

      {/* Rating Modal */}
      {isRatingModalOpen && selectedRatingBusiness && (
        <StoreRatingModal
          isOpen={true}
          onClose={() => setIsRatingModalOpen(false)}
          business={selectedRatingBusiness}
          clientPhone={null}
          clientUser={user}
          businessUser={null}
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
