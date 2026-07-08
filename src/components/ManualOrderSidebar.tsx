'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Business, Product, ProductVariant, ProductOptionGroup } from '@/types'
import { GoogleMap } from './GoogleMap'
import { searchClientByPhone, createClient, getDeliveriesByStatus, createOrder, getClientLocations, createClientLocation, updateLocation, deleteLocation, updateOrder, updateClient, registerOrderConsumption, getCoverageZones, isPointInPolygon, getDeliveryForLocation, getDeliveryDetailsForLocation, getCoverageZoneForLocation, getOrdersByClient } from '@/lib/database'
import { searchClients } from '@/lib/client-search'
import { calculateCommissionPricing, getBusinessCommissionSettings, getProductPublicPrice, getPriceMetadata } from '@/lib/price-utils'
import { GOOGLE_MAPS_API_KEY } from './GoogleMap'
import { storage } from '@/lib/firebase'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { optimizeImage } from '@/lib/image-utils'


interface Client {
  id: string
  celular: string
  nombres: string
  fecha_de_registro?: string
  notas?: string
  [key: string]: any
}

interface ClientLocation {
  id: string
  id_cliente: string
  latlong: string
  referencia: string
  sector: string
  tarifa: string
  photo?: string
  isFavorite?: boolean
}

interface OrderItem {
  name: string
  price: number
  productId: string
  quantity: number
  variant?: string
  variantName?: string
  productName?: string
  // Metadatos de precios para liquidaciones
  basePrice?: number
  commission?: number
  commissionType?: string
  storeReceives?: number
}

interface ManualOrderData {
  customerId: string
  customerPhone: string
  customerName: string
  customerNotes?: string
  selectedProducts: OrderItem[]
  deliveryType: '' | 'delivery' | 'pickup'
  selectedLocation: ClientLocation | null
  customerLocations: ClientLocation[]
  timingType: 'immediate' | 'scheduled'
  scheduledDate: string
  scheduledTime: string
  paymentMethod: 'cash' | 'transfer' | 'mixed'
  selectedBank: string
  paymentStatus: 'pending' | 'validating' | 'paid'
  cashAmount: number
  transferAmount: number
  total: number
  selectedDelivery: any
  orderStatus: 'pending' | 'confirmed' | 'preparing' | 'ready' | 'on_way' | 'delivered' | 'cancelled' | 'borrador'
  notas: string
  notaImageUrl?: string
  receiptImageUrl?: string
  customDeliveryCost?: number | null
}

interface ManualOrderSidebarProps {
  isOpen: boolean
  onClose: () => void
  business: Business | null
  products: Product[]
  onOrderCreated: () => void
  businesses?: Business[]
  onBusinessChange?: (businessId: string) => void | Promise<void>
  loadingBusinessProducts?: boolean
  // Edit mode support
  mode?: 'create' | 'edit'
  editOrder?: any
  onOrderUpdated?: (updatedOrder?: any) => void
  // Navegación - para que funcione como el DashboardSidebar
  setActiveTab?: (tab: 'orders' | 'profile' | 'admins' | 'reports' | 'inventory' | 'qrcodes' | 'stats' | 'wallet' | 'checklist' | 'expenses') => void
  setProfileSubTab?: (tab: 'general' | 'products' | 'fidelizacion' | 'notifications' | 'admins') => void
}

