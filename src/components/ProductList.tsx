'use client'

import React, { useState, useEffect } from 'react'
import { Business, Product, ProductVariant, Ingredient, CommissionType, ProductOption, ProductOptionGroup } from '@/types'
import { createProduct, updateProduct, deleteProduct, uploadImage, getIngredientLibrary, addOrUpdateIngredientInLibrary, IngredientLibraryItem } from '@/lib/database'
import { optimizeImage } from '@/lib/image-utils'
import { calculateCommissionPricing, getBusinessCommissionSettings } from '@/lib/price-utils'

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
    image: null as File | null,
    commissionType: 'fuddi_assumed_by_customer' as CommissionType,
    isCombo: false,
    minComboItems: 1,
    imagePosition: 'center 50%'
  })
  const [variants, setVariants] = useState<ProductVariant[]>([])
  const [currentVariant, setCurrentVariant] = useState<{
    name: string;
    price: string;
    description: string;
    imageFile: File | null;
    imageUrl: string;
  }>({
    name: '',
    price: '',
    description: '',
    imageFile: null,
    imageUrl: ''
  })
  const [variantImageFiles, setVariantImageFiles] = useState<Record<string, File>>({})
  const commissionSettings = getBusinessCommissionSettings(business)
  const [showCommissionSettings, setShowCommissionSettings] = useState(false)
  const [editingVariantId, setEditingVariantId] = useState<string | null>(null)
  const [showVariantForm, setShowVariantForm] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [uploading, setUploading] = useState(false)

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
  const [activeTab, setActiveTab] = useState<'general' | 'ingredients' | 'options'>('general')
  const [variantVisibility, setVariantVisibility] = useState<Record<string, boolean>>({})
  const [activeMenu, setActiveMenu] = useState<string | null>(null)
  const [activeVariantMenu, setActiveVariantMenu] = useState<string | null>(null)
  const [showHeaderMenu, setShowHeaderMenu] = useState(false)
  const [hasVariants, setHasVariants] = useState(false)

  // Estados para opciones/modificadores
  const [optionGroups, setOptionGroups] = useState<ProductOptionGroup[]>([])
  const [editingGroupIndex, setEditingGroupIndex] = useState<number | null>(null)
  const [currentGroup, setCurrentGroup] = useState<Omit<ProductOptionGroup, 'id'>>({
    name: '',
    minSelect: 0,
    maxSelect: 1,
    options: []
  })
  const [newOptionName, setNewOptionName] = useState('')
  const [newOptionPrice, setNewOptionPrice] = useState('')

  // Estados para disponibilidad por horarios
  const [scheduleEnabled, setScheduleEnabled] = useState(false)
  const [schedules, setSchedules] = useState<Array<{
    id: string
    days: string[]
    startTime: string
    endTime: string
  }>>([])
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null)
  const [currentSchedule, setCurrentSchedule] = useState({
    days: [] as string[],
    startTime: '09:00',
    endTime: '17:00'
  })

  // Estados para importación JSON de menú
  const [showJsonImport, setShowJsonImport] = useState(false)
  const [jsonText, setJsonText] = useState('')
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [parsedProducts, setParsedProducts] = useState<any[]>([])
  const [isImporting, setIsImporting] = useState(false)
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 })

  // Estados para Añadidos Rápidos
  const [quickAddonProduct, setQuickAddonProduct] = useState<Product | null>(null)
  const [selectedAddonIds, setSelectedAddonIds] = useState<string[]>([])

  useEffect(() => {
    if (quickAddonProduct) {
      setSelectedAddonIds(quickAddonProduct.quickAddons || [])
    } else {
      setSelectedAddonIds([])
    }
  }, [quickAddonProduct])

  const daysOfWeek = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
  const dayLabels: Record<string, string> = {
    Monday: 'Lun',
    Tuesday: 'Mar',
    Wednesday: 'Mié',
    Thursday: 'Jue',
    Friday: 'Vie',
    Saturday: 'Sáb',
    Sunday: 'Dom'
  }

  const handleOpenNewProduct = () => {
    setEditingProduct(null)
    const defaultCategory = categories.length > 0 ? categories[0] : 'General'
    setFormData({
      name: '',
      description: '',
      price: '',
      category: defaultCategory,
      isAvailable: true,
      image: null,
      commissionType: (business?.defaultCommissionType || 'fuddi_assumed_by_customer') as CommissionType,
      isCombo: false,
      minComboItems: 1,
      imagePosition: 'center 50%'
    })
    setVariants([])
    setIngredients([])
    setVariantIngredients({})
    setCurrentIngredient({ name: '', unitCost: '', quantity: '' })
    setErrors({})
    setActiveTab('general')
    setEditingVariantId(null)
    setShowVariantForm(false)
    setCurrentVariant({ name: '', price: '', description: '', imageFile: null, imageUrl: '' })
    setVariantImageFiles({})
    setOptionGroups([])
    setEditingGroupIndex(null)
    setHasVariants(false)
    // Resetear horarios
    setScheduleEnabled(false)
    setSchedules([])
    setEditingScheduleId(null)
    setCurrentSchedule({ days: [], startTime: '09:00', endTime: '17:00' })
    setShowProductForm(true)
  }

  // Agrupar productos: categorías del negocio + categorías que tengan los productos pero no estén en la lista
  const allCategories = React.useMemo(() => {
    const master = categories || [];
    const fromProducts = Array.from(new Set(products.map(p => p.category).filter(Boolean)));
    const extras = fromProducts.filter(c => !master.includes(c));
    const list = [...master, ...extras];
    
    // Si hay productos sin ninguna categoría, añadimos un placeholder si no existe
    if (products.some(p => !p.category) && !list.includes('Sin categoría')) {
      list.push('Sin categoría');
    }
    return list;
  }, [products, categories]);

  // Sincronización automática de categorías huérfanas
  useEffect(() => {
    if (products.length > 0 && business?.id && onCategoriesChange && onDirectUpdate) {
      const fromProducts = Array.from(new Set(products.map(p => p.category).filter(c => c && c !== 'Sin categoría'))) as string[];
      const missing = fromProducts.filter(c => !categories.includes(c));
      
      if (missing.length > 0) {
        const updated = [...categories, ...missing];
        onCategoriesChange(updated);
        onDirectUpdate('categories', updated);
      }
    }
  }, [products, categories, business?.id, onCategoriesChange, onDirectUpdate]);

  const handleEditProduct = (product: Product) => {
    setEditingProduct(product)
    setFormData({
      name: product.name,
      description: product.description,
      price: (product.basePrice || product.price).toString(),
      category: product.category,
      isAvailable: product.isAvailable,
      image: null,
      commissionType: (product.commissionType || business?.defaultCommissionType || 'fuddi_assumed_by_customer') as CommissionType,
      isCombo: product.isCombo || false,
      minComboItems: product.minComboItems || 1,
      imagePosition: product.imagePosition || 'center 50%'
    })
    setVariants(product.variants?.map(v => ({ ...v, price: v.basePrice || v.price })) || [])
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

    // Cargar horarios
    if (product.scheduleAvailability?.enabled === true) {
      setScheduleEnabled(true)
      setSchedules(product.scheduleAvailability.schedules || [])
    } else {
      setScheduleEnabled(false)
      setSchedules([])
    }
    setEditingScheduleId(null)
    setCurrentSchedule({ days: [], startTime: '09:00', endTime: '17:00' })

    setCurrentIngredient({ name: '', unitCost: '', quantity: '' })
    setErrors({})
    setActiveTab('general')
    setEditingVariantId(null)
    setShowVariantForm(false)
    setCurrentVariant({ name: '', price: '', description: '', imageFile: null, imageUrl: '' })
    setVariantImageFiles({})
    setOptionGroups(product.optionGroups || [])
    setEditingGroupIndex(null)
    setHasVariants(!!(product.variants && product.variants.length > 0))
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
      image: null,
      commissionType: (business?.defaultCommissionType || 'fuddi_assumed_by_customer') as CommissionType,
      isCombo: false,
      minComboItems: 1,
      imagePosition: 'center 50%'
    })
    setVariants([])
    setCurrentVariant({ name: '', price: '', description: '', imageFile: null, imageUrl: '' })
    setVariantImageFiles({})
    setIngredients([])
    setVariantIngredients({})
    setCurrentIngredient({ name: '', unitCost: '', quantity: '' })
    setErrors({})
    setActiveTab('general')
    setEditingVariantId(null)
    setShowVariantForm(false)
    // Resetear horarios
    setScheduleEnabled(false)
    setSchedules([])
    setEditingScheduleId(null)
    setCurrentSchedule({ days: [], startTime: '09:00', endTime: '17:00' })
    setOptionGroups([])
    setEditingGroupIndex(null)
    setCurrentGroup({ name: '', minSelect: 0, maxSelect: 1, options: [] })
    setNewOptionName('')
    setNewOptionPrice('')
  }

  const handleAddOptionGroup = () => {
    setEditingGroupIndex(-1)
    setCurrentGroup({
      name: '',
      minSelect: 0,
      maxSelect: 1,
      options: []
    })
    setNewOptionName('')
    setNewOptionPrice('')
  }

  const handleEditOptionGroup = (index: number) => {
    const group = optionGroups[index]
    setEditingGroupIndex(index)
    setCurrentGroup({
      name: group.name,
      minSelect: group.minSelect,
      maxSelect: group.maxSelect,
      options: [...group.options]
    })
    setNewOptionName('')
    setNewOptionPrice('')
  }

  const handleRemoveOptionGroup = (index: number) => {
    setOptionGroups(prev => prev.filter((_, i) => i !== index))
  }

  const handleAddOptionToGroup = () => {
    if (!newOptionName.trim()) {
      alert('El nombre del modificador/opción es requerido')
      return
    }
    const price = Number(newOptionPrice) || 0
    if (price < 0) {
      alert('El precio no puede ser negativo')
      return
    }
    setCurrentGroup(prev => ({
      ...prev,
      options: [...prev.options, { name: newOptionName.trim(), price }]
    }))
    setNewOptionName('')
    setNewOptionPrice('')
  }

  const handleRemoveOptionFromGroup = (oIdx: number) => {
    setCurrentGroup(prev => ({
      ...prev,
      options: prev.options.filter((_, i) => i !== oIdx)
    }))
  }

  const handleSaveOptionGroup = () => {
    if (!currentGroup.name.trim()) {
      alert('El nombre del grupo es requerido')
      return
    }
    if (currentGroup.options.length === 0) {
      alert('Agrega al menos una opción al grupo')
      return
    }
    if (currentGroup.minSelect > currentGroup.maxSelect) {
      alert('La selección mínima no puede ser mayor que la máxima')
      return
    }

    const savedGroup: ProductOptionGroup = {
      id: editingGroupIndex === -1 ? Date.now().toString() : optionGroups[editingGroupIndex!].id,
      name: currentGroup.name.trim(),
      minSelect: currentGroup.minSelect,
      maxSelect: currentGroup.maxSelect,
      options: currentGroup.options
    }

    if (editingGroupIndex === -1) {
      setOptionGroups(prev => [...prev, savedGroup])
    } else {
      setOptionGroups(prev => prev.map((g, i) => i === editingGroupIndex ? savedGroup : g))
    }
    setEditingGroupIndex(null)
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
      price: (variant.basePrice || variant.price).toString(),
      description: variant.description || '',
      imageFile: null,
      imageUrl: variant.image || ''
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
          ? { 
              ...v, 
              name: currentVariant.name, 
              price: price,
              description: currentVariant.description,
              image: currentVariant.imageUrl // Mantener la URL actual si existe
            }
          : v
      ))
      
      if (currentVariant.imageFile) {
        setVariantImageFiles(prev => ({ ...prev, [editingVariantId]: currentVariant.imageFile! }))
      }
      
      setEditingVariantId(null)
    } else {
      const newId = Date.now().toString()
      const newVariant: ProductVariant = {
        id: newId,
        name: currentVariant.name,
        description: currentVariant.description,
        price: price,
        isAvailable: true,
        image: ''
      }

      if (currentVariant.imageFile) {
        setVariantImageFiles(prev => ({ ...prev, [newId]: currentVariant.imageFile! }))
      }

      setVariants(prev => [...prev, newVariant])
      setVariantVisibility(prev => ({ ...prev, [newVariant.id]: true }))
    }
    setCurrentVariant({ name: '', price: '', description: '', imageFile: null, imageUrl: '' })
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
      setCurrentVariant({ name: '', price: '', description: '', imageFile: null, imageUrl: '' })
    }
  }

  // Funciones para ingredientes

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

  // Funciones para horarios
  const addSchedule = () => {
    if (currentSchedule.days.length === 0) {
      alert('Selecciona al menos un día')
      return
    }
    if (!currentSchedule.startTime || !currentSchedule.endTime) {
      alert('Completa las horas de inicio y fin')
      return
    }

    if (editingScheduleId) {
      setSchedules(prev =>
        prev.map(s =>
          s.id === editingScheduleId
            ? { ...s, days: currentSchedule.days, startTime: currentSchedule.startTime, endTime: currentSchedule.endTime }
            : s
        )
      )
      setEditingScheduleId(null)
    } else {
      const newSchedule = {
        id: Date.now().toString(),
        days: currentSchedule.days,
        startTime: currentSchedule.startTime,
        endTime: currentSchedule.endTime
      }
      setSchedules(prev => [...prev, newSchedule])
    }
    setCurrentSchedule({ days: [], startTime: '09:00', endTime: '17:00' })
  }

  const editSchedule = (schedule: typeof schedules[0]) => {
    setCurrentSchedule({
      days: schedule.days,
      startTime: schedule.startTime,
      endTime: schedule.endTime
    })
    setEditingScheduleId(schedule.id)
  }

  const removeSchedule = (scheduleId: string) => {
    setSchedules(prev => prev.filter(s => s.id !== scheduleId))
    if (editingScheduleId === scheduleId) {
      setEditingScheduleId(null)
      setCurrentSchedule({ days: [], startTime: '09:00', endTime: '17:00' })
    }
  }

  const toggleDaySelection = (day: string) => {
    setCurrentSchedule(prev => ({
      ...prev,
      days: prev.days.includes(day)
        ? prev.days.filter(d => d !== day)
        : [...prev.days, day]
    }))
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
      if (showHeaderMenu && !target.closest('.header-action-menu')) {
        setShowHeaderMenu(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showIngredientSuggestions, activeMenu, activeVariantMenu, showHeaderMenu])

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

      // Procesar variantes: subir imágenes, agregar ingredientes y visibilidad
      const processedVariants = await Promise.all(variants.map(async (variant) => {
        let variantImageUrl = variant.image || ''
        const imageFile = variantImageFiles[variant.id]
        
        if (imageFile) {
          const timestamp = Date.now()
          const path = `products/variants/${timestamp}_${imageFile.name.split('.')[0]}.jpg`
          
          try {
            const optimizedBlob = await optimizeImage(imageFile, 800, 0.8, 'image/jpeg')
            const optimizedFile = new File(
              [optimizedBlob],
              `${timestamp}_${imageFile.name.split('.')[0]}.jpg`,
              { type: optimizedBlob.type || 'image/jpeg' }
            )
            variantImageUrl = await uploadImage(optimizedFile, path)
          } catch (error) {
            console.error('Error uploading variant image:', error)
          }
        }

        return {
          ...variant,
          image: variantImageUrl,
          ingredients: variantIngredients[variant.id] || undefined,
          isAvailable: variantVisibility[variant.id] !== false
        }
      }))

      const commissionSettings = getBusinessCommissionSettings(business)
      const productPricing = calculateCommissionPricing(
        Number(formData.price),
        formData.commissionType,
        commissionSettings.commissionRate
      )

      const variantsWithCommission = processedVariants.map(variant => {
        const variantPricing = calculateCommissionPricing(
          variant.price,
          formData.commissionType,
          commissionSettings.commissionRate
        )

        return {
          ...variant,
          price: variantPricing.publicPrice,
          basePrice: variantPricing.storePrice,
          commission: variantPricing.commission,
          commissionType: variantPricing.commissionType
        }
      })

      const productData = {
        name: formData.name,
        description: formData.description,
        price: productPricing.publicPrice,
        basePrice: productPricing.storePrice,
        commission: productPricing.commission,
        commissionType: productPricing.commissionType,
        category: formData.category,
        image: imageUrl,
        variants: hasVariants ? (variants.length > 0 ? variantsWithCommission : undefined) : undefined,
        ingredients: ingredients.length > 0 ? ingredients : undefined,
        isAvailable: formData.isAvailable,
        // undefined = eliminar campo en Firestore
        scheduleAvailability: scheduleEnabled
          ? { enabled: true, schedules: schedules.length > 0 ? schedules : [] }
          : undefined,
        isCombo: formData.isCombo,
        minComboItems: formData.isCombo ? Number(formData.minComboItems) : 1,
        optionGroups: optionGroups.length > 0 ? optionGroups : undefined,
        imagePosition: formData.imagePosition,
        businessId: business.id,
        updatedAt: new Date()
      }

      // 0. Sincronizar categoría con la lista maestra del negocio si es nueva
      if (formData.category && formData.category !== 'Sin categoría' && !categories.includes(formData.category)) {
        const updatedCategories = [...categories, formData.category];
        onCategoriesChange(updatedCategories);
        if (onDirectUpdate) {
          await onDirectUpdate('categories', updatedCategories);
        }
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

  const handleDuplicateProduct = async (product: Product) => {
    if (!business?.id) return

    try {
      // Preparar los datos del nuevo producto basado en el actual
      const productData = {
        name: `${product.name} (Copia)`,
        description: product.description,
        price: product.price,
        basePrice: product.basePrice,
        commission: product.commission,
        commissionType: product.commissionType,
        category: product.category,
        image: product.image,
        variants: product.variants,
        ingredients: product.ingredients,
        isAvailable: product.isAvailable,
        scheduleAvailability: product.scheduleAvailability,
        isCombo: product.isCombo || false,
        minComboItems: product.minComboItems || 1,
        optionGroups: product.optionGroups || undefined,
        imagePosition: product.imagePosition || 'center 50%',
        businessId: business.id,
        updatedAt: new Date(),
        order: (product.order || 0) + 1 // Intentar colocarlo cerca
      }

      const newProductId = await createProduct(productData, business.username)
      
      const newProduct: Product = {
        ...productData,
        id: newProductId,
        createdAt: new Date(),
        businessId: business.id
      } as Product

      onProductsChange([...products, newProduct])
      alert('Producto duplicado correctamente')
    } catch (error) {
      console.error('Error duplicando producto:', error)
      alert('Error al duplicar el producto')
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
    const newCategories = [...allCategories]
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= newCategories.length) return

    const temp = newCategories[index]
    newCategories[index] = newCategories[targetIndex]
    newCategories[targetIndex] = temp

    // Update local state and persist (esto guarda la nueva lista completa en el negocio)
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

  const handleParseJson = () => {
    setJsonError(null)
    setParsedProducts([])
    try {
      if (!jsonText.trim()) {
        setJsonError('El contenido JSON está vacío.')
        return
      }
      const parsed = JSON.parse(jsonText)
      let productsList: any[] = []

      if (Array.isArray(parsed)) {
        productsList = parsed
      } else if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed.products)) {
          productsList = parsed.products
        } else if (parsed.items && Array.isArray(parsed.items)) {
          productsList = parsed.items
        } else if (parsed.menu && Array.isArray(parsed.menu)) {
          productsList = parsed.menu
        } else {
          // Si las llaves son categorías y los valores son arreglos de productos:
          for (const [category, items] of Object.entries(parsed)) {
            if (Array.isArray(items)) {
              items.forEach((item: any) => {
                if (item && typeof item === 'object') {
                  productsList.push({
                    ...item,
                    category: item.category || category
                  })
                }
              })
            }
          }
        }
      } else {
        setJsonError('El formato JSON no es válido. Debe ser un arreglo de productos o un objeto con categorías.')
        return
      }

      if (productsList.length === 0) {
        setJsonError('No se encontraron productos en el JSON provisto.')
        return
      }

      // Validar cada producto y mapear a una estructura estándar
      const validated: any[] = []
      const errorsList: string[] = []

      productsList.forEach((p, idx) => {
        const name = typeof p.name === 'string' ? p.name.trim() : ''
        const price = typeof p.price === 'number' ? p.price : parseFloat(p.price)
        const category = typeof p.category === 'string' ? p.category.trim() : 'General'

        if (!name) {
          errorsList.push(`Producto #${idx + 1}: El nombre es obligatorio.`)
        }
        if (isNaN(price) || price < 0) {
          errorsList.push(`Producto #${idx + 1} (${name || 'Sin nombre'}): El precio debe ser un número válido mayor o igual a 0.`)
        }

        if (name && !isNaN(price)) {
          validated.push({
            name,
            price,
            category,
            commissionType: typeof p.commissionType === 'string' ? p.commissionType : undefined,
            description: typeof p.description === 'string' ? p.description.trim() : '',
            isAvailable: p.isAvailable !== false,
            isCombo: !!p.isCombo,
            minComboItems: typeof p.minComboItems === 'number' ? p.minComboItems : 1,
            variants: Array.isArray(p.variants) ? p.variants.map((v: any, vIdx: number) => ({
              id: v.id || Math.random().toString(36).substring(2, 9),
              name: typeof v.name === 'string' ? v.name.trim() : `Variante ${vIdx + 1}`,
              description: typeof v.description === 'string' ? v.description.trim() : '',
              price: typeof v.price === 'number' ? v.price : parseFloat(v.price) || 0,
              isAvailable: v.isAvailable !== false,
              image: typeof v.image === 'string' ? v.image : '',
              ingredients: Array.isArray(v.ingredients) ? v.ingredients.map((ing: any) => ({
                id: ing.id || Math.random().toString(36).substring(2, 9),
                name: typeof ing.name === 'string' ? ing.name.trim() : 'Ingrediente',
                quantity: typeof ing.quantity === 'number' ? ing.quantity : parseFloat(ing.quantity) || 0,
                unitCost: typeof ing.unitCost === 'number' ? ing.unitCost : parseFloat(ing.unitCost) || 0,
                unit: typeof ing.unit === 'string' ? ing.unit.trim() : ''
              })) : []
            })) : [],
            ingredients: Array.isArray(p.ingredients) ? p.ingredients.map((ing: any) => ({
              id: ing.id || Math.random().toString(36).substring(2, 9),
              name: typeof ing.name === 'string' ? ing.name.trim() : 'Ingrediente',
              quantity: typeof ing.quantity === 'number' ? ing.quantity : parseFloat(ing.quantity) || 0,
              unitCost: typeof ing.unitCost === 'number' ? ing.unitCost : parseFloat(ing.unitCost) || 0,
              unit: typeof ing.unit === 'string' ? ing.unit.trim() : ''
            })) : [],
            scheduleAvailability: p.scheduleAvailability || null
          })
        }
      })

      if (errorsList.length > 0) {
        setJsonError(`Errores de validación:\n${errorsList.slice(0, 5).join('\n')}${errorsList.length > 5 ? `\n...y ${errorsList.length - 5} errores más.` : ''}`)
        return
      }

      setParsedProducts(validated)
    } catch (e: any) {
      setJsonError(`Error al analizar JSON: ${e.message}`)
    }
  }

  const handleImportProducts = async () => {
    if (!business?.id || parsedProducts.length === 0) return
    setIsImporting(true)
    setImportProgress({ current: 0, total: parsedProducts.length })

    const commissionSettings = getBusinessCommissionSettings(business)
    const newProducts: Product[] = []
    const importedCategories = new Set<string>()

    try {
      for (let i = 0; i < parsedProducts.length; i++) {
        const p = parsedProducts[i]
        
        // 1. Calcular comisión sobre precio base
        const productPricing = calculateCommissionPricing(
          p.price,
          (p.commissionType || business.defaultCommissionType || 'fuddi_assumed_by_customer') as CommissionType,
          commissionSettings.commissionRate
        )

        // 2. Calcular comisión para variantes
        const variantsWithCommission = (p.variants || []).map((v: any) => {
          const variantPricing = calculateCommissionPricing(
            v.price,
            (p.commissionType || business.defaultCommissionType || 'fuddi_assumed_by_customer') as CommissionType,
            commissionSettings.commissionRate
          )
          return {
            ...v,
            price: variantPricing.publicPrice,
            basePrice: variantPricing.storePrice,
            commission: variantPricing.commission,
            commissionType: variantPricing.commissionType
          }
        })

        const productData = {
          name: p.name,
          description: p.description,
          price: productPricing.publicPrice,
          basePrice: productPricing.storePrice,
          commission: productPricing.commission,
          commissionType: productPricing.commissionType,
          category: p.category,
          image: p.image || '',
          variants: p.variants && p.variants.length > 0 ? variantsWithCommission : undefined,
          ingredients: p.ingredients && p.ingredients.length > 0 ? p.ingredients : undefined,
          isAvailable: p.isAvailable,
          isCombo: p.isCombo,
          minComboItems: p.minComboItems,
          businessId: business.id,
          updatedAt: new Date()
        }

        const newProductId = await createProduct(productData, business.username)
        newProducts.push({
          ...productData,
          id: newProductId,
          createdAt: new Date(),
        } as Product)

        if (p.category) {
          importedCategories.add(p.category)
        }

        setImportProgress(prev => ({ ...prev, current: i + 1 }))
      }

      // Sincronizar categorías
      const updatedCategoriesList = Array.from(new Set([...categories, ...Array.from(importedCategories)]))
      if (updatedCategoriesList.length !== categories.length) {
        onCategoriesChange(updatedCategoriesList)
        if (onDirectUpdate) {
          await onDirectUpdate('categories', updatedCategoriesList)
        }
      }

      // Agregar a la lista local
      onProductsChange([...products, ...newProducts])
      alert(`¡Éxito! Se han importado ${newProducts.length} productos correctamente.`)
      setShowJsonImport(false)
      setJsonText('')
      setParsedProducts([])
    } catch (error) {
      console.error('Error importing products:', error)
      alert('Ocurrió un error al importar los productos. Por favor revisa la consola.')
    } finally {
      setIsImporting(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Botón para agregar producto */}
      <div className="flex justify-between items-center bg-gray-50 p-4 rounded-2xl border border-gray-100 shadow-sm">
        <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
          <i className="bi bi-box-seam text-blue-600" />
          Productos
        </h2>
        
        <div className="relative header-action-menu">
          <button
            onClick={() => setShowHeaderMenu(!showHeaderMenu)}
            className="w-9 h-9 flex items-center justify-center text-gray-500 hover:text-gray-900 rounded-full hover:bg-gray-100 transition-all active:scale-95 border border-gray-200 bg-white shadow-sm"
            title="Más opciones"
          >
            <i className="bi bi-three-dots-vertical text-lg"></i>
          </button>

          {showHeaderMenu && (
            <div className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-xl border border-gray-100 z-30 py-2 animate-in fade-in zoom-in duration-200">
              <button
                onClick={() => {
                  setJsonText('')
                  setJsonError(null)
                  setParsedProducts([])
                  setShowJsonImport(true)
                  setShowHeaderMenu(false)
                }}
                className="w-full px-4 py-2.5 text-left text-sm font-medium hover:bg-gray-50 flex items-center gap-3 transition-colors text-gray-700"
              >
                <i className="bi bi-filetype-json text-blue-600 text-base" />
                Subir Menú (JSON)
              </button>
            </div>
          )}
        </div>
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
          {allCategories.map((category, catIndex) => {
            const isMaster = categories.includes(category);
            const categoryProducts = products
              .filter(p => {
                if (category === 'Sin categoría') return !p.category;
                return p.category === category;
              })
              .sort((a, b) => (a.order || 0) - (b.order || 0))

            if (categoryProducts.length === 0) return null

            return (
              <div key={category} className="mb-10 last:mb-0">
                <div className="flex items-center gap-3 mb-6">
                  <h3 className={`text-lg font-bold tracking-wide uppercase ${isMaster ? 'text-gray-800' : 'text-gray-400 italic'}`}>
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
                      disabled={catIndex === allCategories.length - 1}
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
                      onClick={() => handleEditProduct(product)}
                      className={`group relative flex items-center bg-white p-4 rounded-2xl border transition-all duration-300 cursor-pointer ${product.isAvailable
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
                              style={{ objectPosition: product.imagePosition || 'center' }}
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

                            <div className="mt-2 flex flex-col">
                              <div className="flex items-center gap-3">
                                <span className="text-base sm:text-xl font-black text-emerald-600 tracking-tight">
                                  ${(product.basePrice || product.price).toFixed(2)}
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
                              {product.basePrice && product.basePrice !== product.price && (
                                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-0.5">
                                  Público: ${product.price.toFixed(2)}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Botones de acción - Desplegable */}
                      <div className="absolute top-3 right-3 product-action-menu z-20">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setActiveMenu(activeMenu === product.id ? null : product.id)
                          }}
                          className="w-8 h-8 flex items-center justify-center text-gray-500 hover:text-gray-900 rounded-full hover:bg-white shadow-sm border border-gray-100 transition-all active:scale-95 bg-white"
                        >
                          <i className="bi bi-three-dots-vertical text-lg"></i>
                        </button>

                        {activeMenu === product.id && (
                          <div className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-xl border border-gray-100 z-30 py-2 animate-in fade-in zoom-in duration-200">
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                handleToggleAvailability(product.id, product.isAvailable)
                                setActiveMenu(null)
                              }}
                              className="w-full px-4 py-2.5 text-left text-sm font-medium hover:bg-gray-50 flex items-center gap-3 transition-colors text-gray-700"
                            >
                              <i className={`bi ${product.isAvailable ? 'bi-eye-slash text-orange-600' : 'bi-eye text-emerald-600'}`}></i>
                              {product.isAvailable ? 'Ocultar' : 'Mostrar'}
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                handleEditProduct(product)
                                setActiveMenu(null)
                              }}
                              className="w-full px-4 py-2.5 text-left text-sm font-medium hover:bg-gray-50 flex items-center gap-3 transition-colors text-gray-700"
                            >
                              <i className="bi bi-pencil text-blue-600"></i>
                              Editar
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                setQuickAddonProduct(product)
                                setActiveMenu(null)
                              }}
                              className="w-full px-4 py-2.5 text-left text-sm font-medium hover:bg-gray-50 flex items-center gap-3 transition-colors text-gray-700"
                            >
                              <i className="bi bi-plus-circle text-emerald-600"></i>
                              Añadidos rápidos
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                handleDuplicateProduct(product)
                                setActiveMenu(null)
                              }}
                              className="w-full px-4 py-2.5 text-left text-sm font-medium hover:bg-gray-50 flex items-center gap-3 transition-colors text-gray-700"
                            >
                              <i className="bi bi-files text-amber-600"></i>
                              Duplicar
                            </button>
                            <button
                              onClick={async (e) => {
                                e.stopPropagation()
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
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    moveProduct(product, 'up')
                                  }}
                                  disabled={pIndex === 0}
                                  className="w-6 h-6 flex items-center justify-center bg-gray-50 rounded hover:bg-gray-100 disabled:opacity-30"
                                >
                                  <i className="bi bi-chevron-up"></i>
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    moveProduct(product, 'down')
                                  }}
                                  disabled={pIndex === categoryProducts.length - 1}
                                  className="w-6 h-6 flex items-center justify-center bg-gray-50 rounded hover:bg-gray-100 disabled:opacity-30"
                                >
                                  <i className="bi bi-chevron-down"></i>
                                </button>
                              </div>
                            </div>
                            <div className="border-t border-gray-50 my-1"></div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
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
        </div>
      )}

      {showProductForm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 sm:p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl max-w-2xl w-full h-[95vh] sm:h-auto sm:max-h-[90vh] flex flex-col shadow-2xl border border-slate-100 animate-in slide-in-from-bottom sm:zoom-in duration-300 overflow-hidden">
            <form onSubmit={handleSaveProduct} className="flex flex-col flex-1 overflow-hidden">
              {/* Encabezado */}
              <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50 flex-shrink-0">
                <h3 className="text-lg font-bold text-gray-900">
                  {editingProduct ? 'Editar Producto' : 'Nuevo Producto'}
                </h3>
                <button
                  type="button"
                  onClick={handleCloseForm}
                  className="text-gray-400 hover:text-gray-600 w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center transition-all"
                >
                  <i className="bi bi-x-lg text-lg"></i>
                </button>
              </div>

              {/* Cuerpo del Modal - Con Scroll */}
              <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
                {/* Pestañas */}
                <div className="flex bg-gray-50 p-1 rounded-xl mb-6 max-w-md mx-auto text-xs font-semibold border border-gray-100">
                  <button
                    type="button"
                    onClick={() => setActiveTab('general')}
                    className={`flex-1 py-2 px-3 rounded-lg text-center transition-all flex items-center justify-center gap-1.5 ${
                      activeTab === 'general'
                        ? 'bg-white text-gray-900 shadow-sm border border-gray-100'
                        : 'text-gray-500 hover:text-gray-900'
                    }`}
                  >
                    <i className="bi bi-info-circle text-sm"></i>
                    General
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('ingredients')}
                    className={`flex-1 py-2 px-3 rounded-lg text-center transition-all flex items-center justify-center gap-1.5 ${
                      activeTab === 'ingredients'
                        ? 'bg-white text-gray-900 shadow-sm border border-gray-100'
                        : 'text-gray-500 hover:text-gray-900'
                    }`}
                  >
                    <i className="bi bi-basket text-sm"></i>
                    <span>Ingredientes</span>
                    {ingredients.length > 0 && (
                      <span className="bg-red-500 text-white px-1.5 py-0.5 rounded-full text-[9px] font-black leading-none">
                        {ingredients.length}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('options')}
                    className={`flex-1 py-2 px-3 rounded-lg text-center transition-all flex items-center justify-center gap-1.5 ${
                      activeTab === 'options'
                        ? 'bg-white text-gray-900 shadow-sm border border-gray-100'
                        : 'text-gray-500 hover:text-gray-900'
                    }`}
                  >
                    <i className="bi bi-gear text-sm"></i>
                    <span>Toppings</span>
                    {optionGroups.length > 0 && (
                      <span className="bg-red-500 text-white px-1.5 py-0.5 rounded-full text-[9px] font-black leading-none">
                        {optionGroups.length}
                      </span>
                    )}
                  </button>
                </div>

                {/* PESTAÑA: INFORMACIÓN GENERAL */}
                {activeTab === 'general' && (
                  <div className="space-y-6">
                    {/* Sección Superior: Información Básica (Imagen + Campos) */}
                    <div className="flex flex-col sm:flex-row gap-6">
                      {/* Lado Izquierdo: Imagen + Ajuste de encuadre */}
                      <div className="flex flex-col items-center gap-3 mx-auto sm:mx-0">
                        <div className="w-40 h-40 flex-shrink-0">
                          <label htmlFor="image-upload" className="block cursor-pointer h-full">
                            <div className="relative h-full bg-gray-50 rounded-xl border-2 border-dashed border-gray-200 hover:border-red-400 hover:bg-red-50 transition-all flex items-center justify-center overflow-hidden group shadow-inner">
                              {uploading && formData.image && (
                                <div className="absolute inset-0 z-20 bg-black/50 backdrop-blur-[1px] flex flex-col items-center justify-center">
                                  <i className="bi bi-arrow-clockwise animate-spin text-white text-xl mb-1"></i>
                                  <p className="text-white text-[8px] font-black uppercase tracking-widest">Subiendo</p>
                                </div>
                              )}
                              {formData.image ? (
                                <div className="absolute inset-0 w-full h-full">
                                  <img src={URL.createObjectURL(formData.image)} alt="Preview" className="w-full h-full object-cover" style={{ objectPosition: formData.imagePosition }} />
                                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                                    <i className="bi bi-camera text-white text-xl"></i>
                                  </div>
                                </div>
                              ) : editingProduct?.image ? (
                                <div className="absolute inset-0 w-full h-full">
                                  <img src={editingProduct.image} alt="Current" className="w-full h-full object-cover" style={{ objectPosition: formData.imagePosition }} />
                                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                                    <i className="bi bi-camera text-white text-xl"></i>
                                  </div>
                                </div>
                              ) : (
                                <div className="text-center p-4">
                                  <i className="bi bi-camera text-3xl text-gray-300 mb-1 block"></i>
                                  <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Foto</p>
                                </div>
                              )}
                            </div>
                          </label>
                        </div>

                        {/* Control de encuadre (slider) */}
                        {(formData.image || editingProduct?.image) && (
                          <div className="w-40 space-y-1">
                            <div className="flex justify-between items-center text-[9px] font-black text-gray-400 uppercase tracking-widest">
                              <span>Encuadre</span>
                              <span className="text-red-500 font-bold">
                                {(() => {
                                  const pct = parseInt(formData.imagePosition.split(' ')[1] || '50', 10);
                                  if (pct === 50) return 'Centro';
                                  if (pct < 40) return 'Arriba';
                                  if (pct > 60) return 'Abajo';
                                  return `${pct}%`;
                                })()}
                              </span>
                            </div>
                            <input
                              type="range"
                              min="0"
                              max="100"
                              value={parseInt(formData.imagePosition.split(' ')[1] || '50', 10)}
                              onChange={(e) => {
                                const val = e.target.value;
                                setFormData(prev => ({ ...prev, imagePosition: `center ${val}%` }));
                              }}
                              className="w-full accent-red-600 h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                            />
                          </div>
                        )}
                        <input
                          id="image-upload"
                          type="file"
                          accept="image/*"
                          onChange={handleImageChange}
                          className="hidden"
                        />
                      </div>

                      {/* Lado Derecho: Nombre, Precio y Descripción */}
                      <div className="flex-1 space-y-5">
                        {/* Nombre del Producto */}
                        <div>
                          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1 ml-1">Nombre del Producto</label>
                          <div className="relative">
                            <input
                              type="text"
                              name="name"
                              value={formData.name}
                              onChange={handleInputChange}
                              placeholder="Ej: Hamburguesa VIP"
                              className={`w-full text-lg font-bold text-gray-900 border-b-2 focus:outline-none transition-colors py-1.5 px-0 ${errors.name ? 'border-red-500 text-red-600' : 'border-gray-100 hover:border-gray-300 focus:border-red-500'
                                }`}
                            />
                          </div>
                          {errors.name && <p className="text-red-500 text-[10px] mt-1 font-bold italic">{errors.name}</p>}
                        </div>

                        {/* Precio */}
                        <div>
                          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1 ml-1">Precio</label>
                          <div className="relative max-w-[200px]">
                            <span className="absolute left-0 top-1 text-2xl font-bold text-gray-900">$</span>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              name="price"
                              value={formData.price}
                              onChange={handleInputChange}
                              onWheel={(e) => (e.target as HTMLInputElement).blur()}
                              placeholder="0.00"
                              className={`w-full pl-6 pr-0 py-1 text-xl font-bold border-b-2 focus:outline-none transition-colors bg-transparent ${errors.price ? 'border-red-500 text-red-600' : 'border-gray-100 hover:border-gray-300 focus:border-red-500 text-gray-900'
                                }`}
                            />
                          </div>
                          {errors.price && <p className="text-red-500 text-[10px] mt-1 font-bold italic">{errors.price}</p>}
                          
                          {/* Resumen de precio al público y toggle */}
                          {formData.price && Number(formData.price) > 0 && (
                            <div className="mt-2 flex items-center gap-3 animate-in fade-in slide-in-from-left-2 duration-300">
                              <p className="text-[10px] font-bold text-slate-500">
                                Precio al público: <span className="text-slate-900">${formData.commissionType === 'fuddi_assumed_by_customer' 
                                   ? (Math.round(Number(formData.price) * (1 + commissionSettings.commissionRate / 100) * 20) / 20).toFixed(2) 
                                   : Number(formData.price).toFixed(2)}</span>
                              </p>
                              <button
                                type="button"
                                onClick={() => setShowCommissionSettings(!showCommissionSettings)}
                                className="text-[10px] font-black text-blue-600 uppercase tracking-widest hover:text-blue-700 flex items-center gap-1 transition-colors"
                              >
                                {showCommissionSettings ? 'Ver menos' : 'Ver más'}
                                <i className={`bi ${showCommissionSettings ? 'bi-chevron-up' : 'bi-chevron-down'}`}></i>
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Descripción */}
                        <div>
                          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1 ml-1">Descripción</label>
                          <textarea
                            name="description"
                            value={formData.description}
                            onChange={handleInputChange}
                            rows={3}
                            placeholder="Cuéntanos más sobre este delicioso producto..."
                            className={`w-full px-4 py-2.5 bg-gray-50 border-2 rounded-xl focus:outline-none transition-all text-sm font-medium ${errors.description ? 'border-red-500 text-red-600' : 'border-gray-50 hover:border-gray-200 focus:border-red-500 focus:bg-white'
                              }`}
                          />
                          {errors.description && <p className="text-red-500 text-[10px] mt-1 font-bold italic">{errors.description}</p>}
                        </div>
                      </div>
                    </div>

                    {/* Estructura del Producto / Opciones de Personalización */}
                    <div className="border-t border-gray-100 pt-6 space-y-4">
                      <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Configuración y Estructura</label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {/* Tarjeta Con Variantes */}
                        <button
                          type="button"
                          onClick={() => {
                            const newHasVariants = !hasVariants;
                            setHasVariants(newHasVariants);
                            if (!newHasVariants) {
                              setFormData(prev => ({ ...prev, isCombo: false }));
                            }
                          }}
                          className={`p-4 rounded-xl border-2 text-left transition-all flex flex-col justify-between h-28 group ${
                            hasVariants
                              ? 'border-blue-500 bg-blue-50/20'
                              : 'border-gray-100 bg-gray-50/50 hover:bg-white hover:border-gray-200'
                          }`}
                        >
                          <div className="flex justify-between items-start w-full">
                            <i className="bi bi-layers text-xl text-blue-600"></i>
                            <input
                              type="checkbox"
                              checked={hasVariants}
                              onChange={() => {}}
                              className="w-4 h-4 rounded text-blue-600"
                            />
                          </div>
                          <div>
                            <span className="font-bold text-xs text-gray-900 block">Con Variantes</span>
                            <span className="text-[10px] text-gray-500 leading-tight block mt-0.5">Diferentes precios, tamaños o sabores</span>
                          </div>
                        </button>

                        {/* Tarjeta Es Combo */}
                        <button
                          type="button"
                          onClick={() => {
                            const newIsCombo = !formData.isCombo;
                            setFormData(prev => ({ ...prev, isCombo: newIsCombo }));
                            if (newIsCombo) {
                              setHasVariants(true);
                            }
                          }}
                          className={`p-4 rounded-xl border-2 text-left transition-all flex flex-col justify-between h-28 group ${
                            formData.isCombo
                              ? 'border-orange-500 bg-orange-50/20'
                              : 'border-gray-100 bg-gray-50/50 hover:bg-white hover:border-gray-200'
                          }`}
                        >
                          <div className="flex justify-between items-start w-full">
                            <i className="bi bi-box-seam text-xl text-orange-600"></i>
                            <input
                              type="checkbox"
                              checked={formData.isCombo}
                              onChange={() => {}}
                              className="w-4 h-4 rounded text-orange-600"
                            />
                          </div>
                          <div>
                            <span className="font-bold text-xs text-gray-900 block">Es un Combo</span>
                            <span className="text-[10px] text-gray-500 leading-tight block mt-0.5">Armar paquetes seleccionando elementos</span>
                          </div>
                        </button>
                      </div>
                    </div>

                    {/* Divider and Additional Settings */}
                    <div className="border-t border-gray-100 pt-6 space-y-6">
                      
                      {/* Categoría y Disponibilidad en una fila */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 items-end">
                        {/* Categoría */}
                        <div>
                          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 ml-1">Categoría</label>
                          <div className="relative">
                            <input
                              type="text"
                              name="category"
                              list="categories-list"
                              value={formData.category}
                              onChange={handleInputChange}
                              placeholder="Escribe o selecciona una categoría..."
                              className="w-full px-4 py-3 bg-gray-50 border-2 border-gray-50 hover:border-gray-200 focus:border-red-500 focus:bg-white rounded-xl focus:outline-none transition-all text-base font-medium"
                            />
                            <datalist id="categories-list">
                              {categories.map((cat) => (
                                <option key={cat} value={cat} />
                              ))}
                            </datalist>
                          </div>
                        </div>

                        {/* Disponibilidad */}
                        <label className="flex items-center gap-3 p-3.5 bg-gray-50 rounded-xl cursor-pointer hover:bg-gray-100 transition-colors border border-gray-100">
                          <input
                            type="checkbox"
                            checked={formData.isAvailable}
                            onChange={(e) => setFormData(prev => ({ ...prev, isAvailable: e.target.checked }))}
                            className="w-5 h-5 rounded text-red-600 cursor-pointer"
                          />
                          <span className="font-semibold text-gray-700 text-sm">Producto disponible</span>
                        </label>
                      </div>

                      {/* Gestión de Comisión - Colapsable */}
                      {showCommissionSettings && (
                        <div className="bg-slate-50 p-6 rounded-xl border border-slate-100 space-y-6 animate-in fade-in zoom-in duration-300">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-amber-100 text-amber-600 rounded-xl flex items-center justify-center shadow-sm">
                              <i className="bi bi-percent text-xl"></i>
                            </div>
                            <div>
                              <h4 className="font-black text-slate-800 uppercase text-[11px] tracking-[0.2em] leading-none">Gestión de Comisión ({commissionSettings.commissionRate}%)</h4>
                              <p className="text-[10px] text-slate-500 font-medium mt-1">Fuddi cobra una comisión fija del {commissionSettings.commissionRate}% por servicio</p>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <button
                              type="button"
                              onClick={() => setFormData(prev => ({ ...prev, commissionType: 'fuddi_assumed_by_customer' }))}
                              className={`p-5 rounded-xl border-2 text-left transition-all duration-300 group ${
                                formData.commissionType === 'fuddi_assumed_by_customer'
                                  ? 'border-red-500 bg-white shadow-xl shadow-red-100 scale-[1.02]'
                                  : 'border-slate-100 bg-white/50 hover:border-slate-200'
                              }`}
                            >
                              <div className="flex items-center gap-3 mb-3">
                                <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
                                  formData.commissionType === 'fuddi_assumed_by_customer' ? 'border-red-500 bg-red-500' : 'border-slate-200'
                                }`}>
                                  {formData.commissionType === 'fuddi_assumed_by_customer' && <div className="w-2 h-2 bg-white rounded-full"></div>}
                                </div>
                                <span className={`font-bold text-sm transition-colors ${formData.commissionType === 'fuddi_assumed_by_customer' ? 'text-red-600' : 'text-slate-600'}`}>Cliente paga comisión</span>
                              </div>
                              <p className="text-[10px] text-slate-500 leading-relaxed font-medium">
                                El sistema suma el {commissionSettings.commissionRate}% al precio base. <span className="text-slate-800 font-bold">Tú recibes el 100%</span> de tu precio ingresado.
                              </p>
                            </button>

                            <button
                              type="button"
                              onClick={() => setFormData(prev => ({ ...prev, commissionType: 'fuddi_assumed_by_store' }))}
                              className={`p-5 rounded-xl border-2 text-left transition-all duration-300 group ${
                                formData.commissionType === 'fuddi_assumed_by_store'
                                  ? 'border-red-500 bg-white shadow-xl shadow-red-100 scale-[1.02]'
                                  : 'border-slate-100 bg-white/50 hover:border-slate-200'
                              }`}
                            >
                              <div className="flex items-center gap-3 mb-3">
                                <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
                                  formData.commissionType === 'fuddi_assumed_by_store' ? 'border-red-500 bg-red-500' : 'border-slate-200'
                                }`}>
                                  {formData.commissionType === 'fuddi_assumed_by_store' && <div className="w-2 h-2 bg-white rounded-full"></div>}
                                </div>
                                <span className={`font-bold text-sm transition-colors ${formData.commissionType === 'fuddi_assumed_by_store' ? 'text-red-600' : 'text-slate-600'}`}>Negocio asume comisión</span>
                              </div>
                              <p className="text-[10px] text-slate-500 leading-relaxed font-medium">
                                El precio ingresado es el final para el cliente. <span className="text-slate-800 font-bold">Fuddi descuenta el {commissionSettings.commissionRate}%</span> de tu ganancia.
                              </p>
                            </button>
                          </div>

                          {formData.price && Number(formData.price) > 0 && (
                            <div className="p-5 bg-white rounded-xl border border-slate-100 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-6">
                              <div className="flex-1 text-center sm:text-left">
                                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] mb-1">Precio al público</p>
                                  <p className="text-2xl font-black text-slate-900 tracking-tight">
                                    ${formData.commissionType === 'fuddi_assumed_by_customer' 
                                      ? (Math.round(Number(formData.price) * (1 + commissionSettings.commissionRate / 100) * 20) / 20).toFixed(2) 
                                      : Number(formData.price).toFixed(2)}
                                  </p>
                              </div>
                              <div className="hidden sm:block h-10 w-px bg-slate-100"></div>
                              <div className="flex-1 text-center sm:text-right">
                                  <p className="text-[9px] font-black text-emerald-500 uppercase tracking-[0.2em] mb-1">Recibes en tu cuenta</p>
                                  <p className="text-2xl font-black text-emerald-600 tracking-tight">
                                    ${formData.commissionType === 'fuddi_assumed_by_store' 
                                      ? (Number(formData.price) * (1 - commissionSettings.commissionRate / 100)).toFixed(2) 
                                      : Number(formData.price).toFixed(2)}
                                  </p>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Configuración de Combo */}
                    {formData.isCombo && (
                      <div className="border-t pt-6 space-y-4">
                        <div>
                          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">
                            Cantidad de opciones a elegir en el combo
                          </label>
                          <input
                            type="number"
                            min="1"
                            value={formData.minComboItems}
                            onChange={(e) => setFormData(prev => ({ ...prev, minComboItems: Number(e.target.value) }))}
                            className="w-full sm:w-1/2 px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500 font-medium bg-white"
                          />
                          <p className="text-xs text-gray-500 mt-2 font-medium">
                            El cliente deberá seleccionar exactamente esta cantidad de variantes para poder agregar el combo al carrito.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Disponibilidad por Horarios */}
                    <div className="border-t pt-6">
                      <label className="flex items-center gap-3 p-4 bg-blue-50 rounded-lg cursor-pointer hover:bg-blue-100 transition-colors mb-4 border-2 border-blue-100">
                        <input
                          type="checkbox"
                          checked={scheduleEnabled}
                          onChange={(e) => setScheduleEnabled(e.target.checked)}
                          className="w-5 h-5 rounded text-blue-600 cursor-pointer"
                        />
                        <div>
                          <span className="font-bold text-gray-900">Disponibilidad por Horarios</span>
                          <p className="text-xs text-gray-600 mt-0.5">
                            Configura días y horas específicas cuando ese producto está disponible
                          </p>
                        </div>
                      </label>

                      {scheduleEnabled && (
                        <div className="space-y-4 bg-gray-50 p-6 rounded-2xl border border-blue-100">
                          {/* Lista de horarios configurados */}
                          {schedules.length > 0 && (
                            <div className="space-y-2 mb-4">
                              <h5 className="font-semibold text-gray-900 text-sm">Horarios configurados:</h5>
                              {schedules.map(schedule => (
                                <div key={schedule.id} className="flex items-center justify-between bg-white p-3 rounded-lg border border-gray-200">
                                  <div className="flex-1">
                                    <p className="font-medium text-gray-900">
                                      {schedule.days.map(day => dayLabels[day] || day).join(', ')}
                                    </p>
                                    <p className="text-sm text-gray-600 mt-1">
                                      {schedule.startTime} - {schedule.endTime}
                                    </p>
                                  </div>
                                  <div className="flex gap-1">
                                    <button
                                      type="button"
                                      onClick={() => editSchedule(schedule)}
                                      className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                      title="Editar horario"
                                    >
                                      <i className="bi bi-pencil"></i>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => removeSchedule(schedule.id)}
                                      className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                      title="Eliminar horario"
                                    >
                                      <i className="bi bi-trash"></i>
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Formulario para agregar horario */}
                          <div className="space-y-4 p-4 bg-white rounded-lg border-2 border-dashed border-blue-200">
                            <div>
                              <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">
                                Selecciona los días
                              </label>
                              <div className="grid grid-cols-4 gap-2">
                                {daysOfWeek.map(day => (
                                  <button
                                    key={day}
                                    type="button"
                                    onClick={() => toggleDaySelection(day)}
                                    className={`py-2.5 px-2 rounded-lg font-bold text-xs transition-all ${
                                      currentSchedule.days.includes(day)
                                        ? 'bg-blue-600 text-white'
                                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                    }`}
                                  >
                                    {dayLabels[day]}
                                  </button>
                                ))}
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">
                                  Hora inicio
                                </label>
                                <input
                                  type="time"
                                  value={currentSchedule.startTime}
                                  onChange={(e) => setCurrentSchedule(prev => ({ ...prev, startTime: e.target.value }))}
                                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                                />
                              </div>
                              <div>
                                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">
                                  Hora fin
                                </label>
                                <input
                                  type="time"
                                  value={currentSchedule.endTime}
                                  onChange={(e) => setCurrentSchedule(prev => ({ ...prev, endTime: e.target.value }))}
                                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                                />
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={addSchedule}
                              className="w-full bg-blue-600 text-white px-4 py-3 rounded-lg hover:bg-blue-700 transition-colors font-bold flex items-center justify-center gap-2"
                            >
                              <i className={`bi ${editingScheduleId ? 'bi-pencil' : 'bi-plus-lg'}`}></i>
                              {editingScheduleId ? 'Actualizar Horario' : 'Agregar Horario'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Variantes */}
                    {(hasVariants || formData.isCombo) && (
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
                              {/* Imagen de variante */}
                              <div className={`w-12 h-12 flex-shrink-0 rounded-lg overflow-hidden bg-gray-50 border border-gray-100 mr-3 ${variantVisibility[variant.id] === false ? 'grayscale' : ''}`}>
                                {(variantImageFiles[variant.id] || variant.image) ? (
                                  <img 
                                    src={variantImageFiles[variant.id] ? URL.createObjectURL(variantImageFiles[variant.id]) : variant.image} 
                                    className="w-full h-full object-cover" 
                                    alt={variant.name} 
                                  />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-gray-300">
                                    <i className="bi bi-image text-lg"></i>
                                  </div>
                                )}
                              </div>

                              <div className={`flex-1 min-w-0 ${variantVisibility[variant.id] === false ? 'opacity-60 grayscale-[0.5]' : ''}`}>
                                <div className="flex items-center gap-2">
                                  <p className="font-bold text-gray-900 text-sm leading-tight break-words">
                                    {variant.name}
                                  </p>
                                  {variantVisibility[variant.id] === false && (
                                    <span className="text-[8px] font-black bg-gray-200 text-gray-500 px-1 py-0.5 rounded uppercase tracking-widest">
                                      Oculto
                                    </span>
                                  )}
                                </div>
                                {variant.description && (
                                  <p className="text-[10px] text-gray-500 line-clamp-1 mt-0.5 leading-tight">{variant.description}</p>
                                )}
                                <div className="flex flex-col mt-0.5">
                                  <p className="text-sm font-black text-emerald-600 tracking-tight">
                                    ${variant.price.toFixed(2)}
                                  </p>
                                  {/* Nota: En el estado local 'variants' durante la edición, 'price' es el precio base */}
                                  <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">
                                    Público: ${(Math.round(variant.price * (1 + (commissionSettings.commissionRate / 100)) * 20) / 20).toFixed(2)}
                                  </p>
                                </div>
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
                        <div className="space-y-4 bg-gray-50/50 p-4 rounded-2xl border border-dashed border-gray-200 animate-in fade-in slide-in-from-top-2 duration-300">
                          <div className="flex items-center gap-2 mb-1">
                            <div className="w-6 h-6 bg-blue-100 text-blue-600 rounded flex items-center justify-center text-xs">
                              <i className={`bi ${editingVariantId ? 'bi-pencil' : 'bi-plus-lg'}`}></i>
                            </div>
                            <h5 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                              {editingVariantId ? 'Editar Variante' : 'Nueva Variante'}
                            </h5>
                          </div>

                          <div className="flex flex-col sm:flex-row gap-4">
                            {/* Imagen de la variante */}
                            <div className="w-20 h-20 flex-shrink-0 mx-auto sm:mx-0">
                              <label htmlFor="variant-image-upload" className="block cursor-pointer h-full">
                                <div className="relative h-full bg-white rounded-xl border-2 border-dashed border-gray-200 hover:border-blue-400 hover:bg-blue-50 transition-all flex items-center justify-center overflow-hidden group shadow-sm">
                                  {currentVariant.imageFile ? (
                                    <img src={URL.createObjectURL(currentVariant.imageFile)} alt="Preview" className="w-full h-full object-cover" />
                                  ) : currentVariant.imageUrl ? (
                                    <img src={currentVariant.imageUrl} alt="Current" className="w-full h-full object-cover" />
                                  ) : (
                                    <div className="text-center p-2">
                                      <i className="bi bi-camera text-xl text-gray-300 mb-1 block"></i>
                                      <p className="text-[8px] text-gray-400 font-bold uppercase tracking-widest">Foto</p>
                                    </div>
                                  )}
                                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                                    <i className="bi bi-camera text-white text-lg"></i>
                                  </div>
                                </div>
                              </label>
                              <input
                                id="variant-image-upload"
                                type="file"
                                accept="image/*"
                                onChange={(e) => {
                                  const file = e.target.files?.[0]
                                  if (file) {
                                    setCurrentVariant(prev => ({ ...prev, imageFile: file }))
                                  }
                                }}
                                className="hidden"
                              />
                            </div>

                            <div className="flex-1 space-y-3">
                              <input
                                type="text"
                                value={currentVariant.name}
                                onChange={(e) => setCurrentVariant(prev => ({ ...prev, name: e.target.value }))}
                                placeholder="Ej: Tamaño grande, Con queso extra"
                                className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-bold focus:outline-none focus:border-red-500 shadow-sm transition-all"
                                autoFocus
                              />
                              
                              <textarea
                                value={currentVariant.description}
                                onChange={(e) => setCurrentVariant(prev => ({ ...prev, description: e.target.value }))}
                                placeholder="Descripción corta (opcional)"
                                rows={2}
                                className="w-full px-4 py-2 bg-white border border-gray-200 rounded-xl text-xs font-medium focus:outline-none focus:border-red-500 shadow-sm transition-all resize-none"
                              />
                            </div>
                          </div>

                          <div className="space-y-2">
                            <div className="flex gap-2">
                              <div className="relative flex-1">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold">$</span>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={currentVariant.price}
                                  onChange={(e) => setCurrentVariant(prev => ({ ...prev, price: e.target.value }))}
                                  onWheel={(e) => (e.target as HTMLInputElement).blur()}
                                  placeholder="Precio"
                                  className="w-full pl-7 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-bold focus:outline-none focus:border-red-500 shadow-sm transition-all"
                                />
                              </div>
                              <button
                                type="button"
                                onClick={addVariant}
                                className={`px-6 py-2.5 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-lg active:scale-95 ${editingVariantId ? 'bg-amber-500 hover:bg-amber-600 shadow-amber-100' : 'bg-blue-600 hover:bg-blue-700 shadow-blue-100'}`}
                              >
                                {editingVariantId ? 'LISTO' : 'AÑADIR'}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setShowVariantForm(false)
                                  setEditingVariantId(null)
                                  setCurrentVariant({ name: '', price: '', description: '', imageFile: null, imageUrl: '' })
                                }}
                                className="px-4 py-2.5 bg-gray-100 text-gray-500 rounded-xl text-sm font-bold hover:bg-gray-200 transition-all"
                              >
                                <i className="bi bi-x-lg"></i>
                              </button>
                            </div>

                            {/* Resumen de precio al público para el formulario de variante */}
                            {currentVariant.price && Number(currentVariant.price) > 0 && (
                              <p className="text-[10px] font-bold text-slate-500 ml-1 animate-in fade-in slide-in-from-left-1 duration-300">
                                Precio al público: <span className="text-slate-900 font-black">${formData.commissionType === 'fuddi_assumed_by_customer' 
                                 ? (Math.round(Number(currentVariant.price) * (1 + commissionSettings.commissionRate / 100) * 20) / 20).toFixed(2) 
                                 : Number(currentVariant.price).toFixed(2)}</span>
                              </p>
                            )}
                          </div>
                        </div>
                      )}
                      </div>
                    )}
                  </div>
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
                                    onWheel={(e) => (e.target as HTMLInputElement).blur()}
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
                                    onWheel={(e) => (e.target as HTMLInputElement).blur()}
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

                {activeTab === 'options' && (
                  <div className="space-y-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-lg font-bold text-gray-900">Configuración de Toppings</h3>
                        <p className="text-xs text-gray-500 mt-1">Configura las salsas, ingredientes adicionales o aderezos que el cliente puede sumar al producto.</p>
                      </div>
                      <button
                        type="button"
                        onClick={handleAddOptionGroup}
                        className="px-4 py-2.5 bg-red-600 text-white text-xs font-semibold rounded-xl hover:bg-red-700 transition-colors flex items-center gap-2 shadow-sm shadow-red-100"
                      >
                        <i className="bi bi-plus-lg"></i>
                        Nuevo Grupo de Toppings
                      </button>
                    </div>

                    {/* Formulario de edición/creación de un grupo */}
                    {editingGroupIndex !== null && (
                      <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200/60 space-y-5 shadow-inner">
                        <div className="flex items-center gap-2">
                          <div className="w-1.5 h-4 bg-red-500 rounded-full"></div>
                          <h4 className="font-black text-slate-800 text-xs uppercase tracking-wider">
                            {editingGroupIndex === -1 ? 'Crear Grupo de Toppings' : 'Editar Grupo de Toppings'}
                          </h4>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div>
                            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Categoría del Topping</label>
                            <input
                              type="text"
                              value={currentGroup.name}
                              onChange={(e) => setCurrentGroup(prev => ({ ...prev, name: e.target.value }))}
                              placeholder="Ej: Salsas, Quesos, Extras"
                              className="w-full px-4 py-2.5 border border-gray-200 focus:border-red-500 focus:ring-2 focus:ring-red-100 rounded-xl transition-all outline-none text-sm bg-white font-medium text-gray-900"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Mínimo a Elegir</label>
                            <input
                              type="number"
                              min="0"
                              value={currentGroup.minSelect}
                              onChange={(e) => setCurrentGroup(prev => ({ ...prev, minSelect: Math.max(0, parseInt(e.target.value) || 0) }))}
                              className="w-full px-4 py-2.5 border border-gray-200 focus:border-red-500 focus:ring-2 focus:ring-red-100 rounded-xl transition-all outline-none text-sm bg-white font-medium text-gray-900"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Máximo a Elegir</label>
                            <input
                              type="number"
                              min="1"
                              value={currentGroup.maxSelect}
                              onChange={(e) => setCurrentGroup(prev => ({ ...prev, maxSelect: Math.max(1, parseInt(e.target.value) || 1) }))}
                              className="w-full px-4 py-2.5 border border-gray-200 focus:border-red-500 focus:ring-2 focus:ring-red-100 rounded-xl transition-all outline-none text-sm bg-white font-medium text-gray-900"
                            />
                          </div>
                        </div>

                        {/* Listado y formulario de toppings individuales */}
                        <div className="space-y-3 bg-white p-5 rounded-2xl border border-gray-100">
                          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Toppings en este grupo</label>
                          
                          {/* Lista de toppings actuales (Horizontal Pills Layout) */}
                          {currentGroup.options.length > 0 ? (
                            <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto pr-1 py-1">
                              {currentGroup.options.map((opt, oIdx) => (
                                <div key={oIdx} className="flex items-center gap-1.5 bg-gray-50 hover:bg-gray-100/80 px-3 py-1.5 rounded-full border border-gray-200 text-xs font-semibold text-gray-800 shadow-sm transition-all">
                                  <span>{opt.name}</span>
                                  <span className="text-emerald-600 font-bold ml-0.5">
                                    {opt.price > 0 ? `+$${opt.price.toFixed(2)}` : 'Gratis'}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveOptionFromGroup(oIdx)}
                                    className="text-gray-400 hover:text-red-500 w-4 h-4 rounded-full hover:bg-red-50 flex items-center justify-center ml-1 transition-colors"
                                  >
                                    <i className="bi bi-x-lg text-[9px] font-bold"></i>
                                  </button>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-xs text-gray-400 italic font-medium ml-1">No hay toppings agregados aún en esta categoría.</p>
                          )}

                          {/* Fila para agregar topping rápidamente */}
                          <div className="flex flex-col sm:flex-row gap-2 items-center pt-2">
                            <input
                              type="text"
                              placeholder="Nombre del topping (ej: Queso Extra)"
                              value={newOptionName}
                              onChange={(e) => setNewOptionName(e.target.value)}
                              className="w-full sm:flex-1 px-4 py-2.5 border border-gray-200 focus:border-red-500 focus:ring-2 focus:ring-red-100 rounded-xl text-sm outline-none font-medium"
                            />
                            <div className="relative w-full sm:w-32">
                              <span className="absolute left-3.5 top-2.5 text-gray-400 text-sm font-medium">$</span>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                placeholder="Precio"
                                value={newOptionPrice}
                                onChange={(e) => setNewOptionPrice(e.target.value)}
                                className="w-full pl-7 pr-3 py-2.5 border border-gray-200 focus:border-red-500 focus:ring-2 focus:ring-red-100 rounded-xl text-sm outline-none font-medium"
                              />
                            </div>
                            <button
                              type="button"
                              onClick={handleAddOptionToGroup}
                              className="w-full sm:w-auto px-4 py-2.5 bg-gray-900 hover:bg-gray-800 text-white text-xs font-semibold rounded-xl transition-colors flex items-center justify-center gap-1"
                            >
                              <i className="bi bi-plus-lg"></i>
                              Añadir Topping
                            </button>
                          </div>
                        </div>

                        {/* Botones de acción del grupo */}
                        <div className="flex gap-2 pt-3 justify-end border-t border-slate-200/60">
                          <button
                            type="button"
                            onClick={() => setEditingGroupIndex(null)}
                            className="px-4 py-2 border border-gray-300 text-gray-700 text-xs font-semibold rounded-xl hover:bg-gray-100 transition-colors"
                          >
                            Cancelar
                          </button>
                          <button
                            type="button"
                            onClick={handleSaveOptionGroup}
                            className="px-4 py-2 bg-red-600 text-white text-xs font-semibold rounded-xl hover:bg-red-700 transition-colors shadow-sm shadow-red-100"
                          >
                            Guardar Grupo
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Lista de grupos de toppings agregados */}
                    <div className="space-y-4">
                      {optionGroups.length > 0 ? (
                        optionGroups.map((group, idx) => (
                          <div key={group.id} className="bg-white p-5 rounded-2xl border border-slate-100 flex items-start justify-between shadow-sm hover:shadow-md transition-all duration-300">
                            <div className="space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <h4 className="font-bold text-gray-900 text-sm">{group.name}</h4>
                                <span className="bg-slate-100 text-slate-600 text-[9px] font-black uppercase px-2 py-0.5 rounded-md border border-slate-200/40">
                                  {group.minSelect === 0 ? 'Opcional' : `Mínimo: ${group.minSelect}`} | Máximo: {group.maxSelect}
                                </span>
                              </div>
                              
                              <div className="flex flex-wrap gap-1.5">
                                {group.options.map((o, oIdx) => (
                                  <span key={oIdx} className="bg-slate-50 text-slate-700 text-[10px] font-semibold px-2 py-1 rounded-md border border-slate-100 flex items-center gap-1 shadow-sm">
                                    <span>{o.name}</span>
                                    <span className="text-emerald-600 font-bold">
                                      {o.price > 0 ? `+$${o.price.toFixed(2)}` : 'Gratis'}
                                    </span>
                                  </span>
                                ))}
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 ml-4">
                              <button
                                type="button"
                                onClick={() => handleEditOptionGroup(idx)}
                                className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all"
                              >
                                <i className="bi bi-pencil text-sm"></i>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRemoveOptionGroup(idx)}
                                className="p-2 text-gray-300 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
                              >
                                <i className="bi bi-trash text-sm"></i>
                              </button>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="text-center py-10 bg-gray-50 rounded-2xl border border-dashed border-gray-200/80 p-6">
                          <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
                            <i className="bi bi-gear text-lg text-gray-400"></i>
                          </div>
                          <p className="text-sm font-semibold text-gray-600">No hay grupos de toppings configurados</p>
                          <p className="text-xs text-gray-400 mt-1 max-w-xs mx-auto">Crea un grupo de toppings (ej: Salsas, Adicionales) para que tus clientes puedan personalizar su orden.</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

              </div>

              {/* Error general */}
              {errors.submit && (
                <div className="px-6 py-2 bg-red-50 border-t border-red-200 flex-shrink-0">
                  <p className="text-red-600 text-xs font-semibold">{errors.submit}</p>
                </div>
              )}

              {/* Botones */}
              <div className="px-6 py-4 border-t border-gray-100 bg-gray-50/50 flex gap-3 flex-shrink-0">
                <button
                  type="button"
                  onClick={handleCloseForm}
                  disabled={uploading}
                  className="flex-1 px-4 py-3 border border-gray-300 rounded-xl text-gray-700 hover:bg-gray-50 transition-colors font-semibold text-sm disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={uploading}
                  className="flex-1 px-4 py-3 bg-red-600 text-white rounded-xl hover:bg-red-700 transition-colors font-semibold text-sm disabled:opacity-50 flex items-center justify-center gap-2"
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

      {/* Modal del importador JSON de menú */}
      {showJsonImport && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-slate-100 animate-in fade-in zoom-in duration-200 overflow-hidden">
            
            {/* Header del Modal */}
            <div className="p-6 md:p-8 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600">
                  <i className="bi bi-filetype-json text-xl"></i>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-950">Subir Menú mediante JSON</h3>
                  <p className="text-xs text-gray-500">Crea múltiples productos de forma masiva en segundos</p>
                </div>
              </div>
              <button
                onClick={() => !isImporting && setShowJsonImport(false)}
                disabled={isImporting}
                className="w-8 h-8 rounded-full bg-white hover:bg-gray-100 text-gray-400 hover:text-gray-600 border border-gray-200 flex items-center justify-center transition-all shadow-sm disabled:opacity-50"
              >
                <i className="bi bi-x-lg text-sm"></i>
              </button>
            </div>

            {/* Contenido principal */}
            <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6">
              {isImporting ? (
                /* Estado: Importando/Guardando en BD */
                <div className="flex flex-col items-center justify-center py-12 space-y-6">
                  <div className="relative w-20 h-20">
                    <div className="absolute inset-0 rounded-full border-4 border-blue-100" />
                    <div className="absolute inset-0 rounded-full border-4 border-blue-600 border-t-transparent animate-spin" />
                    <div className="absolute inset-0 flex items-center justify-center text-blue-600">
                      <i className="bi bi-cloud-arrow-up text-2xl"></i>
                    </div>
                  </div>
                  <div className="text-center space-y-2">
                    <h4 className="text-base font-bold text-gray-900">Guardando productos en la base de datos...</h4>
                    <p className="text-sm text-gray-500">
                      Procesando {importProgress.current} de {importProgress.total} ({Math.round((importProgress.current / importProgress.total) * 100)}%)
                    </p>
                  </div>
                  <div className="w-full max-w-md bg-gray-100 rounded-full h-2 overflow-hidden shadow-inner">
                    <div
                      className="bg-gradient-to-r from-blue-500 to-indigo-600 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${(importProgress.current / importProgress.total) * 100}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-400 font-medium truncate max-w-sm italic">
                    {parsedProducts[importProgress.current - 1]?.name ? `Subiendo: ${parsedProducts[importProgress.current - 1].name}` : 'Inicializando...'}
                  </p>
                </div>
              ) : parsedProducts.length > 0 ? (
                /* Estado: Visualización Previa de datos parsed */
                <div className="space-y-5">
                  <div className="flex items-center justify-between bg-emerald-50 border border-emerald-100 rounded-2xl p-4 text-emerald-900">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center text-white">
                        <i className="bi bi-check-lg text-lg"></i>
                      </div>
                      <div>
                        <p className="text-sm font-bold">¡JSON analizado correctamente!</p>
                        <p className="text-xs opacity-90">Se encontraron {parsedProducts.length} productos listos para importar.</p>
                      </div>
                    </div>
                    <button
                      onClick={() => setParsedProducts([])}
                      className="text-xs font-bold underline hover:no-underline text-emerald-800"
                    >
                      Editar JSON
                    </button>
                  </div>

                  {/* Resumen y lista */}
                  <div className="space-y-3">
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Previsualización de los Productos</p>
                    <div className="border border-gray-100 rounded-2xl divide-y divide-gray-100 max-h-64 overflow-y-auto custom-scrollbar shadow-sm bg-gray-50/30">
                      {parsedProducts.map((p, index) => (
                        <div key={index} className="p-4 flex items-start justify-between gap-4 text-sm hover:bg-gray-50 transition-colors">
                          <div className="min-w-0">
                            <p className="font-bold text-gray-900 truncate">{p.name}</p>
                            {p.description && <p className="text-xs text-gray-500 truncate mt-0.5">{p.description}</p>}
                            <div className="flex flex-wrap gap-1.5 mt-2">
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 uppercase tracking-wide">
                                {p.category}
                              </span>
                              {p.variants && p.variants.length > 0 && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-purple-50 text-purple-700">
                                  {p.variants.length} variantes
                                </span>
                              )}
                              {p.ingredients && p.ingredients.length > 0 && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-orange-50 text-orange-700">
                                  Con receta ({p.ingredients.length} ing.)
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <span className="font-mono font-bold text-gray-900 bg-gray-100 px-2 py-1 rounded-lg text-xs">
                              ${Number(p.price).toFixed(2)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                /* Estado: Input Textarea de JSON + Instrucciones */
                <div className="space-y-4">
                  <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4">
                    <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">Instrucciones y Formatos</h4>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      Puedes proporcionar el menú en un arreglo general de productos, o agrupados en un objeto cuyas llaves sean las categorías. Los campos requeridos por producto son: <code className="font-mono font-bold text-red-600">name</code> y <code className="font-mono font-bold text-red-600">price</code>.
                    </p>
                    <div className="mt-3">
                      <p className="text-[11px] font-bold text-slate-400 uppercase">Ejemplo en Arreglo:</p>
                      <pre className="bg-slate-900 text-slate-300 p-3 rounded-xl text-[10px] overflow-x-auto font-mono mt-1 max-h-36">
{`[
  {
    "name": "Hamburguesa Clásica",
    "price": 5.50,
    "category": "Hamburguesas",
    "description": "Carne de res, queso cheddar y vegetales",
    "variants": [
      { "name": "Doble Carne", "price": 7.50 }
    ]
  }
]`}
                      </pre>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider">Pega el código JSON aquí</label>
                    <textarea
                      value={jsonText}
                      onChange={(e) => setJsonText(e.target.value)}
                      placeholder="Paste your JSON menu here..."
                      rows={8}
                      className="w-full px-4 py-3 border border-gray-200 rounded-2xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none bg-gray-50 focus:bg-white transition-all shadow-inner"
                    />
                  </div>

                  {jsonError && (
                    <div className="bg-red-50 border border-red-100 rounded-2xl p-4 flex items-start gap-3 text-red-900 animate-in fade-in duration-200">
                      <i className="bi bi-exclamation-triangle-fill text-red-500 mt-0.5 flex-shrink-0 text-lg"></i>
                      <div className="text-xs font-medium space-y-1">
                        <p className="font-bold">Error de validación o sintaxis:</p>
                        <pre className="whitespace-pre-wrap font-mono break-all opacity-90 max-h-32 overflow-y-auto">{jsonError}</pre>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer del Modal */}
            <div className="p-6 md:p-8 border-t border-gray-100 bg-gray-50/50 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowJsonImport(false)}
                disabled={isImporting}
                className="px-5 py-2.5 bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 rounded-xl text-sm font-bold transition-all shadow-sm active:scale-95 disabled:opacity-50"
              >
                Cancelar
              </button>

              {parsedProducts.length > 0 ? (
                <button
                  type="button"
                  onClick={handleImportProducts}
                  disabled={isImporting}
                  className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-bold transition-all shadow-sm active:scale-95 flex items-center gap-2 disabled:opacity-50"
                >
                  <i className="bi bi-cloud-arrow-up-fill text-base"></i>
                  Confirmar e Importar ({parsedProducts.length})
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleParseJson}
                  disabled={isImporting || !jsonText.trim()}
                  className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-bold transition-all shadow-sm active:scale-95 flex items-center gap-2 disabled:opacity-50 disabled:hover:bg-blue-600"
                >
                  <i className="bi bi-gear-wide-connected text-base"></i>
                  Procesar JSON
                </button>
              )}
            </div>

          </div>
        </div>
      )}

      {/* Modal para Añadidos Rápidos */}
      {quickAddonProduct && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-[2.5rem] max-w-lg w-full max-h-[85vh] overflow-y-auto shadow-2xl border border-slate-100 animate-in fade-in zoom-in duration-300 flex flex-col">
            {/* Header */}
            <div className="p-6 md:p-8 border-b border-gray-100 flex justify-between items-center bg-white sticky top-0 z-10">
              <div>
                <h3 className="text-xl font-bold text-gray-900">Configurar Añadidos Rápidos</h3>
                <p className="text-xs text-gray-500 mt-1">
                  Recomendar complementos para <strong>{quickAddonProduct.name}</strong>
                </p>
              </div>
              <button
                onClick={() => setQuickAddonProduct(null)}
                className="text-gray-400 hover:text-gray-600 w-8 h-8 rounded-full flex items-center justify-center hover:bg-gray-100 transition-colors"
              >
                <i className="bi bi-x-lg text-lg"></i>
              </button>
            </div>

            {/* List */}
            <div className="p-6 md:p-8 overflow-y-auto flex-1 space-y-6">
              {categories.map((categoryName) => {
                // Get products of this category (excluding the current product itself)
                const categoryProducts = products.filter(
                  (p) => p.category === categoryName && p.id !== quickAddonProduct.id
                )

                if (categoryProducts.length === 0) return null

                return (
                  <div key={categoryName} className="space-y-3">
                    <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest border-b border-gray-100 pb-2">
                      {categoryName}
                    </h4>
                    <div className="space-y-2">
                      {categoryProducts.map((p) => {
                        const isChecked = selectedAddonIds.includes(p.id)
                        return (
                          <label
                            key={p.id}
                            className={`flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer select-none ${
                              isChecked
                                ? 'border-emerald-500 bg-emerald-50/50'
                                : 'border-gray-100 hover:border-gray-200 bg-white'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {
                                  if (isChecked) {
                                    setSelectedAddonIds(selectedAddonIds.filter((id) => id !== p.id))
                                  } else {
                                    setSelectedAddonIds([...selectedAddonIds, p.id])
                                  }
                                }}
                                className="w-4.5 h-4.5 text-emerald-600 border-gray-300 rounded focus:ring-emerald-500 cursor-pointer"
                              />
                              <div>
                                <span className="font-bold text-gray-900 text-sm block">
                                  {p.name}
                                </span>
                                {p.description && (
                                  <span className="text-[11px] text-gray-400 line-clamp-1">
                                    {p.description}
                                  </span>
                                )}
                              </div>
                            </div>
                            <span className="font-semibold text-gray-600 text-xs bg-gray-100 px-2 py-0.5 rounded-lg">
                              ${p.price.toFixed(2)}
                            </span>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                )
              })}

              {products.filter((p) => p.id !== quickAddonProduct.id).length === 0 && (
                <div className="text-center py-8 text-gray-500 text-sm">
                  No hay otros productos disponibles para configurar como añadidos rápidos.
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-6 md:p-8 border-t border-gray-100 bg-gray-50/50 flex items-center justify-end gap-3 sticky bottom-0">
              <button
                type="button"
                onClick={() => setQuickAddonProduct(null)}
                className="px-5 py-2.5 bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 rounded-xl text-sm font-bold transition-all shadow-sm active:scale-95"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await updateProduct(quickAddonProduct.id, { quickAddons: selectedAddonIds })
                    onProductsChange(
                      products.map((p) =>
                        p.id === quickAddonProduct.id ? { ...p, quickAddons: selectedAddonIds } : p
                      )
                    )
                    setQuickAddonProduct(null)
                    alert('Añadidos rápidos configurados con éxito.')
                  } catch (e) {
                    console.error('Error saving quick addons:', e)
                    alert('Error al guardar la configuración de añadidos rápidos.')
                  }
                }}
                className="px-6 py-2.5 bg-gray-950 hover:bg-black text-white rounded-xl text-sm font-bold transition-all shadow-sm active:scale-95 flex items-center gap-2"
              >
                <i className="bi bi-check2 text-base"></i>
                Guardar Cambios
              </button>
            </div>
          </div>
        </div>
      )}

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
