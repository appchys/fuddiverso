'use client'

import React, { useState, useEffect } from 'react'
import { Product, ProductVariant, Business } from '@/types'
import { createProduct, updateProduct, deleteProduct, uploadImage, getBusinessCategories, addCategoryToBusiness, getIngredientLibrary, addOrUpdateIngredientInLibrary, IngredientLibraryItem, updateBusiness } from '@/lib/database'

interface ProductManagementProps {
  business: Business | null
  products: Product[]
  onProductsChange: (products: Product[]) => void
  businessCategories: string[]
  onCategoriesChange: (categories: string[]) => void
}

export default function ProductManagement({
  business,
  products,
  onProductsChange,
  businessCategories,
  onCategoriesChange
}: ProductManagementProps) {
  // Estados para el modal de edición de productos
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [editFormData, setEditFormData] = useState({
    name: '',
    description: '',
    price: '',
    category: '',
    isAvailable: true,
    image: null as File | null
  })
  const [editVariants, setEditVariants] = useState<ProductVariant[]>([])
  const [editingVariantIngredients, setEditingVariantIngredients] = useState<string | null>(null)
  const [editCurrentVariant, setEditCurrentVariant] = useState({
    name: '',
    description: '',
    price: ''
  })
  const [newCategory, setNewCategory] = useState('')
  const [showNewCategoryForm, setShowNewCategoryForm] = useState(false)
  const [editErrors, setEditErrors] = useState<Record<string, string>>({})
  const [uploading, setUploading] = useState(false)

  // Estados para modal de variantes
  const [selectedProductForVariants, setSelectedProductForVariants] = useState<Product | null>(null)
  const [isVariantModalOpen, setIsVariantModalOpen] = useState(false)

  // Estados para pestañas del modal
  const [activeModalTab, setActiveModalTab] = useState<'general' | 'ingredients'>('general')

  // Estados para ingredientes
  const [editIngredients, setEditIngredients] = useState<Array<{
    id: string
    name: string
    unitCost: number
    quantity: number
  }>>([])
  const [editCurrentIngredient, setEditCurrentIngredient] = useState({
    name: '',
    unitCost: '',
    quantity: ''
  })
  const [variantIngredients, setVariantIngredients] = useState<Record<string, Array<{
    id: string
    name: string
    unitCost: number
    quantity: number
  }>>>({})

  // Estados para modal de ingredientes por variante
  const [showVariantIngredientModal, setShowVariantIngredientModal] = useState(false)
  const [currentVariantForIngredient, setCurrentVariantForIngredient] = useState<string | null>(null)
  const [modalIngredient, setModalIngredient] = useState({
    name: '',
    unitCost: '',
    quantity: ''
  })

  // Estados para biblioteca de ingredientes
  const [ingredientLibrary, setIngredientLibrary] = useState<IngredientLibraryItem[]>([])
  const [showIngredientSuggestions, setShowIngredientSuggestions] = useState(false)
  const [ingredientSearchTerm, setIngredientSearchTerm] = useState('')

  // Cerrar sugerencias y modal al hacer clic fuera
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element

      // Cerrar sugerencias de ingredientes
      if (showIngredientSuggestions && !target.closest('.ingredient-input-container')) {
        setShowIngredientSuggestions(false)
      }

      // Cerrar modal de ingredientes por variante
      if (showVariantIngredientModal && !target.closest('.modal-content') && !target.closest('.modal-overlay')) {
        closeVariantIngredientModal()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showIngredientSuggestions, showVariantIngredientModal])

  const handleToggleAvailability = async (productId: string, currentAvailability: boolean) => {
    try {
      await updateProduct(productId, { isAvailable: !currentAvailability })
      onProductsChange(products.map(product => 
        product.id === productId ? { ...product, isAvailable: !currentAvailability } : product
      ))
    } catch (error) {
      console.error('Error updating product availability:', error)
    }
  }

  const handleDeleteProduct = async (productId: string) => {
    if (window.confirm('¿Estás seguro de que quieres eliminar este producto?')) {
      try {
        await deleteProduct(productId)
        onProductsChange(products.filter(product => product.id !== productId))
      } catch (error) {
        console.error('Error deleting product:', error)
      }
    }
  }

  const handleEditProduct = async (product: Product) => {
    setEditingProduct(product)
    setEditFormData({
      name: product.name,
      description: product.description,
      price: product.price.toString(),
      category: product.category,
      isAvailable: product.isAvailable,
      image: null
    })
    setEditVariants(product.variants || [])
    setEditIngredients((product as any).ingredients || [])
    
    // Cargar ingredientes por variante
    const variantIngs: Record<string, any[]> = {}
    if (product.variants) {
      product.variants.forEach(variant => {
        if ((variant as any).ingredients) {
          variantIngs[variant.id] = (variant as any).ingredients
        }
      })
    }
    setVariantIngredients(variantIngs)
    
    // Cargar biblioteca de ingredientes
    if (business?.id) {
      const library = await getIngredientLibrary(business.id)
      setIngredientLibrary(library)
    }
    
    setActiveModalTab('general')
    setShowEditModal(true)
  }

  const handleUpdateProduct = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!business?.id) return

    // Validar formulario
    const newErrors: Record<string, string> = {}
    if (!editFormData.name.trim()) newErrors.name = 'El nombre es requerido'
    if (!editFormData.description.trim()) newErrors.description = 'La descripción es requerida'
    if (!editFormData.price || isNaN(Number(editFormData.price)) || Number(editFormData.price) <= 0) {
      newErrors.price = 'El precio debe ser un número válido mayor a 0'
    }
    if (!editFormData.category) newErrors.category = 'La categoría es requerida'

    if (Object.keys(newErrors).length > 0) {
      setEditErrors(newErrors)
      return
    }

    setUploading(true)
    try {
      let imageUrl = editingProduct?.image || '' // Mantener imagen actual por defecto

      // Subir nueva imagen si se seleccionó una
      if (editFormData.image) {
        const timestamp = Date.now()
        const path = `products/${timestamp}_${editFormData.image.name}`
        imageUrl = await uploadImage(editFormData.image, path)
      }

      // Agregar ingredientes a cada variante
      const variantsWithIngredients = editVariants.map(variant => ({
        ...variant,
        ingredients: variantIngredients[variant.id] || undefined
      }))

      const productData = {
        name: editFormData.name,
        description: editFormData.description,
        price: Number(editFormData.price),
        category: editFormData.category,
        image: imageUrl,
        variants: editVariants.length > 0 ? variantsWithIngredients : undefined,
        ingredients: editIngredients.length > 0 ? editIngredients : undefined,
        isAvailable: editFormData.isAvailable,
        businessId: business.id,
        updatedAt: new Date()
      }

      if (editingProduct?.id === 'new') {
        // Crear nuevo producto
        const newProductId = await createProduct(productData)
        const newProduct = {
          ...productData,
          id: newProductId,
          createdAt: new Date()
        }
        onProductsChange([...products, newProduct])
        alert('Producto creado exitosamente')
      } else if (editingProduct) {
        // Actualizar producto existente
        await updateProduct(editingProduct.id, productData)
        onProductsChange(products.map(product => 
          product.id === editingProduct.id 
            ? { ...product, ...productData }
            : product
        ))
        alert('Producto actualizado exitosamente')
      }

      handleCloseEditModal()
    } catch (error) {
      console.error('Error al guardar el producto:', error)
      setEditErrors({ submit: 'Error al guardar el producto. Por favor, inténtalo de nuevo.' })
    } finally {
      setUploading(false)
    }
  }

  const handleCloseEditModal = () => {
    setShowEditModal(false)
    setEditingProduct(null)
    setEditFormData({
      name: '',
      description: '',
      price: '',
      category: '',
      isAvailable: true,
      image: null
    })
    setEditVariants([])
    setEditCurrentVariant({ name: '', description: '', price: '' })
    setEditIngredients([])
    setEditCurrentIngredient({ name: '', unitCost: '', quantity: '' })
    setVariantIngredients({})
    setEditingVariantIngredients(null)
    setEditErrors({})
    setShowNewCategoryForm(false)
    setNewCategory('')
    setActiveModalTab('general')
    // Limpiar estados del modal de ingredientes por variante
    closeVariantIngredientModal()
  }

  const handleEditInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setEditFormData(prev => ({ ...prev, [name]: value }))
    // Limpiar errores al escribir
    if (editErrors[name]) {
      setEditErrors(prev => ({ ...prev, [name]: '' }))
    }
  }

  const handleEditImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setEditFormData(prev => ({ ...prev, image: file }))
    }
  }

  const handleEditVariantChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target
    setEditCurrentVariant(prev => ({ ...prev, [name]: value }))
  }

  const addEditVariant = () => {
    if (!editCurrentVariant.name.trim()) {
      alert('El nombre de la variante es requerido')
      return
    }

    const price = editCurrentVariant.price ? Number(editCurrentVariant.price) : Number(editFormData.price)
    
    if (isNaN(price) || price <= 0) {
      alert('El precio debe ser un número válido mayor a 0')
      return
    }

    const newVariant: ProductVariant = {
      id: Date.now().toString(),
      name: editCurrentVariant.name,
      description: editCurrentVariant.description || '',
      price: price,
      isAvailable: true
    }

    setEditVariants(prev => [...prev, newVariant])
    setEditCurrentVariant({ name: '', description: '', price: '' })
  }

  const removeEditVariant = (variantId: string) => {
    setEditVariants(prev => prev.filter(v => v.id !== variantId))
    // También eliminar ingredientes de esa variante
    setVariantIngredients(prev => {
      const newIngredients = { ...prev }
      delete newIngredients[variantId]
      return newIngredients
    })
  }

  const moveVariantUp = (index: number) => {
    if (index === 0) return
    const newVariants = [...editVariants]
    const temp = newVariants[index]
    newVariants[index] = newVariants[index - 1]
    newVariants[index - 1] = temp
    setEditVariants(newVariants)
  }

  const moveVariantDown = (index: number) => {
    if (index === editVariants.length - 1) return
    const newVariants = [...editVariants]
    const temp = newVariants[index]
    newVariants[index] = newVariants[index + 1]
    newVariants[index + 1] = temp
    setEditVariants(newVariants)
  }

  const addNewEditCategory = async () => {
    if (!newCategory.trim() || !business?.id) {
      alert('El nombre de la categoría es requerido')
      return
    }

    try {
      await addCategoryToBusiness(business.id, newCategory.trim())
      onCategoriesChange([...businessCategories, newCategory.trim()])
      setEditFormData(prev => ({ ...prev, category: newCategory.trim() }))
      setShowNewCategoryForm(false)
      setNewCategory('')
    } catch (error) {
      alert('Error al agregar la categoría')
    }
  }

  // Funciones para manejar ingredientes
  const handleIngredientChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setEditCurrentIngredient(prev => ({ ...prev, [name]: value }))
    
    // Mostrar sugerencias al escribir el nombre
    if (name === 'name') {
      setIngredientSearchTerm(value)
      setShowIngredientSuggestions(value.trim().length > 0)
    }
  }

  // Seleccionar ingrediente de la biblioteca (para formulario principal y modal)
  const selectIngredientFromLibrary = (ingredient: IngredientLibraryItem, isModal = false) => {
    const ingredientData = {
      name: ingredient.name,
      unitCost: ingredient.unitCost.toString(),
      quantity: '1'
    }

    if (isModal) {
      setModalIngredient(ingredientData)
    } else {
      setEditCurrentIngredient(ingredientData)
    }

    setShowIngredientSuggestions(false)
    setIngredientSearchTerm('')
  }

  // Filtrar ingredientes de la biblioteca
  const getFilteredIngredients = () => {
    if (!ingredientSearchTerm.trim()) return ingredientLibrary
    
    const searchLower = ingredientSearchTerm.toLowerCase()
    return ingredientLibrary.filter(ing => 
      ing.name.toLowerCase().includes(searchLower)
    )
  }

  const addIngredient = async () => {
    if (!editCurrentIngredient.name.trim()) {
      alert('El nombre del ingrediente es requerido')
      return
    }

    const unitCost = editCurrentIngredient.unitCost ? Number(editCurrentIngredient.unitCost) : 0
    const quantity = editCurrentIngredient.quantity ? Number(editCurrentIngredient.quantity) : 1
    
    if (isNaN(unitCost) || unitCost < 0) {
      alert('El costo unitario debe ser un número válido mayor o igual a 0')
      return
    }

    if (isNaN(quantity) || quantity <= 0) {
      alert('La cantidad debe ser un número válido mayor a 0')
      return
    }

    const newIngredient = {
      id: Date.now().toString(),
      name: editCurrentIngredient.name.trim(),
      unitCost: unitCost,
      quantity: quantity
    }

    setEditIngredients(prev => [...prev, newIngredient])
    setEditCurrentIngredient({ name: '', unitCost: '', quantity: '' })
    setShowIngredientSuggestions(false)
    setIngredientSearchTerm('')
    
    // Guardar en la biblioteca
    if (business?.id) {
      await addOrUpdateIngredientInLibrary(business.id, newIngredient.name, unitCost)
      // Recargar biblioteca
      const library = await getIngredientLibrary(business.id)
      setIngredientLibrary(library)
    }
  }

  const removeIngredient = (ingredientId: string) => {
    setEditIngredients(prev => prev.filter(i => i.id !== ingredientId))
  }

  // Calcular costo total de ingredientes
  const calculateTotalIngredientCost = () => {
    return editIngredients.reduce((sum, ingredient) => 
      sum + (ingredient.unitCost * ingredient.quantity), 0
    )
  }

  // Funciones para manejar ingredientes de variantes
  const addIngredientToVariant = async (variantId: string) => {
    if (!editCurrentIngredient.name.trim()) {
      alert('El nombre del ingrediente es requerido')
      return
    }

    const unitCost = editCurrentIngredient.unitCost ? Number(editCurrentIngredient.unitCost) : 0
    const quantity = editCurrentIngredient.quantity ? Number(editCurrentIngredient.quantity) : 1
    
    if (isNaN(unitCost) || unitCost < 0) {
      alert('El costo unitario debe ser un número válido mayor o igual a 0')
      return
    }

    if (isNaN(quantity) || quantity <= 0) {
      alert('La cantidad debe ser un número válido mayor a 0')
      return
    }

    const newIngredient = {
      id: Date.now().toString(),
      name: editCurrentIngredient.name.trim(),
      unitCost: unitCost,
      quantity: quantity
    }

    setVariantIngredients(prev => ({
      ...prev,
      [variantId]: [...(prev[variantId] || []), newIngredient]
    }))
    setEditCurrentIngredient({ name: '', unitCost: '', quantity: '' })
    setShowIngredientSuggestions(false)
    setIngredientSearchTerm('')
    
    // Guardar en la biblioteca
    if (business?.id) {
      await addOrUpdateIngredientInLibrary(business.id, newIngredient.name, unitCost)
      // Recargar biblioteca
      const library = await getIngredientLibrary(business.id)
      setIngredientLibrary(library)
    }
  }

  const removeIngredientFromVariant = (variantId: string, ingredientId: string) => {
    setVariantIngredients(prev => ({
      ...prev,
      [variantId]: (prev[variantId] || []).filter(i => i.id !== ingredientId)
    }))
  }

  const calculateVariantIngredientCost = (variantId: string) => {
    const ingredients = variantIngredients[variantId] || []
    return ingredients.reduce((sum, ingredient) => 
      sum + (ingredient.unitCost * ingredient.quantity), 0
    )
  }

  // Funciones para modal de ingredientes por variante
  const openVariantIngredientModal = (variantId: string) => {
    setCurrentVariantForIngredient(variantId)
    setModalIngredient({ name: '', unitCost: '', quantity: '' })
    setShowVariantIngredientModal(true)
  }

  const closeVariantIngredientModal = () => {
    setShowVariantIngredientModal(false)
    setCurrentVariantForIngredient(null)
    setModalIngredient({ name: '', unitCost: '', quantity: '' })
    setShowIngredientSuggestions(false)
    setIngredientSearchTerm('')
  }

  const handleModalIngredientChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setModalIngredient(prev => ({ ...prev, [name]: value }))

    // Mostrar sugerencias al escribir el nombre
    if (name === 'name') {
      setIngredientSearchTerm(value)
      setShowIngredientSuggestions(value.trim().length > 0)
    }
  }

  const addIngredientFromModal = async () => {
    if (!currentVariantForIngredient || !modalIngredient.name.trim()) {
      alert('El nombre del ingrediente es requerido')
      return
    }

    const unitCost = modalIngredient.unitCost ? Number(modalIngredient.unitCost) : 0
    const quantity = modalIngredient.quantity ? Number(modalIngredient.quantity) : 1

    if (isNaN(unitCost) || unitCost < 0) {
      alert('El costo unitario debe ser un número válido mayor o igual a 0')
      return
    }

    if (isNaN(quantity) || quantity <= 0) {
      alert('La cantidad debe ser un número válido mayor a 0')
      return
    }

    const newIngredient = {
      id: Date.now().toString(),
      name: modalIngredient.name.trim(),
      unitCost: unitCost,
      quantity: quantity
    }

    setVariantIngredients(prev => ({
      ...prev,
      [currentVariantForIngredient]: [...(prev[currentVariantForIngredient] || []), newIngredient]
    }))

    closeVariantIngredientModal()

    // Guardar en la biblioteca
    if (business?.id) {
      await addOrUpdateIngredientInLibrary(business.id, newIngredient.name, unitCost)
      // Recargar biblioteca
      const library = await getIngredientLibrary(business.id)
      setIngredientLibrary(library)
    }
  }

  // Mover categoría hacia arriba
  const moveCategoryUp = async (category: string) => {
    const index = businessCategories.indexOf(category)
    if (index <= 0) return
    
    const newCategories = [...businessCategories]
    ;[newCategories[index - 1], newCategories[index]] = [newCategories[index], newCategories[index - 1]]
    
    // Actualizar el estado local
    onCategoriesChange(newCategories)
    
    // Guardar en la base de datos
    if (business) {
      try {
        await updateBusiness(business.id, { categories: newCategories })
      } catch (error) {
        console.error('Error al actualizar el orden de las categorías:', error)
        // Revertir el cambio si hay un error
        onCategoriesChange([...businessCategories])
      }
    }
  }

  // Mover categoría hacia abajo
  const moveCategoryDown = async (category: string) => {
    const index = businessCategories.indexOf(category)
    if (index === -1 || index >= businessCategories.length - 1) return
    
    const newCategories = [...businessCategories]
    ;[newCategories[index], newCategories[index + 1]] = [newCategories[index + 1], newCategories[index]]
    
    // Actualizar el estado local
    onCategoriesChange(newCategories)
    
    // Guardar en la base de datos
    if (business) {
      try {
        await updateBusiness(business.id, { categories: newCategories })
      } catch (error) {
        console.error('Error al actualizar el orden de las categorías:', error)
        // Revertir el cambio si hay un error
        onCategoriesChange([...businessCategories])
      }
    }
  }

  // Agrupar productos por categoría
  const productsByCategory = businessCategories.reduce((acc, category) => {
    const categoryProducts = products.filter(p => p.category === category)
    if (categoryProducts.length > 0 || businessCategories.includes(category)) {
      acc[category] = categoryProducts
    }
    return acc
  }, {} as Record<string, Product[]>)
  
  // Añadir 'Sin categoría' si hay productos sin categoría
  const uncategorizedProducts = products.filter(p => !p.category || !businessCategories.includes(p.category))
  if (uncategorizedProducts.length > 0) {
    productsByCategory['Sin categoría'] = uncategorizedProducts
  }

  return (
    <>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 sm:mb-6">
          <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-3 sm:mb-0">
            <i className="bi bi-box-seam me-2"></i>Productos
          </h2>
          <button
            onClick={() => {
              setEditingProduct({
                id: 'new',
                businessId: business?.id || '',
                name: '',
                description: '',
                price: 0,
                category: businessCategories[0] || '',
                image: '',
                isAvailable: true,
                variants: [],
                createdAt: new Date(),
                updatedAt: new Date()
              })
              setEditFormData({
                name: '',
                description: '',
                price: '',
                category: businessCategories[0] || '',
                isAvailable: true,
                image: null
              })
              setEditVariants([])
              setEditIngredients([])
              setVariantIngredients({})
              setShowEditModal(true)
            }}
            className="flex items-center px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors"
          >
            <i className="bi bi-plus-lg me-2"></i>
            Nuevo Producto
          </button>
        </div>

        {/* Lista de productos agrupados por categoría */}
        <div className="space-y-6">
          {Object.entries(productsByCategory).map(([category, categoryProducts]) => (
            <div key={category} className="bg-white rounded-lg shadow-md overflow-hidden">
              <div className="px-4 sm:px-6 py-3 bg-gray-50 border-b border-gray-200 flex justify-between items-center">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">{category}</h3>
                  <p className="text-sm text-gray-500">{categoryProducts.length} producto{categoryProducts.length !== 1 ? 's' : ''}</p>
                </div>
                {category !== 'Sin categoría' && (
                  <div className="flex space-x-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        moveCategoryUp(category)
                      }}
                      className="p-1 text-gray-500 hover:bg-gray-200 rounded-full disabled:opacity-50"
                      disabled={businessCategories.indexOf(category) === 0}
                      title="Mover categoría hacia arriba"
                    >
                      <i className="bi bi-arrow-up"></i>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        moveCategoryDown(category)
                      }}
                      className="p-1 text-gray-500 hover:bg-gray-200 rounded-full disabled:opacity-50"
                      disabled={businessCategories.indexOf(category) === businessCategories.length - 1}
                      title="Mover categoría hacia abajo"
                    >
                      <i className="bi bi-arrow-down"></i>
                    </button>
                  </div>
                )}
              </div>
              
              <div className="divide-y divide-gray-200">
                {categoryProducts.map((product) => (
                  <div key={product.id} className="px-4 sm:px-6 py-4 hover:bg-gray-50 transition-colors">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between">
                      <div className="flex items-start space-x-4 mb-3 sm:mb-0 w-full sm:w-auto">
                        {/* Imagen del producto */}
                        <div className="w-16 h-16 flex-shrink-0 flex items-center justify-center bg-gray-200 rounded-lg">
                          {product.image ? (
                            <img 
                              src={product.image} 
                              alt={product.name}
                              className="w-full h-full object-cover rounded-lg"
                            />
                          ) : (
                            <i className="bi bi-box-seam text-2xl text-gray-500"></i>
                          )}
                        </div>
                        
                        {/* Información del producto */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="text-base sm:text-lg font-semibold text-gray-900">
                              {product.name}
                            </h4>
                            {!product.isAvailable && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
                                Oculto
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-gray-600 mt-1 line-clamp-2">
                            {product.description}
                          </p>
                          <div className="mt-2">
                            <div className="flex items-center">
                              <span className="text-lg font-bold text-green-600">
                                ${product.price.toFixed(2)}
                              </span>
                            </div>
                            {product.variants && product.variants.length > 0 && (
                              <div className="mt-2 space-y-1">
                                {product.variants.map((variant) => (
                                  <div key={variant.id} className="flex items-center text-sm text-gray-600">
                                    <span className="font-medium">{variant.name}:</span>
                                    <span className="ml-2">${variant.price.toFixed(2)}</span>
                                    {variant.description && (
                                      <span className="ml-2 text-gray-500 text-xs">
                                        ({variant.description})
                                      </span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Botones de acción */}
                      <div className="flex items-center space-x-2 w-full sm:w-auto justify-end">
                        {/* Botón Editar */}
                        <button
                          onClick={() => handleEditProduct(product)}
                          className="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                          title="Editar producto"
                        >
                          <i className="bi bi-pencil text-lg"></i>
                        </button>
                        
                        {/* Botón Ocultar/Mostrar */}
                        <button
                          onClick={() => handleToggleAvailability(product.id, product.isAvailable)}
                          className={`p-1.5 rounded transition-colors ${
                            product.isAvailable
                              ? 'text-orange-600 hover:bg-orange-50'
                              : 'text-green-600 hover:bg-green-50'
                          }`}
                          title={product.isAvailable ? 'Ocultar producto' : 'Mostrar producto'}
                        >
                          <i className={`bi ${product.isAvailable ? 'bi-eye-slash' : 'bi-eye'} text-lg`}></i>
                        </button>
                        
                        {/* Botón Eliminar */}
                        <button
                          onClick={() => handleDeleteProduct(product.id)}
                          className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-colors"
                          title="Eliminar producto"
                        >
                          <i className="bi bi-trash text-lg"></i>
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {products.length === 0 && (
          <div className="bg-white rounded-lg shadow-md p-8 text-center">
            <i className="bi bi-box-seam text-gray-400 text-5xl mb-4"></i>
            <p className="text-gray-500 text-lg">No hay productos registrados</p>
            <p className="text-sm text-gray-400 mt-2">
              Los productos se agregan desde la aplicación móvil
            </p>
          </div>
        )}
      </div>

      {/* Modal de Edición de Producto */}
      {showEditModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-semibold text-gray-900">
                  <i className={`bi ${editingProduct?.id === 'new' ? 'bi-plus-lg' : 'bi-pencil'} me-2`}></i>
                  {editingProduct?.id === 'new' ? 'Crear Producto' : 'Editar Producto'}
                </h3>
                <button
                  onClick={handleCloseEditModal}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <i className="bi bi-x-lg"></i>
                </button>
              </div>

              {/* Pestañas */}
              <div className="border-b border-gray-200 mb-6">
                <nav className="-mb-px flex space-x-8">
                  <button
                    type="button"
                    onClick={() => setActiveModalTab('general')}
                    className={`py-2 px-1 border-b-2 font-medium text-sm transition-colors ${
                      activeModalTab === 'general'
                        ? 'border-red-500 text-red-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    <i className="bi bi-info-circle me-2"></i>
                    Información General
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveModalTab('ingredients')}
                    className={`py-2 px-1 border-b-2 font-medium text-sm transition-colors ${
                      activeModalTab === 'ingredients'
                        ? 'border-red-500 text-red-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    <i className="bi bi-basket me-2"></i>
                    Ingredientes y Costos
                    {editIngredients.length > 0 && (
                      <span className="ml-2 bg-red-100 text-red-800 px-2 py-0.5 rounded-full text-xs">
                        {editIngredients.length}
                      </span>
                    )}
                  </button>
                </nav>
              </div>

              <form onSubmit={handleUpdateProduct} className="space-y-6">
                {/* Pestaña: Información General */}
                {activeModalTab === 'general' && (
                  <>
                    {/* Nombre del producto */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Nombre del Producto *
                  </label>
                  <input
                    type="text"
                    name="name"
                    value={editFormData.name}
                    onChange={handleEditInputChange}
                    className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-red-500 ${
                      editErrors.name ? 'border-red-500' : 'border-gray-300'
                    }`}
                    placeholder="Ej: Hamburguesa Clásica"
                    required
                  />
                  {editErrors.name && <p className="text-red-500 text-sm mt-1">{editErrors.name}</p>}
                </div>

                {/* Descripción */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Descripción *
                  </label>
                  <textarea
                    name="description"
                    rows={3}
                    value={editFormData.description}
                    onChange={handleEditInputChange}
                    className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-red-500 ${
                      editErrors.description ? 'border-red-500' : 'border-gray-300'
                    }`}
                    placeholder="Describe tu producto..."
                    required
                  />
                  {editErrors.description && <p className="text-red-500 text-sm mt-1">{editErrors.description}</p>}
                </div>

                {/* Precio */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Precio Base *
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-2 text-gray-500">$</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      name="price"
                      value={editFormData.price}
                      onChange={handleEditInputChange}
                      onWheel={(e) => (e.target as HTMLInputElement).blur()}
                      className={`w-full pl-8 pr-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-red-500 ${
                        editErrors.price ? 'border-red-500' : 'border-gray-300'
                      }`}
                      placeholder="0.00"
                      required
                    />
                  </div>
                  {editErrors.price && <p className="text-red-500 text-sm mt-1">{editErrors.price}</p>}
                </div>

                {/* Categoría */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Categoría *
                  </label>
                  
                  {!showNewCategoryForm ? (
                    <div className="space-y-2">
                      <select
                        name="category"
                        value={editFormData.category}
                        onChange={handleEditInputChange}
                        className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-red-500 ${
                          editErrors.category ? 'border-red-500' : 'border-gray-300'
                        }`}
                        required
                      >
                        <option value="">Selecciona una categoría</option>
                        {businessCategories.map((cat) => (
                          <option key={cat} value={cat}>{cat}</option>
                        ))}
                      </select>
                      
                      <button
                        type="button"
                        onClick={() => setShowNewCategoryForm(true)}
                        className="text-sm text-red-600 hover:text-red-700"
                      >
                        + Agregar nueva categoría
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3 p-4 border border-gray-200 rounded-md bg-gray-50">
                      <h4 className="font-medium text-gray-900">Nueva Categoría</h4>
                      <input
                        type="text"
                        value={newCategory}
                        onChange={(e) => setNewCategory(e.target.value)}
                        placeholder="Nombre de la categoría"
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                      />
                      <div className="flex space-x-2">
                        <button
                          type="button"
                          onClick={addNewEditCategory}
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
                  {editErrors.category && <p className="text-red-500 text-sm mt-1">{editErrors.category}</p>}
                </div>

                  {/* Imagen */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Imagen del Producto
                    </label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleEditImageChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                    />
                    {editingProduct?.image && (
                      <div className="mt-2">
                        <img 
                          src={editingProduct.image} 
                          alt="Imagen actual" 
                          className="w-16 h-16 object-cover rounded-md"
                        />
                        <p className="text-xs text-gray-500 mt-1">Imagen actual</p>
                      </div>
                    )}
                  </div>

                  {/* Variantes */}
                  <div>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-medium text-gray-900">Variantes del Producto</h3>
                    <span className="text-sm text-gray-500">Opcional</span>
                  </div>
                  
                  {/* Lista de variantes */}
                  {editVariants.length > 0 && (
                    <div className="mb-4">
                      <h4 className="font-medium text-gray-900 mb-3">Variantes agregadas:</h4>
                      <div className="space-y-2">
                        {editVariants.map((variant, index) => (
                          <div key={variant.id} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                            <div className="flex items-center h-8 px-1">
                              {/* Botones de orden */}
                              <div className="flex items-center space-x-0.5 mr-1">
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); moveVariantUp(index); }}
                                  disabled={index === 0}
                                  className={`p-0.5 h-5 w-5 flex items-center justify-center rounded ${index === 0 ? 'text-gray-300 cursor-not-allowed' : 'text-gray-600 hover:bg-gray-100'}`}
                                  title="Subir"
                                >
                                  <i className="bi bi-chevron-up text-xs"></i>
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); moveVariantDown(index); }}
                                  disabled={index === editVariants.length - 1}
                                  className={`p-0.5 h-5 w-5 flex items-center justify-center rounded ${index === editVariants.length - 1 ? 'text-gray-300 cursor-not-allowed' : 'text-gray-600 hover:bg-gray-100'}`}
                                  title="Bajar"
                                >
                                  <i className="bi bi-chevron-down text-xs"></i>
                                </button>
                              </div>

                              {/* Información de la variante */}
                              <div className="flex-1">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-medium text-xs text-gray-900">{variant.name}</span>
                                  <span className="text-green-600 text-xs font-medium">${variant.price.toFixed(2)}</span>
                                  {variant.description && (
                                    <span className="text-gray-500 text-[11px] truncate max-w-[130px]">- {variant.description}</span>
                                  )}
                                </div>
                              </div>

                              {/* Botón de eliminar variante */}
                              <div className="flex items-center">
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); removeEditVariant(variant.id); }}
                                  className="text-red-600 hover:text-red-700 p-0.5"
                                  title="Eliminar variante"
                                >
                                  <i className="bi bi-trash text-xs"></i>
                                </button>
                              </div>
                            </div>

                            {/* Panel de ingredientes de la variante */}
                            {editingVariantIngredients === variant.id && (
                              <div className="border-t border-gray-200 bg-gray-50 p-2">
                                <h5 className="font-medium text-gray-900 mb-3">
                                  Ingredientes de "{variant.name}"
                                </h5>

                                {/* Lista de ingredientes de esta variante */}
                                {variantIngredients[variant.id] && variantIngredients[variant.id].length > 0 && (
                                  <div className="space-y-2 mb-3">
                                    {variantIngredients[variant.id].map((ingredient) => (
                                      <div key={ingredient.id} className="flex justify-between items-center bg-white border border-gray-200 rounded p-2">
                                        <div className="flex items-center gap-3">
                                          <span className="text-sm font-medium text-gray-900">{ingredient.name}</span>
                                          <span className="text-xs text-gray-600">
                                            {ingredient.quantity} x ${ingredient.unitCost.toFixed(2)}
                                          </span>
                                          <span className="text-sm text-emerald-600 font-medium">
                                            = ${(ingredient.quantity * ingredient.unitCost).toFixed(2)}
                                          </span>
                                        </div>
                                        <button
                                          type="button"
                                          onClick={() => removeIngredientFromVariant(variant.id, ingredient.id)}
                                          className="text-red-600 hover:text-red-700 p-1"
                                        >
                                          <i className="bi bi-x-lg text-xs"></i>
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                )}

                                {/* Formulario para agregar ingrediente a esta variante */}
                                <div className="space-y-2">
                                  <div className="relative ingredient-input-container">
                                    <input
                                      type="text"
                                      name="name"
                                      value={editCurrentIngredient.name}
                                      onChange={handleIngredientChange}
                                      onFocus={() => setShowIngredientSuggestions(true)}
                                      className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-emerald-500"
                                      placeholder="Nombre del ingrediente (escribe para buscar)"
                                      autoComplete="off"
                                    />
                                    
                                    {/* Sugerencias de ingredientes */}
                                    {showIngredientSuggestions && getFilteredIngredients().length > 0 && (
                                      <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-48 overflow-y-auto">
                                        {getFilteredIngredients().map((ingredient) => (
                                          <button
                                            key={ingredient.id}
                                            type="button"
                                            onClick={() => selectIngredientFromLibrary(ingredient)}
                                            className="w-full text-left px-3 py-2 hover:bg-emerald-50 border-b border-gray-100 last:border-b-0"
                                          >
                                            <div className="flex items-center justify-between">
                                              <span className="text-sm font-medium text-gray-900">{ingredient.name}</span>
                                              <span className="text-xs text-emerald-600 font-medium">${ingredient.unitCost.toFixed(2)}</span>
                                            </div>
                                            <div className="text-xs text-gray-500 mt-0.5">
                                              Usado {ingredient.usageCount} {ingredient.usageCount === 1 ? 'vez' : 'veces'}
                                            </div>
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                  <div className="grid grid-cols-2 gap-2">
                                    <input
                                      type="number"
                                      step="0.01"
                                      min="0"
                                      name="unitCost"
                                      value={editCurrentIngredient.unitCost}
                                      onChange={handleIngredientChange}
                                      onWheel={(e) => (e.target as HTMLInputElement).blur()}
                                      className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-emerald-500"
                                      placeholder="Costo ($)"
                                    />
                                    <input
                                      type="number"
                                      step="0.01"
                                      min="0.01"
                                      name="quantity"
                                      value={editCurrentIngredient.quantity}
                                      onChange={handleIngredientChange}
                                      onWheel={(e) => (e.target as HTMLInputElement).blur()}
                                      className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-emerald-500"
                                      placeholder="Cantidad"
                                    />
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => addIngredientToVariant(variant.id)}
                                    className="w-full bg-emerald-600 text-white px-3 py-1.5 text-sm rounded hover:bg-emerald-700 transition-colors"
                                  >
                                    <i className="bi bi-plus-lg me-1"></i>
                                    Agregar Ingrediente
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="bg-gray-50 p-4 rounded-md">
                    <h4 className="font-medium text-gray-900 mb-3">Agregar Nueva Variante</h4>
                    
                    <div className="space-y-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Nombre de la variante *
                        </label>
                        <input
                          type="text"
                          name="name"
                          value={editCurrentVariant.name}
                          onChange={handleEditVariantChange}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                          placeholder="Ej: Tamaño grande, Con queso extra"
                        />
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Descripción (opcional)
                        </label>
                        <input
                          type="text"
                          name="description"
                          value={editCurrentVariant.description}
                          onChange={handleEditVariantChange}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                          placeholder="Ej: Con salsa especial"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Precio ($ - opcional)
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          name="price"
                          value={editCurrentVariant.price}
                          onChange={handleEditVariantChange}
                          onWheel={(e) => (e.target as HTMLInputElement).blur()}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                          placeholder="Dejalo vacío para usar precio base"
                        />
                      </div>
                      
                      <button
                        type="button"
                        onClick={addEditVariant}
                        className="w-full bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors"
                      >
                        <i className="bi bi-plus-lg me-2"></i>
                        Agregar Variante
                      </button>
                    </div>
                  </div>
                </div>

                {/* Disponibilidad */}
                <div>
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      checked={editFormData.isAvailable}
                      onChange={(e) => setEditFormData(prev => ({ ...prev, isAvailable: e.target.checked }))}
                      className="rounded border-gray-300 text-red-600 focus:ring-red-500"
                    />
                    <span className="ml-2 text-sm text-gray-700">Producto disponible</span>
                  </label>
                </div>
                  </>
                )}

                {/* Pestaña: Ingredientes y Costos */}
                {activeModalTab === 'ingredients' && (
                  <div className="space-y-6">
                    {/* Sección de ingredientes principales - Solo visible cuando no hay variantes */}
                    {editVariants.length === 0 && (
                      <div className="bg-white p-4 rounded-lg border border-gray-200">
                        <div className="flex items-center justify-between mb-4">
                          <div>
                            <h3 className="text-lg font-medium text-gray-900">Ingredientes del Producto</h3>
                            <p className="text-sm text-gray-500 mt-1">Ingredientes base que aplican a todas las variantes</p>
                          </div>
                          {editIngredients.length > 0 && (
                            <div className="text-right">
                              <p className="text-sm text-gray-500">Costo Total:</p>
                              <p className="text-xl font-bold text-emerald-600">
                                ${calculateTotalIngredientCost().toFixed(2)}
                              </p>
                              {editFormData.price && (
                                <p className="text-xs text-gray-500 mt-1">
                                  Margen: ${(Number(editFormData.price) - calculateTotalIngredientCost()).toFixed(2)}
                                  {' '}({((Number(editFormData.price) - calculateTotalIngredientCost()) / Number(editFormData.price) * 100).toFixed(1)}%)
                                </p>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Lista de ingredientes */}
                        {editIngredients.length > 0 && (
                          <div className="mb-4">
                            <h4 className="font-medium text-gray-900 mb-3">Ingredientes agregados:</h4>
                            <div className="space-y-2">
                              {editIngredients.map((ingredient) => (
                                <div key={ingredient.id} className="flex justify-between items-center bg-white border border-gray-200 rounded-lg p-3">
                                  <div className="flex-1">
                                    <div className="flex items-center gap-4">
                                      <span className="font-medium text-gray-900">{ingredient.name}</span>
                                      <span className="text-gray-600 text-sm">
                                        {ingredient.quantity} x ${ingredient.unitCost.toFixed(2)}
                                      </span>
                                      <span className="text-emerald-600 font-medium">
                                        = ${(ingredient.quantity * ingredient.unitCost).toFixed(2)}
                                      </span>
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => removeIngredient(ingredient.id)}
                                    className="text-red-600 hover:text-red-700 p-1"
                                  >
                                    <i className="bi bi-trash"></i>
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Formulario para agregar ingrediente */}
                        <div className="bg-gray-50 p-4 rounded-md">
                          <h4 className="font-medium text-gray-900 mb-3">Agregar Nuevo Ingrediente</h4>

                          <div className="space-y-3">
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-1">
                                Nombre del Ingrediente *
                              </label>
                              <div className="relative ingredient-input-container">
                                <input
                                  type="text"
                                  name="name"
                                  value={editCurrentIngredient.name}
                                  onChange={handleIngredientChange}
                                  onFocus={() => setShowIngredientSuggestions(true)}
                                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                                  placeholder="Ej: Pan, Carne, Mayonesa (escribe para buscar)"
                                  autoComplete="off"
                                />

                                {/* Sugerencias de ingredientes */}
                                {showIngredientSuggestions && getFilteredIngredients().length > 0 && (
                                  <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                                    {getFilteredIngredients().map((ingredient) => (
                                      <button
                                        key={ingredient.id}
                                        type="button"
                                        onClick={() => selectIngredientFromLibrary(ingredient)}
                                        className="w-full text-left px-4 py-3 hover:bg-emerald-50 border-b border-gray-100 last:border-b-0 transition-colors"
                                      >
                                        <div className="flex items-center justify-between">
                                          <span className="text-sm font-medium text-gray-900">{ingredient.name}</span>
                                          <span className="text-sm text-emerald-600 font-bold">${ingredient.unitCost.toFixed(2)}</span>
                                        </div>
                                        <div className="text-xs text-gray-500 mt-1">
                                          <i className="bi bi-clock-history me-1"></i>
                                          Usado {ingredient.usageCount} {ingredient.usageCount === 1 ? 'vez' : 'veces'}
                                        </div>
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                  Costo Unitario ($) *
                                </label>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  name="unitCost"
                                  value={editCurrentIngredient.unitCost}
                                  onChange={handleIngredientChange}
                                  onWheel={(e) => (e.target as HTMLInputElement).blur()}
                                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                                  placeholder="0.00"
                                />
                              </div>

                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                  Cantidad *
                                </label>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0.01"
                                  name="quantity"
                                  value={editCurrentIngredient.quantity}
                                  onChange={handleIngredientChange}
                                  onWheel={(e) => (e.target as HTMLInputElement).blur()}
                                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                                  placeholder="1"
                                />
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={addIngredient}
                              className="w-full bg-emerald-600 text-white px-4 py-2 rounded-md hover:bg-emerald-700 transition-colors"
                            >
                              <i className="bi bi-plus-lg me-2"></i>
                              Agregar Ingrediente
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Sección de variantes */}
                    {editVariants.length > 0 && (
                      <div className="mt-8 bg-white p-4 rounded-lg border border-gray-200">
                        <h3 className="text-lg font-medium text-gray-900 mb-4">Ingredientes por Variante</h3>
                        <p className="text-sm text-gray-500 mb-4">
                          Gestiona los ingredientes específicos para cada variante
                        </p>
                        
                        <div className="space-y-6">
                          {editVariants.map((variant) => (
                            <div key={variant.id} className="border border-gray-200 rounded-lg overflow-hidden">
                              <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 flex items-center justify-between">
                                <div>
                                  <h4 className="font-medium text-gray-900">
                                    {variant.name}
                                    {variant.price && (
                                      <span className="ml-2 text-sm font-normal text-gray-500">
                                        (${Number(variant.price).toFixed(2)})
                                      </span>
                                    )}
                                  </h4>
                                  {variant.description && (
                                    <p className="text-sm text-gray-500 mt-1">{variant.description}</p>
                                  )}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => openVariantIngredientModal(variant.id)}
                                  className="btn btn-sm btn-link text-gray-500 hover:text-emerald-600 p-0 d-flex align-items-center justify-content-center"
                                  title="Agregar ingrediente"
                                  style={{ width: '24px', height: '24px' }}
                                >
                                  <i className="bi bi-plus-circle fs-5"></i>
                                </button>
                              </div>
                              
                              <div className="px-3 py-2">
                                {/* Lista de ingredientes de la variante */}
                                {variantIngredients[variant.id]?.length > 0 ? (
                                  <div className="space-y-1.5">
                                    {variantIngredients[variant.id].map((ingredient, idx) => (
                                      <div key={`${variant.id}-${ingredient.id}-${idx}`} className="flex justify-between items-center bg-gray-50 px-2.5 py-1.5 rounded text-sm">
                                        <div className="flex-1">
                                          <p className="font-medium text-gray-900 truncate">{ingredient.name}</p>
                                          <p className="text-xs text-gray-500">
                                            {ingredient.quantity} × ${ingredient.unitCost.toFixed(2)} = ${(ingredient.quantity * ingredient.unitCost).toFixed(2)}
                                          </p>
                                        </div>
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            removeIngredientFromVariant(variant.id, ingredient.id);
                                          }}
                                          className="text-red-500 hover:text-red-700 p-1 text-sm"
                                          title="Eliminar ingrediente"
                                        >
                                          <i className="bi bi-x-lg"></i>
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="text-center py-2 text-xs text-gray-400">
                                    Sin ingredientes específicos
                                  </div>
                                )}
                                
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Errores */}
                {editErrors.submit && (
                  <div className="bg-red-50 border border-red-200 rounded-md p-3">
                    <p className="text-red-600 text-sm">{editErrors.submit}</p>
                  </div>
                )}

                {/* Botones */}
                <div className="flex space-x-3 pt-4">
                  <button
                    type="submit"
                    disabled={uploading}
                    className="flex-1 bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
                  >
                    {uploading ? (
                      <>
                        <i className="bi bi-arrow-clockwise animate-spin me-2"></i>
                        Guardando...
                      </>
                    ) : (
                      <>
                        <i className="bi bi-check-lg me-2"></i>
                        Guardar Cambios
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={handleCloseEditModal}
                    disabled={uploading}
                    className="flex-1 bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 disabled:opacity-50 transition-colors"
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Ingredientes por Variante */}
      {showVariantIngredientModal && currentVariantForIngredient && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 modal-overlay">
          <div className="bg-white rounded-lg max-w-md w-full modal-content">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-semibold text-gray-900">
                  <i className="bi bi-basket me-2"></i>
                  Agregar Ingrediente a Variante
                </h3>
                <button
                  onClick={closeVariantIngredientModal}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <i className="bi bi-x-lg"></i>
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Nombre del Ingrediente *
                  </label>
                  <div className="relative ingredient-input-container">
                    <input
                      type="text"
                      name="name"
                      value={modalIngredient.name}
                      onChange={handleModalIngredientChange}
                      onFocus={() => setShowIngredientSuggestions(true)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      placeholder="Buscar o agregar ingrediente"
                      autoComplete="off"
                    />

                    {/* Sugerencias de ingredientes */}
                    {showIngredientSuggestions && getFilteredIngredients().length > 0 && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-48 overflow-y-auto">
                        {getFilteredIngredients().map((ingredient) => (
                          <button
                            key={ingredient.id}
                            type="button"
                            onClick={() => selectIngredientFromLibrary(ingredient, true)}
                            className="w-full text-left px-3 py-2 hover:bg-emerald-50 border-b border-gray-100 last:border-b-0 text-sm"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-medium text-gray-900">{ingredient.name}</span>
                              <span className="text-emerald-600 font-medium">${ingredient.unitCost.toFixed(2)}</span>
                            </div>
                            <div className="text-xs text-gray-500 mt-0.5">
                              Usado {ingredient.usageCount} {ingredient.usageCount === 1 ? 'vez' : 'veces'}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Costo Unitario ($) *
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      name="unitCost"
                      value={modalIngredient.unitCost}
                      onChange={handleModalIngredientChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      placeholder="0.00"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Cantidad *
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      name="quantity"
                      value={modalIngredient.quantity}
                      onChange={handleModalIngredientChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      placeholder="1"
                    />
                  </div>
                </div>

                <div className="flex space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={addIngredientFromModal}
                    className="flex-1 bg-emerald-600 text-white px-4 py-2 rounded-md hover:bg-emerald-700 transition-colors"
                  >
                    <i className="bi bi-check-lg me-2"></i>
                    Agregar Ingrediente
                  </button>
                  <button
                    type="button"
                    onClick={closeVariantIngredientModal}
                    className="flex-1 bg-gray-100 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-200 transition-colors"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
