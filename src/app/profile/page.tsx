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
  storage
} from '@/lib/database'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { optimizeImage } from '@/lib/image-utils'
import { validateEcuadorianPhone, normalizeEcuadorianPhone } from '@/lib/validation'
import Link from 'next/link'
import { useRef } from 'react'

// Tipos auxiliares para la vista
interface EnrichedCard {
  businessName: string
  businessImage?: string
  businessId: string
  scannedCount: number
  totalCards: number
  lastScanned?: Date
}

export default function ProfilePage() {
  const { user, isAuthenticated, login } = useAuth()
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<'locations' | 'cards' | 'reviews' | 'info'>('cards')

  // DATA STATES
  const [locations, setLocations] = useState<any[]>([])
  const [cardsData, setCardsData] = useState<EnrichedCard[]>([])

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

  // INIT
  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/')
      return
    }

    if (user) {
      setFormData({
        nombres: user.nombres || '',
        celular: user.celular || '',
        email: user.email || ''
      })
      loadProfileData()
    }
  }, [user, isAuthenticated, router])

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

          return {
            businessName: business?.name || 'Negocio Desconocido',
            businessImage: business?.image,
            businessId: p.businessId,
            scannedCount: p.scannedCodes.length,
            totalCards: allCodes.length,
            lastScanned: p.lastScanned
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
      setUploadingAvatar(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  if (!isAuthenticated || !user) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900"></div>
      </div>
    )
  }

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

                    <div className="flex justify-center items-center gap-1 mb-2">
                      {/* Puntos visuales simples */}
                      {Array.from({ length: Math.min(card.totalCards || 5, 5) }).map((_, idx) => (
                        <div
                          key={idx}
                          className={`w-3 h-3 rounded-full ${idx < card.scannedCount ? 'bg-green-500' : 'bg-gray-200'}`}
                        />
                      ))}
                      {card.totalCards > 5 && <span className="text-xs text-gray-400 ml-1">+</span>}
                    </div>
                    <p className="text-sm font-medium text-gray-700">
                      {card.scannedCount} tarjetas escaneadas
                    </p>
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
    </div>
  )
}
