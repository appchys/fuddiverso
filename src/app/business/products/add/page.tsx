'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createProduct, uploadImage, getBusinessCategories, addCategoryToBusiness, getBusinessByOwner } from '@/lib/database'
import { ProductVariant } from '@/types'
import { auth } from '@/lib/firebase'
import { useBusinessAuth } from '@/contexts/BusinessAuthContext'

export default function AddProductPage() {
  const router = useRouter()
  const [business, setBusiness] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    price: '',
    category: '',
    image: null as File | null
  })

  const [variants, setVariants] = useState<ProductVariant[]>([])
  const [currentVariant, setCurrentVariant] = useState({
    name: '',
    description: '',
    price: ''
  })

  const [categories, setCategories] = useState<string[]>([])
  const [newCategory, setNewCategory] = useState('')
  const [showNewCategoryForm, setShowNewCategoryForm] = useState(false)

  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    // Obtener categorías existentes del negocio al cargar la página
    const loadCategories = async () => {
      const user = auth.currentUser
      if (!user) {
        setErrors({ submit: 'Debes iniciar sesión para acceder a esta página.' })
        return
      }

      try {
        // Obtener businessId del localStorage (desde el dashboard)
        const storedBusinessId = localStorage.getItem('currentBusinessId')

        if (!storedBusinessId) {
          setErrors({ submit: 'No se ha seleccionado ningún negocio. Por favor, ve al dashboard primero.' })
          return
        }

        const businessCategories = await getBusinessCategories(storedBusinessId)
        setCategories(businessCategories)

        // Cargar datos del negocio para el slug
        const businessData = await getBusinessByOwner(user.uid)
        setBusiness(businessData)
      } catch (error: any) {
        console.error('Error loading categories or business:', error)
        setErrors({ submit: `Error: ${error.message}` })
      }
    }
    loadCategories()
  }, [])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
    // Limpiar error cuando el usuario empiece a escribir
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: '' }))
    }
  }

  const addNewCategory = async () => {
    if (!newCategory.trim()) return

    try {
      const user = auth.currentUser
      if (!user) {
        setErrors({ submit: 'Debes iniciar sesión para agregar categorías.' })
        return
      }

      // Obtener businessId del localStorage (desde el dashboard)
      const storedBusinessId = localStorage.getItem('currentBusinessId')

      if (!storedBusinessId) {
        setErrors({ submit: 'No se ha seleccionado ningún negocio. Por favor, ve al dashboard primero.' })
        return
      }

      await addCategoryToBusiness(storedBusinessId, newCategory.trim())
      setCategories(prev => [...prev, newCategory.trim()])
      setFormData(prev => ({ ...prev, category: newCategory.trim() }))
      setNewCategory('')
      setShowNewCategoryForm(false)

      // Limpiar errores si todo salió bien
      setErrors({})
    } catch (error: any) {
      console.error('Error adding category:', error)
      setErrors({ submit: `Error al agregar categoría: ${error.message}` })
    }
  }

  const handleVariantChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target
    setCurrentVariant(prev => ({ ...prev, [name]: value }))
  }

  const addVariant = () => {
    if (!currentVariant.name.trim()) {
      alert('El nombre de la variante es requerido')
      return
    }

    const price = currentVariant.price ? Number(currentVariant.price) : Number(formData.price)

    if (isNaN(price) || price <= 0) {
      alert('El precio debe ser un número válido mayor a 0')
      return
    }

    const newVariant: ProductVariant = {
      id: Date.now().toString(), // ID temporal
      name: currentVariant.name,
      description: currentVariant.description || '',
      price: price,
      isAvailable: true
    }

    setVariants(prev => [...prev, newVariant])
    setCurrentVariant({ name: '', description: '', price: '' })
  }

  const removeVariant = (variantId: string) => {
    setVariants(prev => prev.filter(v => v.id !== variantId))
  }

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setFormData(prev => ({ ...prev, image: file }))
    }
  }

  const validateForm = () => {
    const newErrors: Record<string, string> = {}

    if (!formData.name.trim()) {
      newErrors.name = 'El nombre del producto es requerido'
    }

    if (!formData.description.trim()) {
      newErrors.description = 'La descripción es requerida'
    }

    if (!formData.price.trim()) {
      newErrors.price = 'El precio es requerido'
    } else if (isNaN(Number(formData.price)) || Number(formData.price) <= 0) {
      newErrors.price = 'El precio debe ser un número mayor a 0'
    }

    if (!formData.category) {
      newErrors.category = 'La categoría es requerida'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!validateForm()) {
      return
    }

    const user = auth.currentUser
    if (!user) {
      router.push('/business/login')
      return
    }

    setLoading(true)

    try {
      // Obtener businessId del localStorage (desde el dashboard)
      const storedBusinessId = localStorage.getItem('currentBusinessId')

      if (!storedBusinessId) {
        setErrors({ submit: 'No se ha seleccionado ningún negocio. Por favor, ve al dashboard primero.' })
        setLoading(false)
        return
      }

      let imageUrl = ''

      // Subir imagen si existe
      if (formData.image) {
        const imagePath = `products/${Date.now()}_${formData.image.name}`
        imageUrl = await uploadImage(formData.image, imagePath)
      }

      // Crear producto en Firebase
      await createProduct({
        businessId: storedBusinessId,
        name: formData.name,
        description: formData.description,
        price: Number(formData.price),
        category: formData.category,
        image: imageUrl,
        variants: variants.length > 0 ? variants : undefined,
        isAvailable: true,
        updatedAt: new Date()
      }, business?.username)

      // Redirigir al dashboard
      router.push('/business/dashboard')

    } catch (error) {
      console.error('Error creating product:', error)
      setErrors({ submit: 'Error al crear el producto. Intenta nuevamente.' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-2xl mx-auto px-4">
        <div className="bg-white rounded-lg shadow-md p-8">
          <div className="text-center mb-8">
            <Link href="/business/dashboard" className="text-2xl font-bold text-red-600">
              Fuddiverso
            </Link>
            <h2 className="text-3xl font-bold text-gray-900 mt-4">
              Agregar Producto
            </h2>
            <p className="text-gray-600 mt-2">
              Agrega un nuevo producto a tu menú
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Categoría *
              </label>

              {!showNewCategoryForm ? (
                <div className="space-y-2">
                  <select
                    name="category"
                    required
                    value={formData.category}
                    onChange={handleInputChange}
                    className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-red-500 ${errors.category ? 'border-red-500' : 'border-gray-300'
                      }`}
                  >
                    <option value="">Seleccionar categoría</option>
                    {categories.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={() => setShowNewCategoryForm(true)}
                    className="text-red-600 hover:text-red-800 text-sm font-medium"
                  >
                    + Agregar nueva categoría
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newCategory}
                      onChange={(e) => setNewCategory(e.target.value)}
                      placeholder="Nombre de la nueva categoría"
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                      onKeyPress={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          addNewCategory()
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={addNewCategory}
                      className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
                    >
                      Agregar
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowNewCategoryForm(false)
                        setNewCategory('')
                      }}
                      className="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
              {errors.category && <p className="text-red-500 text-sm mt-1">{errors.category}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Nombre del Producto *
              </label>
              <input
                type="text"
                name="name"
                required
                value={formData.name}
                onChange={handleInputChange}
                className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-red-500 ${errors.name ? 'border-red-500' : 'border-gray-300'
                  }`}
                placeholder="Ej: Hamburguesa Clásica"
              />
              {errors.name && <p className="text-red-500 text-sm mt-1">{errors.name}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Descripción *
              </label>
              <textarea
                name="description"
                rows={3}
                required
                value={formData.description}
                onChange={handleInputChange}
                className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-red-500 ${errors.description ? 'border-red-500' : 'border-gray-300'
                  }`}
                placeholder="Describe tu producto..."
              />
              {errors.description && <p className="text-red-500 text-sm mt-1">{errors.description}</p>}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Precio ($) *
                </label>
                <input
                  type="number"
                  name="price"
                  step="0.01"
                  min="0"
                  required
                  value={formData.price}
                  onChange={handleInputChange}
                  className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-red-500 ${errors.price ? 'border-red-500' : 'border-gray-300'
                    }`}
                  placeholder="10.50"
                />
                {errors.price && <p className="text-red-500 text-sm mt-1">{errors.price}</p>}
              </div>
            </div>

            {/* Sección de Variantes */}
            <div className="border-t pt-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                Variantes del Producto (Opcional)
              </h3>
              <p className="text-gray-600 text-sm mb-4">
                Agrega diferentes variantes como sabores, tamaños, o tipos. Si no especificas precio, usará el precio base.
              </p>

              {/* Formulario para agregar variante */}
              <div className="bg-gray-50 p-4 rounded-lg mb-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Nombre de la Variante
                    </label>
                    <input
                      type="text"
                      name="name"
                      value={currentVariant.name}
                      onChange={handleVariantChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                      placeholder="Ej: Pan de ajo"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Precio ($ - opcional)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      name="price"
                      value={currentVariant.price}
                      onChange={handleVariantChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                      placeholder="Dejalo vacío para usar precio base"
                    />
                  </div>

                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={addVariant}
                      className="w-full bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors"
                    >
                      Agregar Variante
                    </button>
                  </div>
                </div>

                <div className="mt-3">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Descripción (opcional)
                  </label>
                  <input
                    type="text"
                    name="description"
                    value={currentVariant.description}
                    onChange={handleVariantChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                    placeholder="Ej: Con salsa especial"
                  />
                </div>
              </div>

              {/* Lista de variantes agregadas */}
              {variants.length > 0 && (
                <div className="mb-4">
                  <h4 className="font-medium text-gray-900 mb-3">Variantes agregadas:</h4>
                  <div className="space-y-2">
                    {variants.map((variant) => (
                      <div key={variant.id} className="flex items-center justify-between bg-white border border-gray-200 rounded-lg p-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-4">
                            <span className="font-medium text-gray-900">{variant.name}</span>
                            <span className="text-green-600 font-medium">${variant.price.toFixed(2)}</span>
                          </div>
                          {variant.description && (
                            <p className="text-gray-600 text-sm mt-1">{variant.description}</p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => removeVariant(variant.id)}
                          className="text-red-600 hover:text-red-800 text-sm font-medium ml-4"
                        >
                          Eliminar
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Imagen del Producto
              </label>
              <input
                type="file"
                accept="image/*"
                onChange={handleImageChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
              />
              <p className="text-gray-500 text-sm mt-1">Sube una imagen de tu producto (opcional)</p>
            </div>

            <div className="flex justify-between items-center pt-6">
              <Link
                href="/business/dashboard"
                className="text-gray-600 hover:text-gray-800"
              >
                ← Volver al Dashboard
              </Link>
              <button
                type="submit"
                disabled={loading}
                className="bg-red-600 text-white px-6 py-3 rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Guardando...' : 'Agregar Producto'}
              </button>
            </div>

            {errors.submit && (
              <div className="mt-4 p-4 bg-red-100 border border-red-400 text-red-700 rounded">
                {errors.submit}
                {errors.submit.includes('registra tu negocio') && (
                  <div className="mt-2">
                    <Link
                      href="/business/register"
                      className="underline text-red-800 hover:text-red-900 font-medium"
                    >
                      Registrar mi negocio aquí →
                    </Link>
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
