'use client'

import { useState, useEffect, Suspense, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { 
  onAuthStateChanged, 
  User, 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  signOut 
} from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { validateEcuadorianPhone, normalizeEcuadorianPhone } from '@/lib/validation'
import { 
  createBusinessFromForm, 
  uploadImage, 
  updateBusiness, 
  serverTimestamp, 
  createDelivery, 
  signInWithGoogle 
} from '@/lib/database'
import { optimizeImage } from '@/lib/image-utils'
import { useBusinessAuth } from '@/contexts/BusinessAuthContext'

// Helper to slugify commercial name for unique username ID
const slugify = (text: string) => {
  return text
    .toString()
    .toLowerCase()
    .normalize('NFD') // Normalize accents
    .replace(/[\u0300-\u036f]/g, '') // Remove accent markings
    .replace(/[^a-z0-9]/g, '') // Remove non-alphanumeric (no underscores)
}

function BusinessRegisterForm() {
  const router = useRouter()
  const { login: authLogin } = useBusinessAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [currentStep, setCurrentStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [checkingAuth, setCheckingAuth] = useState(true)
  
  // Form state
  const [formData, setFormData] = useState({
    name: '',
    username: '',
    description: '',
    phone: '',
    category: 'Otro',
    businessType: 'food_store' as 'food_store' | 'distributor',
    deliveryServiceType: 'fuddi' as 'fuddi' | 'self',
    image: null as File | null,
    coverImage: null as File | null
  })

  // Track if username has been manually touched
  const [isUsernameEdited, setIsUsernameEdited] = useState(false)
  
  // Custom Email auth credentials inside wizard
  const [emailInput, setEmailInput] = useState('')
  const [passwordInput, setPasswordInput] = useState('')
  const [passwordConfirmInput, setPasswordConfirmInput] = useState('')
  const isEmailSignup = true
  const [justAuthenticated, setJustAuthenticated] = useState(false)
  
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [imagePosition, setImagePosition] = useState('center 50%')
  const [dragActiveLogo, setDragActiveLogo] = useState(false)
  const [dragActiveCover, setDragActiveCover] = useState(false)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [coverPreview, setCoverPreview] = useState<string | null>(null)
  const [location, setLocation] = useState<string>('')

  // Check auth state on load
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user)
      setCheckingAuth(false)
    })
    return () => unsubscribe()
  }, [])

  // Auto-submit and create business if the user just registered/logged in on Step 3
  useEffect(() => {
    if (currentUser && currentStep === 3 && justAuthenticated) {
      handleSubmit()
    }
  }, [currentUser, currentStep, justAuthenticated])

  // Capture location on load
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

  // Slugify username when name commercial updates (if not edited manually)
  useEffect(() => {
    if (!isUsernameEdited && formData.name) {
      setFormData(prev => ({
        ...prev,
        username: slugify(formData.name)
      }))
      // Clear username error if any
      if (errors.username) {
        setErrors(prev => ({ ...prev, username: '' }))
      }
    }
  }, [formData.name, isUsernameEdited])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    
    if (name === 'username') {
      setIsUsernameEdited(true)
      // Allow only alphanumeric and underscore
      const sanitizedValue = value.replace(/[^a-zA-Z0-9_]/g, '')
      setFormData(prev => ({ ...prev, username: sanitizedValue }))
    } else {
      setFormData(prev => ({ ...prev, [name]: value }))
    }

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

  // Step Validation Helpers
  const validateStep = (step: number) => {
    const newErrors: Record<string, string> = {}
    
    if (step === 1) {
      if (!formData.name.trim()) {
        newErrors.name = 'El nombre comercial es requerido'
      }
      if (!formData.username.trim()) {
        newErrors.username = 'El nombre de usuario es requerido'
      } else if (!/^[a-zA-Z0-9_]+$/.test(formData.username)) {
        newErrors.username = 'Solo letras, números y guiones bajos'
      }
    }
    
    if (step === 2) {
      const normalizedPhone = normalizeEcuadorianPhone(formData.phone)
      if (!formData.phone.trim()) {
        newErrors.phone = 'El WhatsApp es requerido'
      } else if (!validateEcuadorianPhone(normalizedPhone)) {
        newErrors.phone = 'Formato inválido (Ej: 09XXXXXXXX o +593...)'
      }
      if (!formData.description.trim()) {
        newErrors.description = 'La descripción es requerida'
      }
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleNextStep = () => {
    if (validateStep(currentStep)) {
      setCurrentStep(prev => prev + 1)
    }
  }

  const handlePrevStep = () => {
    setCurrentStep(prev => prev - 1)
  }

  // Custom Local Auth Action (inside step 3)
  const handleLocalAuth = async (e?: React.SyntheticEvent) => {
    if (e) e.preventDefault()
    setErrors({})
    setLoading(true)

    if (!emailInput.trim() || !passwordInput) {
      setErrors({ auth: 'Todos los campos son obligatorios' })
      setLoading(false)
      return
    }

    if (passwordInput !== passwordConfirmInput) {
      setErrors({ auth: 'Las contraseñas no coinciden' })
      setLoading(false)
      return
    }
    if (passwordInput.length < 6) {
      setErrors({ auth: 'La contraseña debe tener al menos 6 caracteres' })
      setLoading(false)
      return
    }

    try {
      setJustAuthenticated(true)
      await createUserWithEmailAndPassword(auth, emailInput.trim(), passwordInput)
    } catch (err: any) {
      setJustAuthenticated(false)
      console.error('Error in signup:', err)
      let msg = 'Error al crear la cuenta.'
      if (err.code === 'auth/email-already-in-use') msg = 'Este correo ya está registrado.'
      if (err.code === 'auth/invalid-email') msg = 'Correo electrónico inválido.'
      setErrors({ auth: msg })
    } finally {
      setLoading(false)
    }
  }

  const handleGoogleAuth = async () => {
    setErrors({})
    setLoading(true)
    try {
      setJustAuthenticated(true)
      await signInWithGoogle()
    } catch (err: any) {
      setJustAuthenticated(false)
      console.error('Google Sign In Error:', err)
      setErrors({ auth: err.message || 'Error al conectar con Google' })
    } finally {
      setLoading(false)
    }
  }

  const handleSignOut = async () => {
    try {
      await signOut(auth)
    } catch (err) {
      console.error('Sign Out Error:', err)
    }
  }

  // Final submit handler (Step 4)
  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()

    if (!currentUser) {
      setCurrentStep(3)
      setErrors({ submit: 'Debes estar logueado para crear tu negocio' })
      return
    }

    setLoading(true)
    setErrors({})

    try {
      let imageUrl = ''
      let coverImageUrl = ''

      // Subir logo si existe (comprimido)
      if (formData.image) {
        const optimizedLogo = await optimizeImage(formData.image, 500, 0.8)
        const imagePath = `businesses/${Date.now()}_logo.webp`
        imageUrl = await uploadImage(optimizedLogo as any, imagePath)
      }

      // Subir portada si existe (comprimida)
      if (formData.coverImage) {
        const optimizedCover = await optimizeImage(formData.coverImage, 1200, 0.7)
        const coverPath = `businesses/covers/${Date.now()}_cover.webp`
        coverImageUrl = await uploadImage(optimizedCover as any, coverPath)
      }

      // Crear negocio en Firebase con el UID del usuario
      const businessId = await createBusinessFromForm({
        name: formData.name,
        username: formData.username,
        email: currentUser.email || '',
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
      localStorage.removeItem(`businessAccess:${currentUser.uid}`)

      // Actualizar el contexto de autenticación de negocio para sincronizar el estado reactivo inmediatamente
      authLogin({
        uid: currentUser.uid,
        email: currentUser.email,
        displayName: currentUser.displayName,
        photoURL: currentUser.photoURL
      }, businessId, currentUser.uid)

      // Redirigir al dashboard
      router.push('/business/dashboard')

    } catch (error: any) {
      console.error('Error registering business:', error)
      setErrors({ submit: 'Error al registrar el negocio. Intenta nuevamente.' })
    } finally {
      setLoading(false)
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
    <div className="min-h-screen bg-[#F8F9FA] relative flex items-center justify-center py-8 px-4 sm:px-6 overflow-hidden">
      {/* Decorative Circles */}
      <div className="absolute top-[-10%] left-[-10%] w-[50%] aspect-square bg-red-100/30 rounded-full blur-[120px] pointer-events-none"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] aspect-square bg-orange-100/30 rounded-full blur-[120px] pointer-events-none"></div>

      <div className="w-full max-w-lg relative z-10">
        <div className="bg-white/80 backdrop-blur-2xl rounded-[2.5rem] shadow-[0_24px_64px_rgba(0,0,0,0.06)] border border-white/60 overflow-hidden">
          <div className="p-6 sm:p-10">
            {/* Header */}
            <header className="text-center mb-8">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-tr from-[#aa1918] to-orange-500 rounded-2xl shadow-lg shadow-red-200 mb-4 transform -rotate-3">
                <i className="bi bi-shop text-white text-3xl"></i>
              </div>
              <h1 className="text-3xl font-black text-gray-900 tracking-tight mb-2">
                Digitaliza tu menú
              </h1>
              <p className="text-gray-400 text-xs font-semibold">Crea tu tienda en línea en 3 sencillos pasos</p>
            </header>

            {/* Stepper Progress Indicator */}
            <div className="mb-8">
              <div className="flex justify-between items-center text-[10px] font-black text-gray-400 uppercase tracking-wider mb-2">
                <span>Paso {currentStep} de 3</span>
                <span className="text-[#aa1918] font-bold">
                  {currentStep === 1 && 'Tu Negocio'}
                  {currentStep === 2 && 'Contacto y Descripción'}
                  {currentStep === 3 && 'Cuenta de Acceso'}
                </span>
              </div>
              <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-[#aa1918] to-orange-500 transition-all duration-500 ease-out"
                  style={{ width: `${(currentStep / 3) * 100}%` }}
                />
              </div>
            </div>

            {/* STEP 1: Datos de tu negocio */}
            {currentStep === 1 && (
              <div className="space-y-5 animate-in fade-in slide-in-from-right-4 duration-300">
                <h3 className="font-black text-gray-800 uppercase tracking-widest text-xs mb-4 flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-[#aa1918] text-white text-[10px] flex items-center justify-center font-bold">1</span>
                  Datos del Negocio
                </h3>

                <div className="space-y-4">
                  {/* Commercial Name */}
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest ml-1">Nombre Comercial</label>
                    <input
                      type="text"
                      name="name"
                      value={formData.name}
                      onChange={handleChange}
                      className={`w-full px-4 py-3 bg-gray-50/80 border-2 rounded-2xl focus:bg-white focus:ring-4 focus:ring-red-500/5 transition-all duration-300 font-bold text-sm text-gray-900 placeholder:text-gray-300 ${errors.name ? 'border-red-200' : 'border-transparent focus:border-[#aa1918]'}`}
                      placeholder="Ej: Pizzería Don Mario"
                      required
                    />
                    {errors.name && <p className="text-red-500 text-[10px] font-bold ml-1">{errors.name}</p>}
                  </div>

                  {/* Unique Username Slug */}
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest ml-1">ID Único (URL de tu menú)</label>
                    <div className="relative group">
                      <input
                        type="text"
                        name="username"
                        value={formData.username}
                        onChange={handleChange}
                        className={`w-full px-4 py-3 bg-gray-50/80 border-2 rounded-2xl focus:bg-white focus:ring-4 focus:ring-red-500/5 transition-all duration-300 font-bold text-sm text-gray-900 placeholder:text-gray-300 ${errors.username ? 'border-red-200' : 'border-transparent focus:border-[#aa1918]'}`}
                        placeholder="ejpizzeriadonmario"
                        required
                      />
                    </div>
                    <p className="text-gray-400 text-[9px] font-bold ml-1">Tu enlace será: <span className="text-[#aa1918]">fuddi.shop/{formData.username || '...'}</span></p>
                    {errors.username && <p className="text-red-500 text-[10px] font-bold ml-1">{errors.username}</p>}
                  </div>
                </div>

                <div className="pt-4">
                  <button
                    type="button"
                    onClick={handleNextStep}
                    disabled={!formData.name.trim() || !formData.username.trim()}
                    className="w-full bg-[#aa1918] hover:bg-black text-white font-black py-4 px-6 rounded-2xl shadow-lg shadow-red-900/10 active:scale-95 transition-all duration-300 flex items-center justify-center gap-2 group disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <span>Siguiente</span>
                    <i className="bi bi-arrow-right text-sm group-hover:translate-x-0.5 transition-transform"></i>
                  </button>
                </div>
              </div>
            )}

            {/* STEP 2: Especialidad y WhatsApp */}
            {currentStep === 2 && (
              <div className="space-y-5 animate-in fade-in slide-in-from-right-4 duration-300">
                <h3 className="font-black text-gray-800 uppercase tracking-widest text-xs mb-4 flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-[#aa1918] text-white text-[10px] flex items-center justify-center font-bold">2</span>
                  Detalles del Menú
                </h3>

                <div className="space-y-4">
                  {/* Imagen de Perfil y Nombre del negocio en layout horizontal */}
                  <div className="flex items-center gap-4 bg-gray-50/50 p-4 rounded-3xl border border-gray-100/80">
                    {/* Contenedor del Logo + Slider */}
                    <div className="flex flex-col items-center flex-shrink-0 gap-2">
                      {/* Cuadrito Gris (Perfil / Logo) */}
                      <div 
                        className="relative w-20 h-20 bg-gray-200 hover:bg-gray-300/80 border-2 border-dashed border-gray-300 text-gray-500 rounded-full flex items-center justify-center cursor-pointer overflow-hidden transition-all duration-300"
                        onClick={() => fileInputRef.current?.click()}
                        title="Subir imagen de perfil o logo (Opcional)"
                      >
                        <input
                          type="file"
                          id="profile-image-input"
                          accept="image/*"
                          onChange={handleImageChange}
                          className="hidden"
                          ref={fileInputRef}
                        />
                        {imagePreview ? (
                          <img 
                            src={imagePreview} 
                            className="w-full h-full object-cover" 
                            alt="Logo Preview" 
                            style={{ objectPosition: imagePosition }}
                          />
                        ) : (
                          <div className="flex flex-col items-center justify-center gap-1 p-1 text-center">
                            {/* Hamburger Icon in Darker Gray SVG */}
                            <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" className="text-gray-500 mx-auto">
                              {/* Top bun */}
                              <path d="M2 12c0-5 4-9 10-9s10 4 10 9" />
                              <path d="M2 12h20" />
                              {/* Cheese / Salad waves */}
                              <path d="M4 15h16" />
                              {/* Patty */}
                              <rect x="3" y="17" width="18" height="2" rx="1" fill="currentColor" className="text-gray-700" />
                              {/* Bottom bun */}
                              <path d="M2 19a3 3 0 0 0 3 3h14a3 3 0 0 0 3-3" />
                            </svg>
                            <span className="text-[8px] font-black text-gray-400 uppercase tracking-widest leading-none mt-1">subir logo</span>
                          </div>
                        )}
                      </div>

                      {/* Control de encuadre (slider) debajo del círculo del logo */}
                      {imagePreview && (
                        <div className="w-20 space-y-1">
                          <input
                            type="range"
                            min="0"
                            max="100"
                            value={parseInt(imagePosition.split(' ')[1] || '50', 10)}
                            onChange={(e) => {
                              const val = e.target.value;
                              setImagePosition(`center ${val}%`);
                            }}
                            className="w-full accent-red-600 h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                            title="Ajustar posición"
                          />
                        </div>
                      )}
                    </div>

                    {/* Nombre del negocio */}
                    <div className="min-w-0 flex-1">
                      <h4 className="text-lg font-black text-gray-900 truncate leading-tight">{formData.name}</h4>
                    </div>
                  </div>

                  {/* WhatsApp */}
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest ml-1">WhatsApp de Pedidos</label>
                    <input
                      type="tel"
                      name="phone"
                      value={formData.phone}
                      onChange={handleChange}
                      className={`w-full px-4 py-3 bg-gray-50/80 border-2 rounded-2xl focus:bg-white focus:ring-4 focus:ring-red-500/5 transition-all duration-300 font-bold text-sm text-gray-900 placeholder:text-gray-300 ${errors.phone ? 'border-red-200' : 'border-transparent focus:border-[#aa1918]'}`}
                      placeholder="Ej: 0990815097"
                      required
                    />
                    <p className="text-gray-400 text-[9px] font-bold ml-1">Debe ser un número celular ecuatoriano (10 dígitos empezando con 09)</p>
                    {errors.phone && <p className="text-red-500 text-[10px] font-bold ml-1">{errors.phone}</p>}
                  </div>

                  {/* Description / Slogan */}
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest ml-1">Descripción</label>
                    <textarea
                      name="description"
                      value={formData.description}
                      onChange={handleChange}
                      rows={2}
                      className={`w-full px-4 py-3 bg-gray-50/80 border-2 rounded-2xl focus:bg-white focus:ring-4 focus:ring-red-500/5 transition-all duration-300 font-bold text-sm text-gray-900 placeholder:text-gray-300 resize-none ${errors.description ? 'border-red-200' : 'border-transparent focus:border-[#aa1918]'}`}
                      placeholder="Cuéntanos qué hace especial a tu negocio..."
                      required
                    />
                    {errors.description && <p className="text-red-500 text-[10px] font-bold ml-1">{errors.description}</p>}
                  </div>
                </div>

                <div className="pt-4 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handlePrevStep}
                    className="flex-1 border border-gray-200 hover:bg-gray-50 text-gray-500 font-black py-4 px-6 rounded-2xl active:scale-95 transition-all duration-300 text-sm uppercase tracking-wider text-center"
                  >
                    Atrás
                  </button>
                  <button
                    type="button"
                    onClick={handleNextStep}
                    disabled={!formData.phone.trim() || !formData.description.trim()}
                    className="flex-[2] bg-[#aa1918] hover:bg-black text-white font-black py-4 px-6 rounded-2xl shadow-lg shadow-red-900/10 active:scale-95 transition-all duration-300 flex items-center justify-center gap-2 group disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <span>Siguiente</span>
                    <i className="bi bi-arrow-right text-sm group-hover:translate-x-0.5 transition-transform"></i>
                  </button>
                </div>
              </div>
            )}

            {/* STEP 3: Cuenta de acceso (Autenticación) */}
            {currentStep === 3 && (
              <div className="space-y-5 animate-in fade-in slide-in-from-right-4 duration-300">
                <h3 className="font-black text-gray-800 uppercase tracking-widest text-xs mb-4 flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-[#aa1918] text-white text-[10px] flex items-center justify-center font-bold">3</span>
                  Cuenta de Acceso
                </h3>

                {currentUser ? (
                  /* Authed state: show status */
                  <div className="space-y-5">
                    <div className="p-4 bg-emerald-50/50 border border-emerald-100 rounded-2xl flex items-center gap-3">
                      <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-sm text-emerald-500 flex-shrink-0">
                        <i className="bi bi-person-check-fill text-lg"></i>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[9px] font-black uppercase tracking-wider text-emerald-600/70 leading-none mb-1">Sesión activa</p>
                        <p className="text-gray-900 font-bold text-xs truncate leading-tight">{currentUser.email}</p>
                      </div>
                    </div>

                    <p className="text-xs text-gray-500 font-medium text-center">
                      Tu tienda estará enlazada a esta cuenta de correo. Si deseas utilizar otra cuenta, cierra sesión a continuación.
                    </p>

                    <div className="flex items-center justify-center">
                      <button
                        type="button"
                        onClick={handleSignOut}
                        className="text-xs font-black uppercase tracking-widest text-red-600 hover:text-black hover:underline flex items-center gap-1.5"
                      >
                        <i className="bi bi-box-arrow-left text-sm"></i>
                        Cerrar sesión o cambiar de cuenta
                      </button>
                    </div>

                    <div className="pt-4 flex items-center gap-3">
                      <button
                        type="button"
                        onClick={handlePrevStep}
                        className="flex-1 border border-gray-200 hover:bg-gray-50 text-gray-500 font-black py-4 px-6 rounded-2xl active:scale-95 transition-all duration-300 text-sm uppercase tracking-wider text-center"
                      >
                        Atrás
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSubmit()}
                        disabled={loading}
                        className="flex-[2] bg-gradient-to-r from-[#aa1918] to-orange-500 hover:from-black hover:to-black text-white font-black py-4 px-6 rounded-2xl shadow-xl shadow-red-900/10 active:scale-95 transition-all duration-300 flex items-center justify-center gap-2 group disabled:opacity-50"
                      >
                        {loading ? (
                          <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
                        ) : (
                          <>
                            <span>Confirmar y Crear Tienda</span>
                            <i className="bi bi-rocket-takeoff text-sm"></i>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Unauthed state: show Email & Google Login/Signup Form */
                  <div className="space-y-4">
                    {/* Email Sign Up Form */}
                    <div className="space-y-3.5 text-left">
                      {/* Email */}
                      <div className="space-y-1">
                        <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest ml-1">Correo Electrónico</label>
                        <input
                          type="email"
                          value={emailInput}
                          onChange={(e) => setEmailInput(e.target.value)}
                          className="w-full px-4 py-3 bg-gray-50/80 border-2 border-transparent focus:border-[#aa1918] focus:bg-white focus:ring-4 focus:ring-red-500/5 transition-all duration-300 font-bold text-sm text-gray-900 placeholder:text-gray-300 rounded-2xl"
                          placeholder="ejemplo@negocio.com"
                          required
                        />
                      </div>

                      {/* Password */}
                      <div className="space-y-1">
                        <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest ml-1">Crea una contraseña</label>
                        <input
                          type="password"
                          value={passwordInput}
                          onChange={(e) => setPasswordInput(e.target.value)}
                          className="w-full px-4 py-3 bg-gray-50/80 border-2 border-transparent focus:border-[#aa1918] focus:bg-white focus:ring-4 focus:ring-red-500/5 transition-all duration-300 font-bold text-sm text-gray-900 placeholder:text-gray-300 rounded-2xl"
                          placeholder="Mínimo 6 caracteres"
                          required
                        />
                      </div>

                      {/* Confirm Password */}
                      <div className="space-y-1">
                        <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest ml-1">Repite tu contraseña</label>
                        <input
                          type="password"
                          value={passwordConfirmInput}
                          onChange={(e) => setPasswordConfirmInput(e.target.value)}
                          className="w-full px-4 py-3 bg-gray-50/80 border-2 border-transparent focus:border-[#aa1918] focus:bg-white focus:ring-4 focus:ring-red-500/5 transition-all duration-300 font-bold text-sm text-gray-900 placeholder:text-gray-300 rounded-2xl"
                          placeholder="Repite tu contraseña"
                          required
                        />
                      </div>

                      {/* Error Display for authentication */}
                      {errors.auth && (
                        <div className="p-3 bg-red-50 border border-red-100 rounded-2xl flex items-center gap-2.5 text-red-600 text-xs font-bold leading-relaxed">
                          <i className="bi bi-exclamation-circle-fill text-base flex-shrink-0"></i>
                          <span>{errors.auth}</span>
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={handleLocalAuth}
                        disabled={loading}
                        className="w-full bg-[#aa1918] hover:bg-black text-white font-black py-4 px-6 rounded-2xl shadow-lg shadow-red-900/10 active:scale-95 transition-all duration-300 flex items-center justify-center gap-2 group disabled:opacity-50 mt-2"
                      >
                        {loading ? (
                          <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
                        ) : (
                          <>
                            <span>Registrarse y Continuar</span>
                            <i className="bi bi-arrow-right text-sm group-hover:translate-x-0.5 transition-transform"></i>
                          </>
                        )}
                      </button>
                    </div>

                    <div className="flex items-center gap-3 my-4">
                      <div className="h-px flex-1 bg-gray-100"></div>
                      <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">o continuar con</span>
                      <div className="h-px flex-1 bg-gray-100"></div>
                    </div>

                    {/* Google Auth */}
                    <button
                      type="button"
                      onClick={handleGoogleAuth}
                      disabled={loading}
                      className="w-full inline-flex items-center justify-center px-5 py-4 border-2 border-gray-100 hover:border-gray-200 rounded-2xl shadow-sm bg-white text-sm font-black text-gray-700 active:scale-95 transition-all duration-300 gap-3 disabled:opacity-50"
                    >
                      <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                      </svg>
                      {loading ? "Cargando..." : "Continuar con Google"}
                    </button>

                    <div className="pt-4 border-t border-gray-100 flex items-center">
                      <button
                        type="button"
                        onClick={handlePrevStep}
                        className="w-full border border-gray-200 hover:bg-gray-50 text-gray-500 font-black py-4 px-6 rounded-2xl active:scale-95 transition-all duration-300 text-sm uppercase tracking-wider text-center"
                      >
                        Atrás
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <p className="text-center mt-8 text-gray-400 text-[9px] font-black uppercase tracking-widest">
          &copy; {new Date().getFullYear()} Fuddiverso &bull; Portal de Socios
        </p>
      </div>
    </div>
  )
}

export default function BusinessRegister() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#FDFDFD] flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-red-50 border-t-red-600 rounded-full animate-spin"></div>
      </div>
    }>
      <BusinessRegisterForm />
    </Suspense>
  )
}
