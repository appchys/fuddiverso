'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import {
  updateClient,
  searchClientByPhone,
  getClientLocations,
  getAllUserQRProgress,
  getBusiness,
  getQRCodesByBusiness,
  redeemQRCodePrize,
  unredeemQRCodePrize,
  storage,
  getUserReferrals,
  getAllUserCredits
} from '@/lib/database'
import CartSidebar from '@/components/CartSidebar'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { optimizeImage } from '@/lib/image-utils'
import { validateEcuadorianPhone, normalizeEcuadorianPhone } from '@/lib/validation'
import Link from 'next/link'
import { useRef } from 'react'
import UserSidebar from '@/components/UserSidebar'
import ClientLoginModal from '@/components/ClientLoginModal'

// Tipos auxiliares para la vista
interface EnrichedCard {
  businessName: string
  businessImage?: string
  businessId: string
  scannedCount: number
  totalCards: number
  lastScanned?: Date
  scannedQRs: {
    id: string
    name: string
    prize?: string
    image?: string
    status: 'available' | 'in_cart' | 'redeemed'
  }[]
}

export default function ProfilePage() {
  const { user, isAuthenticated, login } = useAuth()
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<'locations' | 'cards' | 'reviews' | 'info' | 'recommendations'>('cards')
  const [authLoading, setAuthLoading] = useState(true)

  // DATA STATES
  const [locations, setLocations] = useState<any[]>([])
  const [cardsData, setCardsData] = useState<EnrichedCard[]>([])
  const [isCartOpen, setIsCartOpen] = useState(false)
  const [selectedBusiness, setSelectedBusiness] = useState<any>(null)
  const [selectedBusinessCart, setSelectedBusinessCart] = useState<any[]>([])
  const [redeemingQrId, setRedeemingQrId] = useState<string | null>(null)

  // EDIT PROFILE STATES
  const [isEditing, setIsEditing] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)

  const [formData, setFormData] = useState({
    nombres: '',
    celular: '',
    email: ''
  })
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isUserSidebarOpen, setIsUserSidebarOpen] = useState(false)
  const [showLoginModal, setShowLoginModal] = useState(false)

  // REFERRAL STATES
  const [referrals, setReferrals] = useState<any[]>([])
  const [referralStats, setReferralStats] = useState({
    totalClicks: 0,
    totalSales: 0,
    totalCredits: 0
  })
  const [loadingReferrals, setLoadingReferrals] = useState(false)
  const [copyingId, setCopyingId] = useState<string | null>(null)

  // INIT
  useEffect(() => {
    // Pequeño delay para permitir que AuthContext cargue de localStorage
    const timer = setTimeout(() => {
      setAuthLoading(false)
      if (!isAuthenticated) {
        router.push('/')
      }
    }, 500)

    return () => clearTimeout(timer)
  }, [isAuthenticated, router])

  useEffect(() => {
    if (user) {
      setFormData({
        nombres: user.nombres || '',
        celular: user.celular || '',
        email: user.email || ''
      })
      loadProfileData()
    }
  }, [user])

  // Manejar tabs desde la URL
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      const tab = params.get('tab')
      if (tab === 'recommendations' || tab === 'locations' || tab === 'cards' || tab === 'reviews' || tab === 'info') {
        setActiveTab(tab as any)
      }
    }
  }, [])

  const loadProfileData = async () => {
    if (!user?.id) return

    // 1. Cargar Ubicaciones
    try {
      const locs = await getClientLocations(user.id)
      setLocations(locs)
    } catch (e) {
      console.error('Error loading locations:', e)
    }

    // 2. Cargar Tarjetas (Progress) y enriquecer con datos del negocio
    try {
      // Usar el número de celular normalizado como ID para buscar el progreso QR
      const effectiveId = user.celular ? normalizeEcuadorianPhone(user.celular) : user.id
      const progressList = await getAllUserQRProgress(effectiveId)
      const enrichedPromises = progressList.map(async (p: any) => {
        try {
          // Obtener datos del negocio
          const business = await getBusiness(p.businessId)
          // Obtener total de tarjetas activas del negocio para calcular total
          const allCodes = await getQRCodesByBusiness(p.businessId, true) // active only

          // Cargar carrito del negocio para ver qué hay en reserva local
          const savedCarts = localStorage.getItem('carts')
          const allCarts = savedCarts ? JSON.parse(savedCarts) : {}
          const businessCart = allCarts[p.businessId] || []

          // Obtener los detalles de los códigos que el usuario ya ha escaneado
          const scannedQRs = allCodes
            .filter(code => (p.scannedCodes || []).includes(code.id))
            .map(code => {
              const isCompleted = (p.completedRedemptions || []).includes(code.id)
              const isRedeemed = (p.redeemedPrizeCodes || []).includes(code.id)
              const isInCart = businessCart.some((item: any) => item.qrCodeId === code.id || item.id === `premio-qr-${code.id}`)

              let status: 'available' | 'in_cart' | 'redeemed' = 'available'
              if (isInCart) status = 'in_cart'
              else if (isCompleted) status = 'redeemed' // Completado permanentemente
              else if (isRedeemed) status = 'in_cart' // En proceso de canje (en carrito)

              return {
                id: code.id,
                name: code.name,
                prize: code.prize,
                image: code.image,
                status
              }
            })

          return {
            businessName: business?.name || 'Negocio Desconocido',
            businessImage: business?.image,
            businessId: p.businessId,
            scannedCount: p.scannedCodes.length,
            totalCards: allCodes.length,
            lastScanned: p.lastScanned,
            scannedQRs
          }
        } catch (err) {
          return null
        }
      })

      const results = await Promise.all(enrichedPromises)
      // Filtrar nulos y ordenar por última actividad
      const validCards = results.filter(Boolean) as EnrichedCard[]
      validCards.sort((a, b) => {
        const da = a.lastScanned ? new Date(a.lastScanned).getTime() : 0
        const db = b.lastScanned ? new Date(b.lastScanned).getTime() : 0
        return db - da
      })

      setCardsData(validCards)

    } catch (e) {
      console.error('Error loading cards progress:', e)
    }

    // 3. Cargar Datos de Referidos (Búsqueda Dual)
    if (user?.id) {
      setLoadingReferrals(true)
      try {
        const [referralsById, referralsByPhone, creditsById, creditsByPhone] = await Promise.all([
          getUserReferrals(user.id),
          user.celular ? getUserReferrals(user.celular) : Promise.resolve([]),
          getAllUserCredits(user.id),
          user.celular ? getAllUserCredits(user.celular) : Promise.resolve([])
        ])

        // Combinar referidos y eliminar duplicados
        const combinedReferrals = [...referralsById]
        referralsByPhone.forEach(ref => {
          if (!combinedReferrals.some(r => r.id === ref.id)) {
            combinedReferrals.push(ref)
          }
        })

        // Combinar créditos y eliminar duplicados (por businessId)
        const combinedCredits = [...creditsById]
        creditsByPhone.forEach(credit => {
          if (!combinedCredits.some(c => c.businessId === credit.businessId)) {
            combinedCredits.push(credit)
          } else {
            const index = combinedCredits.findIndex(c => c.businessId === credit.businessId)
            combinedCredits[index].availableCredits = (combinedCredits[index].availableCredits || 0) + (credit.availableCredits || 0)
            combinedCredits[index].totalCredits = (combinedCredits[index].totalCredits || 0) + (credit.totalCredits || 0)
          }
        })

        // Ordenar referidos por fecha descendente
        combinedReferrals.sort((a, b) => {
          const dateA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt)
          const dateB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt)
          return dateB.getTime() - dateA.getTime()
        })

        setReferrals(combinedReferrals)

        const stats = {
          totalClicks: combinedReferrals.reduce((sum, r) => sum + (r.clicks || 0), 0),
          totalSales: combinedReferrals.reduce((sum, r) => sum + (r.conversions || 0), 0),
          totalCredits: combinedCredits.reduce((sum, c) => sum + (c.availableCredits || 0), 0)
        }
        setReferralStats(stats)
      } catch (error) {
        console.error('Error loading referral data:', error)
      } finally {
        setLoadingReferrals(false)
      }
    }
  }

  // HANDLERS FOR EDIT PROFILE
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
  }

  const handleSave = async () => {
    if (!user?.id) return
    if (!formData.nombres.trim()) {
      setMessage({ type: 'error', text: 'El nombre es requerido' })
      return
    }
    if (!validateEcuadorianPhone(formData.celular)) {
      setMessage({ type: 'error', text: 'El número de celular debe tener el formato 09XXXXXXXX' })
      return
    }

    if (formData.celular !== user.celular) {
      const existingClient = await searchClientByPhone(formData.celular)
      if (existingClient && existingClient.id !== user.id) {
        setMessage({ type: 'error', text: 'Este número ya está registrado' })
        return
      }
    }

    setLoading(true)
    try {
      await updateClient(user.id, {
        nombres: formData.nombres.trim(),
        celular: formData.celular,
        email: formData.email.trim()
      })
      const updatedUser = {
        ...user,
        nombres: formData.nombres.trim(),
        celular: formData.celular,
        email: formData.email.trim()
      }
      login(updatedUser)
      setMessage({ type: 'success', text: 'Perfil actualizado' })
      setIsEditing(false)
    } catch (error) {
      setMessage({ type: 'error', text: 'Error al actualizar.' })
    } finally {
      setLoading(false)
    }
  }

  const handleAvatarClick = () => {
    fileInputRef.current?.click()
  }

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !user?.id) return

    setUploadingAvatar(true)
    setMessage(null)

    try {
      // 1. Optimizar imagen (Redimensionar a 400px y comprimir a WebP)
      const optimizedBlob = await optimizeImage(file, 400, 0.8)

      // 2. Subir a Firebase Storage
      const storageRef = ref(storage, `profiles/${user.id}/avatar.webp`)
      await uploadBytes(storageRef, optimizedBlob)
      const downloadURL = await getDownloadURL(storageRef)

      // 3. Actualizar en Firestore
      await updateClient(user.id, { photoURL: downloadURL })

      // 4. Actualizar sesión local
      login({ ...user, photoURL: downloadURL })
      setMessage({ type: 'success', text: 'Foto de perfil actualizada' })
    } catch (error) {
      console.error('Error uploading avatar:', error)
      setMessage({ type: 'error', text: 'Error al subir la imagen' })
    } finally {
      setLoading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  // CART HELPERS FOR CARTSIDEBAR
  const updateCartInStorage = (businessId: string, businessCart: any[]) => {
    const savedCarts = localStorage.getItem('carts')
    const allCarts = savedCarts ? JSON.parse(savedCarts) : {}
    if (businessCart.length === 0) {
      delete allCarts[businessId]
    } else {
      allCarts[businessId] = businessCart
    }
    localStorage.setItem('carts', JSON.stringify(allCarts))
    // Despachar evento para que otros componentes (como el Header) se enteren
    window.dispatchEvent(new Event('storage'))
  }

  const removeFromCart = (productId: string, variantName?: string | null) => {
    if (!selectedBusiness?.id) return

    // Si es un premio, intentar "des-canjear" en DB
    const itemToRemove = selectedBusinessCart.find(item => item.id === productId && item.variantName === variantName)
    if (itemToRemove?.esPremio && itemToRemove.qrCodeId && user?.celular) {
      void unredeemQRCodePrize(normalizeEcuadorianPhone(user.celular), selectedBusiness.id, itemToRemove.qrCodeId)
        .then(() => loadProfileData())
        .catch(e => console.error('Error unredeeming on remove:', e))
    }

    const newCart = selectedBusinessCart.filter(item => !(item.id === productId && item.variantName === variantName))
    setSelectedBusinessCart(newCart)
    updateCartInStorage(selectedBusiness.id, newCart)
  }

  const updateQuantity = (productId: string, quantity: number, variantName?: string | null) => {
    if (!selectedBusiness?.id) return
    if (quantity <= 0) {
      removeFromCart(productId, variantName)
      return
    }
    const newCart = selectedBusinessCart.map(item =>
      (item.id === productId && item.variantName === variantName)
        ? { ...item, quantity }
        : item
    )
    setSelectedBusinessCart(newCart)
    updateCartInStorage(selectedBusiness.id, newCart)
  }

  const addItemToCart = (item: any) => {
    if (!selectedBusiness?.id) return
    const existing = selectedBusinessCart.find(i => i.id === item.id && i.variantName === item.variantName)
    let newCart
    if (existing) {
      newCart = selectedBusinessCart.map(i => (i.id === item.id && i.variantName === item.variantName) ? { ...i, quantity: i.quantity + 1 } : i)
    } else {
      newCart = [...selectedBusinessCart, { ...item, quantity: 1 }]
    }
    setSelectedBusinessCart(newCart)
    updateCartInStorage(selectedBusiness.id, newCart)
  }

  // REFERRAL HANDLERS
  const handleCopyLink = (referral: any) => {
    const referralUrl = `${window.location.origin}/${referral.businessUsername}/${referral.productSlug}?ref=${referral.code}`
    navigator.clipboard.writeText(referralUrl)
    setCopyingId(referral.id)
    setTimeout(() => setCopyingId(null), 2000)
  }

  const handleShareWhatsApp = (referral: any) => {
    const referralUrl = `${window.location.origin}/${referral.businessUsername}/${referral.productSlug}?ref=${referral.code}`
    const message = `¡Mira este producto en ${referral.businessName}! 🤩\n\n${referral.productName}\n${referralUrl}`
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank')
  }

  const handleRedeem = async (card: EnrichedCard, qr: any) => {
    if (!user?.celular || !user.id) return
    const phone = normalizeEcuadorianPhone(user.celular)

    // Si ya está en carrito, solo abrir sidebar
    if (qr.status === 'in_cart') {
      const business = await getBusiness(card.businessId)
      setSelectedBusiness(business)
      const savedCarts = localStorage.getItem('carts')
      const allCarts = savedCarts ? JSON.parse(savedCarts) : {}
      setSelectedBusinessCart(allCarts[card.businessId] || [])
      setIsCartOpen(true)
      return
    }

    if (qr.status === 'redeemed') {
      setMessage({ type: 'error', text: 'Esta tarjeta ya ha sido canjeada anteriormente' })
      return
    }

    setRedeemingQrId(qr.id)
    try {
      const result = await redeemQRCodePrize(phone, card.businessId, qr.id)
      // Si el error es que ya fue canjeado pero no lo tenemos en el carrito, es un canje real previo.
      if (!result.success && !result.message?.includes('ya fue canjeado')) {
        setMessage({ type: 'error', text: result.message || 'No se pudo canjear' })
        return
      }

      // 1. Obtener datos del negocio para el sidebar
      const business = await getBusiness(card.businessId)
      setSelectedBusiness(business)

      // 2. Cargar carrito actual
      const savedCarts = localStorage.getItem('carts')
      const allCarts = savedCarts ? JSON.parse(savedCarts) : {}
      const currentCart = allCarts[card.businessId] || []

      // 3. Crear item de premio
      const premioId = `premio-qr-${qr.id}`
      const premioQr = {
        id: premioId,
        name: `🎁 ${qr.name}`,
        variantName: null,
        productName: `🎁 ${qr.name}`,
        description: `Premio canjeado por tarjeta: ${qr.name}`,
        price: 0,
        isAvailable: true,
        esPremio: true,
        quantity: 1,
        image: qr.image || business?.image || '/placeholder.png',
        businessId: card.businessId,
        businessName: business?.name || card.businessName,
        businessImage: business?.image || card.businessImage,
        qrCodeId: qr.id
      }

      const newCart = [...currentCart, premioQr]
      setSelectedBusinessCart(newCart)
      updateCartInStorage(card.businessId, newCart)

      // 4. Abrir sidebar y refrescar info
      setIsCartOpen(true)
      loadProfileData()
      setMessage({ type: 'success', text: '¡Tarjeta canjeada con éxito!' })

    } catch (e) {
      console.error('Error redeeming:', e)
      setMessage({ type: 'error', text: 'Error al procesar el canje' })
    } finally {
      setRedeemingQrId(null)
    }
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-500"></div>
      </div>
    )
  }

  if (!isAuthenticated || !user) return null

  const clientInitials = (user.nombres || 'User').charAt(0).toUpperCase()

  return (
    <div className="min-h-screen bg-gray-50 pb-20">

      {/* 1. PORTADA Y PERFIL (Social Media Style) */}
      <div className="bg-white shadow-sm mb-4">
        {/* Cover Photo Placeholder */}
        <div className="h-32 sm:h-48 bg-gradient-to-r from-gray-800 to-gray-900 relative">
          {/* Optional: Add actual cover photo if available */}
        </div>

        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="relative -mt-12 sm:-mt-16 mb-4 flex flex-col sm:flex-row items-center sm:items-end sm:space-x-5">
            {/* Profile Avatar with Upload */}
            <div
              onClick={handleAvatarClick}
              className="group relative w-24 h-24 sm:w-32 sm:h-32 rounded-full border-4 border-white overflow-hidden bg-gray-200 shadow-md relative z-10 cursor-pointer"
            >
              {user.photoURL ? (
                <img src={user.photoURL} alt={user.nombres} className="w-full h-full object-cover transition-filter group-hover:brightness-50" />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-gray-900 text-white text-3xl font-bold transition-filter group-hover:brightness-50">
                  {clientInitials}
                </div>
              )}

              {/* Overlay with Camera Icon */}
              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                {uploadingAvatar ? (
                  <div className="animate-spin rounded-full h-6 w-6 border-2 border-white border-t-transparent"></div>
                ) : (
                  <i className="bi bi-camera-fill text-white text-2xl"></i>
                )}
              </div>

              {/* Hidden File Input */}
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleAvatarChange}
                className="hidden"
                accept="image/*"
              />
            </div>

            {/* Basic Info */}
            <div className="mt-4 sm:mt-0 text-center sm:text-left flex-1 min-w-0">
              <h1 className="text-2xl font-bold text-gray-900 truncate">{user.nombres}</h1>
              <p className="text-sm text-gray-500">Miembro desde {user.createdAt ? new Date(user.createdAt).getFullYear() : '2024'}</p>
            </div>

            {/* Edit Profile Button (Quick Access) */}
            <div className="mt-4 sm:mt-0 flex-shrink-0">
              <button
                onClick={() => setActiveTab('info')}
                className="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
              >
                <i className="bi bi-gear-fill mr-2 text-gray-400"></i>
                Configuración
              </button>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex border-b border-gray-200 mt-6 overflow-x-auto scrollbar-hide">
            <button
              onClick={() => setActiveTab('cards')}
              className={`py-4 px-1 border-b-2 font-medium text-sm mr-8 whitespace-nowrap ${activeTab === 'cards'
                ? 'border-gray-900 text-gray-900'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
            >
              Mis Tarjetas
              <span className="ml-2 bg-gray-100 text-gray-600 py-0.5 px-2 rounded-full text-xs">
                {cardsData.length}
              </span>
            </button>
            <button
              onClick={() => setActiveTab('locations')}
              className={`py-4 px-1 border-b-2 font-medium text-sm mr-8 whitespace-nowrap ${activeTab === 'locations'
                ? 'border-gray-900 text-gray-900'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
            >
              Ubicaciones
              <span className="ml-2 bg-gray-100 text-gray-600 py-0.5 px-2 rounded-full text-xs">
                {locations.length}
              </span>
            </button>
            <button
              onClick={() => setActiveTab('reviews')}
              className={`py-4 px-1 border-b-2 font-medium text-sm mr-8 whitespace-nowrap ${activeTab === 'reviews'
                ? 'border-gray-900 text-gray-900'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
            >
              Reseñas
            </button>
            <button
              onClick={() => setActiveTab('recommendations')}
              className={`py-4 px-1 border-b-2 font-medium text-sm mr-8 whitespace-nowrap ${activeTab === 'recommendations'
                ? 'border-gray-900 text-gray-900'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
            >
              Mis Recomendaciones
              <span className="ml-2 bg-gray-100 text-gray-600 py-0.5 px-2 rounded-full text-xs">
                {referrals.length}
              </span>
            </button>
            <button
              onClick={() => setActiveTab('info')}
              className={`py-4 px-1 border-b-2 font-medium text-sm whitespace-nowrap ${activeTab === 'info'
                ? 'border-gray-900 text-gray-900'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
            >
              Información
            </button>
          </div>
        </div>
      </div>

      {/* 2. TAB CONTENT */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 mt-6">

        {/* TARJETAS */}
        {activeTab === 'cards' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {cardsData.length > 0 ? (
              cardsData.map((card) => (
                <div key={card.businessId} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition-shadow">
                  <div className="h-24 bg-gray-50 relative">
                    {card.businessImage && (
                      <img src={card.businessImage} alt={card.businessName} className="w-full h-full object-cover opacity-50 blur-sm" />
                    )}
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="w-16 h-16 bg-white rounded-full shadow p-1">
                        <img
                          src={card.businessImage || '/placeholder.png'}
                          alt={card.businessName}
                          className="w-full h-full rounded-full object-cover"
                          onError={(e: any) => e.target.src = 'https://via.placeholder.com/150'}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="p-4 text-center">
                    <h3 className="font-bold text-gray-900 mb-1">{card.businessName}</h3>
                    <p className="text-xs text-gray-500 mb-4">
                      Última visita: {card.lastScanned ? new Date(card.lastScanned).toLocaleDateString() : 'Nunca'}
                    </p>


                    <p className="text-sm font-medium text-gray-700">
                      {card.scannedCount} tarjetas escaneadas
                    </p>

                    {/* Detalle de tarjetas escaneadas */}
                    {card.scannedQRs.length > 0 && (
                      <div className="mt-4 pt-4 border-t border-gray-50 flex flex-col gap-3">
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider text-left">Tus Beneficios</p>
                        {card.scannedQRs.map((qr) => (
                          <div key={qr.id} className="flex items-center gap-3 text-left bg-gray-50 rounded-lg p-2 transition-transform hover:scale-[1.02]">
                            <div className="w-10 h-10 rounded-md overflow-hidden bg-white shadow-sm flex-shrink-0">
                              <img
                                src={qr.image || card.businessImage || '/placeholder.png'}
                                alt={qr.name}
                                className="w-full h-full object-cover"
                                onError={(e: any) => e.target.src = 'https://via.placeholder.com/150'}
                              />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-bold text-gray-900 truncate">{qr.name}</p>
                              <p className="text-[10px] text-green-600 font-semibold truncate flex items-center gap-1">
                                <i className="bi bi-gift-fill text-[8px]"></i>
                                {qr.prize || 'Sin premio especificado'}
                              </p>
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRedeem(card, qr);
                              }}
                              disabled={redeemingQrId === qr.id || qr.status === 'redeemed'}
                              className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${qr.status === 'in_cart'
                                ? 'bg-orange-100 text-orange-600 border border-orange-200 shadow-none'
                                : qr.status === 'redeemed'
                                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed shadow-none'
                                  : redeemingQrId === qr.id
                                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                    : 'bg-green-600 text-white hover:bg-green-700 shadow-sm active:scale-95'
                                }`}
                            >
                              {redeemingQrId === qr.id ? (
                                <div className="animate-spin h-3 w-3 border-2 border-gray-400 border-t-transparent rounded-full mx-auto"></div>
                              ) : qr.status === 'in_cart' ? (
                                'En canje'
                              ) : qr.status === 'redeemed' ? (
                                'Canjeado'
                              ) : (
                                'Canjear'
                              )}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div className="col-span-full py-12 text-center bg-white rounded-xl border border-dashed border-gray-300">
                <i className="bi bi-qr-code text-4xl text-gray-300 mb-3 block"></i>
                <p className="text-gray-500">Aún no tienes tarjetas escaneadas.</p>
              </div>
            )}
          </div>
        )}

        {/* UBICACIONES */}
        {activeTab === 'locations' && (
          <div className="space-y-4">
            {locations.length > 0 ? (
              locations.map((loc) => (
                <div key={loc.id} className="bg-white p-4 rounded-xl border border-gray-100 flex items-start gap-4 shadow-sm">
                  <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center flex-shrink-0 text-red-500">
                    <i className="bi bi-geo-alt-fill"></i>
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">{loc.sector || 'Ubicación guardada'}</p>
                    <p className="text-sm text-gray-500 mt-1">{loc.referencia}</p>
                    {loc.tarifa && (
                      <span className="inline-block mt-2 text-xs font-medium bg-gray-100 text-gray-600 px-2 py-1 rounded">
                        Tarifa: ${Number(loc.tarifa).toFixed(2)}
                      </span>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div className="py-12 text-center bg-white rounded-xl border border-dashed border-gray-300">
                <i className="bi bi-geo text-4xl text-gray-300 mb-3 block"></i>
                <p className="text-gray-500">No tienes ubicaciones guardadas.</p>
                <p className="text-xs text-gray-400 mt-1">Se guardarán automáticamente cuando hagas un pedido.</p>
              </div>
            )}
          </div>
        )}

        {/* RESEÑAS */}
        {activeTab === 'reviews' && (
          <div className="py-12 text-center bg-white rounded-xl border border-dashed border-gray-300">
            <i className="bi bi-star text-4xl text-gray-300 mb-3 block"></i>
            <p className="text-gray-500">Aún no has escrito reseñas.</p>
          </div>
        )}

        {/* RECOMENDACIONES */}
        {activeTab === 'recommendations' && (
          <div className="space-y-6">
            {/* Dashboard de Impacto */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm text-center">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-500 flex items-center justify-center mx-auto mb-2">
                  <i className="bi bi-wallet2 text-sm"></i>
                </div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Créditos</p>
                <p className="text-xl font-black text-gray-900">${referralStats.totalCredits.toFixed(2)}</p>
              </div>
              <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm text-center">
                <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-500 flex items-center justify-center mx-auto mb-2">
                  <i className="bi bi-mouse2 text-sm"></i>
                </div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Clics</p>
                <p className="text-xl font-black text-gray-900">{referralStats.totalClicks}</p>
              </div>
              <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm text-center">
                <div className="w-8 h-8 rounded-lg bg-orange-50 text-orange-500 flex items-center justify-center mx-auto mb-2">
                  <i className="bi bi-bag-check text-sm"></i>
                </div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Ventas</p>
                <p className="text-xl font-black text-gray-900">{referralStats.totalSales}</p>
              </div>
            </div>

            {/* Listado de Productos Recomendados */}
            <div className="space-y-3">
              <h3 className="font-black text-gray-900 text-lg">Productos Recomendados</h3>
              {loadingReferrals ? (
                <div className="py-12 text-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto"></div>
                </div>
              ) : referrals.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {referrals.map((ref: any) => (
                    <div key={ref.id} className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center gap-4 hover:border-gray-900 transition-all group">
                      <div className="w-16 h-16 rounded-xl overflow-hidden bg-gray-100 flex-shrink-0 border border-gray-50">
                        {ref.productImage ? (
                          <img
                            src={ref.productImage}
                            alt={ref.productName}
                            className="w-full h-full object-cover"
                            onError={(e: any) => e.target.parentElement.innerHTML = '<div class="w-full h-full flex items-center justify-center text-gray-400"><i class="bi bi-box-seam text-xl"></i></div>'}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-gray-400">
                            <i className="bi bi-box-seam text-xl"></i>
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-black text-gray-900 text-sm truncate">{ref.productName}</h4>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider truncate mb-2">{ref.businessName}</p>
                        <div className="flex items-center gap-4">
                          <div className="flex items-center gap-1">
                            <i className="bi bi-mouse2 text-[10px] text-gray-300"></i>
                            <span className="text-[10px] font-bold text-gray-500">{ref.clicks || 0} clics</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <i className="bi bi-bag-check text-[10px] text-gray-300"></i>
                            <span className="text-[10px] font-bold text-gray-500">{ref.conversions || 0} ventas</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleCopyLink(ref)}
                          className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center text-gray-400 hover:bg-gray-900 hover:text-white transition-all shadow-sm"
                          title="Copiar link"
                        >
                          <i className={`bi ${copyingId === ref.id ? 'bi-check-lg text-emerald-500' : 'bi-link-45deg'} text-lg`}></i>
                        </button>
                        <button
                          onClick={() => handleShareWhatsApp(ref)}
                          className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-500 hover:bg-emerald-600 hover:text-white transition-all shadow-sm"
                          title="Compartir por WhatsApp"
                        >
                          <i className="bi bi-whatsapp text-sm"></i>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-12 text-center bg-white rounded-2xl border border-dashed border-gray-200">
                  <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4 text-gray-300">
                    <i className="bi bi-share text-2xl"></i>
                  </div>
                  <p className="text-gray-500 font-bold">Aún no has recomendado productos.</p>
                  <p className="text-xs text-gray-400 mt-1">Comparte tus productos favoritos y gana créditos.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* INFORMACIÓN (Editar Perfil) */}
        {activeTab === 'info' && (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm max-w-2xl mx-auto">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center">
              <h3 className="font-bold text-gray-900">Datos Personales</h3>
              {!isEditing && (
                <button
                  onClick={() => setIsEditing(true)}
                  className="text-gray-400 hover:text-gray-900 transition-colors"
                >
                  <i className="bi bi-pencil-square text-lg"></i>
                </button>
              )}
            </div>

            <div className="p-6 space-y-6">
              {message && (
                <div className={`p-4 rounded-lg text-sm ${message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                  {message.text}
                </div>
              )}

              <div className="grid gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Nombre Completo</label>
                  {isEditing ? (
                    <input
                      type="text"
                      name="nombres"
                      value={formData.nombres}
                      onChange={handleInputChange}
                      className="w-full rounded-lg border-gray-300 focus:ring-gray-900 focus:border-gray-900"
                    />
                  ) : (
                    <p className="text-gray-900 py-2 border-b border-gray-100">{user.nombres}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Celular</label>
                  {isEditing ? (
                    <input
                      type="tel"
                      name="celular"
                      value={formData.celular}
                      onChange={handleInputChange}
                      maxLength={10}
                      className="w-full rounded-lg border-gray-300 focus:ring-gray-900 focus:border-gray-900"
                    />
                  ) : (
                    <p className="text-gray-900 py-2 border-b border-gray-100">{user.celular}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Correo Electrónico</label>
                  {isEditing ? (
                    <input
                      type="email"
                      name="email"
                      value={formData.email}
                      onChange={handleInputChange}
                      className="w-full rounded-lg border-gray-300 focus:ring-gray-900 focus:border-gray-900"
                      placeholder="pcional"
                    />
                  ) : (
                    <p className="text-gray-900 py-2 border-b border-gray-100">{user.email || 'No registrado'}</p>
                  )}
                </div>
              </div>

              {isEditing && (
                <div className="flex gap-3 pt-4 justify-end">
                  <button
                    onClick={() => { setIsEditing(false); setMessage(null); }}
                    className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={loading}
                    className="px-6 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-70"
                  >
                    {loading ? 'Guardando...' : 'Guardar Cambios'}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

      </div>
      {/* CART SIDEBAR PARA CANJES */}
      {selectedBusiness && (
        <CartSidebar
          isOpen={isCartOpen}
          onClose={() => setIsCartOpen(false)}
          cart={selectedBusinessCart}
          business={selectedBusiness}
          removeFromCart={removeFromCart}
          updateQuantity={updateQuantity}
          addItemToCart={addItemToCart}
          onOpenUserSidebar={() => setIsUserSidebarOpen(true)}
        />
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
          setShowLoginModal(false)
          loadProfileData()
        }}
      />
    </div>
  )
}
