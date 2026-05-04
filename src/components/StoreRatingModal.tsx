'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import {
  addStoreRatingReply,
  BusinessRating,
  createClient,
  deleteStoreRating,
  deleteStoreRatingReply,
  getBusinessRatings,
  getUserStoreRating,
  saveStoreRating,
  searchClientByPhone,
  serverTimestamp,
  toggleLikeStoreRating,
  updateClient,
} from '@/lib/database'
import { normalizeEcuadorianPhone, validateEcuadorianPhone } from '@/lib/validation'
import { Business } from '@/types'

export default function StoreRatingModal({
  isOpen,
  onClose,
  business,
  clientPhone,
  clientUser,
  businessUser,
  businessOwnerId,
  onSuccess
}: {
  isOpen: boolean
  onClose: () => void
  business: Business
  clientPhone: string | null
  clientUser: any
  businessUser: any
  businessOwnerId: string | null
  onSuccess: (message: string) => void
}) {
  const { login } = useAuth()
  
  // Detectar si el usuario loggeado es dueño de esta tienda
  const isOwner = businessUser && businessOwnerId && businessUser.uid === businessOwnerId

  const resolveClientPhone = (phone?: string | null) => {
    if (!phone) return null
    const normalized = normalizeEcuadorianPhone(phone)
    return validateEcuadorianPhone(normalized) ? normalized : phone
  }
  
  const [rating, setRating] = useState(0)
  const [hover, setHover] = useState(0)
  const [comment, setComment] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [loadingInitial, setLoadingInitial] = useState(true)
  const [allRatings, setAllRatings] = useState<BusinessRating[]>([])
  const [loadingRatings, setLoadingRatings] = useState(true)
  const [activePhone, setActivePhone] = useState<string | null>(resolveClientPhone(clientPhone || clientUser?.celular || null))
  const [showReplyFor, setShowReplyFor] = useState<string | null>(null)
  const [replyText, setReplyText] = useState('')
  const [isReplying, setIsReplying] = useState(false)
  const [replyingAsType, setReplyingAsType] = useState<'client' | 'business'>('client')
  const [existingRatingId, setExistingRatingId] = useState<string | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [showRatingMenu, setShowRatingMenu] = useState(false)

  const handleToggleLike = async (ratingId: string) => {
    if (!activePhone) return
    try {
      await toggleLikeStoreRating(business.id, ratingId, activePhone)
      // Recargar ratings localmente
      const ratings = await getBusinessRatings(business.id, 100)
      setAllRatings(ratings)
    } catch (error) {
      console.error('Error liking rating:', error)
    }
  }

  const handleAddReply = async (ratingId: string) => {
    if (!replyText.trim()) return
    
    // Si está respondiendo como tienda
    if (replyingAsType === 'business' && isOwner) {
      const displayName = business.name
      const photoURL = business.image || ''
      
      setIsReplying(true)
      try {
        await addStoreRatingReply(business.id, ratingId, {
          userName: displayName,
          userPhone: '', // No usar phone para replies de tienda
          userPhoto: photoURL,
          comment: replyText,
          isBusinessReply: true,
          businessReplyName: business.name,
          businessOwnerId: businessOwnerId || ''
        })
        setReplyText('')
        setShowReplyFor(null)
        setReplyingAsType('client')
        const ratings = await getBusinessRatings(business.id, 100)
        setAllRatings(ratings)
      } catch (error) {
        console.error('Error replying as business:', error)
      } finally {
        setIsReplying(false)
      }
    } else {
      // Responder como cliente normal
      const displayName = clientUser?.nombres || clientFound?.nombres || 'Cliente'
      const photoURL = clientUser?.photoURL || clientFound?.photoURL || ''
      
      setIsReplying(true)
      try {
        await addStoreRatingReply(business.id, ratingId, {
          userName: displayName,
          userPhone: activePhone || '',
          userPhoto: photoURL,
          comment: replyText
        })
        setReplyText('')
        setShowReplyFor(null)
        setReplyingAsType('client')
        const ratings = await getBusinessRatings(business.id, 100)
        setAllRatings(ratings)
      } catch (error) {
        console.error('Error replying:', error)
      } finally {
        setIsReplying(false)
      }
    }
  }

  const handleDeleteReply = async (ratingId: string, replyId: string) => {
    try {
      await deleteStoreRatingReply(business.id, ratingId, replyId, activePhone || '', businessOwnerId || undefined)
      const ratings = await getBusinessRatings(business.id, 100)
      setAllRatings(ratings)
    } catch (error) {
      console.error('Error deleting reply:', error)
    }
  }

  useEffect(() => {
    if (clientPhone || clientUser?.celular) {
      setActivePhone(resolveClientPhone(clientPhone || clientUser?.celular || null))
    }
  }, [clientPhone, clientUser])

  // Login states
  const [customerData, setCustomerData] = useState({ name: '', phone: '' })
  const [phoneConfirmation, setPhoneConfirmation] = useState('')
  const [clientFound, setClientFound] = useState<any | null>(null)
  const [clientSearching, setClientSearching] = useState(false)
  const [showNameField, setShowNameField] = useState(false)
  const [phoneError, setPhoneError] = useState('')
  const [nameError, setNameError] = useState('')

  const loadRatings = async () => {
    if (!business?.id) return
    setLoadingRatings(true)
    try {
      const ratings = await getBusinessRatings(business.id, 100)
      setAllRatings(ratings)
    } catch (e) {
      console.error('Error loading ratings:', e)
    } finally {
      setLoadingRatings(false)
    }
  }

  // Función para buscar cliente por teléfono
  async function handlePhoneSearch(phone: string) {
    if (!phone.trim()) {
      setClientFound(null)
      setShowNameField(false)
      setPhoneError('')
      return
    }

    const normalizedPhone = normalizeEcuadorianPhone(phone)
    if (!validateEcuadorianPhone(normalizedPhone)) {
      setPhoneError('Ingresa un número ecuatoriano válido')
      setClientFound(null)
      setShowNameField(false)
      return
    }

    setPhoneError('')
    setClientSearching(true)

    try {
      // Buscar con el número normalizado
      const client = await searchClientByPhone(normalizedPhone)
      if (client) {
        // Cliente encontrado - mostrar confirmación
        setClientFound(client)
        setCustomerData(prev => ({
          ...prev,
          phone: normalizedPhone,
          name: client.nombres || ''
        }))
        setShowNameField(false)
        // No hacer auto-login aquí, esperar confirmación
      } else {
        // Cliente no encontrado - mostrar formulario de registro
        setClientFound(null)
        setShowNameField(true)
        setCustomerData(prev => ({ ...prev, phone: normalizedPhone }))
      }
    } catch (error) {
      console.error('Error searching client:', error)
      setPhoneError('Error al buscar el cliente')
      setClientFound(null)
      setShowNameField(false)
    } finally {
      setClientSearching(false)
    }
  }

  // Función para confirmar login del cliente encontrado
  async function handleConfirmLogin() {
    if (!clientFound) return

    try {
      // Auto-login del cliente
      login(clientFound as any)

      // Registrar login desde Rating
      if (clientFound.id) {
        await updateClient(clientFound.id, {
          lastLoginAt: serverTimestamp(),
          loginSource: 'rating'
        })
      }

      const phoneToUse = resolveClientPhone(clientFound.celular || customerData.phone) || customerData.phone
      localStorage.setItem('loginPhone', phoneToUse)
      setActivePhone(phoneToUse)

      onSuccess('¡Bienvenido!')
    } catch (error) {
      console.error('Error en login:', error)
      setPhoneError('Error al iniciar sesión')
    }
  }

  // Función para crear nuevo cliente
  async function handleCreateClient() {
    if (!customerData.phone || !customerData.name) {
      setNameError('El nombre es requerido')
      return
    }

    const normalizedPhone = normalizeEcuadorianPhone(customerData.phone)
    if (!validateEcuadorianPhone(normalizedPhone)) {
      setPhoneError('Número de teléfono inválido')
      return
    }

    setIsSubmitting(true)
    setNameError('')
    setPhoneError('')

    try {
      // Verificar si el cliente ya existe por si acaso
      const existingClient = await searchClientByPhone(normalizedPhone)
      if (existingClient) {
        // Actualizar nombre si es diferente
        if (existingClient.nombres !== customerData.name.trim()) {
          try {
            await updateClient(existingClient.id, {
              nombres: customerData.name.trim(),
              lastLoginAt: serverTimestamp(),
              loginSource: 'rating'
            })
          } catch (e) {
            console.warn('No se pudo actualizar el nombre del cliente existente:', e)
          }
        }

        const updatedClient = { ...existingClient, nombres: customerData.name.trim() }
        setClientFound(updatedClient)
        setShowNameField(false)
        setCustomerData(prev => ({ ...prev, phone: normalizedPhone }))

        // Auto-login del cliente actualizado
        login(updatedClient as any)
        
        localStorage.setItem('loginPhone', normalizedPhone)
        setActivePhone(normalizedPhone)
        
        return
      }

      const newClient = await createClient({
        celular: normalizedPhone,
        nombres: customerData.name.trim(),
        fecha_de_registro: new Date().toISOString()
      })

      // Registrar login desde Rating
      if (newClient && newClient.id) {
        await updateClient(newClient.id, {
          lastRegistrationAt: serverTimestamp(),
          lastLoginAt: serverTimestamp(),
          loginSource: 'rating'
        })
      }

      const clientData = {
        id: newClient?.id,
        celular: normalizedPhone,
        nombres: customerData.name.trim(),
        fecha_de_registro: new Date().toISOString()
      }

      setClientFound(clientData)
      setShowNameField(false)

      // Auto-login del nuevo cliente
      login(clientData as any)
      
      localStorage.setItem('loginPhone', normalizedPhone)
      setActivePhone(normalizedPhone)
      
    } catch (error) {
      console.error('Error creating/updating client:', error)
      setNameError('Error al crear el cliente. Intenta nuevamente.')
    } finally {
      setIsSubmitting(false)
    }
  }

  useEffect(() => {
    if (isOpen && business?.id) {
      loadRatings()
      
      const loadPreviousData = async () => {
        if (activePhone) {
          setLoadingInitial(true)
          try {
            const prev = await getUserStoreRating(business.id, activePhone)
            if (prev) {
              setRating(prev.rating)
              setComment(prev.comment || '')
              setExistingRatingId(prev.id || null)
              setIsEditing(false)
            } else {
              setRating(0)
              setComment('')
              setExistingRatingId(null)
              setIsEditing(false)
            }
          } catch (e) {
            console.error('Error loading previous rating:', e)
          } finally {
            setLoadingInitial(false)
          }
        } else {
          setRating(0)
          setComment('')
          setExistingRatingId(null)
          setIsEditing(false)
          setLoadingInitial(false)
        }
      }
      loadPreviousData()
    }
  }, [isOpen, business?.id, activePhone])

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (rating === 0 || !business?.id) return

    setIsSubmitting(true)
    try {
      await saveStoreRating(
        business.id,
        rating,
        comment,
        {
          name: clientUser?.nombres || clientFound?.nombres || 'Cliente',
          phone: activePhone || '',
          email: clientUser?.email || '',
          photoURL: clientUser?.photoURL || clientFound?.photoURL || ''
        }
      )
      await loadRatings()
      if (activePhone) {
        const updatedRating = await getUserStoreRating(business.id, activePhone)
        if (updatedRating) {
          setRating(updatedRating.rating)
          setComment(updatedRating.comment || '')
          setExistingRatingId(updatedRating.id || null)
        }
      }
      onSuccess(isEditing ? '¡Calificación actualizada!' : '¡Gracias por tu calificación!')
      setIsEditing(false)
      setShowRatingMenu(false)
    } catch (error) {
      console.error('Error al enviar la calificación:', error)
      alert('Error al guardar la calificación')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async (ratingId: string) => {
    if (!business?.id || !window.confirm('¿Eliminar esta calificación?')) return
    try {
      await deleteStoreRating(business.id, ratingId)
      onSuccess('Calificación eliminada')
      setRating(0)
      setComment('')
      setExistingRatingId(null)
      setIsEditing(false)
      setShowRatingMenu(false)
      loadRatings()
    } catch (error) {
      console.error('Error al eliminar:', error)
      alert('Error al eliminar')
    }
  }

  const handleDeleteMyRating = async () => {
    if (!business?.id || !existingRatingId) return
    if (!window.confirm('¿Estás seguro de que quieres eliminar tu calificación?')) return
    
    setIsSubmitting(true)
    try {
      await deleteStoreRating(business.id, existingRatingId)
      onSuccess('Calificación eliminada')
      setRating(0)
      setComment('')
      setExistingRatingId(null)
      setIsEditing(false)
      setShowRatingMenu(false)
      loadRatings()
    } catch (error) {
      console.error('Error al eliminar calificación:', error)
      alert('Error al eliminar')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCancelEdit = () => {
    setIsEditing(false)
    setShowRatingMenu(false)
    // Recargar datos anteriores
    const loadPreviousData = async () => {
      if (activePhone && business?.id) {
        try {
          const prev = await getUserStoreRating(business.id, activePhone)
          if (prev) {
            setRating(prev.rating)
            setComment(prev.comment || '')
          }
        } catch (e) {
          console.error('Error reloading previous rating:', e)
        }
      }
    }
    loadPreviousData()
  }

  // Si no hay cliente logueado, mostrar login UI
  if (!activePhone) {
    return (
      <div className="fixed inset-0 z-[200] overflow-hidden">
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300" onClick={onClose} />

        <div className="flex items-end sm:items-center justify-center min-h-screen p-0 sm:p-4">
          <div className="relative w-full max-w-md bg-gray-50 rounded-t-[2.5rem] sm:rounded-[2.5rem] shadow-[0_32px_80px_rgba(15,23,42,0.22)] overflow-hidden transform transition-all animate-in slide-in-from-bottom sm:zoom-in duration-300 flex flex-col max-h-[90svh] border border-white/70">
            
            <div className="px-6 pt-8 pb-6 text-center border-b border-gray-100 flex-shrink-0 bg-white">
              <button
                onClick={onClose}
                className="absolute top-6 right-6 p-2 text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded-full transition-all"
              >
                <i className="bi bi-x-lg"></i>
              </button>
              <div className="w-16 h-16 bg-red-50 text-red-500 rounded-2xl flex items-center justify-center mx-auto mb-4 text-3xl shadow-sm border border-red-100">
                ⭐
              </div>
              <h3 className="text-2xl font-black text-gray-900 tracking-tight leading-tight">Inicia sesión para calificar</h3>
              <p className="text-sm text-gray-500 mt-2 leading-relaxed">Tu opinión ayuda mucho a {business.name}</p>
            </div>

            <div className="p-6 pb-32 sm:pb-6 overflow-y-auto flex-1 no-scrollbar bg-gray-50">
              <div className="space-y-4">
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-2 ml-1">Número de celular</label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                      <i className="bi bi-phone"></i>
                    </span>
                    <input
                      type="tel"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={customerData.phone}
                      onChange={(e) => {
                        const phone = e.target.value
                        setCustomerData({ ...customerData, phone })
                        handlePhoneSearch(phone)
                      }}
                      onBlur={(e) => {
                        const phone = e.target.value
                        const normalizedPhone = normalizeEcuadorianPhone(phone)
                        if (validateEcuadorianPhone(normalizedPhone)) {
                          setCustomerData({ ...customerData, phone: normalizedPhone })
                        }
                      }}
                      className={`w-full pl-10 pr-4 py-3.5 bg-white border rounded-2xl text-sm text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-400 transition-all ${phoneError ? 'ring-2 ring-red-100 border-red-300' : 'border-gray-100 hover:border-red-100'}`}
                      placeholder="0999999999"
                      maxLength={10}
                      disabled={clientSearching}
                    />
                  </div>
                  {clientFound && (
                    <button
                      onClick={() => {
                        setClientFound(null)
                        setCustomerData({ name: '', phone: '' })
                        setShowNameField(false)
                        setPhoneError('')
                        setPhoneConfirmation('')
                      }}
                      className="px-4 py-2 text-sm font-bold text-red-600 hover:bg-red-50 rounded-2xl transition-colors"
                      title="Cambiar número"
                    >
                      Cambiar
                    </button>
                  )}
                </div>
                {phoneError && <p className="text-red-500 text-xs mt-2 ml-1 font-medium">{phoneError}</p>}

                {/* Searching indicator */}
                {clientSearching && (
                  <div className="mt-3 flex items-center gap-2 text-red-500 animate-fadeIn text-sm font-medium">
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-red-200 border-t-red-500"></div>
                    <p className="text-sm">Buscando cliente...</p>
                  </div>
                )}

                {/* Cliente encontrado - mostrar confirmación */}
                {!clientSearching && clientFound && (
                  <div className="mt-4 pt-4 border-t border-gray-100 animate-fadeIn">
                    <div className="bg-white border border-gray-100 rounded-2xl p-4 mb-4 shadow-sm">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-12 h-12 bg-red-50 rounded-2xl flex items-center justify-center border border-red-100">
                          <i className="bi bi-person-check-fill text-red-500 text-xl"></i>
                        </div>
                        <div>
                          <p className="text-lg font-black text-gray-900 tracking-tight">¿Eres {clientFound.nombres}?</p>
                          <p className="text-sm text-gray-500">Encontramos una cuenta con este número</p>
                        </div>
                      </div>
                      <button
                        onClick={handleConfirmLogin}
                        className="w-full py-3.5 bg-gray-900 text-white font-black rounded-2xl hover:bg-black transition-colors flex items-center justify-center gap-2 shadow-[0_12px_30px_rgba(17,24,39,0.15)]"
                      >
                        <i className="bi bi-check-circle"></i>
                        Continuar como {clientFound.nombres}
                      </button>
                      <button
                        onClick={() => {
                          setClientFound(null)
                          setCustomerData({ name: '', phone: '' })
                          setShowNameField(false)
                          setPhoneError('')
                          setPhoneConfirmation('')
                        }}
                        className="w-full mt-2 py-2 text-sm text-gray-500 hover:text-gray-800 transition-colors font-medium"
                      >
                        No, soy otra persona
                      </button>
                    </div>
                  </div>
                )}

                {/* Cliente no encontrado - pedir nombre para registrar */}
                {!clientSearching && !clientFound && showNameField && customerData.phone.trim() && validateEcuadorianPhone(normalizeEcuadorianPhone(customerData.phone)) && (
                  <div className="mt-4 pt-4 border-t border-gray-100 animate-fadeIn">
                    <div className="bg-white border border-gray-100 rounded-2xl p-4 mb-4 shadow-sm">
                      <p className="text-sm text-gray-600 leading-relaxed">
                        <i className="bi bi-info-circle mr-2"></i>
                        Número no registrado. Por favor ingresa tus datos para continuar.
                      </p>
                    </div>

                    {/* Campo de confirmación de teléfono */}
                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-2 ml-1">Confirmar celular *</label>
                    <div className="relative mb-4">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                        <i className="bi bi-phone-fill"></i>
                      </span>
                      <input
                        type="tel"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={phoneConfirmation}
                        onChange={(e) => setPhoneConfirmation(e.target.value)}
                        className={`w-full pl-10 pr-12 py-3.5 bg-white border rounded-2xl text-sm shadow-sm focus:outline-none focus:ring-2 transition-all ${phoneConfirmation.trim() && phoneConfirmation === customerData.phone
                          ? 'border-emerald-300 ring-2 ring-emerald-100 focus:ring-emerald-500/20'
                          : phoneConfirmation.trim() && phoneConfirmation !== customerData.phone
                            ? 'border-red-300 ring-2 ring-red-100 focus:ring-red-500/20'
                            : 'border-gray-100 hover:border-red-100 focus:ring-red-500/20'
                          }`}
                        placeholder="Vuelve a escribir tu celular"
                        maxLength={10}
                      />
                      {/* Ícono de validación */}
                      {phoneConfirmation.trim() && (
                        <span className="absolute right-3 top-1/2 -translate-y-1/2">
                          {phoneConfirmation === customerData.phone ? (
                            <i className="bi bi-check-circle-fill text-green-500 text-xl"></i>
                          ) : (
                            <i className="bi bi-x-circle-fill text-red-500 text-xl"></i>
                          )}
                        </span>
                      )}
                    </div>

                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-2 ml-1">Nombre completo *</label>
                    <input
                      type="text"
                      required
                      value={customerData.name}
                      onChange={(e) => setCustomerData({ ...customerData, name: e.target.value })}
                      className={`w-full px-4 py-3.5 bg-white border rounded-2xl text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-red-500/20 transition-all ${nameError ? 'border-red-300 ring-red-100' : 'border-gray-100 hover:border-red-100'}`}
                      placeholder="Juan Pérez"
                    />
                    {nameError && <p className="text-red-500 text-sm mt-1 font-medium">{nameError}</p>}

                    <button
                      onClick={handleCreateClient}
                      disabled={!customerData.name.trim() || !phoneConfirmation.trim() || phoneConfirmation !== customerData.phone || isSubmitting}
                      className="w-full mt-3 px-4 py-3.5 bg-gray-900 text-white rounded-2xl hover:bg-black transition-colors disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed font-black shadow-[0_12px_30px_rgba(17,24,39,0.15)]"
                    >
                      {isSubmitting ? (
                        <div className="flex items-center justify-center gap-2">
                          <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                          <span>Creando cuenta...</span>
                        </div>
                      ) : 'Continuar'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Si hay cliente logueado, mostrar rating UI normal
  return (
    <div className="fixed inset-0 z-[200] sm:overflow-hidden">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300" onClick={onClose} />

      <div className="flex items-end sm:items-center justify-center min-h-screen p-0 sm:p-4">
        <div className="relative w-full max-w-md bg-gray-50 rounded-t-[2.5rem] sm:rounded-[2.5rem] shadow-[0_32px_80px_rgba(15,23,42,0.22)] overflow-hidden transform transition-all animate-in slide-in-from-bottom sm:zoom-in duration-300 flex flex-col sm:max-h-[90svh] h-[100svh] sm:h-auto border border-white/70">
          
          <button
            onClick={onClose}
            className="absolute top-6 right-6 p-2 text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded-full transition-all z-10"
          >
            <i className="bi bi-x-lg"></i>
          </button>

          <div className="p-6 pt-8 pb-32 sm:pb-6 overflow-y-auto flex-1 no-scrollbar bg-gray-50">
            <div className="text-center border-b border-gray-100 pb-6 mb-6 bg-white -mx-6 px-6 pt-0">
              <div className="w-16 h-16 bg-red-50 text-red-500 rounded-2xl flex items-center justify-center mx-auto mb-4 text-3xl shadow-sm border border-red-100">
                ⭐
              </div>
              <h3 className="text-2xl font-black text-gray-900 tracking-tight leading-tight">¿Qué tal tu experiencia?</h3>
              <p className="text-sm text-gray-500 mt-2 leading-relaxed">Tu opinión ayuda mucho a {business.name}</p>
            </div>

            {loadingInitial ? (
              <div className="py-12 flex flex-col items-center justify-center gap-3">
                <div className="w-8 h-8 border-3 border-red-500 border-t-transparent rounded-full animate-spin"></div>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Cargando...</p>
              </div>
            ) : (() => {
              const displayName = clientUser?.nombres || clientFound?.nombres || 'Cliente'
              return (
                <form onSubmit={handleSubmit} className="bg-white border border-gray-100 rounded-[1.75rem] p-4 shadow-sm mb-6">
                  <div className="flex gap-3">
                    {/* Avatar Compacto */}
                    <div className="flex-shrink-0">
                      {clientUser?.photoURL ? (
                        <img src={clientUser.photoURL} alt={displayName} className="w-11 h-11 rounded-2xl object-cover border border-gray-100 shadow-sm" />
                      ) : (
                        <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-red-500 to-rose-400 flex items-center justify-center text-white font-black text-sm border border-red-100 shadow-sm">
                          {displayName.charAt(0).toUpperCase()}
                        </div>
                      )}
                    </div>
                    
                    <div className="flex-1 min-w-0 relative">
                      {existingRatingId && !isEditing && (
                        <div className="absolute top-0 right-0">
                          <div className="relative">
                            <button
                              type="button"
                              onClick={() => setShowRatingMenu(!showRatingMenu)}
                              className="p-1.5 text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded-full transition-all"
                              title="Opciones"
                            >
                              <i className="bi bi-three-dots-vertical text-lg"></i>
                            </button>

                            {showRatingMenu && (
                              <>
                                <div
                                  className="fixed inset-0 z-[59]"
                                  onClick={() => setShowRatingMenu(false)}
                                />

                                <div className="absolute right-0 mt-1 w-40 bg-white rounded-2xl shadow-lg border border-gray-100 py-1 z-[60] animate-in fade-in zoom-in duration-200">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setIsEditing(true)
                                      setShowRatingMenu(false)
                                    }}
                                    className="w-full text-left px-4 py-2.5 hover:bg-gray-50 transition-colors flex items-center gap-3 text-sm font-bold text-gray-900"
                                  >
                                    <i className="bi bi-pencil text-blue-500"></i>
                                    Editar
                                  </button>
                                  <div className="h-px bg-gray-100"></div>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setShowRatingMenu(false)
                                      handleDeleteMyRating()
                                    }}
                                    className="w-full text-left px-4 py-2.5 hover:bg-red-50 transition-colors flex items-center gap-3 text-sm font-bold text-red-600"
                                  >
                                    <i className="bi bi-trash3 text-red-500"></i>
                                    Eliminar
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      )}

                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3 pr-8">
                        <div>
                          <p className="font-bold text-base text-gray-900 truncate leading-tight">{displayName}</p>
                          <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mt-1">Tu reseña</p>
                        </div>
                        <div className="flex items-center gap-1">
                          {[1, 2, 3, 4, 5].map((star) => (
                            <button
                              key={star}
                              type="button"
                              disabled={!!existingRatingId && !isEditing}
                              className={`text-lg transition-all duration-300 transform ${star <= (hover || rating) ? 'text-amber-400 scale-110' : 'text-gray-200'} ${existingRatingId && !isEditing ? 'cursor-not-allowed opacity-60' : 'hover:scale-125'}`}
                              onClick={() => setRating(star)}
                              onMouseEnter={() => !existingRatingId || isEditing ? setHover(star) : null}
                              onMouseLeave={() => !existingRatingId || isEditing ? setHover(rating) : null}
                            >
                              <i className={`bi ${star <= (hover || rating) ? 'bi-star-fill' : 'bi-star'}`}></i>
                            </button>
                          ))}
                        </div>
                      </div>

                      <textarea
                        rows={2}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-2xl text-sm text-gray-700 focus:bg-white focus:ring-2 focus:ring-red-500/20 focus:border-red-400 outline-none transition-all placeholder:text-gray-400 resize-none mb-3"
                        placeholder="Comparte tu experiencia..."
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        disabled={!!existingRatingId && !isEditing}
                      />

                      <div className="flex items-center justify-between">
                        <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-1">
                          <i className="bi bi-globe"></i>
                          Público
                        </span>
                        
                        {/* Si existe calificación y no estamos editando, mostrar menú de 3 puntos */}
                        {existingRatingId && !isEditing ? null : isEditing ? (
                          /* Estamos editando - mostrar botones de Guardar y Cancelar */
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={handleCancelEdit}
                              disabled={isSubmitting}
                              className="px-4 py-2.5 rounded-2xl font-black uppercase tracking-[0.18em] text-[10px] transition-all duration-300 bg-gray-100 text-gray-900 hover:bg-gray-200 active:scale-95"
                            >
                              Cancelar
                            </button>
                            <button
                              type="submit"
                              disabled={isSubmitting || rating === 0}
                              className={`px-5 py-2.5 rounded-2xl font-black uppercase tracking-[0.18em] text-[10px] transition-all duration-300 flex items-center gap-2 ${rating === 0
                                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                : 'bg-gray-900 text-white shadow-[0_12px_30px_rgba(17,24,39,0.15)] hover:bg-black hover:scale-[1.02] active:scale-95'
                                }`}
                            >
                              {isSubmitting ? (
                                <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                              ) : (
                                <>
                                  <span>Guardar</span>
                                  <i className="bi bi-check-lg"></i>
                                </>
                              )}
                            </button>
                          </div>
                        ) : (
                          /* No existe calificación - mostrar botón Publicar normal */
                          <button
                            type="submit"
                            disabled={isSubmitting || rating === 0}
                            className={`px-5 py-2.5 rounded-2xl font-black uppercase tracking-[0.18em] text-[10px] transition-all duration-300 flex items-center gap-2 ${rating === 0
                              ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                              : 'bg-red-500 text-white shadow-[0_12px_30px_rgba(239,68,68,0.2)] hover:bg-red-600 hover:scale-[1.02] active:scale-95'
                              }`}
                          >
                            {isSubmitting ? (
                              <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                            ) : (
                              <>
                                <span>Publicar</span>
                                <i className="bi bi-send-fill"></i>
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </form>
              )
            })()}

            {/* Lista de Calificaciones Existentes - Rediseño más limpio */}
            <div className="mt-8 space-y-6">
              <div className="flex items-center justify-between mb-6">
                <h4 className="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em] flex items-center gap-2">
                  <i className="bi bi-chat-quote-fill text-red-500"></i>
                  Opiniones de la comunidad
                </h4>
                {((business.ratingCount ?? 0) > 0 || allRatings.length > 0) && (
                  <span className="text-[9px] font-black text-red-500 bg-red-50 px-2.5 py-1 rounded-full border border-red-100">
                    {business.ratingCount ?? allRatings.length} reseñas
                  </span>
                )}
              </div>

              {loadingRatings ? (
                <div className="py-8 flex justify-center">
                  <div className="w-5 h-5 border-2 border-gray-100 border-t-red-500 rounded-full animate-spin"></div>
                </div>
              ) : allRatings.length > 0 ? (
                <div className="grid gap-4">
                  {allRatings.map((r) => (
                    <div key={r.id} className="relative pl-12 group">
                      {/* Avatar Absoluto */}
                      <div className="absolute left-0 top-0">
                        <div className="w-10 h-10 rounded-2xl overflow-hidden border-2 border-white shadow-md ring-1 ring-gray-100 transform -rotate-3 group-hover:rotate-0 transition-transform duration-300 bg-white">
                          {r.clientPhotoURL ? (
                            <img src={r.clientPhotoURL} alt={r.clientName} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full bg-slate-100 flex items-center justify-center text-[10px] font-black text-slate-500 uppercase">
                              {r.clientName?.charAt(0) || 'C'}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="bg-white border border-gray-100 rounded-[1.5rem] p-4 shadow-sm hover:shadow-md hover:border-red-100 transition-all">
                        <div className="flex items-start justify-between gap-3 mb-3">
                          <div>
                            <p className="text-sm font-bold text-gray-900 leading-none mb-1">{r.clientName || 'Cliente'}</p>
                            <div className="flex text-[10px] text-amber-400 gap-0.5">
                              {[...Array(5)].map((_, i) => (
                                <i key={i} className={`bi ${i < r.rating ? 'bi-star-fill' : 'bi-star'}`}></i>
                              ))}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[9px] font-black text-gray-300 uppercase tracking-[0.18em]">
                              {r.createdAt ? new Date(r.createdAt.seconds * 1000).toLocaleDateString('es-EC', { day: '2-digit', month: 'short' }) : ''}
                            </span>
                            {r.clientPhone === activePhone && (
                              <button
                                onClick={() => r.id && handleDelete(r.id)}
                                className="w-7 h-7 flex items-center justify-center text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                                title="Eliminar mi calificación"
                              >
                                <i className="bi bi-trash3 text-xs"></i>
                              </button>
                            )}
                          </div>
                        </div>
                        {r.comment && (
                          <p className="text-sm text-gray-600 leading-relaxed border-l-2 border-red-100 pl-3 py-1">
                            "{r.comment}"
                          </p>
                        )}

                        {/* Social Actions */}
                        <div className="mt-3 pt-3 border-t border-gray-50 flex items-center gap-6">
                          <button 
                            onClick={() => r.id && handleToggleLike(r.id)}
                            className={`flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.16em] transition-all ${r.likes?.includes(activePhone || '') ? 'text-red-500 scale-110' : 'text-gray-400 hover:text-gray-600'}`}
                          >
                            <i className={`bi ${r.likes?.includes(activePhone || '') ? 'bi-heart-fill' : 'bi-heart'}`}></i>
                            <span>{r.likes?.length || 0}</span>
                          </button>
                          
                          <button 
                            onClick={() => {
                              if (showReplyFor === r.id) {
                                setShowReplyFor(null)
                                setReplyingAsType('client')
                                setReplyText('')
                              } else {
                                setShowReplyFor(r.id || null)
                                // Si es owner y tiene cliente activo, preguntar con cuál responder
                                if (isOwner && activePhone) {
                                  setReplyingAsType('business') // Por defecto como tienda si es owner
                                } else if (isOwner) {
                                  setReplyingAsType('business')
                                } else {
                                  setReplyingAsType('client')
                                }
                              }
                            }}
                            className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-gray-400 hover:text-gray-600 transition-all"
                          >
                            <i className="bi bi-chat-dots-fill"></i>
                            <span>Comentar</span>
                          </button>
                        </div>

                        {/* Input de respuesta */}
                        {showReplyFor === r.id && (
                          <div className="mt-4 bg-gray-50 p-3 rounded-2xl flex gap-2 items-end border border-gray-100">
                            {/* Toggle Logo/Avatar - Solo si es owner Y tiene cliente activo */}
                            {isOwner && activePhone && (
                              <button
                                type="button"
                                onClick={() => setReplyingAsType(replyingAsType === 'business' ? 'client' : 'business')}
                                className={`flex-shrink-0 w-10 h-10 rounded-full transition-all transform hover:scale-110 active:scale-95 flex items-center justify-center ${
                                  replyingAsType === 'business' 
                                    ? 'bg-gray-900 border-2 border-gray-900 shadow-md' 
                                    : 'bg-white border-2 border-gray-200 hover:bg-gray-100'
                                }`}
                                title={replyingAsType === 'business' ? 'Respondiendo como tienda' : 'Respondiendo como cliente'}
                              >
                                {replyingAsType === 'business' ? (
                                  business.image ? (
                                    <img 
                                      src={business.image} 
                                      alt={business.name}
                                      className="w-full h-full rounded-full object-cover"
                                    />
                                  ) : (
                                    <i className="bi bi-shop text-lg text-white"></i>
                                  )
                                ) : (
                                  clientUser?.photoURL ? (
                                    <img 
                                      src={clientUser.photoURL}
                                      alt={clientUser?.nombres}
                                      className="w-full h-full rounded-full object-cover"
                                    />
                                  ) : (
                                    <div className="w-full h-full bg-gradient-to-br from-red-500 to-rose-400 flex items-center justify-center text-white font-black text-sm rounded-full">
                                      {(clientUser?.nombres || 'C').charAt(0).toUpperCase()}
                                    </div>
                                  )
                                )}
                              </button>
                            )}
                            <input 
                              autoFocus
                              className="flex-1 bg-white border border-gray-100 rounded-xl px-3 py-2 text-sm text-gray-700 outline-none focus:border-red-400 focus:ring-2 focus:ring-red-500/20"
                              placeholder="Escribe un comentario..."
                              value={replyText}
                              onChange={(e) => setReplyText(e.target.value)}
                              onKeyDown={(e) => e.key === 'Enter' && r.id && handleAddReply(r.id)}
                            />
                            <button 
                              disabled={isReplying || !replyText.trim()}
                              onClick={() => r.id && handleAddReply(r.id)}
                              className={`flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center font-black transition-all ${
                                replyingAsType === 'business' && isOwner
                                  ? 'bg-gray-900 text-white hover:bg-black disabled:bg-gray-100 disabled:text-gray-300'
                                  : 'bg-red-500 text-white hover:bg-red-600 disabled:bg-gray-100 disabled:text-gray-300'
                              }`}
                              title={replyingAsType === 'business' ? 'Enviar como respuesta oficial de tienda' : 'Enviar como cliente'}
                            >
                              {isReplying ? <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> : <i className="bi bi-send-fill text-xs"></i>}
                            </button>
                          </div>
                        )}
                        
                        {/* Indicador del modo de respuesta */}
                        {showReplyFor === r.id && isOwner && activePhone && (
                          <p className="text-[8px] font-black text-gray-400 uppercase tracking-[0.16em] mt-2 ml-2">
                            {replyingAsType === 'business' ? '🏪 Respondiendo como tienda' : '👤 Respondiendo como cliente'}
                          </p>
                        )}

                        {/* Lista de respuestas */}
                        {r.replies && r.replies.length > 0 && (
                          <div className="mt-4 space-y-3 pl-3 border-l-2 border-gray-100">
                            {r.replies.map((reply, index) => (
                              <div key={reply.id || index} className={`flex gap-2.5 last:mb-0 p-3 rounded-2xl border ${reply.isBusinessReply ? 'bg-gray-900/[0.03] border-gray-200' : 'bg-white border-gray-100'}`}>
                                <div className="flex-shrink-0">
                                  {reply.userPhoto ? (
                                    <img src={reply.userPhoto} className="w-5 h-5 rounded-full object-cover" />
                                  ) : (
                                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[8px] font-black ${reply.isBusinessReply ? 'bg-gray-900 text-white' : 'bg-slate-200 text-slate-500'}`}>
                                      {(reply.isBusinessReply ? reply.businessReplyName : reply.userName)?.charAt(0) || 'C'}
                                    </div>
                                  )}
                                </div>
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 mb-1">
                                    <p className="text-[11px] font-bold text-gray-900 leading-none">
                                      {reply.isBusinessReply ? reply.businessReplyName : reply.userName}
                                    </p>
                                    {reply.isBusinessReply && (
                                      <div className="w-4 h-4 bg-red-500 rounded-full flex items-center justify-center">
                                        <i className="bi bi-check text-white text-[8px]"></i>
                                      </div>
                                    )}
                                  </div>
                                  <p className="text-xs text-gray-500 leading-relaxed">
                                    {reply.comment}
                                  </p>
                                </div>
                                {((reply.userPhone === activePhone && !reply.isBusinessReply) || (reply.isBusinessReply && isOwner)) && (
                                  <button
                                    onClick={() => r.id && handleDeleteReply(r.id, reply.id)}
                                    className="text-[10px] text-gray-300 hover:text-red-500 transition-all self-start pt-1"
                                    title="Eliminar comentario"
                                  >
                                    <i className="bi bi-x-circle-fill"></i>
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 bg-white rounded-[2rem] border border-dashed border-gray-200 shadow-sm">
                  <div className="w-12 h-12 bg-gray-50 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-sm border border-gray-100">
                    <i className="bi bi-chat-heart text-2xl text-gray-300"></i>
                  </div>
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Sé el primero en calificar</p>
                </div>
              )}
            </div>
          </div>
        </div>
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
  )
}


