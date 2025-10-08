'use client'

import { useState, useEffect } from 'react'
import { Business, Product, ProductVariant } from '@/types'
import { searchClientByPhone, createClient, getDeliveriesByStatus, createOrder, getClientLocations, createClientLocation, updateLocation, deleteLocation, updateOrder, updateClient } from '@/lib/database'
import { GOOGLE_MAPS_API_KEY } from './GoogleMap'

interface Client {
  id: string
  celular: string
  nombres: string
  fecha_de_registro?: string
  [key: string]: any
}

interface ClientLocation {
  id: string
  id_cliente: string
  latlong: string
  referencia: string
  sector: string
  tarifa: string
}

interface OrderItem {
  name: string
  price: number
  productId: string
  quantity: number
  variant?: string
}

interface ManualOrderData {
  customerPhone: string
  customerName: string
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
}

interface ManualOrderSidebarProps {
  isOpen: boolean
  onClose: () => void
  business: Business | null
  products: Product[]
  onOrderCreated: () => void
  // Edit mode support
  mode?: 'create' | 'edit'
  editOrder?: any
  onOrderUpdated?: () => void
}

export default function ManualOrderSidebar({
  isOpen,
  onClose,
  business,
  products,
  onOrderCreated,
  mode = 'create',
  editOrder,
  onOrderUpdated
}: ManualOrderSidebarProps) {
  const [manualOrderData, setManualOrderData] = useState<ManualOrderData>({
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
    selectedDelivery: null
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
  
  // Estados para modal de variantes
  const [selectedProductForVariants, setSelectedProductForVariants] = useState<Product | null>(null)
  const [isVariantModalOpen, setIsVariantModalOpen] = useState(false)

  // Estados para modal de ubicaciones
  const [showLocationModal, setShowLocationModal] = useState(false)
  const [showNewLocationForm, setShowNewLocationForm] = useState(false)
  const [newLocationData, setNewLocationData] = useState({
    referencia: '',
    tarifa: '1',
    googleMapsLink: '',
    latlong: ''
  })
  const [creatingLocation, setCreatingLocation] = useState(false)
  const [editingLocationId, setEditingLocationId] = useState<string | null>(null)
  
  // Estados para modal de deliveries
  const [showDeliveryModal, setShowDeliveryModal] = useState(false)

  // Cleanup del timeout al desmontar
  useEffect(() => {
    return () => {
      if (searchTimeout) {
        clearTimeout(searchTimeout)
      }
    }
  }, [searchTimeout])

  // Recalcular total cuando cambie la ubicación seleccionada
  useEffect(() => {
    if (manualOrderData.selectedProducts.length > 0) {
      calculateTotal(manualOrderData.selectedProducts)
    }
  }, [manualOrderData.selectedLocation])

  // Cargar deliveries activos
  useEffect(() => {
    const loadDeliveries = async () => {
      try {
        const deliveries = await getDeliveriesByStatus('activo')
        setAvailableDeliveries(deliveries)
        
        // Seleccionar automáticamente a Sergio Alvarado como delivery predeterminado
        const defaultDelivery = deliveries.find(d => d.celular === '0978697867')
        if (defaultDelivery) {
          setManualOrderData(prev => ({ ...prev, selectedDelivery: defaultDelivery }))
        }
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
        referencia: eo.delivery?.references || (eo.delivery as any)?.reference || '',
        sector: 'Sin especificar',
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
        name: it.variant || it.name || it.product?.name || 'Producto',
        price: it.price || it.product?.price || 0,
        productId: it.productId || it.product?.id || it.id || '',
        quantity: it.quantity || 1,
        variant: it.variant
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
        selectedDelivery: selectedDeliveryFromId(availableDeliveries, eo.delivery?.assignedDelivery)
      }))

      // Mostrar inmediatamente tarjeta de cliente encontrado y cargar ubicaciones
      setClientFound(true)
      setShowCreateClient(false)
      const phoneToLoad = eo.customer?.phone || ''
      if (phoneToLoad) {
        setLoadingClientLocations(true)
        ;(async () => {
          try {
            const client = await searchClientByPhone(phoneToLoad)
            if (client) {
              const locations = await getClientLocations(client.id)
              setManualOrderData(prev => ({ ...prev, customerLocations: locations }))
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

  // Obtener categorías únicas de los productos
  const getUniqueCategories = () => {
    const categories = products.map(product => product.category).filter(Boolean)
    return Array.from(new Set(categories))
  }

  // Filtrar productos por categoría
  const getFilteredProducts = () => {
    if (selectedCategory === 'all') {
      return products
    }
    return products.filter(product => product.category === selectedCategory)
  }

  // Manejar selección de delivery
  const handleDeliverySelect = () => {
    setManualOrderData(prev => ({ ...prev, deliveryType: 'delivery' }))
    setShowLocationModal(true)
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
    // Remover todos los espacios, guiones y paréntesis
    let cleanPhone = phone.replace(/[\s\-\(\)]/g, '')
    
    // Si empieza con +593, convertir a formato nacional
    if (cleanPhone.startsWith('+593')) {
      cleanPhone = '0' + cleanPhone.substring(4)
    } else if (cleanPhone.startsWith('593')) {
      cleanPhone = '0' + cleanPhone.substring(3)
    }
    
    return cleanPhone
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

  // Pegar desde el portapapeles para Google Maps
  const handlePasteGoogleMapsFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText()
      handleGoogleMapsLinkChange(text)
    } catch (error) {
      console.error('Error al pegar desde el portapapeles:', error)
    }
  }

  // Búsqueda de cliente por teléfono
  const handlePhoneSearch = async (phone: string) => {
    const normalizedPhone = normalizePhone(phone)
    setManualOrderData(prev => ({ ...prev, customerPhone: normalizedPhone }))
    
    if (normalizedPhone.length < 10) {
      setClientFound(false)
      setManualOrderData(prev => ({ 
        ...prev, 
        customerName: '', 
        customerLocations: [], 
        selectedLocation: null 
      }))
      return
    }

    if (searchTimeout) {
      clearTimeout(searchTimeout)
    }

    const timeout = setTimeout(async () => {
      setSearchingClient(true)
      try {
        const client = await searchClientByPhone(normalizedPhone)
        if (client) {
          setClientFound(true)
          setManualOrderData(prev => ({ ...prev, customerName: client.nombres }))
          
          // Cargar ubicaciones del cliente
          setLoadingClientLocations(true)
          try {
            const locations = await getClientLocations(client.id)
            setManualOrderData(prev => ({ ...prev, customerLocations: locations }))
          } catch (error) {
            console.error('Error loading client locations:', error)
          } finally {
            setLoadingClientLocations(false)
          }
        } else {
          setClientFound(false)
          setShowCreateClient(true)
          setManualOrderData(prev => ({ 
            ...prev, 
            customerName: '', 
            customerLocations: [], 
            selectedLocation: null 
          }))
        }
      } catch (error) {
        console.error('Error searching client:', error)
        setClientFound(false)
      } finally {
        setSearchingClient(false)
      }
    }, 1000)

    setSearchTimeout(timeout)
  }

  // Abrir modal para editar cliente
  const handleEditClient = async () => {
    try {
      const client = await searchClientByPhone(manualOrderData.customerPhone)
      if (client) {
        setEditingClient(client)
        setShowEditClient(true)
      }
    } catch (error) {
      console.error('Error al cargar datos del cliente:', error)
      alert('Error al cargar los datos del cliente')
    }
  }

  // Actualizar datos del cliente
  const handleUpdateClient = async () => {
    if (!editingClient || !editingClient.nombres?.trim() || !editingClient.celular?.trim()) {
      return
    }

    const celular = normalizePhone(editingClient.celular.trim())
    if (celular.length < 10) {
      return
    }

    setUpdatingClient(true)
    try {
      const nombres = editingClient.nombres.trim()
      
      // Verificar si el teléfono ya existe para otro cliente
      if (celular !== manualOrderData.customerPhone) {
        const existingClient = await searchClientByPhone(celular)
        if (existingClient && existingClient.id !== editingClient.id) {
          return
        }
      }
      
      // Actualizar el cliente en la base de datos
      await updateClient(editingClient.id, { 
        nombres,
        celular 
      })
      
      // Actualizar los datos en el estado
      setManualOrderData(prev => ({
        ...prev,
        customerName: nombres,
        customerPhone: celular
      }))
      
      // Actualizar también el estado del cliente editado
      setEditingClient(prev => prev ? { ...prev, nombres } : null)
      
      setShowEditClient(false)
    } catch (error) {
      console.error('Error actualizando cliente:', error)
    } finally {
      setUpdatingClient(false)
    }
  }

  // Crear nuevo cliente
  const handleCreateClient = async () => {
    if (!manualOrderData.customerName || !manualOrderData.customerPhone) return

    setCreatingClient(true)
    try {
      const clientData = {
        celular: manualOrderData.customerPhone,
        nombres: manualOrderData.customerName,
        fecha_de_registro: new Date().toISOString()
      }
      
      await createClient(clientData)
      setClientFound(true)
      setShowCreateClient(false)
      
      // Recargar el cliente después de crearlo para obtener el ID
      const client = await searchClientByPhone(manualOrderData.customerPhone)
      if (client) {
        const locations = await getClientLocations(client.id)
        setManualOrderData(prev => ({ ...prev, customerLocations: locations }))
      }
    } catch (error) {
      console.error('Error creating client:', error)
      alert('Error al crear el cliente')
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

  // Función para validar coordenadas
  const normalizeLatLong = (coords: string): string => {
    // Eliminar espacios alrededor de la coma y extra espacios
    return coords.trim().replace(/\s*,\s*/, ',');
  }

  const validateCoordinates = (coords: string): boolean => {
    if (!coords) return false
    const normalized = normalizeLatLong(coords)
    const coordPattern = /^-?\d+\.?\d*,-?\d+\.?\d*$/;
    return coordPattern.test(normalized);
  };

  // Función para manejar cambio en enlace de Google Maps
  const handleGoogleMapsLinkChange = (link: string) => {
    setNewLocationData(prev => ({ ...prev, googleMapsLink: link }));
    
    if (link.trim()) {
      const coordinates = extractCoordinatesFromGoogleMaps(link);
      if (coordinates) {
        // Normalizar antes de setear
        setNewLocationData(prev => ({ ...prev, latlong: normalizeLatLong(coordinates) }));
      }
    }
  };

  // Función para crear nueva ubicación
  const handleCreateLocation = async () => {
    if (!newLocationData.referencia.trim()) {
      alert('Por favor ingresa una referencia para la ubicación');
      return;
    }

    // LatLong ahora es opcional. Si se proporciona, debe ser válido.
    if (newLocationData.latlong.trim()) {
      const normalized = normalizeLatLong(newLocationData.latlong)
      if (!validateCoordinates(normalized)) {
        alert('Por favor ingresa coordenadas válidas (formato: lat,lng)');
        return;
      }
      // Guardar normalizadas
      setNewLocationData(prev => ({ ...prev, latlong: normalized }))
    }

    // Buscar el cliente para obtener su ID
    const client = await searchClientByPhone(manualOrderData.customerPhone);
    if (!client) {
      alert('No se encontró el cliente');
      return;
    }

    setCreatingLocation(true);
    try {
      const clientId = client.id;
      const newLocationResponse = await createClientLocation({
        id_cliente: clientId,
        latlong: newLocationData.latlong.trim(),
        referencia: newLocationData.referencia.trim(),
        tarifa: newLocationData.tarifa,
        sector: 'Sin especificar'
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
        setManualOrderData(prev => ({ ...prev, selectedLocation: newLocation }));
        calculateTotal(manualOrderData.selectedProducts);
      }

      // Limpiar formulario y cerrar modal
      setNewLocationData({
        referencia: '',
        tarifa: '1',
        googleMapsLink: '',
        latlong: ''
      });
      setShowNewLocationForm(false);
      setShowLocationModal(false);
      
      alert('Ubicación creada exitosamente');
    } catch (error) {
      console.error('Error creando ubicación:', error);
      alert('Error al crear la ubicación');
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
      googleMapsLink: '',
      latlong: location.latlong || ''
    })
    setShowNewLocationForm(true)
  }

  // Guardar cambios de edición
  const handleSaveEditedLocation = async () => {
    if (!editingLocationId) return
    if (!newLocationData.referencia.trim()) {
      alert('Por favor ingresa una referencia para la ubicación');
      return;
    }

    if (newLocationData.latlong.trim()) {
      const normalized = normalizeLatLong(newLocationData.latlong)
      if (!validateCoordinates(normalized)) {
        alert('Por favor ingresa coordenadas válidas (formato: lat,lng)');
        return;
      }
      setNewLocationData(prev => ({ ...prev, latlong: normalized }))
    }

    setCreatingLocation(true)
    try {
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

      await updateLocation(editingLocationId, updatePayload)

      // Recargar ubicaciones
      const client = await searchClientByPhone(manualOrderData.customerPhone)
      if (client) {
        const locations = await getClientLocations(client.id)
        setManualOrderData(prev => ({ ...prev, customerLocations: locations }))
      }

      setEditingLocationId(null)
      setShowNewLocationForm(false)
      setNewLocationData({ referencia: '', tarifa: '1', googleMapsLink: '', latlong: '' })
      alert('Ubicación actualizada correctamente')
    } catch (error) {
      console.error('Error actualizando ubicación:', error)
      alert('Error al actualizar la ubicación')
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

      const client = await searchClientByPhone(manualOrderData.customerPhone)
      if (client) {
        const locations = await getClientLocations(client.id)
        setManualOrderData(prev => ({ ...prev, customerLocations: locations }))
      }
    } catch (error) {
      console.error('Error eliminando ubicación:', error)
    }
  }

  // Agregar producto a la orden
  const addProductToOrder = (product: Product, variant?: ProductVariant) => {
    const price = variant ? variant.price : product.price
    const variantName = variant ? variant.name : undefined
    
    const newItem: OrderItem = {
      name: variant ? variant.name : product.name,
      price: price,
      productId: product.id,
      quantity: 1,
      variant: variantName
    }

    setManualOrderData(prev => ({
      ...prev,
      selectedProducts: [...prev.selectedProducts, newItem]
    }))

    calculateTotal([...manualOrderData.selectedProducts, newItem])
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

  // Calcular total
  const calculateTotal = (products: OrderItem[]) => {
    const subtotal = products.reduce((sum, item) => sum + (item.price * item.quantity), 0)
    const deliveryCost = parseFloat(manualOrderData.selectedLocation?.tarifa || '0')
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
      const orderData = {
        businessId: business.id,
        items: manualOrderData.selectedProducts.map(item => ({
          productId: item.productId,
          name: item.name,
          price: item.price,
          quantity: item.quantity,
          variant: item.variant
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
            deliveryCost: parseFloat(manualOrderData.selectedLocation?.tarifa || '0'),
            assignedDelivery: manualOrderData.selectedDelivery?.id || null
          })
        },
        timing: {
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
            // Registrar scheduledTime como ahora + 30 minutos (formato HH:MM)
            scheduledTime: (() => {
              const now = new Date();
              const plus30 = new Date(now.getTime() + 30 * 60 * 1000);
              const hh = String(plus30.getHours()).padStart(2, '0');
              const mm = String(plus30.getMinutes()).padStart(2, '0');
              return `${hh}:${mm}`;
            })()
          })
        },
        payment: {
          method: manualOrderData.paymentMethod,
          paymentStatus: manualOrderData.paymentStatus,
          selectedBank: manualOrderData.selectedBank,
          ...(manualOrderData.paymentMethod === 'mixed' && {
            cashAmount: manualOrderData.cashAmount || 0,
            transferAmount: manualOrderData.transferAmount || 0
          })
        },
        subtotal: manualOrderData.selectedProducts.reduce((sum, item) => sum + (item.price * item.quantity), 0),
        total: manualOrderData.total,
        status: 'confirmed' as const,
        createdByAdmin: true,
        createdAt: new Date(),
        updatedAt: new Date()
      }

      if (mode === 'edit' && editOrder?.id) {
        // For update, adapt payload to match updateOrder expectations
        const updatePayload: any = {
          items: orderData.items,
          customer: orderData.customer,
          delivery: orderData.delivery,
          timing: orderData.timing,
          payment: orderData.payment,
          total: orderData.total,
          updatedAt: new Date()
        }
        await updateOrder(editOrder.id, updatePayload)
        onOrderUpdated && onOrderUpdated()
      } else {
        await createOrder(orderData as any)
        onOrderCreated()
      }
      handleReset()
      onClose()
    } catch (error) {
      console.error('Error creating/updating order:', error)
      alert(mode === 'edit' ? 'Error al actualizar la orden' : 'Error al crear la orden')
    } finally {
      setCreatingOrder(false)
    }
  }

  // Reset del formulario
  const handleReset = () => {
    setManualOrderData({
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
      selectedDelivery: null
    })
    setClientFound(false)
    setShowCreateClient(false)
  }

  const handleCancel = () => {
    handleReset()
    onClose()
  }

  // ...existing code... (forced create removed)

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      <div className="absolute inset-0 bg-black bg-opacity-50" onClick={handleCancel}></div>
      
      <div className="absolute right-0 top-0 h-full w-full max-w-lg bg-white shadow-xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">{mode === 'edit' ? 'Editar pedido' : 'Nuevo pedido'}</h2>
          <button
            onClick={handleCancel}
            className="p-2 hover:bg-gray-100 rounded-full"
          >
            <i className="bi bi-x-lg"></i>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 pb-24">
          {/* Búsqueda de cliente */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Búsqueda por celular
            </label>
            <div className="relative">
              <div className="relative">
                <input
                  type="tel"
                  value={manualOrderData.customerPhone}
                  onChange={(e) => handlePhoneSearch(e.target.value)}
                  placeholder="0987654321 o +593 98 052 4391"
                  className="w-full px-3 py-2 pr-16 sm:pr-20 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
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
                  {searchingClient && (
                    <div className="flex items-center justify-center w-6 h-6">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Campo de nombre del cliente - solo visible cuando no se encuentra */}
            {showCreateClient && manualOrderData.customerPhone.length >= 10 && (
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

            {/* Resultado de búsqueda */}
            {clientFound ? (
              <div 
                className="mt-2 p-3 bg-green-50 border border-green-200 rounded-md hover:bg-green-100 cursor-pointer transition-colors"
                onClick={handleEditClient}
              >
                <div className="flex items-center justify-between">
                  <p className="text-sm text-green-800">
                    <i className="bi bi-check-circle me-2"></i>
                    Cliente encontrado: <span className="font-medium">{manualOrderData.customerName}</span>
                  </p>
                  <i className="bi bi-pencil-square text-green-600 hover:text-green-800"></i>
                </div>
              </div>
            ) : showCreateClient && manualOrderData.customerPhone.length >= 10 ? (
              <div className="mt-2 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
                <p className="text-sm text-yellow-800 mb-2">Cliente no encontrado</p>
                <button
                  onClick={handleCreateClient}
                  disabled={creatingClient || !manualOrderData.customerName}
                  className="w-full bg-blue-600 text-white px-3 py-2 rounded-md text-sm hover:bg-blue-700 disabled:opacity-50"
                >
                  {creatingClient ? 'Creando...' : 'Crear Cliente'}
                </button>
              </div>
            ) : null}

            <h3 className="text-sm font-medium text-gray-700 mb-3">Productos</h3>
            
            {/* Filtro de categorías */}
            <div className="mb-3">
              <div className="flex gap-2 text-xs overflow-x-auto scrollbar-hide whitespace-nowrap pb-2">
                <button
                  onClick={() => setSelectedCategory('all')}
                  className={`px-2 py-1 rounded transition-colors flex-shrink-0 ${
                    selectedCategory === 'all'
                      ? 'text-blue-600 font-medium'
                      : 'text-gray-600 hover:text-gray-800'
                  }`}
                >
                  Todos
                </button>
                {getUniqueCategories().map(category => (
                  <button
                    key={category}
                    onClick={() => setSelectedCategory(category)}
                    className={`px-2 py-1 rounded transition-colors flex-shrink-0 ${
                      selectedCategory === category
                        ? 'text-blue-600 font-medium'
                        : 'text-gray-600 hover:text-gray-800'
                    }`}
                  >
                    {category}
                  </button>
                ))}
              </div>
            </div>
            
            <div className="grid grid-cols-4 gap-1 max-h-50 overflow-y-auto">
              {getFilteredProducts().filter(p => p.isAvailable).map((product) => (
                <div 
                  key={product.id} 
                  className="aspect-square p-1 border rounded-md hover:bg-gray-50 cursor-pointer transition-colors flex flex-col"
                  onClick={() => {
                    if (product.variants && product.variants.length > 0) {
                      setSelectedProductForVariants(product)
                      setIsVariantModalOpen(true)
                    } else {
                      addProductToOrder(product)
                    }
                  }}
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
              ))}
            </div>
          </div>

          {/* Productos seleccionados - siempre visible */
          }
          {manualOrderData.selectedProducts.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-medium text-gray-700 mb-3">Productos seleccionados</h3>
              <div className="space-y-2">
                {manualOrderData.selectedProducts.map((item, index) => (
                  <div key={index} className="flex items-center justify-between p-2 bg-gray-50 rounded-md">
                    <div className="flex-1">
                      <p className="text-sm font-medium">{item.name}</p>
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
            <h3 className="text-sm font-medium text-gray-700 mb-3">Tipo de entrega</h3>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setManualOrderData(prev => ({ ...prev, deliveryType: 'pickup' }))}
                className={`p-3 rounded-lg border-2 transition-all flex flex-col items-center space-y-1 ${
                  manualOrderData.deliveryType === 'pickup'
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
                className={`p-3 rounded-lg border-2 transition-all flex flex-col items-center space-y-1 ${
                  manualOrderData.deliveryType === 'delivery'
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
              <h3 className="text-sm font-medium text-gray-700 mb-3">Ubicación</h3>
              
              {(!manualOrderData.customerPhone || manualOrderData.customerPhone.length < 10) ? (
                <p className="text-sm text-gray-500">Ingresa un número de teléfono válido para gestionar ubicaciones</p>
              ) : manualOrderData.selectedLocation ? (
                <div 
                  className="p-3 bg-green-50 border border-green-200 rounded-md mb-3 relative cursor-pointer hover:bg-green-100 transition-colors"
                  onClick={() => setShowLocationModal(true)}
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
                  onClick={() => setShowLocationModal(true)}
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
              <h3 className="text-sm font-medium text-gray-700 mb-3">Asignar delivery</h3>
              
              {manualOrderData.selectedDelivery ? (
                <div 
                  className="p-3 bg-blue-50 border border-blue-200 rounded-md mb-3 relative cursor-pointer hover:bg-blue-100 transition-colors"
                  onClick={() => setShowDeliveryModal(true)}
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
                    
                    <div className="text-blue-600 flex-shrink-0">
                      <i className="bi bi-chevron-down"></i>
                    </div>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowDeliveryModal(true)}
                  className="w-full p-3 rounded-lg border-2 border-gray-300 hover:border-gray-400 transition-all flex items-center justify-center space-x-2 text-gray-700"
                >
                  <i className="bi bi-person-plus"></i>
                  <span className="text-sm font-medium">Asignar delivery</span>
                </button>
              )}
            </div>
          )}

          {/* Método de pago - siempre visible */}
          <div className="mb-6">
            <h3 className="text-sm font-medium text-gray-700 mb-3">Método de pago</h3>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setManualOrderData(prev => ({ 
                  ...prev, 
                  paymentMethod: 'cash',
                  cashAmount: 0,
                  transferAmount: 0
                }))}
                className={`p-3 rounded-lg border-2 transition-all flex flex-col items-center space-y-1 ${
                  manualOrderData.paymentMethod === 'cash'
                    ? 'border-green-500 bg-green-50 text-green-700'
                    : 'border-gray-300 hover:border-gray-400'
                }`}
              >
                <i className="bi bi-cash text-lg"></i>
                <span className="text-xs font-medium">Efectivo</span>
              </button>
              
              <button
                type="button"
                onClick={() => setManualOrderData(prev => ({ 
                  ...prev, 
                  paymentMethod: 'transfer',
                  paymentStatus: mode === 'create' ? 'paid' : prev.paymentStatus,
                  cashAmount: 0,
                  transferAmount: 0
                }))}
                className={`p-3 rounded-lg border-2 transition-all flex flex-col items-center space-y-1 ${
                  manualOrderData.paymentMethod === 'transfer'
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-300 hover:border-gray-400'
                }`}
              >
                <i className="bi bi-bank text-lg"></i>
                <span className="text-xs font-medium">Transferencia</span>
              </button>
              
              <button
                type="button"
                onClick={() => setManualOrderData(prev => ({ 
                  ...prev, 
                  paymentMethod: 'mixed',
                  cashAmount: prev.total / 2,
                  transferAmount: prev.total / 2
                }))}
                className={`p-3 rounded-lg border-2 transition-all flex flex-col items-center space-y-1 ${
                  manualOrderData.paymentMethod === 'mixed'
                    ? 'border-purple-500 bg-purple-50 text-purple-700'
                    : 'border-gray-300 hover:border-gray-400'
                }`}
              >
                <i className="bi bi-cash-coin text-lg"></i>
                <span className="text-xs font-medium">Mixto</span>
              </button>
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
            <h3 className="text-sm font-medium text-gray-700 mb-3">Programación</h3>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <button
                type="button"
                onClick={() => setManualOrderData(prev => ({ ...prev, timingType: 'immediate' }))}
                className={`p-3 rounded-lg border-2 transition-all flex flex-col items-center space-y-1 ${
                  manualOrderData.timingType === 'immediate'
                    ? 'border-orange-500 bg-orange-50 text-orange-700'
                    : 'border-gray-300 hover:border-gray-400'
                }`}
              >
                <i className="bi bi-lightning-fill text-lg"></i>
                <span className="text-xs font-medium">Inmediato</span>
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
                className={`p-3 rounded-lg border-2 transition-all flex flex-col items-center space-y-1 ${
                  manualOrderData.timingType === 'scheduled'
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
                  <input
                    type="date"
                    value={manualOrderData.scheduledDate}
                    onChange={(e) => setManualOrderData(prev => ({ ...prev, scheduledDate: e.target.value }))}
                    className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Hora
                  </label>
                  <input
                    type="time"
                    value={manualOrderData.scheduledTime}
                    onChange={(e) => setManualOrderData(prev => ({ ...prev, scheduledTime: e.target.value }))}
                    className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Resumen - siempre visible */}
          <div className="mb-6 p-3 bg-gray-50 rounded-md">
            <h3 className="text-sm font-medium text-gray-700 mb-2">Resumen</h3>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span>Subtotal:</span>
                <span>${manualOrderData.selectedProducts.reduce((sum, item) => sum + (item.price * item.quantity), 0).toFixed(2)}</span>
              </div>
              {manualOrderData.deliveryType === 'delivery' && manualOrderData.selectedLocation && (
                <div className="flex justify-between">
                  <span>Envío:</span>
                  <span>${parseFloat(manualOrderData.selectedLocation.tarifa)}</span>
                </div>
              )}
              <div className="flex justify-between font-medium border-t pt-1">
                <span>Total:</span>
                <span>${manualOrderData.total.toFixed(2)}</span>
              </div>
            </div>
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
                !manualOrderData.customerPhone || 
                !manualOrderData.customerName || 
                manualOrderData.selectedProducts.length === 0 || 
                !manualOrderData.deliveryType ||
                (manualOrderData.deliveryType === 'delivery' && !manualOrderData.selectedLocation) ||
                (manualOrderData.paymentMethod === 'mixed' && Math.abs((manualOrderData.cashAmount || 0) + (manualOrderData.transferAmount || 0) - manualOrderData.total) >= 0.01) ||
                creatingOrder
              }
              className="flex-1 bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {creatingOrder ? 'Guardando...' : 'Guardar Pedido'}
            </button>

          </div>
        </div>

        {/* Modal de variantes */}
        {isVariantModalOpen && selectedProductForVariants && (
/* ... */
          <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center z-10">
            <div className="bg-white rounded-lg p-6 max-w-sm w-full mx-4">
              <h3 className="text-lg font-semibold mb-4">Seleccionar variante</h3>
              <p className="text-sm text-gray-600 mb-4">{selectedProductForVariants.name}</p>
              
              <div className="space-y-3 mb-6">
                {selectedProductForVariants.variants?.map((variant) => (
                  <button
                    key={variant.id}
                    onClick={() => {
                      addProductToOrder(selectedProductForVariants, variant)
                      setIsVariantModalOpen(false)
                      setSelectedProductForVariants(null)
                    }}
                    className="w-full text-left p-3 border rounded-md hover:bg-gray-50"
                  >
                    <div className="flex justify-between items-center">
                      <span className="font-medium">{variant.name}</span>
                      <span className="text-blue-600">${variant.price}</span>
                    </div>
                    {variant.description && (
                      <p className="text-sm text-gray-500 mt-1">{variant.description}</p>
                    )}
                  </button>
                ))}
              </div>

              <div className="flex space-x-3">
                <button
                  onClick={() => {
                    setIsVariantModalOpen(false)
                    setSelectedProductForVariants(null)
                  }}
                  className="flex-1 bg-gray-500 text-white py-2 px-4 rounded-md hover:bg-gray-600"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Modal de ubicaciones */}
      {showLocationModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">Seleccionar ubicación</h3>
              <button
                onClick={() => {
                  setShowLocationModal(false);
                  setShowNewLocationForm(false);
                  setNewLocationData({
                    referencia: '',
                    tarifa: '1',
                    googleMapsLink: '',
                    latlong: ''
                  });
                }}
                className="text-gray-500 hover:text-gray-700"
              >
                <i className="bi bi-x-lg"></i>
              </button>
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
                          onChange={() => {
                            setManualOrderData(prev => ({ ...prev, selectedLocation: location }));
                            setShowLocationModal(false);
                            calculateTotal(manualOrderData.selectedProducts);
                          }}
                          className="mr-3 mt-1 flex-shrink-0"
                        />
                        
                        {/* Mapa estático */}
                        {location.latlong && (
                          <div className="w-16 h-16 mr-3 flex-shrink-0 bg-gray-200 rounded-md overflow-hidden relative">
                            <img
                              src={`https://maps.googleapis.com/maps/api/staticmap?center=${location.latlong}&zoom=15&size=64x64&maptype=roadmap&markers=color:red%7C${location.latlong}&key=${GOOGLE_MAPS_API_KEY}`}
                              alt="Ubicación en mapa"
                              className="w-full h-full object-cover"
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
                          </div>
                        )}
                        
                        <div className="flex-1">
                          <p className="text-sm font-medium text-gray-900">{location.referencia}</p>
                          <p className="text-xs text-gray-500">Tarifa: ${parseFloat(location.tarifa)}</p>
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
                <h4 className="text-md font-medium mb-4">Crear nueva ubicación</h4>
                
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

                  {/* Enlace de Google Maps */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Enlace de Google Maps
                    </label>
                    <div className="relative">
                      <input
                        type="url"
                        value={newLocationData.googleMapsLink}
                        onChange={(e) => handleGoogleMapsLinkChange(e.target.value)}
                        placeholder="https://maps.google.com/?q=-1.861343,-79.974945"
                        className="w-full px-3 py-2 pr-20 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                      />
                      <button
                        onClick={handlePasteGoogleMapsFromClipboard}
                        className="absolute right-2 top-2 px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded hover:bg-gray-200 transition-colors"
                        type="button"
                      >
                        <i className="bi bi-clipboard"></i>
                      </button>
                    </div>
                  </div>

                  {/* Coordenadas */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Coordenadas (LatLong)
                    </label>
                    <input
                      type="text"
                      value={newLocationData.latlong}
                      onChange={(e) => setNewLocationData(prev => ({ ...prev, latlong: e.target.value }))}
                      placeholder="-1.861343,-79.974945"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>

                  {/* Vista previa del mapa estático */}
                  {newLocationData.latlong && validateCoordinates(newLocationData.latlong) && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Vista previa de ubicación
                      </label>
                      <div className="w-full h-48 bg-gray-200 rounded-md overflow-hidden">
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
                      </div>
                    </div>
                  )}

                  {/* Tarifa */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Tarifa de delivery ($)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={newLocationData.tarifa}
                      onChange={(e) => setNewLocationData(prev => ({ ...prev, tarifa: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                    />
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
                        googleMapsLink: '',
                        latlong: ''
                      });
                    }}
                    className="flex-1 bg-gray-500 text-white py-2 px-4 rounded-md hover:bg-gray-600 transition-colors"
                    disabled={creatingLocation}
                  >
                    Volver
                  </button>
                  
                  <button
                    onClick={() => editingLocationId ? handleSaveEditedLocation() : handleCreateLocation()}
                    disabled={creatingLocation || !newLocationData.referencia.trim()}
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
                className={`w-full p-3 rounded-lg border-2 transition-all flex items-center space-x-3 ${
                  !manualOrderData.selectedDelivery
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
                  className={`w-full p-3 rounded-lg border-2 transition-all flex items-center space-x-3 ${
                    manualOrderData.selectedDelivery?.id === delivery.id
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
    </div>
  )
}
