'use client'

import React, { useState, useEffect, useRef } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import {
  BusinessRating,
  getBusinessRatings,
  saveStoreRating,
  deleteStoreRating,
  toggleLikeStoreRating,
  addStoreRatingReply,
  deleteStoreRatingReply,
  searchClientByPhone,
  createClient,
  updateClient
} from '@/lib/database'
import { storage } from '@/lib/firebase'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { optimizeImage } from '@/lib/image-utils'
import { normalizeEcuadorianPhone, validateEcuadorianPhone } from '@/lib/validation'
import { formatRelativeTime } from '@/lib/date-utils'
import { Business } from '@/types'
import StarRating from '@/components/StarRating'
import {
  Star,
  Heart,
  MessageSquare,
  Pencil,
  Trash2,
  Camera,
  X,
  Loader2,
  ArrowUp,
  Check,
  Phone
} from 'lucide-react'

interface StoreRatingsViewProps {
  business: Business
  clientPhone?: string | null
  clientUser?: any
  businessUser?: any
  businessOwnerId?: string | null
  onSuccess?: (message: string) => void
  isModal?: boolean
}

export default function StoreRatingsView({
  business,
  clientPhone,
  clientUser,
  businessUser,
  businessOwnerId,
  onSuccess,
  isModal = false
}: StoreRatingsViewProps) {
  const { user, login } = useAuth()

  // Detectar si el usuario es dueño de esta tienda
  const isOwner = Boolean(
    (businessUser && businessOwnerId && businessUser.uid === businessOwnerId) ||
    (user && business?.ownerId && (user.id === business.ownerId || (user as any).uid === business.ownerId))
  )

  const [ratingsList, setRatingsList] = useState<BusinessRating[]>([])
  const [loadingRatings, setLoadingRatings] = useState(true)

  // Calificación en Formulario
  const [newReviewRating, setNewReviewRating] = useState(5)
  const [newReviewComment, setNewReviewComment] = useState('')
  const [reviewImageFile, setReviewImageFile] = useState<File | null>(null)
  const [reviewImagePreview, setReviewImagePreview] = useState<string | null>(null)
  const [isSubmittingReview, setIsSubmittingReview] = useState(false)
  const reviewFileInputRef = useRef<HTMLInputElement | null>(null)

  // Respuestas
  const [activeCardId, setActiveCardId] = useState<string | null>(null)
  const [replyInputText, setReplyInputText] = useState<{ [ratingId: string]: string }>({})
  const [isSendingReply, setIsSendingReply] = useState<{ [ratingId: string]: boolean }>({})
  const [replyingAsType, setReplyingAsType] = useState<{ [ratingId: string]: 'client' | 'business' }>({})

  // Edición de opinión
  const [editingReviewId, setEditingReviewId] = useState<string | null>(null)
  const [editRatingScore, setEditRatingScore] = useState(5)
  const [editCommentText, setEditCommentText] = useState('')
  const [editImageFile, setEditImageFile] = useState<File | null>(null)
  const [editImagePreview, setEditImagePreview] = useState<string | null>(null)
  const [editImageRemoved, setEditImageRemoved] = useState(false)
  const [isSavingEdit, setIsSavingEdit] = useState(false)
  const editFileInputRef = useRef<HTMLInputElement | null>(null)

  // Lightbox para ver fotos en grande
  const [viewingPhotoModalUrl, setViewingPhotoModalUrl] = useState<string | null>(null)

  // Modal para Nombre y Celular si no ha iniciado sesión
  const [showGuestReviewModal, setShowGuestReviewModal] = useState(false)
  const [guestName, setGuestName] = useState('')
  const [guestPhone, setGuestPhone] = useState('')
  const [guestLoading, setGuestLoading] = useState(false)
  const [guestError, setGuestError] = useState('')

  // Notificación flotante interna
  const [notification, setNotification] = useState<{ show: boolean; message: string }>({
    show: false,
    message: ''
  })

  const showNotification = (message: string) => {
    setNotification({ show: true, message })
    onSuccess?.(message)
    setTimeout(() => {
      setNotification({ show: false, message: '' })
    }, 2800)
  }

  const [currentClient, setCurrentClient] = useState<any>(clientUser || user || null)

  useEffect(() => {
    if (user) {
      setCurrentClient(user)
      return
    }
    if (clientUser) {
      setCurrentClient(clientUser)
      return
    }
    const phone = clientPhone || (typeof window !== 'undefined' ? localStorage.getItem('loginPhone') : null)
    if (phone) {
      searchClientByPhone(phone).then(c => {
        if (c) setCurrentClient(c)
      }).catch(console.error)
    }
  }, [user, clientUser, clientPhone])

  const activeUserPhoto = (user as any)?.photoURL || (user as any)?.foto || clientUser?.photoURL || currentClient?.photoURL || ''
  const activeUserName = user?.nombres || clientUser?.nombres || currentClient?.nombres || ''

  // Cargar calificaciones de tienda
  const loadRatings = async () => {
    if (!business?.id) return
    setLoadingRatings(true)
    try {
      const data = await getBusinessRatings(business.id, 100)
      const storeOnly = data.filter(r => {
        const d = r as any
        if (d.isProductOnlyRating) return false
        if (
          d.productRatings &&
          Array.isArray(d.productRatings) &&
          d.productRatings.length > 0 &&
          !d.storeRated &&
          !d.isStoreRating &&
          (!d.comment || d.comment.trim() === '')
        ) {
          return false
        }
        return true
      })
      setRatingsList(storeOnly)
    } catch (e) {
      console.error('Error loading store ratings:', e)
    } finally {
      setLoadingRatings(false)
    }
  }

  useEffect(() => {
    if (business?.id) {
      loadRatings()
    }
  }, [business?.id])

  // Métricas de calificación
  const ratingCount = ratingsList.length
  const ratingAvg = ratingCount > 0
    ? ratingsList.reduce((sum, r) => sum + r.rating, 0) / ratingCount
    : (business?.ratingAverage || 5)

  // Manejo de archivo adjunto en nueva opinión
  const handleReviewImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file && file.type.startsWith('image/')) {
      setReviewImageFile(file)
      setReviewImagePreview(URL.createObjectURL(file))
    }
  }

  const [activeOwnerIdentity, setActiveOwnerIdentity] = useState<'client' | 'business'>('business')

  // Enviar opinión
  const handleSendStoreReview = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!newReviewComment.trim() && !reviewImageFile) return

    const isStoreMain = isOwner && activeOwnerIdentity === 'business'
    const effectiveUserIdentifier = isStoreMain
      ? `business_${business.id}`
      : (user?.celular || clientPhone || clientUser?.celular)
    const effectiveUserName = isStoreMain
      ? business.name
      : (user?.nombres || clientUser?.nombres)
    const effectiveUserPhoto = isStoreMain
      ? (business.image || '')
      : (activeUserPhoto || '')

    if (!isStoreMain && (!effectiveUserIdentifier || !effectiveUserName)) {
      setGuestError('')
      setShowGuestReviewModal(true)
      return
    }

    await publishReview(
      effectiveUserName || (isStoreMain ? business.name : 'Cliente'),
      effectiveUserIdentifier || '',
      effectiveUserPhoto,
      newReviewComment.trim(),
      newReviewRating
    )
  }

  // Publicar opinión en Firebase
  const publishReview = async (
    name: string,
    phone: string,
    photoURL: string,
    commentText: string,
    ratingScore: number
  ) => {
    if (!business?.id) return
    setIsSubmittingReview(true)

    try {
      let finalImageUrl = ''
      if (reviewImageFile) {
        try {
          const optimizedBlob = await optimizeImage(reviewImageFile, 1200, 0.8, 'image/jpeg')
          const storagePath = `ratings/${business.id}/${Date.now()}_store.jpg`
          const storageRef = ref(storage, storagePath)
          const snapshot = await uploadBytes(storageRef, optimizedBlob)
          finalImageUrl = await getDownloadURL(snapshot.ref)
        } catch (imgErr) {
          console.error('Error uploading store rating image:', imgErr)
        }
      }

      await saveStoreRating(
        business.id,
        ratingScore,
        commentText,
        {
          name,
          phone,
          photoURL,
          image: finalImageUrl
        }
      )

      showNotification('¡Opinión publicada!')
      setNewReviewComment('')
      setNewReviewRating(5)
      setReviewImageFile(null)
      setReviewImagePreview(null)
      if (reviewFileInputRef.current) reviewFileInputRef.current.value = ''
      await loadRatings()
    } catch (err) {
      console.error('Error saving store review:', err)
      showNotification('Error al publicar opinión')
    } finally {
      setIsSubmittingReview(false)
    }
  }

  // Enviar modal de invitado
  const handleGuestReviewSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedName = guestName.trim()
    const rawPhone = guestPhone.trim()

    if (!trimmedName) {
      setGuestError('Ingresa tu nombre completo')
      return
    }
    const normalized = normalizeEcuadorianPhone(rawPhone)
    if (!validateEcuadorianPhone(normalized)) {
      setGuestError('Ingresa un número de celular ecuatoriano válido (ej. 0999999999)')
      return
    }

    setGuestLoading(true)
    setGuestError('')
    try {
      let client = await searchClientByPhone(normalized)
      if (client) {
        if (trimmedName && client.nombres !== trimmedName) {
          try {
            await updateClient(client.id, { nombres: trimmedName })
            client.nombres = trimmedName
          } catch (updateErr) {
            console.error('Error silently updating client name:', updateErr)
          }
        }
        login(client)
      } else {
        const newClient = await createClient({
          celular: normalized,
          nombres: trimmedName,
          fecha_de_registro: new Date().toISOString()
        })
        if (newClient) {
          client = newClient
          login(newClient)
        }
      }

      setShowGuestReviewModal(false)
      await publishReview(
        trimmedName,
        normalized,
        client?.photoURL || '',
        newReviewComment.trim(),
        newReviewRating
      )
      setGuestName('')
      setGuestPhone('')
    } catch (err) {
      console.error('Error in guest review submission:', err)
      setGuestError('Error al publicar. Intenta nuevamente.')
    } finally {
      setGuestLoading(false)
    }
  }

  // Toggle Like (soporta Tienda y Cliente)
  const handleToggleLike = async (item: BusinessRating, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    if (!business?.id || !item.id) return

    const isStoreActor = isOwner && activeOwnerIdentity === 'business'
    const effectiveUserIdentifier = isStoreActor
      ? `business_${business.id}`
      : (user?.celular || clientPhone || clientUser?.celular || (typeof window !== 'undefined' ? localStorage.getItem('loginPhone') : ''))

    if (!isStoreActor && !effectiveUserIdentifier) {
      setGuestError('')
      setShowGuestReviewModal(true)
      return
    }

    const likes = item.likes || []
    const isCurrentlyLiked = likes.includes(effectiveUserIdentifier)
    const nextLikes = isCurrentlyLiked
      ? likes.filter(u => u !== effectiveUserIdentifier)
      : [...likes, effectiveUserIdentifier]

    setRatingsList(prev => prev.map(r => r.id === item.id ? { ...r, likes: nextLikes } : r))

    try {
      await toggleLikeStoreRating(business.id, item.id, effectiveUserIdentifier)
    } catch (err) {
      console.error('Error toggling like:', err)
      setRatingsList(prev => prev.map(r => r.id === item.id ? { ...r, likes } : r))
    }
  }

  // Enviar Respuesta
  const handleSendReply = async (item: BusinessRating, e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!item.id || !business?.id) return
    const text = (replyInputText[item.id] || '').trim()
    if (!text) return

    const effectiveUserIdentifier = user?.celular || clientPhone || clientUser?.celular
    const isReplyingAsStore = isOwner && activeOwnerIdentity === 'business'

    if (!isReplyingAsStore && !effectiveUserIdentifier) {
      setGuestError('')
      setShowGuestReviewModal(true)
      return
    }

    const userName = isReplyingAsStore ? business.name : (user?.nombres || clientUser?.nombres || 'Cliente')
    const userPhoto = isReplyingAsStore ? (business.image || '') : ((user as any)?.photoURL || clientUser?.photoURL || '')
    const userPhone = isReplyingAsStore ? '' : (effectiveUserIdentifier || '')

    setIsSendingReply(prev => ({ ...prev, [item.id!]: true }))

    const newReplyObj = {
      id: `reply_${Date.now()}`,
      userPhone,
      userName,
      userPhoto,
      comment: text,
      isBusinessReply: isReplyingAsStore,
      businessReplyName: isReplyingAsStore ? business.name : undefined,
      businessOwnerId: isReplyingAsStore ? (businessOwnerId || '') : undefined,
      createdAt: new Date()
    }

    setRatingsList(prev => prev.map(r => {
      if (r.id === item.id) {
        return { ...r, replies: [...(r.replies || []), newReplyObj] }
      }
      return r
    }))
    setReplyInputText(prev => ({ ...prev, [item.id!]: '' }))

    try {
      await addStoreRatingReply(business.id, item.id, {
        userName,
        userPhone,
        userPhoto,
        comment: text,
        isBusinessReply: isReplyingAsStore,
        businessReplyName: isReplyingAsStore ? business.name : undefined,
        businessOwnerId: isReplyingAsStore ? (businessOwnerId || '') : undefined
      })
      showNotification('Respuesta enviada')
    } catch (err) {
      console.error('Error sending reply:', err)
      showNotification('Error al enviar respuesta')
    } finally {
      setIsSendingReply(prev => ({ ...prev, [item.id!]: false }))
    }
  }

  // Eliminar respuesta
  const handleDeleteReply = async (ratingId: string, replyId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    if (!business?.id || !confirm('¿Deseas eliminar este comentario?')) return
    const effectivePhone = user?.celular || clientPhone || clientUser?.celular || ''

    setRatingsList(prev => prev.map(r => {
      if (r.id === ratingId) {
        return { ...r, replies: (r.replies || []).filter(rep => rep.id !== replyId) }
      }
      return r
    }))

    try {
      await deleteStoreRatingReply(business.id, ratingId, replyId, effectivePhone, businessOwnerId || undefined)
      showNotification('Comentario eliminado')
    } catch (err) {
      console.error('Error deleting reply:', err)
      showNotification('Error al eliminar comentario')
      loadRatings()
    }
  }

  // Normalizador de teléfono
  const normalizePhoneDigits = (phoneStr?: string | null) => (phoneStr || '').replace(/\D/g, '')

  const effectivePhone = user?.celular || clientPhone || clientUser?.celular || (typeof window !== 'undefined' ? localStorage.getItem('loginPhone') : '') || ''
  const currentPhoneDigits = normalizePhoneDigits(effectivePhone)

  // Iniciar edición (solo si es el autor de la opinión)
  const startEditingReview = (item: BusinessRating, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    const reviewPhoneDigits = normalizePhoneDigits(item.clientPhone || item.id)
    const canEdit = Boolean(
      currentPhoneDigits &&
      reviewPhoneDigits &&
      (currentPhoneDigits === reviewPhoneDigits || currentPhoneDigits.endsWith(reviewPhoneDigits) || reviewPhoneDigits.endsWith(currentPhoneDigits))
    )

    if (!canEdit) {
      showNotification('Solo el autor puede editar esta opinión')
      return
    }

    setEditingReviewId(item.id || null)
    setEditRatingScore(item.rating || 5)
    setEditCommentText(item.comment || '')
    setEditImagePreview(item.image || null)
    setEditImageFile(null)
    setEditImageRemoved(false)
  }

  // Guardar edición (solo si es el autor de la opinión)
  const handleSaveEditReview = async (item: BusinessRating, e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!business?.id || !item.id) return

    const reviewPhoneDigits = normalizePhoneDigits(item.clientPhone || item.id)
    const canEdit = Boolean(
      currentPhoneDigits &&
      reviewPhoneDigits &&
      (currentPhoneDigits === reviewPhoneDigits || currentPhoneDigits.endsWith(reviewPhoneDigits) || reviewPhoneDigits.endsWith(currentPhoneDigits))
    )

    if (!canEdit) {
      showNotification('Solo el autor puede editar esta opinión')
      return
    }

    setIsSavingEdit(true)

    try {
      let finalImageUrl = editImagePreview || item.image || ''
      if (editImageFile) {
        const optimizedBlob = await optimizeImage(editImageFile, 1200, 0.8, 'image/jpeg')
        const storagePath = `ratings/${business.id}/${Date.now()}_edit.jpg`
        const storageRef = ref(storage, storagePath)
        const snapshot = await uploadBytes(storageRef, optimizedBlob)
        finalImageUrl = await getDownloadURL(snapshot.ref)
      } else if (editImageRemoved) {
        finalImageUrl = ''
      }

      await saveStoreRating(
        business.id,
        editRatingScore,
        editCommentText.trim(),
        {
          name: item.clientName,
          phone: item.clientPhone,
          email: item.clientEmail,
          photoURL: item.clientPhotoURL,
          image: finalImageUrl
        }
      )

      setRatingsList(prev => prev.map(r => {
        if (r.id === item.id) {
          return {
            ...r,
            rating: editRatingScore,
            comment: editCommentText.trim(),
            image: finalImageUrl
          }
        }
        return r
      }))

      setEditingReviewId(null)
      showNotification('Opinión actualizada')
    } catch (err) {
      console.error('Error updating review:', err)
      showNotification('Error al actualizar opinión')
    } finally {
      setIsSavingEdit(false)
    }
  }

  // Eliminar opinión (solo el autor de la opinión)
  const handleDeleteReview = async (item: BusinessRating, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    if (!business?.id || !item.id) return

    const reviewPhoneDigits = normalizePhoneDigits(item.clientPhone || item.id)
    const canDelete = Boolean(
      currentPhoneDigits &&
      reviewPhoneDigits &&
      (currentPhoneDigits === reviewPhoneDigits || currentPhoneDigits.endsWith(reviewPhoneDigits) || reviewPhoneDigits.endsWith(currentPhoneDigits))
    )

    if (!canDelete) {
      showNotification('Solo el autor puede eliminar esta opinión')
      return
    }

    if (!confirm('¿Deseas eliminar esta opinión?')) return

    setRatingsList(prev => prev.filter(r => r.id !== item.id))
    showNotification('Opinión eliminada')

    try {
      await deleteStoreRating(business.id, item.id)
      await loadRatings()
    } catch (err) {
      console.error('Error deleting review:', err)
      showNotification('Error al eliminar opinión')
      loadRatings()
    }
  }

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {/* Resumen de Calificación */}
      <div className="bg-gradient-to-br from-amber-50/80 to-orange-50/40 border border-amber-200/60 rounded-2xl p-4 flex items-center justify-between shadow-xs">
        <div>
          <p className="text-3xl font-black text-gray-900 tracking-tight leading-none">
            {ratingAvg > 0 ? ratingAvg.toFixed(1) : '5.0'}
          </p>
          <div className="mt-1.5">
            <StarRating
              rating={ratingAvg > 0 ? ratingAvg : 5}
              size="sm"
              showGrayStars={ratingCount === 0}
              showRatingText={false}
            />
          </div>
          <p className="text-xs font-bold text-gray-600 mt-1">
            {ratingCount > 0
              ? `${ratingCount} ${ratingCount === 1 ? 'opinión' : 'opiniones'}`
              : 'Sin opiniones aún'}
          </p>
        </div>
      </div>

      {/* Casillero para calificar e insertar opinión (Si no es modal, aparece integrado) */}
      <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm space-y-3">
        <form onSubmit={handleSendStoreReview} className="space-y-2.5">
          {/* Selector de estrellas */}
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-bold text-gray-700">
              Tu calificación:
            </span>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setNewReviewRating(star)}
                  className="p-0.5 transition-transform hover:scale-125 active:scale-95 text-amber-400"
                  title={`${star} estrellas`}
                >
                  <i className={`bi ${newReviewRating >= star ? 'bi-star-fill' : 'bi-star text-gray-300'} text-lg`}></i>
                </button>
              ))}
            </div>
          </div>

          {/* Mini vista previa de la foto adjunta */}
          {reviewImagePreview && (
            <div className="relative inline-block px-1">
              <img
                src={reviewImagePreview}
                alt="Vista previa"
                className="w-14 h-14 object-cover rounded-xl border border-gray-200 shadow-sm"
              />
              <button
                type="button"
                onClick={() => {
                  setReviewImageFile(null)
                  setReviewImagePreview(null)
                  if (reviewFileInputRef.current) reviewFileInputRef.current.value = ''
                }}
                className="absolute -top-1.5 -right-1.5 bg-gray-900 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs shadow hover:bg-red-600 transition-colors"
                title="Quitar foto"
              >
                <X size={12} />
              </button>
            </div>
          )}

          {/* Input con avatar de perfil, campo de texto, botón de cámara y botón de enviar */}
          <div className="flex items-center gap-2 sm:gap-2.5">
            {/* Foto de perfil / Tienda con chevron sutil para alternar identidad si es owner */}
            {isOwner ? (
              <button
                type="button"
                onClick={() => {
                  setActiveOwnerIdentity(prev => prev === 'business' ? 'client' : 'business')
                }}
                className="relative group p-0 bg-transparent border-none rounded-full flex-shrink-0 cursor-pointer transition-transform hover:scale-105 active:scale-95 focus:outline-none"
                title={`Interactuar como: ${activeOwnerIdentity === 'business' ? 'Tienda (Clic para cambiar a Cliente)' : 'Cliente (Clic para cambiar a Tienda)'}`}
              >
                <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-gradient-to-tr from-amber-100 to-orange-100 text-amber-900 font-black text-xs flex items-center justify-center border border-amber-300 shadow-xs overflow-hidden">
                  {activeOwnerIdentity === 'business' ? (
                    business.image ? (
                      <img src={business.image} alt={business.name} className="w-full h-full object-cover" />
                    ) : (
                      <span>🏪</span>
                    )
                  ) : activeUserPhoto ? (
                    <img
                      src={activeUserPhoto}
                      alt={activeUserName || 'Tu perfil'}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLElement).style.display = 'none'
                      }}
                    />
                  ) : activeUserName ? (
                    <span>{activeUserName.charAt(0).toUpperCase()}</span>
                  ) : (
                    <i className="bi bi-person-fill text-gray-400 text-lg"></i>
                  )}
                </div>
                {/* Sutil Chevron */}
                <div className="absolute -bottom-0.5 -right-0.5 bg-gray-900 text-white rounded-full w-3.5 h-3.5 sm:w-4 sm:h-4 flex items-center justify-center shadow-sm border border-white">
                  <i className="bi bi-chevron-down text-[7px] sm:text-[8px] font-black leading-none"></i>
                </div>
              </button>
            ) : (
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-gradient-to-tr from-amber-100 to-orange-100 text-amber-900 font-black text-xs flex items-center justify-center border border-amber-200 shadow-xs flex-shrink-0 overflow-hidden">
                {activeUserPhoto ? (
                  <img
                    src={activeUserPhoto}
                    alt={activeUserName || 'Tu perfil'}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none'
                    }}
                  />
                ) : activeUserName ? (
                  <span>{activeUserName.charAt(0).toUpperCase()}</span>
                ) : (
                  <i className="bi bi-person-fill text-gray-400 text-lg"></i>
                )}
              </div>
            )}

            <input
              type="file"
              ref={reviewFileInputRef}
              onChange={handleReviewImageChange}
              accept="image/*"
              className="hidden"
            />

            <input
              type="text"
              value={newReviewComment}
              onChange={(e) => setNewReviewComment(e.target.value)}
              placeholder="Escribe una opinión sobre la tienda..."
              disabled={isSubmittingReview}
              className="flex-1 bg-gray-50 border border-gray-200/80 rounded-2xl px-4 py-2.5 text-xs text-gray-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent font-medium transition-all"
            />

            <button
              type="button"
              onClick={() => reviewFileInputRef.current?.click()}
              disabled={isSubmittingReview}
              className={`w-9 h-9 sm:w-10 sm:h-10 rounded-2xl border flex items-center justify-center transition-all active:scale-95 flex-shrink-0 ${
                reviewImagePreview
                  ? 'bg-amber-50 border-amber-300 text-amber-600'
                  : 'bg-gray-50 hover:bg-gray-100 border-gray-200/80 text-gray-500 hover:text-gray-900'
              }`}
              title="Adjuntar foto"
            >
              <Camera size={17} />
            </button>

            <button
              type="submit"
              disabled={(!newReviewComment.trim() && !reviewImageFile) || isSubmittingReview}
              className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-gray-900 hover:bg-black text-white flex items-center justify-center transition-all shadow-md active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0"
              title="Publicar opinión"
            >
              {isSubmittingReview ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <ArrowUp size={17} strokeWidth={2.5} />
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Listado de Opiniones */}
      <div className="space-y-3">
        {loadingRatings ? (
          <div className="py-12 flex flex-col items-center justify-center text-gray-400 gap-2">
            <Loader2 className="w-5 h-5 animate-spin text-amber-500" />
            <span className="text-xs font-medium">Cargando opiniones...</span>
          </div>
        ) : ratingsList.length > 0 ? (
          ratingsList.map((item) => {
            const isSelected = activeCardId === item.id
            const isEditing = editingReviewId === item.id
            const isStoreActor = isOwner && activeOwnerIdentity === 'business'
            const currentActorIdentifier = isStoreActor
              ? `business_${business.id}`
              : (currentPhoneDigits || effectivePhone || user?.id || '')
            const likes = item.likes || []
            const isLiked = Boolean(currentActorIdentifier && likes.includes(currentActorIdentifier))
            const likesCount = likes.length
            const repliesCount = item.replies?.length || 0
            const reviewPhoneDigits = normalizePhoneDigits(item.clientPhone || item.id)
            const isOwnReview = Boolean(
              currentPhoneDigits &&
              reviewPhoneDigits &&
              (currentPhoneDigits === reviewPhoneDigits || currentPhoneDigits.endsWith(reviewPhoneDigits) || reviewPhoneDigits.endsWith(currentPhoneDigits))
            )

            if (isEditing) {
              return (
                <div
                  key={item.id}
                  className="bg-white rounded-2xl p-4 border border-amber-300 ring-2 ring-amber-100 shadow-md space-y-3 animate-in fade-in duration-200"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black uppercase tracking-wider text-gray-900">
                      Editar opinión
                    </span>
                    <div className="flex items-center gap-1">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          type="button"
                          onClick={() => setEditRatingScore(star)}
                          className="p-0.5 text-amber-400 hover:scale-110 active:scale-95 transition-transform"
                        >
                          <i className={`bi ${editRatingScore >= star ? 'bi-star-fill' : 'bi-star text-gray-300'} text-sm`}></i>
                        </button>
                      ))}
                    </div>
                  </div>

                  <textarea
                    value={editCommentText}
                    onChange={(e) => setEditCommentText(e.target.value)}
                    placeholder="Escribe tu opinión..."
                    rows={2}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2.5 text-xs text-gray-900 font-medium focus:bg-white focus:outline-none focus:ring-2 focus:ring-gray-900 transition-all resize-none"
                  />

                  {/* Foto preview en edición */}
                  {editImagePreview && !editImageRemoved && (
                    <div className="relative inline-block">
                      <img
                        src={editImagePreview}
                        alt="Foto"
                        className="w-14 h-14 object-cover rounded-xl border border-gray-200 shadow-sm"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setEditImageFile(null)
                          setEditImagePreview(null)
                          setEditImageRemoved(true)
                        }}
                        className="absolute -top-1.5 -right-1.5 bg-gray-900 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs shadow hover:bg-red-600 transition-colors"
                        title="Eliminar foto"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-1">
                    <input
                      type="file"
                      ref={editFileInputRef}
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file && file.type.startsWith('image/')) {
                          setEditImageFile(file)
                          setEditImagePreview(URL.createObjectURL(file))
                          setEditImageRemoved(false)
                        }
                      }}
                      accept="image/*"
                      className="hidden"
                    />

                    <button
                      type="button"
                      onClick={() => editFileInputRef.current?.click()}
                      className="px-2.5 py-1.5 rounded-xl border border-gray-200 bg-gray-50 text-gray-600 hover:text-gray-900 text-xs font-bold flex items-center gap-1.5 transition-all"
                    >
                      <Camera size={14} />
                      <span>{editImagePreview ? 'Cambiar foto' : 'Foto'}</span>
                    </button>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setEditingReviewId(null)}
                        className="px-3 py-1.5 rounded-xl bg-gray-100 text-gray-700 text-xs font-bold hover:bg-gray-200 transition-all"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        disabled={isSavingEdit}
                        onClick={(e) => handleSaveEditReview(item, e)}
                        className="px-3 py-1.5 rounded-xl bg-gray-900 text-white text-xs font-black hover:bg-black transition-all flex items-center gap-1 shadow-sm disabled:opacity-50"
                      >
                        {isSavingEdit ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <Check size={13} />
                        )}
                        <span>Guardar</span>
                      </button>
                    </div>
                  </div>
                </div>
              )
            }

            return (
              <div
                key={item.id}
                onClick={() => setActiveCardId(isSelected ? null : (item.id || null))}
                className={`bg-white rounded-2xl p-4 border transition-all cursor-pointer space-y-2.5 ${
                  isSelected
                    ? 'border-amber-300 ring-2 ring-amber-100/70 shadow-md'
                    : 'border-gray-100 shadow-sm hover:border-gray-200'
                }`}
              >
                {/* Cabecera de la tarjeta */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-full bg-amber-100/80 text-amber-800 font-black text-xs flex items-center justify-center border border-amber-200/60 flex-shrink-0 overflow-hidden">
                      {item.clientPhotoURL ? (
                        <img
                          src={item.clientPhotoURL}
                          alt={item.clientName || 'Cliente'}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            (e.target as HTMLElement).style.display = 'none'
                          }}
                        />
                      ) : (
                        <span>{item.clientName?.charAt(0)?.toUpperCase() || 'C'}</span>
                      )}
                    </div>
                    <div>
                      <p className="text-xs font-black text-gray-900 leading-none">
                        {item.clientName || 'Cliente'}
                      </p>
                      <p className="text-[10px] text-gray-400 mt-0.5 font-medium">
                        {item.createdAt ? formatRelativeTime(item.createdAt) : 'Calificación'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <StarRating rating={item.rating} size="sm" />
                    {isOwnReview && (
                      <div className="flex items-center gap-1 ml-1 pl-1.5 border-l border-gray-100">
                        <button
                          type="button"
                          onClick={(e) => startEditingReview(item, e)}
                          className="p-1 text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                          title="Editar opinión"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => handleDeleteReview(item, e)}
                          className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Eliminar opinión"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Comentario principal */}
                {item.comment && item.comment.trim() ? (
                  <p className="text-xs text-gray-700 font-medium leading-relaxed px-0.5">
                    {item.comment}
                  </p>
                ) : null}

                {/* Foto adjunta */}
                {item.image && (
                  <div className="overflow-hidden rounded-2xl border border-gray-100 bg-gray-50 max-w-[200px]">
                    <img
                      src={item.image}
                      alt="Foto adjunta"
                      className="w-full h-28 object-cover hover:scale-105 transition-transform duration-300 cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation()
                        setViewingPhotoModalUrl(item.image!)
                      }}
                    />
                  </div>
                )}

                {/* Barra de Opciones: Me gusta y Comentar */}
                <div className="flex items-center gap-4 pt-0 -mt-0.5">
                  {/* Botón Me Gusta */}
                  <button
                    type="button"
                    onClick={(e) => handleToggleLike(item, e)}
                    className={`flex items-center gap-1.5 py-0.5 text-xs font-bold transition-all active:scale-95 ${
                      isLiked
                        ? 'text-rose-600'
                        : 'text-gray-500 hover:text-gray-800'
                    }`}
                    title={isOwner ? `Dar Me gusta como ${isStoreActor ? 'Tienda' : 'Cliente'}` : 'Me gusta'}
                  >
                    <Heart
                      size={14}
                      className={isLiked ? 'fill-rose-500 text-rose-500' : 'text-gray-400'}
                    />
                    <span>
                      {likesCount > 0 ? likesCount : ''} Me gusta
                    </span>
                  </button>

                  {/* Botón Comentar / Responder */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setActiveCardId(item.id || null)
                    }}
                    className={`flex items-center gap-1.5 py-1 text-xs font-bold transition-all active:scale-95 ${
                      isSelected
                        ? 'text-amber-600'
                        : 'text-gray-500 hover:text-gray-800'
                    }`}
                  >
                    <MessageSquare size={15} className={isSelected ? 'text-amber-600' : 'text-gray-400'} />
                    <span>
                      {repliesCount > 0 ? `${repliesCount} ${repliesCount === 1 ? 'respuesta' : 'respuestas'}` : 'Comentar'}
                    </span>
                  </button>
                </div>

                {/* Sección Expandida: Respuestas y Casillero para responder */}
                {isSelected && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="pt-2 border-t border-gray-100 space-y-2.5 animate-in fade-in duration-200"
                  >
                    {/* Lista de respuestas existentes */}
                    {item.replies && item.replies.length > 0 && (
                      <div className="space-y-2 pl-2 border-l-2 border-gray-200">
                        {item.replies.map((reply: any, rIdx: number) => {
                          const replyPhoneDigits = normalizePhoneDigits(reply.userPhone)
                          const isOwnReply = reply.isBusinessReply
                            ? isOwner
                            : Boolean(currentPhoneDigits && replyPhoneDigits && (currentPhoneDigits === replyPhoneDigits || currentPhoneDigits.endsWith(replyPhoneDigits) || replyPhoneDigits.endsWith(currentPhoneDigits)))

                          return (
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
                                        alt={reply.userName || 'Cliente'}
                                        className="w-full h-full object-cover"
                                        onError={(e) => {
                                          (e.target as HTMLElement).style.display = 'none'
                                        }}
                                      />
                                    ) : (
                                      <span>{reply.isBusinessReply ? '🏪' : (reply.userName?.charAt(0)?.toUpperCase() || 'C')}</span>
                                    )}
                                  </div>
                                  <span className="font-black text-gray-800 text-[11px] flex items-center gap-1">
                                    {reply.isBusinessReply ? (reply.businessReplyName || business.name) : (reply.userName || 'Cliente')}
                                    {reply.isBusinessReply && (
                                      <span className="text-[9px] bg-gray-100 text-gray-500 font-semibold px-1.5 py-0.5 rounded-md border border-gray-200/60">
                                        Tienda
                                      </span>
                                    )}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] text-gray-400">
                                    {reply.createdAt ? formatRelativeTime(reply.createdAt) : ''}
                                  </span>
                                  {isOwnReply && item.id && (
                                    <button
                                      type="button"
                                      onClick={(e) => handleDeleteReply(item.id!, reply.id, e)}
                                      className="text-gray-400 hover:text-red-600 transition-colors"
                                      title="Eliminar respuesta"
                                    >
                                      <Trash2 size={11} />
                                    </button>
                                  )}
                                </div>
                              </div>
                              <p className="text-gray-600 font-medium leading-relaxed pl-6.5">
                                {reply.comment}
                              </p>
                            </div>
                          )
                        })}
                      </div>
                    )}


                    {/* Input para responder */}
                    <form
                      onSubmit={(e) => handleSendReply(item, e)}
                      className="flex items-center gap-2 pt-1"
                    >
                      {/* Avatar interactivo con chevron para alternar entre Cliente y Tienda si es owner */}
                      {isOwner ? (
                        <button
                          type="button"
                          onClick={() => {
                            setActiveOwnerIdentity(prev => prev === 'business' ? 'client' : 'business')
                          }}
                          className="relative group p-0 bg-transparent border-none rounded-full flex-shrink-0 cursor-pointer transition-transform hover:scale-105 active:scale-95 focus:outline-none"
                          title={`Responder como: ${isStoreActor ? 'Tienda (Clic para cambiar a Cliente)' : 'Cliente (Clic para cambiar a Tienda)'}`}
                        >
                          <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-amber-100 to-orange-100 text-amber-900 font-bold text-[10px] flex items-center justify-center border border-amber-300 shadow-xs overflow-hidden">
                            {isStoreActor ? (
                              business.image ? (
                                <img src={business.image} alt={business.name} className="w-full h-full object-cover" />
                              ) : (
                                <span>🏪</span>
                              )
                            ) : activeUserPhoto ? (
                              <img src={activeUserPhoto} alt={activeUserName || 'Tú'} className="w-full h-full object-cover" />
                            ) : activeUserName ? (
                              <span>{activeUserName.charAt(0).toUpperCase()}</span>
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
                        <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-amber-100 to-orange-100 text-amber-900 font-bold text-[10px] flex items-center justify-center border border-amber-200 shadow-xs flex-shrink-0 overflow-hidden">
                          {activeUserPhoto ? (
                            <img src={activeUserPhoto} alt={activeUserName || 'Tú'} className="w-full h-full object-cover" />
                          ) : activeUserName ? (
                            <span>{activeUserName.charAt(0).toUpperCase()}</span>
                          ) : (
                            <i className="bi bi-person-fill text-gray-400 text-xs"></i>
                          )}
                        </div>
                      )}

                      <input
                        type="text"
                        value={replyInputText[item.id!] || ''}
                        onChange={(e) =>
                          setReplyInputText({
                            ...replyInputText,
                            [item.id!]: e.target.value
                          })
                        }
                        placeholder="Escribe una respuesta..."
                        className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-medium text-gray-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-gray-900 transition-all"
                      />
                      <button
                        type="submit"
                        disabled={
                          !replyInputText[item.id!]?.trim() ||
                          isSendingReply[item.id!]
                        }
                        className="w-8 h-8 bg-gray-900 hover:bg-black text-white rounded-xl flex items-center justify-center transition-all disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0 active:scale-95 shadow-sm"
                        title="Enviar respuesta"
                      >
                        {isSendingReply[item.id!] ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <ArrowUp size={14} strokeWidth={2.5} />
                        )}
                      </button>
                    </form>
                  </div>
                )}
              </div>
            )
          })
        ) : (
          <div className="py-10 text-center flex flex-col items-center justify-center bg-gray-50/60 rounded-2xl border border-dashed border-gray-200 p-6">
            <div className="w-12 h-12 bg-amber-50 text-amber-500 rounded-2xl flex items-center justify-center text-xl mb-2.5 border border-amber-100">
              ⭐
            </div>
            <h5 className="text-xs font-black text-gray-900 uppercase tracking-wider">
              Aún no hay opiniones
            </h5>
            <p className="text-xs text-gray-500 mt-1 max-w-xs leading-relaxed font-medium">
              Sé el primero en calificar la experiencia en {business.name}.
            </p>
          </div>
        )}
      </div>

      {/* Modal para Nombre y Celular si no tiene sesión */}
      {showGuestReviewModal && (
        <div className="fixed inset-0 z-[250] overflow-hidden flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => !guestLoading && setShowGuestReviewModal(false)}
          />

          <div className="relative w-full max-w-sm bg-white rounded-3xl shadow-2xl p-6 z-10 animate-in zoom-in-95 duration-200">
            <button
              onClick={() => setShowGuestReviewModal(false)}
              disabled={guestLoading}
              className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded-full transition-colors"
              aria-label="Cerrar"
            >
              <X size={16} />
            </button>

            {/* Cabecera */}
            <div className="text-center mb-4">
              <div className="w-12 h-12 bg-amber-50 text-amber-500 rounded-2xl flex items-center justify-center mx-auto mb-2.5">
                <Star size={24} className="fill-amber-500" />
              </div>
              <h3 className="text-lg font-black text-gray-900 tracking-tight leading-tight">
                Publicar tu opinión
              </h3>
              <p className="text-xs font-medium text-gray-500 mt-1">
                Ingresa tus datos para firmar tu reseña
              </p>
            </div>

            {/* Mini preview del comentario */}
            <div className="bg-gray-50 p-3 rounded-2xl border border-gray-100 mb-4 space-y-1.5">
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((s) => (
                  <i
                    key={s}
                    className={`bi ${newReviewRating >= s ? 'bi-star-fill text-amber-400' : 'bi-star text-gray-300'} text-xs`}
                  ></i>
                ))}
                <span className="text-[11px] font-bold text-gray-600 ml-1.5">
                  {newReviewRating}.0
                </span>
              </div>
              {newReviewComment.trim() ? (
                <p className="text-xs text-gray-700 font-medium line-clamp-2">
                  {newReviewComment.trim()}
                </p>
              ) : null}
              {reviewImagePreview && (
                <div className="pt-1">
                  <img
                    src={reviewImagePreview}
                    alt="Foto adjunta"
                    className="w-12 h-12 object-cover rounded-xl border border-gray-200 shadow-sm"
                  />
                </div>
              )}
            </div>

            {/* Formulario */}
            <form onSubmit={handleGuestReviewSubmit} className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">
                  Tu nombre
                </label>
                <input
                  type="text"
                  value={guestName}
                  onChange={(e) => {
                    setGuestName(e.target.value)
                    if (guestError) setGuestError('')
                  }}
                  placeholder="Ej. Juan Pérez"
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-2xl text-xs font-semibold text-gray-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-gray-900 transition-all"
                  disabled={guestLoading}
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">
                  Tu celular
                </label>
                <div className="relative">
                  <Phone size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="tel"
                    value={guestPhone}
                    onChange={(e) => {
                      setGuestPhone(e.target.value)
                      if (guestError) setGuestError('')
                    }}
                    placeholder="0999999999"
                    className="w-full pl-9 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-2xl text-xs font-semibold text-gray-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-gray-900 transition-all"
                    disabled={guestLoading}
                  />
                </div>
              </div>

              {guestError && (
                <p className="text-xs text-red-600 font-medium">{guestError}</p>
              )}

              <button
                type="submit"
                disabled={guestLoading || !guestName.trim() || !guestPhone.trim()}
                className="w-full py-3 bg-gray-900 hover:bg-black text-white text-xs font-black rounded-2xl transition-all shadow-md active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-2"
              >
                {guestLoading ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span>Publicando...</span>
                  </>
                ) : (
                  <span>Publicar opinión</span>
                )}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Lightbox para ver fotos en pantalla completa */}
      {viewingPhotoModalUrl && (
        <div
          className="fixed inset-0 z-[300] bg-black/90 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={() => setViewingPhotoModalUrl(null)}
        >
          <button
            type="button"
            onClick={() => setViewingPhotoModalUrl(null)}
            className="absolute top-4 right-4 text-white/80 hover:text-white bg-white/10 hover:bg-white/20 p-2.5 rounded-full transition-all"
            aria-label="Cerrar foto"
          >
            <X size={20} />
          </button>
          <img
            src={viewingPhotoModalUrl}
            alt="Foto en tamaño completo"
            className="max-w-full max-h-[85vh] object-contain rounded-2xl shadow-2xl animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* Toast Notification */}
      {notification.show && (
        <div className="fixed top-8 left-1/2 -translate-x-1/2 z-[350] w-[calc(100%-2rem)] max-w-xs pointer-events-none animate-in fade-in slide-in-from-top-4 duration-300">
          <div className="bg-gray-900/95 backdrop-blur-xl border border-white/10 rounded-[2rem] px-6 py-4 shadow-[0_20px_50px_rgba(0,0,0,0.5)] flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
              <Check className="text-emerald-400" size={20} />
            </div>
            <div className="flex-1">
              <p className="text-white font-black text-[10px] uppercase tracking-[0.2em] leading-tight">
                {notification.message}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
