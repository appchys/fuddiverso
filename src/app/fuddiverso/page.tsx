'use client'

import React, { useState, useEffect, useMemo, useRef, useCallback, Suspense } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useSearchParams } from 'next/navigation'
import {
  getGlobalProductReviewsPaginated,
  getCachedCommunityReviews,
  GlobalProductReviewItem,
  toggleRatingLike,
  addStoreRatingReply,
  searchClientByPhone,
  createClient,
  createCommunityPost,
  updateCommunityPost,
  deleteCommunityPost,
  uploadImage,
  getBusiness,
  getUserBusinessAccess
} from '@/lib/database'
import { auth } from '@/lib/firebase'
import { onAuthStateChanged } from 'firebase/auth'
import { Product, Business } from '@/types'
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
  Star,
  Plus,
  Tag,
  Send,
  SlidersHorizontal,
  MoreVertical,
  Pencil,
  Trash2
} from 'lucide-react'

const ProductDetailSidebar = dynamic(() => import('@/components/ProductDetailSidebar'), { ssr: false })
const TagProductModal = dynamic(() => import('@/components/TagProductModal'), { ssr: false })

type FilterType = 'all' | 'with_photo' | 'top_rated' | 'most_replied'

function FuddiversoContent() {
  const { user, login } = useAuth()
  const searchParams = useSearchParams()
  const targetPostId = searchParams?.get('post') || null
  const [highlightedPostId, setHighlightedPostId] = useState<string | null>(null)
  const hasScrolledRef = useRef(false)

  // Inicialización segura para evitar discrepancias de hidratación con SSR
  const [reviews, setReviews] = useState<GlobalProductReviewItem[]>([])
  const [loading, setLoading] = useState(true)
  const [hasMore, setHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [cursor, setCursor] = useState<any>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const isFetchingMoreRef = useRef(false)
  const [activeFilter, setActiveFilter] = useState<FilterType>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [isFilterPopoverOpen, setIsFilterPopoverOpen] = useState(false)
  const filterPopoverRef = useRef<HTMLDivElement>(null)

  // Estados para identidad activa (Cliente vs Tienda)
  const [userStore, setUserStore] = useState<Business | null>(null)
  const [activeIdentity, setActiveIdentity] = useState<'client' | 'business'>('client')

  // Cargar publicaciones en memoria y preferencia de identidad guardada en el cliente
  useEffect(() => {
    const cached = getCachedCommunityReviews()
    if (cached && cached.length > 0) {
      const valid = cached.filter((r) => Boolean((r.comment && r.comment.trim().length > 0) || r.image))
      setReviews(valid)
      if (valid.length > 0) setLoading(false)
    }
    const saved = localStorage.getItem('fuddiverso_identity')
    if (saved === 'business' || saved === 'client') {
      setActiveIdentity(saved)
    }
  }, [])

  // Alternar identidad exclusivamente al hacer clic en el avatar
  const toggleIdentity = useCallback(() => {
    if (!userStore) return
    setActiveIdentity((prev) => {
      const next = prev === 'business' ? 'client' : 'business'
      if (typeof window !== 'undefined') {
        localStorage.setItem('fuddiverso_identity', next)
      }
      return next
    })
  }, [userStore])

  const isBusinessActor = Boolean(userStore && activeIdentity === 'business')

  // Detectar y cargar la tienda del usuario (si es dueño o administrador)
  useEffect(() => {
    let isMounted = true

    const detectStore = async () => {
      try {
        const savedBusinessId = typeof window !== 'undefined'
          ? (localStorage.getItem('businessId') || localStorage.getItem('currentBusinessId'))
          : null

        // 1. Consultar acceso a negocios mediante sesión
        const firebaseUser = auth?.currentUser
        const emailToSearch = firebaseUser?.email || (user as any)?.googleEmail || user?.email || ''
        const uidToSearch = firebaseUser?.uid || (user as any)?.googleUid || user?.id || ''

        let foundBusiness: Business | null = null

        if (emailToSearch || uidToSearch) {
          try {
            const access = await getUserBusinessAccess(emailToSearch, uidToSearch)
            const businesses = [
              ...(access.ownedBusinesses || []),
              ...(access.adminBusinesses || [])
            ].filter((b: any) => !b.isHidden)

            if (businesses.length > 0) {
              const matched = savedBusinessId
                ? businesses.find((b: any) => b.id === savedBusinessId)
                : null
              foundBusiness = matched || businesses[0]
            }
          } catch (accessErr) {
            console.warn('No se pudo obtener acceso a negocios via email/uid:', accessErr)
          }
        }

        // 2. Si no se encontró por email/uid pero hay un businessId guardado en localStorage
        if (!foundBusiness && savedBusinessId) {
          try {
            foundBusiness = await getBusiness(savedBusinessId)
          } catch (bizErr) {
            console.warn('Error al cargar negocio por savedBusinessId:', bizErr)
          }
        }

        if (isMounted) {
          setUserStore(foundBusiness)
        }
      } catch (err) {
        console.error('Error al detectar tienda en fuddiverso:', err)
      }
    }

    detectStore()

    const unsubscribeAuth = onAuthStateChanged(auth, () => {
      detectStore()
    })

    return () => {
      isMounted = false
      unsubscribeAuth()
    }
  }, [user?.id, user?.email])

  // Estados del Formulario Inline de Publicación
  const [postComment, setPostComment] = useState('')
  const [postRating, setPostRating] = useState<number | null>(null)
  const [postHoverRating, setPostHoverRating] = useState<number | null>(null)
  const [isRatingSelectorOpen, setIsRatingSelectorOpen] = useState(false)
  const [postSelectedFile, setPostSelectedFile] = useState<File | null>(null)
  const [postImagePreview, setPostImagePreview] = useState<string | null>(null)
  const [taggedProduct, setTaggedProduct] = useState<Product | null>(null)
  const [taggedBusiness, setTaggedBusiness] = useState<Business | null>(null)
  const [isTagModalOpen, setIsTagModalOpen] = useState(false)
  const [postGuestName, setPostGuestName] = useState('')
  const [postGuestPhone, setPostGuestPhone] = useState('')
  const [postError, setPostError] = useState('')
  const [isSubmittingPost, setIsSubmittingPost] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Estados para Popover y acciones del dueño del post
  const [openMenuPostId, setOpenMenuPostId] = useState<string | null>(null)
  const [editingPost, setEditingPost] = useState<GlobalProductReviewItem | null>(null)
  const [editComment, setEditComment] = useState('')
  const [editRating, setEditRating] = useState(5)
  const [editHoverRating, setEditHoverRating] = useState<number | null>(null)
  const [editSelectedFile, setEditSelectedFile] = useState<File | null>(null)
  const [editImagePreview, setEditImagePreview] = useState<string | null>(null)
  const [editRemoveImage, setEditRemoveImage] = useState(false)
  const [isSavingEdit, setIsSavingEdit] = useState(false)
  const [editError, setEditError] = useState('')
  const editFileInputRef = useRef<HTMLInputElement>(null)

  const [deletingPost, setDeletingPost] = useState<GlobalProductReviewItem | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  // Click outside para cerrar popovers
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        filterPopoverRef.current &&
        !filterPopoverRef.current.contains(e.target as Node)
      ) {
        setIsFilterPopoverOpen(false)
      }
      const target = e.target as HTMLElement
      if (!target.closest('.post-options-popover-container')) {
        setOpenMenuPostId(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Listener de búsqueda emitida desde el Header flotante principal
  useEffect(() => {
    const handleSearchEvent = (e: any) => {
      setSearchQuery(e.detail || '')
    }
    window.addEventListener('fuddiverso-search', handleSearchEvent)
    window.addEventListener('fuddies-search', handleSearchEvent)
    return () => {
      window.removeEventListener('fuddiverso-search', handleSearchEvent)
      window.removeEventListener('fuddies-search', handleSearchEvent)
    }
  }, [])

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

  // Manejadores de foto inline
  const handlePostImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setPostSelectedFile(file)
    const reader = new FileReader()
    reader.onloadend = () => {
      setPostImagePreview(reader.result as string)
    }
    reader.readAsDataURL(file)
  }

  const handleRemovePostImage = () => {
    setPostSelectedFile(null)
    setPostImagePreview(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // Manejador de selección de producto o tienda etiquetada desde el modal
  const handleSelectTaggedProduct = (product: Product | null, business?: Business | null) => {
    setTaggedProduct(product)
    setTaggedBusiness(business || null)
  }

  // Enviar publicación inline
  const handleSubmitInlinePost = async (e: React.FormEvent) => {
    e.preventDefault()
    setPostError('')

    if (!postComment.trim() && !postSelectedFile) {
      setPostError('Escribe una opinión o sube una foto para publicar')
      return
    }

    const isBusiness = Boolean(userStore && activeIdentity === 'business')

    let authorName = isBusiness
      ? userStore!.name
      : (user?.nombres?.trim() || postGuestName.trim())
    let authorPhone = isBusiness
      ? (userStore!.phone || `business_${userStore!.id}`)
      : (user?.celular?.trim() || postGuestPhone.trim())
    let authorPhoto = isBusiness
      ? (userStore!.image || '')
      : ((user as any)?.photoURL || (user as any)?.clientPhotoUrl || '')

    if (!isBusiness && !user) {
      if (!authorName) {
        setPostError('Ingresa tu nombre')
        return
      }
      if (!authorPhone) {
        setPostError('Ingresa tu celular')
        return
      }
      const normalizedPhone = normalizeEcuadorianPhone(authorPhone)
      if (!validateEcuadorianPhone(normalizedPhone)) {
        setPostError('Ingresa un número de celular válido de 10 dígitos')
        return
      }
      authorPhone = normalizedPhone
    }

    const targetBusinessId = taggedProduct?.businessId || taggedBusiness?.id || (isBusiness ? userStore!.id : '')
    if (!targetBusinessId) {
      setPostError('Por favor etiqueta el plato o restaurante correspondiente')
      return
    }

    setIsSubmittingPost(true)
    try {
      if (!isBusiness && !user && authorPhone) {
        try {
          let client = await searchClientByPhone(authorPhone)
          if (client) {
            login(client)
          } else {
            const newClient = await createClient({
              celular: authorPhone,
              nombres: authorName,
              fecha_de_registro: new Date().toISOString()
            })
            if (newClient) login(newClient)
          }
        } catch (authErr) {
          console.error('Error authenticating guest client:', authErr)
        }
      }

      let uploadedImageUrl = ''
      if (postSelectedFile) {
        const filePath = `ratings/${targetBusinessId}_${Date.now()}`
        uploadedImageUrl = await uploadImage(postSelectedFile, filePath)
      }

      const newReview = await createCommunityPost({
        businessId: targetBusinessId,
        rating: postRating,
        comment: postComment.trim(),
        image: uploadedImageUrl,
        clientName: authorName,
        clientPhone: authorPhone,
        clientPhotoURL: authorPhoto,
        product: taggedProduct
          ? {
              id: taggedProduct.id,
              name: taggedProduct.name,
              image: taggedProduct.image || '',
              price: taggedProduct.price || 0,
              slug: taggedProduct.slug || taggedProduct.id
            }
          : undefined
      })

      setReviews((prev) => [newReview, ...prev])
      setToastMessage('¡Publicación compartida!')
      setTimeout(() => setToastMessage(null), 2500)

      // Reset formulario inline
      setPostComment('')
      setPostRating(null)
      setPostHoverRating(null)
      setIsRatingSelectorOpen(false)
      setPostSelectedFile(null)
      setPostImagePreview(null)
      setTaggedProduct(null)
      setTaggedBusiness(null)
      setPostError('')
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (err) {
      console.error('Error submitting inline post:', err)
      setPostError('Ocurrió un error al publicar. Intenta nuevamente.')
    } finally {
      setIsSubmittingPost(false)
    }
  }

  // Carga inicial de posts (actualización en segundo plano si ya hay datos en memoria)
  useEffect(() => {
    let isMounted = true
    if (reviews.length === 0) {
      setLoading(true)
    }
    const initialLimit = targetPostId ? 15 : 10
    getGlobalProductReviewsPaginated(initialLimit)
      .then((result) => {
        if (isMounted) {
          setReviews((prev) => {
            const filtered = result.reviews.filter((r) => Boolean((r.comment && r.comment.trim().length > 0) || r.image))
            if (prev.length === 0) return filtered
            const existingMap = new Map(filtered.map((r) => [r.id, r]))
            const merged = prev.map((item) => existingMap.get(item.id) || item)
            filtered.forEach((item) => {
              if (!prev.some((p) => p.id === item.id)) {
                merged.push(item)
              }
            })
            return merged.filter((r) => Boolean((r.comment && r.comment.trim().length > 0) || r.image))
          })
          setCursor(result.lastVisible)
          setHasMore(result.hasMore)
          setLoading(false)
        }
      })
      .catch((err) => {
        console.error('Error loading initial reviews:', err)
        if (isMounted) setLoading(false)
      })

    return () => {
      isMounted = false
    }
  }, [targetPostId])

  // Desplazamiento automático y resaltado de la publicación objetivo (inmediato si ya está en DOM)
  useEffect(() => {
    if (!targetPostId || hasScrolledRef.current || reviews.length === 0) return

    const scrollToPost = () => {
      const el =
        document.getElementById(`post-${targetPostId}`) ||
        document.querySelector(`[data-post-id="${targetPostId}"]`) ||
        document.querySelector(`[data-rating-doc-id="${targetPostId}"]`)

      if (el) {
        hasScrolledRef.current = true
        setHighlightedPostId(targetPostId)
        setActiveCardId(targetPostId)

        setTimeout(() => {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }, 80)

        // Desvanecer el resaltado tras 3.5 segundos
        setTimeout(() => {
          setHighlightedPostId((current) => (current === targetPostId ? null : current))
        }, 3500)
      }
    }

    const timer = setTimeout(scrollToPost, 50)
    return () => clearTimeout(timer)
  }, [reviews, targetPostId])

  // Cargar siguientes 10 posts al llegar al fondo
  const handleLoadMore = useCallback(async () => {
    if (isFetchingMoreRef.current || !hasMore || loading) return
    isFetchingMoreRef.current = true
    setLoadingMore(true)
    try {
      const result = await getGlobalProductReviewsPaginated(10, cursor)
      setReviews((prev) => {
        const existingIds = new Set(prev.map((r) => r.id))
        const newItems = result.reviews.filter((r) => !existingIds.has(r.id) && Boolean((r.comment && r.comment.trim().length > 0) || r.image))
        return [...prev, ...newItems]
      })
      setCursor(result.lastVisible)
      setHasMore(result.hasMore)
    } catch (err) {
      console.error('Error loading more reviews:', err)
    } finally {
      setLoadingMore(false)
      isFetchingMoreRef.current = false
    }
  }, [hasMore, loading, cursor])

  // Si hay un post objetivo y no está en los posts iniciales pero hay más disponibles, cargar siguiente lote
  useEffect(() => {
    if (!targetPostId || loading || hasScrolledRef.current || !hasMore || loadingMore) return
    const exists = reviews.some(
      (r) => r.id === targetPostId || r.ratingDocId === targetPostId
    )
    if (!exists && reviews.length > 0 && reviews.length < 60) {
      handleLoadMore()
    }
  }, [targetPostId, loading, reviews, hasMore, loadingMore, handleLoadMore])

  // Observer para detectar scroll al fondo
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !loadingMore && !loading) {
          handleLoadMore()
        }
      },
      { threshold: 0.1, rootMargin: '250px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasMore, loadingMore, loading, handleLoadMore])

  // Listener para cerrar visor de fotos con tecla Escape
  useEffect(() => {
    if (!viewingPhotoUrl) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setViewingPhotoUrl(null)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [viewingPhotoUrl])

  // Filtrado de opiniones: solo mostrar posts con texto o foto (excluir los que son únicamente calificaciones)
  const filteredReviews = useMemo(() => {
    let list = reviews.filter((r) => Boolean((r.comment && r.comment.trim().length > 0) || r.image))

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
        return list.filter((r) => typeof r.rating === 'number' && r.rating >= 5)
      case 'most_replied':
        return list.filter((r) => (r.replies?.length || 0) > 0)
      case 'all':
      default:
        return list
    }
  }, [reviews, activeFilter, searchQuery])

  // Determinar si el usuario logueado es dueño de la reseña/publicación
  const isPostOwner = useCallback((item: GlobalProductReviewItem) => {
    if (userStore) {
      if (item.clientPhone === `business_${userStore.id}`) return true
      if (userStore.phone && item.clientPhone && userStore.phone.replace(/\D/g, '') === item.clientPhone.replace(/\D/g, '')) return true
      if (item.businessId === userStore.id && item.clientName === userStore.name) return true
    }
    if (!user) return false
    const userPhone = user.celular || (user as any)?.telefono || ''
    if (userPhone && item.clientPhone) {
      const normUser = normalizeEcuadorianPhone(userPhone)
      const normItem = normalizeEcuadorianPhone(item.clientPhone)
      if (normUser && normItem && normUser === normItem) return true
      if (userPhone.replace(/\D/g, '') === item.clientPhone.replace(/\D/g, '')) return true
    }
    if (user.id && (item as any).clientId && (item as any).clientId === user.id) return true
    if (!item.clientPhone && user.nombres && item.clientName && user.nombres.trim().toLowerCase() === item.clientName.trim().toLowerCase()) return true
    return false
  }, [user, userStore])

  // Iniciar edición de post
  const handleStartEdit = (item: GlobalProductReviewItem, e: React.MouseEvent) => {
    e.stopPropagation()
    setOpenMenuPostId(null)
    setEditingPost(item)
    setEditComment(item.comment || '')
    setEditRating(item.rating || 5)
    setEditHoverRating(null)
    setEditImagePreview(item.image || null)
    setEditSelectedFile(null)
    setEditRemoveImage(false)
    setEditError('')
  }

  // Guardar cambios de edición
  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingPost) return

    setIsSavingEdit(true)
    setEditError('')

    try {
      let finalImageUrl = editImagePreview

      if (editRemoveImage) {
        finalImageUrl = ''
      } else if (editSelectedFile) {
        const filePath = `ratings/${editingPost.businessId}_${Date.now()}`
        finalImageUrl = await uploadImage(editSelectedFile, filePath)
      }

      await updateCommunityPost({
        businessId: editingPost.businessId,
        ratingDocId: editingPost.ratingDocId,
        rating: editRating,
        comment: editComment.trim(),
        image: finalImageUrl !== null ? finalImageUrl : undefined
      })

      // Actualizar feed optimista
      setReviews((prev) =>
        prev.map((r) => {
          if (r.ratingDocId === editingPost.ratingDocId) {
            return {
              ...r,
              rating: editRating,
              comment: editComment.trim(),
              image: finalImageUrl || undefined
            }
          }
          return r
        })
      )

      setToastMessage('¡Publicación actualizada!')
      setTimeout(() => setToastMessage(null), 2500)
      setEditingPost(null)
    } catch (err) {
      console.error('Error saving post edit:', err)
      setEditError('No se pudo actualizar la publicación. Intenta de nuevo.')
    } finally {
      setIsSavingEdit(false)
    }
  }

  // Iniciar confirmación de borrado
  const handleStartDelete = (item: GlobalProductReviewItem, e: React.MouseEvent) => {
    e.stopPropagation()
    setOpenMenuPostId(null)
    setDeletingPost(item)
  }

  // Confirmar eliminación en base de datos
  const handleConfirmDelete = async () => {
    if (!deletingPost) return

    setIsDeleting(true)
    try {
      await deleteCommunityPost(deletingPost.businessId, deletingPost.ratingDocId)

      // Quitar del feed en tiempo real
      setReviews((prev) => prev.filter((r) => r.ratingDocId !== deletingPost.ratingDocId))

      setToastMessage('Publicación eliminada')
      setTimeout(() => setToastMessage(null), 2500)
      setDeletingPost(null)
    } catch (err) {
      console.error('Error deleting post:', err)
      setToastMessage('Error al eliminar publicación')
      setTimeout(() => setToastMessage(null), 2500)
    } finally {
      setIsDeleting(false)
    }
  }

  // Identificador de usuario para likes (depende de si actúa como tienda o cliente)
  const currentActorIdentifier = isBusinessActor
    ? `business_${userStore!.id}`
    : (user?.celular || user?.id || '')

  // Manejador de Like
  const handleToggleLike = async (item: GlobalProductReviewItem, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!currentActorIdentifier) {
      setGuestActionData({ type: 'like', item })
      setShowGuestModal(true)
      return
    }

    const currentLikes = item.likes || []
    const isCurrentlyLiked = currentLikes.includes(currentActorIdentifier)
    const newLikes = isCurrentlyLiked
      ? currentLikes.filter((id) => id !== currentActorIdentifier)
      : [...currentLikes, currentActorIdentifier]

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
      await toggleRatingLike(item.businessId, item.ratingDocId, currentActorIdentifier)
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

    if (!isBusinessActor && !user) {
      setGuestActionData({ type: 'reply', item })
      setShowGuestModal(true)
      return
    }

    setIsSendingReply((prev) => ({ ...prev, [item.id]: true }))
    try {
      const replyPayload = isBusinessActor
        ? {
            userName: userStore!.name,
            userPhone: userStore!.phone || `business_${userStore!.id}`,
            userPhoto: userStore!.image || '',
            comment: text,
            isBusinessReply: true,
            businessReplyName: userStore!.name,
            businessOwnerId: userStore!.ownerId || userStore!.id
          }
        : {
            userName: user?.nombres || 'Cliente',
            userPhone: user?.celular || '',
            userPhoto: (user as any)?.photoURL || (user as any)?.clientPhotoUrl || '',
            comment: text,
            isBusinessReply: false
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
      : `${origin}/fuddiverso`

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

      {/* Contenido Principal */}
      <main className="max-w-xl mx-auto px-4 pt-4 space-y-4">
        {/* Formulario Inline de Publicación */}
        <form
          onSubmit={handleSubmitInlinePost}
          className="bg-white rounded-3xl p-4 sm:p-5 border border-gray-100 shadow-sm space-y-3.5"
        >
          {/* Cabecera inline: Avatar / Nombre + Selector de Calificación */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              {userStore ? (
                <button
                  type="button"
                  onClick={toggleIdentity}
                  className="relative group p-0 bg-transparent border-none rounded-full flex-shrink-0 cursor-pointer transition-transform hover:scale-105 active:scale-95 focus:outline-none"
                  title={`Interactuar como: ${isBusinessActor ? `${userStore.name} (Clic para cambiar a Cliente)` : `${user?.nombres || 'Cliente'} (Clic para cambiar a Tienda)`}`}
                >
                  <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-red-50 to-orange-50 text-[#aa1918] flex items-center justify-center font-black text-xs overflow-hidden border border-red-200 shadow-xs">
                    {isBusinessActor ? (
                      userStore.image ? (
                        <img src={userStore.image} alt={userStore.name} className="w-full h-full object-cover" />
                      ) : (
                        <span>🏪</span>
                      )
                    ) : (user as any)?.photoURL || (user as any)?.clientPhotoUrl ? (
                      <img
                        src={(user as any).photoURL || (user as any).clientPhotoUrl}
                        alt={user?.nombres || 'Usuario'}
                        className="w-full h-full object-cover"
                      />
                    ) : user?.nombres ? (
                      <span>{user.nombres.charAt(0).toUpperCase()}</span>
                    ) : (
                      <i className="bi bi-person-fill text-gray-400 text-sm"></i>
                    )}
                  </div>
                  {/* Sutil Chevron para alternar identidad */}
                  <div className="absolute -bottom-0.5 -right-0.5 bg-gray-900 text-white rounded-full w-3.5 h-3.5 flex items-center justify-center shadow-xs border border-white">
                    <i className="bi bi-chevron-down text-[7px] font-black leading-none"></i>
                  </div>
                </button>
              ) : (
                <div className="w-8 h-8 rounded-full bg-red-50 text-[#aa1918] flex items-center justify-center font-black text-xs overflow-hidden border border-red-100 flex-shrink-0">
                  {(user as any)?.photoURL || (user as any)?.clientPhotoUrl ? (
                    <img
                      src={(user as any).photoURL || (user as any).clientPhotoUrl}
                      alt={user?.nombres || 'Usuario'}
                      className="w-full h-full object-cover"
                    />
                  ) : user?.nombres ? (
                    <span>{user.nombres.charAt(0).toUpperCase()}</span>
                  ) : (
                    <span>F</span>
                  )}
                </div>
              )}
              <span className="text-xs font-black text-gray-900 truncate">
                {isBusinessActor && userStore ? userStore.name : (user?.nombres || 'Comparte tu experiencia')}
              </span>
            </div>
          </div>

          {/* Textarea del Comentario */}
          <textarea
            value={postComment}
            onChange={(e) => setPostComment(e.target.value)}
            placeholder={isBusinessActor && userStore ? `¿Qué novedades tiene ${userStore.name}? Comparte tu opinión...` : "¿Qué probaste? Comparte tu opinión..."}
            rows={2}
            className="w-full bg-gray-50/80 border border-gray-200/80 rounded-2xl p-3 text-xs sm:text-sm font-medium text-gray-900 placeholder:text-gray-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-gray-900 transition-all resize-none"
          />

          {/* Tarjeta de Producto o Tienda Etiquetada */}
          {(taggedProduct || taggedBusiness) && (
            <div className="flex items-center justify-between gap-3 bg-red-50/60 border border-red-100 p-2.5 rounded-2xl animate-in fade-in duration-150">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-white border border-red-100 overflow-hidden flex-shrink-0 flex items-center justify-center shadow-xs">
                  {taggedProduct ? (
                    taggedProduct.image ? (
                      <img
                        src={taggedProduct.image}
                        alt={taggedProduct.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <ShoppingBag size={16} className="text-red-400" />
                    )
                  ) : (
                    taggedBusiness?.image ? (
                      <img
                        src={taggedBusiness.image}
                        alt={taggedBusiness.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <Store size={16} className="text-[#aa1918]" />
                    )
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-black text-gray-900 truncate">
                    {taggedProduct ? taggedProduct.name : taggedBusiness?.name}
                  </p>
                  <p className="text-[10px] font-medium text-gray-500 truncate">
                    {taggedProduct ? (
                      <>
                        {taggedBusiness?.name || 'Tienda'}
                        {taggedProduct.price ? ` • ${formatPrice(taggedProduct.price)}` : ''}
                      </>
                    ) : (
                      'Restaurante / Tienda'
                    )}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setTaggedProduct(null)
                  setTaggedBusiness(null)
                }}
                className="w-7 h-7 rounded-full bg-white hover:bg-red-100 text-red-500 flex items-center justify-center border border-red-100 transition-colors flex-shrink-0"
              >
                <X size={13} />
              </button>
            </div>
          )}

          {/* Previsualización de Foto Adjunta */}
          {postImagePreview && (
            <div className="relative rounded-2xl overflow-hidden border border-gray-100 bg-gray-50 max-h-48 flex items-center justify-center animate-in fade-in duration-150">
              <img
                src={postImagePreview}
                alt="Vista previa"
                className="w-full h-48 object-cover"
              />
              <button
                type="button"
                onClick={handleRemovePostImage}
                className="absolute top-2 right-2 w-7 h-7 bg-black/70 hover:bg-black text-white rounded-full flex items-center justify-center transition-colors shadow-md"
              >
                <X size={14} />
              </button>
            </div>
          )}

          {/* Datos de Invitado si no está logueado y no actúa como tienda */}
          {!user && !isBusinessActor && (
            <div className="grid grid-cols-2 gap-2 pt-1 border-t border-gray-100">
              <input
                type="text"
                value={postGuestName}
                onChange={(e) => setPostGuestName(e.target.value)}
                placeholder="Tu nombre"
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-medium text-gray-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-gray-900"
              />
              <input
                type="tel"
                value={postGuestPhone}
                onChange={(e) => setPostGuestPhone(e.target.value)}
                placeholder="Celular (ej: 0991234567)"
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-medium text-gray-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-gray-900"
              />
            </div>
          )}

          {/* Mensaje de Error */}
          {postError && (
            <p className="text-[11px] font-bold text-red-600 bg-red-50 p-2.5 rounded-xl border border-red-100">
              {postError}
            </p>
          )}

          {/* Barra de Acciones: Adjuntar Foto + Etiquetar Producto + Botón Publicar */}
          <div className="flex items-center justify-between gap-2 pt-1 border-t border-gray-50">
            <div className="flex items-center gap-1.5">
              {/* Botón Foto */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handlePostImageChange}
                className="hidden"
                id="inline-post-photo"
              />
              <label
                htmlFor="inline-post-photo"
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl cursor-pointer text-xs font-bold transition-all ${
                  postImagePreview
                    ? 'bg-red-50 text-[#aa1918] border border-red-100'
                    : 'bg-gray-50 hover:bg-gray-100 text-gray-600 border border-gray-100'
                }`}
              >
                <Camera size={14} />
                <span>Foto</span>
              </label>

              {/* Botón Etiquetar Tienda / Producto (Abre el Modal) */}
              <button
                type="button"
                onClick={() => setIsTagModalOpen(true)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  taggedProduct || taggedBusiness
                    ? 'bg-red-50 text-[#aa1918] border border-red-100'
                    : 'bg-gray-50 hover:bg-gray-100 text-gray-600 border border-gray-100'
                }`}
              >
                <Tag size={14} />
                <span>{taggedProduct || taggedBusiness ? 'Etiquetado' : 'Etiquetar'}</span>
              </button>

              {/* Estrella vacía al lado de Etiquetar para calificación opcional */}
              {!isRatingSelectorOpen && postRating === null ? (
                <button
                  type="button"
                  onClick={() => setIsRatingSelectorOpen(true)}
                  className="flex items-center justify-center w-8 h-8 rounded-xl text-xs font-bold transition-all bg-gray-50 hover:bg-gray-100 text-gray-400 hover:text-amber-500 border border-gray-100 active:scale-95 flex-shrink-0"
                  title="Calificar con estrellas"
                >
                  <Star size={15} className="text-gray-400 hover:text-amber-400 transition-colors" />
                </button>
              ) : (
                <div className="flex items-center gap-1 bg-amber-50/60 border border-amber-200/80 px-2 py-1 rounded-xl animate-in fade-in duration-150 flex-shrink-0">
                  <div className="flex items-center gap-0.5">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        onClick={() => setPostRating((prev) => (prev === star ? null : star))}
                        onMouseEnter={() => setPostHoverRating(star)}
                        onMouseLeave={() => setPostHoverRating(null)}
                        className="p-0.5 transition-transform active:scale-90"
                        title={`${star} ${star === 1 ? 'estrella' : 'estrellas'}`}
                      >
                        <Star
                          size={15}
                          className={`transition-colors ${
                            (postHoverRating !== null
                              ? star <= postHoverRating
                              : postRating !== null && star <= postRating)
                              ? 'fill-amber-400 text-amber-400'
                              : 'text-gray-300 hover:text-amber-300'
                          }`}
                        />
                      </button>
                    ))}
                  </div>
                  {postRating !== null && (
                    <span className="text-[10px] font-black text-amber-700 ml-0.5">
                      {postRating}.0
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setPostRating(null)
                      setIsRatingSelectorOpen(false)
                    }}
                    className="ml-0.5 text-gray-400 hover:text-gray-700 p-0.5 rounded-full transition-colors"
                    title="Cerrar calificación"
                  >
                    <X size={12} />
                  </button>
                </div>
              )}
            </div>

            {/* Botón Publicar */}
            <button
              type="submit"
              disabled={isSubmittingPost || (!postComment.trim() && !postSelectedFile)}
              className="px-4 py-1.5 rounded-xl bg-gray-900 hover:bg-black text-white text-xs font-black transition-all flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 flex-shrink-0"
            >
              {isSubmittingPost ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <span>Publicar</span>
              )}
            </button>
          </div>
        </form>
        {/* Feed de Publicaciones y Filtros */}
        <div className="flex items-center justify-between px-1 pt-1">
          <p className="text-xs font-black text-gray-900 tracking-tight">
            Comunidad {searchQuery && <span className="font-normal text-gray-400">&bull; &ldquo;{searchQuery}&rdquo;</span>}
          </p>

          <div className="relative" ref={filterPopoverRef}>
            <button
              type="button"
              onClick={() => setIsFilterPopoverOpen(!isFilterPopoverOpen)}
              className={`relative px-2.5 py-1 rounded-xl border text-[11px] font-bold transition-all flex items-center gap-1.5 ${
                activeFilter !== 'all' || isFilterPopoverOpen
                  ? 'bg-gray-900 text-white border-gray-900 shadow-xs'
                  : 'bg-white text-gray-600 hover:bg-gray-50 border-gray-200/70 shadow-xs'
              }`}
              title="Filtros"
            >
              <SlidersHorizontal size={12} />
              <span>
                {activeFilter === 'all'
                  ? 'Filtros'
                  : activeFilter === 'with_photo'
                  ? 'Con fotos'
                  : activeFilter === 'top_rated'
                  ? '5 estrellas'
                  : 'Comentados'}
              </span>
              {activeFilter !== 'all' && (
                <span className="w-1.5 h-1.5 bg-[#aa1918] rounded-full" />
              )}
            </button>

            {/* Popover de Filtros */}
            {isFilterPopoverOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-44 bg-white rounded-2xl shadow-xl border border-gray-100 p-1.5 z-30 space-y-0.5 animate-in fade-in zoom-in-95 duration-150">
                <button
                  type="button"
                  onClick={() => {
                    setActiveFilter('all')
                    setIsFilterPopoverOpen(false)
                  }}
                  className={`w-full px-2.5 py-2 rounded-xl text-xs font-bold flex items-center justify-between transition-colors ${
                    activeFilter === 'all'
                      ? 'bg-gray-900 text-white'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <span>Todos</span>
                  {activeFilter === 'all' && <Check size={13} />}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setActiveFilter('with_photo')
                    setIsFilterPopoverOpen(false)
                  }}
                  className={`w-full px-2.5 py-2 rounded-xl text-xs font-bold flex items-center justify-between transition-colors ${
                    activeFilter === 'with_photo'
                      ? 'bg-gray-900 text-white'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Camera size={13} />
                    <span>Con fotos</span>
                  </div>
                  {activeFilter === 'with_photo' && <Check size={13} />}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setActiveFilter('top_rated')
                    setIsFilterPopoverOpen(false)
                  }}
                  className={`w-full px-2.5 py-2 rounded-xl text-xs font-bold flex items-center justify-between transition-colors ${
                    activeFilter === 'top_rated'
                      ? 'bg-gray-900 text-white'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Star size={13} className={activeFilter === 'top_rated' ? 'fill-white text-white' : 'fill-amber-400 text-amber-400'} />
                    <span>5 estrellas</span>
                  </div>
                  {activeFilter === 'top_rated' && <Check size={13} />}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setActiveFilter('most_replied')
                    setIsFilterPopoverOpen(false)
                  }}
                  className={`w-full px-2.5 py-2 rounded-xl text-xs font-bold flex items-center justify-between transition-colors ${
                    activeFilter === 'most_replied'
                      ? 'bg-gray-900 text-white'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <MessageSquare size={13} />
                    <span>Comentados</span>
                  </div>
                  {activeFilter === 'most_replied' && <Check size={13} />}
                </button>
              </div>
            )}
          </div>
        </div>

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
          <>
            {filteredReviews.map((item, index) => {
            const cardKey = item.id ? `${item.id}_${index}` : `${item.businessId}_${item.ratingDocId}_${index}`
            const isSelected = activeCardId === item.id
            const isHighlighted =
              highlightedPostId === item.id ||
              (Boolean(item.ratingDocId) && highlightedPostId === item.ratingDocId)
            const likes = item.likes || []
            const isLiked = currentActorIdentifier ? likes.includes(currentActorIdentifier) : false
            const likesCount = likes.length
            const repliesCount = item.replies?.length || 0

            return (
              <article
                key={cardKey}
                id={`post-${item.id}`}
                data-post-id={item.id}
                data-rating-doc-id={item.ratingDocId}
                onClick={() => setActiveCardId(isSelected ? null : item.id)}
                className={`bg-white rounded-3xl p-4 sm:p-5 border transition-all duration-500 cursor-pointer space-y-3.5 scroll-mt-24 ${
                  isHighlighted
                    ? 'border-[#aa1918] ring-4 ring-red-100 shadow-xl bg-red-50/15'
                    : isSelected
                    ? 'border-amber-300 ring-2 ring-amber-100 shadow-md'
                    : 'border-gray-100 shadow-sm hover:border-gray-200 hover:shadow-md'
                }`}
              >
                {/* Cabecera: Usuario > Tienda / Fecha | Calificación + Opciones del dueño */}
                <div className="flex items-start justify-between gap-2.5">
                  <div className="flex items-start gap-2.5 min-w-0 flex-1">
                    {/* Avatar del Cliente */}
                    <div className="w-9 h-9 rounded-full bg-amber-100/80 text-amber-800 font-black text-xs flex items-center justify-center border border-amber-200/60 flex-shrink-0 overflow-hidden mt-0.5">
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

                    <div className="min-w-0 flex-1">
                      {/* Línea 1: Nombre del usuario > Nombre de la tienda */}
                      <p className="text-xs leading-tight truncate">
                        <span className="font-black text-gray-900">{item.clientName || 'Cliente'}</span>
                        <span className="mx-1.5 text-gray-300 font-medium">›</span>
                        <Link
                          href={`/${item.businessUsername || item.businessId}`}
                          onClick={(e) => e.stopPropagation()}
                          className="font-bold text-gray-600 hover:text-[#aa1918] transition-colors"
                        >
                          {item.businessName || 'Tienda'}
                        </Link>
                      </p>

                      {/* Línea 2: Fecha de publicación | Calificación */}
                      <div className="flex items-center gap-0 mt-1">
                        <span className="text-[10px] text-gray-400 font-medium">
                          {item.createdAt ? formatRelativeTime(item.createdAt) : 'Reciente'}
                        </span>
                        {typeof item.rating === 'number' && item.rating > 0 ? (
                          <>
                            <span className="mx-1.5 text-gray-300 text-[10px]">|</span>
                            <div className="flex items-center gap-0.5">
                              <Star size={11} className="fill-amber-400 text-amber-400 flex-shrink-0" />
                              <span className="text-[10px] font-black text-amber-700 leading-none">
                                {item.rating.toFixed(1)}
                              </span>
                            </div>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  {/* Menú Popover de 3 puntos (solo para el autor) */}
                  {isPostOwner(item) && (
                    <div className="relative post-options-popover-container flex-shrink-0">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setOpenMenuPostId((prev) => (prev === item.id ? null : item.id))
                        }}
                        className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-900 hover:bg-gray-100 transition-colors active:scale-95"
                        title="Opciones de publicación"
                      >
                        <MoreVertical size={16} />
                      </button>

                      {/* Menú Popover */}
                      {openMenuPostId === item.id && (
                        <div
                          onClick={(e) => e.stopPropagation()}
                          className="absolute right-0 top-9 z-30 w-36 bg-white rounded-2xl shadow-xl border border-gray-100 py-1.5 animate-in fade-in zoom-in-95 duration-150"
                        >
                          <button
                            type="button"
                            onClick={(e) => handleStartEdit(item, e)}
                            className="w-full px-3 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50 flex items-center gap-2.5 transition-colors"
                          >
                            <Pencil size={13} className="text-gray-500" />
                            <span>Editar</span>
                          </button>

                          <div className="my-1 border-t border-gray-100" />

                          <button
                            type="button"
                            onClick={(e) => handleStartDelete(item, e)}
                            className="w-full px-3 py-2 text-xs font-bold text-red-600 hover:bg-red-50 flex items-center gap-2.5 transition-colors"
                          >
                            <Trash2 size={13} className="text-red-500" />
                            <span>Eliminar</span>
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Tarjeta del Producto Calificado (solo cuando NO hay imagen adjunta) */}
                {!item.image && item.productName && (
                  <div
                    onClick={(e) => handleOpenProduct(item, e)}
                    className="group bg-gray-50/80 hover:bg-gray-100/80 border border-gray-100 rounded-2xl p-2.5 flex items-center justify-between gap-3 transition-all cursor-pointer"
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

                {/* Foto Adjunta en Proporción 4:3 con Producto Etiquetado Superpuesto */}
                {item.image && (
                  <div className="relative aspect-[4/3] w-full rounded-2xl overflow-hidden bg-gray-100 group/img border border-gray-100">
                    <img
                      src={item.image}
                      alt="Foto de la opinión"
                      className="w-full h-full object-cover group-hover/img:scale-105 transition-transform duration-500 cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation()
                        setViewingPhotoUrl(item.image!)
                      }}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent pointer-events-none" />

                    {/* Info del Producto/Tienda Superpuesta sobre la imagen (sin fondo) */}
                    {(item.productName || item.businessName) && (
                      <div className="absolute bottom-2.5 left-2.5 right-2.5 z-10">
                        <button
                          type="button"
                          onClick={(e) => handleOpenProduct(item, e)}
                          className="w-full text-left flex items-center justify-between gap-2 p-1 text-white group/chip cursor-pointer transition-opacity hover:opacity-90"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            {item.productImage || item.businessLogo ? (
                              <div className="w-7 h-7 rounded-lg overflow-hidden flex-shrink-0 border border-white/40 shadow-xs bg-white/20">
                                <img
                                  src={item.productImage || item.businessLogo}
                                  alt={item.productName || item.businessName || 'Producto'}
                                  className="w-full h-full object-cover"
                                />
                              </div>
                            ) : (
                              <div className="w-7 h-7 rounded-lg bg-red-600 text-white flex items-center justify-center text-xs flex-shrink-0 shadow-xs">
                                <ShoppingBag size={14} />
                              </div>
                            )}
                            <div className="min-w-0 drop-shadow-sm">
                              <p className="text-xs font-bold text-white line-clamp-1 group-hover/chip:underline decoration-white/60 leading-none">
                                {item.productName || (item.businessName ? item.businessName : 'Ver tienda')}
                              </p>
                              {item.productName && item.businessName && (
                                <p className="text-[10px] font-medium text-white/90 line-clamp-1 mt-0.5">
                                  en {item.businessName}
                                </p>
                              )}
                            </div>
                          </div>
                          <ChevronRight size={15} className="text-white/90 group-hover/chip:translate-x-0.5 transition-transform drop-shadow-xs flex-shrink-0" />
                        </button>
                      </div>
                    )}
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
                        Boolean(currentActorIdentifier && (item.likes || []).includes(currentActorIdentifier))
                          ? 'text-rose-600'
                          : 'text-gray-500 hover:text-gray-900'
                      }`}
                      title={userStore ? `Dar Me gusta como ${isBusinessActor ? userStore.name : (user?.nombres || 'Cliente')}` : 'Me gusta'}
                    >
                      <Heart
                        size={16}
                        className={Boolean(currentActorIdentifier && (item.likes || []).includes(currentActorIdentifier)) ? 'fill-rose-500 text-rose-500' : 'text-gray-400'}
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
                                <div className={`w-5 h-5 rounded-full font-black text-[9px] flex items-center justify-center flex-shrink-0 overflow-hidden ${
                                  reply.isBusinessReply
                                    ? 'bg-gray-900 text-white'
                                    : 'bg-gray-200 text-gray-800'
                                }`}>
                                  {reply.userPhoto ? (
                                    <img
                                      src={reply.userPhoto}
                                      alt={reply.businessReplyName || reply.userName || 'Cliente'}
                                      className="w-full h-full object-cover"
                                      onError={(e) => {
                                        ;(e.target as HTMLElement).style.display = 'none'
                                      }}
                                    />
                                  ) : (
                                    <span>{reply.isBusinessReply ? '🏪' : (reply.userName?.charAt(0)?.toUpperCase() || 'C')}</span>
                                  )}
                                </div>
                                <span className="font-black text-gray-800 text-[11px]">
                                  {reply.isBusinessReply ? (reply.businessReplyName || reply.userName || 'Tienda') : (reply.userName || 'Cliente')}
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
                      {/* Avatar interactivo con chevron para alternar entre Cliente y Tienda si es owner */}
                      {userStore ? (
                        <button
                          type="button"
                          onClick={toggleIdentity}
                          className="relative group p-0 bg-transparent border-none rounded-full flex-shrink-0 cursor-pointer transition-transform hover:scale-105 active:scale-95 focus:outline-none"
                          title={`Responder como: ${isBusinessActor ? `${userStore.name} (Clic para cambiar a Cliente)` : `${user?.nombres || 'Cliente'} (Clic para cambiar a Tienda)`}`}
                        >
                          <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-red-50 to-orange-50 text-[#aa1918] font-bold text-[10px] flex items-center justify-center border border-red-200 shadow-xs overflow-hidden">
                            {isBusinessActor ? (
                              userStore.image ? (
                                <img src={userStore.image} alt={userStore.name} className="w-full h-full object-cover" />
                              ) : (
                                <span>🏪</span>
                              )
                            ) : (user as any)?.photoURL || (user as any)?.clientPhotoUrl ? (
                              <img
                                src={(user as any).photoURL || (user as any).clientPhotoUrl}
                                alt={user?.nombres || 'Tú'}
                                className="w-full h-full object-cover"
                              />
                            ) : user?.nombres ? (
                              <span>{user.nombres.charAt(0).toUpperCase()}</span>
                            ) : (
                              <i className="bi bi-person-fill text-gray-400 text-xs"></i>
                            )}
                          </div>
                          {/* Sutil Chevron */}
                          <div className="absolute -bottom-0.5 -right-0.5 bg-gray-900 text-white rounded-full w-3 h-3 flex items-center justify-center shadow-xs border border-white">
                            <i className="bi bi-chevron-down text-[6px] font-black leading-none"></i>
                          </div>
                        </button>
                      ) : (
                        <div className="w-7 h-7 rounded-full bg-red-50 text-[#aa1918] font-bold text-[10px] flex items-center justify-center border border-red-100 shadow-xs flex-shrink-0 overflow-hidden">
                          {(user as any)?.photoURL || (user as any)?.clientPhotoUrl ? (
                            <img
                              src={(user as any).photoURL || (user as any).clientPhotoUrl}
                              alt={user?.nombres || 'Tú'}
                              className="w-full h-full object-cover"
                            />
                          ) : user?.nombres ? (
                            <span>{user.nombres.charAt(0).toUpperCase()}</span>
                          ) : (
                            <i className="bi bi-person-fill text-gray-400 text-xs"></i>
                          )}
                        </div>
                      )}

                      <input
                        type="text"
                        value={replyInputText[item.id] || ''}
                        onChange={(e) =>
                          setReplyInputText({
                            ...replyInputText,
                            [item.id]: e.target.value
                          })
                        }
                        placeholder={isBusinessActor && userStore ? `Responder como ${userStore.name}...` : "Escribe una respuesta o comentario..."}
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
          })}

          {/* Centinela y Loader de Scroll Infinito */}
          {hasMore && (
            <div
              ref={sentinelRef}
              className="py-5 flex items-center justify-center gap-2 text-xs font-bold text-gray-500 bg-white/60 backdrop-blur-xs rounded-2xl border border-gray-100 shadow-xs animate-in fade-in duration-200"
            >
              <Loader2 size={16} className="animate-spin text-amber-500" />
              <span>Cargando más publicaciones...</span>
            </div>
          )}

          {!hasMore && reviews.length > 0 && !searchQuery && (
            <div className="py-6 text-center text-xs font-semibold text-gray-400">
              <p>✨ ¡Estás al día con todas las publicaciones!</p>
            </div>
          )}
        </>
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
                  Participa en Fuddiverso
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

      {/* Modal para Editar Publicación */}
      {editingPost && (
        <div 
          onClick={() => setEditingPost(null)}
          className="fixed inset-0 z-[260] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-3xl p-5 sm:p-6 max-w-md w-full shadow-2xl border border-gray-100 space-y-4 animate-in zoom-in-95 duration-200"
          >
            {/* Cabecera del modal */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center">
                  <Pencil size={15} />
                </div>
                <div>
                  <h4 className="text-sm font-black text-gray-900 tracking-tight">
                    Editar publicación
                  </h4>
                  <p className="text-[11px] font-medium text-gray-400">
                    {editingPost.businessName}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingPost(null)}
                className="w-7 h-7 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center hover:bg-gray-200 transition-colors"
              >
                <X size={14} />
              </button>
            </div>

            {/* Formulario de edición */}
            <form onSubmit={handleSaveEdit} className="space-y-3.5">
              {/* Selector de calificación */}
              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-1.5">
                  Tu calificación:
                </label>
                <div className="flex items-center gap-1 bg-gray-50 p-2 rounded-2xl border border-gray-100 w-fit">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      onClick={() => setEditRating(star)}
                      onMouseEnter={() => setEditHoverRating(star)}
                      onMouseLeave={() => setEditHoverRating(null)}
                      className="p-1 transition-transform active:scale-90"
                    >
                      <Star
                        size={20}
                        className={`transition-colors ${
                          (editHoverRating !== null ? star <= editHoverRating : star <= editRating)
                            ? 'fill-amber-400 text-amber-400'
                            : 'text-gray-200'
                        }`}
                      />
                    </button>
                  ))}
                  <span className="text-xs font-black text-amber-700 ml-1.5">
                    {editHoverRating !== null ? `${editHoverRating}.0` : `${editRating}.0`}
                  </span>
                </div>
              </div>

              {/* Textarea de comentario */}
              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-1.5">
                  Tu opinión:
                </label>
                <textarea
                  value={editComment}
                  onChange={(e) => setEditComment(e.target.value)}
                  placeholder="Escribe tu opinión actualizada..."
                  rows={3}
                  className="w-full bg-gray-50 border border-gray-200 rounded-2xl p-3 text-xs sm:text-sm font-medium text-gray-900 placeholder:text-gray-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-gray-900 transition-all resize-none"
                />
              </div>

              {/* Previsualización y edición de imagen */}
              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-1.5">
                  Foto de la publicación:
                </label>

                {editImagePreview && !editRemoveImage ? (
                  <div className="relative rounded-2xl overflow-hidden border border-gray-200 max-h-48 bg-gray-50 flex items-center justify-center">
                    <img
                      src={editImagePreview}
                      alt="Previsualización"
                      className="w-full h-40 object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setEditRemoveImage(true)
                        setEditImagePreview(null)
                        setEditSelectedFile(null)
                      }}
                      className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/70 hover:bg-black text-white flex items-center justify-center transition-all"
                      title="Eliminar foto"
                    >
                      <X size={13} />
                    </button>
                  </div>
                ) : (
                  <div>
                    <input
                      ref={editFileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) {
                          setEditSelectedFile(file)
                          setEditRemoveImage(false)
                          const reader = new FileReader()
                          reader.onloadend = () => {
                            setEditImagePreview(reader.result as string)
                          }
                          reader.readAsDataURL(file)
                        }
                      }}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => editFileInputRef.current?.click()}
                      className="w-full py-2.5 px-3 rounded-2xl border border-dashed border-gray-300 hover:border-gray-900 bg-gray-50 hover:bg-gray-100/60 text-gray-600 text-xs font-bold flex items-center justify-center gap-2 transition-all"
                    >
                      <Camera size={15} />
                      <span>{editRemoveImage ? 'Agregar una foto diferente' : 'Subir o cambiar foto'}</span>
                    </button>
                  </div>
                )}
              </div>

              {editError && (
                <p className="text-[11px] font-bold text-red-600 bg-red-50 p-2.5 rounded-xl border border-red-100">
                  {editError}
                </p>
              )}

              {/* Botones de acción */}
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingPost(null)}
                  disabled={isSavingEdit}
                  className="px-4 py-2.5 rounded-xl text-xs font-bold text-gray-600 hover:bg-gray-100 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSavingEdit}
                  className="px-5 py-2.5 rounded-xl bg-gray-900 hover:bg-black text-white text-xs font-black transition-all flex items-center gap-2 shadow-sm disabled:opacity-50"
                >
                  {isSavingEdit ? (
                    <>
                      <Loader2 size={13} className="animate-spin" />
                      <span>Guardando...</span>
                    </>
                  ) : (
                    <span>Guardar cambios</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de Confirmación para Eliminar Publicación */}
      {deletingPost && (
        <div 
          onClick={() => setDeletingPost(null)}
          className="fixed inset-0 z-[270] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-3xl p-5 sm:p-6 max-w-sm w-full shadow-2xl border border-gray-100 space-y-4 animate-in zoom-in-95 duration-200 text-center"
          >
            <div className="w-12 h-12 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center mx-auto border border-red-100">
              <Trash2 size={22} />
            </div>

            <div>
              <h4 className="text-base font-black text-gray-900 tracking-tight">
                ¿Eliminar publicación?
              </h4>
              <p className="text-xs text-gray-500 font-medium mt-1 leading-relaxed">
                Esta acción no se puede deshacer y tu opinión será removida de Fuddiverso permanentemente.
              </p>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => setDeletingPost(null)}
                disabled={isDeleting}
                className="flex-1 py-2.5 rounded-xl text-xs font-bold text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="flex-1 py-2.5 rounded-xl text-xs font-black text-white bg-red-600 hover:bg-red-700 transition-colors flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-50"
              >
                {isDeleting ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <span>Sí, eliminar</span>
                )}
              </button>
            </div>
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

      {/* Modal para Etiquetar Tienda o Producto */}
      <TagProductModal
        isOpen={isTagModalOpen}
        onClose={() => setIsTagModalOpen(false)}
        onSelectProduct={handleSelectTaggedProduct}
        selectedProductId={taggedProduct?.id}
        selectedBusinessId={taggedBusiness?.id}
      />
    </div>
  )
}

export default function FuddiversoPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#fafaf9] flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[#aa1918] mx-auto"></div>
            <p className="mt-3 text-xs font-bold text-gray-500">Cargando Comunidad Fuddiverso...</p>
          </div>
        </div>
      }
    >
      <FuddiversoContent />
    </Suspense>
  )
}
