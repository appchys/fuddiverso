'use client'

import React, { useState } from 'react'
import { Business, Product, ProductVariant } from '@/types'
import { createProduct, updateProduct, deleteProduct, uploadImage } from '@/lib/database'

interface ProductListProps {
  business: Business | null
  products: Product[]
  categories: string[]
  onProductsChange: (products: Product[]) => void
  onCategoriesChange: (categories: string[]) => void
}

export default function ProductList({
  business,
  products,
  categories,
  onProductsChange,
  onCategoriesChange
}: ProductListProps) {
  const [showProductForm, setShowProductForm] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    price: '',
    category: categories[0] || '',
    isAvailable: true,
    image: null as File | null
  })
  const [variants, setVariants] = useState<ProductVariant[]>([])
  const [currentVariant, setCurrentVariant] = useState({ name: '', price: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [uploading, setUploading] = useState(false)
  const [newCategory, setNewCategory] = useState('')
  const [showNewCategory, setShowNewCategory] = useState(false)

  const handleOpenNewProduct = () => {
    setEditingProduct(null)
    const defaultCategory = categories.length > 0 ? categories[0] : 'General'
    setFormData({
      name: '',
      description: '',
      price: '',
      category: defaultCategory,
      isAvailable: true,
      image: null
    })
    setVariants([])
    setErrors({})
    setShowProductForm(true)
  }

  const handleEditProduct = (product: Product) => {
    setEditingProduct(product)
    setFormData({
      name: product.name,
      description: product.description,
      price: product.price.toString(),
      category: product.category,
      isAvailable: product.isAvailable,
      image: null
    })
    setVariants(product.variants || [])
    setErrors({})
    setShowProductForm(true)
  }

  const handleCloseForm = () => {
    setShowProductForm(false)
    setEditingProduct(null)
    const defaultCategory = categories.length > 0 ? categories[0] : 'General'
    setFormData({
      name: '',
      description: '',
      price: '',
      category: defaultCategory,
      isAvailable: true,
      image: null
    })
    setVariants([])
    setCurrentVariant({ name: '', price: '' })
    setErrors({})
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
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

  const addVariant = () => {
    if (!currentVariant.name.trim()) {
      alert('El nombre de la variante es requerido')
      return
    }

    const price = currentVariant.price ? Number(currentVariant.price) : Number(formData.price)
    if (isNaN(price) || price <= 0) {
      alert('El precio debe ser válido')
      return
    }

    const newVariant: ProductVariant = {
      id: Date.now().toString(),
      name: currentVariant.name,
      description: '',
      price: price,
      isAvailable: true
    }

    setVariants(prev => [...prev, newVariant])
    setCurrentVariant({ name: '', price: '' })
  }

  const removeVariant = (variantId: string) => {
    setVariants(prev => prev.filter(v => v.id !== variantId))
  }

  const handleAddCategory = async () => {
    if (!newCategory.trim() || !business?.id) return

    try {
      const updatedCategories = [...categories, newCategory.trim()]
      onCategoriesChange(updatedCategories)
      setFormData(prev => ({ ...prev, category: newCategory.trim() }))
      setNewCategory('')
      setShowNewCategory(false)
    } catch (error) {
      console.error('Error adding category:', error)
    }
  }

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!business?.id) return

    const newErrors: Record<string, string> = {}
    if (!formData.name.trim()) newErrors.name = 'El nombre es requerido'
    if (!formData.description.trim()) newErrors.description = 'La descripción es requerida'
    if (!formData.price || isNaN(Number(formData.price)) || Number(formData.price) <= 0) {
      newErrors.price = 'El precio debe ser válido'
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    setUploading(true)
    try {
      let imageUrl = editingProduct?.image || ''
      if (formData.image) {
        const timestamp = Date.now()
        const path = `products/${timestamp}_${formData.image.name}`
        imageUrl = await uploadImage(formData.image, path)
      }

      const productData = {
        name: formData.name,
        description: formData.description,
        price: Number(formData.price),
        category: formData.category,
        image: imageUrl,
        variants: variants.length > 0 ? variants : undefined,
        isAvailable: formData.isAvailable,
        businessId: business.id,
        updatedAt: new Date()
      }

      if (editingProduct?.id) {
        await updateProduct(editingProduct.id, productData)
        onProductsChange(products.map(p => 
          p.id === editingProduct.id ? { ...p, ...productData } : p
        ))
      } else {
        const newProductId = await createProduct(productData)
        onProductsChange([...products, { ...productData, id: newProductId, createdAt: new Date() }])
      }

      handleCloseForm()
    } catch (error) {
      console.error('Error saving product:', error)
      setErrors({ submit: 'Error al guardar el producto' })
    } finally {
      setUploading(false)
    }
  }

  const handleDeleteProduct = async (productId: string) => {
    if (!confirm('¿Seguro que quieres eliminar este producto?')) return

    try {
      await deleteProduct(productId)
      onProductsChange(products.filter(p => p.id !== productId))
    } catch (error) {
      console.error('Error deleting product:', error)
    }
  }

  const handleToggleAvailability = async (productId: string, isAvailable: boolean) => {
    try {
      await updateProduct(productId, { isAvailable: !isAvailable })
      onProductsChange(products.map(p => 
        p.id === productId ? { ...p, isAvailable: !isAvailable } : p
      ))
    } catch (error) {
      console.error('Error toggling availability:', error)
    }
  }

  return (
    <div className="space-y-6">
      {/* Botón para agregar producto */}
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold text-gray-900">Productos</h2>
        <button
          onClick={handleOpenNewProduct}
          className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
        >
          <i className="bi bi-plus-lg"></i>
          Nuevo Producto
        </button>
      </div>

      {/* Lista de productos */}
      {products.length === 0 ? (
        <div className="bg-gray-50 rounded-lg border border-gray-200 p-8 text-center">
          <i className="bi bi-box-seam text-4xl text-gray-300 mb-3 block"></i>
          <p className="text-gray-600 font-medium">No hay productos</p>
          <p className="text-sm text-gray-500 mt-1">Crea tu primer producto para comenzar</p>
        </div>
      ) : (
        <div className="space-y-3">
          {products.map((product) => (
            <div
              key={product.id}
              className={`border rounded-lg p-4 hover:shadow-sm transition-shadow ${
                product.isAvailable
                  ? 'bg-white border-gray-200'
                  : 'bg-gray-50 border-gray-300 opacity-60'
              }`}
            >
              <div className="flex gap-4">
                {/* Imagen */}
                <div className={`w-16 h-16 flex-shrink-0 rounded-lg flex items-center justify-center overflow-hidden ${
                  product.isAvailable ? 'bg-gray-200' : 'bg-gray-300'
                }`}>
                  {product.image ? (
                    <img src={product.image} alt={product.name} className={`w-full h-full object-cover ${
                      !product.isAvailable ? 'opacity-70' : ''
                    }`} />
                  ) : (
                    <i className={`bi bi-box-seam text-xl ${
                      product.isAvailable ? 'text-gray-400' : 'text-gray-500'
                    }`}></i>
                  )}
                </div>

                {/* Información */}
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className={`font-semibold ${
                      product.isAvailable ? 'text-gray-900' : 'text-gray-600'
                    }`}>{product.name}</h3>
                    {!product.isAvailable && (
                      <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
                        No disponible
                      </span>
                    )}
                  </div>
                  <p className={`text-sm mt-1 line-clamp-2 ${
                    product.isAvailable ? 'text-gray-600' : 'text-gray-500'
                  }`}>{product.description}</p>
                  <div className="flex items-center gap-3 mt-2">
                    <span className={`text-sm font-semibold ${
                      product.isAvailable ? 'text-gray-900' : 'text-gray-600'
                    }`}>${product.price.toFixed(2)}</span>
                    <span className={`text-xs ${
                      product.isAvailable ? 'text-gray-500' : 'text-gray-400'
                    }`}>{product.category}</span>
                    {product.variants && product.variants.length > 0 && (
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        product.isAvailable ? 'bg-blue-50 text-blue-700' : 'bg-gray-300 text-gray-600'
                      }`}>
                        {product.variants.length} variante{product.variants.length !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                </div>

                {/* Botones de acción */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleToggleAvailability(product.id, product.isAvailable)}
                    className={`p-2 rounded-lg transition-colors ${
                      product.isAvailable
                        ? 'text-orange-600 hover:bg-orange-50'
                        : 'text-green-600 hover:bg-green-50'
                    }`}
                    title={product.isAvailable ? 'Ocultar' : 'Mostrar'}
                  >
                    <i className={`bi ${product.isAvailable ? 'bi-eye-slash' : 'bi-eye'}`}></i>
                  </button>
                  <button
                    onClick={() => handleEditProduct(product)}
                    className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                    title="Editar"
                  >
                    <i className="bi bi-pencil"></i>
                  </button>
                  <button
                    onClick={() => handleDeleteProduct(product.id)}
                    className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="Eliminar"
                  >
                    <i className="bi bi-trash"></i>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal del formulario - Versión Visual */}
      {showProductForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              {/* Encabezado */}
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-semibold text-gray-900">
                  {editingProduct ? 'Editar Producto' : 'Nuevo Producto'}
                </h3>
                <button
                  onClick={handleCloseForm}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <i className="bi bi-x-lg text-xl"></i>
                </button>
              </div>

              <form onSubmit={handleSaveProduct} className="space-y-6">
                {/* Sección de Imagen - Visual */}
                <div>
                  <label htmlFor="image-upload" className="block cursor-pointer">
                    <div className="relative w-full aspect-square bg-gray-100 rounded-lg border-2 border-dashed border-gray-300 hover:border-red-400 hover:bg-red-50 transition-colors flex items-center justify-center overflow-hidden group">
                      {formData.image ? (
                        <div className="absolute inset-0 w-full h-full">
                          <img src={URL.createObjectURL(formData.image)} alt="Preview" className="w-full h-full object-cover" />
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                            <div className="text-center">
                              <i className="bi bi-camera text-white text-2xl mb-2 block"></i>
                              <p className="text-white text-sm font-medium">Cambiar imagen</p>
                            </div>
                          </div>
                        </div>
                      ) : editingProduct?.image ? (
                        <div className="absolute inset-0 w-full h-full">
                          <img src={editingProduct.image} alt="Current" className="w-full h-full object-cover" />
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                            <div className="text-center">
                              <i className="bi bi-camera text-white text-2xl mb-2 block"></i>
                              <p className="text-white text-sm font-medium">Cambiar imagen</p>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="text-center">
                          <i className="bi bi-box-seam text-6xl text-gray-300 mb-3 block"></i>
                          <p className="text-gray-500 font-medium mb-1">Arrastra una imagen aquí</p>
                          <p className="text-gray-400 text-sm">o haz clic para seleccionar</p>
                        </div>
                      )}
                    </div>
                  </label>
                  <input
                    id="image-upload"
                    type="file"
                    accept="image/*"
                    onChange={handleImageChange}
                    className="hidden"
                  />
                </div>

                {/* Nombre del Producto - Editable y Destacado */}
                <div>
                  <div className="relative">
                    <input
                      type="text"
                      name="name"
                      value={formData.name}
                      onChange={handleInputChange}
                      placeholder="Nombre del producto"
                      className={`w-full text-3xl font-bold text-gray-900 border-b-2 focus:outline-none transition-colors py-2 px-0 ${
                        errors.name ? 'border-red-500 text-red-600' : 'border-transparent hover:border-gray-300 focus:border-red-500'
                      }`}
                    />
                    {formData.name && (
                      <button
                        type="button"
                        onClick={() => setFormData(prev => ({ ...prev, name: '' }))}
                        className="absolute right-0 top-1/2 -translate-y-1/2 text-gray-400 hover:text-red-500 transition-colors"
                      >
                        <i className="bi bi-x-circle-fill"></i>
                      </button>
                    )}
                  </div>
                  {errors.name && <p className="text-red-500 text-sm mt-2">{errors.name}</p>}
                </div>

                {/* Descripción - Editable tipo nombre */}
                <div>
                  <textarea
                    name="description"
                    value={formData.description}
                    onChange={handleInputChange}
                    rows={2}
                    placeholder="Describe tu producto..."
                    className={`w-full px-0 py-2 border-b-2 focus:outline-none transition-colors bg-transparent text-gray-600 resize-none ${
                      errors.description ? 'border-red-500 text-red-600' : 'border-transparent hover:border-gray-300 focus:border-red-500'
                    }`}
                  />
                  {errors.description && <p className="text-red-500 text-sm mt-2">{errors.description}</p>}
                </div>

                {/* Precio - Grande y destacado */}
                <div>
                  <div className="relative">
                    <span className="absolute left-0 top-2 text-4xl font-bold text-gray-900">$</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      name="price"
                      value={formData.price}
                      onChange={handleInputChange}
                      placeholder="0.00"
                      className={`w-full pl-12 pr-0 py-2 text-4xl font-bold border-b-2 focus:outline-none transition-colors bg-transparent ${
                        errors.price ? 'border-red-500 text-red-600' : 'border-transparent hover:border-gray-300 focus:border-red-500 text-gray-900'
                      }`}
                    />
                  </div>
                  {errors.price && <p className="text-red-500 text-sm mt-2">{errors.price}</p>}
                </div>

                {/* Categoría - Unificada */}
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-3">CATEGORÍA</label>
                  <div className="space-y-2">
                    {categories.length === 0 ? (
                      <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                        <p className="text-sm text-blue-600 font-medium mb-2">📌 Categoría por defecto</p>
                        <p className="text-sm text-gray-600">Se usará "General" como categoría principal</p>
                      </div>
                    ) : (
                      <select
                        name="category"
                        value={formData.category}
                        onChange={handleInputChange}
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 font-medium bg-white"
                      >
                        {categories.map((cat) => (
                          <option key={cat} value={cat}>{cat}</option>
                        ))}
                      </select>
                    )}

                    {/* Botón para agregar nueva categoría - Integrado */}
                    {!showNewCategory ? (
                      <button
                        type="button"
                        onClick={() => setShowNewCategory(true)}
                        className="w-full p-3 border-2 border-dashed border-gray-300 rounded-lg text-gray-600 hover:border-red-400 hover:bg-red-50 transition-colors font-medium text-sm"
                      >
                        <i className="bi bi-plus-circle me-2"></i>
                        Agregar nueva categoría
                      </button>
                    ) : (
                      <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 space-y-2">
                        <input
                          type="text"
                          value={newCategory}
                          onChange={(e) => setNewCategory(e.target.value)}
                          placeholder="Nombre de la nueva categoría"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 text-sm"
                          autoFocus
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={handleAddCategory}
                            className="flex-1 px-3 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium text-sm transition-colors"
                          >
                            <i className="bi bi-check-lg me-1"></i>
                            Crear
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setShowNewCategory(false)
                              setNewCategory('')
                            }}
                            className="flex-1 px-3 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 font-medium text-sm transition-colors"
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Disponibilidad */}
                <label className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors">
                  <input
                    type="checkbox"
                    checked={formData.isAvailable}
                    onChange={(e) => setFormData(prev => ({ ...prev, isAvailable: e.target.checked }))}
                    className="w-5 h-5 rounded text-red-600 cursor-pointer"
                  />
                  <span className="font-medium text-gray-700">Producto disponible</span>
                </label>

                {/* Variantes */}
                <div className="border-t pt-6">
                  <h4 className="font-semibold text-gray-900 mb-4">Variantes (Opcional)</h4>

                  {variants.length > 0 && (
                    <div className="space-y-2 mb-4">
                      {variants.map((variant) => (
                        <div key={variant.id} className="flex items-center justify-between bg-gray-50 p-3 rounded-lg hover:bg-gray-100 transition-colors">
                          <div>
                            <p className="font-medium text-gray-900">{variant.name}</p>
                            <p className="text-sm text-gray-600">${variant.price.toFixed(2)}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeVariant(variant.id)}
                            className="text-red-600 hover:text-red-700 hover:bg-red-50 p-2 rounded-lg transition-colors"
                          >
                            <i className="bi bi-trash"></i>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="space-y-2 bg-gray-50 p-4 rounded-lg">
                    <input
                      type="text"
                      value={currentVariant.name}
                      onChange={(e) => setCurrentVariant(prev => ({ ...prev, name: e.target.value }))}
                      placeholder="Ej: Tamaño grande, Con queso extra"
                      className="w-full px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-red-500 bg-white"
                    />
                    <div className="flex gap-2">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={currentVariant.price}
                        onChange={(e) => setCurrentVariant(prev => ({ ...prev, price: e.target.value }))}
                        placeholder="Precio (opcional)"
                        className="flex-1 px-3 py-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-red-500 bg-white"
                      />
                      <button
                        type="button"
                        onClick={addVariant}
                        className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 font-medium"
                      >
                        <i className="bi bi-plus-lg me-1"></i>
                        Agregar
                      </button>
                    </div>
                  </div>
                </div>

                {/* Error general */}
                {errors.submit && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                    <p className="text-red-600 text-sm">{errors.submit}</p>
                  </div>
                )}

                {/* Botones */}
                <div className="flex gap-3 pt-4 border-t">
                  <button
                    type="button"
                    onClick={handleCloseForm}
                    disabled={uploading}
                    className="flex-1 px-4 py-3 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors font-medium disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={uploading}
                    className="flex-1 px-4 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {uploading ? (
                      <>
                        <i className="bi bi-arrow-clockwise animate-spin"></i>
                        Guardando...
                      </>
                    ) : (
                      <>
                        <i className="bi bi-check-lg"></i>
                        {editingProduct ? 'Guardar Cambios' : 'Crear Producto'}
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
