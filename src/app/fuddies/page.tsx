'use client'

import React, { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import {
  getGlobalProductReviews,
  GlobalProductReviewItem,
  toggleRatingLike,
  addStoreRatingReply,
  searchClientByPhone,
  createClient
} from '@/lib/database'
import { useAuth } from '@/contexts/AuthContext'
import StarRating from '@/components/StarRating'
import { formatRelativeTime } from '@/lib/date-utils'
import { formatPrice } from '@/lib/price-utils'
import { normalizeEcuadorianPhone, validateEcuadorianPhone } from '@/lib/validation'
import {
  Heart,
  MessageSquare,
  Share2,
  ShoppingBag,
  Sparkles,
  Camera,
  Search,
  ArrowUp,
  Loader2,
  X,
  Check,
  Store,
  ChevronRight,
  Star
} from 'lucide-react'

const ProductDetailSidebar = dynamic(() => import('@/components/ProductDetailSidebar'), { ssr: false })

type FilterType = 'all' | 'with_photo' | 'top_rated' | 'most_replied'

export default function FuddiesPage() {
  const { user, login } = useAuth()

  const [reviews, setReviews] = useState<GlobalProductReviewItem[]>([])
  const [loading, setLoading] = useState(true)
  const [activeFilter, setActiveFilter] = useState<FilterType>('all')
  const [searchQuery, setSearchQuery] = useState('')

  // Interacción social
  const [activeCardId, setActiveCardId] = useState<string | null>(null)
  const [replyInputText, setReplyInputText] = useState<{ [cardId: string]: string }>({})
  const [isSendingReply, setIsSendingReply] = useState<{ [cardId: string]: boolean }>({})

  // Visor de foto ampliada
  const [viewingPhotoUrl, setViewingPhotoUrl] = useState<string | null>(null)

  // Apertura de Sidebar de Detalle de Producto
  const [selectedProduct, setSelectedProduct] = useState<any | null>(null)
  const [selectedBusiness, setSelectedBusiness] = useState<any | null>(null)
  const [isProductSidebarOpen, setIsProductSidebarOpen] = useState(false)

  // Modal para comentar si no está logueado
  const [showGuestModal, setShowGuestModal] = useState(false)
  const [guestActionData, setGuestActionData] = useState<{ type: 'like' | 'reply'; item?: GlobalProductReviewItem } | null>(null)
  const [guestName, setGuestName] = useState('')
  const [guestPhone, setGuestPhone] = useState('')
  const [guestError, setGuestError] = useState('')
  const [guestLoading, setGuestLoading] = useState(false)

  // Notificación de copiado
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true
    setLoading(true)
    getGlobalProductReviews(80)
      .then((data) => {
        if (isMounted) {
          setReviews(data)
          setLoading(false)
        }
      })
      .catch((err) => {
        console.error('Error loading global reviews:', err)
        if (isMounted) setLoading(false)
      })

    return () => {
      isMounted = false
    }
  }, [])

  // Listener para cerrar visor de fotos con tecla Escape
  useEffect(() => {
    if (!viewingPhotoUrl) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setViewingPhotoUrl(null)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [viewingPhotoUrl])

  // Filtrado de opiniones
  const filteredReviews = useMemo(() => {
    let list = [...reviews]

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      list = list.filter((r) => {
        const prodMatch = r.productName?.toLowerCase().includes(q)
        const bizMatch = r.businessName?.toLowerCase().includes(q)
        const commentMatch = r.comment?.toLowerCase().includes(q)
        const clientMatch = r.clientName?.toLowerCase().includes(q)
        return prodMatch || bizMatch || commentMatch || clientMatch
      })
    }

    switch (activeFilter) {
      case 'with_photo':
        return list.filter((r) => Boolean(r.image))
      case 'top_rated':
        return list.filter((r) => r.rating >= 5)
      case 'most_replied':
        return list.filter((r) => (r.replies?.length || 0) > 0)
      case 'all':
      default:
        return list
    }
  }, [reviews, activeFilter, searchQuery])

  // Identificador de usuario para likes
  const effectiveUserIdentifier = user?.celular || user?.id || ''

  // Manejador de Like
  const handleToggleLike = async (item: GlobalProductReviewItem, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!effectiveUserIdentifier) {
      setGuestActionData({ type: 'like', item })
      setShowGuestModal(true)
      return
    }

    const currentLikes = item.likes || []
    const isCurrentlyLiked = currentLikes.includes(effectiveUserIdentifier)
    const newLikes = isCurrentlyLiked
      ? currentLikes.filter((id) => id !== effectiveUserIdentifier)
      : [...currentLikes, effectiveUserIdentifier]

    // Actualización optimista
    setReviews((prev) =>
      prev.map((r) => {
        if (r.ratingDocId === item.ratingDocId) {
          return { ...r, likes: newLikes }
        }
        return r
      })
    )

    try {
      await toggleRatingLike(item.businessId, item.ratingDocId, effectiveUserIdentifier)
    } catch (err) {
      console.error('Error toggling like:', err)
      // Revertir en caso de error
      setReviews((prev) =>
        prev.map((r) => {
          if (r.ratingDocId === item.ratingDocId) {
            return { ...r, likes: currentLikes }
          }
          return r
        })
      )
    }
  }

  // Manejador de Respuestas
  const handleSendReply = async (item: GlobalProductReviewItem, e: React.FormEvent) => {
    e.preventDefault()
    const text = replyInputText[item.id]?.trim()
    if (!text) return

    if (!user) {
      setGuestActionData({ type: 'reply', item })
      setShowGuestModal(true)
      return
    }

    setIsSendingReply((prev) => ({ ...prev, [item.id]: true }))
    try {
      const replyPayload = {
        userName: user.nombres || 'Cliente',
        userPhone: user.celular || '',
        userPhoto: (user as any).photoURL || '',
        comment: text
      }

      await addStoreRatingReply(item.businessId, item.ratingDocId, replyPayload)

      const newReplyObj = {
        ...replyPayload,
        id: Math.random().toString(36).substring(7),
        createdAt: new Date()
      }

      setReviews((prev) =>
        prev.map((r) => {
          if (r.ratingDocId === item.ratingDocId) {
            return {
              ...r,
              replies: [...(r.replies || []), newReplyObj]
            }
          }
          return r
        })
      )

      setReplyInputText((prev) => ({ ...prev, [item.id]: '' }))
    } catch (err) {
      console.error('Error sending reply:', err)
    } finally {
      setIsSendingReply((prev) => ({ ...prev, [item.id]: false }))
    }
  }

  // Compartir opinión o producto
  const handleShare = async (item: GlobalProductReviewItem, e: React.MouseEvent) => {
    e.stopPropagation()
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    const shareUrl = item.productSlug && item.businessUsername
      ? `${origin}/${item.businessUsername}/${item.productSlug}`
      : item.businessUsername
      ? `${origin}/${item.businessUsername}`
      : `${origin}/fuddies`

    const shareTitle = item.productName
      ? `Mira la opinión de ${item.productName} en ${item.businessName}`
      : `Opinión en ${item.businessName}`

    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: shareTitle,
          text: item.comment ? `"${item.comment}"` : shareTitle,
          url: shareUrl
        })
        return
      } catch (err) {
        // Fallback a clipboard
      }
    }

    try {
      await navigator.clipboard.writeText(shareUrl)
      setToastMessage('¡Enlace copiado al portapapeles!')
      setTimeout(() => setToastMessage(null), 2500)
    } catch (err) {
      console.error('Error copying share link:', err)
    }
  }

  // Abrir detalle del producto
  const handleOpenProduct = (item: GlobalProductReviewItem, e: React.MouseEvent) => {
    e.stopPropagation()
    if (item.product && item.business) {
      setSelectedProduct(item.product)
      setSelectedBusiness(item.business)
      setIsProductSidebarOpen(true)
    } else if (item.productId && item.business) {
      const syntheticProduct: any = {
        id: item.productId,
        name: item.productName || 'Producto',
        image: item.productImage || '',
        price: item.productPrice || 0,
        businessId: item.businessId,
        slug: item.productSlug
      }
      setSelectedProduct(syntheticProduct)
      setSelectedBusiness(item.business)
      setIsProductSidebarOpen(true)
    }
  }

  // Manejador del modal de huésped/invitado
  const handleGuestSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const cleanPhone = guestPhone.trim()
    const cleanName = guestName.trim()

    if (!cleanName) {
      setGuestError('Ingresa tu nombre')
      return
    }
    if (!cleanPhone) {
      setGuestError('Ingresa tu número de celular')
      return
    }

    const normalized = normalizeEcuadorianPhone(cleanPhone)
    if (!validateEcuadorianPhone(normalized)) {
      setGuestError('Ingresa un número válido de 10 dígitos (ej: 0991234567)')
      return
    }

    setGuestLoading(true)
    setGuestError('')
    try {
      let client = await searchClientByPhone(normalized)
      if (client) {
        login(client)
      } else {
        const newClient = await createClient({
          celular: normalized,
          nombres: cleanName,
          fecha_de_registro: new Date().toISOString()
        })
        if (newClient) {
          client = newClient
          login(newClient)
        }
      }

      setShowGuestModal(false)
      const actionItem = guestActionData?.item
      if (guestActionData?.type === 'like' && actionItem) {
        handleToggleLike(actionItem, { stopPropagation: () => {} } as any)
      }
    } catch (err) {
      console.error('Error in guest submit:', err)
      setGuestError('Ocurrió un error. Intenta de nuevo.')
    } finally {
      setGuestLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#fafaf9] text-gray-900 pb-28">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-[300] bg-gray-900 text-white px-4 py-2.5 rounded-2xl shadow-xl flex items-center gap-2 text-xs font-bold animate-in fade-in slide-in-from-top-4 duration-200">
          <Check size={15} className="text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Header Social */}
      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-gray-100 shadow-[0_2px_12px_-4px_rgba(0,0,0,0.04)]">
        <div className="max-w-xl mx-auto px-4 py-3.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-[#aa1918] to-red-500 text-white flex items-center justify-center shadow-md shadow-red-500/20">
                <i className="bi bi-people-fill text-xl"></i>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-lg font-black text-gray-900 tracking-tight leading-none">
                    Fuddies
                  </h1>
                  <span className="bg-red-50 text-[#aa1918] border border-red-100 text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full">
                    Social
                  </span>
                </div>
                <p className="text-[11px] font-medium text-gray-500 mt-0.5">
                  Opiniones y experiencias de la comunidad
                </p>
              </div>
            </div>

            <Link
              href="/"
              className="text-xs font-bold text-gray-500 hover:text-gray-900 bg-gray-100 hover:bg-gray-200/80 px-3 py-1.5 rounded-xl transition-all flex items-center gap-1"
            >
              <Store size={14} />
              <span className="hidden sm:inline">Tiendas</span>
            </Link>
          </div>

          {/* Buscador */}
          <div className="mt-3 relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por plato, restaurante u opinión..."
              className="w-full bg-gray-50/90 border border-gray-200/80 rounded-2xl pl-10 pr-4 py-2 text-xs text-gray-900 font-medium placeholder:text-gray-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-0.5"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Filtros de Navegación */}
          <div className="flex items-center gap-2 mt-2.5 overflow-x-auto no-scrollbar pb-0.5">
            <button
              onClick={() => setActiveFilter('all')}
              className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all flex-shrink-0 ${
                activeFilter === 'all'
                  ? 'bg-gray-900 text-white shadow-sm'
                  : 'bg-gray-100/90 text-gray-600 hover:bg-gray-200/80'
              }`}
            >
              Todos
            </button>
            <button
              onClick={() => setActiveFilter('with_photo')}
              className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all flex-shrink-0 flex items-center gap-1.5 ${
                activeFilter === 'with_photo'
                  ? 'bg-gray-900 text-white shadow-sm'
                  : 'bg-gray-100/90 text-gray-600 hover:bg-gray-200/80'
              }`}
            >
              <Camera size={13} />
              <span>Con fotos</span>
            </button>
            <button
              onClick={() => setActiveFilter('top_rated')}
              className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all flex-shrink-0 flex items-center gap-1.5 ${
                activeFilter === 'top_rated'
                  ? 'bg-gray-900 text-white shadow-sm'
                  : 'bg-gray-100/90 text-gray-600 hover:bg-gray-200/80'
              }`}
            >
              <Star size={13} className="fill-amber-400 text-amber-400" />
              <span>5 estrellas</span>
            </button>
            <button
              onClick={() => setActiveFilter('most_replied')}
              className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all flex-shrink-0 flex items-center gap-1.5 ${
                activeFilter === 'most_replied'
                  ? 'bg-gray-900 text-white shadow-sm'
                  : 'bg-gray-100/90 text-gray-600 hover:bg-gray-200/80'
              }`}
            >
              <MessageSquare size={13} />
              <span>Comentados</span>
            </button>
          </div>
        </div>
      </header>

      {/* Contenido Principal */}
      <main className="max-w-xl mx-auto px-4 pt-4 space-y-4">
        {loading ? (
          /* Skeletons de carga */
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="bg-white rounded-3xl p-4 sm:p-5 border border-gray-100 shadow-sm space-y-3 animate-pulse"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-gray-200" />
                    <div className="space-y-1.5">
                      <div className="w-24 h-3 bg-gray-200 rounded" />
                      <div className="w-16 h-2 bg-gray-100 rounded" />
                    </div>
                  </div>
                  <div className="w-16 h-4 bg-gray-200 rounded-full" />
                </div>
                <div className="w-full h-14 bg-gray-100 rounded-2xl" />
                <div className="w-3/4 h-3 bg-gray-200 rounded" />
              </div>
            ))}
          </div>
        ) : filteredReviews.length > 0 ? (
          /* Lista de Opiniones */
          filteredReviews.map((item) => {
            const isSelected = activeCardId === item.id
            const likes = item.likes || []
            const isLiked = effectiveUserIdentifier ? likes.includes(effectiveUserIdentifier) : false
            const likesCount = likes.length
            const repliesCount = item.replies?.length || 0

            return (
              <article
                key={item.id}
                onClick={() => setActiveCardId(isSelected ? null : item.id)}
                className={`bg-white rounded-3xl p-4 sm:p-5 border transition-all cursor-pointer space-y-3.5 ${
                  isSelected
                    ? 'border-amber-300 ring-2 ring-amber-100 shadow-md'
                    : 'border-gray-100 shadow-sm hover:border-gray-200 hover:shadow-md'
                }`}
              >
                {/* Cabecera: Tienda + Cliente */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {/* Avatar del Cliente */}
                    <div className="w-8 h-8 rounded-full bg-amber-100/80 text-amber-800 font-black text-xs flex items-center justify-center border border-amber-200/60 flex-shrink-0 overflow-hidden">
                      {item.clientPhotoURL ? (
                        <img
                          src={item.clientPhotoURL}
                          alt={item.clientName || 'Cliente'}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            ;(e.target as HTMLElement).style.display = 'none'
                          }}
                        />
                      ) : (
                        <span>{item.clientName?.charAt(0)?.toUpperCase() || 'C'}</span>
                      )}
                    </div>

                    <div className="min-w-0">
                      <p className="text-xs font-black text-gray-900 leading-none truncate">
                        {item.clientName || 'Cliente'}
                      </p>
                      <p className="text-[10px] text-gray-400 font-medium mt-0.5 truncate">
                        <span>{item.createdAt ? formatRelativeTime(item.createdAt) : 'Reciente'}</span>
                        <span className="mx-1 text-gray-300">•</span>
                        <Link
                          href={`/${item.businessUsername || item.businessId}`}
                          onClick={(e) => e.stopPropagation()}
                          className="font-bold text-gray-600 hover:text-[#aa1918] transition-colors"
                        >
                          {item.businessName || 'Tienda'}
                        </Link>
                      </p>
                    </div>
                  </div>

                  {/* Calificación: 1 sola estrella con la puntuación */}
                  <div className="flex items-center gap-1 flex-shrink-0 bg-amber-50/90 border border-amber-100/90 px-2.5 py-1 rounded-xl shadow-sm">
                    <Star size={13} className="fill-amber-400 text-amber-400 flex-shrink-0" />
                    <span className="text-xs font-black text-amber-950 leading-none">
                      {typeof item.rating === 'number' && item.rating > 0 ? item.rating.toFixed(1) : '5.0'}
                    </span>
                  </div>
                </div>

                {/* Tarjeta del Producto Calificado (si aplica) */}
                {item.productName && (
                  <div
                    onClick={(e) => handleOpenProduct(item, e)}
                    className="group bg-gray-50/80 hover:bg-gray-100/80 border border-gray-100 rounded-2xl p-2.5 flex items-center justify-between gap-3 transition-all"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-11 h-11 rounded-xl bg-white border border-gray-100 overflow-hidden flex-shrink-0 shadow-sm">
                        {item.productImage ? (
                          <img
                            src={item.productImage}
                            alt={item.productName}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-gray-300">
                            <ShoppingBag size={18} />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <span className="text-[9px] font-black uppercase tracking-wider text-red-600 bg-red-50 px-1.5 py-0.2 rounded-md">
                          Plato calificado
                        </span>
                        <p className="text-xs font-black text-gray-900 tracking-tight leading-snug truncate mt-0.5">
                          {item.productName}
                        </p>
                        {item.productPrice !== undefined && item.productPrice > 0 && (
                          <p className="text-[11px] font-bold text-gray-600">
                            {formatPrice(item.productPrice)}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 text-xs font-bold text-gray-500 group-hover:text-gray-900 flex-shrink-0 pr-1">
                      <span className="hidden sm:inline text-[11px]">Ver plato</span>
                      <ChevronRight size={15} />
                    </div>
                  </div>
                )}

                {/* Comentario Principal */}
                {item.comment && item.comment.trim() ? (
                  <p className="text-xs sm:text-sm text-gray-700 font-medium leading-relaxed px-0.5">
                    {item.comment}
                  </p>
                ) : null}

                {/* Foto Adjunta (si existe) */}
                {item.image && (
                  <div className="overflow-hidden rounded-2xl border border-gray-100 bg-gray-50 max-w-sm w-full">
                    <img
                      src={item.image}
                      alt="Foto de la opinión"
                      className="w-full h-48 sm:h-56 object-cover hover:scale-[1.02] transition-transform duration-300 cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation()
                        setViewingPhotoUrl(item.image!)
                      }}
                    />
                  </div>
                )}

                {/* Barra de Acciones Sociales */}
                <div className="flex items-center justify-between pt-1 border-t border-gray-50">
                  <div className="flex items-center gap-4">
                    {/* Botón Me Gusta */}
                    <button
                      type="button"
                      onClick={(e) => handleToggleLike(item, e)}
                      className={`flex items-center gap-1.5 py-1 text-xs font-bold transition-all active:scale-95 ${
                        isLiked
                          ? 'text-rose-600'
                          : 'text-gray-500 hover:text-gray-900'
                      }`}
                    >
                      <Heart
                        size={16}
                        className={isLiked ? 'fill-rose-500 text-rose-500' : 'text-gray-400'}
                      />
                      <span>{likesCount > 0 ? likesCount : ''} Me gusta</span>
                    </button>

                    {/* Botón Comentar / Respuestas */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setActiveCardId(isSelected ? null : item.id)
                      }}
                      className={`flex items-center gap-1.5 py-1 text-xs font-bold transition-all active:scale-95 ${
                        isSelected
                          ? 'text-amber-600'
                          : 'text-gray-500 hover:text-gray-900'
                      }`}
                    >
                      <MessageSquare
                        size={16}
                        className={isSelected ? 'text-amber-600' : 'text-gray-400'}
                      />
                      <span>
                        {repliesCount > 0
                          ? `${repliesCount} ${repliesCount === 1 ? 'respuesta' : 'respuestas'}`
                          : 'Comentar'}
                      </span>
                    </button>
                  </div>

                  {/* Botón Compartir */}
                  <button
                    type="button"
                    onClick={(e) => handleShare(item, e)}
                    className="p-1.5 text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded-xl transition-all"
                    title="Compartir"
                  >
                    <Share2 size={16} />
                  </button>
                </div>

                {/* Sección Expandida: Hilo de Respuestas */}
                {isSelected && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="pt-2 border-t border-gray-100 space-y-2.5 animate-in fade-in duration-200"
                  >
                    {/* Lista de respuestas */}
                    {item.replies && item.replies.length > 0 && (
                      <div className="space-y-2 pl-2 border-l-2 border-gray-200">
                        {item.replies.map((reply: any, rIdx: number) => (
                          <div
                            key={reply.id || rIdx}
                            className="bg-gray-50/80 border border-gray-100 p-2.5 rounded-xl text-xs space-y-1"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5">
                                <div className="w-5 h-5 rounded-full bg-gray-200 text-gray-800 font-black text-[9px] flex items-center justify-center flex-shrink-0 overflow-hidden">
                                  {reply.userPhoto ? (
                                    <img
                                      src={reply.userPhoto}
                                      alt={reply.userName || 'Cliente'}
                                      className="w-full h-full object-cover"
                                      onError={(e) => {
                                        ;(e.target as HTMLElement).style.display = 'none'
                                      }}
                                    />
                                  ) : (
                                    <span>{reply.userName?.charAt(0)?.toUpperCase() || 'C'}</span>
                                  )}
                                </div>
                                <span className="font-black text-gray-800 text-[11px]">
                                  {reply.userName || 'Cliente'}
                                </span>
                              </div>
                              <span className="text-[10px] text-gray-400">
                                {reply.createdAt ? formatRelativeTime(reply.createdAt) : ''}
                              </span>
                            </div>
                            <p className="text-gray-600 font-medium leading-relaxed pl-6.5">
                              {reply.comment}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Formulario para responder */}
                    <form
                      onSubmit={(e) => handleSendReply(item, e)}
                      className="flex items-center gap-2 pt-1"
                    >
                      <input
                        type="text"
                        value={replyInputText[item.id] || ''}
                        onChange={(e) =>
                          setReplyInputText({
                            ...replyInputText,
                            [item.id]: e.target.value
                          })
                        }
                        placeholder="Escribe una respuesta o comentario..."
                        className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-medium text-gray-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-gray-900 transition-all"
                      />
                      <button
                        type="submit"
                        disabled={
                          !replyInputText[item.id]?.trim() ||
                          isSendingReply[item.id]
                        }
                        className="w-8 h-8 bg-gray-900 hover:bg-black text-white rounded-xl flex items-center justify-center transition-all disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0 active:scale-95 shadow-sm"
                        title="Enviar respuesta"
                      >
                        {isSendingReply[item.id] ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : (
                          <ArrowUp size={14} strokeWidth={2.5} />
                        )}
                      </button>
                    </form>
                  </div>
                )}
              </article>
            )
          })
        ) : (
          /* Estado Vacío */
          <div className="py-16 text-center flex flex-col items-center justify-center bg-white rounded-3xl border border-gray-100 p-8 shadow-sm">
            <div className="w-14 h-14 bg-amber-50 text-amber-500 rounded-2xl flex items-center justify-center text-2xl mb-3 border border-amber-100 shadow-inner">
              ⭐
            </div>
            <h3 className="text-sm font-black text-gray-900 uppercase tracking-wider">
              No se encontraron opiniones
            </h3>
            <p className="text-xs text-gray-500 mt-1.5 max-w-xs leading-relaxed font-medium">
              {searchQuery
                ? 'Intenta con otro término de búsqueda o limpia los filtros.'
                : 'Sé el primero en calificar tus platos favoritos al recibir tus pedidos en Fuddi.'}
            </p>
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="mt-3 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-800 text-xs font-bold rounded-xl transition-all"
              >
                Limpiar búsqueda
              </button>
            )}
          </div>
        )}
      </main>

      {/* Visor Modal de Fotos */}
      {viewingPhotoUrl && (
        <div
          className="fixed inset-0 z-[250] bg-black/85 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={() => setViewingPhotoUrl(null)}
        >
          <button
            type="button"
            onClick={() => setViewingPhotoUrl(null)}
            className="absolute top-5 right-5 w-10 h-10 bg-white/15 hover:bg-white/25 text-white rounded-full flex items-center justify-center backdrop-blur-sm transition-colors z-10"
            title="Cerrar"
          >
            <X size={20} />
          </button>
          <img
            src={viewingPhotoUrl}
            alt="Foto ampliada"
            className="max-w-full max-h-[85vh] object-contain rounded-2xl shadow-2xl border border-white/10"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* Modal de Identificación para Visitantes / Huéspedes */}
      {showGuestModal && (
        <div className="fixed inset-0 z-[260] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl border border-gray-100 space-y-4 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-red-50 text-[#aa1918] flex items-center justify-center">
                  <Sparkles size={16} />
                </div>
                <h4 className="text-sm font-black text-gray-900">
                  Participa en Fuddies
                </h4>
              </div>
              <button
                onClick={() => setShowGuestModal(false)}
                className="w-7 h-7 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center hover:bg-gray-200"
              >
                <X size={14} />
              </button>
            </div>

            <p className="text-xs text-gray-600 font-medium leading-relaxed">
              Ingresa tu nombre y celular para interactuar, dar me gusta y comentar opiniones de la comunidad.
            </p>

            <form onSubmit={handleGuestSubmit} className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-1">
                  Tu nombre:
                </label>
                <input
                  type="text"
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  placeholder="Ej: Carlos Mendoza"
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-900 font-medium focus:bg-white focus:outline-none focus:ring-2 focus:ring-gray-900"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-1">
                  Número de celular:
                </label>
                <input
                  type="tel"
                  value={guestPhone}
                  onChange={(e) => setGuestPhone(e.target.value)}
                  placeholder="Ej: 0991234567"
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-900 font-medium focus:bg-white focus:outline-none focus:ring-2 focus:ring-gray-900"
                />
              </div>

              {guestError && (
                <p className="text-[11px] text-red-600 font-bold bg-red-50 p-2 rounded-xl border border-red-100">
                  {guestError}
                </p>
              )}

              <button
                type="submit"
                disabled={guestLoading}
                className="w-full py-2.5 rounded-xl bg-gray-900 hover:bg-black text-white text-xs font-black transition-all flex items-center justify-center gap-2 shadow-md disabled:opacity-50"
              >
                {guestLoading ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <span>Continuar</span>
                )}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Sidebar de Detalle de Producto Integrado */}
      {isProductSidebarOpen && selectedProduct && (
        <ProductDetailSidebar
          isOpen={isProductSidebarOpen}
          onClose={() => setIsProductSidebarOpen(false)}
          product={selectedProduct}
          business={selectedBusiness}
          onProductSelect={(prod) => setSelectedProduct(prod)}
        />
      )}
    </div>
  )
}
