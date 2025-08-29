'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { validateEcuadorianPhone, normalizeEcuadorianPhone, validateAndNormalizePhone } from '@/lib/validation'
import { createOrder, getBusiness, searchClientByPhone, createClient, FirestoreClient, getClientLocations, ClientLocation } from '@/lib/database'
import { Business } from '@/types'

export default function CheckoutPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-red-500 mx-auto"></div>
          <p className="mt-4 text-gray-600">Cargando checkout...</p>
        </div>
      </div>
    }>
      <CheckoutContent />
    </Suspense>
  )
}

function CheckoutContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  // client-only guard state
  const [isClient, setIsClient] = useState(false);

  // Page state hooks
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [business, setBusiness] = useState<Business | null>(null);

  const [customerData, setCustomerData] = useState({
    name: '',
    phone: ''
  });
  const [clientSearching, setClientSearching] = useState(false);
  const [clientFound, setClientFound] = useState<FirestoreClient | null>(null);
  const [showNameField, setShowNameField] = useState(false);
  const [clientLocations, setClientLocations] = useState<ClientLocation[]>([]);
  const [loadingLocations, setLoadingLocations] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<ClientLocation | null>(null);
  const [deliveryData, setDeliveryData] = useState({
    type: 'delivery' as 'delivery' | 'pickup',
    address: '',
    references: ''
  });
  const [timingData, setTimingData] = useState({
    type: 'immediate' as 'immediate' | 'scheduled',
    scheduledDate: '',
    scheduledTime: ''
  });
  const [paymentData, setPaymentData] = useState({
    method: 'cash' as 'cash' | 'transfer'
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  // Estado para manejar el modal
  const [isLocationModalOpen, setIsLocationModalOpen] = useState(false)

  // Effects (also must be declared consistently)
  useEffect(() => { setIsClient(true); }, []);

  // Función para abrir el modal
  const openLocationModal = () => {
    setIsLocationModalOpen(true);
  };

  // Función para cerrar el modal
  const closeLocationModal = () => {
    setIsLocationModalOpen(false);
  }

  // Función hoisted colocada antes del efecto que la usa
  async function loadBusinessData(businessId: string) {
    try {
      const businessData = await getBusiness(businessId)
      if (businessData) {
        setBusiness(businessData)
      }
    } catch (error) {
      console.error('Error loading business:', error)
    }
  }

  // Función para buscar cliente por teléfono
  async function handlePhoneSearch(phone: string) {
    if (!phone.trim()) {
      setClientFound(null);
      setShowNameField(false);
      setClientLocations([]);
      setSelectedLocation(null);
      return;
    }

    // Normalizar el número de teléfono antes de validar y buscar
    const normalizedPhone = normalizeEcuadorianPhone(phone);
    
    if (!validateEcuadorianPhone(normalizedPhone)) {
      setClientFound(null);
      setShowNameField(false);
      setClientLocations([]);
      setSelectedLocation(null);
      return;
    }

    setClientSearching(true);
    try {
      // Buscar con el número normalizado
      const client = await searchClientByPhone(normalizedPhone);
      if (client) {
        setClientFound(client);
        // Usar el nombre del cliente del objeto cliente
        setCustomerData(prev => ({
          ...prev,
          name: client.nombres || '',
          phone: normalizedPhone // Actualizar con el número normalizado
        }));
        setShowNameField(false);
        
        // Cargar las ubicaciones del cliente
        setLoadingLocations(true);
        try {
          const locations = await getClientLocations(client.id);
          setClientLocations(locations);
          // Seleccionar automáticamente la primera ubicación si existe
          if (locations.length > 0) {
            handleSelectLocation(locations[0]);
          }
        } catch (error) {
          console.error('Error loading client locations:', error);
          setClientLocations([]);
        } finally {
          setLoadingLocations(false);
        }
      } else {
        setClientFound(null);
        setShowNameField(true);
        setCustomerData(prev => ({
          ...prev,
          name: '',
          phone: normalizedPhone // Actualizar con el número normalizado
        }));
        setClientLocations([]);
        setSelectedLocation(null);
      }
    } catch (error) {
      console.error('Error searching client:', error);
      setClientFound(null);
      setShowNameField(true);
      setClientLocations([]);
      setSelectedLocation(null);
    } finally {
      setClientSearching(false);
    }
  }

  // Función para crear nuevo cliente
  async function handleCreateClient() {
    if (!customerData.phone || !customerData.name) {
      return;
    }

    // Normalizar el número antes de crear el cliente
    const normalizedPhone = normalizeEcuadorianPhone(customerData.phone);

    try {
      const newClient = await createClient({
        celular: normalizedPhone,
        nombres: customerData.name,
        fecha_de_registro: new Date().toISOString()
      });
      
      // Actualizar el estado con el cliente recién creado
      setClientFound({
        id: newClient.id,
        nombres: customerData.name,
        celular: normalizedPhone,
        fecha_de_registro: new Date().toISOString()
      });
      
      // Actualizar customerData con el número normalizado
      setCustomerData(prev => ({
        ...prev,
        phone: normalizedPhone
      }));
      
      setShowNameField(false);
    } catch (error) {
      console.error('Error creating client:', error);
      // Aquí podrías agregar manejo de errores para mostrar al usuario
    }
  }

  // Función para seleccionar una ubicación del cliente
  const handleSelectLocation = (location: ClientLocation) => {
    setSelectedLocation(location);
    setDeliveryData(prev => ({
      ...prev,
      address: location.referencia,
      references: `${location.sector} - ${location.ubicacion}`
    }));
  }

  useEffect(() => {
    // Cargar datos del negocio y carrito desde localStorage
    const businessIdFromQuery = searchParams.get('businessId')
    const cartRaw = typeof window !== 'undefined' ? localStorage.getItem('cart') : null

    // Si no hay carrito ni businessId, redirigir
    if (!cartRaw && !businessIdFromQuery) {
      router.push('/')
      return
    }

    let derivedBusinessId = businessIdFromQuery
    if (!derivedBusinessId && cartRaw) {
      try {
        const parsed = JSON.parse(cartRaw)
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Asumir que los items tienen businessId y tomar el del primer item
          derivedBusinessId = parsed[0].businessId || null
        }
      } catch (e) {
        console.error('Error parsing cart from localStorage', e)
      }
    }

    if (!derivedBusinessId) {
      // Si no logramos derivar un businessId válido, redirigimos
      router.push('/')
      return
    }

    loadBusinessData(derivedBusinessId)
  }, [searchParams, router])

  // Client-only guard: render nothing until mounted on client
  if (!isClient) return null;

  // Cargar datos del carrito desde localStorage
  const getCartItems = () => {
    const cartData = localStorage.getItem('cart')
    return cartData ? JSON.parse(cartData) : []
  }

  const cartItems = getCartItems()
  const total = cartItems.reduce((sum: number, item: any) => sum + (item.price * item.quantity), 0)

  const validateStep = (step: number) => {
    const newErrors: Record<string, string> = {}

    if (step === 1) {
      if (!customerData.phone.trim()) {
        newErrors.phone = 'El teléfono es requerido'
      } else {
        // Normalizar y validar el número de teléfono
        const normalizedPhone = normalizeEcuadorianPhone(customerData.phone);
        if (!validateEcuadorianPhone(normalizedPhone)) {
          newErrors.phone = 'Ingrese un número de celular ecuatoriano válido'
        }
      }
      if (showNameField && !customerData.name.trim()) {
        newErrors.name = 'El nombre es requerido'
      }
    }

    if (step === 2 && deliveryData.type === 'delivery') {
      if (!deliveryData.address.trim()) {
        newErrors.address = 'La dirección es requerida para delivery'
      }
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleNext = () => {
    if (validateStep(currentStep)) {
      if (currentStep < 5) {
        setCurrentStep(currentStep + 1)
      }
    }
  }

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1)
    }
  }

  const handleSubmit = async () => {
    if (!validateStep(currentStep)) return

    setLoading(true)
    try {
      // Crear cliente si no está creado y es necesario
      if (showNameField && customerData.name.trim()) {
        await handleCreateClient()
      }

      // Calcular tiempo de entrega
      const deliveryTime = timingData.type === 'immediate' 
        ? new Date(Date.now() + 30 * 60000).toISOString() // 30 minutos
        : new Date(`${timingData.scheduledDate}T${timingData.scheduledTime}`).toISOString()

      const orderData = {
        businessId: searchParams.get('businessId') || '',
        items: cartItems,
        customer: {
          name: customerData.name,
          phone: customerData.phone
        },
        delivery: {
          type: deliveryData.type,
          references: deliveryData.type === 'delivery' ? deliveryData.address : undefined
        },
        timing: {
          type: timingData.type,
          scheduledTime: deliveryTime
        },
        payment: {
          method: paymentData.method
        },
        total,
        status: 'pending' as 'pending',
        updatedAt: new Date()
      }

      await createOrder(orderData)
      
      // Limpiar carrito
      localStorage.removeItem('cart')
      
      // Redirigir a página de confirmación
      router.push(`/order-confirmation?orderId=12345`)
    } catch (error) {
      console.error('Error creating order:', error)
    } finally {
      setLoading(false)
    }
  }

  // No mostrar nada si el carrito está vacío
  if (cartItems.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Tu carrito está vacío</h1>
          <p className="text-gray-600 mb-6">Agrega algunos productos antes de proceder al checkout</p>
          <Link
            href="/"
            className="inline-block bg-red-500 text-white px-6 py-3 rounded-lg hover:bg-red-600"
          >
            Volver a inicio
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto py-4 sm:py-8 px-4">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-md p-4 sm:p-6 mb-4 sm:mb-6">
          <div className="flex flex-col items-center gap-4">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Checkout</h1>
            
            {/* Progress Steps with Icons */}
            <div className="flex items-center justify-between w-full max-w-2xl">
              {/* Step 1 - Cliente */}
              <div className="flex flex-col items-center flex-1">
                <button
                  onClick={() => setCurrentStep(1)}
                  className={`w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center transition-all hover:scale-110 ${
                    1 <= currentStep ? 'bg-red-500 text-white' : 'bg-gray-300 text-gray-600 hover:bg-gray-400'
                  }`}
                >
                  <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                  </svg>
                </button>
                <span className="text-xs sm:text-sm mt-1 text-center font-medium">Cliente</span>
              </div>

              <div className="flex-1 h-px bg-gray-300 mx-2"></div>

              {/* Step 2 - Entrega */}
              <div className="flex flex-col items-center flex-1">
                <button
                  onClick={() => currentStep >= 2 && setCurrentStep(2)}
                  disabled={currentStep < 2}
                  className={`w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center transition-all ${
                    currentStep >= 2 ? 'hover:scale-110 cursor-pointer' : 'cursor-not-allowed'
                  } ${
                    2 <= currentStep ? 'bg-red-500 text-white' : 'bg-gray-300 text-gray-600'
                  } ${currentStep >= 2 && currentStep !== 2 ? 'hover:bg-red-600' : ''}`}
                >
                  {deliveryData.type === 'pickup' ? (
                    <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M4 4a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2H4zm3 6V7h6v3H7z" clipRule="evenodd" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M8 5a1 1 0 100 2h5.586l-1.293 1.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L13.586 5H8zM12 15a1 1 0 100-2H6.414l1.293-1.293a1 1 0 10-1.414-1.414l-3 3a1 1 0 000 1.414l3 3a1 1 0 001.414-1.414L6.414 15H12z" />
                    </svg>
                  )}
                </button>
                <span className="text-xs sm:text-sm mt-1 text-center font-medium">
                  {deliveryData.type === 'pickup' ? 'Retiro' : 'Delivery'}
                </span>
              </div>

              <div className="flex-1 h-px bg-gray-300 mx-2"></div>

              {/* Step 3 - Horario */}
              <div className="flex flex-col items-center flex-1">
                <button
                  onClick={() => currentStep >= 3 && setCurrentStep(3)}
                  disabled={currentStep < 3}
                  className={`w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center transition-all ${
                    currentStep >= 3 ? 'hover:scale-110 cursor-pointer' : 'cursor-not-allowed'
                  } ${
                    3 <= currentStep ? 'bg-red-500 text-white' : 'bg-gray-300 text-gray-600'
                  } ${currentStep >= 3 && currentStep !== 3 ? 'hover:bg-red-600' : ''}`}
                >
                  {timingData.type === 'immediate' ? (
                    <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" />
                    </svg>
                  )}
                </button>
                <span className="text-xs sm:text-sm mt-1 text-center font-medium">
                  {timingData.type === 'immediate' ? 'Inmediato' : 'Programado'}
                </span>
              </div>

              <div className="flex-1 h-px bg-gray-300 mx-2"></div>

              {/* Step 4 - Pago */}
              <div className="flex flex-col items-center flex-1">
                <button
                  onClick={() => currentStep >= 4 && setCurrentStep(4)}
                  disabled={currentStep < 4}
                  className={`w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center transition-all ${
                    currentStep >= 4 ? 'hover:scale-110 cursor-pointer' : 'cursor-not-allowed'
                  } ${
                    4 <= currentStep ? 'bg-red-500 text-white' : 'bg-gray-300 text-gray-600'
                  } ${currentStep >= 4 && currentStep !== 4 ? 'hover:bg-red-600' : ''}`}
                >
                  {paymentData.method === 'transfer' ? (
                    <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M4 4a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2H4zm5 3a1 1 0 011-1h1a1 1 0 110 2h-1a1 1 0 01-1-1zm-1 4a1 1 0 100 2h3a1 1 0 100-2H8z" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M8.433 7.418c.155-.103.346-.196.567-.267v1.698a2.305 2.305 0 01-.567-.267C8.07 8.34 8 8.114 8 8c0-.114.07-.34.433-.582zM11 12.849v-1.698c.22.071.412.164.567.267.364.243.433.468.433.582 0 .114-.07.34-.433.582a2.305 2.305 0 01-.567.267z" />
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-13a1 1 0 10-2 0v.092a4.535 4.535 0 00-1.676.662C6.602 6.234 6 7.009 6 8c0 .99.602 1.765 1.324 2.246.48.32 1.054.545 1.676.662v1.941c-.391-.127-.68-.317-.843-.504a1 1 0 10-1.51 1.31c.562.649 1.413 1.076 2.353 1.253V15a1 1 0 102 0v-.092a4.535 4.535 0 001.676-.662C13.398 13.766 14 12.991 14 12c0-.99-.602-1.765-1.324-2.246A4.535 4.535 0 0011 9.092V7.151c.391.127.68.317.843.504a1 1 0 101.511-1.31c-.563-.649-1.413-1.076-2.354-1.253V5z" clipRule="evenodd" />
                    </svg>
                  )}
                </button>
                <span className="text-xs sm:text-sm mt-1 text-center font-medium">
                  {paymentData.method === 'transfer' ? 'Transferencia' : 'Efectivo'}
                </span>
              </div>

              <div className="flex-1 h-px bg-gray-300 mx-2"></div>

              {/* Step 5 - Confirmar */}
              <div className="flex flex-col items-center flex-1">
                <button
                  onClick={() => currentStep >= 5 && setCurrentStep(5)}
                  disabled={currentStep < 5}
                  className={`w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center transition-all ${
                    currentStep >= 5 ? 'hover:scale-110 cursor-pointer' : 'cursor-not-allowed'
                  } ${
                    5 <= currentStep ? 'bg-red-500 text-white' : 'bg-gray-300 text-gray-600'
                  } ${currentStep >= 5 && currentStep !== 5 ? 'hover:bg-red-600' : ''}`}
                >
                  <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                </button>
                <span className="text-xs sm:text-sm mt-1 text-center font-medium">Confirmar</span>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
          {/* Main Content */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-lg shadow-md p-4 sm:p-6">

              {/* Step 1: Customer Data */}
              {currentStep === 1 && (
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 mb-6">Datos del Cliente</h2>
                  
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Número de Celular *
                      </label>
                      <input
                        type="tel"
                        required
                        value={customerData.phone}
                        onChange={(e) => {
                          const phone = e.target.value;
                          setCustomerData({...customerData, phone});
                          handlePhoneSearch(phone);
                        }}
                        onBlur={(e) => {
                          // Al perder el foco, normalizar el número si es válido
                          const phone = e.target.value;
                          const normalizedPhone = normalizeEcuadorianPhone(phone);
                          if (validateEcuadorianPhone(normalizedPhone)) {
                            setCustomerData({...customerData, phone: normalizedPhone});
                          }
                        }}
                        className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-red-500 ${
                          errors.phone ? 'border-red-500' : 'border-gray-300'
                        }`}
                        placeholder="Ej: +593 95 903 6708 o 0959036708"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Lo buscaremos en nuestros datos, lo usaremos para coordinar la entrega
                      </p>
                      {errors.phone && <p className="text-red-500 text-sm mt-1">{errors.phone}</p>}
                      {clientSearching && (
                        <p className="text-blue-500 text-sm mt-1">Buscando cliente...</p>
                      )}
                      {clientFound && (
                        <div className="mt-3 p-4 bg-green-50 border border-green-200 rounded-lg">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-3">
                              <div className="flex-shrink-0">
                                <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                                  <svg className="w-5 h-5 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                                  </svg>
                                </div>
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-green-900 truncate">
                                  {clientFound.nombres}
                                </p>
                                <p className="text-sm text-green-700">
                                  {customerData.phone}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center space-x-2">
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                </svg>
                                Verificado
                              </span>
                            </div>
                          </div>
                          {business && (
                            <p className="mt-2 text-xs text-green-600">
                              Verificado por {business.name}
                            </p>
                          )}
                        </div>
                      )}
                    </div>

                    {showNameField && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Nombre Completo *
                        </label>
                        <input
                          type="text"
                          required
                          value={customerData.name}
                          onChange={(e) => setCustomerData({...customerData, name: e.target.value})}
                          onBlur={handleCreateClient}
                          className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-red-500 ${
                            errors.name ? 'border-red-500' : 'border-gray-300'
                          }`}
                          placeholder="Juan Pérez"
                        />
                        {errors.name && <p className="text-red-500 text-sm mt-1">{errors.name}</p>}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Step 2: Delivery */}
              {currentStep === 2 && (
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 mb-6">¿Cómo deseas recibir tu pedido?</h2>

                  <div className="space-y-4 mb-6">
                    <label className="flex items-center p-4 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50">
                      <input
                        type="radio"
                        name="deliveryType"
                        value="delivery"
                        checked={deliveryData.type === 'delivery'}
                        onChange={(e) => setDeliveryData({...deliveryData, type: e.target.value as 'delivery'})}
                        className="mr-3"
                      />
                      <div>
                        <div className="font-medium">Delivery</div>
                        <div className="text-sm text-gray-600">Te llevamos el pedido a tu ubicación</div>
                      </div>
                    </label>

                    <label className="flex items-center p-4 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50">
                      <input
                        type="radio"
                        name="deliveryType"
                        value="pickup"
                        checked={deliveryData.type === 'pickup'}
                        onChange={(e) => setDeliveryData({...deliveryData, type: e.target.value as 'pickup'})}
                        className="mr-3"
                      />
                      <div>
                        <div className="font-medium">Retiro en Tienda</div>
                        <div className="text-sm text-gray-600">Recoges tu pedido en el restaurante</div>
                      </div>
                    </label>
                  </div>

                  {deliveryData.type === 'delivery' && (
                    <div className="space-y-4">
                      {/* Mostrar ubicación seleccionada y botón para abrir modal */}
                      {clientFound && clientLocations.length > 0 && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Ubicación Seleccionada
                          </label>
                          {loadingLocations ? (
                            <div className="text-sm text-gray-500">Cargando ubicaciones...</div>
                          ) : (
                            <div className="mb-4">
                              <div className="flex items-center space-x-2">
                                <div className="flex-1 p-3 border border-gray-300 rounded-lg bg-gray-50">
                                  <div className="font-medium text-sm mb-1">
                                    📍 {selectedLocation?.referencia || 'Ninguna ubicación seleccionada'}
                                  </div>
                                  {selectedLocation && (
                                    <>
                                      <div className="text-xs text-gray-600 mb-1">
                                        🗺️ Coordenadas: {selectedLocation.ubicacion}
                                      </div>
                                      <div className="text-xs text-gray-500">
                                        🏘️ Sector: {selectedLocation.sector} | 💰 Tarifa: ${selectedLocation.tarifa}
                                      </div>
                                    </>
                                  )}
                                </div>
                                <button
                                  type="button"
                                  onClick={openLocationModal}
                                  className="px-3 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 flex items-center"
                                >
                                  <svg
                                    className="w-4 h-4"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth={2}
                                      d="M19 9l-7 7-7-7"
                                    />
                                  </svg>
                                </button>
                              </div>
                            </div>
                          )}
                          <div className="text-sm text-gray-600 mb-3">
                            O ingresa una nueva dirección:
                          </div>
                        </div>
                      )}
                      
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Dirección de Entrega *
                        </label>
                        <input
                          type="text"
                          required
                          value={deliveryData.address}
                          onChange={(e) => {
                            setDeliveryData({...deliveryData, address: e.target.value});
                            setSelectedLocation(null); // Limpiar selección si se escribe manualmente
                          }}
                          className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-red-500 ${
                            errors.address ? 'border-red-500' : 'border-gray-300'
                          }`}
                          placeholder="Av. Principal #123, Sector Centro"
                        />
                        {errors.address && <p className="text-red-500 text-sm mt-1">{errors.address}</p>}
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Referencias de Ubicación
                        </label>
                        <input
                          type="text"
                          value={deliveryData.references}
                          onChange={(e) => setDeliveryData({...deliveryData, references: e.target.value})}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                          placeholder="Casa blanca, portón negro, frente al supermercado..."
                        />
                      </div>
                    </div>
                  )}

                  {deliveryData.type === 'pickup' && (
                    <div className="bg-gray-50 p-4 rounded-lg">
                      <h3 className="font-medium mb-2">Información del Negocio</h3>
                      <p className="text-sm text-gray-600 mb-2"><strong>Dirección:</strong> {business?.address}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Step 3: Timing */}
              {currentStep === 3 && (
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 mb-6">¿Cuándo deseas recibir tu pedido?</h2>

                  <div className="space-y-4 mb-6">
                    <label className="flex items-center p-4 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50">
                      <input
                        type="radio"
                        name="timingType"
                        value="immediate"
                        checked={timingData.type === 'immediate'}
                        onChange={(e) => setTimingData({...timingData, type: e.target.value as 'immediate'})}
                        className="mr-3"
                      />
                      <div>
                        <div className="font-medium">Inmediata</div>
                        <div className="text-sm text-gray-600">Aproximadamente 30 minutos</div>
                      </div>
                    </label>

                    <label className="flex items-center p-4 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50">
                      <input
                        type="radio"
                        name="timingType"
                        value="scheduled"
                        checked={timingData.type === 'scheduled'}
                        onChange={(e) => setTimingData({...timingData, type: e.target.value as 'scheduled'})}
                        className="mr-3"
                      />
                      <div>
                        <div className="font-medium">Programada</div>
                        <div className="text-sm text-gray-600">Elige fecha y hora específica</div>
                      </div>
                    </label>
                  </div>

                  {timingData.type === 'scheduled' && (
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Fecha de Entrega
                        </label>
                        <input
                          type="date"
                          value={timingData.scheduledDate}
                          onChange={(e) => setTimingData({...timingData, scheduledDate: e.target.value})}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                          min={new Date().toISOString().split('T')[0]}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Hora de Entrega
                        </label>
                        <input
                          type="time"
                          value={timingData.scheduledTime}
                          onChange={(e) => setTimingData({...timingData, scheduledTime: e.target.value})}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Step 4: Payment */}
              {currentStep === 4 && (
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 mb-6">Método de Pago</h2>

                  <div className="space-y-4">
                    <label className="flex items-center p-4 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50">
                      <input
                        type="radio"
                        name="paymentMethod"
                        value="cash"
                        checked={paymentData.method === 'cash'}
                        onChange={(e) => setPaymentData({...paymentData, method: e.target.value as 'cash'})}
                        className="mr-3"
                      />
                      <div>
                        <div className="font-medium">Efectivo</div>
                        <div className="text-sm text-gray-600">Paga cuando recibas tu pedido</div>
                      </div>
                    </label>

                    <label className="flex items-center p-4 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50">
                      <input
                        type="radio"
                        name="paymentMethod"
                        value="transfer"
                        checked={paymentData.method === 'transfer'}
                        onChange={(e) => setPaymentData({...paymentData, method: e.target.value as 'transfer'})}
                        className="mr-3"
                      />
                      <div>
                        <div className="font-medium">Transferencia</div>
                        <div className="text-sm text-gray-600">Transfiere a nuestra cuenta bancaria</div>
                      </div>
                    </label>
                  </div>

                  {paymentData.method === 'transfer' && business?.bankAccount && (
                    <div className="mt-6 bg-gray-50 p-4 rounded-lg">
                      <h3 className="font-medium mb-2">Datos Bancarios</h3>
                      <div className="text-sm text-gray-600 space-y-1">
                        <p><strong>Banco:</strong> {business.bankAccount.bankName}</p>
                        <p><strong>Tipo de Cuenta:</strong> {business.bankAccount.accountType}</p>
                        <p><strong>Número de Cuenta:</strong> {business.bankAccount.accountNumber}</p>
                        <p><strong>Titular:</strong> {business.bankAccount.accountHolder}</p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Step 5: Confirmation */}
              {currentStep === 5 && (
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 mb-6">Confirmar Pedido</h2>

                  <div className="space-y-6">
                    <div>
                      <h3 className="font-medium text-lg mb-2">Datos del Cliente</h3>
                      <div className="bg-gray-50 p-4 rounded-lg">
                        <p className="text-sm"><strong>Nombre:</strong> {customerData.name}</p>
                        <p className="text-sm"><strong>Teléfono:</strong> {customerData.phone}</p>
                      </div>
                    </div>

                    <div>
                      <h3 className="font-medium text-lg mb-2">Entrega</h3>
                      <div className="bg-gray-50 p-4 rounded-lg">
                        <p className="text-sm"><strong>Tipo:</strong> {deliveryData.type === 'delivery' ? 'Delivery' : 'Retiro en tienda'}</p>
                        {deliveryData.type === 'delivery' && (
                          <>
                            <p className="text-sm"><strong>Dirección:</strong> {deliveryData.address}</p>
                            {deliveryData.references && (
                              <p className="text-sm"><strong>Referencias:</strong> {deliveryData.references}</p>
                            )}
                          </>
                        )}
                      </div>
                    </div>

                    <div>
                      <h3 className="font-medium text-lg mb-2">Horario</h3>
                      <div className="bg-gray-50 p-4 rounded-lg">
                        <p className="text-sm">
                          <strong>Entrega:</strong> {timingData.type === 'immediate' ? 'Inmediata (30 min aprox.)' : `${timingData.scheduledDate} a las ${timingData.scheduledTime}`}
                        </p>
                      </div>
                    </div>

                    <div>
                      <h3 className="font-medium text-lg mb-2">Pago</h3>
                      <div className="bg-gray-50 p-4 rounded-lg">
                        <p className="text-sm">
                          <strong>Método:</strong> {paymentData.method === 'cash' ? 'Efectivo' : 'Transferencia'}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Navigation Buttons - Mobile Optimized */}
              <div className="flex flex-col sm:flex-row justify-between gap-3 sm:gap-0 mt-6 sm:mt-8">
                <button
                  onClick={handleBack}
                  disabled={currentStep === 1}
                  className={`order-2 sm:order-1 px-4 sm:px-6 py-3 sm:py-2 rounded-lg touch-manipulation text-sm sm:text-base ${
                    currentStep === 1
                      ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                      : 'bg-gray-500 text-white hover:bg-gray-600 active:bg-gray-700'
                  }`}
                >
                  Anterior
                </button>

                {currentStep < 5 ? (
                  <button
                    onClick={handleNext}
                    className="order-1 sm:order-2 px-4 sm:px-6 py-3 sm:py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 active:bg-red-700 touch-manipulation text-sm sm:text-base font-medium"
                  >
                    Siguiente
                  </button>
                ) : (
                  <button
                    onClick={handleSubmit}
                    disabled={loading}
                    className={`order-1 sm:order-2 px-4 sm:px-6 py-3 sm:py-2 rounded-lg touch-manipulation text-sm sm:text-base font-medium ${
                      loading
                        ? 'bg-gray-400 cursor-not-allowed'
                        : 'bg-green-500 hover:bg-green-600 active:bg-green-700'
                    } text-white`}
                  >
                    {loading ? 'Procesando...' : 'Confirmar Pedido'}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Sidebar - Responsive Order Summary */}
          <div className="lg:space-y-6 space-y-4">
            {/* Order Summary */}
            <div className="bg-white rounded-lg shadow-md p-4 sm:p-6">
              <h3 className="text-base sm:text-lg font-medium text-gray-900 mb-3 sm:mb-4">Resumen del Pedido</h3>
              
              <div className="space-y-2 sm:space-y-3">
                {cartItems.map((item: any, index: number) => (
                  <div key={index} className="flex justify-between items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{item.name}</p>
                      <p className="text-xs text-gray-500">Cantidad: {item.quantity}</p>
                    </div>
                    <p className="text-sm font-medium shrink-0">${(item.price * item.quantity).toFixed(2)}</p>
                  </div>
                ))}
              </div>

              <div className="border-t pt-3 mt-3">
                <div className="flex justify-between items-center">
                  <p className="text-base sm:text-lg font-bold">Total</p>
                  <p className="text-base sm:text-lg font-bold text-red-500">${total.toFixed(2)}</p>
                </div>
              </div>
            </div>

            {/* Business Info */}
            {business && (
              <div className="bg-white rounded-lg shadow-md p-4 sm:p-6">
                <h3 className="text-base sm:text-lg font-medium text-gray-900 mb-3 sm:mb-4">Información del Negocio</h3>
                <div className="space-y-2">
                  <p className="text-sm"><strong>Nombre:</strong> {business.name}</p>
                  <p className="text-sm"><strong>Dirección:</strong> {business.address}</p>
                  <p className="text-sm"><strong>Teléfono:</strong> {business.phone}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Modal para mostrar ubicaciones registradas - Mobile Optimized */}
        {isLocationModalOpen && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center z-50 p-4">
            <div className="bg-white rounded-t-lg sm:rounded-lg shadow-lg w-full max-w-md mx-auto p-4 sm:p-6 max-h-[90vh] sm:max-h-[80vh] flex flex-col">
              <div className="flex justify-between items-center mb-4 pb-3 border-b sm:border-b-0 sm:pb-0">
                <h2 className="text-lg font-bold">Selecciona una ubicación</h2>
                <button
                  onClick={closeLocationModal}
                  className="text-gray-400 hover:text-gray-600 p-1"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="space-y-3 overflow-y-auto flex-1 -mx-2 px-2">
                {clientLocations.map((location) => (
                  <div
                    key={location.id}
                    className={`p-3 sm:p-4 border rounded-lg cursor-pointer transition-colors touch-manipulation ${
                      selectedLocation?.id === location.id
                        ? 'border-red-500 bg-red-50'
                        : 'border-gray-300 hover:bg-gray-50 active:bg-gray-100'
                    }`}
                    onClick={() => {
                      handleSelectLocation(location);
                      closeLocationModal();
                    }}
                  >
                    <div className="font-medium text-sm mb-2">
                      📍 {location.referencia}
                    </div>
                    <div className="text-xs text-gray-600 mb-2">
                      🗺️ Coordenadas: {location.ubicacion}
                    </div>
                    <div className="text-xs text-gray-500 flex flex-wrap gap-3">
                      <span>🏘️ {location.sector}</span>
                      <span>💰 Tarifa: ${location.tarifa}</span>
                    </div>
                    {selectedLocation?.id === location.id && (
                      <div className="mt-2 text-xs text-red-600 font-medium">
                        ✓ Seleccionada
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-4 pt-3 border-t sm:border-t-0 sm:pt-4">
                <button
                  className="w-full bg-gray-200 text-gray-700 py-3 rounded-lg hover:bg-gray-300 active:bg-gray-400 transition-colors touch-manipulation"
                  onClick={closeLocationModal}
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
