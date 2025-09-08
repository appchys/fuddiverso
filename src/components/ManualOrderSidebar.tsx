'use client'

import { useState, useEffect } from 'react'
import { Business, Product, ProductVariant } from '@/types'
import { searchClientByPhone, createClient, getDeliveriesByStatus, createOrder, getClientLocations, createClientLocation } from '@/lib/database'

interface Client {
  id: string
  celular: string
  nombres: string
  fecha_de_registro: any
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
}

export default function ManualOrderSidebar({
  isOpen,
  onClose,
  business,
  products,
  onOrderCreated
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
  const [loadingClientLocations, setLoadingClientLocations] = useState(false)
  const [searchTimeout, setSearchTimeout] = useState<NodeJS.Timeout | null>(null)
  const [availableDeliveries, setAvailableDeliveries] = useState<any[]>([])
  const [showCreateClient, setShowCreateClient] = useState(false)
  const [creatingClient, setCreatingClient] = useState(false)
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

  // Cleanup del timeout al desmontar
  useEffect(() => {
    return () => {
      if (searchTimeout) {
        clearTimeout(searchTimeout)
      }
    }
  }, [searchTimeout])

  // Cargar deliveries activos
  useEffect(() => {
    const loadDeliveries = async () => {
      try {
        const deliveries = await getDeliveriesByStatus('activo')
        setAvailableDeliveries(deliveries)
      } catch (error) {
        console.error('Error loading deliveries:', error)
      }
    }
    
    if (isOpen && business?.id) {
      loadDeliveries()
    }
  }, [isOpen, business?.id])

  // Búsqueda de cliente por teléfono
  const handlePhoneSearch = async (phone: string) => {
    setManualOrderData(prev => ({ ...prev, customerPhone: phone }))
    
    if (phone.length < 10) {
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
        const client = await searchClientByPhone(phone)
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
  const validateCoordinates = (coords: string): boolean => {
    const coordPattern = /^-?\d+\.?\d*,-?\d+\.?\d*$/;
    return coordPattern.test(coords.trim());
  };

  // Función para manejar cambio en enlace de Google Maps
  const handleGoogleMapsLinkChange = (link: string) => {
    setNewLocationData(prev => ({ ...prev, googleMapsLink: link }));
    
    if (link.trim()) {
      const coordinates = extractCoordinatesFromGoogleMaps(link);
      if (coordinates) {
        setNewLocationData(prev => ({ ...prev, latlong: coordinates }));
      }
    }
  };

  // Función para crear nueva ubicación
  const handleCreateLocation = async () => {
    if (!newLocationData.referencia.trim()) {
      alert('Por favor ingresa una referencia para la ubicación');
      return;
    }

    if (!newLocationData.latlong.trim() || !validateCoordinates(newLocationData.latlong)) {
      alert('Por favor ingresa coordenadas válidas (formato: lat,lng)');
      return;
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
      await createClientLocation({
        id_cliente: clientId,
        latlong: newLocationData.latlong.trim(),
        referencia: newLocationData.referencia.trim(),
        tarifa: newLocationData.tarifa,
        sector: 'Sin especificar'
      });

      // Recargar ubicaciones del cliente
      const locations = await getClientLocations(clientId);
      setManualOrderData(prev => ({ ...prev, customerLocations: locations }));

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

  // Agregar producto a la orden
  const addProductToOrder = (product: Product, variant?: ProductVariant) => {
    const price = variant ? variant.price : product.price
    const variantName = variant ? variant.name : undefined
    
    const newItem: OrderItem = {
      name: product.name + (variant ? ` - ${variant.name}` : ''),
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
      total: total
    }))
  }

  // Crear orden
  const handleCreateOrder = async () => {
    if (!business?.id || !manualOrderData.customerPhone || !manualOrderData.customerName || 
        manualOrderData.selectedProducts.length === 0 || !manualOrderData.deliveryType) {
      alert('Por favor completa todos los campos requeridos')
      return
    }

    if (manualOrderData.deliveryType === 'delivery' && !manualOrderData.selectedLocation) {
      alert('Por favor selecciona una ubicación para el delivery')
      return
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
            latlong: manualOrderData.selectedLocation?.latlong,
            references: manualOrderData.selectedLocation?.referencia,
            deliveryCost: parseFloat(manualOrderData.selectedLocation?.tarifa || '0'),
            assignedDelivery: manualOrderData.selectedDelivery?.id || null
          })
        },
        timing: {
          type: manualOrderData.timingType,
          ...(manualOrderData.timingType === 'scheduled' && {
            scheduledDate: manualOrderData.scheduledDate,
            scheduledTime: manualOrderData.scheduledTime
          })
        },
        payment: {
          method: manualOrderData.paymentMethod,
          paymentStatus: manualOrderData.paymentStatus,
          selectedBank: manualOrderData.selectedBank
        },
        subtotal: manualOrderData.selectedProducts.reduce((sum, item) => sum + (item.price * item.quantity), 0),
        total: manualOrderData.total,
        status: 'ready' as const,
        createdByAdmin: true,
        updatedAt: new Date()
      }

      await createOrder(orderData as any)
      onOrderCreated()
      handleReset()
      onClose()
    } catch (error) {
      console.error('Error creating order:', error)
      alert('Error al crear la orden')
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

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      <div className="absolute inset-0 bg-black bg-opacity-50" onClick={handleCancel}></div>
      
      <div className="absolute right-0 top-0 h-full w-full max-w-lg bg-white shadow-xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">Crear Pedido Manual</h2>
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
              <input
                type="tel"
                value={manualOrderData.customerPhone}
                onChange={(e) => handlePhoneSearch(e.target.value)}
                placeholder="0987654321"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              />
              {searchingClient && (
                <div className="absolute right-3 top-3">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                </div>
              )}
            </div>

            {/* Resultado de búsqueda */}
            {clientFound ? (
              <div className="mt-2 p-3 bg-green-50 border border-green-200 rounded-md">
                <p className="text-sm text-green-800">
                  <i className="bi bi-check-circle me-2"></i>
                  Cliente encontrado: {manualOrderData.customerName}
                </p>
              </div>
            ) : showCreateClient ? (
              <div className="mt-2 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
                <p className="text-sm text-yellow-800 mb-2">Cliente no encontrado</p>
                <input
                  type="text"
                  value={manualOrderData.customerName}
                  onChange={(e) => setManualOrderData(prev => ({ ...prev, customerName: e.target.value }))}
                  placeholder="Nombre del cliente"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm mb-2"
                />
                <button
                  onClick={handleCreateClient}
                  disabled={creatingClient || !manualOrderData.customerName}
                  className="w-full bg-blue-600 text-white px-3 py-2 rounded-md text-sm hover:bg-blue-700 disabled:opacity-50"
                >
                  {creatingClient ? 'Creando...' : 'Crear Cliente'}
                </button>
              </div>
            ) : null}
          </div>

          {/* Selección de productos */}
          {clientFound && (
            <>
              <div className="mb-6">
                <h3 className="text-sm font-medium text-gray-700 mb-3">Productos</h3>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {products.filter(p => p.isAvailable).map((product) => (
                    <div key={product.id} className="flex items-center justify-between p-2 border rounded-md">
                      <div className="flex-1">
                        <p className="text-sm font-medium">{product.name}</p>
                        <p className="text-xs text-gray-500">${product.price}</p>
                      </div>
                      <button
                        onClick={() => {
                          if (product.variants && product.variants.length > 0) {
                            setSelectedProductForVariants(product)
                            setIsVariantModalOpen(true)
                          } else {
                            addProductToOrder(product)
                          }
                        }}
                        className="bg-blue-600 text-white px-3 py-1 rounded text-xs hover:bg-blue-700"
                      >
                        Agregar
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Productos seleccionados */}
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

              {/* Tipo de entrega */}
              <div className="mb-6">
                <h3 className="text-sm font-medium text-gray-700 mb-3">Tipo de entrega</h3>
                <div className="space-y-2">
                  <label className="flex items-center">
                    <input
                      type="radio"
                      name="deliveryType"
                      value="pickup"
                      checked={manualOrderData.deliveryType === 'pickup'}
                      onChange={(e) => setManualOrderData(prev => ({ ...prev, deliveryType: e.target.value as 'pickup' | 'delivery' }))}
                      className="mr-2"
                    />
                    <span className="text-sm">Recoger en tienda</span>
                  </label>
                  <label className="flex items-center">
                    <input
                      type="radio"
                      name="deliveryType"
                      value="delivery"
                      checked={manualOrderData.deliveryType === 'delivery'}
                      onChange={(e) => setManualOrderData(prev => ({ ...prev, deliveryType: e.target.value as 'pickup' | 'delivery' }))}
                      className="mr-2"
                    />
                    <span className="text-sm">Delivery</span>
                  </label>
                </div>
              </div>

              {/* Ubicaciones del cliente */}
              {manualOrderData.deliveryType === 'delivery' && (
                <div className="mb-6">
                  <div className="flex justify-between items-center mb-3">
                    <h3 className="text-sm font-medium text-gray-700">Ubicación</h3>
                    <button
                      onClick={() => setShowLocationModal(true)}
                      className="text-sm bg-blue-600 text-white px-3 py-1 rounded-md hover:bg-blue-700 transition-colors"
                      disabled={!clientFound}
                    >
                      <i className="bi bi-geo-alt mr-1"></i>
                      Seleccionar ubicación
                    </button>
                  </div>
                  
                  {!clientFound ? (
                    <p className="text-sm text-gray-500">Primero busca o crea un cliente</p>
                  ) : manualOrderData.selectedLocation ? (
                    <div className="p-3 bg-green-50 border border-green-200 rounded-md">
                      <p className="text-sm font-medium text-green-800">{manualOrderData.selectedLocation.referencia}</p>
                      <p className="text-xs text-green-600">Tarifa: ${parseFloat(manualOrderData.selectedLocation.tarifa)}</p>
                      <button
                        onClick={() => setShowLocationModal(true)}
                        className="text-xs text-blue-600 hover:text-blue-700 mt-1"
                      >
                        Cambiar ubicación
                      </button>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">No hay ubicación seleccionada</p>
                  )}
                </div>
              )}

              {/* Método de pago */}
              <div className="mb-6">
                <h3 className="text-sm font-medium text-gray-700 mb-3">Método de pago</h3>
                <select
                  value={manualOrderData.paymentMethod}
                  onChange={(e) => setManualOrderData(prev => ({ ...prev, paymentMethod: e.target.value as 'cash' | 'transfer' | 'mixed' }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="cash">Efectivo</option>
                  <option value="transfer">Transferencia</option>
                  <option value="mixed">Mixto</option>
                </select>
              </div>

              {/* Resumen */}
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
            </>
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
            <button
              onClick={handleCreateOrder}
              disabled={!clientFound || manualOrderData.selectedProducts.length === 0 || creatingOrder}
              className="flex-1 bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {creatingOrder ? 'Guardando...' : 'Guardar Pedido'}
            </button>
          </div>
        </div>

        {/* Modal de variantes */}
        {isVariantModalOpen && selectedProductForVariants && (
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
                          }}
                          className="mr-3 mt-1"
                        />
                        <div className="flex-1">
                          <p className="text-sm font-medium text-gray-900">{location.referencia}</p>
                          <p className="text-xs text-gray-500">Tarifa: ${parseFloat(location.tarifa)}</p>
                          {location.latlong && (
                            <p className="text-xs text-gray-400 mt-1">
                              Coordenadas: {location.latlong}
                            </p>
                          )}
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
                    className="flex-1 bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 transition-colors"
                  >
                    <i className="bi bi-plus-lg mr-2"></i>
                    Nueva ubicación
                  </button>
                  
                  {manualOrderData.selectedLocation && (
                    <button
                      onClick={() => {
                        setShowLocationModal(false);
                        calculateTotal(manualOrderData.selectedProducts);
                      }}
                      className="flex-1 bg-green-600 text-white py-2 px-4 rounded-md hover:bg-green-700 transition-colors"
                    >
                      Confirmar selección
                    </button>
                  )}
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
                    <input
                      type="text"
                      value={newLocationData.referencia}
                      onChange={(e) => setNewLocationData(prev => ({ ...prev, referencia: e.target.value }))}
                      placeholder="Ej: Casa rosada esquinera..."
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>

                  {/* Enlace de Google Maps */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Enlace de Google Maps
                    </label>
                    <input
                      type="url"
                      value={newLocationData.googleMapsLink}
                      onChange={(e) => handleGoogleMapsLinkChange(e.target.value)}
                      placeholder="https://maps.google.com/?q=-1.861343,-79.974945"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Pega un enlace de Google Maps para extraer automáticamente las coordenadas
                    </p>
                  </div>

                  {/* Coordenadas */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Coordenadas (LatLong) *
                    </label>
                    <input
                      type="text"
                      value={newLocationData.latlong}
                      onChange={(e) => setNewLocationData(prev => ({ ...prev, latlong: e.target.value }))}
                      placeholder="-1.861343,-79.974945"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Formato: latitud,longitud (se llena automáticamente desde el enlace de Google Maps)
                    </p>
                  </div>

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
                    onClick={handleCreateLocation}
                    disabled={creatingLocation || !newLocationData.referencia.trim() || !newLocationData.latlong.trim()}
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
                        Guardar ubicación
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
