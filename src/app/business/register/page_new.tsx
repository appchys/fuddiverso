'use client'

import { useState, useEffect, Suspense } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
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
    } else if (!/^[a-zA-Z0-9_]+$/.test(formData.username)) {
      newErrors.username = 'El nombre de usuario solo puede contener letras, números y guiones bajos'
    }

    if (!formData.description.trim()) {
      newErrors.description = 'La descripción es requerida'
    }

    if (!formData.phone.trim()) {
      newErrors.phone = 'El teléfono es requerido'
    } else if (!validateEcuadorianPhone(formData.phone)) {
      newErrors.phone = 'Formato de teléfono inválido. Usar formato: 09XXXXXXXX'
    }

    if (!formData.address.trim()) {
      newErrors.address = 'La dirección es requerida'
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
    }
  }

  // Mostrar loading mientras se verifica autenticación
  if (checkingAuth) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Verificando autenticación...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 py-6 sm:py-12">
      <div className="max-w-2xl mx-auto px-4">
        <div className="bg-white rounded-lg shadow-md p-6 sm:p-8">
          <div className="text-center mb-6 sm:mb-8">
            <Link href="/" className="text-2xl font-bold text-red-600">
              Fuddiverso
            </Link>
            <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mt-4">
              Crear Nueva Tienda
            </h2>
            {currentUser && (
              <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-md">
                <div className="flex items-center justify-center">
                  <svg className="w-5 h-5 text-green-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <p className="text-green-800 font-medium">
                    Usuario: {currentUser.email}
                  </p>
                </div>
                <p className="text-green-700 text-sm mt-1 text-center">
                  Completa los datos de tu nueva tienda para comenzar a recibir pedidos
                </p>
              </div>
            )}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-6">
            {/* Nombre del negocio */}
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-2">
                Nombre del Negocio *
              </label>
              <input
                type="text"
                id="name"
                name="name"
                value={formData.name}
                onChange={handleChange}
                className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm sm:text-base ${
                  errors.name ? 'border-red-500' : 'border-gray-300'
                }`}
                placeholder="Ej: Pizzería Don Mario"
              />
              {errors.name && <p className="text-red-500 text-sm mt-1">{errors.name}</p>}
            </div>

            {/* Nombre de usuario */}
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-gray-700 mb-2">
                Nombre de Usuario *
              </label>
              <div className="relative">
                <span className="absolute left-3 top-2 text-gray-500 text-sm sm:text-base">@</span>
                <input
                  type="text"
                  id="username"
                  name="username"
                  value={formData.username}
                  onChange={handleChange}
                  className={`w-full pl-8 pr-3 py-2 border rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm sm:text-base ${
                    errors.username ? 'border-red-500' : 'border-gray-300'
                  }`}
                  placeholder="donmario"
                />
              </div>
              <p className="text-gray-500 text-xs mt-1">Este será tu URL: fuddiverso.com/@{formData.username}</p>
              {errors.username && <p className="text-red-500 text-sm mt-1">{errors.username}</p>}
            </div>

            {/* Descripción */}
            <div>
              <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-2">
                Descripción *
              </label>
              <textarea
                id="description"
                name="description"
                value={formData.description}
                onChange={handleChange}
                rows={3}
                className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm sm:text-base ${
                  errors.description ? 'border-red-500' : 'border-gray-300'
                }`}
                placeholder="Describe tu negocio..."
              />
              {errors.description && <p className="text-red-500 text-sm mt-1">{errors.description}</p>}
            </div>

            {/* Teléfono */}
            <div>
              <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-2">
                Teléfono *
              </label>
              <input
                type="tel"
                id="phone"
                name="phone"
                value={formData.phone}
                onChange={handleChange}
                className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm sm:text-base ${
                  errors.phone ? 'border-red-500' : 'border-gray-300'
                }`}
                placeholder="0999999999"
              />
              {errors.phone && <p className="text-red-500 text-sm mt-1">{errors.phone}</p>}
            </div>

            {/* Dirección */}
            <div>
              <label htmlFor="address" className="block text-sm font-medium text-gray-700 mb-2">
                Dirección *
              </label>
              <input
                type="text"
                id="address"
                name="address"
                value={formData.address}
                onChange={handleChange}
                className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm sm:text-base ${
                  errors.address ? 'border-red-500' : 'border-gray-300'
                }`}
                placeholder="Dirección completa del negocio"
              />
              {errors.address && <p className="text-red-500 text-sm mt-1">{errors.address}</p>}
            </div>

            {/* Referencias */}
            <div>
              <label htmlFor="references" className="block text-sm font-medium text-gray-700 mb-2">
                Referencias de Ubicación
              </label>
              <input
                type="text"
                id="references"
                name="references"
                value={formData.references}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm sm:text-base"
                placeholder="Ej: Cerca del centro comercial, frente al parque..."
              />
            </div>

            {/* Categoría */}
            <div>
              <label htmlFor="category" className="block text-sm font-medium text-gray-700 mb-2">
                Categoría *
              </label>
              <select
                id="category"
                name="category"
                value={formData.category}
                onChange={handleChange}
                className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm sm:text-base ${
                  errors.category ? 'border-red-500' : 'border-gray-300'
                }`}
              >
                <option value="">Selecciona una categoría</option>
                <option value="Comida Rápida">Comida Rápida</option>
                <option value="Pizza">Pizza</option>
                <option value="Hamburguesas">Hamburguesas</option>
                <option value="Pollo">Pollo</option>
                <option value="Asiática">Asiática</option>
                <option value="Italiana">Italiana</option>
                <option value="Mexicana">Mexicana</option>
                <option value="Desayunos">Desayunos</option>
                <option value="Postres">Postres</option>
                <option value="Bebidas">Bebidas</option>
                <option value="Saludable">Saludable</option>
                <option value="Parrilla">Parrilla</option>
                <option value="Mariscos">Mariscos</option>
                <option value="Vegetariana">Vegetariana</option>
                <option value="Otro">Otro</option>
              </select>
              {errors.category && <p className="text-red-500 text-sm mt-1">{errors.category}</p>}
            </div>

            {/* Imagen del negocio */}
            <div>
              <label htmlFor="image" className="block text-sm font-medium text-gray-700 mb-2">
                Logo/Imagen del Negocio
              </label>
              <input
                type="file"
                id="image"
                accept="image/*"
                onChange={handleImageChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm sm:text-base"
              />
              <p className="text-gray-500 text-xs mt-1">Formatos soportados: JPG, PNG, WebP</p>
            </div>

            {/* Error general */}
            {errors.submit && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-md">
                <p className="text-red-800">{errors.submit}</p>
              </div>
            )}

            {/* Botón de envío */}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-red-600 text-white py-2 px-4 rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium text-sm sm:text-base transition-colors"
            >
              {loading ? (
                <span className="flex items-center justify-center">
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Creando Tienda...
                </span>
              ) : (
                'Crear Tienda'
              )}
            </button>
          </form>

          <div className="mt-6 sm:mt-8 text-center">
            <Link 
              href="/business/dashboard" 
              className="text-red-600 hover:text-red-700 text-sm sm:text-base"
            >
              ← Volver al Dashboard
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function BusinessRegister() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600"></div>
      </div>
    }>
      <BusinessRegisterForm />
    </Suspense>
  )
}
