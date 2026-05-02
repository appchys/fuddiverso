'use client'

import { useState, useEffect, Suspense } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { onAuthStateChanged, User } from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { validateEcuadorianPhone } from '@/lib/validation'
import { createBusinessFromForm, uploadImage, updateBusiness, serverTimestamp, createDelivery } from '@/lib/database'
import { optimizeImage } from '@/lib/image-utils'

function BusinessRegisterForm() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [checkingAuth, setCheckingAuth] = useState(true)
  const [formData, setFormData] = useState({
    name: '',
    username: '',
    description: '',
    phone: '',
    category: '',
    businessType: 'food_store' as 'food_store' | 'distributor',
    deliveryServiceType: 'fuddi' as 'fuddi' | 'self',
    image: null as File | null,
    coverImage: null as File | null
  })

  const [errors, setErrors] = useState<Record<string, string>>({})
  const [dragActiveLogo, setDragActiveLogo] = useState(false)
  const [dragActiveCover, setDragActiveCover] = useState(false)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [coverPreview, setCoverPreview] = useState<string | null>(null)
  const [location, setLocation] = useState<string>('')


  // Verificar autenticación al cargar
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user)
      setCheckingAuth(false)

      if (!user) {
        // Si no hay usuario autenticado, redirigir al login
        router.push('/business/login?redirect=/business/register')
      }
    })

    return () => unsubscribe()
  }, [router])

  // Capturar ubicación al cargar
  useEffect(() => {
    if (typeof window !== 'undefined' && 'geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setLocation(`${position.coords.latitude}, ${position.coords.longitude}`)
        },
        (error) => {
          console.warn("Could not capture location automatically:", error)
        }
      )
    }
  }, [])


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!currentUser) {
      setErrors({ submit: 'Debes estar logueado para crear un negocio' })
      return
    }

    if (!validateForm()) {
      return
    }

    setLoading(true)

    try {
      let imageUrl = ''
      let coverImageUrl = ''

      // Subir logo si existe (comprimido)
      if (formData.image) {
        const optimizedLogo = await optimizeImage(formData.image, 500, 0.8) // Logo más pequeño
        const imagePath = `businesses/${Date.now()}_logo.webp`
        imageUrl = await uploadImage(optimizedLogo as any, imagePath)
      }

      // Subir portada si existe (comprimida)
      if (formData.coverImage) {
        const optimizedCover = await optimizeImage(formData.coverImage, 1200, 0.7) // Portada más grande pero comprimida
        const coverPath = `businesses/covers/${Date.now()}_cover.webp`
        coverImageUrl = await uploadImage(optimizedCover as any, coverPath)
      }

      // Crear negocio en Firebase con el UID del usuario
      const businessId = await createBusinessFromForm({
        name: formData.name,
        username: formData.username,
        email: currentUser.email || '', // Usar el email del usuario autenticado
        phone: formData.phone,
        description: formData.description,
        image: imageUrl,
        coverImage: coverImageUrl,
        category: formData.category,
        businessType: formData.businessType,
        ownerId: currentUser.uid,
        latlong: location,
        deliveryTime: 30
      })

      // Guardar tipo de servicio de delivery
      const deliveryUpdates: Record<string, any> = {
        deliveryServiceType: formData.deliveryServiceType,
        lastRegistrationAt: serverTimestamp(),
        lastLoginAt: serverTimestamp(),
        loginSource: 'business_portal'
      }

      // Si autogestión: crear repartidor predeterminado automáticamente
      if (formData.deliveryServiceType === 'self') {
        try {
          const selfDeliveryId = await createDelivery({
            nombres: `${formData.name} - Delivery`,
            celular: formData.phone,
            email: currentUser.email || '',
            estado: 'activo',
            fechaRegistro: new Date().toISOString(),
          })
          deliveryUpdates.defaultDeliveryId = selfDeliveryId
        } catch (deliveryErr) {
          console.error('Error creating self-delivery record:', deliveryErr)
          // No bloquear el registro si falla la creación del repartidor
        }
      }

      // Aplicar todas las actualizaciones del negocio
      try {
        await updateBusiness(businessId, deliveryUpdates)
      } catch (err) {
        console.error('Error updating business after creation:', err)
      }

      // Guardar información en localStorage para la sesión
      localStorage.setItem('businessId', businessId)
      localStorage.setItem('ownerId', currentUser.uid)

      // Limpiar el caché de acceso a negocios para que el dashboard fuerce un refresco
      localStorage.removeItem(`businessAccess:${currentUser.uid}`)

      // Redirigir al dashboard
      router.push('/business/dashboard')

    } catch (error: any) {
      console.error('Error registering business:', error)
      setErrors({ submit: 'Error al registrar el negocio. Intenta nuevamente.' })
    } finally {
      setLoading(false)
    }
  }

  const validateForm = () => {
    const newErrors: Record<string, string> = {}

    if (!formData.name.trim()) {
      newErrors.name = 'El nombre del negocio es requerido'
    }

    if (!formData.username.trim()) {
      newErrors.username = 'El nombre de usuario es requerido'
    } else if (!/^[a-zA-Z0-9_]+$/.test(formData.username)) {
      newErrors.username = 'Solo letras, números y guiones bajos'
    }

    if (!formData.description.trim()) {
      newErrors.description = 'La descripción es requerida'
    }

    if (!formData.phone.trim()) {
      newErrors.phone = 'El teléfono es requerido'
    } else if (!validateEcuadorianPhone(formData.phone)) {
      newErrors.phone = 'Formato inválido (Ej: 09XXXXXXXX)'
    }

    if (!formData.category.trim()) {
      newErrors.category = 'La categoría es requerida'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: value
    }))

    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: '' }))
    }
  }

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setFormData(prev => ({ ...prev, image: file }))
      setImagePreview(URL.createObjectURL(file))
    }
  }

  const handleCoverChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setFormData(prev => ({ ...prev, coverImage: file }))
      setCoverPreview(URL.createObjectURL(file))
    }
  }

  const handleDragLogo = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === "dragenter" || e.type === "dragover") setDragActiveLogo(true)
    else if (e.type === "dragleave") setDragActiveLogo(false)
  }

  const handleDropLogo = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActiveLogo(false)
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0]
      setFormData(prev => ({ ...prev, image: file }))
      setImagePreview(URL.createObjectURL(file))
    }
  }

  const handleDragCover = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === "dragenter" || e.type === "dragover") setDragActiveCover(true)
    else if (e.type === "dragleave") setDragActiveCover(false)
  }

  const handleDropCover = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActiveCover(false)
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0]
      setFormData(prev => ({ ...prev, coverImage: file }))
      setCoverPreview(URL.createObjectURL(file))
    }
  }

  if (checkingAuth) {
    return (
      <div className="min-h-screen bg-[#FDFDFD] flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-red-50 border-t-red-600 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-400 font-bold uppercase tracking-widest text-[10px]">Cargando...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#F8F9FA] relative flex items-center justify-center py-12 px-4 overflow-hidden">
      {/* Círculos decorativos de fondo */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] aspect-square bg-red-100/30 rounded-full blur-[120px]"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] aspect-square bg-orange-100/30 rounded-full blur-[120px]"></div>

      <div className="w-full max-w-2xl relative z-10">
        <div className="bg-white/80 backdrop-blur-2xl rounded-[3rem] shadow-[0_32px_80px_rgba(0,0,0,0.08)] border border-white/50 overflow-hidden">

          <div className="p-8 sm:p-12">
            <header className="text-center mb-10">
              <div className="inline-flex items-center justify-center w-20 h-20 bg-red-600 rounded-3xl shadow-xl shadow-red-200 mb-6 transform -rotate-6">
                <i className="bi bi-shop text-white text-4xl"></i>
              </div>
              <h1 className="text-4xl font-black text-gray-900 tracking-tight leading-none mb-4">
                Lanza tu tienda
              </h1>
              <p className="text-gray-500 font-medium">Estás a pocos pasos de digitalizar tu negocio</p>
            </header>

            {currentUser && (
              <div className="mb-10 p-5 bg-emerald-50/50 border border-emerald-100 rounded-[2rem] flex items-center gap-4">
                <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center shadow-sm text-emerald-500">
                  <i className="bi bi-person-check-fill text-xl"></i>
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-emerald-600/60 leading-none mb-1">Sesión activa</p>
                  <p className="text-gray-900 font-bold leading-tight">{currentUser.email}</p>
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-8">
              {/* Sección: Identidad */}
              <div className="space-y-6">
                <div className="flex items-center gap-3 mb-2">
                  <span className="w-8 h-8 rounded-full bg-gray-900 text-white flex items-center justify-center text-xs font-black">1</span>
                  <h3 className="font-black text-gray-900 uppercase tracking-widest text-xs">Identidad del Negocio</h3>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  {/* Nombre */}
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">Nombre Comercial</label>
                    <input
                      type="text"
                      name="name"
                      value={formData.name}
                      onChange={handleChange}
                      className={`w-full px-5 py-4 bg-gray-50 border-2 rounded-2xl focus:bg-white focus:ring-4 focus:ring-red-500/5 transition-all duration-300 font-bold text-gray-900 placeholder:text-gray-300 ${errors.name ? 'border-red-200' : 'border-transparent focus:border-red-500'}`}
                      placeholder="Pizzería Don Mario"
                    />
                    {errors.name && <p className="text-red-500 text-[10px] font-bold ml-1">{errors.name}</p>}
                  </div>

                  {/* Username */}
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">ID Único (URL)</label>
                    <div className="relative group">
                      <span className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-400 font-bold">@</span>
                      <input
                        type="text"
                        name="username"
                        value={formData.username}
                        onChange={handleChange}
                        className={`w-full pl-10 pr-5 py-4 bg-gray-50 border-2 rounded-2xl focus:bg-white focus:ring-4 focus:ring-red-500/5 transition-all duration-300 font-bold text-gray-900 placeholder:text-gray-300 ${errors.username ? 'border-red-200' : 'border-transparent focus:border-red-500'}`}
                        placeholder="username"
                      />
                    </div>
                    <p className="text-gray-400 text-[9px] font-bold ml-1">fuddi.shop/@{formData.username || '...'}</p>
                    {errors.username && <p className="text-red-500 text-[10px] font-bold ml-1">{errors.username}</p>}
                  </div>
                </div>

                {/* Tipo de Negocio */}
                <div className="space-y-4">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">Tipo de Negocio</label>
                  <div className="grid grid-cols-2 gap-4">
                    <button
                      type="button"
                      onClick={() => setFormData(prev => ({ ...prev, businessType: 'food_store', category: '' }))}
                      className={`p-4 rounded-2xl border-2 transition-all duration-300 flex flex-col items-center gap-2 ${formData.businessType === 'food_store'
                        ? 'border-red-500 bg-red-50 shadow-md ring-1 ring-red-50'
                        : 'border-gray-100 bg-gray-50/50 hover:border-gray-200'
                        }`}
                    >
                      <i className={`bi bi-shop text-2xl ${formData.businessType === 'food_store' ? 'text-red-500' : 'text-gray-400'}`}></i>
                      <span className={`text-[10px] font-black uppercase tracking-widest ${formData.businessType === 'food_store' ? 'text-red-600' : 'text-gray-500'}`}>Comida Preparada</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setFormData(prev => ({ ...prev, businessType: 'distributor', category: '' }))}
                      className={`p-4 rounded-2xl border-2 transition-all duration-300 flex flex-col items-center gap-2 ${formData.businessType === 'distributor'
                        ? 'border-red-500 bg-red-50 shadow-md ring-1 ring-red-50'
                        : 'border-gray-100 bg-gray-50/50 hover:border-gray-200'
                        }`}
                    >
                      <i className={`bi bi-box-seam text-2xl ${formData.businessType === 'distributor' ? 'text-red-500' : 'text-gray-400'}`}></i>
                      <span className={`text-[10px] font-black uppercase tracking-widest ${formData.businessType === 'distributor' ? 'text-red-600' : 'text-gray-500'}`}>Proveedor</span>
                    </button>
                  </div>
                </div>

                {/* Categoría Dinámica */}
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">
                    {formData.businessType === 'food_store' ? 'Especialidad Gastronómica' : 'Rubro de Suministros'}
                  </label>
                  <div className="relative">
                    <select
                      name="category"
                      value={formData.category}
                      onChange={handleChange}
                      className={`w-full px-5 py-4 bg-gray-50 border-2 rounded-2xl focus:bg-white focus:ring-4 focus:ring-red-500/5 transition-all duration-300 font-bold text-gray-900 appearance-none ${errors.category ? 'border-red-200' : 'border-transparent focus:border-red-500'}`}
                    >
                      <option value="">Selecciona una opción</option>
                      {formData.businessType === 'food_store' ? (
                        <>
                          <option value="Comida Rápida">🍔 Comida Rápida</option>
                          <option value="Pizza">🍕 Pizza</option>
                          <option value="Postres">🧁 Postres y Dulces</option>
                          <option value="Bebidas">🍹 Bebidas y Jugos</option>
                          <option value="Saludable">🥗 Saludable</option>
                          <option value="Cafetería">☕ Cafetería</option>
                          <option value="Mariscos">🍤 Mariscos</option>
                          <option value="Parrilla">🥩 Parrilla y Asados</option>
                        </>
                      ) : (
                        <>
                          <option value="Alimentos">🍎 Alimentos y Materia Prima</option>
                          <option value="Plásticos">🥤 Materiales Plásticos / Empaques</option>
                          <option value="Limpieza">🧹 Productos de Limpieza</option>
                          <option value="Equipamiento">🧑‍🍳 Equipamiento de Cocina</option>
                        </>
                      )}
                      <option value="Otro">✨ Otro</option>
                    </select>
                    <div className="absolute right-5 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
                      <i className="bi bi-chevron-down"></i>
                    </div>
                  </div>
                  {errors.category && <p className="text-red-500 text-[10px] font-bold ml-1">{errors.category}</p>}
                </div>

                {/* Descripción */}
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">Eslogan o Resumen</label>
                  <textarea
                    name="description"
                    value={formData.description}
                    onChange={handleChange}
                    rows={2}
                    className={`w-full px-5 py-4 bg-gray-50 border-2 rounded-2xl focus:bg-white focus:ring-4 focus:ring-red-500/5 transition-all duration-300 font-bold text-gray-900 placeholder:text-gray-300 resize-none ${errors.description ? 'border-red-200' : 'border-transparent focus:border-red-500'}`}
                    placeholder="Cuéntanos qué hace especial a tu negocio..."
                  />
                  {errors.description && <p className="text-red-500 text-[10px] font-bold ml-1">{errors.description}</p>}
                </div>
              </div>

              {/* Sección: Delivery */}
              <div className="space-y-4">
                <div className="flex items-center gap-3 mb-2">
                  <span className="w-8 h-8 rounded-full bg-gray-900 text-white flex items-center justify-center text-xs font-black">3</span>
                  <h3 className="font-black text-gray-900 uppercase tracking-widest text-xs">Servicio de Delivery</h3>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Autogestión */}
                  <button
                    type="button"
                    onClick={() => setFormData(prev => ({ ...prev, deliveryServiceType: 'self' }))}
                    className={`relative flex flex-col gap-3 p-5 rounded-2xl border-2 text-left transition-all duration-300 ${
                      formData.deliveryServiceType === 'self'
                        ? 'border-orange-500 bg-orange-50 shadow-md ring-1 ring-orange-50'
                        : 'border-gray-100 bg-gray-50/50 hover:border-gray-200'
                    }`}
                  >
                    {formData.deliveryServiceType === 'self' && (
                      <span className="absolute top-3 right-3 w-5 h-5 rounded-full bg-orange-500 flex items-center justify-center">
                        <i className="bi bi-check text-white text-xs" />
                      </span>
                    )}
                    <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${
                      formData.deliveryServiceType === 'self' ? 'bg-orange-100' : 'bg-white shadow-sm'
                    }`}>
                      <i className={`bi bi-person-badge text-xl ${
                        formData.deliveryServiceType === 'self' ? 'text-orange-600' : 'text-gray-400'
                      }`} />
                    </div>
                    <div>
                      <p className={`font-black text-xs uppercase tracking-widest ${
                        formData.deliveryServiceType === 'self' ? 'text-orange-700' : 'text-gray-600'
                      }`}>Autogestión</p>
                      <p className="text-gray-400 text-[9px] font-bold mt-1 leading-relaxed">Mi tienda gestiona sus propias entregas con repartidor propio.</p>
                    </div>
                  </button>

                  {/* Delivery Fuddi */}
                  <button
                    type="button"
                    onClick={() => setFormData(prev => ({ ...prev, deliveryServiceType: 'fuddi' }))}
                    className={`relative flex flex-col gap-3 p-5 rounded-2xl border-2 text-left transition-all duration-300 ${
                      formData.deliveryServiceType === 'fuddi'
                        ? 'border-red-500 bg-red-50 shadow-md ring-1 ring-red-50'
                        : 'border-gray-100 bg-gray-50/50 hover:border-gray-200'
                    }`}
                  >
                    {formData.deliveryServiceType === 'fuddi' && (
                      <span className="absolute top-3 right-3 w-5 h-5 rounded-full bg-red-500 flex items-center justify-center">
                        <i className="bi bi-check text-white text-xs" />
                      </span>
                    )}
                    <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${
                      formData.deliveryServiceType === 'fuddi' ? 'bg-red-100' : 'bg-white shadow-sm'
                    }`}>
                      <i className={`bi bi-scooter text-xl ${
                        formData.deliveryServiceType === 'fuddi' ? 'text-red-600' : 'text-gray-400'
                      }`} />
                    </div>
                    <div>
                      <p className={`font-black text-xs uppercase tracking-widest ${
                        formData.deliveryServiceType === 'fuddi' ? 'text-red-700' : 'text-gray-600'
                      }`}>Delivery Fuddi</p>
                      <p className="text-gray-400 text-[9px] font-bold mt-1 leading-relaxed">Fuddi busca y asigna un repartidor según la zona del cliente.</p>
                    </div>
                  </button>
                </div>

                {/* Note for self mode */}
                {formData.deliveryServiceType === 'self' && (
                  <div className="flex items-start gap-3 p-4 bg-orange-50/80 border border-orange-100 rounded-2xl">
                    <i className="bi bi-info-circle-fill text-orange-400 mt-0.5 flex-shrink-0" />
                    <p className="text-[10px] font-bold text-orange-700 leading-relaxed">
                      Se creará automáticamente un repartidor con el nombre <strong>"{formData.name || 'Tu tienda'} - Delivery"</strong> y el número <strong>{formData.phone || '09XXXXXXXX'}</strong>. Podrás editarlo desde el panel admin.
                    </p>
                  </div>
                )}
              </div>

              {/* Sección: Contacto */}
              <div className="space-y-6">
                <div className="flex items-center gap-3 mb-2">
                  <span className="w-8 h-8 rounded-full bg-gray-900 text-white flex items-center justify-center text-xs font-black">4</span>
                  <h3 className="font-black text-gray-900 uppercase tracking-widest text-xs">Contacto</h3>
                </div>

                {/* Teléfono */}
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">WhatsApp de Pedidos</label>
                  <input
                    type="tel"
                    name="phone"
                    value={formData.phone}
                    onChange={handleChange}
                    className={`w-full px-5 py-4 bg-gray-50 border-2 rounded-2xl focus:bg-white focus:ring-4 focus:ring-red-500/5 transition-all duration-300 font-bold text-gray-900 placeholder:text-gray-300 ${errors.phone ? 'border-red-200' : 'border-transparent focus:border-red-500'}`}
                    placeholder="09XXXXXXXX"
                  />
                  {errors.phone && <p className="text-red-500 text-[10px] font-bold ml-1">{errors.phone}</p>}
                </div>
              </div>

              {/* Sección: Identidad Visual */}
              <div className="space-y-6">
                <div className="flex items-center gap-3 mb-2">
                  <span className="w-8 h-8 rounded-full bg-gray-900 text-white flex items-center justify-center text-xs font-black">5</span>
                  <h3 className="font-black text-gray-900 uppercase tracking-widest text-xs">Identidad Visual</h3>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  {/* Logo */}
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">Logo del negocio</label>
                    <div
                      onDragEnter={handleDragLogo}
                      onDragOver={handleDragLogo}
                      onDragLeave={handleDragLogo}
                      onDrop={handleDropLogo}
                      className={`relative flex flex-col items-center justify-center p-6 rounded-[2.5rem] border-2 border-dashed transition-all duration-300 aspect-square ${dragActiveLogo ? 'border-red-500 bg-red-50' : 'border-gray-100 bg-gray-50/50'}`}
                    >
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleImageChange}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                      />

                      {imagePreview ? (
                        <div className="relative w-full h-full rounded-3xl overflow-hidden shadow-xl">
                          <img src={imagePreview} className="w-full h-full object-cover" alt="Logo Preview" />
                          <div className="absolute inset-0 bg-black/20 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                            <i className="bi bi-pencil-square text-white text-2xl"></i>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="w-12 h-12 bg-white rounded-2xl shadow-sm flex items-center justify-center text-gray-400 mb-2">
                            <i className="bi bi-image text-xl"></i>
                          </div>
                          <p className="text-gray-900 font-black text-xs">Logo</p>
                          <p className="text-gray-400 text-[8px] font-bold uppercase tracking-widest mt-1 text-center">Cuadrado recomendado</p>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Portada */}
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">Imagen de Portada</label>
                    <div
                      onDragEnter={handleDragCover}
                      onDragOver={handleDragCover}
                      onDragLeave={handleDragCover}
                      onDrop={handleDropCover}
                      className={`relative flex flex-col items-center justify-center p-6 rounded-[2.5rem] border-2 border-dashed transition-all duration-300 aspect-square ${dragActiveCover ? 'border-red-500 bg-red-50' : 'border-gray-100 bg-gray-50/50'}`}
                    >
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleCoverChange}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                      />

                      {coverPreview ? (
                        <div className="relative w-full h-full rounded-3xl overflow-hidden shadow-xl">
                          <img src={coverPreview} className="w-full h-full object-cover" alt="Cover Preview" />
                          <div className="absolute inset-0 bg-black/20 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                            <i className="bi bi-pencil-square text-white text-2xl"></i>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="w-12 h-12 bg-white rounded-2xl shadow-sm flex items-center justify-center text-gray-400 mb-2">
                            <i className="bi bi-aspect-ratio text-xl"></i>
                          </div>
                          <p className="text-gray-900 font-black text-xs">Portada</p>
                          <p className="text-gray-400 text-[8px] font-bold uppercase tracking-widest mt-1 text-center">Horizontal recomendado</p>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {errors.submit && (
                <div className="p-5 bg-red-50 border border-red-100 rounded-[2rem] flex items-center gap-4 text-red-600">
                  <i className="bi bi-exclamation-circle-fill text-xl"></i>
                  <p className="font-bold text-sm tracking-tight">{errors.submit}</p>
                </div>
              )}

              <div className="pt-4 flex flex-col sm:flex-row items-center gap-6">
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 w-full bg-red-600 hover:bg-black text-white font-black py-5 px-8 rounded-[2rem] shadow-2xl shadow-red-200 transition-all duration-500 transform hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed group overflow-hidden relative"
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000"></div>
                  {loading ? (
                    <>
                      <div className="w-5 h-5 border-3 border-white/20 border-t-white rounded-full animate-spin"></div>
                      <span className="uppercase tracking-widest text-xs">Creando tu espacio...</span>
                    </>
                  ) : (
                    <>
                      <i className="bi bi-rocket-takeoff text-xl"></i>
                      <span className="uppercase tracking-widest text-xs">Comenzar Ahora</span>
                    </>
                  )}
                </button>

                <Link
                  href="/business/dashboard"
                  className="px-8 py-5 text-gray-400 hover:text-gray-900 font-black uppercase tracking-widest text-[10px] transition-colors"
                >
                  Volver
                </Link>
              </div>
            </form>
          </div>
        </div>

        <p className="text-center mt-12 text-gray-400 text-[10px] font-black uppercase tracking-widest">
          &copy; {new Date().getFullYear()} Fuddiverso &bull; Panel de Negocios
        </p>
      </div>
    </div>
  )
}

export default function BusinessRegister() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#FDFDFD] flex items-center justify-center">
        <div className="w-16 h-16 border-4 border-red-50 border-t-red-600 rounded-full animate-spin"></div>
      </div>
    }>
      <BusinessRegisterForm />
    </Suspense>
  )
}
