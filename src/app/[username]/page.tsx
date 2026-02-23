'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import Head from 'next/head'
import { Business, Product, QRCode, UserQRProgress } from '@/types'
import { getBusinessByUsername, getProductsByBusiness, incrementVisitFirestore, getQRCodesByBusiness, getUserQRProgress, redeemQRCodePrize, unredeemQRCodePrize, getAllBusinesses, generateReferralLink, trackReferralClick } from '@/lib/database'
import CartSidebar from '@/components/CartSidebar'
import { normalizeEcuadorianPhone } from '@/lib/validation'
import LocationMap from '@/components/LocationMap'
import { CheckoutContent } from '@/components/CheckoutContent'
import UserSidebar from '@/components/UserSidebar'
import ClientLoginModal from '@/components/ClientLoginModal'
import { isStoreOpen, getNextOpeningMessage } from '@/lib/store-utils'
import { BusinessAuthProvider, useBusinessAuth } from '@/contexts/BusinessAuthContext'
import { useAuth } from '@/contexts/AuthContext'
import StarRating from '@/components/StarRating'

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
      "streetAddress": business.pickupSettings?.enabled ? business.pickupSettings.references : (business.address || ''),
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

function ProductVariantSelector({ product, onAddToCart, onShowDetails, getCartItemQuantity, updateQuantity, businessImage, businessUsername, onGenerateReferral }: {
  product: any,
  onAddToCart: (item: any) => void,
  onShowDetails: (product: any) => void,
  getCartItemQuantity: (id: string, variantName?: string | null) => number,
  updateQuantity: (id: string, quantity: number, variantName?: string | null) => void,
  businessImage?: string,
  businessUsername?: string,
  onGenerateReferral: (product: any) => void
}) {
  const [imgLoaded, setImgLoaded] = useState(false)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [copySuccess, setCopySuccess] = useState(false)
  const menuContainerRef = useRef<HTMLDivElement | null>(null)
  const handleCardClick = () => onShowDetails(product)

  useEffect(() => {
    if (!isMenuOpen) return

    const onPointerDown = (event: PointerEvent) => {
      const container = menuContainerRef.current
      if (!container) return

      const target = event.target as Node | null
      if (target && !container.contains(target)) {
        setIsMenuOpen(false)
      }
    }

    window.addEventListener('pointerdown', onPointerDown, true)
    return () => window.removeEventListener('pointerdown', onPointerDown, true)
  }, [isMenuOpen])

  const handleCopyProductLink = async (e: React.MouseEvent) => {
    e.stopPropagation()
    const productUrl = `${window.location.origin}/${businessUsername}/${product.slug || product.id}`
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
      setTimeout(() => {
        setCopySuccess(false)
        setIsMenuOpen(false)
      }, 1500)
    } catch (err) {
      console.error('Error al copiar enlace:', err)
    }
  }

  const quantity = getCartItemQuantity(product.id, null)
  const hasVariants = product.variants && product.variants.length > 0

  return (
    <div
      onClick={handleCardClick}
      className={`group relative flex items-center bg-white p-4 rounded-2xl border transition-all duration-300 cursor-pointer active:scale-[0.98] ${quantity > 0 ? 'border-red-200 shadow-md ring-1 ring-red-50' : 'border-gray-100 shadow-sm hover:shadow-md hover:border-red-100'
        } ${isMenuOpen ? 'z-50' : ''}`}
    >
      {isMenuOpen && (
        <div
          className="fixed inset-0 z-[55]"
          onClick={() => setIsMenuOpen(false)}
        />
      )}
      {/* Botón de menú de 3 puntos */}
      <div ref={menuContainerRef} className="absolute top-3 right-3 z-[60]">
        <button
          onClick={(e) => {
            e.stopPropagation()
            setIsMenuOpen(!isMenuOpen)
          }}
          className="p-1.5 text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded-full transition-all"
          title="Opciones"
        >
          <i className="bi bi-three-dots-vertical text-lg"></i>
        </button>

        {/* Menú desplegable */}
        {isMenuOpen && (
          <>
            {/* Menú */}
            <div className="absolute right-0 mt-1 w-48 bg-white rounded-xl shadow-lg border border-gray-100 py-1 z-[60] animate-in fade-in zoom-in duration-200">
              <button
                onClick={handleCopyProductLink}
                className="w-full px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50 transition-colors flex items-center gap-3"
              >
                <i className={`bi ${copySuccess ? 'bi-check-circle text-emerald-500' : 'bi-link-45deg text-gray-400'} text-lg`}></i>
                <span className="font-medium">{copySuccess ? '¡Enlace copiado!' : 'Copiar enlace'}</span>
              </button>

              {/* NUEVA OPCIÓN: Recomendar */}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onGenerateReferral(product)
                  setIsMenuOpen(false)
                }}
                className="w-full px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50 transition-colors flex items-center gap-3"
              >
                <span className="text-lg">🔥</span>
                <span className="font-medium">Recomendar</span>
              </button>
            </div>
          </>
        )}
      </div>

      {/* Imagen cuadrada con diseño redondeado */}
      <div
        className="w-20 h-20 sm:w-24 sm:h-24 flex-shrink-0 rounded-xl overflow-hidden bg-gray-50 relative border border-gray-50 hover:opacity-90 transition-opacity"
      >
        <div className={`absolute inset-0 animate-pulse bg-gray-100 ${imgLoaded ? 'hidden' : 'block'}`}></div>
        <img
          src={product.image || businessImage}
          alt={product.name}
          className="w-full h-full object-cover transition-transform duration-500 md:group-hover:scale-110"
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
            <h4 className="font-bold text-base sm:text-lg text-gray-900 group-hover:text-red-600 transition-colors leading-tight truncate">
              {product.name}
            </h4>
            <p className="text-gray-500 text-xs sm:text-sm mt-1 line-clamp-2 leading-snug">
              {product.description}
            </p>
          </div>

          <div className="mt-2 flex items-center justify-between">
            <div className="flex items-baseline gap-1">
              {hasVariants && (
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">Desde</span>
              )}
              <span className="text-base sm:text-xl font-black text-red-500 tracking-tight">
                ${(hasVariants
                  ? Math.min(...product.variants.filter((v: any) => v.isAvailable !== false).map((v: any) => v.price))
                  : product.price).toFixed(2)}
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
              <div className="w-8 h-8 rounded-full bg-gray-900 text-white flex items-center justify-center shadow-lg transform md:group-hover:scale-110 md:group-hover:bg-red-600 transition-all duration-300">
                <i className="bi bi-plus-lg text-sm"></i>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Modal para seleccionar variantes
