'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Business, Product, ProductVariant, Ingredient, CommissionType, ProductOption, ProductOptionGroup } from '@/types'
import { createProduct, updateProduct, deleteProduct, uploadImage, getIngredientLibrary, addOrUpdateIngredientInLibrary, IngredientLibraryItem, updateBusiness, getAllBusinesses, getProductsByBusiness, getProductsByIds, getBranchesForBusiness } from '@/lib/database'
import { optimizeImage } from '@/lib/image-utils'
import { calculateCommissionPricing, getBusinessCommissionSettings } from '@/lib/price-utils'

interface ProductListProps {
  business: Business | null
  products: Product[]
  categories: string[]
  onProductsChange: (products: Product[]) => void
  onCategoriesChange: (categories: string[]) => void
  onDirectUpdate?: (field: keyof Business, value: any) => Promise<void>
  onBusinessChange?: (businessId: string) => void
}

export default function ProductList({
  business,
  products,
  categories,
  onProductsChange,
  onCategoriesChange,
  onDirectUpdate,
  onBusinessChange
}: ProductListProps) {
  const [isMounted, setIsMounted] = useState(false)

  useEffect(() => {
    setIsMounted(true)
  }, [])

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
    countComboUnits: false,
    imagePosition: '50% 50%',
    imageScale: 1
  })
  const [isPanningImage, setIsPanningImage] = useState(false)
  const [showEncuadreDetails, setShowEncuadreDetails] = useState(false)
  const panStartRef = useRef<{ startX: number; startY: number; initPosX: number; initPosY: number } | null>(null)
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
  const isSubscription =
    business?.defaultCommissionType === 'subscription' ||
    business?.defaultCommissionType === 'no_commission' ||
    commissionSettings.commissionRate <= 0 ||
    formData.commissionType === 'subscription' ||
    formData.commissionType === 'no_commission'
  const [showCommissionSettings, setShowCommissionSettings] = useState(false)
  const [editingVariantId, setEditingVariantId] = useState<string | null>(null)
  const [showVariantForm, setShowVariantForm] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [uploading, setUploading] = useState(false)
  const [isDraggingImage, setIsDraggingImage] = useState(false)
  const [isDraggingVariantImage, setIsDraggingVariantImage] = useState(false)
  const [isCreatingNewCategory, setIsCreatingNewCategory] = useState(false)
  const [isCategoryDropdownOpen, setIsCategoryDropdownOpen] = useState(false)
  const categoryDropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (categoryDropdownRef.current && !categoryDropdownRef.current.contains(event.target as Node)) {
        setIsCategoryDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])


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
  const [availableBranches, setAvailableBranches] = useState<Business[]>([])

  // Cargar únicamente las sucursales vinculadas a este mismo negocio
  useEffect(() => {
    if (!business?.id) {
      setAvailableBranches([])
      return
    }

    let isMounted = true
    getBranchesForBusiness(business.id)
      .then(list => {
        if (isMounted) {
          setAvailableBranches(list && list.length > 0 ? list : [])
        }
      })
      .catch(err => {
        console.error('Error loading branches in ProductList:', err)
        if (isMounted) setAvailableBranches([])
      })

    return () => {
      isMounted = false
    }
  }, [business?.id])

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
  const [editingOptionIndex, setEditingOptionIndex] = useState<number | null>(null)
  const [editingOptionName, setEditingOptionName] = useState('')
  const [editingOptionPrice, setEditingOptionPrice] = useState('')

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

  // Bloquear el scroll de la página de fondo cuando algún modal esté abierto
  useEffect(() => {
    if (showProductForm || showJsonImport || !!quickAddonProduct) {
      const originalOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => {
        document.body.style.overflow = originalOverflow
      }
    }
  }, [showProductForm, showJsonImport, quickAddonProduct])

  // Estados para Productos Compartidos
  const [activeSection, setActiveSection] = useState<'mis-productos' | 'compartidos'>('mis-productos')
  const [allBusinesses, setAllBusinesses] = useState<Business[]>([])
  const [selectedSearchBusinessId, setSelectedSearchBusinessId] = useState<string>('')
  const [searchBusinessProducts, setSearchBusinessProducts] = useState<Product[]>([])
  const [sharedProducts, setSharedProducts] = useState<Product[]>([])
  const [loadingShared, setLoadingShared] = useState(false)
  const [loadingSearchProducts, setLoadingSearchProducts] = useState(false)

  // Cargar lista de negocios y productos compartidos actuales
  useEffect(() => {
    if (!business?.id) return;

    // Cargar todos los negocios una vez
    getAllBusinesses().then(bizs => {
      // Filtrar el negocio actual
      setAllBusinesses(bizs.filter(b => b.id !== business.id && b.isActive !== false))
    }).catch(err => console.error('Error loading businesses in ProductList:', err))
  }, [business?.id])

  // Cargar los productos compartidos actuales cuando cambie sharedProductIds
  useEffect(() => {
    if (!business?.id) return;

    const loadSharedProducts = async () => {
      if (business.sharedProductIds && business.sharedProductIds.length > 0) {
        setLoadingShared(true)
        try {
          const prods = await getProductsByIds(business.sharedProductIds)
          setSharedProducts(prods)
        } catch (e) {
          console.error('Error loading shared products:', e)
        } finally {
          setLoadingShared(false)
        }
      } else {
        setSharedProducts([])
      }
    }

    void loadSharedProducts()
  }, [business?.id, business?.sharedProductIds])

  // Cargar productos del negocio seleccionado para buscar
  useEffect(() => {
    if (!selectedSearchBusinessId) {
      setSearchBusinessProducts([])
      return
    }

    const loadSearchBusinessProducts = async () => {
      setLoadingSearchProducts(true)
      try {
        const prods = await getProductsByBusiness(selectedSearchBusinessId)
        // Filtrar solo los disponibles
        setSearchBusinessProducts(prods.filter(p => p.isAvailable))
      } catch (e) {
        console.error('Error loading search business products:', e)
      } finally {
        setLoadingSearchProducts(false)
      }
    }

    void loadSearchBusinessProducts()
  }, [selectedSearchBusinessId])

  const handleToggleShareProduct = async (productId: string, isSharedCurrently: boolean) => {
    if (!business?.id) return;

    const currentSharedIds = business.sharedProductIds || []
    let newSharedIds: string[]

    if (isSharedCurrently) {
      newSharedIds = currentSharedIds.filter(id => id !== productId)
    } else {
      if (currentSharedIds.includes(productId)) return
      newSharedIds = [...currentSharedIds, productId]
    }

    try {
      await updateBusiness(business.id, { sharedProductIds: newSharedIds })

      // Intentar actualizar a través de la callback onDirectUpdate si está disponible
      if (onDirectUpdate) {
        await onDirectUpdate('sharedProductIds', newSharedIds)
      } else {
        // Fallback
        business.sharedProductIds = newSharedIds
      }

      alert(isSharedCurrently ? 'Producto quitado de compartidos.' : 'Producto compartido con éxito en tu tienda.')
    } catch (e) {
      console.error('Error sharing product:', e)
      alert('Error al actualizar la lista de productos compartidos.')
    }
  }

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

  // Categorías exclusivas que realmente existen en los productos del negocio actual
  const businessCategories = React.useMemo(() => {
    const fromProducts = Array.from(
      new Set(products.map(p => (p.category || '').trim()).filter(Boolean))
    ).filter(c => c && c.toLowerCase() !== 'sin categoría' && c.toLowerCase() !== 'sin categoria');
    return fromProducts;
  }, [products]);

  const handleOpenNewProduct = () => {
    setEditingProduct(null)
    const defaultCategory = businessCategories.length > 0 ? businessCategories[0] : ''
    setIsCreatingNewCategory(businessCategories.length === 0)
    const isSub = business?.defaultCommissionType === 'subscription' ||
      business?.defaultCommissionType === 'no_commission' ||
      (typeof business?.commissionRate === 'number' && business?.commissionRate <= 0) ||
      commissionSettings.commissionRate <= 0
    const defaultCommType = isSub ? 'subscription' : (business?.defaultCommissionType || 'fuddi_assumed_by_customer')

    setFormData({
      name: '',
      description: '',
      price: '',
      category: defaultCategory,
      isAvailable: true,
      image: null,
      commissionType: defaultCommType as CommissionType,
      isCombo: false,
      minComboItems: 1,
      countComboUnits: false,
      imagePosition: '50% 50%',
      imageScale: 1
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
    setIsDraggingImage(false)
    setIsDraggingVariantImage(false)
    loadIngredientLibrary()
    setShowProductForm(true)
  }

  // Agrupar productos: categorías reales que tienen los productos de este negocio
  const allCategories = React.useMemo(() => {
    const fromProducts = Array.from(
      new Set(products.map(p => (p.category || '').trim()).filter(Boolean))
    ).filter(c => c.toLowerCase() !== 'sin categoría' && c.toLowerCase() !== 'sin categoria');

    // Si hay productos sin ninguna categoría, añadimos un placeholder si no existe
    if (products.some(p => !p.category || p.category === 'Sin categoría' || p.category === 'Sin categoria')) {
      fromProducts.push('Sin categoría');
    }
    return fromProducts;
  }, [products]);

  // Sincronización automática de categorías del negocio según sus productos reales
  useEffect(() => {
    if (products.length > 0 && business?.id && onCategoriesChange && onDirectUpdate) {
      const fromProducts = Array.from(
        new Set(products.map(p => (p.category || '').trim()).filter(c => c && c.toLowerCase() !== 'sin categoría' && c.toLowerCase() !== 'sin categoria'))
      );

      const isDifferent = fromProducts.length !== categories.length ||
        fromProducts.some(c => !categories.includes(c)) ||
        categories.some(c => !fromProducts.includes(c));

      if (isDifferent) {
        onCategoriesChange(fromProducts);
        onDirectUpdate('categories', fromProducts);
      }
    }
  }, [products, categories, business?.id, onCategoriesChange, onDirectUpdate]);

  const handleEditProduct = (product: Product) => {
    setEditingProduct(product)
    const currentCat = (product.category || '').trim()
    const isSinCat = !currentCat || currentCat.toLowerCase() === 'sin categoría' || currentCat.toLowerCase() === 'sin categoria'
    const exists = !isSinCat && businessCategories.includes(currentCat)
    const categoryToSet = isSinCat
      ? (businessCategories.length > 0 ? businessCategories[0] : '')
      : currentCat
    setIsCreatingNewCategory(businessCategories.length === 0 || (!isSinCat && !exists))

    const isSub = business?.defaultCommissionType === 'subscription' ||
      business?.defaultCommissionType === 'no_commission' ||
      (typeof business?.commissionRate === 'number' && business?.commissionRate <= 0) ||
      commissionSettings.commissionRate <= 0
    const commType = isSub
      ? 'subscription'
      : (product.commissionType || business?.defaultCommissionType || 'fuddi_assumed_by_customer')

    setFormData({
      name: product.name,
      description: product.description,
      price: (product.basePrice || product.price).toString(),
      category: categoryToSet,
      isAvailable: product.isAvailable,
      image: null,
      commissionType: commType as CommissionType,
      isCombo: product.isCombo || false,
      minComboItems: product.minComboItems || 1,
      countComboUnits: product.countComboUnits || false,
      imagePosition: product.imagePosition || '50% 50%',
      imageScale: product.imageScale || 1
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
    loadIngredientLibrary()

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
    setHasVariants(!!(product.variants && product.variants.length > 0) || !!product.isCombo)
    setIsDraggingImage(false)
    setIsDraggingVariantImage(false)
    setShowProductForm(true)
  }

  const handleCloseForm = () => {
    setShowProductForm(false)
    setEditingProduct(null)
    setIsCreatingNewCategory(false)
    const defaultCategory = businessCategories.length > 0 ? businessCategories[0] : ''
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
      countComboUnits: false,
      imagePosition: '50% 50%',
      imageScale: 1
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
    setEditingOptionIndex(null)
    setEditingOptionName('')
    setEditingOptionPrice('')
    setIsDraggingImage(false)
    setIsDraggingVariantImage(false)
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
    setEditingOptionIndex(null)
    setEditingOptionName('')
    setEditingOptionPrice('')
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
    setEditingOptionIndex(null)
    setEditingOptionName('')
    setEditingOptionPrice('')
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
      options: [...prev.options, { name: newOptionName.trim(), price, isAvailable: true }]
    }))
    setNewOptionName('')
    setNewOptionPrice('')
  }

  const handleRemoveOptionFromGroup = (oIdx: number) => {
    setCurrentGroup(prev => ({
      ...prev,
      options: prev.options.filter((_, i) => i !== oIdx)
    }))
    if (editingOptionIndex === oIdx) {
      setEditingOptionIndex(null)
    } else if (editingOptionIndex !== null && editingOptionIndex > oIdx) {
      setEditingOptionIndex(editingOptionIndex - 1)
    }
  }

  const handleStartEditOption = (oIdx: number, opt: ProductOption) => {
    setEditingOptionIndex(oIdx)
    setEditingOptionName(opt.name)
    setEditingOptionPrice(opt.price.toString())
  }

  const handleSaveEditingOption = (oIdx: number) => {
    if (!editingOptionName.trim()) {
      alert('El nombre del modificador/opción es requerido')
      return
    }
    const price = Number(editingOptionPrice) || 0
    if (price < 0) {
      alert('El precio no puede ser negativo')
      return
    }
    setCurrentGroup(prev => {
      const updatedOptions = [...prev.options]
      updatedOptions[oIdx] = {
        ...updatedOptions[oIdx],
        name: editingOptionName.trim(),
        price
      }
      return {
        ...prev,
        options: updatedOptions
      }
    })
    setEditingOptionIndex(null)
  }

  const handleToggleOptionAvailability = (oIdx: number) => {
    setCurrentGroup(prev => {
      const updatedOptions = [...prev.options]
      const currentOpt = updatedOptions[oIdx]
      // Si isAvailable es undefined o true → se pone en false; si es false → se pone en true
      updatedOptions[oIdx] = {
        ...currentOpt,
        isAvailable: currentOpt.isAvailable === false ? true : false
      }
      return {
        ...prev,
        options: updatedOptions
      }
    })
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

  const handleDragOverImage = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === "dragenter" || e.type === "dragover") {
      setIsDraggingImage(true)
    } else if (e.type === "dragleave") {
      setIsDraggingImage(false)
    }
  }

  const handleDropImage = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDraggingImage(false)
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0]
      if (file.type.startsWith('image/')) {
        setFormData(prev => ({ ...prev, image: file }))
      }
    }
  }

  const handleDragOverVariantImage = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === "dragenter" || e.type === "dragover") {
      setIsDraggingVariantImage(true)
    } else if (e.type === "dragleave") {
      setIsDraggingVariantImage(false)
    }
  }

  const handleDropVariantImage = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDraggingVariantImage(false)
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0]
      if (file.type.startsWith('image/')) {
        setCurrentVariant(prev => ({ ...prev, imageFile: file }))
      }
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

  // Carga y consolidación automática de la biblioteca de ingredientes
  const loadIngredientLibrary = useCallback(async () => {
    if (!business?.id) return
    try {
      const lib = await getIngredientLibrary(business.id)
      const libMap = new Map<string, IngredientLibraryItem>()
      lib.forEach(item => {
        if (item.name && item.name.trim()) {
          libMap.set(item.name.toLowerCase().trim(), item)
        }
      })

      // Retroalimentación automática: consolidar insumos existentes en productos y variantes de la tienda
      if (products && Array.isArray(products)) {
        products.forEach(prod => {
          (prod.ingredients || []).forEach((ing: any) => {
            if (ing.name && ing.name.trim()) {
              const key = ing.name.toLowerCase().trim()
              if (!libMap.has(key)) {
                libMap.set(key, {
                  id: ing.id || Date.now().toString(),
                  name: ing.name.trim(),
                  unitCost: Number(ing.unitCost) || 0,
                  usageCount: 1,
                  lastUsed: new Date()
                })
              }
            }
          });
          (prod.variants || []).forEach((v: any) => {
            (v.ingredients || []).forEach((ing: any) => {
              if (ing.name && ing.name.trim()) {
                const key = ing.name.toLowerCase().trim()
                if (!libMap.has(key)) {
                  libMap.set(key, {
                    id: ing.id || Date.now().toString(),
                    name: ing.name.trim(),
                    unitCost: Number(ing.unitCost) || 0,
                    usageCount: 1,
                    lastUsed: new Date()
                  })
                }
              }
            })
          })
        })
      }

      const sortedLib = Array.from(libMap.values()).sort((a, b) => a.name.localeCompare(b.name))
      setIngredientLibrary(sortedLib)
    } catch (e) {
      console.error('Error loading ingredient library:', e)
    }
  }, [business?.id, products])

  useEffect(() => {
    loadIngredientLibrary()
  }, [loadIngredientLibrary])

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
    setCurrentIngredient(prev => ({
      ...prev,
      name: ingredient.name,
      unitCost: ingredient.unitCost.toString(),
      quantity: prev.quantity || '1'
    }))
    setIngredientSearchTerm(ingredient.name)
    setShowIngredientSuggestions(false)
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

    const ingName = currentIngredient.name.trim()
    const newIngredient = {
      id: Date.now().toString(),
      name: ingName,
      unitCost: unitCost,
      quantity: quantity
    }

    const nextIngredients = [...ingredients, newIngredient]
    setIngredients(nextIngredients)
    setCurrentIngredient({ name: '', unitCost: '', quantity: '' })
    setShowIngredientSuggestions(false)
    setIngredientSearchTerm('')

    if (business?.id) {
      // Retroalimentación optimista e instantánea en la biblioteca local
      setIngredientLibrary(prev => {
        const key = ingName.toLowerCase()
        const exists = prev.some(item => item.name.toLowerCase() === key)
        if (exists) {
          return prev.map(item => item.name.toLowerCase() === key ? { ...item, unitCost } : item)
        }
        return [...prev, { id: Date.now().toString(), name: ingName, unitCost, usageCount: 1, lastUsed: new Date() }].sort((a, b) => a.name.localeCompare(b.name))
      })

      await addOrUpdateIngredientInLibrary(business.id, ingName, unitCost)
      loadIngredientLibrary()
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

    const ingName = currentIngredient.name.trim()
    const newIngredient = {
      id: Date.now().toString(),
      name: ingName,
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
      // Retroalimentación optimista e instantánea en la biblioteca local
      setIngredientLibrary(prev => {
        const key = ingName.toLowerCase()
        const exists = prev.some(item => item.name.toLowerCase() === key)
        if (exists) {
          return prev.map(item => item.name.toLowerCase() === key ? { ...item, unitCost } : item)
        }
        return [...prev, { id: Date.now().toString(), name: ingName, unitCost, usageCount: 1, lastUsed: new Date() }].sort((a, b) => a.name.localeCompare(b.name))
      })

      await addOrUpdateIngredientInLibrary(business.id, ingName, unitCost)
      loadIngredientLibrary()
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

  // Funciones de Encuadre, Pan y Zoom interactivo
  const parseImagePosition = (pos: string = '50% 50%') => {
    const parts = (pos || '50% 50%').trim().split(/\s+/);
    let x = 50;
    let y = 50;
    if (parts.length === 1) {
      if (parts[0] === 'center') { x = 50; y = 50; }
      else {
        const val = parseFloat(parts[0]);
        if (!isNaN(val)) { x = val; y = val; }
      }
    } else if (parts.length >= 2) {
      if (parts[0] === 'center') x = 50;
      else {
        const valX = parseFloat(parts[0]);
        if (!isNaN(valX)) x = valX;
      }
      if (parts[1] === 'center') y = 50;
      else {
        const valY = parseFloat(parts[1]);
        if (!isNaN(valY)) y = valY;
      }
    }
    return {
      x: Math.max(0, Math.min(100, Math.round(x))),
      y: Math.max(0, Math.min(100, Math.round(y)))
    };
  };

  const handlePanStart = (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    const hasImg = !!(formData.image || editingProduct?.image);
    if (!hasImg) return;
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const { x, y } = parseImagePosition(formData.imagePosition);
    panStartRef.current = { startX: clientX, startY: clientY, initPosX: x, initPosY: y };
    setIsPanningImage(true);
  };

  const handlePanMove = (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    if (!panStartRef.current) return;
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const deltaX = clientX - panStartRef.current.startX;
    const deltaY = clientY - panStartRef.current.startY;

    const zoom = formData.imageScale || 1;
    const sensitivity = 0.4 / zoom;
    let newX = Math.round(panStartRef.current.initPosX - deltaX * sensitivity);
    let newY = Math.round(panStartRef.current.initPosY - deltaY * sensitivity);
    newX = Math.max(0, Math.min(100, newX));
    newY = Math.max(0, Math.min(100, newY));

    setFormData(prev => ({ ...prev, imagePosition: `${newX}% ${newY}%` }));
  };

  const handlePanEnd = () => {
    panStartRef.current = null;
    setIsPanningImage(false);
  };

  const handleZoomChange = (newScale: number) => {
    const scale = Math.max(1, Math.min(3, Math.round(newScale * 100) / 100));
    setFormData(prev => ({ ...prev, imageScale: scale }));
  };

  const handleWheelZoom = (e: React.WheelEvent<HTMLDivElement>) => {
    const hasImg = !!(formData.image || editingProduct?.image);
    if (!hasImg) return;
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.1 : -0.1;
    const cur = formData.imageScale || 1;
    handleZoomChange(cur + delta);
  };

  const handleResetPosition = () => {
    setFormData(prev => ({ ...prev, imagePosition: '50% 50%', imageScale: 1 }));
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!business?.id) return

    const newErrors: Record<string, string> = {}
    if (!formData.name.trim()) newErrors.name = 'El nombre es requerido'
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

      const cleanCategory = (formData.category || '').trim();
      const finalCategory = (cleanCategory === '' || cleanCategory.toLowerCase() === 'sin categoría' || cleanCategory.toLowerCase() === 'sin categoria') ? '' : cleanCategory;

      const productData = {
        name: formData.name,
        description: formData.description,
        price: productPricing.publicPrice,
        basePrice: productPricing.storePrice,
        commission: productPricing.commission,
        commissionType: productPricing.commissionType,
        category: finalCategory,
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
        countComboUnits: formData.isCombo ? !!formData.countComboUnits : false,
        optionGroups: optionGroups.length > 0 ? optionGroups : undefined,
        imagePosition: formData.imagePosition,
        imageScale: formData.imageScale || 1,
        businessId: business.id,
        updatedAt: new Date()
      }

      // 0. Sincronizar categoría con la lista maestra del negocio si es nueva
      if (finalCategory && !categories.includes(finalCategory)) {
        const updatedCategories = [...categories, finalCategory];
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
        imagePosition: product.imagePosition || '50% 50%',
        imageScale: product.imageScale || 1,
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
      {/* Selector de Pestaña Principal y Selector de Sucursales (Estilo Premium) */}
      <div className="flex flex-col md:flex-row gap-4 justify-between md:items-center bg-white p-5 sm:p-6 rounded-3xl border border-gray-100 shadow-sm">
        <div className="space-y-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-xl font-black text-gray-900 flex items-center gap-2 tracking-tight leading-tight">
              <i className="bi bi-box-seam text-[#aa1918]" />
              {activeSection === 'mis-productos' ? 'Mis Productos' : 'Productos Compartidos'}
            </h2>

            {/* Badge de Sucursal Actual */}
            {business && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-rose-50 text-rose-700 border border-rose-200/80 rounded-full text-xs font-black">
                <i className="bi bi-geo-alt-fill text-[11px] text-rose-500"></i>
                {business.branchName || (business.isBranch ? 'Sucursal' : 'Matriz')}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 font-medium">
            {activeSection === 'mis-productos'
              ? `Administra el menú de productos para ${business?.name || 'tu negocio'}${business?.branchName ? ` (${business.branchName})` : ''}`
              : 'Busca productos de otras tiendas y publícalos en tu perfil'}
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap sm:flex-nowrap">
          {/* Selector de Sucursal */}
          {availableBranches.length > 1 && (
            <div className="flex items-center gap-2 bg-gradient-to-r from-rose-50/90 to-amber-50/70 border border-rose-200/90 px-3.5 py-1.5 rounded-2xl shadow-xs">
              <div className="w-7 h-7 rounded-xl bg-white shadow-xs text-rose-600 flex items-center justify-center flex-shrink-0">
                <i className="bi bi-shop text-xs"></i>
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-[9px] font-black uppercase tracking-wider text-rose-600 leading-none">
                  Cambiar Sucursal
                </span>
                <select
                  value={business?.id || ''}
                  onChange={(e) => onBusinessChange?.(e.target.value)}
                  className="bg-transparent text-xs font-black text-gray-900 focus:outline-none cursor-pointer tracking-tight pr-2 -ml-0.5"
                >
                  {availableBranches.map(branch => {
                    const isCurrent = branch.id === business?.id
                    const branchTitle = branch.branchName
                      ? branch.branchName
                      : (branch.parentBusinessId ? 'Sucursal' : 'Matriz (Principal)')
                    return (
                      <option key={branch.id} value={branch.id} className="text-gray-900 bg-white font-bold text-xs py-1">
                        {branchTitle} {isCurrent ? '✓' : ''}
                      </option>
                    )
                  })}
                </select>
              </div>
            </div>
          )}

          {/* Tab Selector */}
          <div className="flex bg-gray-100 p-1.5 rounded-2xl text-xs font-black border border-gray-200/50 shadow-inner">
            <button
              type="button"
              onClick={() => setActiveSection('mis-productos')}
              className={`py-2 px-4 rounded-xl transition-all flex items-center gap-2 ${activeSection === 'mis-productos'
                  ? 'bg-white text-[#aa1918] shadow-sm'
                  : 'text-gray-500 hover:text-gray-900'
                }`}
            >
              <i className="bi bi-grid-fill"></i>
              Mis Productos
            </button>
            <button
              type="button"
              onClick={() => setActiveSection('compartidos')}
              className={`py-2 px-4 rounded-xl transition-all flex items-center gap-2 ${activeSection === 'compartidos'
                  ? 'bg-white text-[#aa1918] shadow-sm'
                  : 'text-gray-500 hover:text-gray-900'
                }`}
            >
              <i className="bi bi-share-fill"></i>
              Compartidos
            </button>
          </div>

          {/* Botón de opciones en mis-productos */}
          {activeSection === 'mis-productos' && (
            <div className="relative header-action-menu">
              <button
                type="button"
                onClick={() => setShowHeaderMenu(!showHeaderMenu)}
                className="w-10 h-10 flex items-center justify-center text-gray-500 hover:text-gray-900 rounded-2xl hover:bg-gray-50 border border-gray-100 transition-all active:scale-95 bg-white shadow-sm"
                title="Más opciones"
              >
                <i className="bi bi-three-dots text-lg"></i>
              </button>

              {showHeaderMenu && (
                <div className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-xl border border-gray-100 z-30 py-2 animate-in fade-in zoom-in duration-200">
                  <button
                    type="button"
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
          )}
        </div>
      </div>

      {activeSection === 'mis-productos' && (
        products.length === 0 ? (
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
                  if (category === 'Sin categoría') return !p.category || p.category === 'Sin categoría';
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
        )
      )}

      {activeSection === 'compartidos' && (
        /* VISTA: PRODUCTOS COMPARTIDOS */
        <div className="space-y-6 animate-in fade-in duration-300">
          {/* Tarjeta de Búsqueda y Selección de Tienda */}
          <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-4">
            <div className="flex items-center gap-2 text-gray-800">
              <i className="bi bi-search text-red-600 text-base" />
              <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider">Buscar en otras tiendas</h3>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <select
                value={selectedSearchBusinessId}
                onChange={(e) => setSelectedSearchBusinessId(e.target.value)}
                className="flex-1 px-4 py-3 border border-gray-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent bg-gray-50 transition-all font-medium text-gray-800"
              >
                <option value="">Selecciona una tienda para explorar sus productos...</option>
                {allBusinesses.map((biz) => (
                  <option key={biz.id} value={biz.id}>
                    {biz.name} (@{biz.username})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Resultados de Productos de la tienda seleccionada */}
          {selectedSearchBusinessId && (
            <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-4">
              <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider">
                Productos disponibles en la tienda seleccionada
              </h3>

              {loadingSearchProducts ? (
                <div className="text-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-600 mx-auto"></div>
                  <p className="text-xs text-gray-400 mt-2">Cargando catálogo...</p>
                </div>
              ) : searchBusinessProducts.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-6">Esta tienda no tiene productos disponibles para compartir.</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {searchBusinessProducts.map((prod) => {
                    const isShared = (business?.sharedProductIds || []).includes(prod.id)
                    return (
                      <div key={prod.id} className="flex items-center justify-between p-4 border border-gray-100 rounded-2xl hover:shadow-sm transition-all">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-12 h-12 rounded-xl bg-gray-50 overflow-hidden flex-shrink-0 border border-gray-50">
                            {prod.image ? (
                              <img src={prod.image} alt={prod.name} className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-gray-300">
                                <i className="bi bi-box-seam"></i>
                              </div>
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="font-bold text-sm text-gray-900 truncate leading-snug">{prod.name}</p>
                            <p className="text-xs text-gray-500 line-clamp-1 mt-0.5">{prod.description}</p>
                            <p className="text-xs font-black text-emerald-600 mt-1">${prod.price.toFixed(2)}</p>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleToggleShareProduct(prod.id, isShared)}
                          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all active:scale-95 flex items-center gap-1.5 flex-shrink-0 ${isShared
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-100 hover:bg-emerald-100'
                              : 'bg-red-600 text-white hover:bg-red-700 shadow-sm shadow-red-100'
                            }`}
                        >
                          {isShared ? (
                            <>
                              <i className="bi bi-check-lg text-sm"></i>
                              Compartido
                            </>
                          ) : (
                            <>
                              <i className="bi bi-share text-xs"></i>
                              Compartir
                            </>
                          )}
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Listado de Productos actualmente compartidos por la tienda */}
          <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <i className="bi bi-share-fill text-red-600 text-sm" />
                <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider">Productos Compartidos en tu Perfil</h3>
              </div>
              <span className="px-2.5 py-0.5 bg-red-50 text-red-700 border border-red-100 rounded-full text-[10px] font-black uppercase tracking-wider">
                {sharedProducts.length} ítems
              </span>
            </div>

            {loadingShared ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-red-600 mx-auto"></div>
                <p className="text-xs text-gray-400 mt-2">Cargando compartidos...</p>
              </div>
            ) : sharedProducts.length === 0 ? (
              <div className="text-center py-10 text-gray-500 bg-gray-50/50 rounded-2xl border border-dashed border-gray-200">
                <i className="bi bi-share text-3xl text-gray-300 mb-2 block"></i>
                <p className="text-xs font-bold text-gray-600">No estás compartiendo productos de otras tiendas todavía</p>
                <p className="text-[10px] text-gray-400 mt-1 max-w-xs mx-auto">
                  Selecciona una tienda en el buscador superior y haz clic en "Compartir" para agregarlo a tu perfil.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {sharedProducts.map((prod) => {
                  const ownerBizName = allBusinesses.find(b => b.id === prod.businessId)?.name || 'Otra tienda'
                  return (
                    <div key={prod.id} className="flex items-center justify-between p-4 border border-gray-100 rounded-2xl hover:shadow-sm transition-all bg-gray-50/20">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-12 h-12 rounded-xl bg-gray-50 overflow-hidden flex-shrink-0 border border-gray-50">
                          {prod.image ? (
                            <img src={prod.image} alt={prod.name} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-gray-300">
                              <i className="bi bi-box-seam"></i>
                            </div>
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="font-bold text-sm text-gray-900 truncate leading-snug">{prod.name}</p>
                          <span className="inline-block text-[9px] bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded font-black mt-1 mb-1 border border-amber-100/50 leading-none">
                            TIENDA: {ownerBizName.toUpperCase()}
                          </span>
                          <p className="text-xs font-black text-emerald-600">${prod.price.toFixed(2)}</p>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleToggleShareProduct(prod.id, true)}
                        className="px-3 py-2 text-xs font-bold text-red-600 hover:text-red-700 hover:bg-red-50 rounded-xl transition-all flex items-center gap-1.5 flex-shrink-0 active:scale-95"
                      >
                        <i className="bi bi-trash3-fill text-sm"></i>
                        Quitar
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {showProductForm && isMounted && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex flex-col"
          style={{ background: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(8px)' }}
        >
          {/* Contenedor del modal: hoja inferior en móvil, centrado en desktop */}
          <div
            className="w-full mx-auto bg-slate-50 flex flex-col rounded-t-[1.75rem] mt-auto shadow-2xl border-t border-white/20 sm:max-w-4xl sm:my-auto sm:rounded-[2rem] sm:max-h-[92vh] sm:shadow-2xl sm:border sm:border-white/80"
            style={{ maxHeight: 'calc(100dvh - 48px)', minHeight: '40dvh' }}
          >
            <form onSubmit={handleSaveProduct} className="flex flex-col min-h-0 flex-1">
              {/* Handle de arrastre solo en móvil */}
              <div className="flex justify-center pt-3 pb-0 sm:hidden flex-shrink-0">
                <div className="w-10 h-1 bg-slate-300 rounded-full"></div>
              </div>

              {/* Encabezado */}
              <div className="px-6 py-4 sm:py-5 border-b border-slate-100 flex justify-between items-center flex-shrink-0">
                <h3 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">
                  {editingProduct ? 'Editar Producto' : 'Nuevo Producto'}
                </h3>
                <button
                  type="button"
                  onClick={handleCloseForm}
                  className="text-slate-400 hover:text-slate-600 hover:bg-slate-100 w-9 h-9 rounded-full flex items-center justify-center border border-slate-200 transition-all flex-shrink-0"
                >
                  <i className="bi bi-x-lg text-sm"></i>
                </button>
              </div>

              {/* Cuerpo scrolleable */}
              <div className="flex-1 overflow-y-auto overscroll-contain p-6 space-y-6 custom-scrollbar min-h-0">
                {/* Pestañas de Navegación */}
                <div className="flex gap-1 mb-6 border-b border-slate-200">
                  <button
                    type="button"
                    onClick={() => setActiveTab('general')}
                    className={`flex items-center gap-1.5 px-3 py-2 text-xs font-bold transition-all border-b-2 -mb-px ${activeTab === 'general'
                      ? 'border-[#aa1918] text-[#aa1918]'
                      : 'border-transparent text-slate-400 hover:text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    <i className="bi bi-info-circle text-xs"></i>
                    General
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('options')}
                    className={`flex items-center gap-1.5 px-3 py-2 text-xs font-bold transition-all border-b-2 -mb-px ${activeTab === 'options'
                      ? 'border-[#aa1918] text-[#aa1918]'
                      : 'border-transparent text-slate-400 hover:text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    <i className="bi bi-gear text-xs"></i>
                    Toppings
                    {optionGroups.length > 0 && (
                      <span className="bg-[#aa1918] text-white text-[9px] font-black rounded-full w-4 h-4 flex items-center justify-center leading-none">
                        {optionGroups.length}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('ingredients')}
                    className={`flex items-center gap-1.5 px-3 py-2 text-xs font-bold transition-all border-b-2 -mb-px ${activeTab === 'ingredients'
                      ? 'border-[#aa1918] text-[#aa1918]'
                      : 'border-transparent text-slate-400 hover:text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    <i className="bi bi-basket text-xs"></i>
                    Ingredientes
                    {ingredients.length > 0 && (
                      <span className="bg-[#aa1918] text-white text-[9px] font-black rounded-full w-4 h-4 flex items-center justify-center leading-none">
                        {ingredients.length}
                      </span>
                    )}
                  </button>
                </div>


                {/* PESTAÑA: INFORMACIÓN GENERAL */}
                {activeTab === 'general' && (
                  <div className="max-w-2xl mx-auto space-y-6">

                    {/* 1. Nombre del Producto */}
                    <div className="space-y-1.5">
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-0.5">
                        Nombre del Producto
                      </label>
                      <input
                        type="text"
                        name="name"
                        value={formData.name}
                        onChange={handleInputChange}
                        placeholder="Ej: Hamburguesa Clásica, Pizza Hawaiana..."
                        className={`w-full px-4 py-3 bg-slate-50/70 border rounded-xl text-sm font-bold text-slate-900 focus:bg-white transition-all outline-none ${errors.name ? 'border-red-500 focus:border-red-500' : 'border-slate-200/80 focus:border-[#aa1918]'
                          }`}
                      />
                      {errors.name && <p className="text-red-500 text-[10px] mt-1 font-bold italic ml-1">{errors.name}</p>}
                    </div>

                    {/* 2. Foto del Producto con Encuadre y Zoom 2D */}
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between">
                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-0.5">
                          Foto del Producto
                        </label>
                        {(formData.image || editingProduct?.image) && (
                          <span className="text-[10px] font-bold text-slate-400">
                            Arrastra para mover • Rueda para zoom
                          </span>
                        )}
                      </div>

                      <div className="w-full relative">
                        {!(formData.image || editingProduct?.image) ? (
                          <label htmlFor="image-upload" className="block cursor-pointer">
                            <div
                              onDragEnter={handleDragOverImage}
                              onDragOver={handleDragOverImage}
                              onDragLeave={handleDragOverImage}
                              onDrop={handleDropImage}
                              className={`relative aspect-square w-full max-w-[280px] mx-auto bg-slate-50/70 rounded-2xl border-2 border-dashed transition-all duration-200 flex items-center justify-center overflow-hidden group ${
                                isDraggingImage
                                  ? 'border-[#aa1918] bg-red-50/30 ring-4 ring-red-100 scale-[1.01]'
                                  : 'border-slate-200 hover:border-slate-300 hover:bg-slate-100/50'
                              }`}
                            >
                              {isDraggingImage && (
                                <div className="absolute inset-0 z-30 bg-[#aa1918]/90 backdrop-blur-xs flex flex-col items-center justify-center text-white p-4 text-center animate-in fade-in zoom-in-95 duration-150">
                                  <i className="bi bi-cloud-arrow-up text-3xl mb-1.5 animate-bounce"></i>
                                  <p className="text-xs font-black uppercase tracking-wider">Suelta la imagen aquí</p>
                                </div>
                              )}
                              {uploading && (
                                <div className="absolute inset-0 z-20 bg-slate-900/60 backdrop-blur-[1px] flex flex-col items-center justify-center">
                                  <i className="bi bi-arrow-clockwise animate-spin text-white text-2xl mb-1.5"></i>
                                  <p className="text-white text-[9px] font-black uppercase tracking-widest">Subiendo Imagen</p>
                                </div>
                              )}
                              <div className="text-center p-4 space-y-1.5">
                                <div className="w-10 h-10 rounded-full bg-white text-slate-400 flex items-center justify-center mx-auto shadow-xs group-hover:scale-105 transition-transform">
                                  <i className="bi bi-cloud-arrow-up text-lg text-slate-500"></i>
                                </div>
                                <div>
                                  <p className="text-xs text-slate-700 font-bold">Subir o arrastrar foto</p>
                                  <p className="text-[10px] text-slate-400 font-medium">Formato 1:1</p>
                                </div>
                              </div>
                            </div>
                          </label>
                        ) : (
                          /* Contenedor Interactivo con Pan 2D y Zoom */
                          <div className="relative aspect-square w-full max-w-[280px] mx-auto rounded-2xl overflow-hidden border-2 border-slate-200/80 bg-slate-900 shadow-inner group select-none">
                            <div
                              onMouseDown={handlePanStart}
                              onMouseMove={handlePanMove}
                              onMouseUp={handlePanEnd}
                              onMouseLeave={handlePanEnd}
                              onTouchStart={handlePanStart}
                              onTouchMove={handlePanMove}
                              onTouchEnd={handlePanEnd}
                              onWheel={handleWheelZoom}
                              className={`w-full h-full relative overflow-hidden flex items-center justify-center ${
                                isPanningImage ? 'cursor-grabbing' : 'cursor-grab'
                              }`}
                              title="Arrastra para mover la imagen en cualquier dirección o usa la rueda para zoom"
                            >
                              <img
                                src={formData.image ? URL.createObjectURL(formData.image) : editingProduct?.image}
                                alt="Preview"
                                className="w-full h-full object-cover select-none pointer-events-none transition-transform duration-75"
                                style={{
                                  objectPosition: formData.imagePosition || '50% 50%',
                                  transformOrigin: formData.imagePosition || '50% 50%',
                                  transform: (formData.imageScale && formData.imageScale > 1) ? `scale(${formData.imageScale})` : undefined
                                }}
                                draggable={false}
                              />

                              {/* Guías de Regla de Tercios */}
                              <div
                                className={`absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none transition-opacity duration-200 ${
                                  isPanningImage ? 'opacity-50' : 'opacity-0 group-hover:opacity-25'
                                }`}
                              >
                                <div className="border-r border-b border-white/80 shadow-xs"></div>
                                <div className="border-r border-b border-white/80 shadow-xs"></div>
                                <div className="border-b border-white/80 shadow-xs"></div>
                                <div className="border-r border-b border-white/80 shadow-xs"></div>
                                <div className="border-r border-b border-white/80 shadow-xs"></div>
                                <div className="border-b border-white/80 shadow-xs"></div>
                                <div className="border-r border-b border-white/80 shadow-xs"></div>
                                <div className="border-r border-white/80 shadow-xs"></div>
                                <div></div>
                              </div>

                              {/* Botón flotante para Cambiar Foto */}
                              <label
                                htmlFor="image-upload"
                                onClick={(e) => e.stopPropagation()}
                                className="absolute top-2 right-2 z-10 bg-black/60 hover:bg-black/80 backdrop-blur-xs text-white px-2.5 py-1 rounded-lg text-[10px] font-bold cursor-pointer transition-all flex items-center gap-1 shadow-sm active:scale-95"
                              >
                                <i className="bi bi-camera text-xs"></i>
                                <span>Cambiar</span>
                              </label>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Controles de Encuadre y Zoom */}
                      {(formData.image || editingProduct?.image) && (
                        <div className="space-y-2.5 max-w-[280px] mx-auto pt-1">
                          
                          {/* Control de Zoom */}
                          <div className="bg-slate-50/80 p-2.5 rounded-xl border border-slate-200/70 space-y-1.5">
                            <div className="flex items-center justify-between text-[10px] font-bold">
                              <span className="text-slate-400 uppercase tracking-wider flex items-center gap-1">
                                <i className="bi bi-zoom-in text-slate-500"></i>
                                Zoom
                              </span>
                              <span className="text-[#aa1918] font-mono">
                                {Math.round((formData.imageScale || 1) * 100)}%
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => handleZoomChange((formData.imageScale || 1) - 0.1)}
                                disabled={(formData.imageScale || 1) <= 1}
                                className="w-6 h-6 flex items-center justify-center bg-white border border-slate-200 rounded-md text-slate-600 hover:text-slate-900 disabled:opacity-30 disabled:pointer-events-none transition-all text-xs"
                                title="Reducir zoom"
                              >
                                <i className="bi bi-dash"></i>
                              </button>
                              <input
                                type="range"
                                min="1"
                                max="3"
                                step="0.05"
                                value={formData.imageScale || 1}
                                onChange={(e) => handleZoomChange(parseFloat(e.target.value))}
                                className="flex-1 accent-[#aa1918] h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer"
                              />
                              <button
                                type="button"
                                onClick={() => handleZoomChange((formData.imageScale || 1) + 0.1)}
                                disabled={(formData.imageScale || 1) >= 3}
                                className="w-6 h-6 flex items-center justify-center bg-white border border-slate-200 rounded-md text-slate-600 hover:text-slate-900 disabled:opacity-30 disabled:pointer-events-none transition-all text-xs"
                                title="Aumentar zoom"
                              >
                                <i className="bi bi-plus"></i>
                              </button>
                            </div>
                          </div>

                          {/* Botones de acción rápida: Centrar y Ajuste Fino */}
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={handleResetPosition}
                              className="flex-1 py-1.5 px-2 bg-slate-50/80 hover:bg-slate-100 text-slate-700 rounded-xl border border-slate-200/70 text-[10px] font-bold transition-all flex items-center justify-center gap-1.5"
                              title="Restablecer encuadre y zoom original"
                            >
                              <i className="bi bi-arrow-counterclockwise text-xs text-slate-500"></i>
                              Centrar
                            </button>
                            <button
                              type="button"
                              onClick={() => setShowEncuadreDetails(!showEncuadreDetails)}
                              className={`py-1.5 px-2.5 rounded-xl border text-[10px] font-bold transition-all flex items-center justify-center gap-1 ${
                                showEncuadreDetails 
                                  ? 'bg-[#aa1918]/10 text-[#aa1918] border-[#aa1918]/30' 
                                  : 'bg-slate-50/80 hover:bg-slate-100 text-slate-600 border-slate-200/70'
                              }`}
                              title="Ajuste fino de posición X e Y"
                            >
                              <i className="bi bi-sliders text-xs"></i>
                              <span>Ajuste fino</span>
                            </button>
                          </div>

                          {/* Sliders de Ajuste Fino X e Y (Desplegable) */}
                          {showEncuadreDetails && (
                            <div className="p-2.5 bg-slate-50/80 rounded-xl border border-slate-200/70 space-y-2 animate-in fade-in slide-in-from-top-2 duration-150">
                              {/* Horizontal X */}
                              <div className="space-y-1">
                                <div className="flex justify-between items-center text-[9px] font-bold">
                                  <span className="text-slate-500 flex items-center gap-1">
                                    <i className="bi bi-arrows-expand-vertical -rotate-90 text-[10px]"></i>
                                    Horizontal (X)
                                  </span>
                                  <span className="text-[#aa1918] font-mono">
                                    {parseImagePosition(formData.imagePosition).x}%
                                  </span>
                                </div>
                                <input
                                  type="range"
                                  min="0"
                                  max="100"
                                  value={parseImagePosition(formData.imagePosition).x}
                                  onChange={(e) => {
                                    const { y } = parseImagePosition(formData.imagePosition);
                                    setFormData(prev => ({ ...prev, imagePosition: `${e.target.value}% ${y}%` }));
                                  }}
                                  className="w-full accent-[#aa1918] h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer"
                                />
                              </div>

                              {/* Vertical Y */}
                              <div className="space-y-1">
                                <div className="flex justify-between items-center text-[9px] font-bold">
                                  <span className="text-slate-500 flex items-center gap-1">
                                    <i className="bi bi-arrows-expand-vertical text-[10px]"></i>
                                    Vertical (Y)
                                  </span>
                                  <span className="text-[#aa1918] font-mono">
                                    {parseImagePosition(formData.imagePosition).y}%
                                  </span>
                                </div>
                                <input
                                  type="range"
                                  min="0"
                                  max="100"
                                  value={parseImagePosition(formData.imagePosition).y}
                                  onChange={(e) => {
                                    const { x } = parseImagePosition(formData.imagePosition);
                                    setFormData(prev => ({ ...prev, imagePosition: `${x}% ${e.target.value}%` }));
                                  }}
                                  className="w-full accent-[#aa1918] h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer"
                                />
                              </div>
                            </div>
                          )}
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

                    {/* 3. Descripción */}
                    <div className="space-y-1.5">
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-0.5">
                        Descripción
                      </label>
                      <textarea
                        name="description"
                        value={formData.description}
                        onChange={handleInputChange}
                        rows={3}
                        placeholder="Describe el producto (ingredientes, porciones, detalles especiales)..."
                        className={`w-full px-4 py-2.5 bg-slate-50/70 border rounded-xl text-xs font-medium text-slate-700 focus:bg-white transition-all outline-none resize-none ${errors.description ? 'border-red-500 focus:border-red-500' : 'border-slate-200/80 focus:border-[#aa1918]'
                          }`}
                      />
                      {errors.description && <p className="text-red-500 text-[10px] mt-1 font-bold italic ml-1">{errors.description}</p>}
                    </div>

                    {/* 4. Precio */}
                    <div className="space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
                        <div className="space-y-1.5">
                          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-0.5">
                            {isSubscription ? 'Precio del Producto' : 'Precio Base'}
                          </label>
                          <div className="relative">
                            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm">$</span>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              name="price"
                              value={formData.price}
                              onChange={handleInputChange}
                              onWheel={(e) => (e.target as HTMLInputElement).blur()}
                              placeholder="0.00"
                              className={`w-full pl-7 pr-4 py-2.5 bg-slate-50/70 border rounded-xl text-sm font-bold text-slate-800 focus:bg-white transition-all outline-none ${errors.price ? 'border-red-500 focus:border-red-500' : 'border-slate-200/80 focus:border-[#aa1918]'
                                }`}
                            />
                          </div>
                          {errors.price && <p className="text-red-500 text-[10px] mt-1 font-bold italic ml-1">{errors.price}</p>}
                        </div>

                        {/* Precio Público Toggle (Oculto si el negocio tiene suscripción) */}
                        {!isSubscription && formData.price && Number(formData.price) > 0 && (
                          <div className="pt-6">
                            <div className="flex items-center justify-between px-3.5 py-2.5 bg-slate-50/80 rounded-xl border border-slate-200/60">
                              <p className="text-xs font-bold text-slate-500">
                                Precio Público: <span className="text-slate-900 font-black">${formData.commissionType === 'fuddi_assumed_by_customer'
                                  ? (Math.round(Number(formData.price) * (1 + commissionSettings.commissionRate / 100) * 20) / 20).toFixed(2)
                                  : Number(formData.price).toFixed(2)}</span>
                              </p>
                              <button
                                type="button"
                                onClick={() => setShowCommissionSettings(!showCommissionSettings)}
                                className="text-[10px] font-black text-blue-600 uppercase tracking-wider hover:text-blue-700 flex items-center gap-1 transition-colors ml-2"
                              >
                                {showCommissionSettings ? 'Ocultar' : 'Comisión'}
                                <i className={`bi ${showCommissionSettings ? 'bi-chevron-up' : 'bi-chevron-down'}`}></i>
                              </button>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Configuración de Comisión Colapsable (Oculto si el negocio tiene suscripción) */}
                      {!isSubscription && showCommissionSettings && formData.price && Number(formData.price) > 0 && (
                        <div className="bg-slate-50/80 p-4 rounded-xl border border-slate-200/70 space-y-3.5 animate-in fade-in zoom-in-95 duration-200">
                          <div className="flex items-center gap-2 pb-2 border-b border-slate-200/60">
                            <div className="w-6 h-6 bg-amber-50 border border-amber-100 text-amber-600 rounded-lg flex items-center justify-center text-xs">
                              <i className="bi bi-percent"></i>
                            </div>
                            <h5 className="font-black text-slate-700 text-[10px] uppercase tracking-wider">Comisión Fuddi ({commissionSettings.commissionRate}%)</h5>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            <button
                              type="button"
                              onClick={() => setFormData(prev => ({ ...prev, commissionType: 'fuddi_assumed_by_customer' }))}
                              className={`p-3 rounded-xl border text-left transition-all ${formData.commissionType === 'fuddi_assumed_by_customer'
                                  ? 'border-[#aa1918] bg-white shadow-xs'
                                  : 'border-slate-200/80 bg-white/70 hover:border-slate-300'
                                }`}
                            >
                              <div className="flex items-center gap-2 mb-1">
                                <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${formData.commissionType === 'fuddi_assumed_by_customer' ? 'border-[#aa1918] bg-[#aa1918]' : 'border-slate-300'
                                  }`}>
                                  {formData.commissionType === 'fuddi_assumed_by_customer' && <div className="w-1.5 h-1.5 bg-white rounded-full"></div>}
                                </div>
                                <span className={`font-bold text-xs ${formData.commissionType === 'fuddi_assumed_by_customer' ? 'text-[#aa1918]' : 'text-slate-700'}`}>Cliente paga</span>
                              </div>
                              <p className="text-[9px] text-slate-400 font-medium">Recibes el 100% de tu precio ingresado.</p>
                            </button>

                            <button
                              type="button"
                              onClick={() => setFormData(prev => ({ ...prev, commissionType: 'fuddi_assumed_by_store' }))}
                              className={`p-3 rounded-xl border text-left transition-all ${formData.commissionType === 'fuddi_assumed_by_store'
                                  ? 'border-[#aa1918] bg-white shadow-xs'
                                  : 'border-slate-200/80 bg-white/70 hover:border-slate-300'
                                }`}
                            >
                              <div className="flex items-center gap-2 mb-1">
                                <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${formData.commissionType === 'fuddi_assumed_by_store' ? 'border-[#aa1918] bg-[#aa1918]' : 'border-slate-300'
                                  }`}>
                                  {formData.commissionType === 'fuddi_assumed_by_store' && <div className="w-1.5 h-1.5 bg-white rounded-full"></div>}
                                </div>
                                <span className={`font-bold text-xs ${formData.commissionType === 'fuddi_assumed_by_store' ? 'text-[#aa1918]' : 'text-slate-700'}`}>Negocio asume</span>
                              </div>
                              <p className="text-[9px] text-slate-400 font-medium">Descuenta {commissionSettings.commissionRate}% de tu ganancia.</p>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* 5. Categoría y Disponibilidad */}
                    <div className="pt-4 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-0.5">
                            Categoría
                          </label>
                          {businessCategories.length > 0 && (
                            <button
                              type="button"
                              onClick={() => {
                                if (isCreatingNewCategory) {
                                  setIsCreatingNewCategory(false);
                                  setFormData(prev => ({
                                    ...prev,
                                    category: businessCategories[0] || ''
                                  }));
                                } else {
                                  setIsCreatingNewCategory(true);
                                  setFormData(prev => ({ ...prev, category: '' }));
                                }
                              }}
                              className="text-[10px] font-black text-[#aa1918] hover:text-[#881413] hover:underline flex items-center gap-1 transition-colors tracking-tight"
                            >
                              {isCreatingNewCategory ? (
                                <>
                                  <i className="bi bi-arrow-left-short text-sm"></i>
                                  <span>Elegir existente</span>
                                </>
                              ) : (
                                <>
                                  <i className="bi bi-plus-lg text-xs"></i>
                                  <span>Nueva categoría</span>
                                </>
                              )}
                            </button>
                          )}
                        </div>

                        {isCreatingNewCategory || businessCategories.length === 0 ? (
                          <div className="space-y-1.5 animate-in fade-in duration-150">
                            <div className="relative">
                              <input
                                type="text"
                                name="category"
                                autoComplete="off"
                                autoCorrect="off"
                                spellCheck="false"
                                value={formData.category}
                                onChange={handleInputChange}
                                placeholder="Escribe el nombre de la categoría..."
                                className="w-full pl-8 pr-3.5 py-2.5 bg-slate-50/80 border border-slate-200/80 hover:border-slate-300 focus:border-[#aa1918] focus:bg-white rounded-xl focus:outline-none transition-all text-xs font-bold text-slate-800"
                              />
                              <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                                <i className="bi bi-plus-circle text-xs"></i>
                              </div>
                            </div>
                            <p className="text-[10px] text-slate-400 font-medium ml-0.5">
                              {businessCategories.length === 0
                                ? 'Crea la primera categoría para tu negocio'
                                : 'Se añadirá a las categorías de tu negocio'}
                            </p>
                          </div>
                        ) : (
                          <div className="relative" ref={categoryDropdownRef}>
                            {/* Trigger principal estilizado */}
                            <button
                              type="button"
                              onClick={() => setIsCategoryDropdownOpen(!isCategoryDropdownOpen)}
                              className={`w-full px-3.5 py-2.5 bg-slate-50/90 hover:bg-white border rounded-xl flex items-center justify-between transition-all duration-200 text-left shadow-2xs group ${
                                isCategoryDropdownOpen
                                  ? 'border-[#aa1918] ring-2 ring-[#aa1918]/10 bg-white shadow-sm'
                                  : 'border-slate-200/80 hover:border-slate-300'
                              }`}
                            >
                              <div className="flex items-center gap-2.5 min-w-0 pr-2">
                                <div className="w-6 h-6 rounded-lg bg-rose-50 border border-rose-100 flex items-center justify-center flex-shrink-0 text-[#aa1918]">
                                  <i className="bi bi-tag-fill text-[11px]"></i>
                                </div>
                                <span className="font-black text-xs text-slate-900 tracking-tight truncate">
                                  {formData.category || 'Selecciona una categoría'}
                                </span>
                              </div>
                              <i className={`bi bi-chevron-down text-xs text-slate-400 group-hover:text-slate-600 transition-transform duration-200 ${
                                isCategoryDropdownOpen ? 'rotate-180 text-[#aa1918]' : ''
                              }`}></i>
                            </button>

                            {/* Menú desplegable flotante personalizado */}
                            {isCategoryDropdownOpen && (
                              <div className="absolute left-0 right-0 top-full mt-1.5 bg-white/95 backdrop-blur-md rounded-2xl border border-slate-200/90 shadow-xl shadow-slate-200/50 z-50 p-1.5 animate-in fade-in zoom-in-95 duration-150">
                                <div className="max-h-56 overflow-y-auto space-y-0.5 pr-0.5">
                                  {businessCategories.map((cat) => {
                                    const isSelected = formData.category === cat
                                    return (
                                      <button
                                        key={cat}
                                        type="button"
                                        onClick={() => {
                                          setFormData(prev => ({ ...prev, category: cat }))
                                          setIsCategoryDropdownOpen(false)
                                        }}
                                        className={`w-full px-3 py-2 rounded-xl text-left text-xs flex items-center justify-between transition-all ${
                                          isSelected
                                            ? 'bg-rose-50 text-[#aa1918] font-black'
                                            : 'text-slate-700 hover:bg-slate-100/80 hover:text-slate-900 font-bold'
                                        }`}
                                      >
                                        <div className="flex items-center gap-2 truncate">
                                          <i className={`bi ${isSelected ? 'bi-folder-check-fill text-[#aa1918]' : 'bi-folder2 text-slate-400'} text-xs`}></i>
                                          <span className="truncate">{cat}</span>
                                        </div>
                                        {isSelected && (
                                          <i className="bi bi-check2 text-sm font-black text-[#aa1918]"></i>
                                        )}
                                      </button>
                                    )
                                  })}

                                  <div className="my-1 border-t border-slate-100/80"></div>

                                  <button
                                    type="button"
                                    onClick={() => {
                                      setIsCreatingNewCategory(true)
                                      setFormData(prev => ({ ...prev, category: '' }))
                                      setIsCategoryDropdownOpen(false)
                                    }}
                                    className="w-full px-3 py-2 rounded-xl text-left text-xs font-black text-[#aa1918] bg-gradient-to-r from-rose-50/90 to-amber-50/70 hover:from-rose-100 hover:to-amber-100 flex items-center justify-between transition-all border border-rose-200/60 shadow-2xs"
                                  >
                                    <div className="flex items-center gap-2">
                                      <div className="w-5 h-5 rounded-md bg-[#aa1918] text-white flex items-center justify-center text-[10px]">
                                        <i className="bi bi-plus-lg"></i>
                                      </div>
                                      <span>Crear nueva categoría</span>
                                    </div>
                                    <i className="bi bi-chevron-right text-[10px] text-rose-400"></i>
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="sm:pt-5">
                        <label className="flex items-center justify-between cursor-pointer p-2.5 bg-slate-50/80 rounded-xl border border-slate-200/60 group hover:bg-slate-100/60 transition-colors">
                          <div>
                            <span className="font-bold text-slate-700 text-xs block group-hover:text-slate-900 transition-colors">Disponible para venta</span>
                            <span className="text-[10px] text-slate-400 font-medium block">Visible en el menú</span>
                          </div>
                          <div className="relative inline-flex items-center ml-3">
                            <input
                              type="checkbox"
                              checked={formData.isAvailable}
                              onChange={(e) => setFormData(prev => ({ ...prev, isAvailable: e.target.checked }))}
                              className="sr-only peer"
                            />
                            <div className="w-9 h-5 bg-slate-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
                          </div>
                        </label>
                      </div>
                    </div>

                    {/* 6. Horarios de Disponibilidad */}
                    <div className="pt-2 border-t border-slate-100 space-y-3">
                      <label className="flex items-center justify-between cursor-pointer py-1 group">
                        <div>
                          <span className="font-bold text-slate-700 text-xs block group-hover:text-slate-900 transition-colors">Restricción por Horarios</span>
                          <span className="text-[10px] text-slate-400 font-medium block mt-0.5">Venta solo en días/horas específicos</span>
                        </div>
                        <div className="relative inline-flex items-center ml-4">
                          <input
                            type="checkbox"
                            checked={scheduleEnabled}
                            onChange={(e) => setScheduleEnabled(e.target.checked)}
                            className="sr-only peer"
                          />
                          <div className="w-9 h-5 bg-slate-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                        </div>
                      </label>

                      {scheduleEnabled && (
                        <div className="space-y-3 pt-2 animate-in fade-in slide-in-from-top-2 duration-200">
                          {/* Lista de horarios configurados */}
                          {schedules.length > 0 && (
                            <div className="space-y-1.5">
                              {schedules.map(schedule => (
                                <div key={schedule.id} className="flex items-center justify-between bg-slate-50/70 p-2.5 rounded-xl border border-slate-200/60">
                                  <div className="flex-1 min-w-0 pr-2">
                                    <p className="font-bold text-slate-700 text-xs truncate">
                                      {schedule.days.map(day => dayLabels[day] || day).join(', ')}
                                    </p>
                                    <p className="text-[10px] text-slate-400 font-bold mt-0.5">
                                      {schedule.startTime} - {schedule.endTime}
                                    </p>
                                  </div>
                                  <div className="flex gap-1">
                                    <button
                                      type="button"
                                      onClick={() => editSchedule(schedule)}
                                      className="w-6 h-6 flex items-center justify-center text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                      title="Editar horario"
                                    >
                                      <i className="bi bi-pencil text-xs"></i>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => removeSchedule(schedule.id)}
                                      className="w-6 h-6 flex items-center justify-center text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                      title="Eliminar horario"
                                    >
                                      <i className="bi bi-trash text-xs"></i>
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Formulario inline de horario */}
                          <div className="p-3 bg-slate-50/60 rounded-xl border border-slate-200/70 space-y-2.5">
                            <div>
                              <label className="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-0.5">Días</label>
                              <div className="grid grid-cols-4 gap-1">
                                {daysOfWeek.map(day => (
                                  <button
                                    key={day}
                                    type="button"
                                    onClick={() => toggleDaySelection(day)}
                                    className={`py-1 px-1 rounded-lg font-bold text-[10px] border transition-all ${currentSchedule.days.includes(day)
                                        ? 'bg-blue-600 border-blue-600 text-white shadow-xs'
                                        : 'bg-white border-slate-200/80 text-slate-600 hover:bg-slate-50'
                                      }`}
                                  >
                                    {dayLabels[day]}
                                  </button>
                                ))}
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-2">
                              <div className="space-y-0.5">
                                <label className="block text-[9px] font-bold text-slate-400 ml-0.5">Inicio</label>
                                <input
                                  type="time"
                                  value={currentSchedule.startTime}
                                  onChange={(e) => setCurrentSchedule(prev => ({ ...prev, startTime: e.target.value }))}
                                  className="w-full px-2.5 py-1.5 bg-white border border-slate-200/80 rounded-lg focus:outline-none focus:border-blue-600 text-xs font-bold text-slate-800"
                                />
                              </div>
                              <div className="space-y-0.5">
                                <label className="block text-[9px] font-bold text-slate-400 ml-0.5">Fin</label>
                                <input
                                  type="time"
                                  value={currentSchedule.endTime}
                                  onChange={(e) => setCurrentSchedule(prev => ({ ...prev, endTime: e.target.value }))}
                                  className="w-full px-2.5 py-1.5 bg-white border border-slate-200/80 rounded-lg focus:outline-none focus:border-blue-600 text-xs font-bold text-slate-800"
                                />
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={addSchedule}
                              className="w-full bg-blue-600 hover:bg-blue-700 text-white py-1.5 px-3 rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-1.5 mt-1 shadow-xs"
                            >
                              <i className={`bi ${editingScheduleId ? 'bi-check-lg' : 'bi-plus-lg'} text-xs`}></i>
                              {editingScheduleId ? 'Actualizar Horario' : 'Agregar Horario'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* 3. Variantes del Producto */}
                    <div className="order-5 pt-4 border-t border-slate-100 space-y-4">
                      <label className="flex items-center justify-between cursor-pointer py-1 group">
                        <div>
                          <span className="font-bold text-xs text-slate-800 block group-hover:text-slate-900 transition-colors">Configurar Variantes</span>
                          <span className="text-[10px] text-slate-400 font-medium block mt-0.5">Diferentes presentaciones, tamaños o sabores</span>
                        </div>
                        <div className="relative inline-flex items-center ml-4">
                          <input
                            type="checkbox"
                            checked={hasVariants}
                            onChange={() => {
                              const newHasVariants = !hasVariants;
                              setHasVariants(newHasVariants);
                              if (!newHasVariants) {
                                setFormData(prev => ({ ...prev, isCombo: false, countComboUnits: false }));
                              }
                            }}
                            className="sr-only peer"
                          />
                          <div className="w-9 h-5 bg-slate-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                        </div>
                      </label>

                      {hasVariants && (
                        <div className="space-y-4 pt-2 animate-in fade-in slide-in-from-top-2 duration-200">

                          {/* Toggle Es un Combo */}
                          <label className="flex items-center justify-between p-3 bg-orange-50/30 hover:bg-orange-50/50 rounded-xl cursor-pointer transition-all border border-orange-100/60 group">
                            <div>
                              <span className="font-bold text-slate-800 text-xs block">Es un Combo</span>
                              <span className="text-[9px] text-slate-500 font-medium block mt-0.5">Paquete con selección de múltiples variantes</span>
                            </div>
                            <div className="relative inline-flex items-center">
                              <input
                                type="checkbox"
                                checked={formData.isCombo}
                                onChange={() => {
                                  setFormData(prev => ({ ...prev, isCombo: !prev.isCombo }));
                                }}
                                className="sr-only peer"
                              />
                              <div className="w-9 h-5 bg-slate-200 peer-checked:bg-orange-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all"></div>
                            </div>
                          </label>

                          {/* Combo cantidad de opciones */}
                          {formData.isCombo && (
                            <div className="space-y-2.5 p-3.5 bg-orange-50/20 rounded-xl border border-orange-100/70 animate-in fade-in zoom-in-95 duration-150">
                              <div>
                                <label className="block text-[9px] font-black text-orange-700 uppercase tracking-widest mb-1 ml-0.5">Opciones a Elegir</label>
                                <input
                                  type="number"
                                  min="1"
                                  value={formData.minComboItems}
                                  onChange={(e) => setFormData(prev => ({ ...prev, minComboItems: Number(e.target.value) }))}
                                  className="w-full sm:w-1/3 px-3 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:border-orange-500 font-bold text-xs bg-white text-slate-800"
                                />
                              </div>

                              <label className="flex items-center justify-between pt-1 cursor-pointer">
                                <span className="text-xs font-semibold text-slate-700">Multiplicar insumos por unidades seleccionadas</span>
                                <input
                                  type="checkbox"
                                  checked={!!formData.countComboUnits}
                                  onChange={() => {
                                    setFormData(prev => ({ ...prev, countComboUnits: !prev.countComboUnits }));
                                  }}
                                  className="sr-only peer"
                                />
                                <div className="w-8 h-4 bg-slate-200 peer-checked:bg-orange-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all"></div>
                              </label>
                            </div>
                          )}

                          {/* Listado de variantes */}
                          {variants.length > 0 && (
                            <div className="space-y-2">
                              {variants.map((variant, index) => (
                                <div
                                  key={variant.id}
                                  className={`flex items-center bg-slate-50/70 p-3 rounded-xl border transition-all duration-200 ${variantVisibility[variant.id] !== false
                                      ? 'border-slate-200/70 hover:bg-white hover:shadow-xs'
                                      : 'border-slate-200/50 bg-slate-100/40 opacity-70'
                                    }`}
                                >
                                  {/* Imagen de la variante */}
                                  <div className="w-11 h-11 flex-shrink-0 rounded-lg overflow-hidden bg-white border border-slate-200/80 mr-3 relative">
                                    {(variantImageFiles[variant.id] || variant.image) ? (
                                      <img
                                        src={variantImageFiles[variant.id] ? URL.createObjectURL(variantImageFiles[variant.id]) : variant.image}
                                        className="w-full h-full object-cover"
                                        alt={variant.name}
                                      />
                                    ) : (
                                      <div className="w-full h-full flex items-center justify-center text-slate-300">
                                        <i className="bi bi-image text-sm"></i>
                                      </div>
                                    )}
                                  </div>

                                  {/* Datos de la variante */}
                                  <div className="flex-1 min-w-0 pr-2">
                                    <div className="flex items-center gap-1.5">
                                      <p className="font-bold text-slate-800 text-xs truncate">
                                        {variant.name}
                                      </p>
                                      {variantVisibility[variant.id] === false && (
                                        <span className="text-[8px] font-bold bg-slate-200 text-slate-500 px-1 py-0.2 rounded">
                                          Oculto
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex items-baseline gap-2 mt-0.5">
                                      <span className="text-xs font-black text-slate-900">
                                        ${variant.price.toFixed(2)}
                                      </span>
                                      {!isSubscription && (
                                        <span className="text-[9px] font-bold text-slate-400">
                                          Público: ${(Math.round(variant.price * (1 + (commissionSettings.commissionRate / 100)) * 20) / 20).toFixed(2)}
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  {/* Acciones de la variante */}
                                  <div className="relative variant-action-menu">
                                    <button
                                      type="button"
                                      onClick={() => setActiveVariantMenu(activeVariantMenu === variant.id ? null : variant.id)}
                                      className="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-200/60 transition-all"
                                    >
                                      <i className="bi bi-three-dots-vertical text-xs"></i>
                                    </button>

                                    {activeVariantMenu === variant.id && (
                                      <div className="absolute right-0 mt-1 w-40 bg-white rounded-xl shadow-xl border border-slate-100 z-30 py-1.5 animate-in fade-in zoom-in-95 duration-150">
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setVariantVisibility(prev => ({ ...prev, [variant.id]: !prev[variant.id] }))
                                            setActiveVariantMenu(null)
                                          }}
                                          className="w-full px-3 py-2 text-left text-xs font-semibold hover:bg-slate-50 flex items-center gap-2 text-slate-700"
                                        >
                                          <i className={`bi ${variantVisibility[variant.id] !== false ? 'bi-eye-slash text-amber-500' : 'bi-eye text-emerald-500'}`}></i>
                                          {variantVisibility[variant.id] !== false ? 'Ocultar' : 'Mostrar'}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            handleEditVariant(variant)
                                            setActiveVariantMenu(null)
                                          }}
                                          className="w-full px-3 py-2 text-left text-xs font-semibold hover:bg-slate-50 flex items-center gap-2 text-slate-700"
                                        >
                                          <i className="bi bi-pencil text-blue-500"></i>
                                          Editar
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            removeVariant(variant.id)
                                            setActiveVariantMenu(null)
                                          }}
                                          className="w-full px-3 py-2 text-left text-xs font-semibold hover:bg-red-50 flex items-center gap-2 text-red-600"
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
                          )}

                          {/* Formulario Inline para Añadir / Editar Variante */}
                          {!(showVariantForm || editingVariantId) ? (
                            <button
                              type="button"
                              onClick={() => setShowVariantForm(true)}
                              className="w-full py-3 border border-dashed border-slate-300 hover:border-[#aa1918] hover:bg-red-50/10 rounded-xl text-slate-600 hover:text-[#aa1918] transition-all font-bold text-xs flex items-center justify-center gap-1.5"
                            >
                              <i className="bi bi-plus-circle text-sm"></i>
                              Agregar Variante
                            </button>
                          ) : (
                            <div className="space-y-3 bg-slate-50/80 p-3.5 rounded-xl border border-slate-200/80 animate-in fade-in slide-in-from-top-2 duration-200">
                              <div className="flex items-center justify-between pb-1.5 border-b border-slate-200/60">
                                <h5 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                                  {editingVariantId ? 'Editar Variante' : 'Nueva Variante'}
                                </h5>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setShowVariantForm(false)
                                    setEditingVariantId(null)
                                    setCurrentVariant({ name: '', price: '', description: '', imageFile: null, imageUrl: '' })
                                  }}
                                  className="text-slate-400 hover:text-slate-600 text-xs"
                                >
                                  <i className="bi bi-x-lg"></i>
                                </button>
                              </div>

                              <div className="flex flex-col sm:flex-row gap-3 items-start">
                                {/* Imagen de la variante */}
                                <div className="w-16 h-16 flex-shrink-0">
                                  <label htmlFor="variant-image-upload" className="block cursor-pointer h-full">
                                    <div className="relative h-full bg-white rounded-xl border-2 border-dashed border-slate-200 hover:border-[#aa1918] flex items-center justify-center overflow-hidden group transition-all">
                                      {currentVariant.imageFile ? (
                                        <img src={URL.createObjectURL(currentVariant.imageFile)} alt="Preview" className="w-full h-full object-cover" />
                                      ) : currentVariant.imageUrl ? (
                                        <img src={currentVariant.imageUrl} alt="Current" className="w-full h-full object-cover" />
                                      ) : (
                                        <i className="bi bi-camera text-slate-400 text-sm"></i>
                                      )}
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

                                {/* Campos de texto */}
                                <div className="flex-1 space-y-2 w-full">
                                  <input
                                    type="text"
                                    value={currentVariant.name}
                                    onChange={(e) => setCurrentVariant(prev => ({ ...prev, name: e.target.value }))}
                                    placeholder="Nombre: ej. Personal, Grande, 1/2 Pollo..."
                                    className="w-full px-3 py-2 bg-white border border-slate-200/80 rounded-lg text-xs font-bold text-slate-800 focus:outline-none focus:border-[#aa1918]"
                                    autoFocus
                                  />

                                  <div className="flex gap-2">
                                    <div className="relative flex-1">
                                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-xs">$</span>
                                      <input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        value={currentVariant.price}
                                        onChange={(e) => setCurrentVariant(prev => ({ ...prev, price: e.target.value }))}
                                        onWheel={(e) => (e.target as HTMLInputElement).blur()}
                                        placeholder="Precio"
                                        className="w-full pl-6 pr-3 py-1.5 bg-white border border-slate-200/80 rounded-lg text-xs font-bold text-slate-800 focus:outline-none focus:border-[#aa1918]"
                                      />
                                    </div>

                                    <button
                                      type="button"
                                      onClick={addVariant}
                                      className="px-4 py-1.5 bg-[#aa1918] hover:bg-[#8f1514] text-white rounded-lg text-xs font-bold transition-all"
                                    >
                                      {editingVariantId ? 'Guardar' : 'Añadir'}
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* PESTAÑA: INGREDIENTES Y COSTOS */}
                {activeTab === 'ingredients' && (
                  <div className="space-y-6 max-w-3xl mx-auto">
                    {/* Sección de ingredientes principales - Solo visible cuando no hay variantes */}
                    {variants.length === 0 && (
                      <div className="space-y-6 animate-in fade-in duration-300">
                        {/* Tarjeta 1: Resumen de Costos (KPI Card) */}
                        {ingredients.length > 0 && (
                          <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col sm:flex-row justify-between items-center gap-4">
                            <div>
                              <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Resumen de Costos y Receta</h4>
                              <p className="text-xs text-slate-500 mt-0.5">Desglose financiero del producto según insumos</p>
                            </div>
                            <div className="flex items-center gap-6 text-center sm:text-right">
                              <div>
                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Costo Insumos</p>
                                <p className="text-xl font-black text-slate-800 mt-0.5">${calculateTotalIngredientCost().toFixed(2)}</p>
                              </div>
                              {formData.price && Number(formData.price) > 0 && (
                                <>
                                  <div className="w-px h-8 bg-slate-100"></div>
                                  <div>
                                    <p className="text-[9px] font-black text-emerald-500 uppercase tracking-widest">Margen de Ganancia</p>
                                    <p className="text-xl font-black text-emerald-600 mt-0.5">
                                      ${(Number(formData.price) - calculateTotalIngredientCost()).toFixed(2)}
                                      <span className="text-xs font-bold text-slate-400 ml-1">
                                        ({((Number(formData.price) - calculateTotalIngredientCost()) / Number(formData.price) * 105).toFixed(1)}%)
                                      </span>
                                    </p>
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Tarjeta 2: Ingredientes Agregados */}
                        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-4">
                          <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Ingredientes del Producto</h4>

                          {ingredients.length > 0 ? (
                            <div className="divide-y divide-slate-100">
                              {ingredients.map((ingredient) => (
                                <div key={ingredient.id} className="py-3 flex justify-between items-center first:pt-0 last:pb-0 group">
                                  <div className="flex-1 pr-4">
                                    <p className="font-bold text-slate-800 text-xs">{ingredient.name}</p>
                                    <p className="text-[10px] text-slate-500 font-bold mt-0.5">
                                      {ingredient.quantity} unidad(es) × ${ingredient.unitCost.toFixed(2)} =
                                      <span className="text-emerald-600 ml-1">${(ingredient.quantity * ingredient.unitCost).toFixed(2)}</span>
                                    </p>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => removeIngredient(ingredient.id)}
                                    className="w-7 h-7 flex items-center justify-center text-red-500 hover:text-red-700 bg-slate-50 group-hover:bg-red-50 rounded-lg border border-slate-100 hover:border-red-100 transition-colors"
                                    title="Remover insumo"
                                  >
                                    <i className="bi bi-trash text-xs"></i>
                                  </button>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="text-center py-6 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                              <i className="bi bi-basket text-lg text-slate-300"></i>
                              <p className="text-xs font-semibold text-slate-500 mt-1">Sin ingredientes configurados</p>
                              <p className="text-[10px] text-slate-400 max-w-xs mx-auto mt-0.5">Configura la receta de este producto para controlar tus costos e inventario.</p>
                            </div>
                          )}
                        </div>

                        {/* Tarjeta 3: Configurar Insumos (Buscador y Formulario) */}
                        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-4">
                          <div className="flex items-center gap-2.5 pb-2.5 border-b border-slate-100">
                            <div className="w-7 h-7 bg-emerald-50 border border-emerald-100 text-emerald-600 rounded-lg flex items-center justify-center shadow-sm">
                              <i className="bi bi-magic text-sm"></i>
                            </div>
                            <h5 className="font-black text-slate-700 text-[10px] uppercase tracking-wider">Añadir Insumos a la Receta</h5>
                          </div>

                          <div className="space-y-4">
                            <div className="relative ingredient-input-container">
                              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 mb-1.5">Buscar o Crear Insumo</label>
                              <div className="relative">
                                <i className="bi bi-search absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"></i>
                                <input
                                  type="text"
                                  name="name"
                                  value={currentIngredient.name}
                                  onChange={handleIngredientChange}
                                  onFocus={() => setShowIngredientSuggestions(true)}
                                  className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-100 hover:border-slate-200 focus:border-emerald-500 focus:bg-white rounded-xl text-xs font-bold text-slate-800 outline-none transition-all"
                                  placeholder="¿Qué insumo necesitas? Ej: Pan de Hamburguesa, Tocino..."
                                  autoComplete="off"
                                />
                              </div>

                              {/* Sugerencias flotantes */}
                              {showIngredientSuggestions && (
                                <div className="absolute z-[60] w-full mt-1.5 bg-white border border-slate-100 rounded-2xl shadow-xl overflow-hidden max-h-56 overflow-y-auto custom-scrollbar animate-in fade-in slide-in-from-top-1 duration-200">
                                  {getFilteredIngredients().length > 0 ? (
                                    <>
                                      <div className="px-4 py-2 bg-slate-50/50 border-b border-slate-50">
                                        <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Insumos en Biblioteca</p>
                                      </div>
                                      {getFilteredIngredients().map((ingredient) => (
                                        <button
                                          key={ingredient.id}
                                          type="button"
                                          onClick={() => selectIngredientFromLibrary(ingredient)}
                                          className="w-full text-left px-4 py-3 hover:bg-emerald-50 border-b border-slate-50 last:border-b-0 transition-all flex items-center justify-between text-xs font-bold text-slate-800"
                                        >
                                          <span>{ingredient.name}</span>
                                          <span className="text-emerald-600">${ingredient.unitCost.toFixed(2)}</span>
                                        </button>
                                      ))}
                                    </>
                                  ) : currentIngredient.name.trim() !== '' && (
                                    <button
                                      type="button"
                                      onClick={() => setShowIngredientSuggestions(false)}
                                      className="w-full text-left px-4 py-3.5 bg-emerald-50/50 hover:bg-emerald-100/50 text-xs font-bold text-emerald-700 transition-all flex items-center gap-2"
                                    >
                                      <i className="bi bi-plus-lg bg-white p-1 rounded shadow-sm"></i>
                                      Crear insumo "{currentIngredient.name}"
                                    </button>
                                  )}

                                  {currentIngredient.name.trim() === '' && ingredientLibrary.length > 0 && (
                                    <>
                                      <div className="px-4 py-2 bg-slate-50/50 border-b border-slate-50">
                                        <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Usados Frecuentemente</p>
                                      </div>
                                      {ingredientLibrary.slice(0, 5).map((ingredient) => (
                                        <button
                                          key={ingredient.id}
                                          type="button"
                                          onClick={() => selectIngredientFromLibrary(ingredient)}
                                          className="w-full text-left px-4 py-3 hover:bg-emerald-50 border-b border-slate-50 last:border-b-0 transition-all flex items-center justify-between text-xs font-bold text-slate-800"
                                        >
                                          <span>{ingredient.name}</span>
                                          <span className="text-emerald-600">${ingredient.unitCost.toFixed(2)}</span>
                                        </button>
                                      ))}
                                    </>
                                  )}
                                </div>
                              )}
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                              <div className="space-y-1.5">
                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Costo Unitario</label>
                                <div className="relative">
                                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-xs">$</span>
                                  <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    name="unitCost"
                                    value={currentIngredient.unitCost}
                                    onChange={handleIngredientChange}
                                    onWheel={(e) => (e.target as HTMLInputElement).blur()}
                                    className="w-full pl-7 pr-4 py-2.5 bg-slate-50 border border-slate-100 focus:bg-white rounded-xl text-xs font-bold text-slate-850 focus:border-emerald-500 outline-none transition-all"
                                    placeholder="0.00"
                                  />
                                </div>
                              </div>

                              <div className="space-y-1.5">
                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Cantidad</label>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0.01"
                                  name="quantity"
                                  value={currentIngredient.quantity}
                                  onChange={handleIngredientChange}
                                  onWheel={(e) => (e.target as HTMLInputElement).blur()}
                                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-100 focus:bg-white rounded-xl text-xs font-bold text-slate-850 focus:border-emerald-500 outline-none transition-all"
                                  placeholder="1"
                                />
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={addIngredient}
                              className="w-full bg-slate-900 hover:bg-black text-white py-3 px-4 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center gap-2 mt-2 shadow-md shadow-slate-100"
                            >
                              <i className="bi bi-plus-circle-fill text-sm"></i>
                              Agregar a Receta
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Sección de variantes (Si existen variantes) */}
                    {variants.length > 0 && (
                      <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm space-y-4 animate-in fade-in duration-300">
                        <div>
                          <h3 className="font-bold text-slate-800 text-sm">Ingredientes por Variante</h3>
                          <p className="text-[10px] text-slate-400 font-medium mt-0.5">
                            Gestiona insumos de forma aislada. Haz clic en una variante para expandir.
                          </p>
                        </div>

                        <div className="space-y-3">
                          {variants.map((variant) => {
                            const isExpanded = expandedVariantsForIngredients.has(variant.id)
                            const totalCost = (variantIngredients[variant.id] || []).reduce(
                              (sum, ingredient) => sum + (ingredient.quantity * ingredient.unitCost),
                              0
                            )
                            const profit = variant.price ? Number(variant.price) - totalCost : 0

                            return (
                              <div key={variant.id} className="border border-slate-200/80 rounded-2xl overflow-hidden shadow-sm">
                                {/* Header expandible */}
                                <button
                                  type="button"
                                  onClick={() => toggleVariantExpanded(variant.id)}
                                  className="w-full bg-slate-50 hover:bg-slate-100/70 px-4 py-3.5 border-b border-slate-200/60 flex items-center justify-between transition-colors"
                                >
                                  <div className="flex items-center gap-3 flex-1 text-left min-w-0">
                                    <i className={`bi bi-chevron-${isExpanded ? 'down' : 'right'} text-slate-400 text-xs`}></i>
                                    <div className="min-w-0">
                                      <h4 className="font-bold text-slate-800 text-xs truncate">
                                        {variant.name}
                                        {variant.price && (
                                          <span className="ml-1.5 text-[11px] font-semibold text-slate-500">
                                            (${Number(variant.price).toFixed(2)})
                                          </span>
                                        )}
                                      </h4>
                                      <div className="mt-1 flex flex-wrap items-center gap-3 text-[10px] font-bold">
                                        <span className="text-emerald-600">
                                          Costo: ${totalCost.toFixed(2)}
                                        </span>
                                        {variant.price && (
                                          <span className={profit >= 0 ? 'text-emerald-700' : 'text-red-650'}>
                                            Margen: ${profit.toFixed(2)}
                                          </span>
                                        )}
                                        <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${variantIngredients[variant.id]?.length > 0
                                            ? 'bg-blue-50 text-blue-600 border border-blue-100/40'
                                            : 'bg-slate-200 text-slate-500'
                                          }`}>
                                          {variantIngredients[variant.id]?.length || 0} insumos
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                </button>

                                {/* Contenido expandible */}
                                {isExpanded && (
                                  <div className="p-4 bg-white space-y-4 animate-in fade-in duration-200">
                                    {/* Lista de ingredientes */}
                                    {variantIngredients[variant.id]?.length > 0 ? (
                                      <div className="divide-y divide-slate-100 pb-2">
                                        {variantIngredients[variant.id].map((ingredient) => (
                                          <div key={ingredient.id} className="py-2.5 flex justify-between items-center">
                                            <div className="min-w-0 pr-3">
                                              <p className="font-bold text-slate-700 text-xs truncate">{ingredient.name}</p>
                                              <p className="text-[10px] text-slate-400 font-bold mt-0.5">
                                                {ingredient.quantity} × ${ingredient.unitCost.toFixed(2)} =
                                                <span className="text-emerald-600 ml-1">${(ingredient.quantity * ingredient.unitCost).toFixed(2)}</span>
                                              </p>
                                            </div>
                                            <button
                                              type="button"
                                              onClick={() => removeIngredientFromVariant(variant.id, ingredient.id)}
                                              className="w-7 h-7 flex items-center justify-center text-red-500 hover:text-red-700 bg-slate-50 hover:bg-red-50 rounded-lg border border-slate-100 hover:border-red-100 transition-colors"
                                              title="Eliminar insumo"
                                            >
                                              <i className="bi bi-trash text-xs"></i>
                                            </button>
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <p className="text-xs text-slate-400 italic text-center py-2 font-medium">No hay insumos específicos agregados a esta variante.</p>
                                    )}

                                    {/* Formulario de insumos específicos inline */}
                                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-200/60 space-y-3">
                                      <h5 className="text-[9px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                                        <i className="bi bi-plus-circle text-emerald-500"></i>
                                        Añadir Insumo Específico
                                      </h5>

                                      <div className="space-y-3">
                                        <div className="relative ingredient-input-container">
                                          <div className="relative">
                                            <i className="bi bi-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
                                            <input
                                              type="text"
                                              name="name"
                                              value={currentIngredient.name}
                                              onChange={handleIngredientChange}
                                              onFocus={() => setShowIngredientSuggestions(true)}
                                              className="w-full pl-8 pr-4 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-500 text-xs font-bold text-slate-800"
                                              placeholder="Buscar o crear insumo..."
                                              autoComplete="off"
                                            />
                                          </div>

                                          {/* Sugerencias en variante */}
                                          {showIngredientSuggestions && (
                                            <div className="absolute z-[60] w-full mt-1 bg-white border border-slate-100 rounded-xl shadow-lg overflow-hidden max-h-40 overflow-y-auto custom-scrollbar animate-in fade-in duration-200">
                                              {getFilteredIngredients().length > 0 ? (
                                                getFilteredIngredients().map((ingredient) => (
                                                  <button
                                                    key={ingredient.id}
                                                    type="button"
                                                    onClick={() => selectIngredientFromLibrary(ingredient)}
                                                    className="w-full text-left px-3 py-2 hover:bg-emerald-50 border-b border-slate-50 last:border-b-0 text-[11px] font-bold text-slate-700 flex items-center justify-between"
                                                  >
                                                    <span>{ingredient.name}</span>
                                                    <span className="text-emerald-600">${ingredient.unitCost.toFixed(2)}</span>
                                                  </button>
                                                ))
                                              ) : currentIngredient.name.trim() !== '' && (
                                                <button
                                                  type="button"
                                                  onClick={() => setShowIngredientSuggestions(false)}
                                                  className="w-full text-left px-3 py-2.5 bg-emerald-50 hover:bg-emerald-100 text-[11px] font-bold text-emerald-700 transition-all flex items-center gap-1.5"
                                                >
                                                  <i className="bi bi-plus-lg bg-white p-0.5 rounded shadow-sm text-[10px]"></i>
                                                  Crear "{currentIngredient.name}"
                                                </button>
                                              )}
                                            </div>
                                          )}
                                        </div>

                                        <div className="grid grid-cols-2 gap-3">
                                          <div className="relative">
                                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[10px] font-bold">$</span>
                                            <input
                                              type="number"
                                              step="0.01"
                                              min="0"
                                              name="unitCost"
                                              value={currentIngredient.unitCost}
                                              onChange={handleIngredientChange}
                                              className="w-full pl-6 pr-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-500 text-xs font-bold text-slate-800"
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
                                            className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-500 text-xs font-bold text-slate-800"
                                            placeholder="Cantidad"
                                          />
                                        </div>

                                        <button
                                          type="button"
                                          onClick={() => addIngredientToVariant(variant.id)}
                                          className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-2 px-3 text-[10px] rounded-lg transition-all font-black uppercase tracking-wider shadow-sm"
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

                {/* PESTAÑA: TOPPINGS */}
                {activeTab === 'options' && (
                  <div className="space-y-6 max-w-3xl mx-auto animate-in fade-in duration-300">
                    <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col sm:flex-row justify-between items-center gap-4">
                      <div>
                        <h3 className="font-bold text-slate-800 text-sm">Grupos de Toppings</h3>
                        <p className="text-[10px] text-slate-400 font-medium mt-0.5">Crea salsas, aderezos o adicionales opcionales o requeridos.</p>
                      </div>
                      <button
                        type="button"
                        onClick={handleAddOptionGroup}
                        className="px-4 py-2.5 bg-[#aa1918] hover:bg-[#8f1514] text-white text-xs font-black uppercase tracking-wider rounded-xl transition-colors flex items-center gap-1.5 shadow-md shadow-red-100"
                      >
                        <i className="bi bi-plus-lg text-xs"></i>
                        Nuevo Grupo
                      </button>
                    </div>

                    {/* Formulario de creación/edición de grupo de toppings */}
                    {editingGroupIndex !== null && (
                      <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200/80 space-y-4 shadow-inner">
                        <div className="flex items-center gap-2 pb-2 border-b border-slate-200/50">
                          <div className="w-1.5 h-3.5 bg-[#aa1918] rounded-full"></div>
                          <h4 className="font-black text-slate-700 text-[10px] uppercase tracking-wider">
                            {editingGroupIndex === -1 ? 'Crear Grupo de Toppings' : 'Editar Grupo de Toppings'}
                          </h4>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                          <div className="space-y-1.5">
                            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Nombre Categoría</label>
                            <input
                              type="text"
                              value={currentGroup.name}
                              onChange={(e) => setCurrentGroup(prev => ({ ...prev, name: e.target.value }))}
                              placeholder="Ej: Salsas, Quesos, Adicionales..."
                              className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-[#aa1918] text-xs font-bold text-slate-800 transition-all shadow-sm"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Mínimo a Elegir</label>
                            <input
                              type="number"
                              min="0"
                              value={currentGroup.minSelect}
                              onChange={(e) => setCurrentGroup(prev => ({ ...prev, minSelect: Math.max(0, parseInt(e.target.value) || 0) }))}
                              className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-[#aa1918] text-xs font-bold text-slate-800 transition-all shadow-sm"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Máximo a Elegir</label>
                            <input
                              type="number"
                              min="1"
                              value={currentGroup.maxSelect}
                              onChange={(e) => setCurrentGroup(prev => ({ ...prev, maxSelect: Math.max(1, parseInt(e.target.value) || 1) }))}
                              className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-[#aa1918] text-xs font-bold text-slate-800 transition-all shadow-sm"
                            />
                          </div>
                        </div>

                        {/* Listado y formulario de toppings individuales */}
                        <div className="space-y-3 bg-white p-4 rounded-xl border border-slate-200/50">
                          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Toppings en este grupo</label>

                          {/* Lista vertical de toppings */}
                          {currentGroup.options.length > 0 ? (
                            <div className="space-y-2 pr-1 max-h-64 overflow-y-auto custom-scrollbar">
                              {currentGroup.options.map((opt, oIdx) => {
                                const isEditing = editingOptionIndex === oIdx
                                const isAvailable = opt.isAvailable !== false

                                return (
                                  <div
                                    key={oIdx}
                                    className={`flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-xl border transition-all gap-2 ${isEditing
                                        ? 'border-blue-200 bg-blue-50/20'
                                        : isAvailable
                                          ? 'border-slate-100 bg-slate-50 hover:bg-slate-100/70'
                                          : 'border-slate-100 bg-slate-50/50 opacity-70'
                                      }`}
                                  >
                                    {isEditing ? (
                                      <div className="flex flex-1 flex-col sm:flex-row gap-2 items-center w-full">
                                        <input
                                          type="text"
                                          value={editingOptionName}
                                          onChange={(e) => setEditingOptionName(e.target.value)}
                                          className="w-full sm:flex-1 px-3 py-1.5 border border-slate-200 focus:border-[#aa1918] rounded-lg text-xs font-bold outline-none bg-white"
                                          placeholder="Nombre del topping"
                                        />
                                        <div className="relative w-full sm:w-24">
                                          <span className="absolute left-2.5 top-1.5 text-slate-400 text-xs font-bold">$</span>
                                          <input
                                            type="number"
                                            step="0.01"
                                            min="0"
                                            value={editingOptionPrice}
                                            onChange={(e) => setEditingOptionPrice(e.target.value)}
                                            className="w-full pl-5 pr-2 py-1.5 border border-slate-200 focus:border-[#aa1918] rounded-lg text-xs font-bold outline-none bg-white"
                                            placeholder="Precio"
                                          />
                                        </div>
                                        <div className="flex gap-1 w-full sm:w-auto justify-end">
                                          <button
                                            type="button"
                                            onClick={() => handleSaveEditingOption(oIdx)}
                                            className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-black uppercase rounded-lg transition-colors"
                                          >
                                            Guardar
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => setEditingOptionIndex(null)}
                                            className="px-2.5 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-650 text-[10px] font-black uppercase rounded-lg transition-colors"
                                          >
                                            Cancelar
                                          </button>
                                        </div>
                                      </div>
                                    ) : (
                                      <>
                                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isAvailable ? 'bg-emerald-500' : 'bg-slate-300'}`}></span>
                                          <div className="font-bold text-xs text-slate-700 truncate">
                                            {opt.name}
                                          </div>
                                          {!isAvailable && (
                                            <span className="bg-slate-200 text-slate-500 text-[8px] font-black uppercase px-1.5 py-0.5 rounded border border-slate-300/40">
                                              Oculto
                                            </span>
                                          )}
                                          <span className="text-emerald-600 text-xs font-black">
                                            {opt.price > 0 ? `+$${opt.price.toFixed(2)}` : 'Gratis'}
                                          </span>
                                        </div>

                                        <div className="flex items-center gap-1 flex-shrink-0 self-end sm:self-auto">
                                          {/* Ocultar / Mostrar */}
                                          <button
                                            type="button"
                                            onClick={() => handleToggleOptionAvailability(oIdx)}
                                            className={`w-7 h-7 flex items-center justify-center rounded-lg border transition-all ${isAvailable
                                                ? 'text-slate-400 hover:text-slate-600 hover:bg-slate-100 border-transparent'
                                                : 'text-amber-500 bg-amber-50 border-amber-100 hover:bg-amber-100 hover:text-amber-600'
                                              }`}
                                            title={isAvailable ? 'Ocultar topping' : 'Mostrar topping'}
                                          >
                                            <i className={`bi ${isAvailable ? 'bi-eye' : 'bi-eye-slash'} text-xs`}></i>
                                          </button>

                                          {/* Editar */}
                                          <button
                                            type="button"
                                            onClick={() => handleStartEditOption(oIdx, opt)}
                                            className="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg border border-transparent hover:border-blue-100 transition-all"
                                            title="Editar topping"
                                          >
                                            <i className="bi bi-pencil text-xs"></i>
                                          </button>

                                          {/* Eliminar */}
                                          <button
                                            type="button"
                                            onClick={() => handleRemoveOptionFromGroup(oIdx)}
                                            className="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-red-650 hover:bg-red-50 rounded-lg border border-transparent hover:border-red-100 transition-all"
                                            title="Eliminar topping"
                                          >
                                            <i className="bi bi-trash text-xs"></i>
                                          </button>
                                        </div>
                                      </>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          ) : (
                            <p className="text-xs text-slate-400 italic font-medium ml-1">Aún no hay toppings en este grupo.</p>
                          )}

                          {/* Fila para agregar topping rápidamente */}
                          <div className="flex flex-col sm:flex-row gap-2 items-center pt-2">
                            <input
                              type="text"
                              placeholder="Nombre: Queso Cheddar, Salsa BBQ..."
                              value={newOptionName}
                              onChange={(e) => setNewOptionName(e.target.value)}
                              className="w-full sm:flex-1 px-4 py-2.5 border border-slate-200 focus:border-[#aa1918] rounded-xl text-xs font-semibold outline-none transition-all"
                            />

                            <div className="relative w-full sm:w-28">
                              <span className="absolute left-3 top-2.5 text-slate-400 text-xs font-bold">$</span>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                placeholder="Precio"
                                value={newOptionPrice}
                                onChange={(e) => setNewOptionPrice(e.target.value)}
                                className="w-full pl-6 pr-3 py-2.5 border border-slate-200 focus:border-[#aa1918] rounded-xl text-xs font-semibold outline-none transition-all"
                              />
                            </div>

                            <button
                              type="button"
                              onClick={handleAddOptionToGroup}
                              className="w-full sm:w-auto px-4 py-2.5 bg-slate-900 hover:bg-black text-white text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-1 shadow-sm"
                            >
                              <i className="bi bi-plus-lg"></i>
                              Añadir
                            </button>
                          </div>
                        </div>

                        {/* Botones de acción del grupo */}
                        <div className="flex gap-2 pt-2 justify-end border-t border-slate-200/50">
                          <button
                            type="button"
                            onClick={() => setEditingGroupIndex(null)}
                            className="px-4 py-2 border border-slate-300 text-slate-600 text-xs font-bold rounded-xl hover:bg-slate-100 transition-colors"
                          >
                            Cancelar
                          </button>
                          <button
                            type="button"
                            onClick={handleSaveOptionGroup}
                            className="px-4 py-2 bg-[#aa1918] hover:bg-[#8f1514] text-white text-xs font-black uppercase tracking-wider rounded-xl transition-colors shadow-sm shadow-red-100"
                          >
                            Guardar Grupo
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Lista de grupos de toppings agregados */}
                    <div className="space-y-3">
                      {optionGroups.length > 0 ? (
                        optionGroups.map((group, idx) => (
                          <div key={group.id} className="bg-white p-5 rounded-2xl border border-slate-100 flex items-start justify-between shadow-sm hover:shadow-md transition-all duration-300">
                            <div className="space-y-2.5 min-w-0 pr-4">
                              <div className="flex flex-wrap items-center gap-2">
                                <h4 className="font-bold text-slate-800 text-xs">{group.name}</h4>
                                <span className="bg-slate-100 text-slate-500 text-[9px] font-black uppercase px-2 py-0.5 rounded-md border border-slate-200/40">
                                  {group.minSelect === 0 ? 'Opcional' : `Mínimo: ${group.minSelect}`} | Máximo: {group.maxSelect}
                                </span>
                              </div>

                              <div className="flex flex-wrap gap-1.5">
                                {group.options.map((o, oIdx) => {
                                  const isAvailable = o.isAvailable !== false
                                  return (
                                    <span
                                      key={oIdx}
                                      className={`text-[10px] font-bold px-2 py-1 rounded-lg border flex items-center gap-1 shadow-sm transition-all ${isAvailable
                                          ? 'bg-slate-50 text-slate-600 border-slate-100/60'
                                          : 'bg-slate-100 text-slate-400 border-slate-200/40 line-through opacity-70'
                                        }`}
                                      title={isAvailable ? 'Disponible' : 'Oculto'}
                                    >
                                      <span>{o.name}</span>
                                      <span className={isAvailable ? 'text-emerald-600' : 'text-slate-400'}>
                                        {o.price > 0 ? `+$${o.price.toFixed(2)}` : 'Gratis'}
                                      </span>
                                      {!isAvailable && <i className="bi bi-eye-slash text-[9px] ml-0.5"></i>}
                                    </span>
                                  )
                                })}
                              </div>
                            </div>

                            <div className="flex items-center gap-1 flex-shrink-0">
                              <button
                                type="button"
                                onClick={() => handleEditOptionGroup(idx)}
                                className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg border border-transparent hover:border-blue-100 transition-all"
                              >
                                <i className="bi bi-pencil text-xs"></i>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRemoveOptionGroup(idx)}
                                className="w-8 h-8 flex items-center justify-center text-slate-350 hover:text-red-600 hover:bg-red-50 rounded-lg border border-transparent hover:border-red-100 transition-all"
                              >
                                <i className="bi bi-trash text-xs"></i>
                              </button>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="text-center py-10 bg-slate-50 rounded-2xl border border-dashed border-slate-250 p-6">
                          <div className="w-12 h-12 bg-white border border-slate-100 rounded-full flex items-center justify-center mx-auto mb-3 shadow-sm text-slate-400">
                            <i className="bi bi-gear text-lg"></i>
                          </div>
                          <p className="text-xs font-bold text-slate-600">No hay toppings configurados</p>
                          <p className="text-[10px] text-slate-400 mt-1 max-w-xs mx-auto leading-normal">Crea grupos de toppings (ej: Salsas, Adicionales) para que tus clientes puedan personalizar sus pedidos.</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Error general */}
                {errors.submit && (
                  <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 animate-in fade-in duration-200">
                    <p className="text-red-600 text-xs font-bold flex items-center gap-1.5">
                      <i className="bi bi-exclamation-triangle-fill"></i>
                      {errors.submit}
                    </p>
                  </div>
                )}
              </div>

              {/* Pie fijo: botones de acción */}
              <div className="px-6 py-4 bg-white border-t border-slate-100 flex gap-3 flex-shrink-0 sm:rounded-b-[2rem]">
                <button
                  type="button"
                  onClick={handleCloseForm}
                  disabled={uploading}
                  className="flex-1 px-4 py-3 border border-slate-200 rounded-xl text-slate-600 hover:text-slate-800 hover:bg-slate-50 active:bg-slate-100 transition-colors font-bold text-sm disabled:opacity-50"
                >
                  Cancelar
                </button>

                <button
                  type="submit"
                  disabled={uploading}
                  className="flex-1 px-4 py-3 bg-[#aa1918] text-white rounded-xl hover:bg-[#8f1514] active:scale-95 transition-all font-bold text-sm disabled:opacity-50 flex items-center justify-center gap-2 shadow-md"
                >
                  {uploading ? (
                    <>
                      <i className="bi bi-arrow-clockwise animate-spin text-sm"></i>
                      {formData.image ? 'Subiendo imagen...' : 'Guardando...'}
                    </>
                  ) : (
                    <>
                      <i className="bi bi-check-lg text-sm"></i>
                      {editingProduct ? 'Guardar Cambios' : 'Crear Producto'}
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
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
      {showJsonImport && isMounted && createPortal(
        <div className="fixed inset-0 w-screen h-screen bg-black/60 backdrop-blur-md flex items-center justify-center z-[9999] p-4 overflow-y-auto">
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
        </div>,
        document.body
      )}

      {/* Modal para Añadidos Rápidos */}
      {quickAddonProduct && isMounted && createPortal(
        <div className="fixed inset-0 w-screen h-screen bg-black/60 backdrop-blur-md flex items-center justify-center z-[9999] p-4 overflow-y-auto">
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
                            className={`flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer select-none ${isChecked
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
        </div>,
        document.body
      )}

      {/* Botón flotante para nuevo producto */}
      {activeSection === 'mis-productos' && (
        <button
          onClick={handleOpenNewProduct}
          className="fixed bottom-6 right-6 w-14 h-14 bg-red-600 text-white rounded-full shadow-2xl hover:bg-red-700 transition-all active:scale-90 flex items-center justify-center z-[100] group"
          title="Nuevo Producto"
        >
          <i className="bi bi-plus-lg text-2xl group-hover:rotate-90 transition-transform duration-300"></i>
        </button>
      )}
    </div >
  )
}