export default function ManualOrderSidebar({
  isOpen,
  onClose,
  business,
  products,
  onOrderCreated,
  businesses,
  onBusinessChange,
  loadingBusinessProducts = false,
  mode = 'create',
  editOrder,
  onOrderUpdated,
  setActiveTab,
  setProfileSubTab
}: ManualOrderSidebarProps) {
  const [manualOrderData, setManualOrderData] = useState<ManualOrderData>({
    customerId: '',
    customerPhone: '',
    customerName: '',
    customerNotes: '',
    selectedProducts: [],
    deliveryType: '',
    selectedLocation: null,
    customerLocations: [],
    timingType: 'immediate',
    scheduledDate: '',
    scheduledTime: '',
    paymentMethod: 'cash',
    selectedBank: '',
    paymentStatus: 'pending',
    cashAmount: 0,
    transferAmount: 0,
    total: 0,
    selectedDelivery: null,
    orderStatus: 'pending',
    notas: '',
    notaImageUrl: '',
    receiptImageUrl: '',
    customDeliveryCost: null
  })

  const [searchingClient, setSearchingClient] = useState(false)
  const [clientFound, setClientFound] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [loadingClientLocations, setLoadingClientLocations] = useState(false)
  const [searchTimeout, setSearchTimeout] = useState<NodeJS.Timeout | null>(null)
  const [availableDeliveries, setAvailableDeliveries] = useState<any[]>([])
  const [showCreateClient, setShowCreateClient] = useState(false)
  const [showEditClient, setShowEditClient] = useState(false)
  const [editingClient, setEditingClient] = useState<Client | null>(null)
  const [creatingClient, setCreatingClient] = useState(false)
  const [updatingClient, setUpdatingClient] = useState(false)
  const [creatingOrder, setCreatingOrder] = useState(false)
  const [showNotasField, setShowNotasField] = useState(false)
  const [notaImageFile, setNotaImageFile] = useState<File | null>(null)
  const [notaImagePreview, setNotaImagePreview] = useState<string>('')

  // Estados para vista detalle de cliente
  const [showClientDetailSidebar, setShowClientDetailSidebar] = useState(false)
  const [clientOrders, setClientOrders] = useState<any[]>([])
  const [loadingOrders, setLoadingOrders] = useState(false)
  const [clientRegisterDate, setClientRegisterDate] = useState<string | null>(null)
  const [clientEmail, setClientEmail] = useState<string | null>(null)
  const [clientNotes, setClientNotes] = useState<string | null>(null)

  // Estados para edición de cliente dentro del detalle
  const [isEditingClientInDetail, setIsEditingClientInDetail] = useState(false)
  const [detailClientName, setDetailClientName] = useState('')
  const [detailClientPhone, setDetailClientPhone] = useState('')
  const [detailClientEmail, setDetailClientEmail] = useState('')
  const [detailClientNotes, setDetailClientNotes] = useState('')

  // Estados para búsqueda mejorada
  const [searchResults, setSearchResults] = useState<Client[]>([])
  const [showSearchResults, setShowSearchResults] = useState(false)
  const [showNameSearchModal, setShowNameSearchModal] = useState(false)
  const [nameSearchTerm, setNameSearchTerm] = useState('')

  // Estados para modal de variantes
  const [selectedProductForVariants, setSelectedProductForVariants] = useState<Product | null>(null)
  const [isVariantModalOpen, setIsVariantModalOpen] = useState(false)

  // Estados adicionales para personalización de combos y modificadores
  const [selectedVariant, setSelectedVariant] = useState<ProductVariant | null>(null)
  const [comboSelection, setComboSelection] = useState<Record<string, number>>({})
  const [selectedOptions, setSelectedOptions] = useState<Record<string, { name: string, price: number }[]>>({})
  const [customizingQuantity, setCustomizingQuantity] = useState(1)

  const currentCustomizedTotalPrice = useMemo(() => {
    if (!selectedProductForVariants) return 0;
    if (selectedProductForVariants.isCombo) {
      return Object.entries(comboSelection).reduce((total, [variantName, qty]) => {
        const variant = selectedProductForVariants.variants?.find(v => v.name === variantName);
        if (variant && qty > 0) {
          return total + (getProductPublicPrice(variant) * qty);
        }
        return total;
      }, 0);
    } else {
      const basePrice = selectedVariant
        ? getProductPublicPrice(selectedVariant)
        : getProductPublicPrice(selectedProductForVariants);
      const optionsPrice = selectedProductForVariants.optionGroups
        ? Object.values(selectedOptions).reduce((sum, groupSelections) => {
            return sum + groupSelections.reduce((gSum, opt) => gSum + (opt.price || 0), 0);
          }, 0)
        : 0;
      return (basePrice + optionsPrice) * customizingQuantity;
    }
  }, [selectedProductForVariants, selectedVariant, comboSelection, selectedOptions, customizingQuantity]);

  // Estados para modal de ubicaciones
  const [showLocationModal, setShowLocationModal] = useState(false)
  const [showNewLocationForm, setShowNewLocationForm] = useState(false)
  const [newLocationData, setNewLocationData] = useState({
    referencia: '',
    tarifa: '1.25',
    latlong: '',
    photo: '',
    sector: ''
  })
  const [showMapSelection, setShowMapSelection] = useState(false)
  const [isRequestingLocation, setIsRequestingLocation] = useState(false)
  const [creatingLocation, setCreatingLocation] = useState(false)
  const [editingLocationId, setEditingLocationId] = useState<string | null>(null)
  const [locationImageFile, setLocationImageFile] = useState<File | null>(null)
  const [locationImagePreview, setLocationImagePreview] = useState<string>('')
  
  // Estados para cálculo automático de tarifas
  const [calculatingTariff, setCalculatingTariff] = useState(false)
  const [calculatedDistance, setCalculatedDistance] = useState<number | null>(null)
  // Estados para modal de deliveries
  const [showDeliveryModal, setShowDeliveryModal] = useState(false)

  // Estados para edición manual del costo de envío
  const [isEditingDeliveryCost, setIsEditingDeliveryCost] = useState(false)
  const [tempDeliveryCost, setTempDeliveryCost] = useState('')
  


  // Estados para modal de producto personalizado
  const [showCustomProductModal, setShowCustomProductModal] = useState(false)
  const [customProductData, setCustomProductData] = useState({
    name: '',
    price: ''
  })

  // Estados para Toast
  const [toastMessage, setToastMessage] = useState('')
  const [showToast, setShowToast] = useState(false)
  const [toastTimeout, setToastTimeout] = useState<NodeJS.Timeout | null>(null)

  // Función para mostrar Toast
  const displayToast = (message: string) => {
    if (toastTimeout) clearTimeout(toastTimeout)
    setToastMessage(message)
    setShowToast(true)
    const timeout = setTimeout(() => {
      setShowToast(false)
    }, 1000)
    setToastTimeout(timeout)
  }

  const businessDefaultCommissionType = business?.defaultCommissionType
  const businessCommissionRate = business?.commissionRate
  const businessSelectorOptions = businesses ?? []
  const showBusinessSelector = mode === 'create' && businessSelectorOptions.length > 0 && !!onBusinessChange

  const customProductPricing = useMemo(() => {
    const storePrice = parseFloat(customProductData.price)
    if (Number.isNaN(storePrice) || storePrice <= 0) {
      return null
    }

    const { defaultCommissionType, commissionRate } = getBusinessCommissionSettings({
      defaultCommissionType: businessDefaultCommissionType,
      commissionRate: businessCommissionRate
    })
    return calculateCommissionPricing(storePrice, defaultCommissionType, commissionRate)
  }, [customProductData.price, businessDefaultCommissionType, businessCommissionRate])

  const canChangeDelivery = business?.email === 'munchys.ec@gmail.com';

  const sidebarRef = useRef<HTMLDivElement>(null)

  // Bloquear zoom de pellizco (multi-touch) en el sidebar
  useEffect(() => {
    if (!isOpen) return

    const sidebar = sidebarRef.current
    if (!sidebar) return

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 1) {
        e.preventDefault()
      }
    }

    // Agregar listener no pasivo para poder llamar a preventDefault()
    sidebar.addEventListener('touchmove', handleTouchMove, { passive: false })

    return () => {
      sidebar.removeEventListener('touchmove', handleTouchMove)
    }
  }, [isOpen])

  // Cleanup del timeout al desmontar
  useEffect(() => {
    return () => {
      if (searchTimeout) {
        clearTimeout(searchTimeout)
      }
    }
  }, [searchTimeout])

  // Helper para calcular tarifa usando la función compartida en lib/database
  const calculateDeliveryFee = async ({ lat, lng }: { lat: number; lng: number }) => {
    try {
      if (!business?.id) return { fee: 0, zoneName: 'Sin cobertura' }
      const [details, zone] = await Promise.all([
        getDeliveryDetailsForLocation({ lat, lng }, business.id),
        getCoverageZoneForLocation({ lat, lng })
      ]);
      
      const { fee, distance } = details;
      if (distance !== undefined) {
        setCalculatedDistance(distance);
      } else {
        setCalculatedDistance(null);
      }
      return { fee, zoneName: zone?.name || 'Fuera de cobertura' }
    } catch (error) {
      console.error('Error calculating delivery fee:', error)
      return { fee: 0, zoneName: 'Error' }
    }
  }

  // Recalcular total cuando cambie la ubicación seleccionada o el tipo de entrega
  useEffect(() => {
    // Si cambia la ubicación o el tipo de entrega, reseteamos el costo de envío personalizado
    setManualOrderData(prev => {
      const subtotal = prev.selectedProducts.reduce((sum, item) => sum + (item.price * item.quantity), 0)
      const deliveryCost = prev.deliveryType === 'delivery'
        ? (prev.selectedLocation?.latlong ? parseFloat(prev.selectedLocation?.tarifa || '0') : 1.25)
        : 0
      const total = subtotal + deliveryCost
      return {
        ...prev,
        customDeliveryCost: null,
        total: total,
        ...(prev.paymentMethod === 'mixed' && (prev.cashAmount === 0 && prev.transferAmount === 0) && {
          cashAmount: total / 2,
          transferAmount: total / 2
        })
      }
    })
  }, [manualOrderData.selectedLocation, manualOrderData.deliveryType])

  // Eliminar el useEffect que calculaba tarifa automáticamente al cambiar deliveryType
  // Ahora el cálculo se hace explícitamente al seleccionar o crear una ubicación

  // Cargar deliveries activos
  useEffect(() => {
    const loadDeliveries = async () => {
      try {
        const deliveries = await getDeliveriesByStatus('activo')
        setAvailableDeliveries(deliveries)
        // Delivery será asignado automáticamente basado en la ubicación y zona de cobertura
      } catch (error) {
        console.error('Error loading deliveries:', error)
      }
    }

    if (isOpen && business?.id) {
      loadDeliveries()
    }
  }, [isOpen, business?.id])

  // Prefill data when editing
  useEffect(() => {
    if (!isOpen || mode !== 'edit' || !editOrder) return
    try {
      const eo = editOrder
      const selectedDeliveryFromId = (deliveriesList: any[], id?: string) =>
        deliveriesList?.find(d => d.id === id) || null

      const deliveryType = eo.delivery?.type || ''
      const selectedLocation = deliveryType === 'delivery' ? {
        id: 'from-order',
        id_cliente: '',
        latlong: (() => {
          const ll = (eo.delivery as any)?.latlong as string | undefined
          if (ll && typeof ll === 'string' && ll.trim()) {
            return ll.replace(/\s*,\s*/, ',')
          }
          const ml = (eo.delivery as any)?.mapLocation as { lat: number; lng: number } | undefined
          if (ml && typeof ml.lat === 'number' && typeof ml.lng === 'number') {
            return `${ml.lat},${ml.lng}`
          }
          return ''
        })(),
        referencia: (eo._isFromCheckout && eo.delivery?.address) ? eo.delivery.address : (eo.delivery?.references || (eo.delivery as any)?.reference || eo.delivery?.address || ''),
        sector: (eo.delivery as any)?.sector || (eo.delivery as any)?.zoneName || 'Sin especificar',
        tarifa: String(eo.delivery?.deliveryCost || 0)
      } as any : null

      const timingType = eo.timing?.type || 'immediate'
      let scheduledDate = ''
      let scheduledTime = eo.timing?.scheduledTime || ''
      if (timingType === 'scheduled') {
        const sd = eo.timing?.scheduledDate
        let date: Date | null = null
        if (sd) {
          if (typeof sd === 'object' && 'seconds' in sd) {
            date = new Date(sd.seconds * 1000)
          } else if (typeof (sd as any)?.toDate === 'function') {
            date = (sd as any).toDate()
          } else if (sd instanceof Date) {
            date = sd
          } else {
            const d = new Date(sd)
            date = isNaN(d.getTime()) ? null : d
          }
        }
        if (date) {
          const yyyy = date.getFullYear()
          const mm = String(date.getMonth() + 1).padStart(2, '0')
          const dd = String(date.getDate()).padStart(2, '0')
          scheduledDate = `${yyyy}-${mm}-${dd}`
          if (!scheduledTime) {
            const hh = String(date.getHours()).padStart(2, '0')
            const mi = String(date.getMinutes()).padStart(2, '0')
            scheduledTime = `${hh}:${mi}`
          }
        }
      }

      const selectedProducts = (eo.items || []).map((it: any) => ({
        name: it.name || it.product?.name || it.variant || 'Producto',
        price: it.price || it.product?.price || 0,
        productId: it.productId || it.product?.id || it.id || '',
        quantity: it.quantity || 1,
        variant: it.variant || it.variantName || '',
        variantName: it.variantName || it.variant || '',
        // Incluir metadatos de comisión guardados en la base de datos
        basePrice: it.basePrice,
        commission: it.commission,
        commissionType: it.commissionType,
        storeReceives: it.storeReceives
      }))

      setManualOrderData(prev => ({
        ...prev,
        customerPhone: eo.customer?.phone || '',
        customerName: eo.customer?.name || '',
        selectedProducts,
        deliveryType: deliveryType,
        selectedLocation: selectedLocation,
        customerLocations: selectedLocation ? [selectedLocation] : [],
        timingType,
        scheduledDate,
        scheduledTime,
        paymentMethod: eo.payment?.method || 'cash',
        selectedBank: eo.payment?.selectedBank || '',
        paymentStatus: eo.payment?.paymentStatus || 'pending',
        cashAmount: (eo.payment as any)?.cashAmount || 0,
        transferAmount: (eo.payment as any)?.transferAmount || 0,
        total: eo.total || 0,
        selectedDelivery: selectedDeliveryFromId(availableDeliveries, eo.delivery?.assignedDelivery),
        orderStatus: eo.status || 'pending',
        notas: eo.notas || '',
        notaImageUrl: eo.notaImageUrl || '',
        receiptImageUrl: eo.payment?.receiptImageUrl || ''
      }))
      setNotaImageFile(null)
      setNotaImagePreview(eo.notaImageUrl || '')

      // Mostrar inmediatamente tarjeta de cliente encontrado y cargar ubicaciones
      setClientFound(true)
      setShowCreateClient(false)
      const phoneToLoad = eo.customer?.phone || ''
      if (phoneToLoad) {
        setLoadingClientLocations(true)
          ; (async () => {
            try {
              const client = await searchClientByPhone(phoneToLoad)
              if (client) {
                const locations = await getClientLocations(client.id)
                setManualOrderData(prev => ({ ...prev, customerId: client.id, customerLocations: locations }))
              }
            } catch (e) {
              console.error('Error loading client locations for edit:', e)
            } finally {
              setLoadingClientLocations(false)
            }
          })()
      }
    } catch (e) {
      console.error('Error pre-filling edit order:', e)
    }
  }, [isOpen, mode, editOrder, availableDeliveries])

  // Obtener categorías en el orden definido en el negocio
  const getBusinessCategories = (): string[] => {
    const uniqueCategories = (categories: Array<string | null | undefined>) => {
      const seen = new Set<string>()
      return categories.reduce<string[]>((result, category) => {
        const normalizedCategory = category?.trim()
        if (!normalizedCategory || seen.has(normalizedCategory)) return result
        seen.add(normalizedCategory)
        result.push(normalizedCategory)
        return result
      }, [])
    }
    // Usar las categorías del negocio si existen y tienen elementos
    if (business && Array.isArray(business.categories) && business.categories.length > 0) {
      return uniqueCategories(business.categories);
    }
    // Si no hay categorías definidas en el negocio, obtenerlas de los productos
    return uniqueCategories(products.map(product => product.category));
  }

  // Filtrar productos por categoría
  const getFilteredProducts = () => {
    const categoriesOrder = getBusinessCategories()

    const getCategoryIndex = (category?: string | null) => {
      if (!category) return Number.MAX_SAFE_INTEGER
      const idx = categoriesOrder.indexOf(category)
      return idx === -1 ? Number.MAX_SAFE_INTEGER : idx
    }

    const baseProducts = selectedCategory === 'all'
      ? products
      : products.filter(product => product.category === selectedCategory)

    // Ordenar los productos según el orden de las categorías definido por el negocio
    return [...baseProducts].sort((a, b) => {
      const aIdx = getCategoryIndex(a.category as string | null)
      const bIdx = getCategoryIndex(b.category as string | null)
      return aIdx - bIdx
    })
  }

  // Manejar selección de delivery
  const handleDeliverySelect = () => {
    setManualOrderData(prev => ({ ...prev, deliveryType: 'delivery' }))
    setShowLocationModal(true)
    if (manualOrderData.customerId && manualOrderData.customerLocations.length === 0) {
      void reloadClientLocations()
    }
  }

  // Buscar delivery asignado a la zona de una ubicación
  const findDeliveryForLocation = async (location: ClientLocation) => {
    // 1. PRIORIDAD: Si la tienda tiene un delivery predeterminado, asignarlo siempre
    if (business?.defaultDeliveryId) {
      const defaultDelivery = availableDeliveries.find(d => d.id === business.defaultDeliveryId)
      if (defaultDelivery) {
        console.log('[ManualOrder] Asignando delivery predeterminado del negocio:', defaultDelivery.nombres)
        setManualOrderData(prev => ({ ...prev, selectedDelivery: defaultDelivery }))
        return // Prioridad máxima
      } else {
        console.warn('[ManualOrder] Delivery predeterminado configurado pero no encontrado en disponibles:', business.defaultDeliveryId)
      }
    }

    // Si no tiene coordenadas válidas, mantener delivery actual
    if (!location.latlong || location.latlong.startsWith('pluscode:')) {
      console.log('[ManualOrder] Location sin coordenadas válidas, manteniendo delivery predeterminado')
      return
    }

    try {
      // Parsear coordenadas
      const [lat, lng] = location.latlong.split(',').map(Number)
      if (isNaN(lat) || isNaN(lng)) {
        console.log('[ManualOrder] Coordenadas inválidas:', location.latlong)
        return
      }

      // Usar la nueva función con Round Robin
      const deliveryId = await getDeliveryForLocation({ lat, lng })

      if (deliveryId) {
        const delivery = availableDeliveries.find(d => d.id === deliveryId)
        if (delivery) {
          console.log('[ManualOrder] Auto-asignando delivery (Round Robin):', {
            deliveryId,
            deliveryName: delivery.nombres
          })
          setManualOrderData(prev => ({ ...prev, selectedDelivery: delivery }))
        } else {
          console.log('[ManualOrder] Delivery ID encontrado pero no está en lista de disponibles:', deliveryId)
        }
      } else {
        console.log('[ManualOrder] Ubicación no está en ninguna zona con delivery asignado')
      }
    } catch (error) {
      console.error('[ManualOrder] Error buscando delivery por zona:', error)
    }
  }

  // Obtener fecha y hora inicial para programación
  const getInitialScheduledDateTime = () => {
    const now = new Date()
    const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000) // +1 hora

    const date = now.toISOString().split('T')[0] // Formato YYYY-MM-DD
    const time = oneHourLater.toTimeString().slice(0, 5) // Formato HH:MM

    return { date, time }
  }

  // Normalizar número de teléfono ecuatoriano
  const normalizePhone = (phone: string): string => {
    // 1. Obtener solo los dígitos
    let digits = phone.replace(/\D/g, '')

    // 2. Si empieza con 00593, remover 00593
    if (digits.startsWith('00593')) {
      digits = digits.substring(5)
    }
    // 3. Si empieza con 593, remover 593
    else if (digits.startsWith('593')) {
      digits = digits.substring(3)
    }

    // 4. Si el resultado no empieza con '0' y tiene contenido, agregarle '0'
    if (digits.length > 0 && !digits.startsWith('0')) {
      digits = '0' + digits
    }

    // Validar que el resultado sea un número ecuatoriano típico (9 o 10 dígitos iniciando con 0)
    if (digits.length > 0 && !/^0\d{8,9}$/.test(digits)) {
      console.warn('[ManualOrder] Teléfono no válido después de normalización:', {
        original: phone,
        normalized: digits
      })
    }

    return digits
  }

  const normalizePastedPhoneInput = (phone: string): string => {
    const digitsOnly = phone.replace(/\D/g, '')
    const trimmedPhone = phone.trim()
    const hasSpecialChars = /[\s\-\(\)\+\–\—\−]/.test(phone)

    if (
      hasSpecialChars ||
      trimmedPhone.startsWith('+593') ||
      (digitsOnly.startsWith('593') && digitsOnly.length > 10) ||
      (digitsOnly.startsWith('9') && digitsOnly.length === 9) ||
      (digitsOnly.length >= 10)
    ) {
      return normalizePhone(phone)
    }

    return digitsOnly
  }

  // Pegar desde el portapapeles
  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText()
      const normalizedPhone = normalizePhone(text)
      handlePhoneSearch(normalizedPhone)
    } catch (error) {
      console.error('Error al pegar desde el portapapeles:', error)
    }
  }

  // Pegar desde el portapapeles para Ubicación
  const handlePasteLocationFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText()
      handleLocationInputChange(text)
    } catch (error) {
      console.error('Error al pegar desde el portapapeles:', error)
    }
  }

  // Búsqueda instantánea por teléfono (sin debounce)
  const handlePhoneSearchInstant = async (phone: string) => {
    setShowSearchResults(false)

    if (!phone || phone.trim().length < 9) {
      setClientFound(false)
      setShowCreateClient(false)
      setManualOrderData(prev => ({
        ...prev,
        customerId: '',
        customerName: '',
        customerLocations: [],
        selectedLocation: null
      }))
      return
    }

    setSearchingClient(true)
    try {
      const normalizedPhone = normalizePhone(phone)
      const client = await searchClientByPhone(normalizedPhone)

      if (client) {
        await handleSelectClient(client)
        setShowCreateClient(false)
      } else {
        setClientFound(false)
        setShowCreateClient(true)
      }
    } catch (error) {
      console.error('Error searching client by phone:', error)
      setClientFound(false)
    } finally {
      setSearchingClient(false)
    }
  }

  // Búsqueda por nombre (con debounce)
  const handleNameSearchDebounced = (name: string) => {
    setNameSearchTerm(name)
    setShowSearchResults(false)
    setSearchResults([])

    if (!name || name.trim().length < 2) {
      return
    }

    if (searchTimeout) {
      clearTimeout(searchTimeout)
    }

    const timeout = setTimeout(async () => {
      setSearchingClient(true)
      try {
        const results = await searchClients(name, 'name')
        if (results.length > 0) {
          setSearchResults(results as Client[])
          setShowSearchResults(true)
        } else {
          setSearchResults([])
          setShowSearchResults(true) // Mostrar estado vacío
        }
      } catch (error) {
        console.error('Error searching by name:', error)
      } finally {
        setSearchingClient(false)
      }
    }, 500)

    setSearchTimeout(timeout)
  }

  const loadClientLocations = async (clientId: string) => {
    if (!clientId) return

    setLoadingClientLocations(true)
    try {
      const locations = await getClientLocations(clientId)
      setManualOrderData(prev => ({ ...prev, customerLocations: locations }))
      return locations
    } catch (error) {
      console.error('Error loading client locations:', error)
      return []
    } finally {
      setLoadingClientLocations(false)
    }
  }

  // Manejar selección de cliente desde resultados
  const handleSelectClient = async (selectedClient: Client) => {
    setClientFound(true)
    setShowSearchResults(false)
    
    // Normalizar el teléfono del cliente seleccionado
    const normalizedPhone = normalizePhone(selectedClient.celular)
    
    setManualOrderData(prev => ({
      ...prev,
      customerId: selectedClient.id,
      customerPhone: normalizedPhone,
      customerName: selectedClient.nombres,
      customerNotes: selectedClient.notas || ''
    }))

    // Cargar ubicaciones del cliente
    const locations = await loadClientLocations(selectedClient.id)
    console.log('[ManualOrder] Loaded locations for client:', {
      clientId: selectedClient.id,
      locationsCount: locations?.length ?? 0,
      locations: (locations || []).map(l => ({
        id: l.id,
        referencia: l.referencia,
        hasPhoto: !!l.photo,
        photoValue: l.photo
      }))
    })
  }

  // Función para recargar ubicaciones del cliente
  const reloadClientLocations = async () => {
    const clientId = manualOrderData.customerId
    if (!clientId) return

    const locations = await loadClientLocations(clientId)
    console.log('[ManualOrder] Reloaded locations for client:', {
      clientId,
      locationsCount: locations?.length ?? 0
    })
  }

  // Búsqueda de cliente por teléfono (mantener para compatibilidad)
  const handlePhoneSearch = async (phone: string) => {
    setManualOrderData(prev => ({ ...prev, customerPhone: phone }))
    await handlePhoneSearchInstant(phone)
  }

  // Abrir modal para editar cliente
  const handleEditClient = async () => {
    try {
      const phoneToSearch = normalizePhone(manualOrderData.customerPhone)
      const client = await searchClientByPhone(phoneToSearch)
      if (client) {
        setEditingClient(client)
        setShowEditClient(true)
      } else {
        alert('No se pudo encontrar el registro del cliente para editar')
      }
    } catch (error) {
      console.error('Error al cargar datos del cliente:', error)
      alert('Error al cargar los datos del cliente')
    }
  }

  // Actualizar datos del cliente
  const handleUpdateClient = async () => {
    if (!editingClient || !editingClient.nombres?.trim() || !editingClient.celular?.trim()) {
      alert('Por favor complete todos los campos obligatorios')
      return
    }

    const celular = normalizePhone(editingClient.celular.trim())
    if (celular.length < 9) {
      alert('El número de teléfono no parece válido')
      return
    }

    const nombres = editingClient.nombres.trim()
    const email = (editingClient.email || '').trim()
    const notas = (editingClient.notas || '').trim()
    const originalPhone = normalizePhone(manualOrderData.customerPhone)
    const clientId = editingClient.id

    // ENFOQUE OPTIMISTA: Actualizar los datos en el estado local de inmediato y cerrar el modal
    setManualOrderData(prev => ({
      ...prev,
      customerName: nombres,
      customerPhone: celular,
      customerNotes: notas
    }))
    setClientEmail(email || null)
    setClientNotes(notas || null)

    setEditingClient(null)
    setShowEditClient(false)
    displayToast('Guardando cambios en segundo plano...');

    // El guardado real se ejecuta en segundo plano
    (async () => {
      try {
        // Verificar si el teléfono ya existe para otro cliente
        if (celular !== originalPhone) {
          const existingClient = await searchClientByPhone(celular)
          if (existingClient && existingClient.id !== clientId) {
            alert(`El número de teléfono ${celular} ya está registrado con otro cliente. No se pudo actualizar el teléfono.`)
            // Revertir teléfono en estado local si falló
            setManualOrderData(prev => ({
              ...prev,
              customerPhone: originalPhone
            }))
            return
          }
        }

        // Actualizar el cliente en la base de datos
        await updateClient(clientId, {
          nombres,
          celular,
          email,
          notas
        })
        console.log('[ManualOrder] Datos del cliente actualizados con éxito en segundo plano')
        displayToast('Información del cliente actualizada con éxito')
      } catch (error) {
        console.error('Error actualizando cliente en segundo plano:', error)
        alert('Error al actualizar el cliente en segundo plano: ' + (error instanceof Error ? error.message : 'Error desconocido'))
      }
    })()
  }

  // Guardar datos editados del cliente desde el detalle
  const handleSaveClientDetail = async () => {
    if (!detailClientName.trim() || !detailClientPhone.trim()) {
      alert('Por favor complete todos los campos obligatorios')
      return
    }

    const celular = normalizePhone(detailClientPhone.trim())
    if (celular.length < 9) {
      alert('El número de teléfono no parece válido')
      return
    }

    const nombres = detailClientName.trim()
    const email = detailClientEmail.trim()
    const notas = detailClientNotes.trim()
    const originalPhone = normalizePhone(manualOrderData.customerPhone)

    // ENFOQUE OPTIMISTA: Actualizar los datos en el estado local de inmediato y salir del modo edición
    setManualOrderData(prev => ({
      ...prev,
      customerName: nombres,
      customerPhone: celular,
      customerNotes: notas
    }))
    setClientEmail(email || null)
    setClientNotes(notas || null)
    setIsEditingClientInDetail(false)
    displayToast('Guardando cambios en segundo plano...');

    // El guardado real y la verificación se ejecutan en segundo plano
    (async () => {
      try {
        // Buscar cliente actual para obtener su ID
        const client = await searchClientByPhone(originalPhone)
        if (!client) {
          console.error('[ManualOrder] No se encontró el registro del cliente para guardar')
          return
        }

        // Verificar si el teléfono ya existe para otro cliente
        if (celular !== originalPhone) {
          const existingClient = await searchClientByPhone(celular)
          if (existingClient && existingClient.id !== client.id) {
            alert(`El número de teléfono ${celular} ya está registrado con otro cliente. No se pudo actualizar el teléfono.`)
            // Revertir teléfono en estado local si falló
            setManualOrderData(prev => ({
              ...prev,
              customerPhone: originalPhone
            }))
            return
          }
        }

        // Actualizar el cliente en la base de datos
        await updateClient(client.id, {
          nombres,
          celular,
          email,
          notas
        })
        console.log('[ManualOrder] Datos del cliente guardados con éxito en segundo plano')
        displayToast('Información del cliente actualizada con éxito')
      } catch (error) {
        console.error('Error actualizando cliente en segundo plano:', error)
        alert('Error al actualizar el cliente en segundo plano: ' + (error instanceof Error ? error.message : 'Error desconocido'))
      }
    })()
  }

  // Formatear fecha de orden
  const formatOrderDate = (dateVal: any) => {
    if (!dateVal) return ''
    let date: Date
    if (dateVal.seconds) {
      date = new Date(dateVal.seconds * 1000)
    } else if (dateVal instanceof Date) {
      date = dateVal
    } else {
      date = new Date(dateVal)
    }
    if (isNaN(date.getTime())) return ''
    return date.toLocaleString('es-EC', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  // Cargar información general y órdenes del cliente
  const handleViewClientInfo = async () => {
    if (!manualOrderData.customerPhone) return
    setLoadingOrders(true)
    setIsEditingClientInDetail(false)
    setShowClientDetailSidebar(true)
    try {
      const phoneToSearch = normalizePhone(manualOrderData.customerPhone)
      // Buscar información detallada del cliente en Firestore
      const client = await searchClientByPhone(phoneToSearch)
      if (client) {
        setClientRegisterDate(client.fecha_de_registro || null)
        setClientEmail(client.email || null)
        setClientNotes(client.notas || null)
      } else {
        setClientRegisterDate(null)
        setClientEmail(null)
        setClientNotes(null)
      }

      // Obtener órdenes del cliente
      const orders = await getOrdersByClient(phoneToSearch)
      setClientOrders(orders || [])
    } catch (error) {
      console.error('Error fetching client details and orders:', error)
    } finally {
      setLoadingOrders(false)
    }
  }

  // Crear nuevo cliente
  const handleCreateClient = async () => {
    if (!manualOrderData.customerName?.trim() || !manualOrderData.customerPhone?.trim()) {
      alert('Por favor complete todos los campos obligatorios')
      return
    }

    // Normalizar el número de teléfono
    const celular = normalizePhone(manualOrderData.customerPhone.trim())
    if (celular.length < 9) {
      alert('El número de teléfono no parece válido')
      return
    }

    // Verificar si el cliente ya existe
    try {
      const existingClient = await searchClientByPhone(celular)
      if (existingClient) {
        alert('Este cliente ya está registrado')
        // Si el cliente ya existe, seleccionarlo automáticamente
        await handleSelectClient(existingClient)
        return
      }
    } catch (error) {
      console.error('Error verificando cliente existente:', error)
    }

    setCreatingClient(true)
    try {
      const clientData = {
        celular: celular, // Usar el teléfono normalizado
        nombres: manualOrderData.customerName.trim(),
        fecha_de_registro: new Date().toISOString()
      }

      await createClient(clientData)
      setClientFound(true)
      setShowCreateClient(false)

      // Recargar el cliente después de crearlo para obtener el ID
      const client = await searchClientByPhone(celular)
      if (client) {
        const locations = await getClientLocations(client.id)
        setManualOrderData(prev => ({ 
          ...prev, 
          customerId: client.id,
          customerLocations: locations,
          customerPhone: celular // Actualizar el teléfono con el formato normalizado
        }))
      }
    } catch (error) {
      console.error('Error creating client:', error)
      alert('Error al crear el cliente: ' + (error instanceof Error ? error.message : 'Error desconocido'))
    } finally {
      setCreatingClient(false)
    }
  }

  // Función para extraer coordenadas de Google Maps
  const extractCoordinatesFromGoogleMaps = (link: string): string => {
    try {
      // Patrón para enlaces como https://maps.google.com/?q=-1.861343,-79.974945
      const qParamMatch = link.match(/[?&]q=(-?\d+\.?\d*),(-?\d+\.?\d*)/);
      if (qParamMatch) {
        return `${qParamMatch[1]},${qParamMatch[2]}`;
      }

      // Patrón para enlaces como https://www.google.com/maps/place/-1.861343,-79.974945
      const placeMatch = link.match(/\/place\/(-?\d+\.?\d*),(-?\d+\.?\d*)/);
      if (placeMatch) {
        return `${placeMatch[1]},${placeMatch[2]}`;
      }

      // Patrón para enlaces con @ como https://www.google.com/maps/@-1.861343,-79.974945,15z
      const atMatch = link.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/);
      if (atMatch) {
        return `${atMatch[1]},${atMatch[2]}`;
      }

      return '';
    } catch (error) {
      console.error('Error extrayendo coordenadas:', error);
      return '';
    }
  };

  // Función para normalizar coordenadas (eliminar espacios, convertir comas decimales a puntos)
  const normalizeLatLong = (coords: string): string => {

    // Primero, trim, eliminar paréntesis o corchetes del inicio/fin y espacios
    let normalized = coords.trim().replace(/^[\(\[\s]+|[\)\]\s]+$/g, '');

    // El problema: -1,8732619, -79,9795561 tiene 3 comas:
    // - Una como separador decimal de lat
    // - Una para separar lat y lng
    // - Una como separador decimal de lng
    // Necesitamos identificar cuál es la coma separadora (generalmente después del número completo)

    // Estrategia: buscar la coma que tiene un espacio después o que está entre dos números
    // y tiene números antes y después
    const commaPositions = [];
    for (let i = 0; i < normalized.length; i++) {
      if (normalized[i] === ',') {
        commaPositions.push(i);
      }
    }

    // Si hay exactamente 3 comas (decimal lat, separador, decimal lng)
    if (commaPositions.length === 3) {
      // La coma separadora es la del medio
      const separatorIndex = commaPositions[1];
      const lat = normalized.substring(0, separatorIndex).replace(/,/g, '.');
      const lng = normalized.substring(separatorIndex + 1).replace(/,/g, '.');
      normalized = `${lat.trim()},${lng.trim()}`;

    }
    // Si hay exactamente 1 coma (solo separador, sin decimales)
    else if (commaPositions.length === 1) {
      // Ya está bien, solo eliminar espacios alrededor de la coma
      normalized = normalized.replace(/\s*,\s*/, ',');

    }
    // Si hay 2 comas - podría ser ambiguo, intentamos lo mejor
    else if (commaPositions.length === 2) {
      // Asumir que la primera es la coma del lat, la segunda es el separador
      // Pero esto es ambiguo, así que intentaremos detectar
      normalized = normalized.replace(/\s+/g, ''); // Remover todos los espacios

    }

    return normalized;
  }

  // Función para validar coordenadas tradicionales (lat,lng)
  // Soporta formatos como: 1.123456,79.654321 o 1,123456,79,654321
  const validateCoordinates = (coords: string): boolean => {

    if (!coords) return false;
    const normalized = normalizeLatLong(coords);

    // Patrón que acepta puntos O comas como separadores decimales
    // Antes de normalizar: -1,8732619, -79,9795561
    // Después de normalizar: -1.8732619,-79.9795561
    const coordPattern = /^-?\d{1,3}\.?\d*,-?\d{1,3}\.?\d*$/;
    const patternMatch = coordPattern.test(normalized);

    if (!patternMatch) {

      return false;
    }

    // Validar rangos de latitud (-90 a 90) y longitud (-180 a 180)
    const [lat, lng] = normalized.split(',').map(Number);

    const isValid = lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;

    return isValid;
  };

  // Función para verificar si un texto es un Plus Code
  const isPlusCode = (text: string): boolean => {
    // Patrón flexible que acepta:
    // - Códigos que comienzan con números (5245+MQG)
    // - Códigos alfanuméricos (8FVC9G8F+5W)
    // - Con o sin texto descriptivo después
    return /^[0-9A-Z]{4,}\+[0-9A-Z]+.*$/i.test(text.trim());
  };

  // Función para validar un Plus Code
  const validatePlusCode = (code: string): boolean => {
    // Un Plus Code válido debe tener al menos 6 caracteres (ej: 5245+MQ o 8FVC9G+5W)
    const cleanCode = code.replace(/^pluscode:/i, '');
    return /^[0-9A-Z]{3,}\+[0-9A-Z]{2,}$/i.test(cleanCode);
  };

  // Función para extraer el código Plus limpio
  const extractPlusCode = (text: string): string => {
    // Extrae el código Plus Code (mínimo 3 caracteres + + + 2 caracteres)
    const match = text.match(/^([0-9A-Z]{3,}\+[0-9A-Z]{2,})/i);
    return match ? match[1].toUpperCase() : '';
  };

  // Función para validar cualquier tipo de ubicación
  const isValidLocation = (location: string): boolean => {
    if (!location) return false;
    if (location.startsWith('pluscode:')) {
      return validatePlusCode(location);
    }
    return validateCoordinates(location);
  };

  // Función para súper pegar desde WhatsApp
  // Función para súper pegar desde WhatsApp directamente
  const handleSuperPaste = async (isSilent: boolean = false) => {
    try {
      const text = await navigator.clipboard.readText()
      if (!text.trim()) {
        if (!isSilent) displayToast('El portapapeles está vacío')
        return
      }

      // Helper para limpiar referencias de caracteres invisibles y prefijos comunes
      const cleanReferenceString = (textStr: string): string => {
        // Remover caracteres invisibles bidi (comunes al copiar de WhatsApp)
        let cleaned = textStr.replace(/[\u200e\u200f\u202a-\u202e\ufeff\u200b]/g, '')
        // Limpiar prefijos de ubicación/referencia comunes
        cleaned = cleaned.replace(/^(Ubicación|Ubicacion|Referencia|Referencias|Indicaciones|Dirección|Direccion|📍|🏠|🚗|📦):\s*/i, '')
        // Limpiar conectores y espacios del inicio y fin
        cleaned = cleaned.replace(/^[\s,;\-\|]+|[\s,;\-\|]+$/g, '')
        return cleaned.trim()
      }

      const lines = text.split(/\r?\n|\r/)
      let extractedLocation = ''
      let extractedReferences: string[] = []

      for (const line of lines) {
        // Remover caracteres invisibles bidi antes de limpiar y procesar
        const cleanLine = line.replace(/[\u200e\u200f\u202a-\u202e\ufeff\u200b]/g, '').trim()
        if (!cleanLine) continue

        // Intentar extraer el mensaje limpio de WhatsApp
        let content = cleanLine
        const waMatch = cleanLine.match(/^\[?\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4},?\s*[^\]\-]*?[\]\-]\s*[^:]+:\s*(.*)$/i)
        if (waMatch) {
          content = waMatch[1].trim()
        }

        const hasGoogleMaps = /google\.(com|es)\/maps|maps\.app\.goo\.gl|maps\.google/i.test(content)
        const urlMatch = content.match(/https?:\/\/[^\s]+/)

        if (hasGoogleMaps && urlMatch) {
          extractedLocation = urlMatch[0]
          // Si la línea tiene más texto aparte del URL, usar el resto como referencia
          const textWithoutUrl = content.replace(urlMatch[0], '').trim()
          const cleanText = cleanReferenceString(textWithoutUrl)
          if (cleanText) {
            extractedReferences.push(cleanText)
          }
        } else if (isPlusCode(content)) {
          extractedLocation = content
        } else if (validateCoordinates(content)) {
          extractedLocation = content
        } else {
          // Si no es ubicación, limpiamos prefijos comunes si los hay
          const cleanContent = cleanReferenceString(content)
          if (cleanContent) {
            extractedReferences.push(cleanContent)
          }
        }
      }

      if (extractedLocation || extractedReferences.length > 0) {
        let resolvedLatLong = ''
        let sector = ''
        let tarifa = '1.25'

        if (extractedLocation) {
          if (isPlusCode(extractedLocation)) {
            const plusCode = extractPlusCode(extractedLocation)
            if (plusCode) {
              resolvedLatLong = `pluscode:${plusCode}`
              sector = 'Plus Code (Revisar en Maps)'
            }
          } else {
            const coordinates = extractCoordinatesFromGoogleMaps(extractedLocation)
            if (coordinates) {
              resolvedLatLong = normalizeLatLong(coordinates)
            } else if (validateCoordinates(extractedLocation)) {
              resolvedLatLong = normalizeLatLong(extractedLocation)
            }
          }

          if (resolvedLatLong) {
            if (business?.id) {
              const [lat, lng] = resolvedLatLong.startsWith('pluscode:') 
                ? [NaN, NaN] 
                : resolvedLatLong.split(',').map(p => parseFloat(p.trim()))
              
              if (!isNaN(lat) && !isNaN(lng)) {
                const { fee, zoneName } = await calculateDeliveryFee({ lat, lng })
                tarifa = (fee === 0 ? 1.5 : fee).toString()
                sector = zoneName
              }
            }
          }
        }

        setNewLocationData(prev => ({
          ...prev,
          ...(resolvedLatLong ? { latlong: resolvedLatLong } : (extractedLocation ? { latlong: extractedLocation } : {})),
          ...(sector ? { sector } : {}),
          ...(tarifa ? { tarifa } : {}),
          referencia: extractedReferences.join(' | ') || prev.referencia
        }))

        // Si se extrajo ubicación, también disparamos la asignación de delivery
        if (resolvedLatLong && !resolvedLatLong.startsWith('pluscode:')) {
          const tempLocObj = {
            id: 'temp',
            id_cliente: '',
            latlong: resolvedLatLong,
            referencia: extractedReferences.join(' | '),
            sector: sector || 'Sin especificar',
            tarifa: tarifa
          }
          findDeliveryForLocation(tempLocObj)
        }

        displayToast('¡Información pegada!')
      } else {
        if (!isSilent) displayToast('Formato no reconocido')
      }
    } catch (err) {
      console.error('Error en handleSuperPaste:', err)
      if (!isSilent) displayToast('Error al leer del portapapeles')
    }
  }

  // Función para manejar cambio en el campo de ubicación (Enlace, Coordenadas o Plus Code)
  const handleLocationInputChange = async (value: string) => {
    // Actualizar el valor actual (latlong sirve como campo único)
    setNewLocationData(prev => ({ ...prev, latlong: value }));

    if (value.trim()) {
      let resolvedLatLong = '';
      let updatedReferencia = '';

      // 1. Verificar si es un Plus Code
      if (isPlusCode(value)) {
        const plusCode = extractPlusCode(value);
        if (plusCode) {
          resolvedLatLong = `pluscode:${plusCode}`;
          updatedReferencia = value.replace(plusCode, '').trim();
        }
      } else {
        // 2. Intentar extraer coordenadas de un enlace de Google Maps
        const coordinates = extractCoordinatesFromGoogleMaps(value);
        if (coordinates) {
          resolvedLatLong = normalizeLatLong(coordinates);
        } else if (validateCoordinates(value)) {
          // 3. Verificar si es una coordenada directa para normalizarla
          resolvedLatLong = normalizeLatLong(value);
        }
      }

      if (resolvedLatLong) {
        setNewLocationData(prev => ({
          ...prev,
          latlong: resolvedLatLong,
          ...(updatedReferencia && { referencia: updatedReferencia || prev.referencia })
        }));

        // Calcular tarifa y sector automáticamente
        if (business?.id) {
          const [lat, lng] = resolvedLatLong.startsWith('pluscode:') ? [NaN, NaN] : resolvedLatLong.split(',').map(p => parseFloat(p.trim()));
          
          if (!isNaN(lat) && !isNaN(lng)) {
            const { fee, zoneName } = await calculateDeliveryFee({ lat, lng });
            const normalizedFee = fee === 0 ? 1.5 : fee;
            setNewLocationData(prev => ({
              ...prev,
              tarifa: normalizedFee.toString(),
              sector: zoneName
            }));
          } else if (resolvedLatLong.startsWith('pluscode:')) {
             setNewLocationData(prev => ({ ...prev, sector: 'Plus Code (Revisar en Maps)' }));
          }
        }
      }
    }
  };

  // Función para manejar el cambio de ubicación desde el mapa (fixed center)
  const handleMapLocationChange = useCallback(async (lat: number, lng: number) => {
    const latlongValue = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    
    // Si tenemos un negocio, calcular la tarifa automáticamente
    if (business?.id) {
      const { fee, zoneName } = await calculateDeliveryFee({ lat, lng });
      const normalizedFee = fee === 0 ? 1.5 : fee;
      setNewLocationData(prev => ({
        ...prev,
        latlong: latlongValue,
        tarifa: normalizedFee.toString(),
        sector: zoneName
      }));
    } else {
      setNewLocationData(prev => ({ 
        ...prev, 
        latlong: latlongValue 
      }));
    }
  }, [business?.id]);

  // Función para obtener la ubicación actual por GPS
  const getCurrentGpsLocation = () => {
    if (!navigator.geolocation) {
      alert('Geolocalización no soportada por tu navegador');
      return;
    }

    setIsRequestingLocation(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        handleMapLocationChange(latitude, longitude);
        setIsRequestingLocation(false);
      },
      (error) => {
        console.error('Error getting GPS location:', error);
        setIsRequestingLocation(false);
        alert('No se pudo obtener tu ubicación. Verifica los permisos de tu navegador.');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  // Función para crear nueva ubicación
  const handleCreateLocation = async () => {
    if (creatingLocation) return;

    if (!newLocationData.referencia.trim()) {
      alert('Por favor ingresa una referencia para la ubicación');
      return;
    }

    setCreatingLocation(true);
    try {
      // LatLong ahora es opcional. Si se proporciona, debe ser válido.
      if (newLocationData.latlong.trim()) {
        if (!isValidLocation(newLocationData.latlong)) {
          alert('Por favor ingresa coordenadas válidas (formato: lat,lng o un Plus Code como 42W9+246)');
          setCreatingLocation(false);
          return;
        }
        // Solo normalizar si no es un Plus Code
        if (!newLocationData.latlong.startsWith('pluscode:')) {
          const normalized = normalizeLatLong(newLocationData.latlong);
          setNewLocationData(prev => ({ ...prev, latlong: normalized }));
        }
      }

      // Buscar el cliente para obtener su ID
      if (!manualOrderData.customerId) {
        alert('Por favor identifica al cliente primero (buscando por teléfono)');
        setCreatingLocation(false);
        return;
      }

      const clientId = manualOrderData.customerId;
      if (!clientId) {
        alert('No se encontró el registro del cliente. Por favor asegúrate de haberlo creado o seleccionado correctamente.');
        setCreatingLocation(false);
        return;
      }

      

      // Subir imagen si existe
      let photoUrl = '';
      if (locationImageFile) {
        const timestamp = Date.now();
        const optimizedBlob = await optimizeImage(locationImageFile, 1000, 0.8, 'image/jpeg');
        const optimizedFile = new File(
          [optimizedBlob],
          `${timestamp}_${locationImageFile.name.split('.')[0]}.jpg`,
          { type: optimizedBlob.type || 'image/jpeg' }
        );

        const fileName = `locations/${clientId}_${optimizedFile.name}`;
        const storageRef = ref(storage, fileName);
        await uploadBytes(storageRef, optimizedFile);
        photoUrl = await getDownloadURL(storageRef);
      }

      const newLocationResponse = await createClientLocation({
        id_cliente: clientId,
        latlong: newLocationData.latlong.trim(),
        referencia: newLocationData.referencia.trim(),
        tarifa: newLocationData.tarifa,
        sector: newLocationData.sector || 'Sin especificar',
        createdBy: 'admin',
        ...(photoUrl && { photo: photoUrl })
      });

      // Recargar ubicaciones del cliente
      const locations = await getClientLocations(clientId);
      setManualOrderData(prev => ({ ...prev, customerLocations: locations }));

      // Seleccionar automáticamente la nueva ubicación creada
      const newLocation = locations.find(loc =>
        loc.latlong === newLocationData.latlong.trim() &&
        loc.referencia === newLocationData.referencia.trim()
      );
      if (newLocation) {
        // Calcular tarifa automáticamente para la nueva ubicación
        if (newLocation.latlong) {
          try {
            const [lat, lng] = newLocation.latlong.split(',').map(coord => parseFloat(coord.trim()))
            if (!isNaN(lat) && !isNaN(lng)) {
              const { fee, zoneName } = await calculateDeliveryFee({ lat, lng })
              const normalizedFee = fee === 0 ? 1.5 : fee
              const updatedLocation = { ...newLocation, tarifa: normalizedFee.toString(), sector: zoneName }
              setManualOrderData(prev => ({ ...prev, selectedLocation: updatedLocation }));
              calculateTotal(manualOrderData.selectedProducts);
              findDeliveryForLocation(updatedLocation);
            } else {
              setManualOrderData(prev => ({ ...prev, selectedLocation: newLocation }));
              calculateTotal(manualOrderData.selectedProducts);
              findDeliveryForLocation(newLocation);
            }
          } catch (error) {
            console.error('Error calculating delivery fee for new location:', error)
            setManualOrderData(prev => ({ ...prev, selectedLocation: newLocation }));
            calculateTotal(manualOrderData.selectedProducts);
            findDeliveryForLocation(newLocation);
          }
        } else {
          setManualOrderData(prev => ({ ...prev, selectedLocation: newLocation }));
          calculateTotal(manualOrderData.selectedProducts);
          findDeliveryForLocation(newLocation);
        }
      }

      // Limpiar formulario y cerrar modal
      setNewLocationData({
        referencia: '',
        tarifa: '1',
        latlong: '',
        photo: '',
        sector: ''
      });
      setLocationImageFile(null);
      setLocationImagePreview('');
      setShowNewLocationForm(false);
      setShowLocationModal(false);
      setShowMapSelection(false);
    } catch (error) {
      console.error('Error creando ubicación:', error);
      alert('Error al crear la ubicación. Por favor intenta de nuevo.');
    } finally {
      setCreatingLocation(false);
    }
  };

  // Editar ubicación - abrir formulario con datos
  const handleEditLocation = (location: ClientLocation) => {
    setEditingLocationId(location.id)
    setNewLocationData({
      referencia: location.referencia || '',
      tarifa: location.tarifa || '1',
      latlong: location.latlong || '',
      photo: location.photo || '',
      sector: location.sector || ''
    })
    // Si hay una foto existente, mostrarla en el preview
    if (location.photo) {
      setLocationImagePreview(location.photo)
    }
    setShowNewLocationForm(true)
  }

  // Guardar cambios de edición
  const handleSaveEditedLocation = async () => {
    if (!editingLocationId || creatingLocation) return
    
    if (!newLocationData.referencia.trim()) {
      alert('Por favor ingresa una referencia para la ubicación');
      return;
    }

    setCreatingLocation(true)
    try {
      if (newLocationData.latlong.trim()) {
        if (!isValidLocation(newLocationData.latlong)) {
          alert('Por favor ingresa coordenadas válidas (formato: lat,lng o un Plus Code como 42W9+246)');
          setCreatingLocation(false);
          return;
        }
        // Solo normalizar si no es un Plus Code
        if (!newLocationData.latlong.startsWith('pluscode:')) {
          const normalized = normalizeLatLong(newLocationData.latlong);
          setNewLocationData(prev => ({ ...prev, latlong: normalized }));
        }
      }

      // Buscar el cliente para obtener su ID (necesario para subir imagen)
      if (!manualOrderData.customerId) {
        alert('No se pudo identificar al cliente asociado');
        setCreatingLocation(false);
        return;
      }

      const clientId = manualOrderData.customerId;
      if (!clientId) {
        alert('No se encontró el registro del cliente');
        setCreatingLocation(false);
        return;
      }

      // Subir imagen si existe un nuevo archivo
      let photoUrl = newLocationData.photo; // Mantener la URL existente por defecto
      if (locationImageFile) {
        const timestamp = Date.now();
        const optimizedBlob = await optimizeImage(locationImageFile, 1000, 0.8, 'image/jpeg');
        const optimizedFile = new File(
          [optimizedBlob],
          `${timestamp}_${locationImageFile.name.split('.')[0]}.jpg`,
          { type: optimizedBlob.type || 'image/jpeg' }
        );

        const fileName = `locations/${clientId}_${optimizedFile.name}`;
        const storageRef = ref(storage, fileName);
        await uploadBytes(storageRef, optimizedFile);
        photoUrl = await getDownloadURL(storageRef);
      }

      const updatePayload: any = {
        referencia: newLocationData.referencia.trim(),
        tarifa: newLocationData.tarifa,
        updatedAt: new Date()
      }

      // Incluir latlong sólo si viene
      if (newLocationData.latlong.trim()) {
        updatePayload.latlong = normalizeLatLong(newLocationData.latlong.trim())
      } else {
        // Si se deja en blanco, mantener como cadena vacía
        updatePayload.latlong = ''
      }

      // Incluir photo si existe
      if (photoUrl) {
        updatePayload.photo = photoUrl;
      }

      await updateLocation(editingLocationId, updatePayload)

      // Recargar ubicaciones
      if (clientId) {
        const locations = await getClientLocations(clientId)
        setManualOrderData(prev => ({ ...prev, customerLocations: locations }))
        
        // Si la ubicación editada es la que está seleccionada actualmente, actualizarla
        if (manualOrderData.selectedLocation?.id === editingLocationId) {
          const updatedLocation = locations.find(loc => loc.id === editingLocationId)
          if (updatedLocation) {
            // Calcular tarifa automáticamente para la ubicación actualizada
            if (updatedLocation.latlong) {
              try {
                const [lat, lng] = updatedLocation.latlong.split(',').map(coord => parseFloat(coord.trim()))
                if (!isNaN(lat) && !isNaN(lng)) {
                  const { fee } = await calculateDeliveryFee({ lat, lng })
                  const normalizedFee = fee === 0 ? 1.5 : fee
                  const locationWithFee = { ...updatedLocation, tarifa: normalizedFee.toString() }
                  setManualOrderData(prev => ({ ...prev, selectedLocation: locationWithFee }))
                  calculateTotal(manualOrderData.selectedProducts)
                } else {
                  setManualOrderData(prev => ({ ...prev, selectedLocation: updatedLocation }))
                  calculateTotal(manualOrderData.selectedProducts)
                }
              } catch (error) {
                console.error('Error calculating delivery fee for updated location:', error)
                setManualOrderData(prev => ({ ...prev, selectedLocation: updatedLocation }))
                calculateTotal(manualOrderData.selectedProducts)
              }
            } else {
              setManualOrderData(prev => ({ ...prev, selectedLocation: updatedLocation }))
              calculateTotal(manualOrderData.selectedProducts)
            }
          }
        }
      }

      setEditingLocationId(null)
      setShowNewLocationForm(false)
      setNewLocationData({ referencia: '', tarifa: '1', latlong: '', photo: '', sector: '' })
      setLocationImageFile(null)
      setLocationImagePreview('')
      setShowMapSelection(false)
    } catch (error) {
      console.error('Error actualizando ubicación:', error)
      alert('Error al actualizar la ubicación. Por favor intenta de nuevo.');
    } finally {
      setCreatingLocation(false)
    }
  }

  // Eliminar ubicación
  const handleDeleteLocation = async (locationId: string) => {
    if (!window.confirm('¿Eliminar esta ubicación? Esta acción no se puede deshacer.')) return
    try {
      await deleteLocation(locationId)

      // Si la ubicación eliminada estaba seleccionada, quitar selección
      if (manualOrderData.selectedLocation?.id === locationId) {
        setManualOrderData(prev => ({ ...prev, selectedLocation: null }))
      }

      if (manualOrderData.customerId) {
        const locations = await getClientLocations(manualOrderData.customerId)
        setManualOrderData(prev => ({ ...prev, customerLocations: locations }))
      }
    } catch (error) {
      console.error('Error eliminando ubicación:', error)
    }
  }

  // Controlar la selección del producto (abrir modal si requiere personalización)
  const handleSelectProduct = (product: Product) => {
    const hasVariants = product.variants && product.variants.length > 0
    const isCombo = product.isCombo === true
    const hasOptions = product.optionGroups && product.optionGroups.length > 0

    if (hasVariants || isCombo || hasOptions) {
      setSelectedProductForVariants(product)
      if (hasVariants) {
        const firstVariant = product.variants?.find(v => v.isAvailable !== false) || product.variants?.[0] || null
        setSelectedVariant(firstVariant)
      } else {
        setSelectedVariant(null)
      }
      setComboSelection({})
      setSelectedOptions({})
      setCustomizingQuantity(1)
      setIsVariantModalOpen(true)
    } else {
      addProductToOrder(product)
    }
  }

  // Agregar producto personalizado/configurado a la orden
  const addCustomizedProductToOrder = () => {
    if (!selectedProductForVariants) return;
    const product = selectedProductForVariants;

    // 1. Validar opciones/modificadores obligatorios
    if (product.optionGroups && product.optionGroups.length > 0) {
      const isOptionsSelectionComplete = product.optionGroups.every(group => {
        const count = (selectedOptions[group.id] || []).length;
        return count >= group.minSelect;
      });
      if (!isOptionsSelectionComplete) {
        alert('Por favor selecciona las opciones obligatorias');
        return;
      }
    }

    // 2. Validar combo completo
    const totalComboSelected = product.isCombo ? Object.values(comboSelection).reduce((a, b) => a + b, 0) : 0;
    const isComboComplete = !product.isCombo || totalComboSelected >= (product.minComboItems || 1);
    if (!isComboComplete) {
      alert(`Por favor completa tu combo (${totalComboSelected}/${product.minComboItems} seleccionados)`);
      return;
    }

    // 3. Calcular precio y metadatos de precios
    let basePriceMeta: any = {};
    let baseProductPrice = 0;
    let variantNameStr = '';

    if (product.isCombo) {
      // Para combos, el precio base es la suma de los precios de las variantes seleccionadas
      const comboMeta = Object.entries(comboSelection).reduce((acc, [variantName, qty]) => {
        const variant = product.variants?.find(v => v.name === variantName);
        if (variant && qty > 0) {
          const meta = getPriceMetadata(variant);
          return {
            basePrice: acc.basePrice + ((meta.basePrice || getProductPublicPrice(variant)) * qty),
            commission: acc.commission + ((meta.commission || 0) * qty),
            publicPrice: acc.publicPrice + (getProductPublicPrice(variant) * qty),
            storeReceives: acc.storeReceives + ((meta.storeReceives || getProductPublicPrice(variant)) * qty),
          };
        }
        return acc;
      }, { basePrice: 0, commission: 0, publicPrice: 0, storeReceives: 0 });

      basePriceMeta = {
        basePrice: comboMeta.basePrice,
        commission: comboMeta.commission,
        publicPrice: comboMeta.publicPrice,
        storeReceives: comboMeta.storeReceives,
        commissionType: product.commissionType || 'no_commission'
      };
      baseProductPrice = comboMeta.publicPrice;

      const selectedVariantsStr = Object.entries(comboSelection)
        .filter(([_, q]) => q > 0)
        .map(([name, q]) => `${q}x ${name}`)
        .join(', ');
      variantNameStr = `Combo: ${selectedVariantsStr}`;

    } else {
      // Para productos normales (con o sin variantes)
      basePriceMeta = selectedVariant
        ? getPriceMetadata(selectedVariant)
        : getPriceMetadata(product);
      baseProductPrice = selectedVariant
        ? getProductPublicPrice(selectedVariant)
        : getProductPublicPrice(product);

      if (selectedVariant) {
        variantNameStr = selectedVariant.name;
      }
    }

    // 4. Formatear opciones seleccionadas
    const optionsPrice = product.optionGroups
      ? Object.values(selectedOptions).reduce((sum, groupSelections) => {
          return sum + groupSelections.reduce((gSum, opt) => gSum + (opt.price || 0), 0);
        }, 0)
      : 0;

    const optionsList: string[] = [];
    if (product.optionGroups) {
      Object.entries(selectedOptions).forEach(([groupId, selections]) => {
        const group = product.optionGroups?.find(g => g.id === groupId);
        if (selections.length > 0) {
          const groupSelections = selections.map(s => {
            const priceStr = s.price > 0 ? ` (+$${s.price.toFixed(2)})` : '';
            return `${s.name}${priceStr}`;
          }).join(', ');
          optionsList.push(`${group?.name || 'Opción'}: ${groupSelections}`);
        }
      });
    }
    const optionsStr = optionsList.join(' | ');

    let finalVariantName = '';
    if (product.isCombo) {
      finalVariantName = variantNameStr;
    } else if (selectedVariant) {
      finalVariantName = optionsStr ? `${selectedVariant.name} (${optionsStr})` : selectedVariant.name;
    } else {
      finalVariantName = optionsStr;
    }

    // 5. Crear Item de la orden
    const newItem: OrderItem = {
      name: product.name,
      variant: finalVariantName,
      variantName: finalVariantName,
      productName: product.name,
      price: baseProductPrice + optionsPrice,
      productId: product.id,
      quantity: product.isCombo ? 1 : customizingQuantity,
      basePrice: (basePriceMeta.basePrice || baseProductPrice) + optionsPrice,
      commission: basePriceMeta.commission || 0,
      commissionType: basePriceMeta.commissionType || 'no_commission',
      storeReceives: (basePriceMeta.storeReceives || baseProductPrice) + optionsPrice
    };

    setManualOrderData(prev => ({
      ...prev,
      selectedProducts: [...prev.selectedProducts, newItem]
    }));

    calculateTotal([...manualOrderData.selectedProducts, newItem]);
    
    displayToast(`✅ ${product.name} agregado`);

    // Resetear y cerrar modal
    setIsVariantModalOpen(false);
    setSelectedProductForVariants(null);
    setSelectedVariant(null);
    setComboSelection({});
    setSelectedOptions({});
    setCustomizingQuantity(1);
  };

  // Agregar producto a la orden
  const addProductToOrder = (product: Product, variant?: ProductVariant) => {
    const item = variant || product
    const pubPrice = getProductPublicPrice(item)
    const metadata = getPriceMetadata(item)

    const newItem: OrderItem = {
      name: product.name,                    // Nombre base del producto
      variant: variant?.name || '',          // Nombre de la variante
      variantName: variant?.name || '',      // Nombre de la variante
      productName: product.name,             // Nombre base
      price: pubPrice,
      productId: product.id,
      quantity: 1,
      ...metadata
    }

    setManualOrderData(prev => ({
      ...prev,
      selectedProducts: [...prev.selectedProducts, newItem]
    }))

    calculateTotal([...manualOrderData.selectedProducts, newItem])
    const addedProductLabel = variant?.name && variant.name !== product.name
      ? `${product.name} - ${variant.name}`
      : product.name
    displayToast(`✅ ${addedProductLabel} agregado`)
  }

  // Agregar producto personalizado a la orden
  const addCustomProductToOrder = () => {
    if (!customProductData.name.trim() || !customProductData.price.trim()) {
      alert('Por favor completa todos los campos del producto personalizado')
      return
    }

    const storePrice = parseFloat(customProductData.price)
    if (isNaN(storePrice) || storePrice <= 0 || !customProductPricing) {
      alert('Por favor ingresa un precio válido')
      return
    }

    const customItem: OrderItem = {
      name: customProductData.name.trim(),
      price: customProductPricing.publicPrice,
      productId: `custom_${Date.now()}`, // ID temporal único
      quantity: 1,
      variant: '',
      variantName: '',
      productName: customProductData.name.trim(),
      // El valor escrito es el valor de tienda; el precio publico se calcula aparte.
      basePrice: customProductPricing.storePrice,
      commission: customProductPricing.commission,
      commissionType: customProductPricing.commissionType,
      storeReceives: customProductPricing.storeReceives
    }

    setManualOrderData(prev => ({
      ...prev,
      selectedProducts: [...prev.selectedProducts, customItem]
    }))

    calculateTotal([...manualOrderData.selectedProducts, customItem])

    // Limpiar y cerrar el modal
    setCustomProductData({ name: '', price: '' })
    setShowCustomProductModal(false)
    displayToast(`✅ ${customProductData.name.trim()} agregado`)
  }

  // Actualizar cantidad de producto
  const updateProductQuantity = (index: number, quantity: number) => {
    if (quantity <= 0) {
      removeProduct(index)
      return
    }

    const updatedProducts = [...manualOrderData.selectedProducts]
    updatedProducts[index].quantity = quantity

    setManualOrderData(prev => ({
      ...prev,
      selectedProducts: updatedProducts
    }))

    calculateTotal(updatedProducts)
  }

  // Remover producto
  const removeProduct = (index: number) => {
    const updatedProducts = manualOrderData.selectedProducts.filter((_, i) => i !== index)
    setManualOrderData(prev => ({
      ...prev,
      selectedProducts: updatedProducts
    }))

    calculateTotal(updatedProducts)
  }

  // Guardar costo de envío editado manualmente
  const handleSaveDeliveryCost = () => {
    const val = parseFloat(tempDeliveryCost)
    if (isNaN(val) || val < 0) {
      alert('Por favor ingrese un valor de envío válido (mayor o igual a 0)')
      return
    }
    setManualOrderData(prev => ({
      ...prev,
      customDeliveryCost: val
    }))
    calculateTotal(manualOrderData.selectedProducts, val)
    setIsEditingDeliveryCost(false)
  }

  // Calcular total
  const calculateTotal = (products: OrderItem[], overrideCustomDeliveryCost?: number | null) => {
    const subtotal = products.reduce((sum, item) => sum + (item.price * item.quantity), 0)
    const customCost = overrideCustomDeliveryCost !== undefined
      ? overrideCustomDeliveryCost
      : manualOrderData.customDeliveryCost

    const deliveryCost = manualOrderData.deliveryType === 'delivery'
      ? (customCost !== null && customCost !== undefined
          ? customCost
          : (manualOrderData.selectedLocation?.latlong ? parseFloat(manualOrderData.selectedLocation?.tarifa || '0') : 1.25))
      : 0
    const total = subtotal + deliveryCost

    setManualOrderData(prev => ({
      ...prev,
      total: total,
      // Si es pago mixto y algún valor está en 0, distribuir automáticamente
      ...(prev.paymentMethod === 'mixed' && (prev.cashAmount === 0 && prev.transferAmount === 0) && {
        cashAmount: total / 2,
        transferAmount: total / 2
      })
    }))
  }

  // Crear o actualizar orden
  const handleSubmitOrder = async () => {
    if (!business?.id) {
      alert('No hay negocio seleccionado')
      return
    }

    // Nota: permitimos crear la orden aún si faltan datos (cliente, productos, tipo de entrega, programación).
    // Solo validamos el pago mixto si el usuario lo ha seleccionado para evitar inconsistencias.
    if (manualOrderData.paymentMethod === 'mixed') {
      const totalMixed = (manualOrderData.cashAmount || 0) + (manualOrderData.transferAmount || 0);
      if (Math.abs(totalMixed - manualOrderData.total) >= 0.01) {
        alert('La suma de efectivo y transferencia debe ser igual al total del pedido')
        return
      }
    }

    setCreatingOrder(true)
    try {
      const finalStatus = computedStatus;
      let notaImageUrl = manualOrderData.notaImageUrl || ''

      if (notaImageFile) {
        const timestamp = Date.now()
        const optimizedBlob = await optimizeImage(notaImageFile, 576, 0.75, 'image/jpeg')
        const safeName = (notaImageFile.name || 'nota').split('.')[0].replace(/[^a-zA-Z0-9_-]/g, '_')
        const optimizedFile = new File(
          [optimizedBlob],
          `${timestamp}_${safeName}.jpg`,
          { type: optimizedBlob.type || 'image/jpeg' }
        )

        const storageRef = ref(storage, `order-notes/${business.id}/${optimizedFile.name}`)
        await uploadBytes(storageRef, optimizedFile)
        notaImageUrl = await getDownloadURL(storageRef)
      }

      const now = new Date();
      const firestoreTimestamp = {
        seconds: Math.floor(now.getTime() / 1000),
        nanoseconds: 0
      };

      let orderData: any = {
        businessId: business.id,
        items: manualOrderData.selectedProducts.map(item => ({
          productId: item.productId,
          name: item.name,
          price: item.price,
          quantity: item.quantity,
          variant: item.variant,
          basePrice: (item as any).basePrice,
          commission: (item as any).commission,
          commissionType: (item as any).commissionType,
          storeReceives: (item as any).storeReceives
        })),
        customer: {
          name: manualOrderData.customerName,
          phone: manualOrderData.customerPhone
        },
        delivery: {
          type: manualOrderData.deliveryType,
          ...(manualOrderData.deliveryType === 'delivery' && {
            latlong: manualOrderData.selectedLocation?.latlong || '',
            references: manualOrderData.selectedLocation?.referencia || '',
            sector: manualOrderData.selectedLocation?.sector || '',
            photo: manualOrderData.selectedLocation?.photo || '', // AÑADIDO: Guardar la foto de ubicación
            deliveryCost: manualOrderData.customDeliveryCost !== null && manualOrderData.customDeliveryCost !== undefined
              ? manualOrderData.customDeliveryCost
              : parseFloat(manualOrderData.selectedLocation?.tarifa || '0'),
            assignedDelivery: manualOrderData.selectedDelivery?.id || null
          })
        },
        timing: (() => {
          // Si estamos editando y el tipo es inmediato, intentar preservar el tiempo original
          if (
            mode === 'edit' && 
            editOrder?.timing?.type === 'immediate' && 
            manualOrderData.timingType === 'immediate' &&
            editOrder.timing.scheduledDate &&
            editOrder.timing.scheduledTime
          ) {
            return {
              type: 'immediate',
              scheduledDate: editOrder.timing.scheduledDate,
              scheduledTime: editOrder.timing.scheduledTime
            }
          }

          // Para pedidos programados o nuevos pedidos inmediatos
          return {
            type: manualOrderData.timingType,
            ...(manualOrderData.timingType === 'scheduled' && {
              scheduledDate: manualOrderData.scheduledDate ? (() => {
                const [year, month, day] = manualOrderData.scheduledDate.split('-').map(Number);
                const [hours, minutes] = manualOrderData.scheduledTime ? manualOrderData.scheduledTime.split(':').map(Number) : [0, 0];
                return {
                  seconds: Math.floor(new Date(year, month - 1, day, hours, minutes).getTime() / 1000),
                  nanoseconds: 0
                };
              })() : null,
              scheduledTime: manualOrderData.scheduledTime || ''
            }),
            ...(manualOrderData.timingType === 'immediate' && {
              // Para NUEVOS pedidos inmediatos, guardar fecha actual y hora actual + tiempo definido (o 30 min)
              scheduledDate: firestoreTimestamp,
              scheduledTime: (() => {
                const baseDeliveryTime = business?.deliveryTime || 30;
                const deliveryTime = new Date(now.getTime() + (baseDeliveryTime + 1) * 60 * 1000);
                const hh = String(deliveryTime.getHours()).padStart(2, '0');
                const mm = String(deliveryTime.getMinutes()).padStart(2, '0');
                return `${hh}:${mm}`;
              })()
            })
          }
        })(),
        payment: {
          method: manualOrderData.paymentMethod,
          paymentStatus: manualOrderData.paymentStatus,
          selectedBank: manualOrderData.selectedBank,
          receiptImageUrl: manualOrderData.receiptImageUrl || '',
          ...(manualOrderData.paymentMethod === 'mixed' && {
            cashAmount: manualOrderData.cashAmount || 0,
            transferAmount: manualOrderData.transferAmount || 0
          })
        },
        subtotal: manualOrderData.selectedProducts.reduce((sum, item) => sum + (item.price * item.quantity), 0),
        total: manualOrderData.total,
        status: finalStatus as any,
        createdByAdmin: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        notas: manualOrderData.notas,
        notaImageUrl
      }

      // Log para debugging
      console.log('[ManualOrder] Order data being created:', {
        hasDelivery: !!orderData.delivery,
        deliveryType: orderData.delivery?.type,
        deliveryPhoto: orderData.delivery?.photo,
        selectedLocationPhoto: manualOrderData.selectedLocation?.photo,
        fullDeliveryObject: orderData.delivery
      });

      // Detectar si es un checkout (por la bandera _isFromCheckout o el ID que empieza con 'checkout-')
      const isFromCheckout = editOrder?._isFromCheckout || editOrder?.id?.startsWith('checkout-');

      // ENFOQUE OPTIMISTA: Cerramos y reseteamos de inmediato
      onClose();
      handleReset();
      
      // El guardado se ejecuta en segundo plano
      (async () => {
        try {
          if (mode === 'edit' && editOrder?.id && !isFromCheckout) {
            const updatePayload: any = {
              items: orderData.items,
              customer: orderData.customer,
              delivery: orderData.delivery,
              timing: orderData.timing,
              payment: orderData.payment,
              total: orderData.total,
              status: finalStatus,
              updatedAt: new Date(),
              notas: orderData.notas,
              notaImageUrl: orderData.notaImageUrl
            }
            await updateOrder(editOrder.id, updatePayload)
            onOrderUpdated && onOrderUpdated({
              ...editOrder,
              ...updatePayload,
              id: editOrder.id
            })
            console.log('[ManualOrder] Orden actualizada con éxito en segundo plano');
          } else {
            const orderId = await createOrder(orderData as any)
            
            // Si viene de un checkout, marcarlo como completado
            if (isFromCheckout && editOrder?.checkoutSessionId) {
              try {
                const { doc, updateDoc } = await import('firebase/firestore')
                const { db } = await import('@/lib/firebase')
                await updateDoc(doc(db, 'checkoutProgress', editOrder.checkoutSessionId), {
                  currentStep: 5,
                  completedAt: new Date(),
                  convertedToOrderId: orderId
                });
              } catch (e) { console.error('Error updating checkout session:', e) }
            }

            // Registrar consumo
            try {
              const cartItems = orderData.items.map((item: any) => ({
                productId: item.productId,
                variant: item.variant || item.name,
                name: item.name,
                quantity: item.quantity
              }))
              if (cartItems.length > 0) {
                const orderDateStr = new Date().toISOString().split('T')[0]
                await registerOrderConsumption(business?.id!, cartItems, orderDateStr, orderId)
              }
            } catch (e) { console.error('Error registering consumption:', e) }

            onOrderCreated()
            console.log('[ManualOrder] Orden creada con éxito en segundo plano');
          }
        } catch (error) {
          console.error('Error guardando la orden en segundo plano:', error)
          // Opcional: mostrar un alerta global o notificación de error
        } finally {
          setCreatingOrder(false)
        }
      })();
    } catch (error) {
      console.error('Error al preparar los datos de la orden:', error)
      alert('Error al procesar la orden. Por favor revisa los datos.')
      setCreatingOrder(false)
    }
  }

  // Reset del formulario
  const handleReset = () => {
    setManualOrderData({
      customerId: '',
      customerPhone: '',
      customerName: '',
      selectedProducts: [],
      deliveryType: '',
      selectedLocation: null,
      customerLocations: [],
      timingType: 'immediate',
      scheduledDate: '',
      scheduledTime: '',
      paymentMethod: 'cash',
      selectedBank: '',
      paymentStatus: 'pending',
      cashAmount: 0,
      transferAmount: 0,
      total: 0,
      selectedDelivery: null,
      orderStatus: 'borrador',
      notas: '',
      notaImageUrl: '',
      receiptImageUrl: '',
      customDeliveryCost: null
    })
    setNotaImageFile(null)
    setNotaImagePreview('')
    setClientFound(false)
    setShowCreateClient(false)
    setIsEditingDeliveryCost(false)
    setTempDeliveryCost('')
  }

  const handleCancel = () => {
    handleReset()
    onClose()
  }

  // Determinar si la información requerida está completa
  const isInfoComplete = useMemo(() => {
    return (
      manualOrderData.customerName.trim() !== '' &&
      manualOrderData.customerPhone.trim() !== '' &&
      manualOrderData.selectedProducts.length > 0 &&
      manualOrderData.deliveryType !== '' &&
      (manualOrderData.timingType === 'immediate' || (manualOrderData.scheduledDate !== '' && manualOrderData.scheduledTime !== ''))
    );
  }, [manualOrderData.customerName, manualOrderData.customerPhone, manualOrderData.selectedProducts, manualOrderData.deliveryType, manualOrderData.timingType, manualOrderData.scheduledDate, manualOrderData.scheduledTime]);

  // Estado calculado para mostrar en la UI y guardar
  const computedStatus = useMemo(() => {
    if (!isInfoComplete) return 'borrador';
    if (manualOrderData.orderStatus === 'borrador') return 'confirmed';
    return manualOrderData.orderStatus;
  }, [isInfoComplete, manualOrderData.orderStatus]);

  const isTomorrowSelected = useMemo(() => {
    if (!manualOrderData.scheduledDate) return false
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const yyyy = tomorrow.getFullYear()
    const mm = String(tomorrow.getMonth() + 1).padStart(2, '0')
    const dd = String(tomorrow.getDate()).padStart(2, '0')
    const tomorrowStr = `${yyyy}-${mm}-${dd}`
    return manualOrderData.scheduledDate === tomorrowStr
  }, [manualOrderData.scheduledDate])

  if (!isOpen) return null

  return (
    <div 
      className="fixed inset-0 z-50 overflow-hidden"
      style={{ overscrollBehavior: 'contain', touchAction: 'pan-x pan-y' }}
    >
      <div className="absolute inset-0 bg-black bg-opacity-50" onClick={handleCancel}></div>

      <div 
        ref={sidebarRef}
        className="absolute right-0 top-0 h-full w-full max-w-lg bg-white shadow-xl flex flex-col"
        style={{ overscrollBehavior: 'contain', touchAction: 'pan-x pan-y' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">{mode === 'edit' ? 'Editar pedido' : 'Nuevo pedido'}</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCancel}
              className="p-2 hover:bg-gray-100 rounded-full"
            >
              <i className="bi bi-x-lg"></i>
            </button>
          </div>
        </div>

        {/* Content */}
        <div 
          className="flex-1 overflow-y-auto p-4 pb-24"
          style={{ overscrollBehavior: 'contain' }}
        >
          {showBusinessSelector && (
            <div className="mb-6">
              <label className="block text-sm font-medium text-black mb-2">
                Tienda
              </label>
              <div className="relative">
                <select
                  value={business?.id || ''}
                  onChange={(e) => {
                    setSelectedCategory('all')
                    setManualOrderData(prev => ({
                      ...prev,
                      selectedProducts: [],
                      deliveryType: '',
                      selectedLocation: null,
                      total: 0,
                      selectedDelivery: null
                    }))
                    onBusinessChange?.(e.target.value)
                  }}
                  className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 bg-white text-sm font-medium appearance-none cursor-pointer"
                >
                  <option value="">Selecciona una tienda</option>
                  {businessSelectorOptions.map(store => (
                    <option key={store.id} value={store.id}>
                      {store.name}
                    </option>
                  ))}
                </select>
                <i className="bi bi-chevron-down absolute right-3 top-2.5 text-gray-400 pointer-events-none"></i>
              </div>
              {loadingBusinessProducts && (
                <p className="mt-2 text-xs text-gray-500 flex items-center">
                  <span className="inline-block h-3 w-3 mr-2 rounded-full border-2 border-blue-200 border-t-blue-600 animate-spin"></span>
                  Cargando productos de la tienda...
                </p>
              )}
            </div>
          )}
          {/* Búsqueda de cliente */}
          <div className="mb-6">
            {!clientFound ? (
              <>
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-sm font-medium text-black">
                    Teléfono del cliente
                  </label>
                  {!showNameSearchModal && (
                    <button
                      type="button"
                      onClick={() => setShowNameSearchModal(true)}
                      className="text-xs text-blue-600 hover:text-blue-700 flex items-center bg-blue-50 px-2 py-1 rounded transition-colors"
                    >
                      <i className="bi bi-search me-1"></i>
                      Buscar por nombre
                    </button>
                  )}
                </div>

                {/* Expansión de búsqueda por nombre */}
                {showNameSearchModal && (
                  <div className="mb-3 p-3 border border-blue-200 bg-blue-50 rounded-md relative z-20">
                    <div className="flex justify-between items-center mb-2">
                      <label className="text-sm font-medium text-blue-800">
                        Búsqueda por nombre
                      </label>
                      <button
                        onClick={() => {
                          setShowNameSearchModal(false)
                          setNameSearchTerm('')
                          setShowSearchResults(false)
                        }}
                        className="text-blue-500 hover:text-blue-700 p-1"
                        type="button"
                      >
                        <i className="bi bi-x-lg"></i>
                      </button>
                    </div>
                    <div className="relative">
                      <input
                        type="text"
                        value={nameSearchTerm}
                        onChange={(e) => handleNameSearchDebounced(e.target.value)}
                        placeholder="Escriba el nombre a buscar..."
                        className="w-full px-3 py-2 border border-blue-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-sm"
                        autoFocus
                      />
                      {searchingClient && nameSearchTerm && (
                        <div className="absolute right-3 top-2.5">
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                        </div>
                      )}
                      {/* Dropdown de resultados de búsqueda por nombre */}
                      {showSearchResults && nameSearchTerm.length >= 2 && (
                        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-64 overflow-y-auto">
                          {searchResults.length > 0 ? (
                            searchResults.map((client) => (
                              <button
                                key={client.id}
                                onClick={() => {
                                  handleSelectClient(client)
                                  setShowNameSearchModal(false)
                                  setNameSearchTerm('')
                                }}
                                className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b last:border-b-0 transition-colors flex flex-col"
                                type="button"
                              >
                                <p className="font-medium text-gray-900 flex items-center gap-1.5">
                                  {client.nombres}
                                  {client.notas && (
                                    <i className="bi bi-exclamation-circle-fill text-amber-500 animate-pulse" title={`Nota: ${client.notas}`}></i>
                                  )}
                                </p>
                                <p className="text-xs text-gray-500">{client.celular}</p>
                              </button>
                            ))
                          ) : (
                            !searchingClient && (
                              <div className="p-3 text-center text-sm text-gray-500">
                                No se encontraron clientes
                              </div>
                            )
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div className="relative">
                  <div className="relative">
                    <input
                      type="tel"
                      value={manualOrderData.customerPhone}
                      onChange={(e) => {
                        const val = normalizePastedPhoneInput(e.target.value)
                        setManualOrderData(prev => ({ ...prev, customerPhone: val }))
                        handlePhoneSearchInstant(val)
                      }}
                      placeholder="Ej: 0912345678"
                      className="w-full px-3 py-2 pr-16 sm:pr-20 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 font-mono tracking-wide"
                      onPaste={(e) => {
                        e.preventDefault()
                        const text = e.clipboardData.getData('text') || ''
                        const normalizedPhone = normalizePastedPhoneInput(text)
                        
                        if (normalizedPhone) {
                          setManualOrderData(prev => ({ ...prev, customerPhone: normalizedPhone }))
                          handlePhoneSearchInstant(normalizedPhone)
                        }
                      }}
                    />
                    <div className="absolute right-0 top-0 h-full flex items-center space-x-1 pr-2">
                      <button
                        onClick={handlePasteFromClipboard}
                        className="p-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors flex-shrink-0"
                        type="button"
                        title="Pegar desde portapapeles"
                      >
                        <i className="bi bi-clipboard"></i>
                      </button>
                      {searchingClient && !showNameSearchModal && (
                        <div className="flex items-center justify-center w-6 h-6">
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Campo de nombre del cliente - solo visible cuando no se encuentra */}
                {showCreateClient && manualOrderData.customerPhone.length >= 9 && (
                  <div className="mt-3">
                    <input
                      type="text"
                      value={manualOrderData.customerName}
                      onChange={(e) => setManualOrderData(prev => ({ ...prev, customerName: e.target.value }))}
                      placeholder="Nombre del cliente"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                )}

                {showCreateClient && manualOrderData.customerPhone.length >= 9 && (
                  <div className="mt-2 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
                    <p className="text-sm text-yellow-800 mb-2">Cliente no encontrado. Llene el nombre para crearlo.</p>
                    <button
                      onClick={handleCreateClient}
                      disabled={creatingClient || !manualOrderData.customerName}
                      className="w-full bg-blue-600 text-white px-3 py-2 rounded-md text-sm hover:bg-blue-700 disabled:opacity-50"
                      type="button"
                    >
                      {creatingClient ? 'Creando...' : 'Crear Cliente'}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="mt-2 p-3 bg-gray-50 border border-gray-200 rounded-md transition-colors">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-800 flex items-center gap-1.5">
                      <span className="font-medium">{manualOrderData.customerName}</span>
                      {manualOrderData.customerNotes && (
                        <i className="bi bi-exclamation-circle-fill text-amber-500 animate-pulse cursor-help" title={`Nota: ${manualOrderData.customerNotes}`}></i>
                      )}
                    </p>
                    {manualOrderData.customerPhone && (
                      <p className="text-xs text-gray-500 opacity-85 font-mono tracking-wide">
                        {manualOrderData.customerPhone}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center space-x-1">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleViewClientInfo()
                      }}
                      className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors flex items-center justify-center"
                      title="Ver historial y datos"
                    >
                      <i className="bi bi-eye text-base"></i>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleEditClient()
                      }}
                      className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors flex items-center justify-center"
                      title="Editar cliente"
                    >
                      <i className="bi bi-pencil text-base"></i>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setClientFound(false)
                        setShowCreateClient(false)
                        setManualOrderData(prev => ({
                          ...prev,
                          customerId: '',
                          customerPhone: '',
                          customerName: '',
                          customerNotes: '',
                          customerLocations: [],
                          selectedLocation: null
                        }))
                      }}
                      className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors flex items-center justify-center"
                      title="Cambiar cliente"
                    >
                      <i className="bi bi-x-lg text-base"></i>
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-black">Productos</h3>
              {setActiveTab && setProfileSubTab && (
                <button
                  onClick={() => {
                    // Navegar como el DashboardSidebar
                    setActiveTab?.('profile')
                    setProfileSubTab?.('products')
                    onClose() // Cerrar el sidebar manual
                  }}
                  className="text-xs text-blue-600 hover:text-blue-700 flex items-center space-x-1 transition-colors"
                  title="Editar productos"
                >
                  <i className="bi bi-pencil-square"></i>
                  <span>Editar productos</span>
                </button>
              )}
            </div>

            {/* Filtro de categorías */}
            <div className="mb-3">
              <div className="flex gap-2 text-xs overflow-x-auto scrollbar-hide whitespace-nowrap pb-2">
                <button
                  onClick={() => setSelectedCategory('all')}
                  className={`px-2 py-1 rounded transition-colors flex-shrink-0 ${selectedCategory === 'all'
                    ? 'text-blue-600 font-medium'
                    : 'text-gray-600 hover:text-gray-800'
                    }`}
                >
                  Todos
                </button>
                {getBusinessCategories().map(category => (
                  <button
                    key={category}
                    onClick={() => setSelectedCategory(category)}
                    className={`px-2 py-1 rounded transition-colors flex-shrink-0 ${selectedCategory === category
                      ? 'text-blue-600 font-medium'
                      : 'text-gray-600 hover:text-gray-800'
                      }`}
                  >
                    {category}
                  </button>
                ))}
                <button
                  onClick={() => setSelectedCategory('hidden')}
                  className={`px-2 py-1 rounded transition-colors flex-shrink-0 ${selectedCategory === 'hidden'
                    ? 'text-blue-600 font-medium'
                    : 'text-gray-600 hover:text-gray-800'
                    }`}
                >
                  Ocultos
                </button>
              </div>
            </div>

            {!business?.id && showBusinessSelector ? (
              <div className="border border-dashed border-gray-300 rounded-lg p-4 text-center text-sm text-gray-500">
                Selecciona una tienda para ver sus productos.
              </div>
            ) : loadingBusinessProducts ? (
              <div className="border border-gray-200 rounded-lg p-4 text-center text-sm text-gray-500">
                Cargando productos...
              </div>
            ) : (
            <div className="grid grid-cols-4 gap-1 max-h-50 overflow-y-auto">
              {(() => {
                const filtered = selectedCategory === 'hidden'
                  ? products.filter(p => !p.isAvailable)
                  : getFilteredProducts().filter(p => p.isAvailable);

                return [
                  ...filtered.map((product) => (
                    <div
                      key={product.id}
                      className={`aspect-square p-1 border rounded-md hover:bg-gray-50 cursor-pointer transition-colors flex flex-col ${!product.isAvailable ? 'opacity-50 grayscale' : ''
                        }`}
                      onClick={() => handleSelectProduct(product)}
                    >
                      {/* Imagen del producto */}
                      <div className="w-full h-8 mb-1 bg-gray-200 rounded-md overflow-hidden flex-shrink-0">
                        {product.image ? (
                          <img
                            src={product.image}
                            alt={product.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <i className="bi bi-image text-gray-400 text-xs"></i>
                          </div>
                        )}
                      </div>

                      <div className="flex-1 flex flex-col justify-center text-center">
                        <p className="text-xs font-medium leading-tight mb-1 line-clamp-2">{product.name}</p>
                        {product.variants && product.variants.length > 0 ? (
                          <i className="bi bi-chevron-down text-xs text-blue-600"></i>
                        ) : (
                          <p className="text-xs text-gray-500">${product.price}</p>
                        )}
                      </div>
                    </div>
                  )),
                  // Tarjeta de producto personalizado
                  <div
                    key="custom-product"
                    className="aspect-square p-1 border-2 border-dashed border-blue-300 rounded-md hover:bg-blue-50 hover:border-blue-400 cursor-pointer transition-colors flex flex-col items-center justify-center"
                    onClick={() => setShowCustomProductModal(true)}
                  >
                    {/* Ícono en lugar de imagen */}
                    <div className="w-full h-8 mb-1 bg-blue-100 rounded-md overflow-hidden flex-shrink-0 flex items-center justify-center">
                      <i className="bi bi-plus-circle text-blue-500 text-sm"></i>
                    </div>

                    <div className="flex-1 flex flex-col justify-center text-center">
                      <p className="text-xs font-medium leading-tight text-blue-600">Personalizar</p>
                      <p className="text-xs text-blue-400">Producto</p>
                    </div>
                  </div>
                ];
              })()}
            </div>
            )}
          </div>

          {/* Productos seleccionados - siempre visible */
          }
          {manualOrderData.selectedProducts.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-medium text-black mb-3">Productos seleccionados</h3>
              <div className="space-y-2">
                {manualOrderData.selectedProducts.map((item, index) => (
                  <div key={index} className="flex items-center justify-between p-2 bg-gray-50 rounded-md">
                    <div className="flex-1">
                      <p className="text-sm font-medium">
                        {item.name}
                        {item.variant && <span className="text-xs text-blue-600 ml-2">({item.variant})</span>}
                      </p>
                      <p className="text-xs text-gray-500">${item.price} c/u</p>
                    </div>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => updateProductQuantity(index, item.quantity - 1)}
                        className="w-6 h-6 bg-gray-200 rounded-full flex items-center justify-center"
                      >
                        <i className="bi bi-dash text-xs"></i>
                      </button>
                      <span className="text-sm font-medium w-8 text-center">{item.quantity}</span>
                      <button
                        onClick={() => updateProductQuantity(index, item.quantity + 1)}
                        className="w-6 h-6 bg-gray-200 rounded-full flex items-center justify-center"
                      >
                        <i className="bi bi-plus text-xs"></i>
                      </button>
                      <button
                        onClick={() => removeProduct(index)}
                        className="w-6 h-6 bg-red-100 text-red-600 rounded-full flex items-center justify-center ml-2"
                      >
                        <i className="bi bi-trash text-xs"></i>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tipo de entrega - siempre visible */}
          <div className="mb-6">
            <h3 className="text-sm font-medium text-black mb-3">Tipo de entrega</h3>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setManualOrderData(prev => ({ ...prev, deliveryType: 'pickup' }))}
                className={`p-3 rounded-lg border-2 transition-all flex flex-col items-center space-y-1 ${manualOrderData.deliveryType === 'pickup'
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-gray-300 hover:border-gray-400'
                  }`}
              >
                <i className="bi bi-shop text-lg"></i>
                <span className="text-xs font-medium">Recoger en tienda</span>
              </button>

              <button
                type="button"
                onClick={handleDeliverySelect}
                className={`p-3 rounded-lg border-2 transition-all flex flex-col items-center space-y-1 ${manualOrderData.deliveryType === 'delivery'
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-gray-300 hover:border-gray-400'
                  }`}
              >
                <i className="bi bi-scooter text-lg"></i>
                <span className="text-xs font-medium">Delivery</span>
              </button>
            </div>
          </div>

          {/* Ubicaciones del cliente */}
          {manualOrderData.deliveryType === 'delivery' && (
            <div className="mb-6">
              <h3 className="text-sm font-medium text-black mb-3">Ubicación</h3>

              {(!manualOrderData.customerPhone || manualOrderData.customerPhone.length < 10) ? (
                <p className="text-sm text-gray-500">Ingresa un número de teléfono válido para gestionar ubicaciones</p>
              ) : manualOrderData.selectedLocation ? (
                <div
                  className="p-3 bg-green-50 border border-green-200 rounded-md mb-3 relative cursor-pointer hover:bg-green-100 transition-colors"
                  onClick={() => {
                    setShowLocationModal(true)
                    void reloadClientLocations()
                  }}
                >
                  {/* Información de la ubicación */}
                  <div className="flex justify-between items-center mb-2">
                    <div>
                      <p className="text-sm font-medium text-green-800">{manualOrderData.selectedLocation.referencia}</p>
                      <p className="text-xs text-green-600">Tarifa: ${parseFloat(manualOrderData.selectedLocation.tarifa)}</p>
                    </div>
                    <div className="text-green-600">
                      <i className="bi bi-chevron-down"></i>
                    </div>
                  </div>

                  {/* Mapa estático de la ubicación seleccionada */}
                  {manualOrderData.selectedLocation.latlong && (
                    <div className="w-full h-[76px] bg-gray-200 rounded-md overflow-hidden relative">
                      <img
                        src={`https://maps.googleapis.com/maps/api/staticmap?center=${manualOrderData.selectedLocation.latlong}&zoom=14&size=512x152&scale=2&maptype=roadmap&markers=color:red%7C${manualOrderData.selectedLocation.latlong}&key=${GOOGLE_MAPS_API_KEY}`}
                        alt="Ubicación en mapa"
                        className="w-full h-full object-cover"
                        loading="lazy"
                        decoding="async"
                        onError={(e) => {
                          const target = e.target as HTMLImageElement;
                          target.style.display = 'none';
                          const parent = target.parentElement;
                          if (parent) {
                            const fallback = parent.querySelector('.map-fallback') as HTMLElement;
                            if (fallback) {
                              fallback.style.display = 'flex';
                            }
                          }
                        }}
                      />
                      <div className="map-fallback absolute inset-0 hidden w-full h-full items-center justify-center bg-gray-200">
                        <i className="bi bi-geo-alt text-gray-400 text-lg"></i>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-gray-500 mb-3">No hay ubicación seleccionada</p>
              )}

              {!manualOrderData.selectedLocation && (
                <button
                  onClick={() => {
                    setShowLocationModal(true)
                    void reloadClientLocations()
                  }}
                  className="w-full p-3 rounded-lg border-2 border-gray-300 hover:border-gray-400 transition-all flex items-center justify-center space-x-2 text-gray-700"
                  disabled={!manualOrderData.customerPhone || manualOrderData.customerPhone.length < 10}
                >
                  <i className="bi bi-geo-alt"></i>
                  <span className="text-sm font-medium">Seleccionar ubicación</span>
                </button>
              )}
            </div>
          )}

          {/* Asignación de delivery - solo visible si es delivery */}
          {manualOrderData.deliveryType === 'delivery' && (
            <div className="mb-6">
              <h3 className="text-sm font-medium text-black mb-3">Asignar delivery</h3>

              {manualOrderData.selectedDelivery ? (
                <div
                  className={`p-3 bg-blue-50 border border-blue-200 rounded-md mb-3 relative transition-colors ${canChangeDelivery ? 'cursor-pointer hover:bg-blue-100' : ''}`}
                  onClick={() => canChangeDelivery && setShowDeliveryModal(true)}
                >
                  <div className="flex items-center space-x-3">
                    {/* Foto del delivery */}
                    {manualOrderData.selectedDelivery.fotoUrl && (
                      <div className="w-12 h-12 flex-shrink-0 rounded-full overflow-hidden bg-gray-200 relative">
                        <img
                          src={manualOrderData.selectedDelivery.fotoUrl}
                          alt={manualOrderData.selectedDelivery.nombres}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            const target = e.target as HTMLImageElement;
                            target.style.display = 'none';
                            const parent = target.parentElement;
                            if (parent) {
                              const fallback = parent.querySelector('.avatar-fallback') as HTMLElement;
                              if (fallback) {
                                fallback.style.display = 'flex';
                              }
                            }
                          }}
                        />
                        <div className="avatar-fallback absolute inset-0 hidden w-full h-full items-center justify-center bg-gray-200">
                          <i className="bi bi-person text-gray-400 text-lg"></i>
                        </div>
                      </div>
                    )}

                    <div className="flex-1">
                      <p className="text-sm font-medium text-blue-800">{manualOrderData.selectedDelivery.nombres}</p>
                      <p className="text-xs text-blue-600">{manualOrderData.selectedDelivery.celular}</p>
                    </div>

                    {canChangeDelivery && (
                      <div className="text-blue-600 flex-shrink-0">
                        <i className="bi bi-chevron-down"></i>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => canChangeDelivery && setShowDeliveryModal(true)}
                  className={`w-full p-3 rounded-lg border-2 transition-all flex items-center justify-center space-x-2 ${canChangeDelivery ? 'border-gray-300 hover:border-gray-400 text-gray-700' : 'border-gray-200 text-gray-400 cursor-not-allowed'}`}
                  disabled={!canChangeDelivery}
                >
                  <i className="bi bi-person-plus"></i>
                  <span className="text-sm font-medium">Asignar delivery</span>
                </button>
              )}
            </div>
          )}

          {/* Método de pago - siempre visible */}
          <div className="mb-6">
            <h3 className="text-sm font-medium text-black mb-3">Método de pago</h3>
            <div className="grid grid-cols-3 gap-2">
              <div
                role="button"
                onClick={() => {
                  if (manualOrderData.paymentMethod === 'cash') {
                    const statuses: ('pending' | 'validating' | 'paid')[] = ['paid', 'pending', 'validating'];
                    const currentIndex = statuses.indexOf(manualOrderData.paymentStatus);
                    const nextStatus = statuses[(currentIndex + 1) % statuses.length];
                    setManualOrderData(prev => ({ ...prev, paymentStatus: nextStatus }));
                  } else {
                    setManualOrderData(prev => ({
                      ...prev,
                      paymentMethod: 'cash',
                      paymentStatus: 'paid',
                      cashAmount: 0,
                      transferAmount: 0
                    }));
                  }
                }}
                className={`p-3 rounded-lg border-2 transition-all flex flex-col items-center space-y-1 cursor-pointer ${manualOrderData.paymentMethod === 'cash'
                  ? 'border-green-500 bg-green-50 text-green-700'
                  : 'border-gray-300 hover:border-gray-400'
                  }`}
              >
                <i className="bi bi-cash text-lg"></i>
                <span className="text-xs font-medium">Efectivo</span>
                {manualOrderData.paymentMethod === 'cash' && (
                  <span className="text-[10px] font-bold uppercase mt-1">
                    {manualOrderData.paymentStatus === 'paid' ? 'Pagado' : 
                     manualOrderData.paymentStatus === 'pending' ? 'Pendiente' : 
                     'Validando'}
                  </span>
                )}
              </div>

              <div
                role="button"
                onClick={() => {
                  if (manualOrderData.paymentMethod === 'transfer') {
                    const statuses: ('pending' | 'validating' | 'paid')[] = ['paid', 'pending', 'validating'];
                    const currentIndex = statuses.indexOf(manualOrderData.paymentStatus);
                    const nextStatus = statuses[(currentIndex + 1) % statuses.length];
                    setManualOrderData(prev => ({ ...prev, paymentStatus: nextStatus }));
                  } else {
                    setManualOrderData(prev => ({
                      ...prev,
                      paymentMethod: 'transfer',
                      paymentStatus: 'paid',
                      cashAmount: 0,
                      transferAmount: 0
                    }));
                  }
                }}
                className={`p-3 rounded-lg border-2 transition-all flex flex-col items-center space-y-1 cursor-pointer ${manualOrderData.paymentMethod === 'transfer'
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-gray-300 hover:border-gray-400'
                  }`}
              >
                <i className="bi bi-bank text-lg"></i>
                <span className="text-xs font-medium">Transferencia</span>
                {manualOrderData.paymentMethod === 'transfer' && (
                  <div className="flex flex-col items-center mt-1">
                    <span className="text-[10px] font-bold uppercase">
                      {manualOrderData.paymentStatus === 'paid' ? 'Pagado' : 
                       manualOrderData.paymentStatus === 'pending' ? 'Pendiente' : 
                       'Validando'}
                    </span>
                    {manualOrderData.receiptImageUrl && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          window.open(manualOrderData.receiptImageUrl, '_blank');
                        }}
                        className="mt-1 text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded hover:bg-blue-200 transition-colors flex items-center gap-1"
                        title="Ver comprobante"
                      >
                        <i className="bi bi-image"></i>
                        Ver Recibo
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div
                role="button"
                onClick={() => setManualOrderData(prev => ({
                  ...prev,
                  paymentMethod: 'mixed',
                  cashAmount: prev.total / 2,
                  transferAmount: prev.total / 2
                }))}
                className={`p-3 rounded-lg border-2 transition-all flex flex-col items-center space-y-1 cursor-pointer ${manualOrderData.paymentMethod === 'mixed'
                  ? 'border-purple-500 bg-purple-50 text-purple-700'
                  : 'border-gray-300 hover:border-gray-400'
                  }`}
              >
                <i className="bi bi-cash-coin text-lg"></i>
                <span className="text-xs font-medium">Mixto</span>
                {manualOrderData.paymentMethod === 'mixed' && manualOrderData.receiptImageUrl && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      window.open(manualOrderData.receiptImageUrl, '_blank');
                    }}
                    className="mt-1 text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded hover:bg-purple-200 transition-colors flex items-center gap-1"
                    title="Ver comprobante"
                  >
                    <i className="bi bi-image"></i>
                    Ver Recibo
                  </button>
                )}
              </div>
            </div>

            {/* Configuración de Pago Mixto */}
            {manualOrderData.paymentMethod === 'mixed' && (
              <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                <h5 className="text-sm font-medium text-yellow-800 mb-3">
                  <i className="bi bi-calculator me-1"></i>
                  Distribución del Pago
                </h5>
                <div className="space-y-2">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Monto en Efectivo
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      value={manualOrderData.cashAmount || ''}
                      onChange={(e) => {
                        const cash = parseFloat(e.target.value) || 0;
                        const total = manualOrderData.total;
                        const transfer = Math.max(0, total - cash);
                        setManualOrderData(prev => ({
                          ...prev,
                          cashAmount: cash,
                          transferAmount: transfer
                        }));
                      }}
                      className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Monto por Transferencia
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      value={manualOrderData.transferAmount || ''}
                      onChange={(e) => {
                        const transfer = parseFloat(e.target.value) || 0;
                        const total = manualOrderData.total;
                        const cash = Math.max(0, total - transfer);
                        setManualOrderData(prev => ({
                          ...prev,
                          cashAmount: cash,
                          transferAmount: transfer
                        }));
                      }}
                      className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                </div>
                <div className="mt-3 text-xs text-gray-600 bg-white p-2 rounded border">
                  <div className="flex justify-between">
                    <span>Total del pedido:</span>
                    <span className="font-medium">${manualOrderData.total.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-green-600">
                    <span>Efectivo:</span>
                    <span>${(manualOrderData.cashAmount || 0).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-blue-600">
                    <span>Transferencia:</span>
                    <span>${(manualOrderData.transferAmount || 0).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between font-medium border-t pt-1 mt-1">
                    <span>Suma:</span>
                    <span className={
                      Math.abs((manualOrderData.cashAmount || 0) + (manualOrderData.transferAmount || 0) - manualOrderData.total) < 0.01
                        ? 'text-green-600'
                        : 'text-red-600'
                    }>
                      ${((manualOrderData.cashAmount || 0) + (manualOrderData.transferAmount || 0)).toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Timing - siempre visible */}
          <div className="mb-6">
            <h3 className="text-sm font-medium text-black mb-3">Programación</h3>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <button
                type="button"
                onClick={() => setManualOrderData(prev => ({ ...prev, timingType: 'immediate' }))}
                className={`p-3 rounded-lg border-2 transition-all flex flex-col items-center space-y-1 ${manualOrderData.timingType === 'immediate'
                  ? 'border-orange-500 bg-orange-50 text-orange-700'
                  : 'border-gray-300 hover:border-gray-400'
                  }`}
              >
                <i className="bi bi-lightning-fill text-lg"></i>
                <span className="text-xs font-medium">Inmediato</span>
                <span className="text-[10px] opacity-70">Aprox {business?.deliveryTime || 30} min</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  const { date, time } = getInitialScheduledDateTime()
                  setManualOrderData(prev => ({
                    ...prev,
                    timingType: 'scheduled',
                    scheduledDate: date,
                    scheduledTime: time
                  }))
                }}
                className={`p-3 rounded-lg border-2 transition-all flex flex-col items-center space-y-1 ${manualOrderData.timingType === 'scheduled'
                  ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                  : 'border-gray-300 hover:border-gray-400'
                  }`}
              >
                <i className="bi bi-calendar-event text-lg"></i>
                <span className="text-xs font-medium">Programado</span>
              </button>
            </div>

            {manualOrderData.timingType === 'scheduled' && (
              <div className="space-y-2">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Fecha
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="date"
                      value={manualOrderData.scheduledDate}
                      onChange={(e) => setManualOrderData(prev => ({ ...prev, scheduledDate: e.target.value }))}
                      className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const tomorrow = new Date()
                        tomorrow.setDate(tomorrow.getDate() + 1)
                        const yyyy = tomorrow.getFullYear()
                        const mm = String(tomorrow.getMonth() + 1).padStart(2, '0')
                        const dd = String(tomorrow.getDate()).padStart(2, '0')
                        setManualOrderData(prev => ({ ...prev, scheduledDate: `${yyyy}-${mm}-${dd}` }))
                      }}
                      className={`px-3 py-1 text-xs font-semibold rounded border transition-all duration-200 cursor-pointer ${
                        isTomorrowSelected
                          ? 'bg-blue-600 border-blue-600 text-white hover:bg-blue-700'
                          : 'bg-gray-100 border-gray-300 text-gray-700 hover:bg-gray-200 hover:text-gray-900'
                      }`}
                    >
                      Mañana
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Hora
                  </label>
                  <input
                    type="time"
                    value={manualOrderData.scheduledTime}
                    onChange={(e) => setManualOrderData(prev => ({ ...prev, scheduledTime: e.target.value }))}
                    className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Resumen - siempre visible */}
          <div className="mb-6 p-3 bg-gray-50 rounded-md">
            <h3 className="text-sm font-medium text-black mb-2">Resumen</h3>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span>Subtotal:</span>
                <span>${manualOrderData.selectedProducts.reduce((sum, item) => sum + (item.price * item.quantity), 0).toFixed(2)}</span>
              </div>
              {manualOrderData.deliveryType === 'delivery' && (
                <div className="flex justify-between items-center py-0.5">
                  <span>Envío:</span>
                  {isEditingDeliveryCost ? (
                    <div className="flex items-center gap-1.5">
                      <span className="text-gray-500 text-xs font-semibold">$</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={tempDeliveryCost}
                        onChange={(e) => {
                          const val = e.target.value
                          if (val === '' || /^[0-9]*\.?[0-9]*$/.test(val)) {
                            setTempDeliveryCost(val)
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            handleSaveDeliveryCost()
                          } else if (e.key === 'Escape') {
                            setIsEditingDeliveryCost(false)
                          }
                        }}
                        className="w-16 px-1.5 py-0.5 text-xs text-right border border-blue-400 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white font-medium text-gray-800"
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={handleSaveDeliveryCost}
                        className="text-green-600 hover:text-green-800 transition-colors p-0.5 flex items-center justify-center"
                        title="Guardar"
                      >
                        <i className="bi bi-check-lg text-sm font-bold"></i>
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsEditingDeliveryCost(false)}
                        className="text-red-500 hover:text-red-700 transition-colors p-0.5 flex items-center justify-center"
                        title="Cancelar"
                      >
                        <i className="bi bi-x-lg text-sm font-bold"></i>
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 group">
                      <span>
                        ${(manualOrderData.customDeliveryCost !== null && manualOrderData.customDeliveryCost !== undefined
                          ? manualOrderData.customDeliveryCost
                          : (manualOrderData.selectedLocation ? parseFloat(manualOrderData.selectedLocation.tarifa) : 1.25)
                        ).toFixed(2)}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          const currentCost = manualOrderData.customDeliveryCost !== null && manualOrderData.customDeliveryCost !== undefined
                            ? manualOrderData.customDeliveryCost
                            : (manualOrderData.selectedLocation ? parseFloat(manualOrderData.selectedLocation.tarifa) : 1.25)
                          setTempDeliveryCost(currentCost.toString())
                          setIsEditingDeliveryCost(true)
                        }}
                        className="text-gray-400 hover:text-blue-600 transition-colors ml-1.5 p-0.5 rounded cursor-pointer flex items-center justify-center"
                        title="Editar costo de envío"
                      >
                        <i className="bi bi-pencil-fill text-[10px]"></i>
                      </button>
                    </div>
                  )}
                </div>
              )}
              <div className="flex justify-between font-medium border-t pt-1">
                <span>Total:</span>
                <span>${manualOrderData.total.toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* Notas - Collapsible */}
          <div className="mb-6">
            <button
              type="button"
              onClick={() => setShowNotasField(!showNotasField)}
              className="w-full flex items-center justify-between p-4 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg hover:border-blue-300 hover:from-blue-100 hover:to-indigo-100 transition-all duration-200 shadow-sm"
            >
              <span className="text-sm font-semibold text-blue-900 flex items-center gap-2">
                <i className={`bi bi-${showNotasField ? 'chevron-up' : 'note-heart'} text-blue-600`}></i>
                {showNotasField ? 'Ocultar notas' : 'Agregar notas y adjuntos'}
              </span>
            </button>
            
            {showNotasField && (
              <div className="mt-4 space-y-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                    <i className="bi bi-pencil-square text-blue-600"></i>
                    Notas del pedido
                  </label>
                  <textarea
                    value={manualOrderData.notas}
                    onChange={(e) => setManualOrderData(prev => ({ ...prev, notas: e.target.value }))}
                    placeholder="Agregua notas adicionales, instrucciones especiales, etc..."
                    rows={3}
                    className="w-full px-3 py-2 border border-blue-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none bg-white text-gray-700 placeholder-gray-400"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                    <i className="bi bi-image text-blue-600"></i>
                    Imagen para ticket
                  </label>
                  {!(notaImagePreview || manualOrderData.notaImageUrl) && (
                    <div className="border-2 border-dashed border-blue-300 rounded-lg p-4 bg-white hover:bg-blue-50 transition-colors">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          if (!file) return
                          if (!file.type.startsWith('image/')) {
                            alert('Selecciona un archivo de imagen')
                            return
                          }
                          setNotaImageFile(file)
                          setNotaImagePreview(URL.createObjectURL(file))
                          setManualOrderData(prev => ({ ...prev, notaImageUrl: '' }))
                        }}
                        className="block w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-blue-600 file:text-white file:font-medium hover:file:bg-blue-700 cursor-pointer"
                      />
                      <p className="text-xs text-gray-500 mt-2 text-center">Arrastra aquí o haz clic para seleccionar</p>
                    </div>
                  )}

                  {(notaImagePreview || manualOrderData.notaImageUrl) && (
                    <div className="mt-4 p-3 bg-white rounded-lg border border-blue-200">
                      <div className="flex justify-end mb-3">
                        <button
                          type="button"
                          onClick={() => {
                            setNotaImageFile(null)
                            setNotaImagePreview('')
                            setManualOrderData(prev => ({ ...prev, notaImageUrl: '' }))
                          }}
                          className="text-xs font-medium text-red-600 hover:text-red-700 hover:bg-red-50 px-2 py-1 rounded transition-colors"
                        >
                          <i className="bi bi-trash mr-1"></i>Quitar
                        </button>
                      </div>
                      <img
                        src={notaImagePreview || manualOrderData.notaImageUrl}
                        alt="Imagen de nota"
                        className="w-full h-auto max-h-48 object-contain rounded-lg border border-gray-200 bg-gray-50"
                      />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Mensaje de validación para pago mixto */}
          {manualOrderData.paymentMethod === 'mixed' && Math.abs((manualOrderData.cashAmount || 0) + (manualOrderData.transferAmount || 0) - manualOrderData.total) >= 0.01 && (
            <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-sm text-red-600 flex items-center">
                <i className="bi bi-exclamation-triangle me-2"></i>
                La suma de efectivo y transferencia debe ser igual al total del pedido.
              </p>
            </div>
          )}
        </div>

        {/* Footer fijo */}
        <div className="absolute bottom-0 left-0 right-0 bg-white border-t p-4">
          <div className="flex space-x-3">
            <button
              onClick={handleCancel}
              className="flex-1 bg-gray-500 text-white py-2 px-4 rounded-md hover:bg-gray-600 transition-colors"
            >
              Cancelar
            </button>
            {/* single save button kept below */}
            <button
              onClick={handleSubmitOrder}
              disabled={
                creatingOrder ||
                (showBusinessSelector && !business?.id) ||
                loadingBusinessProducts ||
                (manualOrderData.paymentMethod === 'mixed' && Math.abs((manualOrderData.cashAmount || 0) + (manualOrderData.transferAmount || 0) - manualOrderData.total) >= 0.01)
              }
              className="flex-1 bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {creatingOrder ? 'Guardando...' : 'Guardar Pedido'}
            </button>

          </div>
        </div>

        {/* Modal de variantes y personalización */}
        {isVariantModalOpen && selectedProductForVariants && (
          <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center z-10">
            <div 
              className="bg-white rounded-lg p-6 max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto shadow-xl"
              style={{ overscrollBehavior: 'contain' }}
            >
              <h3 className="text-lg font-bold mb-1 text-gray-900">Personalizar producto</h3>
              <p className="text-sm font-semibold text-gray-600 mb-4">{selectedProductForVariants.name}</p>

              {/* 1. SECCIÓN DE COMBO */}
              {selectedProductForVariants.isCombo ? (
                <div className="mb-6">
                  <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Arma tu combo</h4>
                  <div className="space-y-3">
                    {selectedProductForVariants.variants?.filter(v => v.isAvailable !== false).map((variant) => {
                      const qty = comboSelection[variant.name] || 0;
                      return (
                        <div key={variant.id || variant.name} className="flex items-center justify-between p-3 border rounded-lg bg-gray-50 border-gray-200">
                          <div className="flex-1 min-w-0 pr-2">
                            <span className="font-semibold text-sm text-gray-800 block">{variant.name}</span>
                            {variant.description && <p className="text-xs text-gray-500 line-clamp-1 mt-0.5">{variant.description}</p>}
                            <span className="text-xs font-bold text-blue-600 mt-1 block">${getProductPublicPrice(variant).toFixed(2)}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setComboSelection(prev => ({ ...prev, [variant.name]: Math.max(0, qty - 1) }))}
                              className="w-8 h-8 flex items-center justify-center bg-white border border-gray-300 rounded text-gray-600 hover:bg-gray-100 font-bold"
                            >
                              <i className="bi bi-dash"></i>
                            </button>
                            <span className="text-sm font-bold w-4 text-center">{qty}</span>
                            <button
                              type="button"
                              onClick={() => setComboSelection(prev => ({ ...prev, [variant.name]: qty + 1 }))}
                              className="w-8 h-8 flex items-center justify-center bg-white border border-gray-300 rounded text-gray-600 hover:bg-gray-100 font-bold"
                            >
                              <i className="bi bi-plus"></i>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                /* 2. SECCIÓN DE VARIANTES (Solo si no es combo) */
                selectedProductForVariants.variants && selectedProductForVariants.variants.length > 0 && (
                  <div className="mb-6">
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Selecciona una opción</h4>
                    <div className="space-y-2">
                      {selectedProductForVariants.variants.filter(v => v.isAvailable !== false).map((variant) => {
                        const isSelected = selectedVariant?.name === variant.name;
                        return (
                          <label
                            key={variant.id || variant.name}
                            className={`flex items-center justify-between p-3 border rounded-lg cursor-pointer transition-all hover:bg-gray-50 ${
                              isSelected ? 'border-blue-500 bg-blue-50/20' : 'border-gray-200 bg-white'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <input
                                type="radio"
                                name="modal-variant-selection"
                                checked={isSelected}
                                onChange={() => setSelectedVariant(variant)}
                                className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                              />
                              <span className="text-sm font-semibold text-gray-800">{variant.name}</span>
                            </div>
                            <span className="text-sm font-bold text-blue-600">${getProductPublicPrice(variant).toFixed(2)}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )
              )}

              {/* 3. SECCIÓN DE MODIFICADORES / OPCIONES */}
              {selectedProductForVariants.optionGroups && selectedProductForVariants.optionGroups.length > 0 && (
                <div className="space-y-6 mb-6">
                  {selectedProductForVariants.optionGroups.map((group) => {
                    const selections = selectedOptions[group.id] || [];
                    const isGroupAtMax = selections.length >= group.maxSelect;
                    return (
                      <div key={group.id} className="border-t border-gray-100 pt-4">
                        <div className="flex justify-between items-center mb-3">
                          <div>
                            <h4 className="text-sm font-bold text-gray-800 leading-tight">{group.name}</h4>
                            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mt-0.5">
                              {group.minSelect > 0
                                ? `Obligatorio · Elige ${group.minSelect === group.maxSelect ? group.minSelect : `de ${group.minSelect} a ${group.maxSelect}`}`
                                : `Opcional · Elige hasta ${group.maxSelect}`}
                            </p>
                          </div>
                          {selections.length > 0 && (
                            <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-bold">
                              {selections.length}/{group.maxSelect}
                            </span>
                          )}
                        </div>
                        <div className="space-y-2">
                          {group.options.map((opt) => {
                            const isSelected = selections.some(s => s.name === opt.name);
                            const disabled = !isSelected && isGroupAtMax;
                            return (
                              <label
                                key={opt.name}
                                className={`flex items-center justify-between p-3 border rounded-lg cursor-pointer transition-all ${
                                  isSelected
                                    ? 'border-blue-500 bg-blue-50/20'
                                    : disabled
                                    ? 'border-gray-100 bg-gray-50/30 opacity-60 cursor-not-allowed'
                                    : 'border-gray-200 bg-white hover:bg-gray-50'
                                }`}
                              >
                                <div className="flex items-center gap-3">
                                  <input
                                    type={group.maxSelect === 1 ? 'radio' : 'checkbox'}
                                    name={`option-group-${group.id}`}
                                    checked={isSelected}
                                    disabled={disabled}
                                    onChange={() => {
                                      if (group.maxSelect === 1) {
                                        setSelectedOptions(prev => ({
                                          ...prev,
                                          [group.id]: [{ name: opt.name, price: opt.price }]
                                        }))
                                      } else {
                                        setSelectedOptions(prev => {
                                          const current = prev[group.id] || []
                                          const exists = current.some(s => s.name === opt.name)
                                          let updated
                                          if (exists) {
                                            updated = current.filter(s => s.name !== opt.name)
                                          } else {
                                            if (current.length >= group.maxSelect) return prev
                                            updated = [...current, { name: opt.name, price: opt.price }]
                                          }
                                          return { ...prev, [group.id]: updated }
                                        })
                                      }
                                    }}
                                    className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500 rounded"
                                  />
                                  <span className="text-sm font-semibold text-gray-800">{opt.name}</span>
                                </div>
                                {opt.price > 0 && (
                                  <span className="text-xs font-bold text-gray-600">+${opt.price.toFixed(2)}</span>
                                )}
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* 4. SELECTOR DE CANTIDAD GENERAL (Solo si no es combo) */}
              {!selectedProductForVariants.isCombo && (
                <div className="flex items-center justify-between border-t border-gray-100 pt-4 mb-6">
                  <span className="text-sm font-bold text-gray-700">Cantidad</span>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setCustomizingQuantity(q => Math.max(1, q - 1))}
                      className="w-8 h-8 flex items-center justify-center bg-gray-100 hover:bg-gray-200 border border-gray-300 rounded text-gray-600 font-bold"
                    >
                      <i className="bi bi-dash"></i>
                    </button>
                    <span className="text-sm font-bold w-6 text-center">{customizingQuantity}</span>
                    <button
                      type="button"
                      onClick={() => setCustomizingQuantity(q => q + 1)}
                      className="w-8 h-8 flex items-center justify-center bg-gray-100 hover:bg-gray-200 border border-gray-300 rounded text-gray-600 font-bold"
                    >
                      <i className="bi bi-plus"></i>
                    </button>
                  </div>
                </div>
              )}

              {/* 5. RESUMEN DE TOTAL Y ACCIONES */}
              <div className="flex items-center gap-3 border-t border-gray-100 pt-4">
                <div className="flex-1">
                  <span className="text-[10px] text-gray-400 font-bold block uppercase tracking-wider mb-0.5">Total</span>
                  <span className="text-xl font-black text-red-600">${currentCustomizedTotalPrice.toFixed(2)}</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIsVariantModalOpen(false);
                    setSelectedProductForVariants(null);
                    setSelectedVariant(null);
                    setComboSelection({});
                    setSelectedOptions({});
                    setCustomizingQuantity(1);
                  }}
                  className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-md font-bold text-xs uppercase tracking-wider tracking-widest transition-colors border border-gray-300"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={addCustomizedProductToOrder}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-bold text-xs uppercase tracking-wider tracking-widest transition-colors shadow-sm"
                >
                  Agregar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Modal de ubicaciones */}
      {showLocationModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div 
            className="bg-white rounded-lg p-6 w-full max-w-md max-h-[80vh] overflow-y-auto"
            style={{ overscrollBehavior: 'contain' }}
          >
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">
                {showNewLocationForm ? 'Nueva ubicación' : 'Seleccionar ubicación'}
              </h3>
              <div className="flex items-center gap-2">
                {showNewLocationForm && (
                  <button
                    type="button"
                    onClick={() => handleSuperPaste(false)}
                    className="h-8 w-8 flex items-center justify-center bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-md border border-blue-100 transition-all cursor-pointer shadow-sm"
                    title="Pegar datos de WhatsApp"
                  >
                    <i className="bi bi-clipboard-plus text-sm"></i>
                  </button>
                )}
                <button
                  onClick={() => {
                    setShowLocationModal(false);
                    setShowNewLocationForm(false);
                    setNewLocationData({
                      referencia: '',
                      tarifa: '1',
                      latlong: '',
                      photo: '',
                      sector: ''
                    });
                    setShowMapSelection(false);
                    setLocationImageFile(null);
                    setLocationImagePreview('');
                  }}
                  className="text-gray-500 hover:text-gray-700 p-1 rounded hover:bg-gray-100 transition-colors"
                >
                  <i className="bi bi-x-lg"></i>
                </button>
              </div>
            </div>

            {!showNewLocationForm ? (
              <div>
                {/* Lista de ubicaciones existentes */}
                {loadingClientLocations ? (
                  <div className="text-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                    <p className="text-sm text-gray-500 mt-2">Cargando ubicaciones...</p>
                  </div>
                ) : manualOrderData.customerLocations.length > 0 ? (
                  <div className="space-y-3 mb-4">
                    {manualOrderData.customerLocations.map((location) => (
                      <label key={location.id} className="flex items-start p-3 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer">
                        <input
                          type="radio"
                          name="selectedLocation"
                          checked={manualOrderData.selectedLocation?.id === location.id}
                          onChange={async () => {
                            // Forzar la recarga siempre, incluso si ya está seleccionada
                            // Esto permite actualizar los datos después de editar una ubicación
                            if (manualOrderData.selectedLocation?.id === location.id) {
                              // Si es la misma ubicación, forzar recarga de todos modos
                              console.log('[ManualOrder] Re-selecting location to refresh data:', location.id);
                            }
                            console.log('[ManualOrder] Selected location:', {
                              id: location.id,
                              referencia: location.referencia,
                              latlong: location.latlong,
                              tarifa: location.tarifa,
                              hasPhoto: !!location.photo,
                              photoValue: location.photo
                            })
                            
                            // Si hay coordenadas, calcular la tarifa automáticamente
                            if (location.latlong) {
                              setCalculatingTariff(true)
                              try {
                                const [lat, lng] = location.latlong.split(',').map(coord => parseFloat(coord.trim()))
                                if (!isNaN(lat) && !isNaN(lng)) {
                                  const { fee, zoneName } = await calculateDeliveryFee({ lat, lng })
                                  
                                  // Normalizar tarifa fuera de cobertura: si calculatedFee es 0, usar 1.50
                                  const normalizedFee = fee === 0 ? 1.5 : fee
                                  
                                  const updatedLocation = { ...location, tarifa: normalizedFee.toString(), sector: zoneName }
                                  setManualOrderData(prev => ({ ...prev, selectedLocation: updatedLocation }));
                                  setShowLocationModal(false);
                                  calculateTotal(manualOrderData.selectedProducts);
                                  findDeliveryForLocation(updatedLocation);
                                  return;
                                }
                              } catch (error) {
                                console.error('Error calculating delivery fee:', error)
                              } finally {
                                setCalculatingTariff(false)
                              }
                            }
                            
                            // Fallback: si no hay coordenadas o falló el cálculo, usar $1.25 por defecto
                            const locationWithDefaultTariff = { ...location, tarifa: '1.25' };
                            setManualOrderData(prev => ({ ...prev, selectedLocation: locationWithDefaultTariff }));
                            setShowLocationModal(false);
                            calculateTotal(manualOrderData.selectedProducts);
                            findDeliveryForLocation(locationWithDefaultTariff);
                          }}
                          className="mr-3 mt-1 flex-shrink-0"
                        />

                        {/* Mapa estático */}
                        {location.latlong && (
                          <a
                            href={
                              location.latlong.startsWith('pluscode:')
                                ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location.latlong.replace('pluscode:', ''))}`
                                : `https://www.google.com/maps/search/?api=1&query=${location.latlong}`
                            }
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="w-16 h-16 mr-3 flex-shrink-0 bg-gray-200 rounded-md overflow-hidden relative block hover:opacity-80 transition-opacity"
                            title="Abrir en Google Maps"
                          >
                            <img
                              src={`https://maps.googleapis.com/maps/api/staticmap?center=${location.latlong}&zoom=13&size=64x64&maptype=roadmap&markers=color:red%7C${location.latlong}&key=${GOOGLE_MAPS_API_KEY}`}
                              alt="Ubicación en mapa"
                              className="w-full h-full object-cover"
                              loading="lazy"
                              decoding="async"
                              onError={(e) => {
                                // Si falla la carga del mapa, ocultar la imagen y mostrar el ícono
                                const target = e.target as HTMLImageElement;
                                target.style.display = 'none';
                                const parent = target.parentElement;
                                if (parent) {
                                  const fallback = parent.querySelector('.map-fallback') as HTMLElement;
                                  if (fallback) {
                                    fallback.style.display = 'flex';
                                  }
                                }
                              }}
                            />
                            <div className="map-fallback absolute inset-0 hidden w-full h-full flex items-center justify-center bg-gray-200">
                              <i className="bi bi-geo-alt text-gray-400 text-lg"></i>
                            </div>
                          </a>
                        )}

                        {/* Foto de ubicación */}
                        {location.photo && (
                          <div className="w-16 h-16 mr-3 flex-shrink-0 bg-gray-200 rounded-md overflow-hidden relative">
                            <img
                              src={location.photo}
                              alt="Foto de ubicación"
                              className="w-full h-full object-cover"
                              loading="lazy"
                              decoding="async"
                            />
                          </div>
                        )}

                        <div className="flex-1">
                          <p className="text-sm font-medium text-gray-900">{location.referencia}</p>
                        </div>
                        <div className="ml-3 flex flex-col items-end gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEditLocation(location as ClientLocation);
                            }}
                            className="text-sm text-blue-600 hover:text-blue-700 p-1"
                            type="button"
                          >
                            <i className="bi bi-pencil"></i>
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteLocation(location.id);
                            }}
                            className="text-sm text-red-600 hover:text-red-700 p-1"
                            type="button"
                          >
                            <i className="bi bi-trash"></i>
                          </button>
                        </div>
                      </label>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <i className="bi bi-geo-alt text-gray-400 text-4xl mb-3"></i>
                    <p className="text-sm text-gray-500 mb-4">No hay ubicaciones registradas para este cliente</p>
                  </div>
                )}

                {/* Botones de acción */}
                <div className="flex space-x-3">
                  <button
                    onClick={() => setShowNewLocationForm(true)}
                    className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 transition-colors"
                  >
                    <i className="bi bi-plus-lg mr-2"></i>
                    Nueva ubicación
                  </button>
                </div>
              </div>
            ) : (
              /* Formulario para nueva ubicación */
              <div>



                <div className="space-y-4">
                  {/* Referencia */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Referencia *
                    </label>
                    <textarea
                      value={newLocationData.referencia}
                      onChange={(e) => setNewLocationData(prev => ({ ...prev, referencia: e.target.value }))}
                      placeholder="Ej: Casa rosada esquinera, junto al parque central..."
                      rows={3}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 resize-vertical"
                    />
                  </div>

                  {/* Ubicación (Enlace, Coordenadas o Plus Code) */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Ubicación (Enlace, Coordenadas o Plus Code)
                    </label>
                    <div className="flex items-center w-full border border-gray-300 rounded-lg focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500 bg-white overflow-hidden shadow-sm group">
                      <input
                        type="text"
                        value={newLocationData.latlong}
                        onChange={(e) => handleLocationInputChange(e.target.value)}
                        placeholder="Enlace de Maps, -1.8613, -79.9749 o 42W9+246"
                        className="flex-1 px-3 py-2.5 min-w-0 bg-transparent border-none focus:ring-0 text-sm outline-none"
                      />
                      <div className="flex gap-1 pr-1.5 pl-1 py-1 border-l border-gray-100 bg-gray-50/30 group-focus-within:bg-white transition-colors">
                        <button
                          onClick={() => setShowMapSelection(!showMapSelection)}
                          className={`h-8 w-8 flex items-center justify-center rounded-md transition-all duration-200 ${showMapSelection ? 'bg-gray-800 text-white shadow-inner' : 'bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-900'}`}
                          type="button"
                          title="Seleccionar en mapa"
                        >
                          <i className={`bi ${showMapSelection ? 'bi-map-fill' : 'bi-map'} text-sm`}></i>
                        </button>
                        <button
                          onClick={handlePasteLocationFromClipboard}
                          className="h-8 w-8 flex items-center justify-center bg-gray-100 text-gray-500 rounded-md hover:bg-gray-200 hover:text-gray-900 transition-all duration-200"
                          type="button"
                          title="Pegar desde portapapeles"
                        >
                          <i className="bi bi-clipboard text-sm"></i>
                        </button>
                      </div>
                    </div>

                    {/* Selector de Mapa */}
                    {showMapSelection && (
                      <div className="mt-3 space-y-2 animate-fadeIn">
                        <div className="h-64 rounded-xl overflow-hidden border border-gray-300 relative bg-gray-50">
                          {(() => {
                            let lat = -1.861343;
                            let lng = -79.974945;
                            if (newLocationData.latlong && !newLocationData.latlong.startsWith('pluscode:')) {
                              const parts = newLocationData.latlong.split(',').map(p => parseFloat(p.trim()));
                              if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
                                lat = parts[0];
                                lng = parts[1];
                              }
                            }
                            return (
                              <GoogleMap
                                latitude={lat}
                                longitude={lng}
                                fixedCenterMarker={true}
                                onLocationChange={handleMapLocationChange}
                                height="100%"
                                zoom={17}
                              />
                            );
                          })()}
                          <button
                            type="button"
                            onClick={getCurrentGpsLocation}
                            disabled={isRequestingLocation}
                            className="absolute bottom-4 right-4 bg-white p-2 rounded-full shadow-lg text-gray-700 hover:bg-gray-100 transition-all z-20 disabled:bg-gray-100 disabled:text-gray-400"
                            title="Mi ubicación actual"
                          >
                            {isRequestingLocation ? (
                              <div className="w-5 h-5 border-2 border-gray-400 border-t-gray-800 rounded-full animate-spin"></div>
                            ) : (
                              <i className="bi bi-crosshair text-xl"></i>
                            )}
                          </button>
                        </div>
                      </div>
                    )}

                                      </div>
                  {/* Vista previa del mapa estático */}
                  {newLocationData.latlong && !showMapSelection && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Vista previa de ubicación
                      </label>
                      <div className="w-full h-48 bg-gray-200 rounded-md overflow-hidden">
                        {newLocationData.latlong.startsWith('pluscode:') ? (
                          <a
                            href={`https://www.google.com/maps/pluscodes/${newLocationData.latlong.replace('pluscode:', '')}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="w-full h-full flex flex-col items-center justify-center bg-blue-50 hover:bg-blue-100 transition-colors"
                          >
                            <i className="bi bi-geo-alt text-blue-500 text-3xl mb-2"></i>
                            <p className="text-blue-700 font-medium">Ver en Google Maps</p>
                            <p className="text-sm text-gray-600 mt-1">Código: {newLocationData.latlong.replace('pluscode:', '')}</p>
                            <p className="text-xs text-gray-500 mt-2">Haz clic para abrir en Google Maps</p>
                          </a>
                        ) : validateCoordinates(newLocationData.latlong) ? (
                          <img
                            src={`https://maps.googleapis.com/maps/api/staticmap?center=${newLocationData.latlong}&zoom=15&size=400x192&maptype=roadmap&markers=color:red%7C${newLocationData.latlong}&key=${GOOGLE_MAPS_API_KEY}`}
                            alt="Vista previa de ubicación"
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              const target = e.target as HTMLImageElement;
                              target.style.display = 'none';
                              const parent = target.parentElement;
                              if (parent) {
                                parent.innerHTML = '<div class="w-full h-full flex items-center justify-center bg-gray-200"><i class="bi bi-geo-alt text-gray-400 text-2xl"></i></div>';
                              }
                            }}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-yellow-50">
                            <div className="text-center p-4">
                              <i className="bi bi-exclamation-triangle text-yellow-500 text-2xl mb-2"></i>
                              <p className="text-sm text-yellow-700">Formato de coordenadas no reconocido</p>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Mostrar el código Plus en un campo de solo lectura si está disponible */}
                      {newLocationData.latlong.startsWith('pluscode:') && (
                        <div className="mt-2">
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Código Plus
                          </label>
                          <div className="bg-gray-100 p-2 rounded-md text-sm font-mono">
                            {newLocationData.latlong.replace('pluscode:', '')}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Tarifa - Mostrada dinámicamente */}
                  <div>
                    <div className="flex justify-between items-center bg-gray-50 p-3 rounded-lg border border-gray-200 shadow-sm">
                      <div className="flex flex-col">
                        <span className="text-[10px] text-gray-500 uppercase font-black tracking-widest mb-1">Zona</span>
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${newLocationData.sector && newLocationData.sector !== 'Fuera de cobertura' ? 'bg-green-500 animate-pulse' : 'bg-amber-500'}`}></div>
                          <span className="text-sm font-bold text-gray-900">{newLocationData.sector || 'Pendiente de ubicación'}</span>
                        </div>
                      </div>
                      <div className="text-right border-l border-gray-200 pl-4">
                        <span className="text-[10px] text-gray-500 uppercase font-black tracking-widest mb-1">Costo Envío</span>
                        <div className="text-xl font-black text-blue-600">${newLocationData.tarifa}</div>
                      </div>
                    </div>
                  </div>

                  {/* Foto de referencia */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Foto de referencia (opcional)
                    </label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          setLocationImageFile(file);
                          const reader = new FileReader();
                          reader.onloadend = () => {
                            setLocationImagePreview(reader.result as string);
                          };
                          reader.readAsDataURL(file);
                        }
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                    />
                    {locationImagePreview && (
                      <div className="mt-3">
                        <p className="text-sm text-gray-600 mb-2">Vista previa:</p>
                        <div className="relative w-full h-48 bg-gray-100 rounded-md overflow-hidden">
                          <img
                            src={locationImagePreview}
                            alt="Vista previa"
                            className="w-full h-full object-cover"
                          />
                          <button
                            onClick={() => {
                              setLocationImageFile(null);
                              setLocationImagePreview('');
                            }}
                            className="absolute top-2 right-2 bg-red-500 text-white p-2 rounded-full hover:bg-red-600 transition-colors"
                            type="button"
                          >
                            <i className="bi bi-x text-lg"></i>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Botones del formulario */}
                <div className="flex space-x-3 mt-6">
                  <button
                    onClick={() => {
                      setShowNewLocationForm(false);
                      setNewLocationData({
                        referencia: '',
                        tarifa: '1',
                        latlong: '',
                        photo: '',
                        sector: ''
                      });
                      setLocationImageFile(null);
                      setLocationImagePreview('');
                    }}
                    className="flex-1 bg-gray-500 text-white py-2 px-4 rounded-md hover:bg-gray-600 transition-colors"
                    disabled={creatingLocation}
                  >
                    Volver
                  </button>

                  <button
                    onClick={() => editingLocationId ? handleSaveEditedLocation() : handleCreateLocation()}
                    disabled={creatingLocation}
                    className="flex-1 bg-green-600 text-white py-2 px-4 rounded-md hover:bg-green-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
                  >
                    {creatingLocation ? (
                      <>
                        <i className="bi bi-arrow-repeat animate-spin mr-2"></i>
                        Guardando...
                      </>
                    ) : (
                      <>
                        <i className="bi bi-save mr-2"></i>
                        {editingLocationId ? 'Actualizar ubicación' : 'Guardar ubicación'}
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal de selección de deliveries */}
      {showDeliveryModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">Seleccionar delivery</h3>
              <button
                onClick={() => setShowDeliveryModal(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                <i className="bi bi-x-lg"></i>
              </button>
            </div>

            <div className="space-y-3">
              {/* Opción "Sin asignar" */}
              <button
                onClick={() => {
                  setManualOrderData(prev => ({ ...prev, selectedDelivery: null }));
                  setShowDeliveryModal(false);
                }}
                className={`w-full p-3 rounded-lg border-2 transition-all flex items-center space-x-3 ${!manualOrderData.selectedDelivery
                  ? 'border-gray-500 bg-gray-50'
                  : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50'
                  }`}
              >
                <div className="w-12 h-12 flex-shrink-0 rounded-full bg-gray-200 flex items-center justify-center">
                  <i className="bi bi-clock text-gray-400 text-lg"></i>
                </div>
                <div className="flex-1 text-left">
                  <p className="text-sm font-medium text-gray-700">Sin asignar</p>
                  <p className="text-xs text-gray-500">El pedido se asignará después</p>
                </div>
                {!manualOrderData.selectedDelivery && (
                  <i className="bi bi-check-circle text-gray-500"></i>
                )}
              </button>

              {/* Lista de deliveries activos */}
              {availableDeliveries.filter(delivery => delivery.estado === 'activo').map((delivery) => (
                <button
                  key={delivery.id}
                  onClick={() => {
                    setManualOrderData(prev => ({ ...prev, selectedDelivery: delivery }));
                    setShowDeliveryModal(false);
                  }}
                  className={`w-full p-3 rounded-lg border-2 transition-all flex items-center space-x-3 ${manualOrderData.selectedDelivery?.id === delivery.id
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50'
                    }`}
                >
                  {/* Foto del delivery */}
                  <div className="w-12 h-12 flex-shrink-0 rounded-full overflow-hidden bg-gray-200 relative">
                    {delivery.fotoUrl ? (
                      <>
                        <img
                          src={delivery.fotoUrl}
                          alt={delivery.nombres}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            const target = e.target as HTMLImageElement;
                            target.style.display = 'none';
                            const parent = target.parentElement;
                            if (parent) {
                              const fallback = parent.querySelector('.avatar-fallback') as HTMLElement;
                              if (fallback) {
                                fallback.style.display = 'flex';
                              }
                            }
                          }}
                        />
                        <div className="avatar-fallback absolute inset-0 hidden w-full h-full flex items-center justify-center bg-gray-200">
                          <i className="bi bi-person text-gray-400 text-lg"></i>
                        </div>
                      </>
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gray-200">
                        <i className="bi bi-person text-gray-400 text-lg"></i>
                      </div>
                    )}
                  </div>

                  <div className="flex-1 text-left">
                    <p className="text-sm font-medium text-gray-900">{delivery.nombres}</p>
                    <p className="text-xs text-gray-500">{delivery.celular}</p>
                  </div>

                  {manualOrderData.selectedDelivery?.id === delivery.id && (
                    <i className="bi bi-check-circle text-blue-500"></i>
                  )}
                </button>
              ))}

              {availableDeliveries.filter(delivery => delivery.estado === 'activo').length === 0 && (
                <div className="text-center py-8">
                  <i className="bi bi-person-x text-gray-400 text-4xl mb-3"></i>
                  <p className="text-sm text-gray-500">No hay deliveries activos disponibles</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal de edición de cliente */}
      {showEditClient && editingClient && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">Editar cliente</h3>
              <button
                onClick={() => setShowEditClient(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                <i className="bi bi-x-lg"></i>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Teléfono <span className="text-red-500">*</span>
                </label>
                <input
                  type="tel"
                  value={editingClient.celular || ''}
                  onChange={(e) => setEditingClient(prev => prev ? { ...prev, celular: e.target.value } : null)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Ej: 0987654321"
                />
                <p className="mt-1 text-xs text-gray-500">Formato: 0987654321 o 027654321</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nombre completo <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={editingClient.nombres || ''}
                  onChange={(e) => setEditingClient(prev => prev ? { ...prev, nombres: e.target.value } : null)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Nombre completo del cliente"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Correo (Opcional)
                </label>
                <input
                  type="email"
                  value={editingClient.email || ''}
                  onChange={(e) => setEditingClient(prev => prev ? { ...prev, email: e.target.value } : null)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="ejemplo@correo.com"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Notas (Opcional)
                </label>
                <textarea
                  value={editingClient.notas || ''}
                  onChange={(e) => setEditingClient(prev => prev ? { ...prev, notas: e.target.value } : null)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                  rows={3}
                  placeholder="Ej: Prefiere condimentos adicionales, entrega después de las 6 PM, etc."
                />
              </div>

              <div className="flex justify-end space-x-3 pt-4">
                <button
                  onClick={() => setShowEditClient(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleUpdateClient}
                  disabled={!editingClient.nombres.trim() || updatingClient}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {updatingClient ? (
                    <>
                      <i className="bi bi-arrow-repeat animate-spin mr-2"></i>
                      Guardando...
                    </>
                  ) : (
                    'Guardar cambios'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal de producto personalizado */}
      {showCustomProductModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md mx-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">Agregar producto personalizado</h3>
              <button
                onClick={() => {
                  setShowCustomProductModal(false)
                  setCustomProductData({ name: '', price: '' })
                }}
                className="text-gray-500 hover:text-gray-700"
              >
                <i className="bi bi-x-lg"></i>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Nombre del producto *
                </label>
                <input
                  type="text"
                  value={customProductData.name}
                  onChange={(e) => setCustomProductData(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Ej: Combo especial, Bebida personalizada, etc."
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Valor de tienda ($) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={customProductData.price}
                  onChange={(e) => setCustomProductData(prev => ({ ...prev, price: e.target.value }))}
                  placeholder="0.00"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              {customProductPricing && (
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700 space-y-1">
                  <div className="flex justify-between">
                    <span>Valor de tienda</span>
                    <span className="font-medium">${customProductPricing.storePrice.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Comision Fuddi</span>
                    <span className="font-medium">${customProductPricing.commission.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between border-t border-gray-200 pt-1 font-semibold text-gray-900">
                    <span>Precio en orden</span>
                    <span>${customProductPricing.publicPrice.toFixed(2)}</span>
                  </div>
                </div>
              )}

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <p className="text-sm text-blue-800">
                  <i className="bi bi-info-circle me-2"></i>
                  Este producto personalizado solo se agregará a esta orden específica y no se guardará en el catálogo.
                </p>
              </div>
            </div>

            <div className="flex space-x-3 mt-6">
              <button
                onClick={() => {
                  setShowCustomProductModal(false)
                  setCustomProductData({ name: '', price: '' })
                }}
                className="flex-1 bg-gray-500 text-white py-2 px-4 rounded-md hover:bg-gray-600 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={addCustomProductToOrder}
                disabled={!customProductData.name.trim() || !customProductData.price.trim()}
                className="flex-1 bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Agregar a la orden
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sidebar de Detalle de Cliente */}
      {showClientDetailSidebar && (
        <div className="fixed inset-0 z-[60] overflow-hidden" style={{ overscrollBehavior: 'contain', touchAction: 'pan-x pan-y' }}>
          {/* Backdrop */}
          <div 
            className="absolute inset-0 bg-black bg-opacity-50 transition-opacity" 
            onClick={() => setShowClientDetailSidebar(false)}
          ></div>

          {/* Slide-over panel */}
          <div 
            className="absolute inset-y-0 right-0 max-w-2xl w-full bg-white shadow-xl flex flex-col z-[61] transform transition-transform duration-300 ease-in-out"
            style={{ overscrollBehavior: 'contain', touchAction: 'pan-x pan-y' }}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="text-lg font-semibold text-black flex items-center gap-2">
                <i className="bi bi-person-circle text-blue-600"></i>
                Información del Cliente
              </h3>
              <button
                onClick={() => setShowClientDetailSidebar(false)}
                className="p-2 hover:bg-gray-100 rounded-full text-gray-500 hover:text-gray-700"
              >
                <i className="bi bi-x-lg"></i>
              </button>
            </div>

            {/* Content */}
            <div 
              className="flex-1 overflow-y-auto p-4 space-y-6"
              style={{ overscrollBehavior: 'contain' }}
            >
              {/* Información General */}
              <div className="bg-gray-50 p-4 rounded-lg border border-gray-100 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Datos Generales
                  </h4>
                  {!isEditingClientInDetail ? (
                    <button
                      type="button"
                      onClick={() => {
                        setDetailClientName(manualOrderData.customerName || '')
                        setDetailClientPhone(manualOrderData.customerPhone || '')
                        setDetailClientEmail(clientEmail || '')
                        setDetailClientNotes(clientNotes || '')
                        setIsEditingClientInDetail(true)
                      }}
                      className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1 font-medium transition-colors"
                    >
                      <i className="bi bi-pencil-square"></i>
                      Editar
                    </button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleSaveClientDetail}
                        disabled={updatingClient}
                        className="text-xs bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700 font-medium transition-colors flex items-center gap-1"
                      >
                        {updatingClient ? (
                          <>
                            <span className="animate-spin h-3 w-3 border-2 border-white border-t-transparent rounded-full inline-block"></span>
                            Guardando
                          </>
                        ) : (
                          'Guardar'
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsEditingClientInDetail(false)}
                        disabled={updatingClient}
                        className="text-xs bg-gray-200 text-gray-700 px-2 py-1 rounded hover:bg-gray-300 font-medium transition-colors"
                      >
                        Cancelar
                      </button>
                    </div>
                  )}
                </div>

                {isEditingClientInDetail ? (
                  <div className="space-y-3 text-sm text-black">
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Nombre *</label>
                      <input
                        type="text"
                        value={detailClientName}
                        onChange={(e) => setDetailClientName(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Teléfono *</label>
                      <input
                        type="tel"
                        value={detailClientPhone}
                        onChange={(e) => setDetailClientPhone(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Correo (Opcional)</label>
                      <input
                        type="email"
                        value={detailClientEmail}
                        onChange={(e) => setDetailClientEmail(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white"
                        placeholder="ejemplo@correo.com"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Notas (Opcional)</label>
                      <textarea
                        value={detailClientNotes}
                        onChange={(e) => setDetailClientNotes(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white"
                        rows={3}
                        placeholder="Ej: Prefiere condimentos adicionales, entrega después de las 6 PM, etc."
                      />
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-sm">
                    <div className="text-gray-500">Nombre:</div>
                    <div className="font-medium text-gray-900 break-words">{manualOrderData.customerName}</div>
                    
                    <div className="text-gray-500">Teléfono:</div>
                    <div className="font-medium text-gray-900 font-mono">{manualOrderData.customerPhone}</div>
                    
                    <div className="text-gray-500">Correo:</div>
                    <div className="font-medium text-gray-900 break-all">{clientEmail || <span className="text-gray-400 italic">No registrado</span>}</div>

                    {clientRegisterDate && (
                      <>
                        <div className="text-gray-500">Registrado el:</div>
                        <div className="font-medium text-gray-900">{clientRegisterDate}</div>
                      </>
                    )}

                    <div className="text-gray-500">Notas:</div>
                    <div className="font-medium text-gray-900 whitespace-pre-wrap break-words">{clientNotes || <span className="text-gray-400 italic">Sin notas</span>}</div>
                  </div>
                )}
              </div>

              {/* Últimos Pedidos */}
              <div className="space-y-3">
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center justify-between">
                  <span>Últimos Pedidos</span>
                  <span className="bg-blue-100 text-blue-800 text-xs px-2 py-0.5 rounded-full font-medium">
                    {clientOrders.length}
                  </span>
                </h4>

                {loadingOrders ? (
                  <div className="flex flex-col items-center justify-center py-8 space-y-2">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                    <span className="text-xs text-gray-500 font-medium">Cargando historial...</span>
                  </div>
                ) : clientOrders.length === 0 ? (
                  <div className="text-center py-8 text-sm text-gray-400 bg-gray-50 rounded-lg border border-dashed border-gray-300">
                    No se encontraron pedidos anteriores
                  </div>
                ) : (
                  <div className="overflow-x-auto border border-gray-200 rounded-lg shadow-sm">
                    <table className="min-w-full divide-y divide-gray-200 text-sm text-black">
                      <thead className="bg-gray-50">
                        <tr>
                          <th scope="col" className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                            Fecha
                          </th>
                          <th scope="col" className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                            Lugar de entrega
                          </th>
                          <th scope="col" className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                            Pago
                          </th>
                          <th scope="col" className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                            Estado
                          </th>
                          <th scope="col" className="px-3 py-2 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">
                            Total
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {clientOrders.map((ord: any) => (
                          <tr key={ord.id} className="hover:bg-gray-50 transition-colors">
                            <td className="px-3 py-2.5 whitespace-nowrap text-xs text-gray-900">
                              {formatOrderDate(ord.createdAt)}
                            </td>
                            <td className="px-3 py-2.5 text-xs text-gray-700 max-w-[200px] break-words">
                              <span className="font-semibold block text-gray-900">
                                {ord.delivery?.type === 'pickup' ? 'Retiro en Tienda' : 'Domicilio'}
                              </span>
                              {ord.delivery?.type === 'delivery' && (
                                <span className="text-[11px] text-gray-500 block leading-tight mt-0.5">
                                  {ord.delivery?.references || 'Sin referencia'}
                                  {ord.delivery?.sector && ` (${ord.delivery.sector})`}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-xs text-gray-700">
                              <span className="capitalize font-medium text-gray-900 block">
                                {ord.payment?.method === 'cash' ? 'Efectivo' :
                                 ord.payment?.method === 'transfer' ? 'Transferencia' :
                                 ord.payment?.method === 'mixed' ? 'Mixto' :
                                 ord.payment?.method || 'N/A'}
                              </span>
                              {ord.payment?.method === 'transfer' && ord.payment?.selectedBank && (
                                <span className="text-[10px] text-gray-500 block leading-none mt-0.5">
                                  {ord.payment.selectedBank}
                                </span>
                              )}
                              {ord.payment?.method === 'mixed' && (
                                <span className="text-[10px] text-gray-500 block leading-none mt-0.5">
                                  Efect: ${ord.payment.cashAmount || 0} + Transf: ${ord.payment.transferAmount || 0}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 whitespace-nowrap">
                              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${
                                ord.status === 'delivered' ? 'bg-green-100 text-green-800' :
                                ord.status === 'cancelled' ? 'bg-red-100 text-red-800' :
                                'bg-blue-100 text-blue-800'
                              }`}>
                                {ord.status === 'delivered' ? 'Entregado' :
                                 ord.status === 'cancelled' ? 'Cancelado' :
                                 ord.status || 'Pendiente'}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 whitespace-nowrap text-right text-xs font-bold text-blue-600">
                              ${ord.total ? Number(ord.total).toFixed(2) : '0.00'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {showToast && (
        <div className="fixed top-4 right-4 z-[9999] animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="bg-gray-800/90 text-white px-4 py-2 rounded-md shadow-sm flex items-center gap-2 backdrop-blur-sm">
            <div className="flex-1">
              <p className="text-xs font-medium">{toastMessage}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