function VariantModal({ product, isOpen, onClose, onAddToCart, businessImage, businessUsername, getCartItemQuantity, updateQuantity, onOpenCart, cartItemsCount }: {
  product: any;
  isOpen: boolean;
  onClose: () => void;
  onAddToCart: (item: any) => void;
  businessImage?: string;
  businessUsername?: string;
  getCartItemQuantity: (id: string, variantName?: string | null) => number;
  updateQuantity: (id: string, quantity: number, variantName?: string | null) => void;
  onOpenCart?: () => void;
  cartItemsCount?: number;
}) {
  const [selectedVariant, setSelectedVariant] = useState<any>(null)
  const [modalImgLoaded, setModalImgLoaded] = useState(false)
  const [copySuccess, setCopySuccess] = useState(false)

  if (!isOpen || !product) return null

  const handleCopyLink = async () => {
    const productUrl = `${window.location.origin}/${businessUsername}/${product.slug || product.id}`
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

  return (
    <div className="fixed inset-0 z-[200] overflow-hidden">
      {/* Overlay con blur suave */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300" onClick={onClose} />

      <div className="flex items-center justify-center min-h-screen p-4">
        <div className="relative w-full max-w-md bg-gray-50 rounded-[2.5rem] shadow-2xl overflow-hidden transform transition-all animate-in fade-in zoom-in duration-300 flex flex-col max-h-[calc(100svh-4rem)]">

          {/* Header con estilo premium */}
          <div className="px-6 pt-8 pb-6 bg-white border-b border-gray-100 flex-shrink-0 relative">
            <div className="absolute top-6 right-6 flex items-center gap-2">
              <button
                onClick={handleCopyLink}
                className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-all"
                title="Copiar enlace del producto"
              >
                <i className={`bi ${copySuccess ? 'bi-check-circle text-emerald-500' : 'bi-link-45deg'} text-xl`}></i>
              </button>
              <button
                onClick={onClose}
                className="p-2 text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded-full transition-all"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex gap-5">
              {/* Imagen principal del producto en el modal */}
              <div className="w-24 h-24 sm:w-28 sm:h-28 flex-shrink-0 relative rounded-2xl overflow-hidden shadow-lg border-2 border-white">
                <div className={`absolute inset-0 animate-pulse bg-gray-100 ${modalImgLoaded ? 'hidden' : 'block'}`}></div>
                <img
                  src={product?.image || businessImage}
                  alt={product?.name}
                  className="w-full h-full object-cover"
                  loading="lazy"
                  onLoad={() => setModalImgLoaded(true)}
                  onError={(e) => {
                    const target = e.target as HTMLImageElement;
                    if (target.src !== (businessImage || '')) target.src = businessImage || ''
                    setModalImgLoaded(true)
                  }}
                />
              </div>

              <div className="flex-1 min-w-0 flex flex-col justify-center">
                <h3 className="text-xl font-black text-gray-900 leading-tight mb-2 pr-8">{product?.name}</h3>
                {product?.category && (
                  <span className="w-fit px-2 py-0.5 bg-red-50 text-red-600 text-[10px] font-black uppercase tracking-widest rounded-full">
                    {product.category}
                  </span>
                )}
              </div>
            </div>

            {product?.description && (
              <div className="mt-6">
                <p className="text-gray-500 text-sm leading-relaxed line-clamp-3">
                  {product.description}
                </p>
              </div>
            )}
          </div>

          {/* Área de selección con fondo gris claro y scroll suave */}
          <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">
            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-4 ml-1">
              {product?.variants?.length > 0 ? 'variantes disponibles' : 'Detalle del producto'}
            </label>

            <div className="space-y-3">
              {(!product?.variants || product.variants.length === 0) ? (
                /* Producto sin variantes - Estilo CartSidebar */
                <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between group transition-all hover:border-red-100">
                  <div className="flex-1 min-w-0">
                    <h5 className="font-bold text-gray-900 text-sm">{product.name}</h5>
                    <div className="text-red-500 font-black mt-1">${(product.price || 0).toFixed(2)}</div>
                  </div>

                  <div className="flex-shrink-0 ml-4">
                    {getCartItemQuantity(product.id, null) > 0 ? (
                      <div className="flex items-center bg-gray-100 rounded-xl p-1 gap-1">
                        <button
                          onClick={() => updateQuantity(product.id, getCartItemQuantity(product.id, null) - 1, null)}
                          className="w-8 h-8 flex items-center justify-center bg-white rounded-lg text-gray-600 shadow-sm hover:text-red-500 transition-all"
                        >
                          <span className="text-lg">−</span>
                        </button>
                        <span className="w-8 text-center font-black text-sm text-gray-900">
                          {getCartItemQuantity(product.id, null)}
                        </span>
                        <button
                          onClick={() => updateQuantity(product.id, getCartItemQuantity(product.id, null) + 1, null)}
                          className="w-8 h-8 flex items-center justify-center bg-white rounded-lg text-gray-600 shadow-sm hover:text-green-600 transition-all"
                        >
                          <span className="text-lg">+</span>
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          onAddToCart({
                            id: product.id,
                            name: product.name,
                            variantName: null,
                            productName: product.name,
                            price: product.price,
                            image: product.image,
                            description: product.description,
                            businessId: product.businessId,
                            productId: product.id,
                          });
                        }}
                        className="w-10 h-10 flex items-center justify-center bg-gray-900/5 text-gray-900 hover:bg-gray-900 hover:text-white rounded-xl transition-all active:scale-95"
                      >
                        <i className="bi bi-plus-lg text-sm"></i>
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                /* Lista de variantes - Estilo Premium */
                product?.variants?.filter((v: any) => v.isAvailable !== false).map((variant: any, i: number) => {
                  const qty = getCartItemQuantity(product.id, variant.name)

                  return (
                    <div
                      key={i}
                      onClick={() => setSelectedVariant(variant)}
                      className={`w-full p-4 rounded-2xl border-2 transition-all duration-300 flex items-center justify-between ${selectedVariant?.name === variant.name
                        ? 'border-red-500 bg-white shadow-md ring-1 ring-red-50'
                        : 'border-white bg-white shadow-sm hover:shadow-md hover:border-gray-100 cursor-pointer'
                        }`}
                    >
                      <div className="flex-1 min-w-0 pr-4">
                        <h5 className="font-bold text-gray-900 text-sm mb-0.5">{variant.name}</h5>
                        {variant.description && (
                          <p className="text-xs text-gray-400 line-clamp-1 mb-1">{variant.description}</p>
                        )}
                        <div className="text-red-500 font-black text-base">${variant.price.toFixed(2)}</div>
                      </div>

                      <div className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>
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
                              onAddToCart({
                                id: product.id,
                                name: `${product.name} - ${variant.name}`,
                                variantName: variant.name,
                                productName: product.name,
                                price: variant.price,
                                image: product.image,
                                description: variant.description || product.description,
                                businessId: product.businessId,
                                productId: product.id,
                                variantId: variant.id
                              });
                            }}
                            className="w-10 h-10 flex items-center justify-center bg-gray-900/5 text-gray-900 hover:bg-gray-900 hover:text-white rounded-xl transition-all active:scale-95"
                          >
                            <i className="bi bi-plus-lg text-sm"></i>
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          {/* Footer - Estilo Premium Bottom */}
          <div className="p-6 bg-white border-t border-gray-100 flex-shrink-0 flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 py-4 bg-gray-100 text-gray-900 font-bold rounded-2xl hover:bg-gray-200 transition-all active:scale-[0.98]"
            >
              Cerrar
            </button>
            {(cartItemsCount || 0) > 0 && onOpenCart && (
              <button
                onClick={() => {
                  onClose()
                  onOpenCart()
                }}
                className="flex-1 py-4 bg-gray-900 text-white font-bold rounded-2xl hover:bg-black transition-all active:scale-[0.98] flex items-center justify-center gap-2 shadow-lg shadow-gray-200"
              >
                <i className="bi bi-cart3"></i>
                Ver Carrito
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// Modal para compartir link de referido
function ReferralModal({
  isOpen,
  onClose,
  product,
  referralLink,
  businessName
}: {
  isOpen: boolean
  onClose: () => void
  product: any
  referralLink: string
  businessName: string
}) {
  const [copied, setCopied] = useState(false)

  if (!isOpen || !product) return null

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(referralLink)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Error copying:', err)
    }
  }

  const shareOnWhatsApp = () => {
    const text = `¡Mira este producto de ${businessName}! ${product.name} - ${referralLink}`
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank')
  }

  const shareOnFacebook = () => {
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(referralLink)}`, '_blank')
  }

  return (
    <div className="fixed inset-0 z-[100] overflow-hidden">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="flex items-center justify-center min-h-screen p-4">
        <div className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl p-6 animate-in fade-in zoom-in duration-300 flex flex-col max-h-[calc(100svh-4rem)] overflow-y-auto custom-scrollbar">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded-full transition-all z-10"
          >
            <i className="bi bi-x-lg text-xl"></i>
          </button>

          <div className="text-center mb-6 flex-shrink-0">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl">🔥</span>
            </div>
            <h3 className="text-2xl font-black text-gray-900 mb-2">
              ¡Recomienda y Gana!
            </h3>
            <p className="text-gray-500 text-sm">
              Comparte este producto y gana $0,25 por cada venta completada
            </p>
          </div>

          <div className="bg-gray-50 rounded-2xl p-4 mb-6">
            <div className="flex items-center gap-3 mb-3">
              <img
                src={product.image}
                alt={product.name}
                className="w-12 h-12 rounded-lg object-cover"
              />
              <div className="flex-1 min-w-0">
                <h4 className="font-bold text-gray-900 text-sm truncate">{product.name}</h4>
                <p className="text-red-500 font-black text-sm">${product.price?.toFixed(2)}</p>
              </div>
            </div>

            <div className="bg-white rounded-xl p-3 border border-gray-200">
              <p className="text-xs text-gray-400 mb-1">Tu link de referido:</p>
              <p className="text-xs text-gray-900 break-all font-mono">{referralLink}</p>
            </div>
          </div>

          <button
            onClick={handleCopy}
            className="w-full py-3 bg-gray-900 text-white font-bold rounded-xl hover:bg-black transition-all mb-3 flex items-center justify-center gap-2"
          >
            <i className={`bi ${copied ? 'bi-check-circle' : 'bi-clipboard'}`}></i>
            {copied ? '¡Copiado!' : 'Copiar enlace'}
          </button>

          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={shareOnWhatsApp}
              className="py-3 bg-green-500 text-white font-bold rounded-xl hover:bg-green-600 transition-all flex items-center justify-center gap-2"
            >
              <i className="bi bi-whatsapp"></i>
              WhatsApp
            </button>
            <button
              onClick={shareOnFacebook}
              className="py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-all flex items-center justify-center gap-2"
            >
              <i className="bi bi-facebook"></i>
              Facebook
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function RestaurantPage() {
  return (
    <BusinessAuthProvider>
      <RestaurantContent />
    </BusinessAuthProvider>
  )
}

function RestaurantContent() {
  const { user } = useBusinessAuth()
  const { user: clientUser } = useAuth()
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

  // Estados para sistema de referidos
  const [referralModalOpen, setReferralModalOpen] = useState(false)
  const [selectedProductForReferral, setSelectedProductForReferral] = useState<any>(null)
  const [generatedReferralLink, setGeneratedReferralLink] = useState<string>('')
  const [referralCode, setReferralCode] = useState<string | null>(null)


  useEffect(() => {
    const loadRestaurantData = async () => {
      // No setLoading(true) aquí para zero-load feel, pero mantén el estado para skeletons
      try {
        const businessData = await getBusinessByUsername(username)
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
        const productsData = await getProductsByBusiness(businessData.id)
        // Filtrar solo productos disponibles
        const availableProducts = productsData.filter(product => product.isAvailable)
        setProducts(availableProducts)

        // Cargar otras tiendas aleatorias
        try {
          const all = await getAllBusinesses()
          const others = all
            .filter(
              (b) =>
                b.username !== username &&
                b.isActive !== false &&
                b.isHidden !== true &&
                b.businessType !== 'distributor'
            )
            .sort(() => 0.5 - Math.random())
            .slice(0, 4)
          setOtherBusinesses(others)
        } catch (e) {
          console.error('Error loading other businesses:', e)
        }
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

  useEffect(() => {
    try {
      const storedPhone = localStorage.getItem('loginPhone')
      setClientPhone(storedPhone)
    } catch {
      setClientPhone(null)
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
      const savedCarts = localStorage.getItem('carts')
      let businessCart = []
      if (savedCarts) {
        const allCarts = JSON.parse(savedCarts)
        businessCart = allCarts[business.id] || []
      }

      // Verificar si el premio ya está en el carrito
      const tienePremio = businessCart.some((item: any) => item.esPremio === true)

      // Auto-agregar premio según configuración dinámica
      if (business.rewardSettings?.enabled && !tienePremio) {
        const premioEspecial = {
          id: 'premio-especial-auto',
          name: `🎁 ${business.rewardSettings.name}`,
          variantName: null,
          productName: `🎁 ${business.rewardSettings.name}`,
          description: business.rewardSettings.description || '¡Felicidades! Has reclamado tu premio especial gratis',
          price: 0,
          isAvailable: true,
          esPremio: true,
          quantity: 1,
          image: business.image || 'https://via.placeholder.com/150?text=Premio',
          businessId: business.id,
          businessName: business.name,
          businessImage: business.image
        }
        businessCart = [...businessCart, premioEspecial]
        updateCartInStorage(business.id, businessCart)
        setPremioAgregado(true)
      } else {
        setPremioAgregado(tienePremio)
      }

      setCart(businessCart)
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

    try {
      const code = await generateReferralLink(
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
      setSelectedProductForReferral(product)
      setReferralModalOpen(true)
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

    const existingItem = cart.find(item => item.id === cartItem.id && item.variantName === cartItem.variantName)
    let newCart

    if (existingItem) {
      newCart = cart.map(item =>
        (item.id === cartItem.id && item.variantName === cartItem.variantName)
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
        businessId: business.id,
        businessName: business.name,
        businessImage: business.image
      }]
      showNotification(`${product.name} agregado al carrito`)
    }

    setCart(newCart)
    updateCartInStorage(business.id, newCart)
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

  const isOwner = user && business && (business.ownerId === user.uid || business.administrators?.some(a => a.uid === user.uid))

  // Agrupar productos por categoría, respetando el orden definido en business.categories
  const productsByCategory: Record<string, Product[]> = {}

  // Primero, obtenemos todos los productos disponibles
  const availableProducts = products.filter(product => product.isAvailable)

  // Si hay categorías definidas en el negocio, usamos ese orden
  if (business?.categories?.length) {
    // Creamos las categorías en el orden definido
    business.categories.forEach(category => {
      const categoryProducts = availableProducts
        .filter(p => p.category === category)
        .sort((a, b) => {
          // Ordenar por 'order' (asc) y luego por 'createdAt' (desc)
          const orderA = a.order ?? Number.MAX_SAFE_INTEGER
          const orderB = b.order ?? Number.MAX_SAFE_INTEGER
          if (orderA !== orderB) return orderA - orderB

          const dateA = a.createdAt instanceof Date ? a.createdAt.getTime() : 0
          const dateB = b.createdAt instanceof Date ? b.createdAt.getTime() : 0
          return dateB - dateA
        })

      if (categoryProducts.length > 0) {
        productsByCategory[category] = categoryProducts
      }
    })

    // Agregamos productos sin categoría a 'Otros' si existen
    const uncategorizedProducts = availableProducts
      .filter(p => !p.category || !business.categories?.includes(p.category))
      .sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER))

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

    // Ordenar productos en cada categoría si no hay orden de categorías definido
    Object.keys(productsByCategory).forEach(cat => {
      productsByCategory[cat].sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER))
    })
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Structured Data for SEO */}
      <BusinessStructuredData business={business} />

      {/* Hero Section sin skeletons */}
      <div className="bg-white shadow-sm">
        {/* Portada con logo superpuesto */}
        <div className="relative w-full h-36 sm:h-48 bg-gray-200">
          {/* Hamburger Menu Icon */}
          <button
            onClick={() => setIsUserSidebarOpen(true)}
            className="absolute top-4 left-4 z-20 w-10 h-10 flex items-center justify-center rounded-full bg-white/20 backdrop-blur-md text-white border border-white/20 hover:bg-white/30 transition-all active:scale-95 shadow-sm"
            aria-label="Menú de usuario"
          >
            <i className="bi bi-list text-xl"></i>
          </button>
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
        <div className="max-w-3xl mx-auto px-4 pt-16 sm:pt-20 pb-8 text-center">
          <div className="flex flex-col items-center">
            <div className="w-full">
              <h1 className="text-3xl sm:text-4xl font-black text-gray-900 tracking-tight leading-tight mb-2">
                {business.name}
              </h1>
              {business.description && (
                <p className="text-gray-500 text-sm sm:text-base mt-2 max-w-2xl mx-auto leading-relaxed">
                  {business.description}
                </p>
              )}

              <div className="flex flex-wrap items-center justify-center gap-3 mt-6">
                <span className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider shadow-sm transition-all ${isStoreOpen(business)
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                  : 'bg-rose-50 text-rose-700 border border-rose-100'
                  }`}>
                  <span className={`w-2 h-2 rounded-full ${isStoreOpen(business) ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`}></span>
                  {isStoreOpen(business) ? 'Abierto Ahora' : 'Cerrado'}
                </span>
              </div>

              {!isStoreOpen(business) && getNextOpeningMessage(business) && (
                <div className="mt-1 flex justify-center">
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 animate-in fade-in slide-in-from-top-1 duration-500">
                    <i className="bi bi-clock text-gray-400"></i>
                    {getNextOpeningMessage(business)}
                  </span>
                </div>
              )}

              {/* Navegación por Pestañas - Estilo Minimalista */}
              <div className="flex items-center justify-center gap-6 mt-8 w-fit mx-auto">
                <button
                  onClick={() => setActiveTab('perfil')}
                  className={`flex flex-col items-center justify-center min-w-[80px] sm:min-w-[100px] aspect-square py-3 px-2 rounded-xl text-xs font-bold transition-all duration-300 gap-2 ${activeTab === 'perfil'
                    ? 'bg-white text-gray-900 shadow-md ring-1 ring-black/5'
                    : 'text-gray-400 hover:text-gray-600'
                    }`}
                >
                  <i className={`bi bi-shop text-xl ${activeTab === 'perfil' ? 'text-red-500' : ''}`}></i>
                  Perfil
                </button>
                <button
                  onClick={() => setActiveTab('catalogo')}
                  className={`flex flex-col items-center justify-center min-w-[80px] sm:min-w-[100px] aspect-square py-3 px-2 rounded-xl text-xs font-bold transition-all duration-300 gap-2 ${activeTab === 'catalogo'
                    ? 'bg-white text-gray-900 shadow-md ring-1 ring-black/5'
                    : 'text-gray-400 hover:text-gray-600'
                    }`}
                >
                  <i className={`bi bi-grid text-xl ${activeTab === 'catalogo' ? 'text-red-500' : ''}`}></i>
                  Catálogo
                </button>
                <button
                  onClick={copyStoreLink}
                  className="flex flex-col items-center justify-center min-w-[80px] sm:min-w-[100px] aspect-square py-3 px-2 rounded-xl text-xs font-bold text-gray-400 hover:text-gray-900 hover:bg-white transition-all duration-300 gap-2"
                >
                  <i className="bi bi-share text-xl"></i>
                  Compartir
                </button>
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
              {clientPhone && qrProgress && qrCodes.length > 0 && (
                <div>
                  <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4">Tarjetas y Premios</h3>
                  <div className="bg-gray-50 rounded-2xl p-6 border border-gray-100">
                    {(() => {
                      const redeemed = qrProgress.redeemedPrizeCodes || []
                      const eligible = qrCodes
                        .filter(c => qrProgress.scannedCodes.includes(c.id))
                        .filter(c => !!c.prize?.trim())
                        .filter(c => !redeemed.includes(c.id))

                      if (eligible.length === 0) {
                        return (
                          <p className="text-gray-500 text-sm">
                            No tienes premios disponibles por canjear.
                          </p>
                        )
                      }

                      return (
                        <div className="space-y-3">
                          {eligible.map((code) => (
                            <div key={code.id} className="flex items-center justify-between gap-4 bg-white rounded-xl p-4 border border-gray-100">
                              <div className="min-w-0">
                                <p className="font-bold text-gray-900 truncate">🎫 {code.name}</p>
                                <p className="text-sm text-gray-600 truncate">Premio: {code.prize}</p>
                              </div>
                              <button
                                onClick={() => addQrPrizeToCart(code)}
                                disabled={redeemingQrId === code.id}
                                className="px-4 py-2 rounded-xl bg-red-600 text-white text-xs font-black uppercase hover:bg-red-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                              >
                                {redeemingQrId === code.id ? 'Agregando...' : 'Agregar al carrito'}
                              </button>
                            </div>
                          ))}
                        </div>
                      )
                    })()}
                  </div>
                </div>
              )}

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
            <h2 className="text-2xl sm:text-3xl font-black text-gray-900 tracking-tight">
              Nuestro Menú
            </h2>
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
                <div className="flex items-center gap-3 mb-6">
                  <h3 className="text-lg sm:text-xl font-bold text-gray-800 tracking-wide uppercase">{category}</h3>
                </div>
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
        <div className="fixed bottom-8 right-6 z-[80]">
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
                <div className="text-xs text-gray-400 font-bold uppercase tracking-widest leading-none mb-1">Total</div>
                <div className="text-lg font-black leading-none">${cartTotal.toFixed(2)}</div>
              </div>
              <div className="pl-2 border-l border-white/10 group-hover:translate-x-1 transition-transform">
                <i className="bi bi-chevron-right text-gray-400"></i>
              </div>
            </div>
          </button>
        </div>
      )}

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
        businessUsername={business?.username}
        getCartItemQuantity={getCartItemQuantity}
        updateQuantity={updateQuantity}
        onOpenCart={() => setIsCartOpen(true)}
        cartItemsCount={cartItemsCount}
      />

      {/* Notificación temporal - Premium Toast */}
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
            <div className="flex gap-5 overflow-x-auto pb-8 no-scrollbar snap-x scroll-smooth other-stores-carousel">
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
                        <div className="text-xs text-gray-400">Sin calificaciones</div>
                      )}
                    </div>
                    {store.description && (
                      <p className="text-sm text-gray-600 line-clamp-2 mb-3">{store.description}</p>
                    )}
                    <div className="text-xs text-[#aa1918] font-medium flex items-center gap-2">
                      <span className="bg-red-50 px-2 py-0.5 rounded-full">Envío $1</span>
                    </div>
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

          <style jsx>{`
            .no-scrollbar::-webkit-scrollbar {
              display: none;
            }
            .no-scrollbar {
              -ms-overflow-style: none;
              scrollbar-width: none;
            }
          `}</style>
        </div>
      )}
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

      {/* Modal de Referidos */}
      <ReferralModal
        isOpen={referralModalOpen}
        onClose={() => setReferralModalOpen(false)}
        product={selectedProductForReferral}
        referralLink={generatedReferralLink}
        businessName={business?.name || ''}
      />
    </div>
  )
}