'use client'

import { useState, useEffect, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { onAuthStateChanged, User } from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { validateEcuadorianPhone } from '@/lib/validation'
import { createBusinessFromForm, uploadImage } from '@/lib/database'

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
    address: '',
    references: '',
    category: '',
    image: null as File | null
  })

  const [errors, setErrors] = useState<Record<string, string>>({})

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
      
      // Subir imagen si existe
      if (formData.image) {
        const imagePath = `businesses/${Date.now()}_${formData.image.name}`
        imageUrl = await uploadImage(formData.image, imagePath)
      }

      // Crear negocio en Firebase con el UID del usuario
      const businessId = await createBusinessFromForm({
        name: formData.name,
        username: formData.username,
        email: currentUser.email || '', // Usar el email del usuario autenticado
        phone: formData.phone,
        address: formData.address,
        description: formData.description,
        image: imageUrl,
        category: formData.category,
        references: formData.references || '',
        ownerId: currentUser.uid
      })

      // Guardar información en localStorage para la sesión
      localStorage.setItem('businessId', businessId)
      localStorage.setItem('ownerId', currentUser.uid)
      
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
    } else if (!/^[a-zA-Z0-9_-]{3,20}$/.test(formData.username)) {
      newErrors.username = 'El usuario debe tener 3-20 caracteres y solo puede contener letras, números, guiones y guiones bajos'
    } else if (formData.username.toLowerCase() === 'admin' || formData.username.toLowerCase() === 'api' || formData.username.toLowerCase() === 'www') {
      newErrors.username = 'Este nombre de usuario no está disponible'
    }

    // Solo validar email si NO es usuario de Google
    if (!isGoogleUser) {
      if (!formData.email.trim()) {
        newErrors.email = 'El email es requerido'
      } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
        newErrors.email = 'El email no es válido'
      }
    }

    // Solo validar contraseña si NO es usuario de Google
    if (!isGoogleUser) {
      if (!formData.password.trim()) {
        newErrors.password = 'La contraseña es requerida'
      } else if (formData.password.length < 6) {
        newErrors.password = 'La contraseña debe tener al menos 6 caracteres'
      }

      if (!formData.confirmPassword.trim()) {
        newErrors.confirmPassword = 'Confirma tu contraseña'
      } else if (formData.password !== formData.confirmPassword) {
        newErrors.confirmPassword = 'Las contraseñas no coinciden'
      }
    }

    if (!formData.phone.trim()) {
      newErrors.phone = 'El teléfono es requerido'
    } else if (!validateEcuadorianPhone(formData.phone)) {
      newErrors.phone = 'Ingrese un número de celular ecuatoriano válido (10 dígitos empezando con 09)'
    }

    if (!formData.address.trim()) {
      newErrors.address = 'La dirección es requerida'
    }

    if (!formData.description.trim()) {
      newErrors.description = 'La descripción es requerida'
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
    
    if (name === 'email' && emailExistsError) {
      setEmailExistsError(false)
      setShowLoginOption(false)
      setErrors(prev => ({ ...prev, submit: '' }))
    }
  }

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setFormData(prev => ({ ...prev, image: file }))
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-2xl mx-auto px-4">
        <div className="bg-white rounded-lg shadow-md p-8">
          <div className="text-center mb-8">
            <Link href="/" className="text-2xl font-bold text-red-600">
              Fuddiverso
            </Link>
            <h2 className="text-3xl font-bold text-gray-900 mt-4">
              Registra tu Negocio
            </h2>
            {isGoogleUser ? (
              <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-md">
                <div className="flex items-center">
                  <svg className="w-5 h-5 text-green-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <p className="text-green-800 font-medium">¡Autenticado con Google exitosamente!</p>
                </div>
                <p className="text-green-700 text-sm mt-1">
                  Completa los datos de tu negocio para comenzar a recibir pedidos
                </p>
              </div>
            ) : (
              <p className="text-gray-600 mt-2">
                Únete a nuestra plataforma y comienza a recibir pedidos
              </p>
            )}
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                Información del Negocio
              </h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Nombre del Negocio *
                  </label>
                  <input
                    type="text"
                    name="name"
                    required
                    value={formData.name}
                    onChange={handleChange}
                    className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-red-500 ${
                      errors.name ? 'border-red-500' : 'border-gray-300'
                    }`}
                  />
                  {errors.name && <p className="text-red-500 text-sm mt-1">{errors.name}</p>}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Usuario/URL *
                  </label>
                  <input
                    type="text"
                    name="username"
                    required
                    value={formData.username}
                    onChange={handleChange}
                    className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-red-500 ${
                      errors.username ? 'border-red-500' : 'border-gray-300'
                    }`}
                    placeholder="ej: munchys"
                  />
                  <p className="text-xs text-gray-500 mt-1">Tu restaurante estará disponible en fuddiverso.com/{formData.username}</p>
                  {errors.username && <p className="text-red-500 text-sm mt-1">{errors.username}</p>}
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Celular *
                  </label>
                  <input
                    type="tel"
                    name="phone"
                    required
                    value={formData.phone}
                    onChange={handleChange}
                    className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-red-500 ${
                      errors.phone ? 'border-red-500' : 'border-gray-300'
                    }`}
                    placeholder="0990815097"
                  />
                  {errors.phone && <p className="text-red-500 text-sm mt-1">{errors.phone}</p>}
                </div>
              </div>
              
              {!isGoogleUser && (
                <div className="mt-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Email *
                  </label>
                  <input
                    type="email"
                    name="email"
                    required
                    value={formData.email}
                    onChange={handleChange}
                    className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-red-500 ${
                      errors.email ? 'border-red-500' : 'border-gray-300'
                    }`}
                  />
                  {errors.email && <p className="text-red-500 text-sm mt-1">{errors.email}</p>}
                </div>
              )}

              {!isGoogleUser && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Contraseña *
                    </label>
                    <input
                      type="password"
                      name="password"
                      required
                      value={formData.password}
                      onChange={handleChange}
                      className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-red-500 ${
                        errors.password ? 'border-red-500' : 'border-gray-300'
                      }`}
                      placeholder="Mínimo 6 caracteres"
                    />
                    {errors.password && <p className="text-red-500 text-sm mt-1">{errors.password}</p>}
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Confirmar Contraseña *
                    </label>
                    <input
                      type="password"
                      name="confirmPassword"
                      required
                      value={formData.confirmPassword}
                      onChange={handleChange}
                      className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-red-500 ${
                        errors.confirmPassword ? 'border-red-500' : 'border-gray-300'
                      }`}
                      placeholder="Repite la contraseña"
                    />
                    {errors.confirmPassword && <p className="text-red-500 text-sm mt-1">{errors.confirmPassword}</p>}
                  </div>
                </div>
              )}

              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Categoría *
                </label>
                <select
                  name="category"
                  value={formData.category}
                  onChange={handleChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  <option value="">Seleccionar categoría</option>
                  <option value="restaurant">Restaurante</option>
                  <option value="fastfood">Comida Rápida</option>
                  <option value="desserts">Postres</option>
                  <option value="coffee">Café</option>
                  <option value="bakery">Panadería</option>
                  <option value="grocery">Abarrotes</option>
                  <option value="pharmacy">Farmacia</option>
                  <option value="other">Otro</option>
                </select>
              </div>

              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Descripción del Negocio *
                </label>
                <textarea
                  name="description"
                  rows={3}
                  value={formData.description}
                  onChange={handleChange}
                  className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-red-500 ${
                    errors.description ? 'border-red-500' : 'border-gray-300'
                  }`}
                  placeholder="Describe tu negocio..."
                />
                {errors.description && <p className="text-red-500 text-sm mt-1">{errors.description}</p>}
              </div>

              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Imagen del Negocio
                </label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
            </div>

            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                Ubicación
              </h3>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Dirección *
                </label>
                <textarea
                  name="address"
                  rows={2}
                  value={formData.address}
                  onChange={handleChange}
                  className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-red-500 ${
                    errors.address ? 'border-red-500' : 'border-gray-300'
                  }`}
                  placeholder="Dirección completa de tu negocio"
                />
                {errors.address && <p className="text-red-500 text-sm mt-1">{errors.address}</p>}
              </div>
              
              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Referencias
                </label>
                <input
                  type="text"
                  name="references"
                  value={formData.references}
                  onChange={handleChange}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                  placeholder="Cerca de, frente a, etc."
                />
              </div>
            </div>

            <div className="pt-6">
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-red-600 text-white py-3 px-4 rounded-lg font-semibold hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? 'Registrando...' : 'Registrar Negocio'}
              </button>
            </div>
            
            {errors.submit && (
              <div className="mt-4 p-4 bg-red-100 border border-red-400 text-red-700 rounded">
                {errors.submit}
                {emailExistsError && (
                  <div className="mt-3 space-y-2">
                    <Link 
                      href="/business/login" 
                      className="inline-block text-blue-600 hover:text-blue-800 underline font-medium"
                    >
                      Ir a la página de login
                    </Link>
                    {showLoginOption && formData.password && (
                      <div>
                        <p className="text-sm text-gray-600 mb-2">
                          O si esta es tu contraseña actual, puedes iniciar sesión directamente:
                        </p>
                        <button
                          type="button"
                          onClick={handleLoginExistingUser}
                          disabled={loading}
                          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 text-sm"
                        >
                          {loading ? 'Iniciando sesión...' : 'Iniciar sesión con esta cuenta'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  )
}

export default function BusinessRegister() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Cargando...</p>
        </div>
      </div>
    }>
      <BusinessRegisterForm />
    </Suspense>
  )
}
