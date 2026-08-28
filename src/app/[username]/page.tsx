'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { getProductPublicPrice, formatPrice, getPriceMetadata, getPackagingFee } from '@/lib/price-utils'
import { Business, Product, QRCode, UserQRProgress } from '@/types'
import { getProductsByBusiness, getProductsByIds, getBusinessesByIds, incrementVisitFirestore, getQRCodesByBusiness, getUserQRProgress, redeemQRCodePrize, unredeemQRCodePrize, generateReferralLink, trackReferralClick, userHasReferralForProduct, getProductsReferralCounts, getBranchesForBusiness, getIngredientStockSummary, IngredientStockSummary } from '@/lib/database'
import { evaluateProductStock, isProductEffectivelyAvailable } from '@/lib/stock-utils'
import { collection, query, where, onSnapshot, doc, limit, getDocs, orderBy } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { isStoreOpen, getNextOpeningMessage } from '@/lib/store-utils'
import { useAuth } from '@/contexts/AuthContext'
import StarRating from '@/components/StarRating'
import dynamic from 'next/dynamic'

const CartSidebar = dynamic(() => import('@/components/CartSidebar'), { ssr: false })
const LocationMap = dynamic(() => import('@/components/LocationMap'), { ssr: false })
const CheckoutContent = dynamic(() => import('@/components/CheckoutContent').then(m => m.CheckoutContent), { ssr: false })
const UserSidebar = dynamic(() => import('@/components/UserSidebar'), { ssr: false })
const ClientLoginModal = dynamic(() => import('@/components/ClientLoginModal'), { ssr: false })
const StoreRatingModal = dynamic(() => import('@/components/StoreRatingModal'), { ssr: false })
const ReferralModal = dynamic(() => import('@/components/ReferralModal'), { ssr: false })
const ProductDetailSidebar = dynamic(() => import('@/components/ProductDetailSidebar'), { ssr: false })

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
      "streetAddress": business.pickupSettings?.references || '',
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
      "ratingValue": (business.ratingAverage || 5.0).toString(),
      "reviewCount": (business.ratingCount || 10).toString()
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

function getMinVariantPrice(variants: any[], biz: any): number {
  if (!variants || !Array.isArray(variants) || variants.length === 0) return 0
  const available = variants.filter((v: any) => v.isAvailable !== false)
  const list = available.length > 0 ? available : variants
  const prices = list.map((v: any) => getProductPublicPrice(v, biz)).filter(p => !Number.isNaN(p) && p > 0)
  return prices.length > 0 ? Math.min(...prices) : 0
}

