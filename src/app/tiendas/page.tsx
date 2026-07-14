'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import {
  getAllBusinesses,
  createBusinessFromForm,
  uploadImage,
  updateBusiness,
  getProductsByBusiness,
  createProduct,
  updateProduct,
  deleteProduct,
} from '@/lib/database'
import { Business, BankAccount, Product, CommissionType } from '@/types'
import { calculateCommissionPricing, getBusinessCommissionSettings } from '@/lib/price-utils'
import { isStoreOpen, getStoreStatusDescription } from '@/lib/store-utils'
import { optimizeImage } from '@/lib/image-utils'

const DAYS_ES: Record<string, string> = {
  monday: 'Lunes',
  tuesday: 'Martes',
  wednesday: 'Miércoles',
  thursday: 'Jueves',
  friday: 'Viernes',
  saturday: 'Sábado',
  sunday: 'Domingo',
}
const DAY_ORDER = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

const DEFAULT_BANKS = [
  'Banco Pichincha',
  'Banco Guayaquil',
  'Banco del Pacífico',
  'Produbanco',
  'Banco Internacional',
  'Banco Bolivariano',
  'Banco de Loja',
  'Banco del Austro',
  'Banco Solidario',
  'Cooperativa JEP',
  'Cooperativa Alianza del Valle',
  'Cooperativa MEGO',
]

