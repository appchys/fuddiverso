'use client'

import React, { useState, useEffect } from 'react'
import { Business, Product, ProductVariant, Ingredient } from '@/types'
import { createProduct, updateProduct, deleteProduct, uploadImage, getIngredientLibrary, addOrUpdateIngredientInLibrary, IngredientLibraryItem } from '@/lib/database'
import { optimizeImage } from '@/lib/image-utils'

interface ProductListProps {
  business: Business | null
  products: Product[]
  categories: string[]
  onProductsChange: (products: Product[]) => void
  onCategoriesChange: (categories: string[]) => void
  onDirectUpdate?: (field: keyof Business, value: any) => Promise<void>
}

export default function ProductList({
  business,
  products,
  categories,
  onProductsChange,
  onCategoriesChange,
  onDirectUpdate
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
  const [editingVariantId, setEditingVariantId] = useState<string | null>(null)
  const [showVariantForm, setShowVariantForm] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [uploading, setUploading] = useState(false)
  const [newCategory, setNewCategory] = useState('')
  const [showNewCategory, setShowNewCategory] = useState(false)

  // Estados para ingredientes
  const [ingredients, setIngredients] = useState<Array<{
    id: string
    name: string
    unitCost: number
    quantity: number
  }>>([])
  const [currentIngredient, setCurrentIngredient] = useState({
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
  const [ingredientLibrary, setIngredientLibrary] = useState<IngredientLibraryItem[]>([])
  const [showIngredientSuggestions, setShowIngredientSuggestions] = useState(false)
  const [ingredientSearchTerm, setIngredientSearchTerm] = useState('')
  const [expandedVariantsForIngredients, setExpandedVariantsForIngredients] = useState<Set<string>>(new Set())
  const [activeTab, setActiveTab] = useState<'general' | 'ingredients'>('general')
  const [variantVisibility, setVariantVisibility] = useState<Record<string, boolean>>({})
  const [activeMenu, setActiveMenu] = useState<string | null>(null)
  const [activeVariantMenu, setActiveVariantMenu] = useState<string | null>(null)

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
    setIngredients([])
    setVariantIngredients({})
    setCurrentIngredient({ name: '', unitCost: '', quantity: '' })
    setErrors({})
    setActiveTab('general')
    setEditingVariantId(null)
    setShowVariantForm(false)
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
    setIngredients((product.ingredients || []) as any)

    // Cargar visibilidad de variantes
    const visibility: Record<string, boolean> = {}
    if (product.variants) {
      product.variants.forEach(variant => {
        visibility[variant.id] = variant.isAvailable !== false
      })
    }
    setVariantVisibility(visibility)

    // Cargar ingredientes por variante
    const variantIngs: Record<string, Ingredient[]> = {}
    if (product.variants) {
      product.variants.forEach(variant => {
        if (variant.ingredients) {
          variantIngs[variant.id] = variant.ingredients
        }
      })
    }
    setVariantIngredients(variantIngs as any)

    // Cargar biblioteca de ingredientes
    if (business?.id) {
      getIngredientLibrary(business.id).then(lib => setIngredientLibrary(lib))
    }

    setCurrentIngredient({ name: '', unitCost: '', quantity: '' })
    setErrors({})
    setActiveTab('general')
    setEditingVariantId(null)
    setShowVariantForm(false)
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
    setIngredients([])
    setVariantIngredients({})
    setCurrentIngredient({ name: '', unitCost: '', quantity: '' })
    setErrors({})
    setActiveTab('general')
    setEditingVariantId(null)
    setShowVariantForm(false)
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

  const handleEditVariant = (variant: ProductVariant) => {
    setCurrentVariant({
      name: variant.name,
      price: variant.price.toString()
    })
    setEditingVariantId(variant.id)
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

    if (editingVariantId) {
      setVariants(prev => prev.map(v =>
        v.id === editingVariantId
          ? { ...v, name: currentVariant.name, price: price }
          : v
      ))
      setEditingVariantId(null)
    } else {
      const newVariant: ProductVariant = {
        id: Date.now().toString(),
        name: currentVariant.name,
        description: '',
        price: price,
        isAvailable: true
      }

      setVariants(prev => [...prev, newVariant])
      setVariantVisibility(prev => ({ ...prev, [newVariant.id]: true }))
    }
    setCurrentVariant({ name: '', price: '' })
    setShowVariantForm(false)
  }

  const removeVariant = (variantId: string) => {
    setVariants(prev => prev.filter(v => v.id !== variantId))
    setVariantVisibility(prev => {
      const newVisibility = { ...prev }
      delete newVisibility[variantId]
      return newVisibility
    })
    if (editingVariantId === variantId) {
      setEditingVariantId(null)
      setCurrentVariant({ name: '', price: '' })
    }
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

  // Funciones para ingredientes
  const handleIngredientChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setCurrentIngredient(prev => ({ ...prev, [name]: value }))

    if (name === 'name') {
      setIngredientSearchTerm(value)
      setShowIngredientSuggestions(value.trim().length > 0)
    }
  }

  const getFilteredIngredients = () => {
    if (!ingredientSearchTerm.trim()) return ingredientLibrary
    const searchLower = ingredientSearchTerm.toLowerCase()
    return ingredientLibrary.filter(ing => ing.name.toLowerCase().includes(searchLower))
  }

  const selectIngredientFromLibrary = (ingredient: IngredientLibraryItem) => {
    setCurrentIngredient({
      name: ingredient.name,
      unitCost: ingredient.unitCost.toString(),
      quantity: '1'
    })
    setShowIngredientSuggestions(false)
    setIngredientSearchTerm('')
  }

  const addIngredient = async () => {
    if (!currentIngredient.name.trim()) {
      alert('El nombre del ingrediente es requerido')
      return
    }

    const unitCost = currentIngredient.unitCost ? Number(currentIngredient.unitCost) : 0
    const quantity = currentIngredient.quantity ? Number(currentIngredient.quantity) : 1

    if (isNaN(unitCost) || unitCost < 0 || isNaN(quantity) || quantity <= 0) {
      alert('Los valores deben ser válidos')
      return
    }

    const newIngredient = {
      id: Date.now().toString(),
      name: currentIngredient.name.trim(),
      unitCost: unitCost,
      quantity: quantity
    }

    const nextIngredients = [...ingredients, newIngredient]
    setIngredients(nextIngredients)
    setCurrentIngredient({ name: '', unitCost: '', quantity: '' })
    setShowIngredientSuggestions(false)
    setIngredientSearchTerm('')

    if (business?.id) {
      await addOrUpdateIngredientInLibrary(business.id, newIngredient.name, unitCost)
      const library = await getIngredientLibrary(business.id)
      setIngredientLibrary(library)
      // Autosincronizar si estamos editando un producto
      syncProductIngredients(nextIngredients)
    }
  }

  const removeIngredient = (ingredientId: string) => {
    const nextIngredients = ingredients.filter(i => i.id !== ingredientId)
    setIngredients(nextIngredients)
    syncProductIngredients(nextIngredients)
  }

  const addIngredientToVariant = async (variantId: string) => {
    if (!currentIngredient.name.trim()) {
      alert('El nombre del ingrediente es requerido')
      return
    }

    const unitCost = currentIngredient.unitCost ? Number(currentIngredient.unitCost) : 0
    const quantity = currentIngredient.quantity ? Number(currentIngredient.quantity) : 1

    if (isNaN(unitCost) || unitCost < 0 || isNaN(quantity) || quantity <= 0) {
      alert('Los valores deben ser válidos')
      return
    }

    const newIngredient = {
      id: Date.now().toString(),
      name: currentIngredient.name.trim(),
      unitCost: unitCost,
      quantity: quantity
    }

    const nextVariantIngredients = {
      ...variantIngredients,
      [variantId]: [...(variantIngredients[variantId] || []), newIngredient]
    }
    setVariantIngredients(nextVariantIngredients)
    setCurrentIngredient({ name: '', unitCost: '', quantity: '' })
    setShowIngredientSuggestions(false)
    setIngredientSearchTerm('')

    if (business?.id) {
      await addOrUpdateIngredientInLibrary(business.id, newIngredient.name, unitCost)
      const library = await getIngredientLibrary(business.id)
      setIngredientLibrary(library)
      // Autosincronizar si estamos editando un producto
      syncProductIngredients(undefined, nextVariantIngredients)
    }
  }

  const removeIngredientFromVariant = (variantId: string, ingredientId: string) => {
    const nextVariantIngredients = {
      ...variantIngredients,
      [variantId]: (variantIngredients[variantId] || []).filter(i => i.id !== ingredientId)
    }
    setVariantIngredients(nextVariantIngredients)
    syncProductIngredients(undefined, nextVariantIngredients)
  }

  const toggleVariantExpanded = (variantId: string) => {
    const isCurrentlyExpanded = expandedVariantsForIngredients.has(variantId)
    const newExpanded = new Set<string>()
    if (!isCurrentlyExpanded) {
      newExpanded.add(variantId)
      // Reset current ingredient form when opening a new variant
      setCurrentIngredient({ name: '', unitCost: '', quantity: '' })
      setIngredientSearchTerm('')
    }
    setExpandedVariantsForIngredients(newExpanded)
  }

  const calculateTotalIngredientCost = () => {
    return ingredients.reduce((sum, ingredient) => sum + (ingredient.unitCost * ingredient.quantity), 0)
  }

  const syncProductIngredients = async (updatedIngredients?: Ingredient[], updatedVariantIngredients?: Record<string, Ingredient[]>) => {
    if (!editingProduct?.id || !business?.id) return

    const ings = updatedIngredients || ingredients
    const vIngs = updatedVariantIngredients || variantIngredients

    const variantsWithIngredients = variants.map(variant => ({
      ...variant,
      ingredients: vIngs[variant.id] || []
    }))

    try {
      await updateProduct(editingProduct.id, {
        ingredients: ings,
        variants: variantsWithIngredients
      })
    } catch (error) {
      console.error('Error autosaving ingredients:', error)
    }
  }

  // Cerrar sugerencias al hacer clic fuera
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element
      if (showIngredientSuggestions && !target.closest('.ingredient-input-container')) {
        setShowIngredientSuggestions(false)
      }
      if (activeMenu && !target.closest('.product-action-menu')) {
        setActiveMenu(null)
      }
      if (activeVariantMenu && !target.closest('.variant-action-menu')) {
        setActiveVariantMenu(null)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showIngredientSuggestions, activeMenu, activeVariantMenu])

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
        const path = `products/${timestamp}_${formData.image.name.split('.')[0]}.jpg`

        // Optimizar imagen antes de subir (Max 1000px, 0.8 calidad, formato JPEG para compatibilidad OG)
        const optimizedBlob = await optimizeImage(formData.image, 1000, 0.8, 'image/jpeg')
        const optimizedFile = new File(
          [optimizedBlob],
          `${timestamp}_${formData.image.name.split('.')[0]}.jpg`,
          { type: optimizedBlob.type || 'image/jpeg' }
        )
        imageUrl = await uploadImage(optimizedFile, path)
      }

      // Agregar ingredientes a cada variante
      const variantsWithIngredients = variants.map(variant => ({
        ...variant,
        ingredients: variantIngredients[variant.id] || undefined,
        isAvailable: variantVisibility[variant.id] !== false
      }))

      const productData = {
        name: formData.name,
        description: formData.description,
        price: Number(formData.price),
        category: formData.category,
        image: imageUrl,
        variants: variants.length > 0 ? variantsWithIngredients : undefined,
        ingredients: ingredients.length > 0 ? ingredients : undefined,
        isAvailable: formData.isAvailable,
        businessId: business.id,
        updatedAt: new Date()
      }

      if (editingProduct) {
        const currentId = editingProduct.id;
        await updateProduct(currentId, productData);
        onProductsChange(products.map(p =>
          p.id === currentId ? ({ ...p, ...productData } as Product) : p
        ));
      } else {
        const newProductId = await createProduct(productData, business.username);
        const newProduct: Product = {
          ...productData,
          id: newProductId,
          createdAt: new Date(),
          businessId: business.id
        } as Product;
        onProductsChange([...products, newProduct]);
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

  const moveCategory = (index: number, direction: 'up' | 'down') => {
    const newCategories = [...categories]
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= categories.length) return

    const temp = newCategories[index]
    newCategories[index] = newCategories[targetIndex]
    newCategories[targetIndex] = temp

    // Update local state and persist silently
    onCategoriesChange(newCategories)
    if (onDirectUpdate) {
      onDirectUpdate('categories', newCategories)
    }
  }

  const moveProduct = async (product: Product, direction: 'up' | 'down') => {
    const categoryProducts = products
      .filter(p => p.category === product.category)
      .sort((a, b) => (a.order || 0) - (b.order || 0))

    const index = categoryProducts.findIndex(p => p.id === product.id)
    const targetIndex = direction === 'up' ? index - 1 : index + 1

    if (targetIndex < 0 || targetIndex >= categoryProducts.length) return

    const targetProduct = categoryProducts[targetIndex]

    // Ensure both have an order. Use pIndex as fallback.
    const currentPos = products.findIndex(p => p.id === product.id)
    const targetPos = products.findIndex(p => p.id === targetProduct.id)

    const currentOrder = product.order ?? currentPos
    const targetOrder = targetProduct.order ?? targetPos

    let newCurrentOrder = targetOrder
    let newTargetOrder = currentOrder

    if (newCurrentOrder === newTargetOrder) {
      newCurrentOrder = targetIndex
      newTargetOrder = index
    }

    try {
      await updateProduct(product.id, { order: newCurrentOrder })
      await updateProduct(targetProduct.id, { order: newTargetOrder })

      onProductsChange(products.map(p => {
        if (p.id === product.id) return { ...p, order: newCurrentOrder }
        if (p.id === targetProduct.id) return { ...p, order: newTargetOrder }
        return p
      }))
    } catch (error) {
      console.error('Error moving product:', error)
    }
  }

  const moveVariant = (index: number, direction: 'up' | 'down') => {
    const newVariants = [...variants]
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= variants.length) return

    const temp = newVariants[index]
    newVariants[index] = newVariants[targetIndex]
    newVariants[targetIndex] = temp
    setVariants(newVariants)
  }

  return (
    <div className="space-y-6">
      {/* Botón para agregar producto */}
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold text-gray-900">Productos</h2>
        {/* El botón de Nuevo Producto ahora es flotante al final del div principal */}
      </div>

      {/* Lista de productos agrupada por categoría */}
      {products.length === 0 ? (
        <div className="bg-gray-50 rounded-lg border border-gray-200 p-8 text-center">
          <i className="bi bi-box-seam text-4xl text-gray-300 mb-3 block"></i>
          <p className="text-gray-600 font-medium">No hay productos</p>
          <p className="text-sm text-gray-500 mt-1">Crea tu primer producto para comenzar</p>
        </div>
      ) : (
        <div className="space-y-8">
          {categories.map((category, catIndex) => {
            const categoryProducts = products
              .filter(p => p.category === category)
              .sort((a, b) => (a.order || 0) - (b.order || 0))

            if (categoryProducts.length === 0) return null

            return (
              <div key={category} className="mb-10 last:mb-0">
                <div className="flex items-center gap-3 mb-6">
                  <h3 className="text-lg font-bold text-gray-800 tracking-wide uppercase">
                    {category}
                  </h3>
                  <span className="px-2 py-0.5 bg-gray-100 text-gray-500 rounded text-[10px] font-bold">
                    {categoryProducts.length} items
                  </span>
                  <div className="flex-1 h-px bg-gradient-to-r from-gray-100 to-transparent ml-2"></div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => moveCategory(catIndex, 'up')}
                      disabled={catIndex === 0}
                      className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all disabled:opacity-0"
                      title="Subir categoría"
                    >
                      <i className="bi bi-chevron-up"></i>
                    </button>
                    <button
                      onClick={() => moveCategory(catIndex, 'down')}
                      disabled={catIndex === categories.length - 1}
                      className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all disabled:opacity-0"
                      title="Bajar categoría"
                    >
                      <i className="bi bi-chevron-down"></i>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
                  {categoryProducts.map((product, pIndex) => (
                    <div
                      key={product.id}
                      className={`group relative flex items-center bg-white p-4 rounded-2xl border transition-all duration-300 ${product.isAvailable
                        ? 'border-gray-100 shadow-sm hover:shadow-md hover:border-red-100'
                        : 'border-gray-200 bg-gray-50/50'
                        }`}
                    >
                      <div className={`flex items-center flex-1 min-w-0 ${!product.isAvailable ? 'opacity-50' : ''}`}>
                        {/* Imagen cuadrada con diseño redondeado */}
                        <div className={`w-20 h-20 sm:w-24 sm:h-24 flex-shrink-0 rounded-xl overflow-hidden bg-gray-50 relative border border-gray-50 ${!product.isAvailable ? 'grayscale' : ''}`}>
                          {product.image ? (
                            <img
                              src={product.image}
                              alt={product.name}
                              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-gray-300 bg-gray-50">
                              <i className="bi bi-box-seam text-2xl"></i>
                            </div>
                          )}
                        </div>

                        {/* Info Content */}
                        <div className="flex-1 min-w-0 ml-4 pr-10">
                          <div className="flex flex-col h-full justify-between">
                            <div>
                              <div className="flex flex-wrap items-center gap-2 mb-1">
                                <h4 className="font-bold text-base sm:text-lg text-gray-900 group-hover:text-red-600 transition-colors leading-tight truncate">
                                  {product.name}
                                </h4>
                                {!product.isAvailable && (
                                  <span className="text-[9px] font-black bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded uppercase tracking-widest">
                                    Oculto
                                  </span>
                                )}
                              </div>
                              <p className="text-gray-500 text-xs sm:text-sm mt-1 line-clamp-2 leading-snug">
                                {product.description}
                              </p>
                            </div>

                            <div className="mt-2 flex items-center gap-3">
                              <span className="text-base sm:text-xl font-black text-red-500 tracking-tight">
                                ${product.price.toFixed(2)}
                              </span>
                              {product.variants && product.variants.length > 0 && (
                                <div className="flex items-center gap-1 px-2 py-0.5 bg-gray-50 rounded-lg border border-gray-100">
                                  <i className="bi bi-stack text-gray-400 text-[10px]"></i>
                                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-tighter">
                                    {product.variants.length} variantes
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Botones de acción - Desplegable */}
                      <div className="absolute top-3 right-3 product-action-menu z-20">
                        <button
                          onClick={() => setActiveMenu(activeMenu === product.id ? null : product.id)}
                          className="w-8 h-8 flex items-center justify-center text-gray-500 hover:text-gray-900 rounded-full hover:bg-white shadow-sm border border-gray-100 transition-all active:scale-95 bg-white"
                        >
                          <i className="bi bi-three-dots-vertical text-lg"></i>
                        </button>

                        {activeMenu === product.id && (
                          <div className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-xl border border-gray-100 z-30 py-2 animate-in fade-in zoom-in duration-200">
                            <button
                              onClick={() => {
                                handleToggleAvailability(product.id, product.isAvailable)
                                setActiveMenu(null)
                              }}
                              className="w-full px-4 py-2.5 text-left text-sm font-medium hover:bg-gray-50 flex items-center gap-3 transition-colors text-gray-700"
                            >
                              <i className={`bi ${product.isAvailable ? 'bi-eye-slash text-orange-600' : 'bi-eye text-emerald-600'}`}></i>
                              {product.isAvailable ? 'Ocultar' : 'Mostrar'}
                            </button>
                            <button
                              onClick={() => {
                                handleEditProduct(product)
                                setActiveMenu(null)
                              }}
                              className="w-full px-4 py-2.5 text-left text-sm font-medium hover:bg-gray-50 flex items-center gap-3 transition-colors text-gray-700"
                            >
                              <i className="bi bi-pencil text-blue-600"></i>
                              Editar
                            </button>
                            <button
                              onClick={async () => {
                                const productUrl = `${window.location.origin}/${business?.username}/${product.slug || product.id}`
                                try {
                                  if (navigator.clipboard && window.isSecureContext) {
                                    await navigator.clipboard.writeText(productUrl)
                                  } else {
                                    const textArea = document.createElement('textarea')
                                    textArea.value = productUrl
                                    textArea.style.position = 'fixed'
                                    textArea.style.opacity = '0'
                                    document.body.appendChild(textArea)
                                    textArea.focus()
                                    textArea.select()
                                    document.execCommand('copy')
                                    document.body.removeChild(textArea)
                                  }
                                  setActiveMenu(null)
                                } catch (err) {
                                  console.error('Error al copiar enlace:', err)
                                }
                              }}
                              className="w-full px-4 py-2.5 text-left text-sm font-medium hover:bg-gray-50 flex items-center gap-3 transition-colors text-gray-700"
                            >
                              <i className="bi bi-link-45deg text-purple-600"></i>
                              Copiar link
                            </button>
                            <div className="border-t border-gray-50 my-1"></div>
                            <div className="px-4 py-2 flex items-center justify-between text-[10px] font-black text-gray-400 uppercase tracking-widest">
                              Mover
                              <div className="flex gap-1">
                                <button
                                  onClick={() => moveProduct(product, 'up')}
                                  disabled={pIndex === 0}
                                  className="w-6 h-6 flex items-center justify-center bg-gray-50 rounded hover:bg-gray-100 disabled:opacity-30"
                                >
                                  <i className="bi bi-chevron-up"></i>
                                </button>
                                <button
                                  onClick={() => moveProduct(product, 'down')}
                                  disabled={pIndex === categoryProducts.length - 1}
                                  className="w-6 h-6 flex items-center justify-center bg-gray-50 rounded hover:bg-gray-100 disabled:opacity-30"
                                >
                                  <i className="bi bi-chevron-down"></i>
                                </button>
                              </div>
                            </div>
                            <div className="border-t border-gray-50 my-1"></div>
                            <button
                              onClick={() => {
                                handleDeleteProduct(product.id)
                                setActiveMenu(null)
                              }}
                              className="w-full px-4 py-2.5 text-left text-sm font-medium hover:bg-red-50 flex items-center gap-3 transition-colors text-red-600"
                            >
                              <i className="bi bi-trash"></i>
                              Eliminar
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}

          {/* Sección de productos sin categoría o categoría no listada */}
          {(() => {
            const uncategorizedProducts = products
              .filter(p => !categories.includes(p.category))
              .sort((a, b) => (a.order || 0) - (b.order || 0))

            if (uncategorizedProducts.length === 0) return null

            return (
              <div className="mb-10">
                <div className="flex items-center gap-3 mb-6">
                  <h3 className="text-lg font-bold text-gray-800 tracking-wide uppercase">
                    Otros / Sin categoría
                  </h3>
                  <span className="px-2 py-0.5 bg-gray-100 text-gray-500 rounded text-[10px] font-bold">
                    {uncategorizedProducts.length} items
                  </span>
                  <div className="flex-1 h-px bg-gradient-to-r from-gray-100 to-transparent ml-2"></div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
                  {uncategorizedProducts.map((product, pIndex) => (
                    <div
                      key={product.id}
                      className={`group relative flex items-center bg-white p-4 rounded-2xl border transition-all duration-300 ${product.isAvailable
                        ? 'border-gray-100 shadow-sm hover:shadow-md hover:border-red-100'
                        : 'border-gray-200 bg-gray-50/50'
                        }`}
                    >
                      <div className={`flex items-center flex-1 min-w-0 ${!product.isAvailable ? 'opacity-50' : ''}`}>
                        {/* Imagen cuadrada con diseño redondeado */}
                        <div className={`w-20 h-20 sm:w-24 sm:h-24 flex-shrink-0 rounded-xl overflow-hidden bg-gray-50 relative border border-gray-50 ${!product.isAvailable ? 'grayscale' : ''}`}>
                          {product.image ? (
                            <img
                              src={product.image}
                              alt={product.name}
                              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-gray-300 bg-gray-50">
                              <i className="bi bi-box-seam text-2xl"></i>
                            </div>
                          )}
                        </div>

                        {/* Info Content */}
                        <div className="flex-1 min-w-0 ml-4 pr-10">
                          <div className="flex flex-col h-full justify-between">
                            <div>
                              <div className="flex flex-wrap items-center gap-2 mb-1">
                                <h4 className="font-bold text-base sm:text-lg text-gray-900 group-hover:text-red-600 transition-colors leading-tight truncate">
                                  {product.name}
                                </h4>
                                {!product.isAvailable && (
                                  <span className="text-[9px] font-black bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded uppercase tracking-widest">
                                    Oculto
                                  </span>
                                )}
                              </div>
                              <p className="text-gray-500 text-xs sm:text-sm mt-1 line-clamp-2 leading-snug">
                                {product.description}
                              </p>
                            </div>

                            <div className="mt-2 flex items-center gap-3">
                              <span className="text-base sm:text-xl font-black text-red-500 tracking-tight">
                                ${product.price.toFixed(2)}
                              </span>
                              {product.variants && product.variants.length > 0 && (
                                <div className="flex items-center gap-1 px-2 py-0.5 bg-gray-50 rounded-lg border border-gray-100">
                                  <i className="bi bi-stack text-gray-400 text-[10px]"></i>
                                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-tighter">
                                    {product.variants.length} variantes
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Botones de acción - Desplegable */}
                      <div className="absolute top-3 right-3 product-action-menu z-20">
                        <button
                          onClick={() => setActiveMenu(activeMenu === product.id ? null : product.id)}
                          className="w-8 h-8 flex items-center justify-center text-gray-500 hover:text-gray-900 rounded-full hover:bg-white shadow-sm border border-gray-100 transition-all active:scale-95 bg-white"
                        >
                          <i className="bi bi-three-dots-vertical text-lg"></i>
                        </button>

                        {activeMenu === product.id && (
                          <div className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-xl border border-gray-100 z-30 py-2 animate-in fade-in zoom-in duration-200">
                            <button
                              onClick={() => {
                                handleToggleAvailability(product.id, product.isAvailable)
                                setActiveMenu(null)
                              }}
                              className="w-full px-4 py-2.5 text-left text-sm font-medium hover:bg-gray-50 flex items-center gap-3 transition-colors text-gray-700"
                            >
                              <i className={`bi ${product.isAvailable ? 'bi-eye-slash text-orange-600' : 'bi-eye text-emerald-600'}`}></i>
                              {product.isAvailable ? 'Ocultar' : 'Mostrar'}
                            </button>
                            <button
                              onClick={() => {
                                handleEditProduct(product)
                                setActiveMenu(null)
                              }}
                              className="w-full px-4 py-2.5 text-left text-sm font-medium hover:bg-gray-50 flex items-center gap-3 transition-colors text-gray-700"
                            >
                              <i className="bi bi-pencil text-blue-600"></i>
                              Editar
                            </button>
                            <button
                              onClick={async () => {
                                const productUrl = `${window.location.origin}/${business?.username}/${product.slug || product.id}`
                                try {
                                  if (navigator.clipboard && window.isSecureContext) {
                                    await navigator.clipboard.writeText(productUrl)
                                  } else {
                                    const textArea = document.createElement('textarea')
                                    textArea.value = productUrl
                                    textArea.style.position = 'fixed'
                                    textArea.style.opacity = '0'
                                    document.body.appendChild(textArea)
                                    textArea.focus()
                                    textArea.select()
                                    document.execCommand('copy')
                                    document.body.removeChild(textArea)
                                  }
                                  setActiveMenu(null)
                                } catch (err) {
                                  console.error('Error al copiar enlace:', err)
                                }
                              }}
                              className="w-full px-4 py-2.5 text-left text-sm font-medium hover:bg-gray-50 flex items-center gap-3 transition-colors text-gray-700"
                            >
                              <i className="bi bi-link-45deg text-purple-600"></i>
                              Copiar link
                            </button>
                            <div className="border-t border-gray-50 my-1"></div>
                            <div className="px-4 py-2 flex items-center justify-between text-[10px] font-black text-gray-400 uppercase tracking-widest">
                              Mover
                              <div className="flex gap-1">
                                <button
                                  onClick={() => moveProduct(product, 'up')}
                                  disabled={pIndex === 0}
                                  className="w-6 h-6 flex items-center justify-center bg-gray-50 rounded hover:bg-gray-100 disabled:opacity-30"
                                >
                                  <i className="bi bi-chevron-up"></i>
                                </button>
                                <button
                                  onClick={() => moveProduct(product, 'down')}
                                  disabled={pIndex === uncategorizedProducts.length - 1}
                                  className="w-6 h-6 flex items-center justify-center bg-gray-50 rounded hover:bg-gray-100 disabled:opacity-30"
                                >
                                  <i className="bi bi-chevron-down"></i>
                                </button>
                              </div>
                            </div>
                            <div className="border-t border-gray-50 my-1"></div>
                            <button
                              onClick={() => {
                                handleDeleteProduct(product.id)
                                setActiveMenu(null)
                              }}
                              className="w-full px-4 py-2.5 text-left text-sm font-medium hover:bg-red-50 flex items-center gap-3 transition-colors text-red-600"
                            >
                              <i className="bi bi-trash"></i>
                              Eliminar
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}
        </div>
      )}


      {/* Modal del formulario - Versión Visual */}
      {showProductForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-[2.5rem] max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-slate-100 animate-in fade-in zoom-in duration-300">
            <div className="p-8">
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

              {/* Pestañas */}
              <div className="border-b border-gray-200 mb-6">
                <nav className="-mb-px flex space-x-8">
                  <button
                    type="button"
                    onClick={() => setActiveTab('general')}
                    className={`py-2 px-1 border-b-2 font-medium text-sm transition-colors ${activeTab === 'general'
                      ? 'border-red-500 text-red-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                      }`}
                  >
                    <i className="bi bi-info-circle me-2"></i>
                    Información General
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('ingredients')}
                    className={`py-2 px-1 border-b-2 font-medium text-sm transition-colors ${activeTab === 'ingredients'
                      ? 'border-red-500 text-red-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                      }`}
                  >
                    <i className="bi bi-basket me-2"></i>
                    Ingredientes y Costos
                    {ingredients.length > 0 && (
                      <span className="ml-2 bg-red-100 text-red-800 px-2 py-0.5 rounded-full text-xs">
                        {ingredients.length}
                      </span>
                    )}
                  </button>
                </nav>
              </div>

              <form onSubmit={handleSaveProduct} className="space-y-6">
                {/* PESTAÑA: INFORMACIÓN GENERAL */}
                {activeTab === 'general' && (
                  <>
                    {/* Sección de Imagen - Visual */}
                    <div>
                      <label htmlFor="image-upload" className="block cursor-pointer">
                        <div className="relative w-full aspect-square bg-gray-100 rounded-lg border-2 border-dashed border-gray-300 hover:border-red-400 hover:bg-red-50 transition-colors flex items-center justify-center overflow-hidden group">
                          {uploading && formData.image && (
                            <div className="absolute inset-0 z-20 bg-black/50 backdrop-blur-[1px] flex flex-col items-center justify-center">
                              <i className="bi bi-arrow-clockwise animate-spin text-white text-3xl mb-3"></i>
                              <p className="text-white text-sm font-black uppercase tracking-widest">Subiendo imagen</p>
                            </div>
                          )}
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
                          className={`w-full text-2xl sm:text-3xl font-bold text-gray-900 border-b-2 focus:outline-none transition-colors py-2 px-0 ${errors.name ? 'border-red-500 text-red-600' : 'border-transparent hover:border-gray-300 focus:border-red-500'
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
                        className={`w-full px-0 py-2 border-b-2 focus:outline-none transition-colors bg-transparent text-gray-600 resize-none ${errors.description ? 'border-red-500 text-red-600' : 'border-transparent hover:border-gray-300 focus:border-red-500'
                          }`}
                      />
                      {errors.description && <p className="text-red-500 text-sm mt-2">{errors.description}</p>}
                    </div>

                    {/* Precio - Grande y destacado */}
                    <div>
                      <div className="relative">
                        <span className="absolute left-0 top-2 text-3xl sm:text-4xl font-bold text-gray-900">$</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          name="price"
                          value={formData.price}
                          onChange={handleInputChange}
                          placeholder="0.00"
                          className={`w-full pl-10 sm:pl-12 pr-0 py-2 text-3xl sm:text-4xl font-bold border-b-2 focus:outline-none transition-colors bg-transparent ${errors.price ? 'border-red-500 text-red-600' : 'border-transparent hover:border-gray-300 focus:border-red-500 text-gray-900'
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
                      <h4 className="font-semibold text-gray-900 mb-4">Variantes</h4>

                      {variants.length > 0 && (
                        <div className="space-y-3 mb-6">
                          {variants.map((variant, index) => (
                            <div
                              key={variant.id}
                              className={`group flex items-center bg-white p-3 rounded-2xl border transition-all duration-300 ${variantVisibility[variant.id] !== false
                                ? 'border-gray-100 shadow-sm hover:shadow-md'
                                : 'border-gray-200 bg-gray-50/50'
                                }`}
                            >
                              <div className={`flex-1 min-w-0 ${variantVisibility[variant.id] === false ? 'opacity-60 grayscale-[0.5]' : ''}`}>
                                <div className="flex items-center gap-2">
                                  <p className="font-bold text-gray-900 truncate leading-tight">
                                    {variant.name}
                                  </p>
                                  {variantVisibility[variant.id] === false && (
                                    <span className="text-[8px] font-black bg-gray-200 text-gray-500 px-1 py-0.5 rounded uppercase tracking-widest">
                                      Oculto
                                    </span>
                                  )}
                                </div>
                                <p className="text-sm font-black text-red-500 tracking-tight mt-0.5">
                                  ${variant.price.toFixed(2)}
                                </p>
                              </div>

                              <div className="flex items-center gap-1">
                                {/* Botón de 3 puntos */}
                                <div className="relative variant-action-menu">
                                  <button
                                    type="button"
                                    onClick={() => setActiveVariantMenu(activeVariantMenu === variant.id ? null : variant.id)}
                                    className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-900 rounded-full hover:bg-gray-100 transition-all"
                                  >
                                    <i className="bi bi-three-dots-vertical"></i>
                                  </button>

                                  {activeVariantMenu === variant.id && (
                                    <div className="absolute right-0 mt-2 w-44 bg-white rounded-xl shadow-xl border border-gray-100 z-30 py-2 animate-in fade-in zoom-in duration-200">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setVariantVisibility(prev => ({ ...prev, [variant.id]: !prev[variant.id] }))
                                          setActiveVariantMenu(null)
                                        }}
                                        className="w-full px-4 py-2 text-left text-sm font-medium hover:bg-gray-50 flex items-center gap-3 transition-colors text-gray-700"
                                      >
                                        <i className={`bi ${variantVisibility[variant.id] !== false ? 'bi-eye-slash text-orange-600' : 'bi-eye text-emerald-600'}`}></i>
                                        {variantVisibility[variant.id] !== false ? 'Ocultar' : 'Mostrar'}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          handleEditVariant(variant)
                                          setActiveVariantMenu(null)
                                        }}
                                        className="w-full px-4 py-2 text-left text-sm font-medium hover:bg-gray-50 flex items-center gap-3 transition-colors text-gray-700"
                                      >
                                        <i className="bi bi-pencil text-blue-600"></i>
                                        Editar
                                      </button>
                                      <div className="border-t border-gray-50 my-1"></div>

                                      <div className="px-4 py-2 flex items-center justify-between text-[10px] font-black text-gray-400 uppercase tracking-widest">
                                        Mover
                                        <div className="flex gap-1">
                                          <button
                                            type="button"
                                            onClick={() => moveVariant(index, 'up')}
                                            disabled={index === 0}
                                            className="w-6 h-6 flex items-center justify-center bg-gray-50 rounded hover:bg-gray-100 disabled:opacity-30 transition-colors"
                                          >
                                            <i className="bi bi-chevron-up"></i>
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => moveVariant(index, 'down')}
                                            disabled={index === variants.length - 1}
                                            className="w-6 h-6 flex items-center justify-center bg-gray-50 rounded hover:bg-gray-100 disabled:opacity-30 transition-colors"
                                          >
                                            <i className="bi bi-chevron-down"></i>
                                          </button>
                                        </div>
                                      </div>

                                      <div className="border-t border-gray-50 my-1"></div>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          removeVariant(variant.id)
                                          setActiveVariantMenu(null)
                                        }}
                                        className="w-full px-4 py-2 text-left text-sm font-medium hover:bg-red-50 flex items-center gap-3 transition-colors text-red-600"
                                      >
                                        <i className="bi bi-trash"></i>
                                        Eliminar
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {!(showVariantForm || editingVariantId) ? (
                        <button
                          type="button"
                          onClick={() => setShowVariantForm(true)}
                          className="w-full p-3 border-2 border-dashed border-gray-300 rounded-xl text-gray-500 hover:border-red-400 hover:bg-red-50 transition-all font-bold text-sm flex items-center justify-center gap-2 group"
                        >
                          <i className="bi bi-plus-circle text-lg group-hover:scale-110 transition-transform"></i>
                          Agregar variante
                        </button>
                      ) : (
                        <div className="space-y-3 bg-gray-50/50 p-4 rounded-2xl border border-dashed border-gray-200 animate-in fade-in slide-in-from-top-2 duration-300">
                          <div className="flex items-center gap-2 mb-1">
                            <div className="w-6 h-6 bg-blue-100 text-blue-600 rounded flex items-center justify-center text-xs">
                              <i className={`bi ${editingVariantId ? 'bi-pencil' : 'bi-plus-lg'}`}></i>
                            </div>
                            <h5 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                              {editingVariantId ? 'Editar Variante' : 'Nueva Variante'}
                            </h5>
                          </div>

                          <input
                            type="text"
                            value={currentVariant.name}
                            onChange={(e) => setCurrentVariant(prev => ({ ...prev, name: e.target.value }))}
                            placeholder="Ej: Tamaño grande, Con queso extra"
                            className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm font-bold focus:outline-none focus:border-red-500 shadow-sm transition-all"
                            autoFocus
                          />
                          <div className="flex gap-2">
                            <div className="relative flex-1">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold">$</span>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={currentVariant.price}
                                onChange={(e) => setCurrentVariant(prev => ({ ...prev, price: e.target.value }))}
                                placeholder="Precio (opcional)"
                                className="w-full pl-7 pr-4 py-3 bg-white border border-gray-200 rounded-xl text-sm font-bold focus:outline-none focus:border-red-500 shadow-sm transition-all"
                              />
                            </div>
                            <button
                              type="button"
                              onClick={addVariant}
                              className={`px-6 py-3 text-white rounded-xl text-sm font-black uppercase tracking-widest transition-all shadow-lg active:scale-95 ${editingVariantId ? 'bg-amber-500 hover:bg-amber-600 shadow-amber-100' : 'bg-blue-600 hover:bg-blue-700 shadow-blue-100'}`}
                            >
                              {editingVariantId ? 'LISTO' : 'AÑADIR'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setShowVariantForm(false)
                                setEditingVariantId(null)
                                setCurrentVariant({ name: '', price: '' })
                              }}
                              className="px-4 py-3 bg-gray-100 text-gray-500 rounded-xl text-sm font-bold hover:bg-gray-200 transition-all"
                            >
                              <i className="bi bi-x-lg"></i>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}

                {/* PESTAÑA: INGREDIENTES Y COSTOS */}
                {activeTab === 'ingredients' && (
                  <div className="space-y-6">
                    {/* Sección de ingredientes principales - Solo visible cuando no hay variantes */}
                    {variants.length === 0 && (
                      <div className="bg-white p-4 rounded-lg border border-gray-200">
                        <div className="flex items-center justify-between mb-4">
                          <div>
                            <h3 className="text-lg font-medium text-gray-900">Ingredientes del Producto</h3>
                            <p className="text-sm text-gray-500 mt-1">Ingredientes base que aplican a todas las variantes</p>
                          </div>
                          {ingredients.length > 0 && (
                            <div className="text-right">
                              <p className="text-sm text-gray-500">Costo Total:</p>
                              <p className="text-xl font-bold text-emerald-600">
                                ${calculateTotalIngredientCost().toFixed(2)}
                              </p>
                              {formData.price && (
                                <p className="text-xs text-gray-500 mt-1">
                                  Margen: ${(Number(formData.price) - calculateTotalIngredientCost()).toFixed(2)}
                                  {' '}({((Number(formData.price) - calculateTotalIngredientCost()) / Number(formData.price) * 100).toFixed(1)}%)
                                </p>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Lista de ingredientes */}
                        {ingredients.length > 0 && (
                          <div className="mb-4">
                            <h4 className="font-medium text-gray-900 mb-3">Ingredientes agregados:</h4>
                            <div className="space-y-2">
                              {ingredients.map((ingredient) => (
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

                        {/* Formulario para agregar ingrediente - Optimizado */}
                        <div className="bg-slate-50 p-6 rounded-[2rem] border border-slate-100 shadow-sm transition-all hover:shadow-md">
                          <div className="flex items-center gap-2 mb-6">
                            <div className="w-8 h-8 bg-emerald-100 text-emerald-600 rounded-lg flex items-center justify-center">
                              <i className="bi bi-magic"></i>
                            </div>
                            <h4 className="font-black text-slate-800 uppercase text-[10px] tracking-[0.2em]">Configurar Insumos</h4>
                          </div>

                          <div className="space-y-5">
                            <div className="relative ingredient-input-container">
                              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 mb-2">
                                Buscar o Crear Insumo
                              </label>
                              <div className="relative group">
                                <i className="bi bi-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-emerald-500 transition-colors"></i>
                                <input
                                  type="text"
                                  name="name"
                                  value={currentIngredient.name}
                                  onChange={handleIngredientChange}
                                  onFocus={() => setShowIngredientSuggestions(true)}
                                  className="w-full pl-12 pr-4 py-4 bg-white border-2 border-slate-100 rounded-2xl focus:outline-none focus:border-emerald-500 font-bold text-slate-900 transition-all placeholder:text-slate-300 placeholder:font-medium"
                                  placeholder="¿Qué insumo necesitas?"
                                  autoComplete="off"
                                />
                              </div>

                              {/* Sugerencias de ingredientes - Diseño Mejorado */}
                              {showIngredientSuggestions && (
                                <div className="absolute z-[60] w-full mt-2 bg-white border border-slate-100 rounded-[2rem] shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-300">
                                  <div className="max-h-64 overflow-y-auto custom-scrollbar">
                                    {getFilteredIngredients().length > 0 ? (
                                      <>
                                        <div className="px-5 py-3 bg-slate-50/50 border-b border-slate-50">
                                          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Insumos en Biblioteca</p>
                                        </div>
                                        {getFilteredIngredients().map((ingredient) => (
                                          <button
                                            key={ingredient.id}
                                            type="button"
                                            onClick={() => selectIngredientFromLibrary(ingredient)}
                                            className="w-full text-left px-5 py-4 hover:bg-emerald-50 border-b border-slate-50 last:border-b-0 transition-all group/item"
                                          >
                                            <div className="flex items-center justify-between">
                                              <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center font-black text-[10px] text-slate-400 group-hover/item:bg-emerald-100 group-hover/item:text-emerald-600 transition-colors">
                                                  {ingredient.name.substring(0, 2).toUpperCase()}
                                                </div>
                                                <span className="text-sm font-bold text-slate-900">{ingredient.name}</span>
                                              </div>
                                              <div className="text-right">
                                                <span className="text-sm font-black text-emerald-600">${ingredient.unitCost.toFixed(2)}</span>
                                              </div>
                                            </div>
                                          </button>
                                        ))}
                                      </>
                                    ) : currentIngredient.name.trim() !== '' && (
                                      <button
                                        type="button"
                                        onClick={() => setShowIngredientSuggestions(false)}
                                        className="w-full text-left px-5 py-6 bg-emerald-50 hover:bg-emerald-100 transition-all group/new"
                                      >
                                        <div className="flex items-center gap-4">
                                          <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center text-emerald-600 shadow-sm group-hover/new:scale-110 transition-transform">
                                            <i className="bi bi-plus-lg text-xl"></i>
                                          </div>
                                          <div>
                                            <p className="text-sm font-black text-emerald-700 uppercase tracking-tight">Crear "{currentIngredient.name}"</p>
                                            <p className="text-[10px] text-emerald-600 font-medium">Este insumo se guardará en tu biblioteca</p>
                                          </div>
                                        </div>
                                      </button>
                                    )}

                                    {/* Mostrar sugerencias generales si no hay búsqueda */}
                                    {currentIngredient.name.trim() === '' && ingredientLibrary.length > 0 && (
                                      <>
                                        <div className="px-5 py-3 bg-slate-50/50 border-b border-slate-50">
                                          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Usados frecuentemente</p>
                                        </div>
                                        {ingredientLibrary.slice(0, 5).map((ingredient) => (
                                          <button
                                            key={ingredient.id}
                                            type="button"
                                            onClick={() => selectIngredientFromLibrary(ingredient)}
                                            className="w-full text-left px-5 py-4 hover:bg-emerald-50 border-b border-slate-50 last:border-b-0 transition-all"
                                          >
                                            <div className="flex items-center justify-between">
                                              <span className="text-sm font-bold text-slate-900">{ingredient.name}</span>
                                              <span className="text-sm font-black text-emerald-600">${ingredient.unitCost.toFixed(2)}</span>
                                            </div>
                                          </button>
                                        ))}
                                      </>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              <div className="space-y-2">
                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                                  Costo (Unidad)
                                </label>
                                <div className="relative">
                                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">$</span>
                                  <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    name="unitCost"
                                    value={currentIngredient.unitCost}
                                    onChange={handleIngredientChange}
                                    className="w-full pl-8 pr-4 py-4 bg-white border-2 border-slate-100 rounded-2xl focus:outline-none focus:border-emerald-500 font-bold text-slate-900 transition-all"
                                    placeholder="0.00"
                                  />
                                </div>
                              </div>

                              <div className="space-y-2">
                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                                  Cantidad
                                </label>
                                <div className="relative">
                                  <input
                                    type="number"
                                    step="0.01"
                                    min="0.01"
                                    name="quantity"
                                    value={currentIngredient.quantity}
                                    onChange={handleIngredientChange}
                                    className="w-full px-4 py-4 bg-white border-2 border-slate-100 rounded-2xl focus:outline-none focus:border-emerald-500 font-bold text-slate-900 transition-all"
                                    placeholder="1.0"
                                  />
                                </div>
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={addIngredient}
                              className="w-full bg-slate-900 text-white px-8 py-5 rounded-2xl font-black uppercase text-xs hover:bg-black transition-all shadow-xl shadow-slate-200 active:scale-[0.98] flex items-center justify-center gap-3 mt-4"
                            >
                              <i className="bi bi-plus-circle-fill text-lg"></i>
                              Agregar a Receta
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Sección de variantes */}
                    {variants.length > 0 && (
                      <div className="mt-8 bg-white p-4 rounded-lg border border-gray-200">
                        <h3 className="text-lg font-medium text-gray-900 mb-4">Ingredientes por Variante</h3>
                        <p className="text-sm text-gray-500 mb-4">
                          Gestiona los ingredientes específicos para cada variante. Haz clic en una variante para expandir/contraer
                        </p>

                        <div className="space-y-3">
                          {variants.map((variant) => {
                            const isExpanded = expandedVariantsForIngredients.has(variant.id)
                            const totalCost = (variantIngredients[variant.id] || []).reduce(
                              (sum, ingredient) => sum + (ingredient.quantity * ingredient.unitCost),
                              0
                            )
                            const profit = variant.price ? Number(variant.price) - totalCost : 0

                            return (
                              <div key={variant.id} className="border border-gray-200 rounded-lg overflow-hidden hover:border-gray-300 transition-colors">
                                {/* Header expandible */}
                                <button
                                  type="button"
                                  onClick={() => toggleVariantExpanded(variant.id)}
                                  className="w-full bg-gray-50 hover:bg-gray-100 px-4 py-3 border-b border-gray-200 flex items-center justify-between transition-colors"
                                >
                                  <div className="flex items-center gap-3 flex-1 text-left">
                                    <i className={`bi bi-chevron-${isExpanded ? 'down' : 'right'} text-gray-500 transition-transform`}></i>
                                    <div>
                                      <h4 className="font-medium text-gray-900">
                                        {variant.name}
                                        {variant.price && (
                                          <span className="ml-2 text-sm font-normal text-gray-500">
                                            (${Number(variant.price).toFixed(2)})
                                          </span>
                                        )}
                                      </h4>
                                      <div className="mt-1 flex items-center gap-3 text-xs">
                                        <span className="text-emerald-600 font-medium">
                                          Costo: ${totalCost.toFixed(2)}
                                        </span>
                                        {variant.price && (
                                          <span className={`font-medium ${profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                            Ganancia: ${profit.toFixed(2)}
                                          </span>
                                        )}
                                        <span className={`px-2 py-0.5 rounded text-xs transition-colors ${variantIngredients[variant.id]?.length > 0
                                          ? 'bg-blue-100 text-blue-600 font-bold'
                                          : 'text-gray-400 bg-gray-200'}`}>
                                          {variantIngredients[variant.id]?.length || 0} ingredientes
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        setVariantVisibility(prev => ({ ...prev, [variant.id]: !prev[variant.id] }))
                                      }}
                                      className={`p-2 rounded-lg transition-colors ${variantVisibility[variant.id] !== false
                                        ? 'text-orange-600 hover:bg-orange-50'
                                        : 'text-green-600 hover:bg-green-50'
                                        }`}
                                      title={variantVisibility[variant.id] !== false ? 'Ocultar variante' : 'Mostrar variante'}
                                    >
                                      <i className={`bi ${variantVisibility[variant.id] !== false ? 'bi-eye-slash' : 'bi-eye'}`}></i>
                                    </button>
                                  </div>
                                </button>

                                {/* Contenido expandible */}
                                {isExpanded && (
                                  <div className="px-4 py-4 bg-white">
                                    {/* Lista de ingredientes */}
                                    {variantIngredients[variant.id]?.length > 0 && (
                                      <div className="space-y-2 mb-4">
                                        {variantIngredients[variant.id].map((ingredient) => (
                                          <div key={ingredient.id} className="flex justify-between items-center bg-gray-50 px-3 py-2 rounded-md hover:bg-gray-100 transition-colors">
                                            <div className={`flex-1 ${variantVisibility[variant.id] === false ? 'opacity-50 grayscale' : ''}`}>
                                              <p className="font-medium text-gray-900 text-sm">{ingredient.name}</p>
                                              <p className="text-xs text-gray-500 mt-0.5">
                                                {ingredient.quantity} × ${ingredient.unitCost.toFixed(2)} = <span className="font-medium text-emerald-600">${(ingredient.quantity * ingredient.unitCost).toFixed(2)}</span>
                                              </p>
                                            </div>
                                            <button
                                              type="button"
                                              onClick={() => removeIngredientFromVariant(variant.id, ingredient.id)}
                                              className="ml-3 text-red-500 hover:text-red-700 hover:bg-red-50 p-1.5 rounded transition-colors flex-shrink-0"
                                              title="Eliminar ingrediente"
                                            >
                                              <i className="bi bi-trash text-sm"></i>
                                            </button>
                                          </div>
                                        ))}
                                      </div>
                                    )}

                                    {/* Formulario para agregar ingrediente por variante - Optimizado */}
                                    <div className="border-t border-slate-100 pt-5 mt-2 bg-slate-50/50 p-6 rounded-[2rem] border border-dashed border-slate-200">
                                      <h5 className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                                        <i className="bi bi-plus-circle text-emerald-500"></i>
                                        Agregar Insumo Específico
                                      </h5>
                                      <div className="space-y-4">
                                        <div className="relative ingredient-input-container">
                                          <div className="relative">
                                            <i className="bi bi-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-300 text-xs text-xs"></i>
                                            <input
                                              type="text"
                                              name="name"
                                              value={currentIngredient.name}
                                              onChange={handleIngredientChange}
                                              onFocus={() => setShowIngredientSuggestions(true)}
                                              className="w-full pl-10 pr-4 py-3 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-emerald-500 font-bold transition-all shadow-sm"
                                              placeholder="Buscar o crear insumo..."
                                              autoComplete="off"
                                            />
                                          </div>

                                          {/* Sugerencias de ingredientes */}
                                          {showIngredientSuggestions && (
                                            <div className="absolute z-[60] w-full mt-1 bg-white border border-slate-100 rounded-2xl shadow-2xl overflow-hidden shadow-emerald-900/5">
                                              <div className="max-h-40 overflow-y-auto custom-scrollbar">
                                                {getFilteredIngredients().length > 0 ? (
                                                  getFilteredIngredients().map((ingredient) => (
                                                    <button
                                                      key={ingredient.id}
                                                      type="button"
                                                      onClick={() => selectIngredientFromLibrary(ingredient)}
                                                      className="w-full text-left px-4 py-2.5 hover:bg-emerald-50 border-b border-slate-50 last:border-b-0 text-[11px] transition-all flex items-center justify-between"
                                                    >
                                                      <span className="font-bold text-slate-700">{ingredient.name}</span>
                                                      <span className="text-emerald-600 font-black">${ingredient.unitCost.toFixed(2)}</span>
                                                    </button>
                                                  ))
                                                ) : currentIngredient.name.trim() !== '' && (
                                                  <button
                                                    type="button"
                                                    onClick={() => setShowIngredientSuggestions(false)}
                                                    className="w-full text-left px-4 py-3 bg-emerald-50 hover:bg-emerald-100 text-[11px] font-black text-emerald-700 transition-all flex items-center gap-2"
                                                  >
                                                    <i className="bi bi-plus-lg bg-white p-1.5 rounded-lg shadow-sm"></i>
                                                    Crear "{currentIngredient.name}"
                                                  </button>
                                                )}
                                              </div>
                                            </div>
                                          )}
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                          <div className="relative">
                                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300 text-[10px]">$</span>
                                            <input
                                              type="number"
                                              step="0.01"
                                              min="0"
                                              name="unitCost"
                                              value={currentIngredient.unitCost}
                                              onChange={handleIngredientChange}
                                              className="w-full pl-6 pr-3 py-2.5 text-[11px] bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-emerald-500 font-black transition-all"
                                              placeholder="Costo"
                                            />
                                          </div>
                                          <input
                                            type="number"
                                            step="0.01"
                                            min="0.01"
                                            name="quantity"
                                            value={currentIngredient.quantity}
                                            onChange={handleIngredientChange}
                                            className="w-full px-3 py-2.5 text-[11px] bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-emerald-500 font-black transition-all"
                                            placeholder="Cantidad"
                                          />
                                        </div>
                                        <button
                                          type="button"
                                          onClick={() => addIngredientToVariant(variant.id)}
                                          className="w-full bg-emerald-600 text-white px-4 py-3 text-[10px] rounded-xl hover:bg-emerald-700 transition-all font-black uppercase tracking-wider"
                                        >
                                          Agregar a Variante
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}

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
                        {formData.image ? 'Subiendo imagen' : 'Guardando...'}
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
      )
      }

      <style jsx>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #f1f1f1;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #e1e1e1;
        }

        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes slideInFromTop {
          from { transform: translateY(-8px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }

        .animate-in {
          animation: fadeIn 0.3s ease-out;
        }

        .slide-in-from-top-2 {
          animation: slideInFromTop 0.3s ease-out;
        }
      `}</style>

      {/* Botón flotante para nuevo producto */}
      <button
        onClick={handleOpenNewProduct}
        className="fixed bottom-6 right-6 w-14 h-14 bg-red-600 text-white rounded-full shadow-2xl hover:bg-red-700 transition-all active:scale-90 flex items-center justify-center z-[100] group"
        title="Nuevo Producto"
      >
        <i className="bi bi-plus-lg text-2xl group-hover:rotate-90 transition-transform duration-300"></i>
      </button>
    </div >
  )
}
