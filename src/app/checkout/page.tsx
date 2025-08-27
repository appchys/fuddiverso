'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { validateEcuadorianPhone } from '@/lib/validation'
import { createOrder, getBusiness, searchClientByPhone, createClient } from '@/lib/database'
import { Business } from '@/types'


function SearchParamsHandler({ children }: { children: (searchParams: URLSearchParams) => React.ReactNode }) {
  const searchParams = useSearchParams();

  return (
    <Suspense fallback={<div>Cargando...</div>}>
      {children(searchParams)}
    </Suspense>
  );
}

export default function CheckoutPage() {
  const searchParams = useSearchParams();

  // client-only guard state
  const [isClient, setIsClient] = useState(false);

  // Navigation hooks (must be called unconditionally to keep hook order stable)
  const router = useRouter();

  // Page state hooks
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [business, setBusiness] = useState<Business | null>(null);

  const [customerData, setCustomerData] = useState({
    name: '',
    phone: ''
  });
  const [clientSearching, setClientSearching] = useState(false);
  const [clientFound, setClientFound] = useState<any>(null);
  const [showNameField, setShowNameField] = useState(false);
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

  // Effects (also must be declared consistently)
  useEffect(() => { setIsClient(true); }, []);

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
    if (!phone.trim() || !validateEcuadorianPhone(phone)) {
      setClientFound(null);
      setShowNameField(false);
      return;
    }

    setClientSearching(true);
    try {
      const client = await searchClientByPhone(phone);
      if (client) {
        setClientFound(client);
        setCustomerData(prev => ({
          ...prev,
          name: client.nombres || ''
        }));
        setShowNameField(false);
      } else {
        setClientFound(null);
        setShowNameField(true);
        setCustomerData(prev => ({
          ...prev,
          name: ''
        }));
      }
    } catch (error) {
      console.error('Error searching client:', error);
      setClientFound(null);
      setShowNameField(true);
    } finally {
      setClientSearching(false);
    }
  }

  // Función para crear nuevo cliente
  async function handleCreateClient() {
    if (!customerData.phone || !customerData.name) {
      return;
    }

    try {
      const newClient = await createClient({
        Celular: customerData.phone,
        Nombres: customerData.name
      });
      setClientFound(newClient);
      setShowNameField(false);
    } catch (error) {
      console.error('Error creating client:', error);
    }
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
      } else if (!validateEcuadorianPhone(customerData.phone)) {
        newErrors.phone = 'Ingrese un número de celular ecuatoriano válido'
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

  const handlePrevious = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1)
    }
  }

  const handleConfirmOrder = async () => {
    if (!validateStep(currentStep) || !business) {
      return
    }

    setLoading(true)

    try {
      const deliveryTime = timingData.type === 'immediate' 
        ? 'Lo antes posible' 
        : `${timingData.scheduledDate} ${timingData.scheduledTime}`

      const orderData = {
        businessId: business.id,
        customer: {
          name: customerData.name,
          phone: customerData.phone
        },
        items: cartItems.map((item: any) => ({
          product: {
            id: item.id,
            name: item.name,
            price: item.price,
            businessId: business.id,
            description: item.description || '',
            category: item.category || '',
            isAvailable: true,
            createdAt: new Date(),
            updatedAt: new Date()
          },
          quantity: item.quantity,
          subtotal: item.price * item.quantity
        })),
        delivery: {
          type: deliveryData.type,
          references: deliveryData.type === 'delivery' ? deliveryData.address : undefined
        },
        timing: {
          type: timingData.type,
          scheduledDate: timingData.type === 'scheduled' ? new Date(timingData.scheduledDate!) : undefined,
          scheduledTime: timingData.type === 'scheduled' ? timingData.scheduledTime : undefined
        },
        payment: {
          method: paymentData.method,
          bankAccount: paymentData.method === 'transfer' ? business.bankAccount : undefined
        },
        total,
        status: 'pending' as const,
        updatedAt: new Date()
      }

      const orderId = await createOrder(orderData)
      
      // Limpiar carrito
      localStorage.removeItem('cart')
      
      // Mostrar mensaje de éxito
      alert(`¡Pedido confirmado! ID: ${orderId}. El negocio ha sido notificado.`)
      
      // Redirigir a inicio
      router.push('/')

    } catch (error) {
      console.error('Error creating order:', error)
      setErrors({ submit: 'Error al procesar el pedido. Intenta nuevamente.' })
    } finally {
      setLoading(false)
    }
  }

  const steps = [
    'Datos del Cliente',
    'Tipo de Entrega',
    'Fecha y Hora',
    'Método de Pago',
    'Resumen'
  ]

  if (cartItems.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600">No tienes productos en tu carrito</p>
          <Link href="/" className="text-red-600 hover:text-red-700 mt-2 inline-block">
            Volver a inicio
          </Link>
        </div>
      </div>
    )
  }

  return (
    <SearchParamsHandler>
      {(searchParams) => {
        const businessIdFromQuery = searchParams.get('businessId');

        useEffect(() => {
          // Cargar datos del negocio y carrito desde localStorage
          const cartRaw = typeof window !== 'undefined' ? localStorage.getItem('cart') : null;

          if (!cartRaw && !businessIdFromQuery) {
            router.push('/');
            return;
          }

          let derivedBusinessId = businessIdFromQuery;
          if (!derivedBusinessId && cartRaw) {
            try {
              const parsed = JSON.parse(cartRaw);
              if (Array.isArray(parsed) && parsed.length > 0) {
                derivedBusinessId = parsed[0].businessId || null;
              }
            } catch (e) {
              console.error('Error parsing cart from localStorage', e);
            }
          }

          if (!derivedBusinessId) {
            router.push('/');
            return;
          }

          // Load business data
          loadBusinessData(derivedBusinessId);
        }, [businessIdFromQuery, router]);

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
            } else if (!validateEcuadorianPhone(customerData.phone)) {
              newErrors.phone = 'Ingrese un número de celular ecuatoriano válido'
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

        const handlePrevious = () => {
          if (currentStep > 1) {
            setCurrentStep(currentStep - 1)
          }
        }

        const handleConfirmOrder = async () => {
          if (!validateStep(currentStep) || !business) {
            return
          }

          setLoading(true)

          try {
            const deliveryTime = timingData.type === 'immediate' 
              ? 'Lo antes posible' 
              : `${timingData.scheduledDate} ${timingData.scheduledTime}`

            const orderData = {
              businessId: business.id,
              customer: {
                name: customerData.name,
                phone: customerData.phone
              },
              items: cartItems.map((item: any) => ({
                product: {
                  id: item.id,
                  name: item.name,
                  price: item.price,
                  businessId: business.id,
                  description: item.description || '',
                  category: item.category || '',
                  isAvailable: true,
                  createdAt: new Date(),
                  updatedAt: new Date()
                },
                quantity: item.quantity,
                subtotal: item.price * item.quantity
              })),
              delivery: {
                type: deliveryData.type,
                references: deliveryData.type === 'delivery' ? deliveryData.address : undefined
              },
              timing: {
                type: timingData.type,
                scheduledDate: timingData.type === 'scheduled' ? new Date(timingData.scheduledDate!) : undefined,
                scheduledTime: timingData.type === 'scheduled' ? timingData.scheduledTime : undefined
              },
              payment: {
                method: paymentData.method,
                bankAccount: paymentData.method === 'transfer' ? business.bankAccount : undefined
              },
              total,
              status: 'pending' as const,
              updatedAt: new Date()
            }

            const orderId = await createOrder(orderData)
            
            // Limpiar carrito
            localStorage.removeItem('cart')
            
            // Mostrar mensaje de éxito
            alert(`¡Pedido confirmado! ID: ${orderId}. El negocio ha sido notificado.`)
            
            // Redirigir a inicio
            router.push('/')

          } catch (error) {
            console.error('Error creating order:', error)
            setErrors({ submit: 'Error al procesar el pedido. Intenta nuevamente.' })
          } finally {
            setLoading(false)
          }
        }

        const steps = [
          'Datos del Cliente',
          'Tipo de Entrega',
          'Fecha y Hora',
          'Método de Pago',
          'Resumen'
        ]

        if (cartItems.length === 0) {
          return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
              <div className="text-center">
                <p className="text-gray-600">No tienes productos en tu carrito</p>
                <Link href="/" className="text-red-600 hover:text-red-700 mt-2 inline-block">
                  Volver a inicio
                </Link>
              </div>
            </div>
          )
        }

        return (
          <div className="min-h-screen bg-gray-50">
            {/* Header */}
            <header className="bg-white shadow-sm">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex justify-between items-center h-16">
                  <div className="flex items-center space-x-4">
                    <Link href="/" className="text-gray-600 hover:text-red-600">
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
                      </svg>
                    </Link>
                    <Link href="/" className="text-2xl font-bold text-red-600">
                      Fuddiverso
                    </Link>
                  </div>
                  <span className="text-gray-600">Checkout</span>
                </div>
              </div>
            </header>

            <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
              {/* Progress Bar */}
              <div className="mb-8">
                <div className="flex items-center justify-between">
                  {steps.map((step, index) => (
                    <div key={index} className="flex items-center">
                      <div className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium ${
                        index + 1 <= currentStep
                          ? 'bg-red-600 text-white'
                          : 'bg-gray-200 text-gray-600'
                      }`}>
                        {index + 1}
                      </div>
                      <span className={`ml-2 text-sm ${
                        index + 1 <= currentStep ? 'text-red-600' : 'text-gray-400'
                      }`}>
                        {step}
                      </span>
                      {index < steps.length - 1 && (
                        <div className={`w-16 h-0.5 mx-4 ${
                          index + 1 < currentStep ? 'bg-red-600' : 'bg-gray-200'
                        }`} />
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Main Content */}
                <div className="lg:col-span-2">
                  <div className="bg-white rounded-lg shadow-md p-6">
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
                              className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-red-500 ${
                                errors.phone ? 'border-red-500' : 'border-gray-300'
                              }`}
                              placeholder="0990815097"
                            />
                            {errors.phone && <p className="text-red-500 text-sm mt-1">{errors.phone}</p>}
                            {clientSearching && (
                              <p className="text-blue-500 text-sm mt-1">Buscando cliente...</p>
                            )}
                            {clientFound && (
                              <div className="mt-2 p-3 bg-green-50 border border-green-200 rounded-md">
                                <p className="text-green-700 text-sm">
                                  ✅ Cliente encontrado: <strong>{(clientFound as any).nombres || 'Nombre no disponible'}</strong>
                                </p>
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
                                placeholder="Ingrese el nombre completo"
                              />
                              {errors.name && <p className="text-red-500 text-sm mt-1">{errors.name}</p>}
                              <p className="text-gray-500 text-sm mt-1">
                                El cliente no existe, ingrese el nombre para crearlo automáticamente
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Step 2: Delivery Type */}
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
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">
                                Dirección de Entrega *
                              </label>
                              <input
                                type="text"
                                required
                                value={deliveryData.address}
                                onChange={(e) => setDeliveryData({...deliveryData, address: e.target.value})}
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
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">
                                Fecha *
                              </label>
                              <input
                                type="date"
                                required
                                value={timingData.scheduledDate}
                                onChange={(e) => setTimingData({...timingData, scheduledDate: e.target.value})}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                              />
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">
                                Hora *
                              </label>
                              <select
                                required
                                value={timingData.scheduledTime}
                                onChange={(e) => setTimingData({...timingData, scheduledTime: e.target.value})}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                              >
                                <option value="">Seleccionar hora</option>
                                <option value="11:00">11:00 AM</option>
                                <option value="11:30">11:30 AM</option>
                                <option value="12:00">12:00 PM</option>
                                <option value="12:30">12:30 PM</option>
                                <option value="13:00">1:00 PM</option>
                                <option value="13:30">1:30 PM</option>
                                <option value="14:00">2:00 PM</option>
                                <option value="14:30">2:30 PM</option>
                                <option value="15:00">3:00 PM</option>
                                <option value="15:30">3:30 PM</option>
                                <option value="16:00">4:00 PM</option>
                                <option value="16:30">4:30 PM</option>
                                <option value="17:00">5:00 PM</option>
                                <option value="17:30">5:30 PM</option>
                                <option value="18:00">6:00 PM</option>
                                <option value="18:30">6:30 PM</option>
                                <option value="19:00">7:00 PM</option>
                                <option value="19:30">7:30 PM</option>
                                <option value="20:00">8:00 PM</option>
                                <option value="20:30">8:30 PM</option>
                                <option value="21:00">9:00 PM</option>
                              </select>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Step 4: Payment */}
                    {currentStep === 4 && (
                      <div>
                        <h2 className="text-2xl font-bold text-gray-900 mb-6">¿Cómo deseas realizar el pago?</h2>

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
                              <div className="text-sm text-gray-600">Paga en efectivo al recibir tu pedido</div>
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
                              <div className="font-medium">Transferencia Bancaria</div>
                              <div className="text-sm text-gray-600">Realiza una transferencia antes de recibir tu pedido</div>
                            </div>
                          </label>
                        </div>

                        {paymentData.method === 'transfer' && (
                          <div className="mt-6 bg-gray-50 p-4 rounded-lg">
                            <h3 className="font-medium mb-3">Datos Bancarios del Negocio</h3>
                            <div className="space-y-2 text-sm">
                              <p><strong>Negocio:</strong> {business?.name}</p>
                              <p><strong>Email:</strong> {business?.email}</p>
                              <p className="text-red-600 font-medium mt-3">
                                Monto a transferir: ${total.toFixed(2)}
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Step 5: Summary */}
                    {currentStep === 5 && (
                      <div>
                        <h2 className="text-2xl font-bold text-gray-900 mb-6">Resumen del Pedido</h2>

                        <div className="space-y-6">
                          {/* Customer Info */}
                          <div>
                            <h3 className="font-medium text-gray-900 mb-2">Datos del Cliente</h3>
                            <p className="text-sm text-gray-600">{customerData.name || (clientFound as any)?.Nombres}</p>
                            <p className="text-sm text-gray-600">{customerData.phone}</p>
                          </div>

                          {/* Delivery Info */}
                          <div>
                            <h3 className="font-medium text-gray-900 mb-2">Entrega</h3>
                            <p className="text-sm text-gray-600">
                              {deliveryData.type === 'delivery' ? 'Delivery' : 'Retiro en tienda'}
                            </p>
                            {deliveryData.type === 'delivery' && deliveryData.address && (
                              <p className="text-sm text-gray-600">Dirección: {deliveryData.address}</p>
                            )}
                          </div>

                          {/* Timing Info */}
                          <div>
                            <h3 className="font-medium text-gray-900 mb-2">Fecha y Hora</h3>
                            <p className="text-sm text-gray-600">
                              {timingData.type === 'immediate'
                                ? 'Entrega inmediata (aprox. 30 min)'
                                : `${timingData.scheduledDate} a las ${timingData.scheduledTime}`
                              }
                            </p>
                          </div>

                          {/* Payment Info */}
                          <div>
                            <h3 className="font-medium text-gray-900 mb-2">Método de Pago</h3>
                            <p className="text-sm text-gray-600">
                              {paymentData.method === 'cash' ? 'Efectivo' : 'Transferencia bancaria'}
                            </p>
                          </div>

                          {/* Items */}
                          <div>
                            <h3 className="font-medium text-gray-900 mb-2">Productos</h3>
                            <div className="space-y-2">
                              {cartItems.map((item: any) => (
                                <div key={item.id} className="flex justify-between text-sm">
                                  <span>{item.quantity}x {item.name}</span>
                                  <span>${(item.price * item.quantity).toFixed(2)}</span>
                                </div>
                              ))}
                              <div className="border-t pt-2 flex justify-between font-medium">
                                <span>Total</span>
                                <span>${total.toFixed(2)}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Navigation Buttons */}
                    <div className="flex justify-between mt-8">
                      <button
                        onClick={handlePrevious}
                        disabled={currentStep === 1}
                        className="px-6 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Anterior
                      </button>

                      {currentStep < 5 ? (
                        <button
                          onClick={handleNext}
                          className="px-6 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
                        >
                          Siguiente
                        </button>
                      ) : (
                        <button
                          onClick={handleConfirmOrder}
                          disabled={loading}
                          className="px-6 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
                        >
                          {loading ? 'Procesando...' : 'Confirmar Pedido'}
                        </button>
                      )}
                    </div>

                    {errors.submit && (
                      <div className="mt-4 p-4 bg-red-100 border border-red-400 text-red-700 rounded">
                        {errors.submit}
                      </div>
                    )}
                  </div>
                </div>

                {/* Order Summary Sidebar */}
                <div className="lg:col-span-1">
                  <div className="bg-white rounded-lg shadow-md p-6 sticky top-8">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">Tu Pedido</h3>
                    <div className="space-y-3 mb-4">
                      {cartItems.map((item: any) => (
                        <div key={item.id} className="flex justify-between text-sm">
                          <div>
                            <span className="font-medium">{item.quantity}x</span>
                            <span className="ml-2">{item.name}</span>
                          </div>
                          <span>${(item.price * item.quantity).toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                    <div className="border-t pt-4">
                      <div className="flex justify-between font-semibold text-lg">
                        <span>Total</span>
                        <span>${total.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      }}
    </SearchParamsHandler>
  )
}