export default function TiendasPage() {
  const [businesses, setBusinesses] = useState<Business[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('Todos')
  const [selectedBusiness, setSelectedBusiness] = useState<Business | null>(null)
  
  // Modals state
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [activeModalTab, setActiveModalTab] = useState<'general' | 'bank' | 'products'>('general')
  const [savingBank, setSavingBank] = useState(false)
  const [showBankFormModal, setShowBankFormModal] = useState(false)
  const [editingBankAccount, setEditingBankAccount] = useState<BankAccount | null>(null)
  const [bankForm, setBankForm] = useState({
    bankName: '',
    accountType: 'Ahorros',
    accountNumber: '',
    accountHolder: '',
    isDefault: false
  })

  // Products state
  const [businessProducts, setBusinessProducts] = useState<Product[]>([])
  const [loadingProducts, setLoadingProducts] = useState(false)
  const [showProductFormModal, setShowProductFormModal] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)
  const [productForm, setProductForm] = useState({
    name: '',
    description: '',
    price: '',
    category: 'General',
    isAvailable: true
  })
  const [showJsonImportModal, setShowJsonImportModal] = useState(false)
  const [jsonText, setJsonText] = useState('')
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [parsedProducts, setParsedProducts] = useState<any[]>([])
  const [isImporting, setIsImporting] = useState(false)
  
  // Form state
  const [formData, setFormData] = useState({
    name: '',
    username: '',
    email: '',
    phone: '',
    description: '',
    category: 'Restaurante',
    businessType: 'food_store' as 'food_store' | 'distributor',
    deliveryTime: 30,
    latlong: '',
    pickupReferences: '',
  })
  
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [coverFile, setCoverFile] = useState<File | null>(null)
  const [coverPreview, setCoverPreview] = useState<string | null>(null)
  const [locationFile, setLocationFile] = useState<File | null>(null)
  const [locationPreview, setLocationPreview] = useState<string | null>(null)
  
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  
  const fileInputLogoRef = useRef<HTMLInputElement>(null)
  const fileInputCoverRef = useRef<HTMLInputElement>(null)
  const fileInputLocationRef = useRef<HTMLInputElement>(null)

  const loadBusinessProducts = async (businessId: string) => {
    try {
      setLoadingProducts(true)
      const prods = await getProductsByBusiness(businessId)
      setBusinessProducts(prods)
    } catch (err) {
      console.error('Error loading products for business:', err)
    } finally {
      setLoadingProducts(false)
    }
  }

  useEffect(() => {
    if (selectedBusiness) {
      setActiveModalTab('general')
      setShowBankFormModal(false)
      setEditingBankAccount(null)
      setBusinessProducts([])
    }
  }, [selectedBusiness])

  useEffect(() => {
    if (selectedBusiness && activeModalTab === 'products') {
      loadBusinessProducts(selectedBusiness.id)
    }
  }, [selectedBusiness, activeModalTab])

  const handleSaveBankAccount = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedBusiness) return
    
    if (!bankForm.bankName.trim() || !bankForm.accountNumber.trim() || !bankForm.accountHolder.trim()) {
      alert('Por favor completa todos los campos requeridos')
      return
    }

    try {
      setSavingBank(true)
      const currentAccounts = selectedBusiness.bankAccounts || []
      let updatedAccounts: BankAccount[] = []
      
      const newAccount: BankAccount = {
        id: editingBankAccount?.id || Date.now().toString(),
        bankName: bankForm.bankName.trim(),
        accountType: bankForm.accountType,
        accountNumber: bankForm.accountNumber.trim(),
        accountHolder: bankForm.accountHolder.trim(),
        isDefault: bankForm.isDefault
      }

      if (editingBankAccount) {
        // Editar existente
        updatedAccounts = currentAccounts.map(acc => acc.id === editingBankAccount.id ? newAccount : acc)
      } else {
        // Agregar nueva
        updatedAccounts = [...currentAccounts, newAccount]
      }

      // Si es la única cuenta o si se marca como predeterminada, asegurar que sea predeterminada
      if (updatedAccounts.length === 1) {
        updatedAccounts[0].isDefault = true
      } else if (newAccount.isDefault) {
        updatedAccounts = updatedAccounts.map(acc => acc.id === newAccount.id ? { ...acc, isDefault: true } : { ...acc, isDefault: false })
      }

      // Encontrar la cuenta predeterminada para el campo singular bankAccount (compatibilidad)
      const defaultAcc = updatedAccounts.find(acc => acc.isDefault) || updatedAccounts[0]
      const singularBankAccount = defaultAcc ? {
        bankName: defaultAcc.bankName,
        accountType: defaultAcc.accountType,
        accountNumber: defaultAcc.accountNumber,
        accountHolder: defaultAcc.accountHolder
      } : undefined

      const updates = {
        bankAccounts: updatedAccounts,
        bankAccount: singularBankAccount
      }

      await updateBusiness(selectedBusiness.id, updates)

      // Actualizar estado local
      setBusinesses(prev => prev.map(b => b.id === selectedBusiness.id ? { ...b, ...updates } : b))
      setSelectedBusiness(prev => prev ? { ...prev, ...updates } : null)

      setSuccessMessage(editingBankAccount ? 'Cuenta modificada con éxito' : 'Cuenta agregada con éxito')
      setTimeout(() => setSuccessMessage(null), 3000)
      setShowBankFormModal(false)
    } catch (err) {
      console.error('Error saving bank account:', err)
      alert('Error al guardar la cuenta bancaria')
    } finally {
      setSavingBank(false)
    }
  }

  const handleSetDefaultBankAccount = async (accId: string) => {
    if (!selectedBusiness || !selectedBusiness.bankAccounts) return
    try {
      setSavingBank(true)
      const updatedAccounts = selectedBusiness.bankAccounts.map(acc => 
        acc.id === accId ? { ...acc, isDefault: true } : { ...acc, isDefault: false }
      )
      
      const defaultAcc = updatedAccounts.find(acc => acc.isDefault)
      const singularBankAccount = defaultAcc ? {
        bankName: defaultAcc.bankName,
        accountType: defaultAcc.accountType,
        accountNumber: defaultAcc.accountNumber,
        accountHolder: defaultAcc.accountHolder
      } : undefined

      const updates = {
        bankAccounts: updatedAccounts,
        bankAccount: singularBankAccount
      }

      await updateBusiness(selectedBusiness.id, updates)

      setBusinesses(prev => prev.map(b => b.id === selectedBusiness.id ? { ...b, ...updates } : b))
      setSelectedBusiness(prev => prev ? { ...prev, ...updates } : null)

      setSuccessMessage('Cuenta predeterminada establecida')
      setTimeout(() => setSuccessMessage(null), 3000)
    } catch (err) {
      console.error('Error setting default bank account:', err)
      alert('Error al establecer cuenta predeterminada')
    } finally {
      setSavingBank(false)
    }
  }

  const handleDeleteBankAccount = async (accId: string) => {
    if (!selectedBusiness || !selectedBusiness.bankAccounts) return
    if (!confirm('¿Estás seguro de eliminar esta cuenta bancaria?')) return

    try {
      setSavingBank(true)
      let updatedAccounts = selectedBusiness.bankAccounts.filter(acc => acc.id !== accId)
      
      // Si eliminamos la cuenta por defecto y quedan otras, marcar la primera como por defecto
      if (updatedAccounts.length > 0 && !updatedAccounts.some(acc => acc.isDefault)) {
        updatedAccounts[0].isDefault = true
      }

      const defaultAcc = updatedAccounts.find(acc => acc.isDefault)
      const singularBankAccount = defaultAcc ? {
        bankName: defaultAcc.bankName,
        accountType: defaultAcc.accountType,
        accountNumber: defaultAcc.accountNumber,
        accountHolder: defaultAcc.accountHolder
      } : undefined

      // Para Firestore, pasamos null para eliminar el campo de la base de datos si no hay cuenta predeterminada
      await updateBusiness(selectedBusiness.id, {
        bankAccounts: updatedAccounts,
        bankAccount: singularBankAccount || null as any
      })

      // Para el estado local de React, usamos undefined para mantener consistencia con los tipos
      const stateUpdates = {
        bankAccounts: updatedAccounts,
        bankAccount: singularBankAccount
      }

      setBusinesses(prev => prev.map(b => b.id === selectedBusiness.id ? { ...b, ...stateUpdates } : b))
      setSelectedBusiness(prev => prev ? { ...prev, ...stateUpdates } : null)

      setSuccessMessage('Cuenta eliminada con éxito')
      setTimeout(() => setSuccessMessage(null), 3000)
    } catch (err) {
      console.error('Error deleting bank account:', err)
      alert('Error al eliminar la cuenta bancaria')
    } finally {
      setSavingBank(false)
    }
  }

  const getSuggestedBanks = () => {
    const fromBusinesses = businesses.flatMap(b => {
      const names: string[] = []
      if (b.bankAccount?.bankName) names.push(b.bankAccount.bankName)
      if (b.bankAccounts) {
        b.bankAccounts.forEach(acc => {
          if (acc.bankName) names.push(acc.bankName)
        })
      }
      return names
    })
    
    const allUnique = new Set<string>()
    DEFAULT_BANKS.forEach(b => allUnique.add(b))
    fromBusinesses.forEach(b => {
      if (b) {
        const exists = Array.from(allUnique).some(item => item.toLowerCase() === b.toLowerCase())
        if (!exists) {
          allUnique.add(b)
        }
      }
    })
    return Array.from(allUnique)
  }

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedBusiness) return
    
    if (!productForm.name.trim() || !productForm.price.trim()) {
      alert('Por favor completa los campos obligatorios (Nombre y Precio)')
      return
    }

    try {
      setLoadingProducts(true)
      const commissionSettings = getBusinessCommissionSettings(selectedBusiness)
      const parsedPrice = parseFloat(productForm.price) || 0
      
      const pricing = calculateCommissionPricing(
        parsedPrice,
        (selectedBusiness.defaultCommissionType || 'no_commission') as CommissionType,
        commissionSettings.commissionRate
      )

      const cleanCategory = (productForm.category || '').trim();
      const finalCategory = (cleanCategory === '' || cleanCategory.toLowerCase() === 'sin categoría' || cleanCategory.toLowerCase() === 'sin categoria') ? '' : cleanCategory;

      const productData = {
        name: productForm.name.trim(),
        description: productForm.description.trim(),
        price: pricing.publicPrice,
        basePrice: pricing.storePrice,
        commission: pricing.commission,
        commissionType: pricing.commissionType,
        category: finalCategory,
        image: editingProduct?.image || '',
        isAvailable: productForm.isAvailable,
        businessId: selectedBusiness.id,
        updatedAt: new Date()
      }

      if (editingProduct) {
        // Actualizar
        await updateProduct(editingProduct.id, productData)
        setBusinessProducts(prev => prev.map(p => p.id === editingProduct.id ? { ...p, ...productData } : p))
        setSuccessMessage('Producto actualizado con éxito')
      } else {
        // Crear
        const newId = await createProduct(productData, selectedBusiness.username)
        const newProduct = {
          id: newId,
          ...productData,
          createdAt: new Date(),
        } as Product
        setBusinessProducts(prev => [newProduct, ...prev])
        setSuccessMessage('Producto creado con éxito')
      }

      // Sincronizar categoría en el negocio si es nueva
      const existingCategories = selectedBusiness.categories || []
      if (productData.category && !existingCategories.includes(productData.category)) {
        const newCats = [...existingCategories, productData.category]
        await updateBusiness(selectedBusiness.id, { categories: newCats })
        setBusinesses(prev => prev.map(b => b.id === selectedBusiness.id ? { ...b, categories: newCats } : b))
        setSelectedBusiness(prev => prev ? { ...prev, categories: newCats } : null)
      }

      setTimeout(() => setSuccessMessage(null), 3000)
      setShowProductFormModal(false)
    } catch (err) {
      console.error('Error saving product:', err)
      alert('Error al guardar el producto')
    } finally {
      setLoadingProducts(false)
    }
  }

  const handleDeleteProduct = async (productId: string) => {
    if (!confirm('¿Estás seguro de eliminar este producto?')) return
    try {
      setLoadingProducts(true)
      await deleteProduct(productId)
      setBusinessProducts(prev => prev.filter(p => p.id !== productId))
      setSuccessMessage('Producto eliminado con éxito')
      setTimeout(() => setSuccessMessage(null), 3000)
    } catch (err) {
      console.error('Error deleting product:', err)
      alert('Error al eliminar el producto')
    } finally {
      setLoadingProducts(false)
    }
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
    if (!selectedBusiness || parsedProducts.length === 0) return
    setIsImporting(true)

    const commissionSettings = getBusinessCommissionSettings(selectedBusiness)
    const importedCategories = new Set<string>()

    try {
      for (let i = 0; i < parsedProducts.length; i++) {
        const p = parsedProducts[i]
        
        const productPricing = calculateCommissionPricing(
          p.price,
          (p.commissionType || selectedBusiness.defaultCommissionType || 'no_commission') as CommissionType,
          commissionSettings.commissionRate
        )

        const variantsWithCommission = (p.variants || []).map((v: any) => {
          const variantPricing = calculateCommissionPricing(
            v.price,
            (p.commissionType || selectedBusiness.defaultCommissionType || 'no_commission') as CommissionType,
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
          businessId: selectedBusiness.id,
          updatedAt: new Date()
        }

        await createProduct(productData, selectedBusiness.username)

        if (p.category) {
          importedCategories.add(p.category)
        }
      }

      // Sincronizar categorías en el negocio
      const existingCategories = selectedBusiness.categories || []
      const updatedCategoriesList = Array.from(new Set([...existingCategories, ...Array.from(importedCategories)]))
      if (updatedCategoriesList.length !== existingCategories.length) {
        await updateBusiness(selectedBusiness.id, { categories: updatedCategoriesList })
        setBusinesses(prev => prev.map(b => b.id === selectedBusiness.id ? { ...b, categories: updatedCategoriesList } : b))
        setSelectedBusiness(prev => prev ? { ...prev, categories: updatedCategoriesList } : null)
      }

      // Recargar la lista de productos
      await loadBusinessProducts(selectedBusiness.id)
      
      setSuccessMessage(`Importados ${parsedProducts.length} productos con éxito`)
      setTimeout(() => setSuccessMessage(null), 3000)
      setShowJsonImportModal(false)
      setJsonText('')
      setParsedProducts([])
    } catch (error) {
      console.error('Error importing products:', error)
      alert('Ocurrió un error al importar los productos.')
    } finally {
      setIsImporting(false)
    }
  }

  useEffect(() => {
    loadBusinesses()
  }, [])

  const loadBusinesses = async () => {
    try {
      setLoading(true)
      const data = await getAllBusinesses()
      // Calcular isOpen
      const resolved = data.map(b => ({
        ...b,
        isOpen: isStoreOpen(b)
      }))
      setBusinesses(resolved)
    } catch (e) {
      console.error('Error loading businesses:', e)
    } finally {
      setLoading(false)
    }
  }

  // Categories list extracted dynamically + default ones
  const categories = ['Todos', 'Restaurante', 'Cafetería', 'Repostería', 'Distribuidor', 'Supermercado', 'Otro']

  const filteredBusinesses = businesses.filter(b => {
    const matchesSearch = 
      b.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (b.description && b.description.toLowerCase().includes(searchQuery.toLowerCase())) ||
      b.username.toLowerCase().includes(searchQuery.toLowerCase())
      
    const matchesCategory = 
      selectedCategory === 'Todos' ||
      (selectedCategory === 'Distribuidor' && b.businessType === 'distributor') ||
      b.category === selectedCategory ||
      (b.categories && b.categories.includes(selectedCategory))
      
    return matchesSearch && matchesCategory
  })

  const handleLogoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      if (!file.type.startsWith('image/')) {
        setErrors(prev => ({ ...prev, logo: 'Solo se permiten imágenes' }))
        return
      }
      if (file.size > 5 * 1024 * 1024) {
        setErrors(prev => ({ ...prev, logo: 'La imagen debe ser menor a 5MB' }))
        return
      }
      setLogoFile(file)
      setErrors(prev => {
        const copy = { ...prev }
        delete copy.logo
        return copy
      })
      const reader = new FileReader()
      reader.onload = (event) => setLogoPreview(event.target?.result as string)
      reader.readAsDataURL(file)
    }
  }

  const handleCoverSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      if (!file.type.startsWith('image/')) {
        setErrors(prev => ({ ...prev, cover: 'Solo se permiten imágenes' }))
        return
      }
      if (file.size > 5 * 1024 * 1024) {
        setErrors(prev => ({ ...prev, cover: 'La imagen debe ser menor a 5MB' }))
        return
      }
      setCoverFile(file)
      setErrors(prev => {
        const copy = { ...prev }
        delete copy.cover
        return copy
      })
      const reader = new FileReader()
      reader.onload = (event) => setCoverPreview(event.target?.result as string)
      reader.readAsDataURL(file)
    }
  }

  const handleLocationSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      if (!file.type.startsWith('image/')) {
        setErrors(prev => ({ ...prev, locationPhoto: 'Solo se permiten imágenes' }))
        return
      }
      if (file.size > 5 * 1024 * 1024) {
        setErrors(prev => ({ ...prev, locationPhoto: 'La imagen debe ser menor a 5MB' }))
        return
      }
      setLocationFile(file)
      setErrors(prev => {
        const copy = { ...prev }
        delete copy.locationPhoto
        return copy
      })
      const reader = new FileReader()
      reader.onload = (event) => setLocationPreview(event.target?.result as string)
      reader.readAsDataURL(file)
    }
  }

  const handleGetLocation = () => {
    if (!navigator.geolocation) {
      alert('La geolocalización no está soportada por tu navegador')
      return
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords
        setFormData(prev => ({ ...prev, latlong: `${latitude}, ${longitude}` }))
      },
      (error) => {
        console.error('Error getting location:', error)
        alert('No se pudo obtener la ubicación. Permite el acceso GPS o ingrésala manualmente.')
      }
    )
  }

  const validateForm = () => {
    const newErrors: Record<string, string> = {}
    
    if (!formData.name.trim()) newErrors.name = 'El nombre es obligatorio'
    
    if (!formData.username.trim()) {
      newErrors.username = 'El username es obligatorio'
    } else if (!/^[a-z0-9-]+$/.test(formData.username.trim())) {
      newErrors.username = 'El username solo debe contener minúsculas, números y guiones'
    } else if (businesses.some(b => b.username === formData.username.trim())) {
      newErrors.username = 'Este username ya está registrado por otra tienda'
    }
    
    if (!formData.email.trim()) {
      newErrors.email = 'El email es obligatorio'
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())) {
      newErrors.email = 'Formato de email inválido'
    }
    
    if (!formData.phone.trim()) {
      newErrors.phone = 'El teléfono es obligatorio'
    } else {
      const cleanPhone = formData.phone.trim().replace(/[^\d]/g, '')
      if (!/^09\d{8}$/.test(cleanPhone)) {
        newErrors.phone = 'El teléfono debe ser celular ecuatoriano (ej: 0998877665, 10 dígitos)'
      }
    }
    
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validateForm()) return

    try {
      setSubmitting(true)
      let logoUrl = ''
      let coverUrl = ''
      let locationUrl = ''

      // Subir logo comprimido
      if (logoFile) {
        try {
          const optimizedLogo = await optimizeImage(logoFile, 500, 0.8)
          const logoPath = `businesses/${Date.now()}_logo.webp`
          logoUrl = await uploadImage(optimizedLogo as File, logoPath)
        } catch (err) {
          console.error('Error uploading logo image:', err)
        }
      }

      // Subir portada comprimida
      if (coverFile) {
        try {
          const optimizedCover = await optimizeImage(coverFile, 1200, 0.7)
          const coverPath = `businesses/covers/${Date.now()}_cover.webp`
          coverUrl = await uploadImage(optimizedCover as File, coverPath)
        } catch (err) {
          console.error('Error uploading cover image:', err)
        }
      }

      // Subir foto de ubicación comprimida
      if (locationFile) {
        try {
          const optimizedLocation = await optimizeImage(locationFile, 800, 0.7)
          const locationPath = `businesses/locations/${Date.now()}_location.webp`
          locationUrl = await uploadImage(optimizedLocation as File, locationPath)
        } catch (err) {
          console.error('Error uploading location image:', err)
        }
      }

      // Crear negocio en Firestore
      const businessId = await createBusinessFromForm({
        name: formData.name.trim(),
        username: formData.username.trim().toLowerCase(),
        email: formData.email.trim(),
        phone: formData.phone.trim(),
        description: formData.description.trim(),
        image: logoUrl,
        coverImage: coverUrl,
        category: formData.category,
        businessType: formData.businessType,
        latlong: formData.latlong || undefined,
        deliveryTime: formData.deliveryTime || 30,
        pickupReferences: formData.pickupReferences.trim(),
        pickupStorePhotoUrl: locationUrl,
      })

      setSuccessMessage('¡Tienda registrada con éxito!')
      setTimeout(() => {
        setSuccessMessage(null)
      }, 3000)

      // Recargar negocios y resetear
      await loadBusinesses()
      
      // Limpiar formulario
      setFormData({
        name: '',
        username: '',
        email: '',
        phone: '',
        description: '',
        category: 'Restaurante',
        businessType: 'food_store',
        deliveryTime: 30,
        latlong: '',
        pickupReferences: '',
      })
      setLogoFile(null)
      setLogoPreview(null)
      setCoverFile(null)
      setCoverPreview(null)
      setLocationFile(null)
      setLocationPreview(null)
      setShowCreateModal(false)
      setErrors({})
    } catch (error: any) {
      console.error('Error creating business:', error)
      setErrors(prev => ({ ...prev, submit: error.message || 'Error al guardar la tienda' }))
    } finally {
      setSubmitting(false)
    }
  }

  // Format phone to whatsapp link friendly format: 593xxxxxxxxx
  const getWhatsappLink = (phone: string) => {
    let clean = phone.replace(/[^\d]/g, '')
    if (clean.startsWith('0')) {
      clean = '593' + clean.substring(1)
    }
    return `https://wa.me/${clean}`
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* Banner / Cabecera */}
      <div className="bg-white border-b border-gray-100 py-8 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div>
            <h1 className="text-3xl sm:text-4xl font-black text-gray-900 tracking-tight leading-tight">
              Tiendas
            </h1>
            <p className="text-sm text-gray-500 mt-2 max-w-xl">
              Explora y administra todas las tiendas y restaurantes asociados a la red Fuddi. Haz clic en cualquiera de ellas para ver sus detalles.
            </p>
          </div>
          
          {/* Barra de búsqueda */}
          <div className="relative w-full md:w-80">
            <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-gray-400">
              <i className="bi bi-search"></i>
            </span>
            <input
              type="text"
              placeholder="Buscar tienda..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 text-gray-900 rounded-2xl pl-10 pr-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all placeholder:text-gray-400"
            />
          </div>
        </div>
      </div>

      {/* Filtro de Categorías */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6">
        <div className="flex gap-2 overflow-x-auto pb-3 scrollbar-hide">
          {categories.map((cat) => {
            const isActive = selectedCategory === cat
            return (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`inline-flex items-center px-4 py-2 rounded-full text-xs font-bold transition-all whitespace-nowrap ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/15 scale-105'
                    : 'bg-white text-gray-600 border border-gray-100 hover:bg-gray-50 shadow-sm'
                }`}
              >
                {cat}
              </button>
            )
          })}
        </div>
      </div>

      {/* Grid de Tiendas */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            <p className="text-sm font-medium text-gray-500">Cargando tiendas...</p>
          </div>
        ) : filteredBusinesses.length === 0 ? (
          <div className="bg-white border border-gray-100 rounded-3xl p-12 text-center shadow-sm">
            <div className="w-16 h-16 bg-gray-50 rounded-2xl flex items-center justify-center mx-auto mb-4 text-gray-400">
              <i className="bi bi-shop text-3xl"></i>
            </div>
            <h3 className="text-lg font-bold text-gray-900">No se encontraron tiendas</h3>
            <p className="text-sm text-gray-500 mt-2 max-w-sm mx-auto">
              Prueba cambiando los filtros de categoría o ajustando tu término de búsqueda.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {filteredBusinesses.map((biz) => {
              const isOpen = isStoreOpen(biz)
              return (
                <div
                  key={biz.id}
                  onClick={() => setSelectedBusiness(biz)}
                  className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md hover:scale-[1.02] transition-all duration-300 overflow-hidden cursor-pointer flex flex-col h-full group"
                >
                  {/* Portada */}
                  <div className="relative h-32 bg-gradient-to-tr from-gray-100 to-gray-200 overflow-hidden flex-shrink-0">
                    {biz.coverImage ? (
                      <img
                        src={biz.coverImage}
                        alt={`Portada de ${biz.name}`}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                    ) : (
                      <div className="absolute inset-0 bg-gradient-to-tr from-blue-500/20 to-cyan-500/10 flex items-center justify-center">
                        <i className="bi bi-image text-gray-300 text-3xl"></i>
                      </div>
                    )}
                    
                    {/* Badge Abierto/Cerrado */}
                    <span className={`absolute top-3 right-3 px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wide uppercase text-white shadow-sm ${
                      isOpen ? 'bg-emerald-500' : 'bg-rose-500'
                    }`}>
                      {isOpen ? 'Abierto' : 'Cerrado'}
                    </span>
                  </div>

                  {/* Detalle tarjeta */}
                  <div className="p-4 flex-1 flex flex-col relative pt-8">
                    {/* Logo Overlay */}
                    <div className="absolute -top-8 left-4 w-14 h-14 bg-white rounded-xl shadow-md border border-gray-50 p-1 overflow-hidden flex items-center justify-center">
                      {biz.image ? (
                        <img
                          src={biz.image}
                          alt={`Logo de ${biz.name}`}
                          className="w-full h-full object-contain rounded-lg"
                        />
                      ) : (
                        <div className="w-full h-full bg-blue-50 rounded-lg flex items-center justify-center text-blue-500">
                          <i className="bi bi-shop text-xl"></i>
                        </div>
                      )}
                    </div>

                    {/* Nombre y categoría */}
                    <div className="mb-2">
                      <h2 className="text-sm font-bold text-gray-900 line-clamp-1 group-hover:text-blue-600 transition-colors">
                        {biz.name}
                      </h2>
                      <span className="text-[10px] font-bold text-gray-400 tracking-wider uppercase">
                        {biz.category || 'General'}
                      </span>
                    </div>

                    {/* Descripción */}
                    <p className="text-xs text-gray-500 line-clamp-2 mb-4 flex-1">
                      {biz.description || 'Sin descripción disponible.'}
                    </p>

                    {/* Info Footer */}
                    <div className="border-t border-gray-50 pt-3 flex items-center justify-between text-[11px] font-semibold text-gray-500">
                      <div className="flex items-center gap-1">
                        <i className="bi bi-clock text-gray-400"></i>
                        <span>{biz.deliveryTime || 30} min</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <i className="bi bi-telephone text-gray-400"></i>
                        <span>{biz.phone || 'Sin número'}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ============================================================== */}
      {/* MODAL DETALLES DE TIENDA */}
      {/* ============================================================== */}
      {selectedBusiness && (() => {
        const displayAddress = selectedBusiness.address || selectedBusiness.pickupSettings?.references || ''
        
        let lat = 0
        let lng = 0
        if (selectedBusiness.mapLocation && (selectedBusiness.mapLocation.lat !== 0 || selectedBusiness.mapLocation.lng !== 0)) {
          lat = selectedBusiness.mapLocation.lat
          lng = selectedBusiness.mapLocation.lng
        } else if (selectedBusiness.pickupSettings?.latlong) {
          const parts = selectedBusiness.pickupSettings.latlong.split(',').map(s => parseFloat(s.trim()))
          if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
            lat = parts[0]
            lng = parts[1]
          }
        }
        
        const hasCoordinates = lat !== 0 || lng !== 0

        return (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200">
            <div 
              className="fixed inset-0" 
              onClick={() => setSelectedBusiness(null)}
            />
            
            <div className="bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl overflow-hidden shadow-2xl relative z-10 animate-in slide-in-from-bottom sm:zoom-in-95 duration-300 max-h-[92vh] sm:max-h-[85vh] flex flex-col">
              {/* Header del Modal */}
              <div className="relative h-40 bg-gray-100 flex-shrink-0">
                {selectedBusiness.coverImage ? (
                  <img
                    src={selectedBusiness.coverImage}
                    alt={`Portada de ${selectedBusiness.name}`}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-gradient-to-tr from-blue-600/30 to-cyan-500/20" />
                )}
                {/* Botón cerrar */}
                <button
                  onClick={() => setSelectedBusiness(null)}
                  className="absolute top-4 right-4 w-9 h-9 bg-black/50 hover:bg-black/70 backdrop-blur-md text-white rounded-full flex items-center justify-center transition-colors"
                >
                  <i className="bi bi-x-lg"></i>
                </button>
              </div>

              {/* Contenido (Scrollable) */}
              <div className="overflow-y-auto p-6 flex-1 space-y-5">
                {/* Info básica con logo flotante */}
                <div className="relative pt-6">
                  <div className="absolute -top-16 left-0 w-20 h-20 bg-white rounded-2xl shadow-lg border border-gray-100 p-1 flex items-center justify-center overflow-hidden">
                    {selectedBusiness.image ? (
                      <img
                        src={selectedBusiness.image}
                        alt={`Logo de ${selectedBusiness.name}`}
                        className="w-full h-full object-contain rounded-xl"
                      />
                    ) : (
                      <div className="w-full h-full bg-blue-50 rounded-xl flex items-center justify-center text-blue-500">
                        <i className="bi bi-shop text-3xl"></i>
                      </div>
                    )}
                  </div>

                  <div>
                    <h3 className="text-xl font-black text-gray-900 tracking-tight leading-tight">
                      {selectedBusiness.name}
                    </h3>
                    <div className="flex flex-wrap gap-2 mt-2">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-50 text-blue-700">
                        {selectedBusiness.category || 'General'}
                      </span>
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold ${
                        selectedBusiness.isOpen ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                      }`}>
                        {getStoreStatusDescription(selectedBusiness)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Pestañas del Modal */}
                <div className="flex border-b border-gray-100 pb-1 gap-4">
                  <button
                    type="button"
                    onClick={() => setActiveModalTab('general')}
                    className={`pb-2 text-xs font-bold transition-all relative ${
                      activeModalTab === 'general' ? 'text-blue-600' : 'text-gray-400 hover:text-gray-600'
                    }`}
                  >
                    <span>Información General</span>
                    {activeModalTab === 'general' && (
                      <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 rounded-full" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveModalTab('bank')}
                    className={`pb-2 text-xs font-bold transition-all relative ${
                      activeModalTab === 'bank' ? 'text-blue-600' : 'text-gray-400 hover:text-gray-600'
                    }`}
                  >
                    <span className="flex items-center gap-1">
                      <i className="bi bi-bank"></i>
                      Datos Bancarios
                    </span>
                    {activeModalTab === 'bank' && (
                      <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 rounded-full" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveModalTab('products')}
                    className={`pb-2 text-xs font-bold transition-all relative ${
                      activeModalTab === 'products' ? 'text-blue-600' : 'text-gray-400 hover:text-gray-600'
                    }`}
                  >
                    <span className="flex items-center gap-1">
                      <i className="bi bi-box-seam"></i>
                      Productos
                    </span>
                    {activeModalTab === 'products' && (
                      <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 rounded-full" />
                    )}
                  </button>
                </div>

                {activeModalTab === 'general' ? (
                  <>
                    {/* Descripción */}
                    <div>
                      <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5">
                        Descripción
                      </h4>
                      <p className="text-sm text-gray-600 leading-relaxed">
                        {selectedBusiness.description || 'Este negocio no cuenta con una descripción detallada por el momento.'}
                      </p>
                    </div>

                    {/* Información de Contacto */}
                    <div className="bg-gray-50 rounded-2xl p-4 space-y-3">
                      <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider border-b border-gray-200/55 pb-1">
                        Contacto y Dirección
                      </h4>
                      <div className="flex items-center gap-3 text-sm text-gray-700">
                        <div className="w-8 h-8 bg-white border rounded-lg flex items-center justify-center text-gray-400">
                          <i className="bi bi-telephone-fill text-xs"></i>
                        </div>
                        <div>
                          <p className="text-[10px] font-bold text-gray-400 leading-none">Teléfono Celular</p>
                          <a href={`tel:${selectedBusiness.phone}`} className="hover:underline font-semibold text-gray-900 mt-1 block">
                            {selectedBusiness.phone}
                          </a>
                        </div>
                        <a
                          href={getWhatsappLink(selectedBusiness.phone)}
                          target="_blank"
                          rel="noreferrer"
                          className="ml-auto w-8 h-8 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg flex items-center justify-center transition-colors shadow-sm"
                          title="Enviar WhatsApp"
                        >
                          <i className="bi bi-whatsapp"></i>
                        </a>
                      </div>
                      <div className="flex items-center gap-3 text-sm text-gray-700">
                        <div className="w-8 h-8 bg-white border rounded-lg flex items-center justify-center text-gray-400">
                          <i className="bi bi-envelope-fill text-xs"></i>
                        </div>
                        <div>
                          <p className="text-[10px] font-bold text-gray-400 leading-none">Email</p>
                          <a href={`mailto:${selectedBusiness.email}`} className="hover:underline font-semibold text-gray-900 mt-1 block">
                            {selectedBusiness.email}
                          </a>
                        </div>
                      </div>
                      {displayAddress && (
                        <div className="flex items-center gap-3 text-sm text-gray-700">
                          <div className="w-8 h-8 bg-white border rounded-lg flex items-center justify-center text-gray-400">
                            <i className="bi bi-geo-alt-fill text-xs"></i>
                          </div>
                          <div>
                            <p className="text-[10px] font-bold text-gray-400 leading-none">Dirección</p>
                            <p className="font-semibold text-gray-900 mt-1 leading-normal">
                              {displayAddress}
                            </p>
                          </div>
                        </div>
                      )}
                      {hasCoordinates && (
                        <div className="flex items-center gap-3 text-sm text-gray-700">
                          <div className="w-8 h-8 bg-white border rounded-lg flex items-center justify-center text-gray-400">
                            <i className="bi bi-compass-fill text-xs"></i>
                          </div>
                          <div>
                            <p className="text-[10px] font-bold text-gray-400 leading-none">Ubicación GPS</p>
                            <a 
                              href={`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`}
                              target="_blank" 
                              rel="noreferrer" 
                              className="hover:underline font-semibold text-blue-600 mt-1 block"
                            >
                              {lat.toFixed(5)}, {lng.toFixed(5)}
                            </a>
                          </div>
                        </div>
                      )}
                      {selectedBusiness.pickupSettings?.storePhotoUrl && (
                        <div className="flex flex-col gap-2 pt-2 border-t border-gray-200/50">
                          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Foto del Establecimiento (Pickup)</p>
                          <div className="rounded-xl overflow-hidden border border-gray-200/50 max-h-40 bg-white flex items-center justify-center">
                            <img 
                              src={selectedBusiness.pickupSettings.storePhotoUrl} 
                              alt="Fachada del local" 
                              className="w-full h-full object-cover"
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Horarios */}
                    {selectedBusiness.schedule && (
                      <div>
                        <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
                          Horarios de Atención
                        </h4>
                        <div className="border border-gray-100 rounded-2xl overflow-hidden divide-y divide-gray-50 text-xs">
                          {DAY_ORDER.map((day) => {
                            const daySched = selectedBusiness.schedule[day]
                            const dayName = DAYS_ES[day]
                            const today = new Date().toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase()
                            const isToday = today === day

                            return (
                              <div 
                                key={day} 
                                className={`flex items-center justify-between p-3 ${
                                  isToday ? 'bg-blue-50/50 font-bold' : ''
                                }`}
                              >
                                <span className={isToday ? 'text-blue-700' : 'text-gray-700'}>
                                  {dayName} {isToday && '(Hoy)'}
                                </span>
                                <span>
                                  {daySched && daySched.isOpen ? (
                                    <span className="text-gray-900">{daySched.open} - {daySched.close}</span>
                                  ) : (
                                    <span className="text-gray-400">Cerrado</span>
                                  )}
                                </span>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </>
                ) : activeModalTab === 'bank' ? (
                  <div className="space-y-4 animate-in fade-in duration-200">
                    <div className="flex items-center justify-between border-b border-gray-100 pb-2">
                      <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                        Cuentas Bancarias Registradas
                      </h4>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingBankAccount(null)
                          setBankForm({
                            bankName: '',
                            accountType: 'Ahorros',
                            accountNumber: '',
                            accountHolder: '',
                            isDefault: false
                          })
                          setShowBankFormModal(true)
                        }}
                        className="bg-blue-50 hover:bg-blue-100 text-blue-600 text-xs font-bold py-1.5 px-3 rounded-xl transition-all active:scale-95 flex items-center gap-1"
                      >
                        <i className="bi bi-plus-lg"></i>
                        <span>Agregar Nueva</span>
                      </button>
                    </div>

                    {!selectedBusiness.bankAccounts || selectedBusiness.bankAccounts.length === 0 ? (
                      <div className="border border-dashed border-gray-200 rounded-2xl p-8 text-center bg-gray-50/50">
                        <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center mx-auto mb-2.5 text-gray-400 shadow-sm border border-gray-100">
                          <i className="bi bi-bank text-lg"></i>
                        </div>
                        <p className="text-xs font-bold text-gray-800">No hay cuentas registradas</p>
                        <p className="text-[10px] text-gray-400 mt-1 max-w-[200px] mx-auto leading-normal">
                          Registra una cuenta para recibir transferencias en el checkout.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {selectedBusiness.bankAccounts.map((acc) => (
                          <div 
                            key={acc.id}
                            className={`bg-white border rounded-2xl p-4 shadow-sm relative flex flex-col justify-between transition-all ${
                              acc.isDefault ? 'border-blue-300 ring-2 ring-blue-500/10' : 'border-gray-100 hover:border-gray-200'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-4">
                              <div>
                                <div className="flex items-center gap-2">
                                  <h5 className="text-xs font-black text-gray-900 leading-tight">
                                    {acc.bankName}
                                  </h5>
                                  {acc.isDefault && (
                                    <span className="bg-emerald-50 text-emerald-700 text-[9px] font-extrabold px-2 py-0.5 rounded-full uppercase tracking-wider">
                                      Predeterminada
                                    </span>
                                  )}
                                </div>
                                <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mt-1">
                                  Cuenta {acc.accountType}
                                </p>
                                <div className="mt-2 space-y-0.5">
                                  <p className="text-[11px] text-gray-700 font-semibold flex items-center gap-1.5">
                                    <span className="text-[10px] text-gray-400 font-bold uppercase w-12">Nro:</span>
                                    <span className="font-mono text-gray-900">{acc.accountNumber}</span>
                                  </p>
                                  <p className="text-[11px] text-gray-700 font-semibold flex items-center gap-1.5">
                                    <span className="text-[10px] text-gray-400 font-bold uppercase w-12">Titular:</span>
                                    <span className="text-gray-900">{acc.accountHolder}</span>
                                  </p>
                                </div>
                              </div>
                            </div>

                            {/* Acciones */}
                            <div className="border-t border-gray-50 pt-2.5 mt-3 flex items-center justify-between text-[11px] font-bold">
                              {!acc.isDefault ? (
                                <button
                                  type="button"
                                  disabled={savingBank}
                                  onClick={() => handleSetDefaultBankAccount(acc.id)}
                                  className="text-blue-600 hover:underline flex items-center gap-1 disabled:opacity-50"
                                >
                                  <i className="bi bi-check2-circle text-xs"></i>
                                  <span>Usar por defecto</span>
                                </button>
                              ) : (
                                <div className="flex items-center gap-1 text-emerald-600">
                                  <i className="bi bi-check-lg text-xs"></i>
                                  <span>Cuenta Principal</span>
                                </div>
                              )}

                              <div className="flex items-center gap-3">
                                <button
                                  type="button"
                                  disabled={savingBank}
                                  onClick={() => {
                                    setEditingBankAccount(acc)
                                    setBankForm({
                                      bankName: acc.bankName,
                                      accountType: acc.accountType,
                                      accountNumber: acc.accountNumber,
                                      accountHolder: acc.accountHolder,
                                      isDefault: !!acc.isDefault
                                    })
                                    setShowBankFormModal(true)
                                  }}
                                  className="text-gray-500 hover:text-blue-600 flex items-center gap-1 disabled:opacity-50"
                                  title="Editar"
                                >
                                  <i className="bi bi-pencil-fill text-[10px]"></i>
                                  <span>Editar</span>
                                </button>
                                <button
                                  type="button"
                                  disabled={savingBank}
                                  onClick={() => handleDeleteBankAccount(acc.id)}
                                  className="text-rose-500 hover:text-rose-700 flex items-center gap-1 disabled:opacity-50"
                                  title="Eliminar"
                                >
                                  <i className="bi bi-trash3-fill text-[10px]"></i>
                                  <span>Eliminar</span>
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4 animate-in fade-in duration-200">
                    <div className="flex items-center justify-between border-b border-gray-100 pb-2">
                      <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                        Productos de la Tienda
                      </h4>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setJsonText('')
                            setJsonError(null)
                            setParsedProducts([])
                            setShowJsonImportModal(true)
                          }}
                          className="bg-gray-50 hover:bg-gray-100 text-gray-700 text-xs font-bold py-1.5 px-3 rounded-xl transition-all active:scale-95 flex items-center gap-1"
                        >
                          <i className="bi bi-filetype-json text-blue-600"></i>
                          <span>Importar JSON</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingProduct(null)
                            setProductForm({
                              name: '',
                              description: '',
                              price: '',
                              category: 'General',
                              isAvailable: true
                            })
                            setShowProductFormModal(true)
                          }}
                          className="bg-blue-50 hover:bg-blue-100 text-blue-600 text-xs font-bold py-1.5 px-3 rounded-xl transition-all active:scale-95 flex items-center gap-1"
                        >
                          <i className="bi bi-plus-lg"></i>
                          <span>Agregar</span>
                        </button>
                      </div>
                    </div>

                    {loadingProducts ? (
                      <div className="py-12 flex flex-col items-center justify-center gap-2">
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
                        <span className="text-xs text-gray-400 font-bold">Cargando productos...</span>
                      </div>
                    ) : businessProducts.length === 0 ? (
                      <div className="border border-dashed border-gray-200 rounded-2xl p-8 text-center bg-gray-50/50">
                        <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center mx-auto mb-2.5 text-gray-400 shadow-sm border border-gray-100">
                          <i className="bi bi-box-seam text-lg"></i>
                        </div>
                        <p className="text-xs font-bold text-gray-800">No hay productos registrados</p>
                        <p className="text-[10px] text-gray-400 mt-1 max-w-[200px] mx-auto leading-normal">
                          Crea productos individuales o importa un menú en formato JSON de forma masiva.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2.5 max-h-[45vh] overflow-y-auto pr-1">
                        {businessProducts.map((prod) => (
                          <div 
                            key={prod.id}
                            className="bg-white border border-gray-100 hover:border-gray-200 rounded-xl p-3 shadow-sm flex items-center justify-between gap-4 transition-all"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <h5 className="text-xs font-black text-gray-900 truncate leading-tight">
                                  {prod.name}
                                </h5>
                                <span className="bg-gray-100 text-gray-600 text-[9px] font-bold px-2 py-0.5 rounded-full">
                                  {prod.category}
                                </span>
                              </div>
                              {prod.description && (
                                <p className="text-[10px] text-gray-400 truncate mt-0.5">
                                  {prod.description}
                                </p>
                              )}
                              <p className="text-xs font-bold text-gray-800 mt-1">
                                ${prod.price.toFixed(2)}
                                {prod.commissionType && prod.commissionType !== 'no_commission' && (
                                  <span className="text-[9px] text-blue-600 font-normal ml-1.5">
                                    (con comisión)
                                  </span>
                                )}
                              </p>
                            </div>

                            <div className="flex items-center gap-2 flex-shrink-0">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingProduct(prod)
                                  setProductForm({
                                    name: prod.name,
                                    description: prod.description || '',
                                    price: (prod.basePrice || prod.price).toString(),
                                    category: prod.category || 'Sin categoría',
                                    isAvailable: prod.isAvailable
                                  })
                                  setShowProductFormModal(true)
                                }}
                                className="w-8 h-8 rounded-lg bg-gray-50 text-gray-500 hover:text-blue-600 hover:bg-blue-50 flex items-center justify-center transition-colors"
                                title="Editar"
                              >
                                <i className="bi bi-pencil-fill text-xs"></i>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteProduct(prod.id)}
                                className="w-8 h-8 rounded-lg bg-gray-50 text-rose-500 hover:bg-rose-50 flex items-center justify-center transition-colors"
                                title="Eliminar"
                              >
                                <i className="bi bi-trash3-fill text-xs"></i>
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Footer de Acciones del Modal */}
              <div className="bg-gray-50 border-t border-gray-100 p-4 flex gap-3 flex-shrink-0">
                <Link
                  href={`/${selectedBusiness.username}`}
                  target="_blank"
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3.5 px-4 rounded-2xl text-center text-sm shadow-md shadow-blue-600/10 active:scale-95 transition-all"
                >
                  Ver Catálogo
                </Link>
                <Link
                  href={`/admin/stores/${selectedBusiness.id}`}
                  className="bg-white border border-gray-200 text-gray-700 font-bold py-3.5 px-5 rounded-2xl text-sm hover:bg-gray-50 transition-colors"
                >
                  Panel Admin
                </Link>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ============================================================== */}
      {/* BOTÓN FLOTANTE (FAB) */}
      {/* ============================================================== */}
      <button
        onClick={() => setShowCreateModal(true)}
        className="fixed bottom-6 right-6 z-40 bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-700 hover:to-cyan-600 text-white rounded-full w-14 h-14 flex items-center justify-center shadow-xl shadow-blue-500/20 hover:scale-110 active:scale-95 transition-all cursor-pointer"
        title="Crear Nueva Tienda"
      >
        <i className="bi bi-plus-lg text-2xl"></i>
      </button>

      {/* ============================================================== */}
      {/* MODAL REGISTRO DE NUEVA TIENDA */}
      {/* ============================================================== */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200">
          <div 
            className="fixed inset-0" 
            onClick={() => {
              if (!submitting) setShowCreateModal(false)
            }}
          />
          
          <div className="bg-white w-full sm:max-w-xl rounded-t-3xl sm:rounded-3xl overflow-hidden shadow-2xl relative z-10 animate-in slide-in-from-bottom sm:zoom-in-95 duration-300 max-h-[92vh] sm:max-h-[85vh] flex flex-col">
            {/* Encabezado */}
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
              <h3 className="text-lg font-bold text-gray-900">Registrar Nueva Tienda</h3>
              <button
                disabled={submitting}
                onClick={() => setShowCreateModal(false)}
                className="w-8 h-8 text-gray-400 hover:text-gray-600 rounded-lg flex items-center justify-center hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                <i className="bi bi-x-lg"></i>
              </button>
            </div>

            {/* Formulario (Scrollable) */}
            <form onSubmit={handleSubmit} className="overflow-y-auto flex-1 flex flex-col">
              <div className="p-6 space-y-5 flex-1">
                {errors.submit && (
                  <div className="bg-red-50 text-red-700 text-xs font-semibold p-3.5 rounded-xl border border-red-100">
                    {errors.submit}
                  </div>
                )}

                {/* Grid Logo y Portada */}
                <div className="grid grid-cols-2 gap-4">
                  {/* Carga Logo */}
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                      Logotipo (1:1)
                    </label>
                    <div
                      onClick={() => !submitting && fileInputLogoRef.current?.click()}
                      className="border border-dashed border-gray-300 rounded-2xl h-28 flex flex-col items-center justify-center cursor-pointer hover:bg-gray-50 transition-colors relative overflow-hidden group"
                    >
                      {logoPreview ? (
                        <>
                          <img
                            src={logoPreview}
                            alt="Preview Logo"
                            className="w-full h-full object-contain p-2"
                          />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white text-xs font-bold transition-opacity">
                            Cambiar
                          </div>
                        </>
                      ) : (
                        <div className="text-center p-3">
                          <i className="bi bi-camera text-gray-400 text-xl"></i>
                          <p className="text-[10px] text-gray-400 font-bold mt-1">Subir Logo</p>
                        </div>
                      )}
                    </div>
                    <input
                      ref={fileInputLogoRef}
                      type="file"
                      accept="image/*"
                      onChange={handleLogoSelect}
                      disabled={submitting}
                      className="hidden"
                    />
                    {errors.logo && (
                      <p className="text-[10px] text-red-500 font-bold mt-1">{errors.logo}</p>
                    )}
                  </div>

                  {/* Carga Portada */}
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                      Portada (2:1)
                    </label>
                    <div
                      onClick={() => !submitting && fileInputCoverRef.current?.click()}
                      className="border border-dashed border-gray-300 rounded-2xl h-28 flex flex-col items-center justify-center cursor-pointer hover:bg-gray-50 transition-colors relative overflow-hidden group"
                    >
                      {coverPreview ? (
                        <>
                          <img
                            src={coverPreview}
                            alt="Preview Portada"
                            className="w-full h-full object-cover"
                          />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white text-xs font-bold transition-opacity">
                            Cambiar
                          </div>
                        </>
                      ) : (
                        <div className="text-center p-3">
                          <i className="bi bi-image text-gray-400 text-xl"></i>
                          <p className="text-[10px] text-gray-400 font-bold mt-1">Subir Portada</p>
                        </div>
                      )}
                    </div>
                    <input
                      ref={fileInputCoverRef}
                      type="file"
                      accept="image/*"
                      onChange={handleCoverSelect}
                      disabled={submitting}
                      className="hidden"
                    />
                    {errors.cover && (
                      <p className="text-[10px] text-red-500 font-bold mt-1">{errors.cover}</p>
                    )}
                  </div>
                </div>

                {/* Nombre de la tienda */}
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                    Nombre del Negocio *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    disabled={submitting}
                    placeholder="Ej: Burger Munchy's"
                    className="w-full bg-gray-50 border border-gray-200 text-gray-900 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                  />
                  {errors.name && (
                    <p className="text-[10px] text-red-500 font-bold mt-1">{errors.name}</p>
                  )}
                </div>

                {/* Username / Slug de URL */}
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                    Slug de URL (username) *
                  </label>
                  <div className="flex items-center">
                    <span className="bg-gray-100 border border-r-0 border-gray-200 text-gray-500 text-xs px-3 py-3 rounded-l-xl select-none font-bold">
                      fuddi.shop/
                    </span>
                    <input
                      type="text"
                      required
                      value={formData.username}
                      onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                      disabled={submitting}
                      placeholder="burger-munchys"
                      className="w-full bg-gray-50 border border-gray-200 text-gray-900 rounded-r-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-mono"
                    />
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1 leading-normal">
                    Solo letras minúsculas, números y guiones. Será el link de tu tienda pública.
                  </p>
                  {errors.username && (
                    <p className="text-[10px] text-red-500 font-bold mt-1">{errors.username}</p>
                  )}
                </div>

                {/* Contacto: Email y Teléfono */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                      Email de contacto *
                    </label>
                    <input
                      type="email"
                      required
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      disabled={submitting}
                      placeholder="info@munchys.com"
                      className="w-full bg-gray-50 border border-gray-200 text-gray-900 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                    />
                    {errors.email && (
                      <p className="text-[10px] text-red-500 font-bold mt-1">{errors.email}</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                      Teléfono celular *
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      disabled={submitting}
                      placeholder="09XXXXXXXX"
                      className="w-full bg-gray-50 border border-gray-200 text-gray-900 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                    />
                    {errors.phone && (
                      <p className="text-[10px] text-red-500 font-bold mt-1">{errors.phone}</p>
                    )}
                  </div>
                </div>

                {/* Descripción */}
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                    Descripción
                  </label>
                  <textarea
                    rows={2}
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    disabled={submitting}
                    placeholder="Describe los productos, especialidades o servicios de tu negocio..."
                    className="w-full bg-gray-50 border border-gray-200 text-gray-900 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all resize-none"
                  />
                </div>

                {/* Categoría y Tipo de negocio */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                      Categoría
                    </label>
                    <select
                      value={formData.category}
                      onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                      disabled={submitting}
                      className="w-full bg-gray-50 border border-gray-200 text-gray-900 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-semibold"
                    >
                      {categories.filter(c => c !== 'Todos').map(c => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                      Tipo de Negocio
                    </label>
                    <select
                      value={formData.businessType}
                      onChange={(e) => setFormData({ ...formData, businessType: e.target.value as any })}
                      disabled={submitting}
                      className="w-full bg-gray-50 border border-gray-200 text-gray-900 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-semibold"
                    >
                      <option value="food_store">Venta de alimentos (Directo)</option>
                      <option value="distributor">Distribuidor mayorista</option>
                    </select>
                  </div>
                </div>

                {/* GPS Geolocalización */}
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                    Coordenadas GPS (lat, lng)
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={formData.latlong}
                      onChange={(e) => setFormData({ ...formData, latlong: e.target.value })}
                      disabled={submitting}
                      placeholder="Ej: -0.180653, -78.467834"
                      className="w-full bg-gray-50 border border-gray-200 text-gray-900 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-medium"
                    />
                    <button
                      type="button"
                      onClick={handleGetLocation}
                      disabled={submitting}
                      className="bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold px-4 py-3 rounded-xl text-sm transition-colors flex items-center justify-center gap-1.5 flex-shrink-0 disabled:opacity-50"
                    >
                      <i className="bi bi-geo-alt-fill text-blue-600"></i>
                      <span>GPS</span>
                    </button>
                  </div>
                </div>

                {/* Referencias de Ubicación (Pickup) */}
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                    Referencias de Dirección (Pickup)
                  </label>
                  <input
                    type="text"
                    value={formData.pickupReferences}
                    onChange={(e) => setFormData({ ...formData, pickupReferences: e.target.value })}
                    disabled={submitting}
                    placeholder="Ej: Frente al parque central, casa esquinera color azul..."
                    className="w-full bg-gray-50 border border-gray-200 text-gray-900 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-medium"
                  />
                </div>

                {/* Foto de la Ubicación / Fachada (Pickup) */}
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                    Foto de Fachada / Establecimiento (Pickup)
                  </label>
                  <div
                    onClick={() => !submitting && fileInputLocationRef.current?.click()}
                    className="border border-dashed border-gray-300 rounded-2xl h-32 flex flex-col items-center justify-center cursor-pointer hover:bg-gray-50 transition-colors relative overflow-hidden group"
                  >
                    {locationPreview ? (
                      <>
                        <img
                          src={locationPreview}
                          alt="Vista del local"
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white text-xs font-bold transition-opacity">
                          Cambiar Foto
                        </div>
                      </>
                    ) : (
                      <div className="text-center p-4">
                        <i className="bi bi-shop text-gray-400 text-2xl"></i>
                        <p className="text-xs text-gray-400 font-bold mt-1.5">Subir Foto de Fachada</p>
                        <p className="text-[10px] text-gray-400 mt-0.5">Ayuda a tus clientes a reconocer físicamente tu local</p>
                      </div>
                    )}
                  </div>
                  <input
                    ref={fileInputLocationRef}
                    type="file"
                    accept="image/*"
                    onChange={handleLocationSelect}
                    disabled={submitting}
                    className="hidden"
                  />
                  {errors.locationPhoto && (
                    <p className="text-[10px] text-red-500 font-bold mt-1">{errors.locationPhoto}</p>
                  )}
                </div>
              </div>

              {/* Botones de acción */}
              <div className="bg-gray-50 border-t border-gray-100 p-4 flex gap-3 flex-shrink-0">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 bg-white border border-gray-200 text-gray-700 font-bold py-3.5 px-4 rounded-2xl text-sm hover:bg-gray-50 transition-colors disabled:opacity-50 active:scale-95"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3.5 px-4 rounded-2xl text-sm shadow-md shadow-blue-600/10 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {submitting ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                      <span>Registrando...</span>
                    </>
                  ) : (
                    <span>Guardar Tienda</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL AGREGAR/EDITAR CUENTA BANCARIA */}
      {/* ============================================================== */}
      {showBankFormModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200">
          <div 
            className="fixed inset-0" 
            onClick={() => !savingBank && setShowBankFormModal(false)}
          />
          
          <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl overflow-hidden shadow-2xl relative z-10 animate-in slide-in-from-bottom sm:zoom-in-95 duration-300 flex flex-col max-h-[85vh]">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
              <h3 className="text-sm font-bold text-gray-900">
                {editingBankAccount ? 'Editar Cuenta Bancaria' : 'Agregar Cuenta Bancaria'}
              </h3>
              <button
                type="button"
                disabled={savingBank}
                onClick={() => setShowBankFormModal(false)}
                className="w-8 h-8 text-gray-400 hover:text-gray-600 rounded-lg flex items-center justify-center hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                <i className="bi bi-x-lg"></i>
              </button>
            </div>

            <form onSubmit={handleSaveBankAccount} className="p-6 space-y-4 overflow-y-auto">
              <div>
                <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">
                  Nombre del Banco *
                </label>
                <input
                  type="text"
                  required
                  list="bank-names"
                  value={bankForm.bankName}
                  onChange={(e) => setBankForm({ ...bankForm, bankName: e.target.value })}
                  disabled={savingBank}
                  placeholder="Ej: Banco Pichincha, Banco Guayaquil..."
                  className="w-full bg-gray-50 border border-gray-200 text-gray-900 rounded-xl px-3 py-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-semibold"
                />
                <datalist id="bank-names">
                  {getSuggestedBanks().map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">
                  Tipo de Cuenta *
                </label>
                <select
                  value={bankForm.accountType}
                  onChange={(e) => setBankForm({ ...bankForm, accountType: e.target.value })}
                  disabled={savingBank}
                  className="w-full bg-gray-50 border border-gray-200 text-gray-900 rounded-xl px-3 py-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-semibold"
                >
                  <option value="Ahorros">Ahorros</option>
                  <option value="Corriente">Corriente</option>
                  <option value="Cuenta Virtual/Pago">Cuenta Virtual / Pago</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">
                  Número de Cuenta *
                </label>
                <input
                  type="text"
                  required
                  value={bankForm.accountNumber}
                  onChange={(e) => setBankForm({ ...bankForm, accountNumber: e.target.value })}
                  disabled={savingBank}
                  placeholder="Ej: 2200384729"
                  className="w-full bg-gray-50 border border-gray-200 text-gray-900 rounded-xl px-3 py-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-medium"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">
                  Titular de la Cuenta / C.I. o RUC *
                </label>
                <input
                  type="text"
                  required
                  value={bankForm.accountHolder}
                  onChange={(e) => setBankForm({ ...bankForm, accountHolder: e.target.value })}
                  disabled={savingBank}
                  placeholder="Ej: Juan Pérez - 1712345678"
                  className="w-full bg-gray-50 border border-gray-200 text-gray-900 rounded-xl px-3 py-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-medium"
                />
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input
                  id="isDefault"
                  type="checkbox"
                  checked={bankForm.isDefault}
                  onChange={(e) => setBankForm({ ...bankForm, isDefault: e.target.checked })}
                  disabled={savingBank || (!!editingBankAccount && editingBankAccount.isDefault)}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded cursor-pointer"
                />
                <label htmlFor="isDefault" className="text-xs font-bold text-gray-600 select-none cursor-pointer">
                  Establecer como cuenta predeterminada
                </label>
              </div>

              <div className="bg-gray-50 border-t border-gray-100 -mx-6 -mb-6 p-4 flex gap-3 mt-6">
                <button
                  type="button"
                  disabled={savingBank}
                  onClick={() => setShowBankFormModal(false)}
                  className="flex-1 bg-white border border-gray-200 text-gray-700 font-bold py-2.5 rounded-xl text-xs hover:bg-gray-50 transition-colors disabled:opacity-50 active:scale-95"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingBank}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 rounded-xl text-xs shadow-md shadow-blue-600/10 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {savingBank ? (
                    <>
                      <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white" />
                      <span>Guardando...</span>
                    </>
                  ) : (
                    <span>Guardar Cuenta</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL AGREGAR/EDITAR PRODUCTO */}
      {/* ============================================================== */}
      {showProductFormModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200">
          <div 
            className="fixed inset-0" 
            onClick={() => !loadingProducts && setShowProductFormModal(false)}
          />
          
          <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl overflow-hidden shadow-2xl relative z-10 animate-in slide-in-from-bottom sm:zoom-in-95 duration-300 flex flex-col max-h-[85vh]">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
              <h3 className="text-sm font-bold text-gray-900">
                {editingProduct ? 'Editar Producto' : 'Agregar Producto'}
              </h3>
              <button
                type="button"
                disabled={loadingProducts}
                onClick={() => setShowProductFormModal(false)}
                className="w-8 h-8 text-gray-400 hover:text-gray-600 rounded-lg flex items-center justify-center hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                <i className="bi bi-x-lg"></i>
              </button>
            </div>

            <form onSubmit={handleSaveProduct} className="p-6 space-y-4 overflow-y-auto">
              <div>
                <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">
                  Nombre del Producto *
                </label>
                <input
                  type="text"
                  required
                  value={productForm.name}
                  onChange={(e) => setProductForm({ ...productForm, name: e.target.value })}
                  disabled={loadingProducts}
                  placeholder="Ej: Hamburguesa con Queso"
                  className="w-full bg-gray-50 border border-gray-200 text-gray-900 rounded-xl px-3 py-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-semibold"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">
                  Descripción
                </label>
                <textarea
                  rows={2}
                  value={productForm.description}
                  onChange={(e) => setProductForm({ ...productForm, description: e.target.value })}
                  disabled={loadingProducts}
                  placeholder="Ej: Hamburguesa de res 150g, queso cheddar, lechuga y tomate..."
                  className="w-full bg-gray-50 border border-gray-200 text-gray-900 rounded-xl px-3 py-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-medium resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">
                    Precio Base ($) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={productForm.price}
                    onChange={(e) => setProductForm({ ...productForm, price: e.target.value })}
                    disabled={loadingProducts}
                    placeholder="Ej: 5.50"
                    className="w-full bg-gray-50 border border-gray-200 text-gray-900 rounded-xl px-3 py-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-semibold"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">
                    Categoría *
                  </label>
                  <input
                    type="text"
                    required
                    list="product-categories"
                    value={productForm.category}
                    onChange={(e) => setProductForm({ ...productForm, category: e.target.value })}
                    disabled={loadingProducts}
                    placeholder="Ej: Hamburguesas"
                    className="w-full bg-gray-50 border border-gray-200 text-gray-900 rounded-xl px-3 py-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-semibold"
                  />
                  <datalist id="product-categories">
                    {(selectedBusiness?.categories || ['Platos Fuertes', 'Bebidas', 'Postres']).map(c => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input
                  id="isProductAvailable"
                  type="checkbox"
                  checked={productForm.isAvailable}
                  onChange={(e) => setProductForm({ ...productForm, isAvailable: e.target.checked })}
                  disabled={loadingProducts}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded cursor-pointer"
                />
                <label htmlFor="isProductAvailable" className="text-xs font-bold text-gray-600 select-none cursor-pointer">
                  Disponible para venta inmediata
                </label>
              </div>

              <div className="bg-gray-50 border-t border-gray-100 -mx-6 -mb-6 p-4 flex gap-3 mt-6">
                <button
                  type="button"
                  disabled={loadingProducts}
                  onClick={() => setShowProductFormModal(false)}
                  className="flex-1 bg-white border border-gray-200 text-gray-700 font-bold py-2.5 rounded-xl text-xs hover:bg-gray-50 transition-colors disabled:opacity-50 active:scale-95"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={loadingProducts}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 rounded-xl text-xs shadow-md shadow-blue-600/10 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {loadingProducts ? (
                    <>
                      <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white" />
                      <span>Guardando...</span>
                    </>
                  ) : (
                    <span>Guardar Producto</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL IMPORTAR MENÚ DESDE JSON */}
      {/* ============================================================== */}
      {showJsonImportModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200">
          <div 
            className="fixed inset-0" 
            onClick={() => !isImporting && setShowJsonImportModal(false)}
          />
          
          <div className="bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl overflow-hidden shadow-2xl relative z-10 animate-in slide-in-from-bottom sm:zoom-in-95 duration-300 flex flex-col max-h-[85vh]">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
              <h3 className="text-sm font-bold text-gray-900">
                Importar Menú desde JSON
              </h3>
              <button
                type="button"
                disabled={isImporting}
                onClick={() => setShowJsonImportModal(false)}
                className="w-8 h-8 text-gray-400 hover:text-gray-600 rounded-lg flex items-center justify-center hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                <i className="bi bi-x-lg"></i>
              </button>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto flex-1">
              <div>
                <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1.5">
                  Pega el contenido JSON del menú *
                </label>
                <textarea
                  rows={8}
                  required
                  value={jsonText}
                  onChange={(e) => {
                    setJsonText(e.target.value)
                    setJsonError(null)
                    setParsedProducts([])
                  }}
                  disabled={isImporting}
                  placeholder={`Ejemplo de formato:
[
  {
    "name": "Hamburguesa clásica",
    "price": 4.50,
    "category": "Hamburguesas",
    "description": "Carne de res, queso cheddar y aderezos"
  }
]`}
                  className="w-full bg-gray-50 border border-gray-200 text-gray-900 rounded-xl p-3 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-mono resize-none transition-all"
                />
              </div>

              {jsonError && (
                <div className="bg-red-50 border border-red-100 rounded-xl p-3 text-red-700 text-xs font-semibold whitespace-pre-wrap">
                  <i className="bi bi-exclamation-triangle-fill mr-1"></i>
                  {jsonError}
                </div>
              )}

              {parsedProducts.length > 0 && (
                <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3 text-emerald-800 text-xs font-semibold">
                  <i className="bi bi-check-circle-fill mr-1"></i>
                  JSON analizado con éxito. Se detectaron <strong>{parsedProducts.length}</strong> productos listos para importación.
                </div>
              )}

              <div className="bg-gray-50 border-t border-gray-100 -mx-6 -mb-6 p-4 flex gap-3 mt-6">
                <button
                  type="button"
                  disabled={isImporting}
                  onClick={() => setShowJsonImportModal(false)}
                  className="flex-1 bg-white border border-gray-200 text-gray-700 font-bold py-2.5 rounded-xl text-xs hover:bg-gray-50 transition-colors disabled:opacity-50 active:scale-95"
                >
                  Cancelar
                </button>
                {parsedProducts.length > 0 ? (
                  <button
                    type="button"
                    disabled={isImporting}
                    onClick={handleImportProducts}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 rounded-xl text-xs shadow-md shadow-blue-600/10 active:scale-95 transition-all flex items-center justify-center gap-2"
                  >
                    {isImporting ? (
                      <>
                        <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-white" />
                        <span>Importando...</span>
                      </>
                    ) : (
                      <span>Importar ({parsedProducts.length})</span>
                    )}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={isImporting || !jsonText.trim()}
                    onClick={handleParseJson}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 rounded-xl text-xs shadow-md shadow-blue-600/10 active:scale-95 transition-all"
                  >
                    Analizar JSON
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Notificación de éxito flotante */}
      {successMessage && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 bg-emerald-500 text-white font-bold px-5 py-3 rounded-2xl shadow-xl flex items-center gap-2 animate-in fade-in slide-in-from-bottom duration-300">
          <i className="bi bi-check-circle-fill"></i>
          <span>{successMessage}</span>
        </div>
      )}
    </div>
  )
}