function ProductVariantSelector({ product, onAddToCart, onShowDetails, getCartItemQuantity, updateQuantity, businessImage, businessUsername, onGenerateReferral, hasRecommended, referralCount, business }: {
  product: any,
  onAddToCart: (item: any) => void,
  onShowDetails: (product: any) => void,
  getCartItemQuantity: (id: string, variantName?: string | null) => number,
  updateQuantity: (id: string, quantity: number, variantName?: string | null) => void,
  businessImage?: string,
  businessUsername?: string,
  onGenerateReferral: (product: any) => void,
  hasRecommended?: boolean,
  referralCount?: number,
  business?: any
}) {
  const [imgLoaded, setImgLoaded] = useState(false)
  const [showFeeTooltip, setShowFeeTooltip] = useState(false)
  const handleCardClick = () => onShowDetails(product)

  const hasVariants = Boolean(product.variants && Array.isArray(product.variants) && product.variants.length > 0)
  const isCombo = product.isCombo === true
  const hasOptions = Boolean(product.optionGroups && Array.isArray(product.optionGroups) && product.optionGroups.length > 0)
  const quantity = (hasVariants || isCombo || hasOptions) ? 0 : getCartItemQuantity(product.id, null)
  const publicPrice = getProductPublicPrice(product, business)
  const displayPrice = hasVariants ? getMinVariantPrice(product.variants, business) : publicPrice

  return (
    <div
      onClick={handleCardClick}
      className={`group relative flex items-center bg-white p-4 rounded-2xl border transition-all duration-300 cursor-pointer active:scale-[0.98] ${
        quantity > 0 ? 'border-red-200 shadow-md ring-1 ring-red-50' : 'border-gray-100 shadow-sm hover:shadow-md hover:border-red-100'
      }`}
    >
      {/* Botón de recomendar */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          onGenerateReferral(product)
        }}
        className={`absolute top-3 right-3 flex items-center gap-1 z-10 transition-all ${
          hasRecommended
            ? 'text-amber-500'
            : 'text-gray-400 hover:text-amber-500 hover:bg-gray-50 rounded-lg p-1'
        }`}
        title="Recomendar"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={hasRecommended ? '#F59E0B' : 'currentColor'} strokeWidth={hasRecommended ? 3 : 1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" /></svg>
        {referralCount !== undefined && referralCount > 0 && (
          <span className="text-[10px] font-bold text-gray-500">
            {referralCount}
          </span>
        )}
      </button>

      {/* Imagen del producto */}
      <div className="w-20 h-20 sm:w-24 sm:h-24 flex-shrink-0 rounded-xl overflow-hidden bg-gray-50 relative border border-gray-50 hover:opacity-90 transition-opacity">
        <div className={`absolute inset-0 animate-pulse bg-gray-100 ${imgLoaded ? 'hidden' : 'block'}`}></div>
        <img
          src={product.image || businessImage}
          alt={product.name}
          className="w-full h-full object-cover transition-transform duration-500 md:group-hover:scale-110"
          style={{ 
            objectPosition: product.imagePosition || 'center',
            transformOrigin: product.imagePosition || 'center',
            transform: product.imageScale && product.imageScale > 1 ? `scale(${product.imageScale})` : undefined
          }}
          loading="lazy"
          decoding="async"
          onLoad={() => setImgLoaded(true)}
          onError={(e) => {
            const target = e.target as HTMLImageElement;
            if (target.src !== (businessImage || '')) {
              target.src = businessImage || '';
            }
            setImgLoaded(true)
          }}
        />
      </div>

      {/* Info Content */}
      <div className="flex-1 min-w-0 ml-4 pr-4">
        <div className="flex flex-col h-full justify-between">
          <div>
            {product.isShared && product.originalBusinessName && (
              <div className="flex items-center gap-1.5 text-[10px] font-black text-amber-600 bg-amber-50 rounded-full px-2.5 py-1 w-max mb-1.5 border border-amber-100 shadow-sm leading-none">
                {product.originalBusinessImage ? (
                  <img
                    src={product.originalBusinessImage}
                    alt={product.originalBusinessName}
                    className="w-3.5 h-3.5 rounded-full object-cover border border-amber-200/60 shadow-inner flex-shrink-0"
                  />
                ) : (
                  <i className="bi bi-share-fill text-[8px] animate-pulse"></i>
                )}
                <span>DE: {product.originalBusinessName.toUpperCase()}</span>
              </div>
            )}
            <h4 className="font-bold text-base sm:text-lg text-gray-900 group-hover:text-red-600 transition-colors leading-tight line-clamp-2">
              {product.name}
              {isCombo && (
                <span className="inline-flex items-center ml-2 px-1.5 py-0.5 bg-orange-100 text-orange-600 text-[8px] font-black uppercase tracking-widest rounded-md align-middle">
                  Combo
                </span>
              )}
            </h4>
            <p className="text-gray-500 text-xs sm:text-sm mt-1 line-clamp-2 leading-snug">
              {product.description}
            </p>
          </div>

          <div className="mt-2 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              {hasVariants && (
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">Desde</span>
              )}
              <span className="text-base sm:text-xl font-black text-red-500 tracking-tight">
                {formatPrice(displayPrice)}
              </span>
            </div>

            {/* Selector de cantidad compacto o botón añadir */}
            {quantity > 0 ? (
              <div
                className="flex items-center bg-gray-100 rounded-lg p-1 gap-1"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={() => updateQuantity(product.id, quantity - 1, null)}
                  className="w-7 h-7 flex items-center justify-center bg-white rounded-md text-gray-600 shadow-sm hover:text-red-500 transition-colors"
                >
                  <i className="bi bi-dash"></i>
                </button>
                <span className="w-6 text-center font-bold text-sm text-gray-900">{quantity}</span>
                <button
                  onClick={() => updateQuantity(product.id, quantity + 1, null)}
                  className="w-7 h-7 flex items-center justify-center bg-white rounded-md text-gray-600 shadow-sm hover:text-emerald-600 transition-colors"
                >
                  <i className="bi bi-plus"></i>
                </button>
              </div>
            ) : (
              <div
                className="w-8 h-8 rounded-full bg-gray-900 text-white flex items-center justify-center shadow-lg transform md:group-hover:scale-110 md:group-hover:bg-red-600 transition-all duration-300"
                onClick={(e) => {
                  e.stopPropagation();
                  if (!hasVariants && !isCombo && !hasOptions) {
                    onAddToCart(product);
                  } else {
                    onShowDetails(product);
                  }
                }}
              >
                <i className="bi bi-plus-lg text-sm"></i>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function RestaurantPage() {
  return <RestaurantContent />
}

function RestaurantContent() {
  const { user: clientUser } = useAuth()
  const params = useParams()
  const username = typeof params?.username === 'string' ? params.username : Array.isArray(params?.username) ? params.username[0] : ''

  const [business, setBusiness] = useState<Business | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cart, setCart] = useState<any[]>([])
  const [isCartOpen, setIsCartOpen] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState<any>(null)
  const [isVariantModalOpen, setIsVariantModalOpen] = useState(false)

  // Abrir producto automáticamente si viene en el query parameter "open"
  useEffect(() => {
    if (products && products.length > 0) {
      const params = new URLSearchParams(window.location.search);
      const openSlug = params.get('open');
      if (openSlug) {
        const prod = products.find(p => p.slug === openSlug || p.id === openSlug);
        if (prod) {
          setSelectedProduct(prod);
          setIsVariantModalOpen(true);
          // Limpiar el parámetro 'open' de la URL para evitar reabrir al recargar
          const newUrl = window.location.pathname;
          window.history.replaceState({}, '', newUrl);
        }
      }
    }
  }, [products]);
  const [clientPhone, setClientPhone] = useState<string | null>(null)
  const [qrCodes, setQrCodes] = useState<QRCode[]>([])
  const [qrProgress, setQrProgress] = useState<UserQRProgress | null>(null)
  const [redeemingQrId, setRedeemingQrId] = useState<string | null>(null)
  const [notification, setNotification] = useState<{ show: boolean; message: string; type: 'success' | 'error' }>(
    {
      show: false,
      message: '',
      type: 'success'
    }
  )
  const [premioAgregado, setPremioAgregado] = useState(false)
  const [coverLoaded, setCoverLoaded] = useState(false)
  const [logoLoaded, setLogoLoaded] = useState(false)
  const [activeTab, setActiveTab] = useState<'catalogo' | 'perfil'>('catalogo')
  const [isUserSidebarOpen, setIsUserSidebarOpen] = useState(false)
  const [showLoginModal, setShowLoginModal] = useState(false)
  const [otherBusinesses, setOtherBusinesses] = useState<Business[]>([])
  const [showHeaderFeeTooltip, setShowHeaderFeeTooltip] = useState(false)

  // Estados para sistema de referidos
  const [referralModalOpen, setReferralModalOpen] = useState(false)
  const [selectedProductForReferral, setSelectedProductForReferral] = useState<any>(null)
  const [generatedReferralLink, setGeneratedReferralLink] = useState<string>('')
  const [referralCode, setReferralCode] = useState<string | null>(null)
  const [generatedReferralProducts, setGeneratedReferralProducts] = useState<Set<string>>(new Set())
  const [referralCounts, setReferralCounts] = useState<Record<string, number>>({})
  const [isRatingModalOpen, setIsRatingModalOpen] = useState(false)
  const [isOwner, setIsOwner] = useState(false)
  const [branches, setBranches] = useState<Business[]>([])
  const [showBranchModal, setShowBranchModal] = useState(false)

  // Cargar sucursales de la marca si existen
  useEffect(() => {
    if (!business?.id) return
    getBranchesForBusiness(business.id)
      .then(list => setBranches(list))
      .catch(err => console.error('Error loading branches in store:', err))
  }, [business?.id])

  // Lightweight isOwner check from localStorage — avoids loading Firebase Auth SDK for all visitors
  useEffect(() => {
    if (!business) return
    try {
      const savedOwnerId = localStorage.getItem('ownerId')
      if (savedOwnerId) {
        setIsOwner(
          business.ownerId === savedOwnerId ||
          business.administrators?.some(a => a.uid === savedOwnerId) || false
        )
      }
    } catch { /* ignore */ }
  }, [business])


  // Track whether products have been loaded for this username to avoid re-fetching on real-time updates
  const productsLoadedRef = useRef(false)

  useEffect(() => {
    if (!username) return

    productsLoadedRef.current = false

    // Use onSnapshot as the SINGLE source of truth for business data.
    // The first snapshot acts as the initial load; subsequent snapshots provide real-time updates.
    // This eliminates the duplicate read from getBusinessByUsername + onSnapshot.
    const q = query(
      collection(db, 'businesses'),
      where('username', '==', username),
      limit(1)
    )

    const unsubscribe = onSnapshot(q, async (snapshot) => {
      if (snapshot.empty) {
        setError('Restaurante no encontrado')
        setLoading(false)
        return
      }

      const docSnap = snapshot.docs[0]
      const businessData = docSnap.data()
      const updatedBusiness: Business = {
        id: docSnap.id,
        ...businessData,
        createdAt: businessData.createdAt?.toDate?.() || businessData.createdAt,
        updatedAt: businessData.updatedAt?.toDate?.() || businessData.updatedAt
      } as Business

      setBusiness(updatedBusiness)
      console.log('🏪 [onSnapshot Business Loaded]:', updatedBusiness?.name, {
        id: updatedBusiness?.id,
        hasPackagingFee: updatedBusiness?.hasPackagingFee,
        packagingFee: updatedBusiness?.packagingFee,
        calculatedFee: getPackagingFee(updatedBusiness)
      })

      // Only load products on the FIRST snapshot (initial load)
      if (productsLoadedRef.current) return
      productsLoadedRef.current = true

      try {
        // Handle visit increment (Non-blocking background call)
        try {
          const sessionKey = `visited:${updatedBusiness.id}`
          if (!sessionStorage.getItem(sessionKey)) {
            sessionStorage.setItem(sessionKey, '1')
            incrementVisitFirestore(updatedBusiness.id).catch(e => {
              const pendingRaw = localStorage.getItem('pendingVisits')
              const pending = pendingRaw ? JSON.parse(pendingRaw) : {}
              pending[updatedBusiness.id] = (pending[updatedBusiness.id] || 0) + 1
              localStorage.setItem('pendingVisits', JSON.stringify(pending))
              console.warn('Failed to increment visit in Firestore, stored pendingVisits locally')
            })
          }
        } catch (e) {
          console.error('Error handling visit increment:', e)
        }

        // Load products — parallelize own products + shared products
        const hasShared = updatedBusiness.sharedProductIds && updatedBusiness.sharedProductIds.length > 0
        const [productsData, sharedProducts] = await Promise.all([
          getProductsByBusiness(updatedBusiness.id),
          hasShared ? getProductsByIds(updatedBusiness.sharedProductIds!) : Promise.resolve([] as Product[])
        ])

        // Si algún producto tiene autoHideByStock o variantes con ingredientes, obtenemos el resumen de stock para filtrar
        const shouldCheckStock = productsData.some(p => p.autoHideByStock || (p.variants && p.variants.length > 0))
        const stockMap = new Map<string, IngredientStockSummary>()
        if (shouldCheckStock) {
          try {
            const stockSummary = await getIngredientStockSummary(updatedBusiness.id)
            stockSummary.forEach(item => {
              if (item.ingredientName) {
                stockMap.set(item.ingredientName.toLowerCase().trim(), item)
              }
            })
          } catch (e) {
            console.error('Error cargando stock de ingredientes en tienda pública:', e)
          }
        }

        const storePackagingFee = getPackagingFee(updatedBusiness)
        let availableProducts: any[] = productsData
          .filter(product => isProductEffectivelyAvailable(product, stockMap))
          .map(product => {
            const evaluation = evaluateProductStock(product, stockMap)
            // Si el producto tiene variantes, filtramos solo las que tienen stock disponible
            if (product.variants && product.variants.length > 0) {
              const availableVariantsList = product.variants
                .filter(v => {
                  const isAvailByStock = evaluation.availableVariants.some(av => av.id === v.id || av.name === v.name)
                  return isAvailByStock && v.isAvailable !== false
                })

              return {
                ...product,
                packagingFee: storePackagingFee,
                variants: availableVariantsList
              }
            }

            return {
              ...product,
              packagingFee: storePackagingFee
            }
          })

        // Process shared products if any were fetched
        if (sharedProducts.length > 0) {
          try {
            const ownerIds = Array.from(new Set(sharedProducts.map(p => p.businessId)))
            const ownerBizs = await getBusinessesByIds(ownerIds)
            const availableShared = sharedProducts
              .filter(p => {
                if (!p.isAvailable) return false
                const ownerBiz = ownerBizs.find(b => b.id === p.businessId)
                if (!ownerBiz) return false
                if (ownerBiz.isActive === false) return false
                return isStoreOpen(ownerBiz)
              })
              .map(p => {
                const ownerBiz = ownerBizs.find(b => b.id === p.businessId)
                return {
                  ...p,
                  category: 'Compartidos', // Forzar categoría Compartidos
                  isShared: true,
                  originalBusinessId: p.businessId,
                  originalBusinessName: ownerBiz?.name || 'Otra tienda',
                  originalBusinessImage: ownerBiz?.image || null
                }
              })
            availableProducts = [...availableProducts, ...availableShared]
          } catch (e) {
            console.error('Error processing shared products:', e)
          }
        }

        setProducts(availableProducts)
        setLoading(false)

        // Defer loading of non-critical background data: other businesses only
        setTimeout(() => {
          // Load other businesses with a LIMITED query instead of getAllBusinesses()
          const otherQ = query(
            collection(db, 'businesses'),
            where('isActive', '!=', false),
            limit(12)
          )
          getDocs(otherQ).then(snap => {
            const others = snap.docs
              .map(d => ({ id: d.id, ...d.data(), createdAt: d.data().createdAt?.toDate?.() || d.data().createdAt } as Business))
              .filter(b => b.username !== username && b.isHidden !== true && b.businessType !== 'distributor')
              .sort(() => 0.5 - Math.random())
              .slice(0, 4)
            setOtherBusinesses(others)
          }).catch(e => console.error('Error loading other businesses:', e))
        }, 100)
      } catch (err) {
        console.error('Error loading restaurant data:', err)
        setError('Error al cargar el restaurante')
        setLoading(false)
      }
    }, (error) => {
      console.error('Error listening to business updates:', error)
      setError('Error al cargar el restaurante')
      setLoading(false)
    })

    return () => unsubscribe()
  }, [username])

  useEffect(() => {
    try {
      const storedPhone = localStorage.getItem('loginPhone')
      setClientPhone(storedPhone)
    } catch {
      setClientPhone(null)
    }
  }, [])

  // Scrollbar hide — CSS rules are in globals.css, we just toggle the class
  useEffect(() => {
    document.documentElement.classList.add('store-page-no-scrollbar')
    document.body.classList.add('store-page-no-scrollbar')

    return () => {
      document.documentElement.classList.remove('store-page-no-scrollbar')
      document.body.classList.remove('store-page-no-scrollbar')
    }
  }, [])

  // Detectar código de referido en URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const ref = params.get('ref')

    if (ref) {
      // Guardar en localStorage
      localStorage.setItem('pendingReferral', ref)
      setReferralCode(ref)

      // Registrar click
      trackReferralClick(ref).catch(console.error)
    } else {
      // Verificar si hay un referido pendiente
      const pending = localStorage.getItem('pendingReferral')
      if (pending) {
        setReferralCode(pending)
      }
    }
  }, [])

  useEffect(() => {
    const loadQrData = async () => {
      if (!business?.id || !clientPhone) {
        setQrCodes([])
        setQrProgress(null)
        return
      }

      try {
        const [codes, progress] = await Promise.all([
          getQRCodesByBusiness(business.id, true),
          getUserQRProgress(clientPhone, business.id)
        ])
        setQrCodes(codes)
        setQrProgress(progress)
      } catch (e) {
        console.error('Error loading QR data:', e)
        setQrCodes([])
        setQrProgress(null)
      }
    }

    void loadQrData()
  }, [business?.id, clientPhone])

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
      const loadCartFromStorage = () => {
        const savedCarts = localStorage.getItem('carts')
        let businessCart = []
        if (savedCarts) {
          const allCarts = JSON.parse(savedCarts)
          businessCart = allCarts[business.id] || []
        }

        // Verificar si el premio ya está en el carrito
        const premioIndex = businessCart.findIndex((item: any) => item.id === 'premio-especial-auto')
        const tienePremio = premioIndex !== -1

        // Auto-agregar o actualizar premio según configuración dinámica
        if (business.rewardSettings?.enabled) {
          const currentRewardName = `🎁 ${business.rewardSettings.name}`
          const currentRewardDesc = business.rewardSettings.description || '¡Felicidades! Has reclamado tu premio especial gratis'
          const currentIngredients = business.rewardSettings.ingredients || []
          
          if (!tienePremio) {
            const premioEspecial = {
              id: 'premio-especial-auto',
              name: currentRewardName,
              variantName: null,
              productName: currentRewardName,
              description: currentRewardDesc,
              price: 0,
              isAvailable: true,
              esPremio: true,
              quantity: 1,
              image: business.image || 'https://via.placeholder.com/150?text=Premio',
              businessId: business.id,
              businessName: business.name,
              businessImage: business.image,
              ingredients: currentIngredients // Persistir ingredientes para consumo de stock
            }
            businessCart = [...businessCart, premioEspecial]
            updateCartInStorage(business.id, businessCart)
            setPremioAgregado(true)
          } else {
            // Verificar si el nombre, descripción o ingredientes cambiaron
            const existingPremio = businessCart[premioIndex]
            const nameChanged = existingPremio.name !== currentRewardName
            const descChanged = existingPremio.description !== currentRewardDesc
            const ingredientsChanged = JSON.stringify(existingPremio.ingredients || []) !== JSON.stringify(currentIngredients)

            if (nameChanged || descChanged || ingredientsChanged) {
              businessCart[premioIndex] = {
                ...existingPremio,
                name: currentRewardName,
                productName: currentRewardName,
                description: currentRewardDesc,
                ingredients: currentIngredients
              }
              updateCartInStorage(business.id, businessCart)
            }
            setPremioAgregado(true)
          }
        } else if (tienePremio) {
          // Si el premio estaba habilitado pero ahora está deshabilitado, quitarlo del carrito
          businessCart = businessCart.filter((item: any) => item.id !== 'premio-especial-auto')
          updateCartInStorage(business.id, businessCart)
          setPremioAgregado(false)
        } else {
          setPremioAgregado(false)
        }

        setCart(businessCart)
      }

      loadCartFromStorage()
      
      // Listen for storage changes and custom cart updates to sync state
      window.addEventListener('storage', loadCartFromStorage)
      window.addEventListener('cart-updated', loadCartFromStorage)
      window.addEventListener('pageshow', loadCartFromStorage)
      
      return () => {
        window.removeEventListener('storage', loadCartFromStorage)
        window.removeEventListener('cart-updated', loadCartFromStorage)
        window.removeEventListener('pageshow', loadCartFromStorage)
      }
    }
  }, [business?.id, business?.username, business?.rewardSettings])

  // Función para mostrar notificaciones temporales
  const showNotification = (message: string, type: 'success' | 'error' = 'success') => {
    setNotification({ show: true, message, type })
    setTimeout(() => {
      setNotification({ show: false, message: '', type: 'success' })
    }, 3000)
  }

  // Función para generar link de referido
  const handleGenerateReferral = async (product: any) => {
    if (!business?.id) return

    // Abrir modal de inmediato para máxima fluidez en la interfaz (0ms)
    setSelectedProductForReferral(product)
    setGeneratedReferralLink('')
    setReferralModalOpen(true)

    try {
      const { code, isNew } = await generateReferralLink(
        product.id,
        business.id,
        clientUser?.id || clientPhone || undefined,
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
      showNotification('Error al generar link de referido', 'error')
    }
  }

  // Prevenir scroll del body cuando hay modales o sidebars abiertos
  useEffect(() => {
    const isAnyModalOpen = isCartOpen || isUserSidebarOpen || showLoginModal || isVariantModalOpen || referralModalOpen
    if (isAnyModalOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }

    return () => {
      document.body.style.overflow = ''
    }
  }, [isCartOpen, isUserSidebarOpen, showLoginModal, isVariantModalOpen, referralModalOpen])

  // Cargar datos de referidos cuando el usuario inicia sesión después de que los productos ya están cargados
  useEffect(() => {
    const loadReferralData = async () => {
      if (!clientUser?.id || products.length === 0) return
      const productIds = products.map(p => p.id)
      const recommendedSet = new Set<string>()
      await Promise.all(
        productIds.map(async (productId) => {
          const hasReferral = await userHasReferralForProduct(clientUser.id, productId)
          if (hasReferral) recommendedSet.add(productId)
        })
      )
      setGeneratedReferralProducts(recommendedSet)
      const counts = await getProductsReferralCounts(productIds)
      setReferralCounts(counts)
    }
    loadReferralData()
  }, [clientUser?.id, products.length])

  const addToCart = (productInput: any) => {
    if (!business?.id) return;

    // Si el producto tiene variantes, abrir modal
    if (productInput.variants && productInput.variants.length > 0) {
      setSelectedProduct(productInput)
      setIsVariantModalOpen(true)
      return
    }

    const isCartAlready = Boolean(productInput.isCartItem || productInput.feeAlreadyApplied)
    const publicPrice = isCartAlready
      ? (typeof productInput.price === 'number' ? productInput.price : 0)
      : getProductPublicPrice(productInput, business)

    const priceMeta = isCartAlready
      ? getPriceMetadata(productInput)
      : getPriceMetadata(productInput, business)

    console.log('🛒 [addToCart] Adding product to cart:', {
      productName: productInput.name,
      isCartAlready,
      publicPrice,
      packagingFee: priceMeta.packagingFee,
      businessPackagingFee: getPackagingFee(business)
    })

    const cartItem = {
      id: productInput.id,
      name: productInput.name,
      variantName: null,
      productName: productInput.name,
      price: publicPrice,
      ...priceMeta,
      publicPrice: publicPrice,
      isCartItem: true,
      feeAlreadyApplied: true,
      image: productInput.image,
      description: productInput.description,
      isAvailable: productInput.isAvailable,
      scheduleAvailability: productInput.scheduleAvailability,
      businessId: business.id,
      businessName: business.name,
      businessImage: business.image,
      ...(productInput.isShared && {
        originalBusinessId: productInput.originalBusinessId,
        originalBusinessName: productInput.originalBusinessName,
        originalBusinessImage: productInput.originalBusinessImage
      })
    }

    const existingItem = cart.find(item => item.id === cartItem.id && item.variantName === cartItem.variantName)
    let newCart

    if (existingItem) {
      newCart = cart.map(item =>
        (item.id === cartItem.id && item.variantName === cartItem.variantName)
          ? { ...item, quantity: item.quantity + 1 }
          : item
      )
      showNotification(`Se agregó otra ${productInput.name} al carrito`)
    } else {
      newCart = [...cart, {
        ...cartItem,
        quantity: 1
      }]
      showNotification(`${productInput.name} agregado al carrito`)
    }

    setCart(newCart)
    updateCartInStorage(business.id, newCart)
    setIsCartOpen(true)
  }

  const addVariantToCart = (product: any) => {
    if (!business?.id) return;

    const existingItem = cart.find(item => item.id === product.id && item.variantName === product.variantName)
    let newCart

    if (existingItem) {
      newCart = cart.map(item =>
        (item.id === product.id && item.variantName === product.variantName)
          ? { ...item, quantity: item.quantity + 1 }
          : item
      )
      showNotification(`Se agregó otra ${product.name} al carrito`)
    } else {
      newCart = [...cart, {
        ...product,
        quantity: 1,
        // Garantizar que estos campos existan incluso si no vienen en el objeto product original
        isAvailable: product.isAvailable ?? true,
        scheduleAvailability: product.scheduleAvailability || null,
        businessId: business.id,
        businessName: business.name,
        businessImage: business.image,
        ...(product.isShared && {
          originalBusinessId: product.originalBusinessId,
          originalBusinessName: product.originalBusinessName,
          originalBusinessImage: product.originalBusinessImage
        })
      }]
      showNotification(`${product.name} agregado al carrito`)
    }

    setCart(newCart)
    updateCartInStorage(business.id, newCart)
    setIsCartOpen(true)
  }

  const removeFromCart = (productId: string, variantName?: string | null) => {
    if (!business?.id) return;

    // Verificar si el ítem a eliminar es un premio
    const itemToRemove = cart.find(item => item.id === productId && item.variantName === variantName)
    const isPremio = itemToRemove?.esPremio === true
    const qrCodeIdToUnredeem = itemToRemove?.qrCodeId || (typeof itemToRemove?.id === 'string' && itemToRemove.id.startsWith('premio-qr-')
      ? itemToRemove.id.replace('premio-qr-', '')
      : null)

    const newCart = cart.filter(item => !(item.id === productId && item.variantName === variantName))
    setCart(newCart)
    updateCartInStorage(business.id, newCart)

    // Si se eliminó un premio, permitir reclamarlo de nuevo
    if (isPremio) {
      setPremioAgregado(false)

      if (qrCodeIdToUnredeem && clientPhone) {
        void unredeemQRCodePrize(clientPhone, business.id, qrCodeIdToUnredeem)
          .then(() => getUserQRProgress(clientPhone, business.id))
          .then((p) => setQrProgress(p))
          .catch((e) => console.error('Error unredeeming QR prize after cart removal:', e))
      }
    }
  }

  const updateQuantity = (productId: string, quantity: number, variantName?: string | null) => {
    if (!business?.id) return;

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
    // Dispatch events for other components to update
    window.dispatchEvent(new Event('storage'))
    window.dispatchEvent(new Event('cart-updated'))
  }

  const clearCart = () => {
    setCart([])
    if (business?.id) {
      updateCartInStorage(business.id, [])
    }
  }

  const getCartItemQuantity = (productId: string, variantName?: string | null) => {
    const item = cart.find(item => item.id === productId && item.variantName === variantName)
    return item ? item.quantity : 0
  }

  const cartTotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0)
  const cartItemsCount = cart.filter(item => !item.esPremio).reduce((sum, item) => sum + item.quantity, 0)

  const addQrPrizeToCart = async (qrCode: QRCode) => {
    if (!business?.id) return
    if (!clientPhone) {
      showNotification('Inicia sesión para canjear tu tarjeta', 'error')
      return
    }
    if (!qrCode.prize?.trim()) {
      showNotification('Este código no tiene premio configurado', 'error')
      return
    }

    const premioId = `premio-qr-${qrCode.id}`
    const alreadyInCart = cart.some((item: any) => item.esPremio === true && item.id === premioId)
    if (alreadyInCart) {
      showNotification('Este premio ya está en tu carrito', 'error')
      return
    }

    setRedeemingQrId(qrCode.id)
    try {
      const result = await redeemQRCodePrize(clientPhone, business.id, qrCode.id)
      if (!result.success) {
        showNotification(result.message || 'No se pudo canjear el premio', 'error')
        return
      }

      const premioQr = {
        id: premioId,
        name: `🎁 ${qrCode.prize}`,
        variantName: null,
        productName: `🎁 ${qrCode.prize}`,
        description: `Premio canjeado por tarjeta: ${qrCode.name}`,
        price: 0,
        isAvailable: true,
        esPremio: true,
        quantity: 1,
        image: business.image || 'https://via.placeholder.com/150?text=Premio',
        businessId: business.id,
        businessName: business.name,
        businessImage: business.image,
        qrCodeId: qrCode.id
      }

      const newCart = [...cart, premioQr]
      setCart(newCart)
      updateCartInStorage(business.id, newCart)
      showNotification('Premio agregado al carrito', 'success')

      const refreshed = await getUserQRProgress(clientPhone, business.id)
      setQrProgress(refreshed)
    } catch (e) {
      console.error('Error redeeming QR prize:', e)
      showNotification('Error al canjear el premio', 'error')
    } finally {
      setRedeemingQrId(null)
    }
  }

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

  // Estado de carga simple sin skeletons estructurales
  if (loading || !business) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">Cargando tienda...</p>
      </div>
    )
  }

  const whatsappNumber = business.phone ? (business.phone.startsWith('0') ? '593' + business.phone.substring(1) : business.phone).replace(/\D/g, '') : ''
  const whatsappMessage = encodeURIComponent(`Hola ${business.name}, encontré tu tienda en https://fuddi.shop , me gustaría conocer tu menú`)
  const whatsappUrl = `https://wa.me/${whatsappNumber}?text=${whatsappMessage}`



  // Agrupar productos por categoría, respetando el orden definido en business.categories
  const productsByCategory: Record<string, Product[]> = {}

  // Primero, obtenemos todos los productos disponibles
  const availableProducts = products.filter(product => product.isAvailable)

  // Determinar el orden de las categorías (idéntico a ProductList.tsx)
  const categoryOrder = (() => {
    const master = business.categories || [];
    const fromProducts = Array.from(new Set(availableProducts.map(p => p.category).filter(Boolean))) as string[];
    const extras = fromProducts.filter(c => !master.includes(c));
    const list = [...master, ...extras];
    
    if (availableProducts.some(p => !p.category || p.category === 'Sin categoría') && !list.includes('Sin categoría')) {
      list.push('Sin categoría');
    }
    return list;
  })();

  // Creamos las categorías en el orden definido
  categoryOrder.forEach(category => {
    const categoryProducts = availableProducts
      .filter(p => {
        if (category === 'Sin categoría') return !p.category || p.category === 'Sin categoría';
        return p.category === category;
      })
      .sort((a, b) => {
        // Ordenar por 'order' (asc) y luego por 'createdAt' (desc)
        const orderA = a.order ?? 0
        const orderB = b.order ?? 0
        if (orderA !== orderB) return orderA - orderB

        const dateA = a.createdAt instanceof Date ? a.createdAt.getTime() : 0
        const dateB = b.createdAt instanceof Date ? b.createdAt.getTime() : 0
        return dateB - dateA
      })

    if (categoryProducts.length > 0) {
      productsByCategory[category] = categoryProducts
    }
  })

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Structured Data for SEO */}
      <BusinessStructuredData business={business} />

      {/* Hero Section sin skeletons */}
      <div className="bg-white shadow-sm">
        {/* Rating Modal — only mounted when open */}
        {isRatingModalOpen && (
          <StoreRatingModal
            isOpen={true}
            onClose={() => setIsRatingModalOpen(false)}
            business={business}
            clientPhone={clientPhone}
            clientUser={clientUser}
            businessUser={isOwner ? { uid: localStorage.getItem('ownerId') } : null}
            businessOwnerId={business?.ownerId || null}
            onSuccess={(msg) => showNotification(msg)}
          />
        )}

        {/* Portada con logo superpuesto */}
        <div className="relative w-full h-36 sm:h-48 bg-gray-200">
          {business.coverImage ? (
            <>
              <div className={`absolute inset-0 animate-pulse bg-gray-200 ${coverLoaded ? 'hidden' : 'block'}`}></div>
              <img
                src={business.coverImage}
                alt={`Portada de ${business.name}`}
                className="w-full h-full object-cover"
                loading="eager"
                decoding="async"
                onLoad={() => setCoverLoaded(true)}
                onError={() => setCoverLoaded(true)}
              />
            </>
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-orange-100 to-orange-200" />
          )}
          {/* Botón compartir eliminado de aquí para estar en las pestañas */}
          {/* Logo con estilo premium */}
          <div className="absolute left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2 z-10">
            {business.image && (
              <div className="relative">
                <div className="absolute inset-0 rounded-full bg-white/20 blur-md translate-y-1"></div>
                <img
                  src={business.image}
                  alt={business.name}
                  className="w-24 h-24 sm:w-32 sm:h-32 rounded-full border-[5px] border-white shadow-2xl object-cover relative z-10"
                  loading="eager"
                  decoding="async"
                  onLoad={() => setLogoLoaded(true)}
                  onError={() => setLogoLoaded(true)}
                />
              </div>
            )}
          </div>
        </div>

        {/* Contenido debajo de la portada - Diseño Premium */}
        <div className="max-w-3xl mx-auto px-4 pt-14 sm:pt-16 pb-6 text-center">
          <div className="flex flex-col items-center">
            <div className="w-full">
              <h1 className="text-3xl sm:text-4xl font-black text-gray-900 tracking-tight leading-tight mb-1">
                {business.name}
              </h1>
              <div 
                className="flex justify-center items-center gap-2 mb-3 cursor-pointer hover:opacity-80 transition-all active:scale-95 group"
                onClick={() => {
                  setIsRatingModalOpen(true);
                }}
              >
                <div className="flex items-center gap-1.5 bg-white/50 backdrop-blur-sm px-3 py-1 rounded-full border border-gray-100 shadow-sm group-hover:border-yellow-200 group-hover:bg-yellow-50/30 transition-all">
                  <StarRating rating={business.ratingAverage || 5.0} size="md" showGrayStars={!business.ratingCount || business.ratingCount === 0} />
                  <div className="flex items-center gap-1 border-l border-gray-200 pl-2">
                    {business.ratingCount && (
                      <span className="text-xs font-black text-gray-900 leading-none">{business.ratingCount}</span>
                    )}
                  </div>
                </div>
              </div>
              {business.description && (
                <div className="mt-2 max-w-2xl mx-auto text-center">
                  <p className="text-gray-500 text-sm sm:text-base leading-relaxed inline-block">
                    {business.description.length > 120 ? (
                      <>
                        <span>{business.description.slice(0, 120)}...</span>{' '}
                        <button
                          onClick={() => setActiveTab('perfil')}
                          className="text-red-500 text-sm sm:text-base font-medium hover:text-red-600 transition-colors inline-block ml-1"
                        >
                          Leer más
                        </button>
                      </>
                    ) : (
                      <span>{business.description}</span>
                    )}
                  </p>
                </div>
              )}

              {/* Indicadores de Estado, Sucursal y Próxima Apertura */}
              <div className="flex flex-wrap items-center justify-center gap-2.5 mt-4">
                <span className={`inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider shadow-sm transition-all ${isStoreOpen(business)
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                  : 'bg-rose-50 text-rose-700 border border-rose-100'
                  }`}>
                  <span className={`w-2 h-2 rounded-full ${isStoreOpen(business) ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`}></span>
                  {isStoreOpen(business) ? 'Abierto Ahora' : 'Cerrado'}
                </span>

                {branches.length > 1 && (
                  <button
                    onClick={() => setShowBranchModal(true)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full text-xs font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 shadow-sm transition-all cursor-pointer"
                  >
                    <i className="bi bi-geo-alt-fill text-rose-500"></i>
                    <span>
                      {business.branchName || (business.isBranch ? 'Sucursal' : 'Matriz')}
                    </span>
                    <i className="bi bi-chevron-down text-[10px] ml-0.5 opacity-70"></i>
                  </button>
                )}

                {!isStoreOpen(business) && getNextOpeningMessage(business) && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium text-gray-600 bg-gray-50 border border-gray-200/80 shadow-xs animate-in fade-in zoom-in-95 duration-300">
                    <i className="bi bi-clock text-gray-400"></i>
                    {getNextOpeningMessage(business)}
                  </span>
                )}
              </div>

              {/* Navegación por Pestañas - Estilo Pill Compacto */}
              <div className="flex flex-wrap items-center justify-center gap-1.5 sm:gap-2 mt-5 max-w-lg mx-auto">
                <button
                  onClick={() => setActiveTab('perfil')}
                  className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all duration-200 active:scale-95 ${activeTab === 'perfil'
                    ? 'bg-white text-gray-900 shadow-sm ring-1 ring-black/5'
                    : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100/60'
                    }`}
                >
                  <i className={`bi bi-shop text-sm ${activeTab === 'perfil' ? 'text-red-500' : ''}`}></i>
                  Perfil
                </button>
                <button
                  onClick={() => setActiveTab('catalogo')}
                  className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all duration-200 active:scale-95 ${activeTab === 'catalogo'
                    ? 'bg-white text-gray-900 shadow-sm ring-1 ring-black/5'
                    : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100/60'
                    }`}
                >
                  <i className={`bi bi-grid text-sm ${activeTab === 'catalogo' ? 'text-red-500' : ''}`}></i>
                  Catálogo
                </button>
                <button
                  onClick={copyStoreLink}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-gray-500 hover:text-gray-900 hover:bg-gray-100/60 transition-all duration-200 active:scale-95"
                >
                  <i className="bi bi-share text-sm"></i>
                  Compartir
                </button>
                {isOwner && (
                  <Link
                    href="/business/dashboard"
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-gray-500 hover:text-gray-900 hover:bg-gray-100/60 transition-all duration-200 active:scale-95"
                  >
                    <i className="bi bi-gear text-sm"></i>
                    Administrar
                  </Link>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {activeTab === 'perfil' ? (
        /* Vista de Perfil */
        <div className="max-w-4xl mx-auto px-4 py-12">
          <div className="bg-white rounded-3xl p-8 border border-gray-100 shadow-sm">
            <h2 className="text-2xl font-black text-gray-900 mb-6 flex items-center gap-3">
              <i className="bi bi-shop text-red-500"></i>
              Sobre nosotros
            </h2>

            <div className="space-y-8">
              {business.description && (
                <div>
                  <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-2">Descripción</h3>
                  <p className="text-gray-700 leading-relaxed">{business.description}</p>
                </div>
              )}

              {/* Ubicación: Solo si el retiro está habilitado */}
              {business.pickupSettings?.enabled && (
                <div>
                  <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4">Ubicación y Retiro</h3>
                  <div className="bg-gray-50 rounded-2xl p-6 border border-gray-100 space-y-6">
                    <div className="flex flex-col md:flex-row gap-6">
                      {/* Foto del negocio */}
                      {(business.pickupSettings.storePhotoUrl || business.locationImage) && (
                        <div className="w-full md:w-1/3 aspect-video md:aspect-square rounded-xl overflow-hidden bg-gray-200 border border-gray-100 shadow-sm">
                          <img
                            src={business.pickupSettings.storePhotoUrl || business.locationImage}
                            alt={business.name}
                            className="w-full h-full object-cover"
                          />
                        </div>
                      )}

                      <div className="flex-1 space-y-4">
                        {business.pickupSettings.references && (
                          <div>
                            <p className="text-xs font-bold text-gray-400 uppercase mb-1">Referencias</p>
                            <p className="text-gray-700 flex items-start gap-2 italic">
                              <i className="bi bi-geo-alt-fill text-red-500 mt-1"></i>
                              {business.pickupSettings.references}
                            </p>
                          </div>
                        )}

                        {business.pickupSettings.latlong && (
                          <a
                            href={`https://www.google.com/maps/search/?api=1&query=${business.pickupSettings.latlong}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-xl text-xs font-bold text-gray-700 bg-white hover:bg-gray-50 transition-all shadow-sm"
                          >
                            <i className="bi bi-map-fill text-red-500"></i>
                            Ver en Google Maps
                          </a>
                        )}
                      </div>
                    </div>

                    {/* Mini Mapa interactivo (solo visualización) */}
                    {business.pickupSettings.latlong && (
                      <div className="rounded-xl overflow-hidden border border-gray-200 shadow-inner h-48">
                        <LocationMap latlong={business.pickupSettings.latlong} height="100%" />
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div>
                <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4">Horario de Atención</h3>
                <div className="bg-gray-50 rounded-2xl p-6 border border-gray-100 overflow-hidden relative">
                  <div className="absolute top-0 right-0 p-4 opacity-10">
                    <i className="bi bi-clock-fill text-6xl"></i>
                  </div>
                  <p className="text-gray-600 mb-6 flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${isStoreOpen(business) ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`}></span>
                    La tienda está actualmente <strong>{isStoreOpen(business) ? 'Abierta' : 'Cerrada'}</strong>
                  </p>


                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 relative z-10">
                    {Object.entries({
                      monday: 'Lunes',
                      tuesday: 'Martes',
                      wednesday: 'Miércoles',
                      thursday: 'Jueves',
                      friday: 'Viernes',
                      saturday: 'Sábado',
                      sunday: 'Domingo'
                    }).map(([key, label]) => {
                      const daySchedule = business.schedule?.[key as keyof typeof business.schedule] as any
                      return (
                        <div key={key} className="flex justify-between items-center text-sm py-1 border-b border-gray-200/50 last:border-0 sm:last:border-b">
                          <span className="font-semibold text-gray-700">{label}</span>
                          <span className={daySchedule?.isOpen ? 'text-gray-600' : 'text-rose-400 font-medium'}>
                            {daySchedule?.isOpen ? `${daySchedule.open} - ${daySchedule.close}` : 'Cerrado'}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Vista de Catálogo (actual) */
        <div className="max-w-7xl mx-auto px-4 py-8 sm:py-12">
          <div className="flex items-center gap-4 mb-10">
            <div className="flex items-center gap-2.5">
              <h2 className="text-2xl sm:text-3xl font-black text-gray-900 tracking-tight">
                Nuestro Menú
              </h2>
              {getPackagingFee(business) > 0 && (
                <div className="relative inline-flex items-center">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setShowHeaderFeeTooltip(prev => !prev)
                    }}
                    onMouseEnter={() => setShowHeaderFeeTooltip(true)}
                    onMouseLeave={() => setShowHeaderFeeTooltip(false)}
                    className="p-0 bg-transparent border-none text-amber-500 hover:text-amber-600 transition-colors focus:outline-none flex items-center justify-center cursor-pointer align-super"
                    aria-label="Precios incluyen recargo por empaque"
                    title="Precios incluyen recargo por empaque"
                  >
                    <i className="bi bi-asterisk text-xs sm:text-sm font-black"></i>
                  </button>
                  {showHeaderFeeTooltip && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 bg-amber-900 text-amber-50 text-xs font-bold rounded-xl shadow-xl whitespace-nowrap z-20 flex items-center gap-2 animate-fadeIn"
                    >
                      <i className="bi bi-asterisk text-xs text-amber-300"></i>
                      <span>Precios incluyen recargo por empaque</span>
                      <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-amber-900"></div>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="flex-1 h-px bg-gradient-to-r from-gray-200 to-transparent"></div>
          </div>

          {Object.entries(productsByCategory).length === 0 ? (
            <div className="text-center py-20 px-6 bg-white rounded-[2.5rem] border border-gray-100 shadow-sm flex flex-col items-center">
              <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mb-6">
                <i className="bi bi-bag-x text-3xl text-gray-300"></i>
              </div>
              <h3 className="text-xl font-black text-gray-900 mb-2">¡Próximamente!</h3>
              <p className="text-gray-500 font-medium max-w-xs mx-auto mb-8">
                Esta tienda aún no ha publicado sus productos en el catálogo digital.
              </p>

              {isOwner ? (
                <Link
                  href="/business/dashboard?tab=profile&subtab=products"
                  className="inline-flex items-center gap-3 px-8 py-4 bg-gray-900 text-white font-black rounded-2xl shadow-[0_10px_20px_rgba(0,0,0,0.1)] hover:shadow-[0_15px_30px_rgba(0,0,0,0.2)] hover:-translate-y-1 transition-all active:scale-95 group"
                >
                  <i className="bi bi-plus-circle text-2xl text-red-500"></i>
                  AGREGAR PRODUCTOS
                  <i className="bi bi-arrow-right opacity-50 group-hover:opacity-100 group-hover:translate-x-1 transition-all"></i>
                </Link>
              ) : (
                business.phone && (
                  <a
                    href={whatsappUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-3 px-8 py-4 bg-[#25D366] text-white font-black rounded-2xl shadow-[0_10px_20px_rgba(37,211,102,0.2)] hover:shadow-[0_15px_30px_rgba(37,211,102,0.4)] hover:-translate-y-1 transition-all active:scale-95 group"
                  >
                    <i className="bi bi-whatsapp text-2xl"></i>
                    PEDIR MENÚ POR WHATSAPP
                    <i className="bi bi-arrow-right opacity-50 group-hover:opacity-100 group-hover:translate-x-1 transition-all"></i>
                  </a>
                )
              )}
            </div>
          ) : (
            Object.entries(productsByCategory).map(([category, categoryProducts]) => (
              <div key={category} className="mb-12">
                {category.toLowerCase() !== 'sin categoría' && category.toLowerCase() !== 'sin categoria' && (
                  <div className="flex items-center gap-3 mb-6">
                    <h3 className="text-lg sm:text-xl font-bold text-gray-800 tracking-wide uppercase">{category}</h3>
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
                  {categoryProducts.map((product) => (
                    <ProductVariantSelector
                      key={product.id}
                      product={product}
                      onAddToCart={addToCart}
                      onShowDetails={(p) => {
                        setSelectedProduct(p)
                        setIsVariantModalOpen(true)
                      }}
                      getCartItemQuantity={getCartItemQuantity}
                      updateQuantity={updateQuantity}
                      businessImage={business?.image}
                      businessUsername={business?.username}
                      onGenerateReferral={handleGenerateReferral}
                      hasRecommended={generatedReferralProducts.has(product.id)}
                      referralCount={referralCounts[product.id]}
                      business={business}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Floating Cart Button - Ultra Modern */}
      {cartItemsCount > 0 && (
        <div className="fixed bottom-cart-position right-6 z-[50]">
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
                <div className="text-xs text-gray-400 font-bold uppercase tracking-widest leading-none mb-1">Continuar</div>
                <div className="text-lg font-black leading-none">${cartTotal.toFixed(2)}</div>
              </div>
              <div className="pl-2 border-l border-white/10 group-hover:translate-x-1 transition-transform">
                <i className="bi bi-chevron-right text-gray-400"></i>
              </div>
            </div>
          </button>
        </div>
      )}

      <>
        {/* Cart Sidebar */}
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
          onShowProductDetails={(p) => {
            setSelectedProduct(p)
            setIsVariantModalOpen(true)
          }}
          products={products}
        />

      <ProductDetailSidebar
        product={selectedProduct}
        isOpen={isVariantModalOpen}
        onClose={() => {
          setIsVariantModalOpen(false)
          setSelectedProduct(null)
        }}
        business={business}
        onProductSelect={(product) => setSelectedProduct(product)}
        onOpenCart={() => setIsCartOpen(true)}
        onGenerateReferral={selectedProduct ? () => handleGenerateReferral(selectedProduct) : undefined}
        hasRecommended={selectedProduct ? generatedReferralProducts.has(selectedProduct.id) : false}
        referralCount={selectedProduct ? referralCounts[selectedProduct.id] : undefined}
        onOpenRatingModal={() => setIsRatingModalOpen(true)}
      />

      {notification.show && (
        <div className="fixed top-8 left-1/2 -translate-x-1/2 z-[300] w-[calc(100%-2rem)] max-w-xs pointer-events-none animate-[slideDown_0.3s_ease-out]">
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
              from { transform: translate(-50%, -20px); opacity: 0; }
              to { transform: translate(-50%, 0); opacity: 1; }
            }
          `}</style>
        </div>
      )}

      {/* Otras tiendas - Carrusel Horizontal Rediseñado */}
      {otherBusinesses.length > 0 && (
        <div className="max-w-7xl mx-auto px-4 py-8 sm:py-12 border-t border-gray-100 mt-4">
          <div className="flex items-center gap-4 mb-10">
            <h2 className="text-2xl sm:text-3xl font-black text-gray-900 tracking-tight">
              Explora otras tiendas
            </h2>
            <div className="flex-1 h-px bg-gradient-to-r from-gray-200 to-transparent"></div>
          </div>

          <div className="relative group/carousel px-0 md:px-8">
            <div className="flex gap-5 overflow-x-auto pb-8 snap-x scroll-smooth other-stores-carousel [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {otherBusinesses.map((store) => (
                <Link
                  key={store.id}
                  href={`/${store.username}`}
                  className="flex-shrink-0 w-64 bg-white rounded-2xl shadow-sm hover:shadow-md transition-all overflow-hidden border border-gray-100"
                >
                  <div className="relative h-40 bg-gray-100 flex items-center justify-center">
                    {store.image ? (
                      <img
                        src={store.image}
                        alt={store.name}
                        className="w-full h-full object-cover"
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <i className="bi bi-shop text-5xl text-gray-400"></i>
                    )}
                  </div>
                  <div className="p-4">
                    <h3 className="text-lg font-semibold text-gray-900 line-clamp-1">{store.name}</h3>
                    {store.categories && store.categories.length > 0 && (
                      <div className="flex gap-1 my-2 overflow-x-auto scrollbar-hide">
                        {store.categories.slice(0, 3).map((cat, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600 whitespace-nowrap flex-shrink-0"
                          >
                            {cat}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="mb-2">
                      {store.ratingAverage ? (
                        <div className="flex items-center">
                          <StarRating rating={store.ratingAverage} size="sm" />
                          <span className="text-xs text-gray-500 ml-1">({store.ratingCount || 0})</span>
                        </div>
                      ) : (
                        <div className="flex items-center">
                          <StarRating rating={0} size="sm" showGrayStars={true} />
                        </div>
                      )}
                    </div>
                    {store.description && (
                      <p className="text-sm text-gray-600 line-clamp-2 mb-3">{store.description}</p>
                    )}
                  </div>
                </Link>
              ))}
            </div>

            {/* Hint de scroll para móvil */}
            <div className="md:hidden absolute -bottom-2 left-1/2 -translate-x-1/2 flex gap-1 opacity-20">
              <div className="w-8 h-1 bg-gray-300 rounded-full"></div>
              <div className="w-2 h-1 bg-gray-200 rounded-full"></div>
              <div className="w-1 h-1 bg-gray-200 rounded-full"></div>
            </div>

            {/* Navigation Arrows - Desktop Only */}
            <button
              onClick={() => {
                const container = document.querySelector('.other-stores-carousel')
                if (container) container.scrollLeft -= 300
              }}
              className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-4 w-12 h-12 bg-white rounded-full shadow-xl hidden md:flex items-center justify-center text-gray-700 hover:bg-black hover:text-white transition-all z-10 border border-gray-100 opacity-0 group-hover/carousel:opacity-100"
            >
              <i className="bi bi-chevron-left text-xl"></i>
            </button>
            <button
              onClick={() => {
                const container = document.querySelector('.other-stores-carousel')
                if (container) container.scrollLeft += 300
              }}
              className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-4 w-12 h-12 bg-white rounded-full shadow-xl hidden md:flex items-center justify-center text-gray-700 hover:bg-black hover:text-white transition-all z-10 border border-gray-100 opacity-0 group-hover/carousel:opacity-100"
            >
              <i className="bi bi-chevron-right text-xl"></i>
            </button>
          </div>

        </div>
      )}
      {/* Modals — only mounted when open to avoid loading chunks upfront */}
      {isUserSidebarOpen && (
        <UserSidebar
          isOpen={true}
          onClose={() => setIsUserSidebarOpen(false)}
          onLogin={() => setShowLoginModal(true)}
        />
      )}

      {showLoginModal && (
        <ClientLoginModal
          isOpen={true}
          onClose={() => setShowLoginModal(false)}
          onLoginSuccess={(phone) => {
            setClientPhone(phone)
            setShowLoginModal(false)
          }}
        />
      )}

      {/* Modal de Selección de Sucursal */}
      {showBranchModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl overflow-hidden animate-scale-up">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-rose-50 to-white">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center font-bold">
                  <i className="bi bi-shop text-lg"></i>
                </div>
                <div>
                  <h3 className="text-base font-black text-gray-900 tracking-tight leading-tight">
                    Selecciona una Sucursal
                  </h3>
                  <p className="text-xs font-medium text-gray-500">
                    Locales disponibles de {business?.name}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowBranchModal(false)}
                className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-full transition-colors"
              >
                <i className="bi bi-x-lg"></i>
              </button>
            </div>

            <div className="p-4 max-h-80 overflow-y-auto space-y-2.5">
              {branches.map(branchItem => {
                const isCurrent = branchItem.id === business?.id
                return (
                  <a
                    key={branchItem.id}
                    href={`/${branchItem.username}`}
                    onClick={() => setShowBranchModal(false)}
                    className={`w-full flex items-center justify-between p-3.5 rounded-2xl border transition-all duration-150 ${
                      isCurrent
                        ? 'bg-rose-50 border-rose-200 ring-2 ring-rose-500/20'
                        : 'bg-white hover:bg-gray-50 border-gray-100 hover:border-gray-200'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-gray-100 overflow-hidden flex-shrink-0 border border-gray-200/60">
                        {branchItem.image ? (
                          <img src={branchItem.image} alt={branchItem.name} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-gray-400"><i className="bi bi-shop"></i></div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="font-black text-sm text-gray-900 truncate">
                          {branchItem.branchName || branchItem.name}
                        </p>
                        {branchItem.pickupSettings?.references && (
                          <p className="text-xs text-gray-500 font-medium truncate mt-0.5">
                            {branchItem.pickupSettings.references}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                      {isCurrent ? (
                        <span className="text-[10px] font-black uppercase tracking-wider bg-rose-600 text-white px-2 py-0.5 rounded-full">
                          Actual
                        </span>
                      ) : (
                        <i className="bi bi-chevron-right text-gray-400 text-sm"></i>
                      )}
                    </div>
                  </a>
                )
              })}
            </div>
          </div>
        </div>
      )}
      </>
    </div>
  )
}
