'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { validateEcuadorianPhone, normalizeEcuadorianPhone } from '@/lib/validation'
import {
  createOrder,
  getBusiness,
  searchClientByPhone,
  createClient,
  updateClient,
  getClientLocations,
  ClientLocation,
  getDeliveryFeeForLocation,
  registerOrderConsumption,
  getQRCodesByBusiness,
  getUserQRProgress,
  completeQRRedemptions,
  serverTimestamp,
  updateCheckoutProgress,
  clearCheckoutProgress,
  getDeliveriesByStatus,
  getCoverageZones,
  isPointInPolygon
} from '@/lib/database'
import { Business } from '@/types'
import LocationMap from '@/components/LocationMap'
import LocationSelectionModal from '@/components/LocationSelectionModal'
import { useAuth } from '@/contexts/AuthContext'
import { storage } from '@/lib/firebase'
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { optimizeImage } from '@/lib/image-utils'
import { Timestamp } from 'firebase/firestore'
import { isStoreOpen, isSpecificTimeOpen, getStoreScheduleForDate, getNextAvailableSlot } from '@/lib/store-utils'

// Componente para subir comprobante de transferencia
function TransferReceiptUploader({
  onReceiptUpload,
  uploadedImageUrl,
  isUploading,
  clientId
}: {
  onReceiptUpload: (imageUrl: string) => void;
  uploadedImageUrl: string | null;
  isUploading: boolean;
  clientId: string;
}) {
  const [dragActive, setDragActive] = useState(false)
  const [previewImage, setPreviewImage] = useState<string | null>(uploadedImageUrl)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setPreviewImage(uploadedImageUrl)
  }, [uploadedImageUrl])

  const validateFile = (file: File): boolean => {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
    const maxSize = 5 * 1024 * 1024 // 5MB

    if (!allowedTypes.includes(file.type)) {
      setError('Solo se permiten archivos de imagen (JPG, PNG, WEBP)')
      return false
    }

    if (file.size > maxSize) {
      setError('El archivo debe ser menor a 5MB')
      return false
    }

    setError('')
    return true
  }

  const handleFileUpload = async (file: File) => {
    if (!validateFile(file)) return

    try {
      // Optimizar imagen antes de subir (maxWidth=1200 por defecto para comprobantes, calidad 0.7)
      const optimizedBlob = await optimizeImage(file, 1200, 0.7)

      // Crear un nuevo archivo WebP a partir del blob
      const optimizedFile = new File(
        [optimizedBlob],
        file.name.replace(/\.[^/.]+$/, "") + ".webp",
        { type: 'image/webp' }
      )

      // Crear preview local con la imagen optimizada
      const previewUrl = URL.createObjectURL(optimizedFile)
      setPreviewImage(previewUrl)

      // Subir a Firebase Storage siguiendo la estructura: comprobantes/{clientId}/{timestamp}_{filename}
      const timestamp = Date.now()
      const fileName = `comprobantes/${clientId}/${timestamp}_${optimizedFile.name}`
      const storageRef = ref(storage, fileName)

      await uploadBytes(storageRef, optimizedFile)
      const downloadUrl = await getDownloadURL(storageRef)

      // Limpiar preview local y usar URL de Firebase
      URL.revokeObjectURL(previewUrl)
      setPreviewImage(downloadUrl)
      onReceiptUpload(downloadUrl)

    } catch (error) {
      console.error('Error uploading image:', error)
      setError('Error al subir la imagen. Intenta nuevamente.')
      setPreviewImage(null)
    }
  }

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)

    const files = e.dataTransfer.files
    if (files && files[0]) {
      handleFileUpload(files[0])
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files && files[0]) {
      handleFileUpload(files[0])
    }
  }

  const removeImage = () => {
    setPreviewImage(null)
    onReceiptUpload('')
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  return (
    <div className="mt-4">
      <label className="block text-sm font-medium text-gray-700 mb-2">
        Comprobante de Transferencia *
      </label>

      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileSelect}
        accept="image/jpeg, image/png, image/webp"
        className="hidden"
      />
      {!previewImage ? (
        <div
          className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${dragActive ? 'border-red-500 bg-red-50' : 'border-gray-300 hover:border-gray-400'
            }`}
          onDragEnter={handleDrag}
          onDragOver={handleDrag}
          onDragLeave={handleDrag}
          onDrop={handleDrop}
        >
          <div className="flex flex-col items-center">
            <svg className="w-12 h-12 text-gray-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className="text-sm text-gray-600 mb-2">Arrastra aquí tu comprobante</p>
            <p className="text-xs text-gray-500 mb-4">o haz clic para seleccionar</p>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                fileInputRef.current?.click();
              }}
              className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors text-sm font-medium"
            >
              <i className="bi bi-upload mr-2"></i>
              Seleccionar Archivo
            </button>
            <p className="text-xs text-gray-400 mt-3">JPG, PNG o WEBP (máx. 5MB)</p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Vista previa de la imagen */}
          <div className="relative rounded-lg overflow-hidden border-2 border-green-500 bg-green-50">
            <img
              src={previewImage}
              alt="Comprobante de pago"
              className="w-full h-48 object-contain bg-white"
            />
            <div className="absolute top-2 right-2 flex gap-2">
              <button
                type="button"
                onClick={() => window.open(previewImage, '_blank')}
                className="p-2 bg-white rounded-full shadow-lg hover:bg-gray-100 transition-colors"
                title="Ver imagen completa"
              >
                <i className="bi bi-arrows-fullscreen text-gray-700"></i>
              </button>
              <button
                type="button"
                onClick={removeImage}
                className="p-2 bg-white rounded-full shadow-lg hover:bg-red-50 transition-colors"
                title="Eliminar imagen"
              >
                <i className="bi bi-trash text-red-600"></i>
              </button>
            </div>
          </div>

          {/* Información del comprobante */}
          <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-lg p-3">
            <div className="flex items-center gap-2">
              <i className="bi bi-check-circle-fill text-green-600 text-lg"></i>
              <span className="text-sm font-medium text-green-800">Comprobante cargado exitosamente</span>
            </div>
          </div>
        </div>
      )}

      {error && (
        <p className="text-red-500 text-xs mt-2 flex items-center">
          <i className="bi bi-exclamation-triangle mr-1"></i>
          {error}
        </p>
      )}

      {isUploading && (
        <div className="mt-3 flex items-center text-sm text-gray-600">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-red-500 mr-2"></div>
          Subiendo comprobante...
        </div>
      )}
    </div>
  )
}

export function CheckoutContent({
  embeddedBusinessId,
  embeddedBusiness,
  embeddedCartItems,
  onEmbeddedBack,
  onClearCart,
  onOrderCreated,
  onAddItem
}: {
  embeddedBusinessId?: string
  embeddedBusiness?: Business | null
  embeddedCartItems?: any[]
  onEmbeddedBack?: () => void
  onClearCart?: () => void
  onOrderCreated?: (orderId: string) => void
  onAddItem?: (item: any) => void
} = {}) {
  // Tipos locales para estados
  type PaymentData = {
    method: '' | 'cash' | 'transfer' | 'mixed'
    selectedBank: string
    paymentStatus: 'pending' | 'validating' | 'paid' | string
    cashAmount?: number
    transferAmount?: number
    receiptImageUrl?: string | null
  }

  type TimingData = {
    type: '' | 'immediate' | 'scheduled'
    scheduledDate: string
    scheduledTime: string
  }

  type DeliveryData = {
    type: '' | 'delivery' | 'pickup'
    address: string
    references: string
    tarifa: string
  }

  type CustomerData = {
    name: string
    phone: string
  }

  const isDarkColor = (hex?: string) => {
    if (!hex) return false
    const c = hex.replace('#', '')
    if (c.length !== 6) return false
    const r = parseInt(c.slice(0, 2), 16)
    const g = parseInt(c.slice(2, 4), 16)
    const b = parseInt(c.slice(4, 6), 16)
    const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
    return luminance < 0.55
  }

  // Estado y hooks necesarios para el componente
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, login, logout } = useAuth()

  const isEmbedded = !!embeddedBusinessId

  const [isClient, setIsClient] = useState(false)
  const [currentStep, setCurrentStep] = useState<number>(1)
  const [loading, setLoading] = useState(false)
  const [isProcessingOrder, setIsProcessingOrder] = useState(false)

  const [business, setBusiness] = useState<Business | null>(embeddedBusiness ?? null)

  const [clientFound, setClientFound] = useState<any | null>(null)
  const [clientSearching, setClientSearching] = useState(false)
  const [showNameField, setShowNameField] = useState(false)
  const [phoneError, setPhoneError] = useState('')
  const [nameError, setNameError] = useState('')

  const [customerData, setCustomerData] = useState<CustomerData>({ name: '', phone: '' })
  const [phoneConfirmation, setPhoneConfirmation] = useState('')

  const [clientLocations, setClientLocations] = useState<ClientLocation[]>([])

  // Estado para QR
  const [qrCodes, setQrCodes] = useState<any[]>([])
  const [qrProgress, setQrProgress] = useState<any>(null)
  const [loadingQr, setLoadingQr] = useState(false)
  const [qrError, setQrError] = useState('')
  const [redeemingQrId, setRedeemingQrId] = useState<string | null>(null)
  const [selectedLocation, setSelectedLocation] = useState<ClientLocation | null>(null)

  const [isLocationModalOpen, setIsLocationModalOpen] = useState(false)
  const [isAddingNewLocation, setIsAddingNewLocation] = useState(false)
  const [loadingLocations, setLoadingLocations] = useState(false)

  const [uploadingReceipt, setUploadingReceipt] = useState(false)
  const [paymentData, setPaymentData] = useState<PaymentData>({ method: '', selectedBank: '', paymentStatus: 'pending', cashAmount: 0, transferAmount: 0, receiptImageUrl: '' })
  const [timingData, setTimingData] = useState<TimingData>({ type: '', scheduledDate: '', scheduledTime: '' })
  const [deliveryData, setDeliveryData] = useState<DeliveryData>({ type: '', address: '', references: '', tarifa: '0' })

  const [errors, setErrors] = useState<Record<string, string>>({})
  const [calculatingTariff, setCalculatingTariff] = useState(false)
  const [showStoreImageModal, setShowStoreImageModal] = useState(false)

  const effectiveClientId = user?.id || clientFound?.id || ''

  // Cargar datos del carrito específico de este negocio desde localStorage
  const getCartItems = () => {
    if (isEmbedded) return embeddedCartItems || []
    if (typeof window === 'undefined') return []

    const businessId = searchParams.get('businessId')
    if (!businessId) return []

    const cartsData = localStorage.getItem('carts')
    if (!cartsData) return []

    try {
      const allCarts = JSON.parse(cartsData)
      return allCarts[businessId] || []
    } catch (e) {
      console.error('Error parsing carts from localStorage', e)
      return []
    }
  }

  const [cartItems, setCartItems] = useState(() => {
    if (typeof window === 'undefined') return []
    return getCartItems()
  })

  // Sincronizar si cambian los props embebidos
  useEffect(() => {
    if (isEmbedded) {
      setCartItems(embeddedCartItems || [])
    }
  }, [embeddedCartItems, isEmbedded])

  const handleRemoveItem = (index: number) => {
    const newItems = [...cartItems]
    newItems.splice(index, 1)
    setCartItems(newItems)

    if (!isEmbedded) {
      const businessId = searchParams.get('businessId')
      if (businessId) {
        try {
          const cartsData = localStorage.getItem('carts')
          if (cartsData) {
            const allCarts = JSON.parse(cartsData)
            allCarts[businessId] = newItems
            localStorage.setItem('carts', JSON.stringify(allCarts))
            window.dispatchEvent(new Event('storage'))
          }
        } catch (e) {
          console.error('Error updating cart:', e)
        }
      }
    }
  }

  // Función para calcular el costo de envío
  const getDeliveryCost = () => {
    if (!deliveryData.type) {
      return 0 // Sin tipo de entrega seleccionado
    }
    if (deliveryData.type === 'pickup') {
      return 0 // Retiro en tienda
    }
    if (deliveryData.type === 'delivery' && selectedLocation) {
      return parseFloat(selectedLocation.tarifa)
    }
    return 0 // Delivery sin ubicación seleccionada
  }

  // Indicar que estamos en cliente
  useEffect(() => { setIsClient(true); }, []);

  // Sincronizar estado del checkout con el usuario global
  useEffect(() => {
    if (user) {
      // Cuando hay sesión, llenar los datos del cliente y ocultar inputs adicionales
      setCustomerData({ name: user.nombres || '', phone: user.celular || '' })
      setShowNameField(false)
      setClientFound(user)
    } else {
      // Cuando no hay sesión, limpiar y permitir ingresar datos
      setShowNameField(true)
      // No borrar customerData automáticamente para no interferir con typed phone, solo cuando explicitly logged out elsewhere
    }
  }, [user])

  // Cargar ubicaciones guardadas del cliente loggeado (funciona tanto embebido como /checkout)
  useEffect(() => {
    if (!user?.id) {
      setClientLocations([])
      setSelectedLocation(null)
      return
    }

    const loadUserLocations = async () => {
      setLoadingLocations(true)
      try {
        const locations = await getClientLocations(user.id)
        setClientLocations(locations)

        // Selección automática sólo cuando el usuario ya eligió "Domicilio" y aún no hay ubicación
        if (deliveryData.type === 'delivery' && !selectedLocation && locations.length > 0) {
          // Intentar cargar la ubicación activa del UserSidebar desde localStorage
          let locationToSelect = locations[0] // Default: primera ubicación

          try {
            const storedCoords = localStorage.getItem('userCoordinates')
            if (storedCoords) {
              const coords = JSON.parse(storedCoords)
              // Buscar la ubicación que coincida con las coordenadas guardadas
              const matchingLocation = locations.find(loc => {
                if (!loc.latlong) return false
                const [lat, lng] = loc.latlong.split(',').map(c => parseFloat(c.trim()))
                // Comparar con tolerancia de 0.0001 grados (~11 metros)
                return Math.abs(lat - coords.lat) < 0.0001 && Math.abs(lng - coords.lng) < 0.0001
              })

              if (matchingLocation) {
                locationToSelect = matchingLocation
              }
            }
          } catch (e) {
            console.error('Error loading user coordinates from localStorage:', e)
          }

          await handleLocationSelect(locationToSelect)
        }
      } catch (error) {
        console.error('Error loading user locations:', error)
        setClientLocations([])
      } finally {
        setLoadingLocations(false)
      }
    }

    void loadUserLocations()
  }, [user?.id, deliveryData.type])

  // Helper para calcular tarifa usando la función compartida en lib/database
  const calculateDeliveryFee = async ({ lat, lng }: { lat: number; lng: number }) => {
    try {
      if (!business?.id) return 0
      const fee = await getDeliveryFeeForLocation({ lat, lng }, business.id)
      return fee
    } catch (error) {
      console.error('Error calculating delivery fee:', error)
      return 0
    }
  }

  // Effect para avance automático de pasos basado en datos completados
  useEffect(() => {
    const maxStep = getMaxVisibleStep();
    if (maxStep > currentStep) {
      // Solo avanzar automáticamente, nunca retroceder
      setCurrentStep(maxStep);
    }
  }, [customerData, deliveryData, paymentData, showNameField, selectedLocation]);

  // Sincronizar estado del checkout en Firestore para monitoreo en tiempo real
  useEffect(() => {
    // Si se está procesando la orden, no sincronizar (para evitar condiciones de carrera con la limpieza)
    if (isProcessingOrder) return

    const syncCheckoutProgress = async () => {
      // Solo sincronizar si hay usuario
      const effectiveClientId = user?.id || clientFound?.id
      console.log('🔄 Checkout Sync Debug - effectiveClientId:', effectiveClientId)

      if (!effectiveClientId) {
        console.log('❌ Checkout Sync Debug - No hay clientId efectivo')
        return
      }

      // Determinar businessId de varias formas
      let businessIdToSync = embeddedBusinessId
      if (!businessIdToSync && typeof window !== 'undefined') {
        // Intentar obtener de searchParams
        try {
          const params = new URLSearchParams(window.location.search)
          businessIdToSync = params.get('businessId') || ''
        } catch (e) {
          console.debug('Error reading search params:', e)
        }
      }

      // Si tenemos business data, usar su ID
      if (!businessIdToSync && business?.id) {
        businessIdToSync = business.id
      }

      console.log('🔄 Checkout Sync Debug - businessIdToSync:', businessIdToSync)

      // Si aún no hay businessId pero tenemos negocio, no sincronizar aún
      if (!businessIdToSync) {
        console.log('❌ Checkout Sync Debug - No hay businessId para sincronizar')
        return
      }

      try {
        const progressData = {
          cartItems,
          customerData,
          deliveryData: {
            ...deliveryData,
            latlong: selectedLocation?.latlong,
            photo: selectedLocation?.photo
          },
          timingData,
          paymentData,
          currentStep
        }

        console.log('🔄 Checkout Sync Debug - Sincronizando datos:', progressData)
        await updateCheckoutProgress(effectiveClientId, businessIdToSync, progressData)
      } catch (error) {
        console.error('❌ Error syncing checkout progress:', error)
      }
    }

    // Sincronizar después de cambios importantes
    const timer = setTimeout(() => {
      console.log('⏰ Checkout Sync Debug - Ejecutando sync con debounce')
      syncCheckoutProgress()
    }, 500) // Debounce de 500ms para evitar sincronizar demasiado frecuentemente

    return () => clearTimeout(timer)
  }, [
    cartItems,
    customerData,
    deliveryData,
    timingData,
    paymentData,
    currentStep,
    user?.id,
    clientFound?.id,
    selectedLocation,
    embeddedBusinessId,
    business?.id,
    isProcessingOrder
  ])

  // Limpiar el progreso del checkout cuando se completa la orden
  useEffect(() => {
    if (isProcessingOrder && !loading) {
      const effectiveClientId = user?.id || clientFound?.id
      let businessIdToClean = embeddedBusinessId || business?.id

      if (!businessIdToClean && typeof window !== 'undefined') {
        try {
          const params = new URLSearchParams(window.location.search)
          businessIdToClean = params.get('businessId') || ''
        } catch (e) {
          console.debug('Error reading search params:', e)
        }
      }

      if (effectiveClientId && businessIdToClean) {
        clearCheckoutProgress(effectiveClientId, businessIdToClean).catch(console.error)
      }
    }
  }, [isProcessingOrder, loading, user?.id, clientFound?.id, embeddedBusinessId, business?.id])

  // NUEVO: Calcular tarifa al activar delivery si ya hay una ubicación seleccionada pero sin tarifa válida (escenario de primera carga)
  useEffect(() => {
    const ensureTariffForSelected = async () => {
      if (deliveryData.type !== 'delivery') return
      if (!selectedLocation?.latlong) return
      const currentTariff = selectedLocation.tarifa
      const needsCalculation = currentTariff == null || Number(currentTariff) <= 0
      if (!needsCalculation || calculatingTariff || !business?.id) return

      try {
        setCalculatingTariff(true)
        const [lat, lng] = selectedLocation.latlong.split(',').map(coord => parseFloat(coord.trim()))
        if (isNaN(lat) || isNaN(lng)) return
        const fee = await calculateDeliveryFee({ lat, lng })
        // Normalizar tarifa fuera de cobertura: si fee es 0, usar 1.50
        const normalizedFee = fee === 0 ? 1.5 : fee
        const updated = { ...selectedLocation, tarifa: normalizedFee.toString() }
        setSelectedLocation(updated)
        setDeliveryData(prev => ({ ...prev, tarifa: normalizedFee.toString() }))
      } catch (e) {
        console.error('Error ensuring tariff for selected location:', e)
      } finally {
        setCalculatingTariff(false)
      }
    }

    void ensureTariffForSelected()
  }, [deliveryData.type, selectedLocation?.id, selectedLocation?.latlong, business?.id, calculatingTariff])

  // Función para abrir el modal
  const openLocationModal = () => {
    if (!effectiveClientId) {
      alert('Por favor, completa el Paso 1 (Tus Datos) para poder agregar una dirección.');
      const step1 = document.getElementById('step-1');
      if (step1) step1.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    setIsLocationModalOpen(true);
  };

  // Función para cerrar el modal
  const closeLocationModal = () => {
    setIsLocationModalOpen(false);
    setIsAddingNewLocation(false);
  }

  // Función para manejar la carga de comprobante
  const handleReceiptUpload = (imageUrl: string) => {
    setUploadingReceipt(false)
    setPaymentData(prev => ({
      ...prev,
      receiptImageUrl: imageUrl,
      paymentStatus: imageUrl ? 'validating' : 'pending'
    }))
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
      setPhoneError('');
      setPhoneConfirmation(''); // Limpiar confirmación
      return;
    }

    // Normalizar el número de teléfono antes de validar y buscar
    const normalizedPhone = normalizeEcuadorianPhone(phone);

    if (!validateEcuadorianPhone(normalizedPhone)) {
      setClientFound(null);
      setShowNameField(false);
      setClientLocations([]);
      setSelectedLocation(null);
      setPhoneError('');
      setPhoneConfirmation(''); // Limpiar confirmación
      return;
    }

    setClientSearching(true);
    setPhoneError('');
    try {
      // Buscar con el número normalizado
      const client = await searchClientByPhone(normalizedPhone);
      if (client) {
        // Cliente encontrado - auto login
        setClientFound(client);
        setCustomerData(prev => ({
          ...prev,
          name: client.nombres || '',
          phone: normalizedPhone
        }));
        setShowNameField(false);

        // Auto-login del cliente
        login(client as any);

        // Registrar login desde Checkout
        if (client.id) {
          await updateClient(client.id, {
            lastLoginAt: serverTimestamp(),
            loginSource: 'checkout'
          });
        }

        setClientLocations([]);
        setSelectedLocation(null);
      } else {
        // Cliente no encontrado - pedir nombre
        setClientFound(null);
        setShowNameField(true);
        setCustomerData(prev => ({
          ...prev,
          name: '',
          phone: normalizedPhone
        }));
        setClientLocations([]);
        setSelectedLocation(null);
      }
    } catch (error) {
      console.error('Error searching client:', error);
      setPhoneError('Error al buscar el cliente. Intenta nuevamente.');
      setClientFound(null);
      setShowNameField(false);
      setClientLocations([]);
      setSelectedLocation(null);
    } finally {
      setClientSearching(false);
    }
  }

  // Función para crear nuevo cliente
  async function handleCreateClient() {
    if (!customerData.phone || !customerData.name) {
      setNameError('El nombre es requerido');
      return;
    }

    // Normalizar el número antes de crear el cliente
    const normalizedPhone = normalizeEcuadorianPhone(customerData.phone);
    setNameError('');

    try {
      if (clientFound && clientFound.id) {
        // Actualizar cliente existente con el nombre proporcionado
        try {
          await updateClient(clientFound.id, {
            nombres: customerData.name.trim(),
            lastLoginAt: serverTimestamp(),
            loginSource: 'checkout'
          });
        } catch (e) {
          console.warn('No se pudo actualizar el nombre del cliente existente:', e);
        }

        // Refrescar estado local del cliente encontrado
        const updatedClient = { ...clientFound, nombres: customerData.name.trim() };
        setClientFound(updatedClient);
        setShowNameField(false);
        setCustomerData(prev => ({ ...prev, phone: normalizedPhone }));

        // Auto-login del cliente actualizado
        login(updatedClient as any);
        return;
      }

      const newClient = await createClient({
        celular: normalizedPhone,
        nombres: customerData.name.trim(),
        fecha_de_registro: new Date().toISOString()
      });

      // Registrar login desde Checkout
      if (newClient && newClient.id) {
        await updateClient(newClient.id, {
          lastRegistrationAt: serverTimestamp(),
          lastLoginAt: serverTimestamp(),
          loginSource: 'checkout'
        });
      }

      // Actualizar el estado con el cliente recién creado
      const clientData = {
        id: newClient.id,
        nombres: customerData.name.trim(),
        celular: normalizedPhone,
        fecha_de_registro: new Date().toISOString()
      };

      setClientFound(clientData);
      setCustomerData(prev => ({
        ...prev,
        phone: normalizedPhone
      }));
      setShowNameField(false);

      // Auto-login del nuevo cliente
      login(clientData as any);
    } catch (error) {
      console.error('Error creating/updating client:', error);
      setNameError('Error al crear el cliente. Intenta nuevamente.');
    }
  }


  // Función unificada para seleccionar una ubicación del cliente
  const handleLocationSelect = async (location: ClientLocation) => {
    // Si la ubicación ya tiene una tarifa válida guardada (> 0), usarla tal cual sin recalcular
    const storedTariff = location.tarifa != null ? Number(location.tarifa) : NaN
    if (!isNaN(storedTariff) && storedTariff > 0) {
      setSelectedLocation(location)
      setDeliveryData(prev => ({
        ...prev,
        address: location.referencia,
        references: `${location.sector} - ${location.latlong}`,
        tarifa: location.tarifa
      }))
      closeLocationModal()
      return
    }

    // Si no hay tarifa válida pero sí coordenadas, calcularla automáticamente
    if (location.latlong) {
      setCalculatingTariff(true)
      try {
        const [lat, lng] = location.latlong.split(',').map(coord => parseFloat(coord.trim()))
        if (!isNaN(lat) && !isNaN(lng)) {
          const calculatedFee = await calculateDeliveryFee({ lat, lng })

          // Normalizar tarifa fuera de cobertura: si calculatedFee es 0, usar 1.50
          const normalizedFee = calculatedFee === 0 ? 1.5 : calculatedFee

          const updatedLocation = { ...location, tarifa: normalizedFee.toString() }
          setSelectedLocation(updatedLocation)

          setDeliveryData(prev => ({
            ...prev,
            address: location.referencia,
            references: `${location.sector} - ${location.latlong}`,
            tarifa: normalizedFee.toString()
          }))

          closeLocationModal()
          return
        }
      } catch (error) {
        console.error('Error calculating automatic delivery fee:', error)
      } finally {
        setCalculatingTariff(false)
      }
    }

    // Fallback: sin tarifa válida ni cálculo, usar lo que haya en location.tarifa
    setSelectedLocation(location)
    setDeliveryData(prev => ({
      ...prev,
      address: location.referencia,
      references: `${location.sector} - ${location.latlong}`,
      tarifa: location.tarifa
    }))
    closeLocationModal()
  }

  // Effect para cargar datos QR
  useEffect(() => {
    const loadQrData = async () => {
      // Usar el número de celular normalizado como ID para buscar el progreso QR
      // Esto debe coincidir con la lógica en profile/page.tsx
      const effectiveClientId = user?.celular
        ? normalizeEcuadorianPhone(user.celular)
        : (clientFound?.celular ? normalizeEcuadorianPhone(clientFound.celular) : null)
      if (!business?.id || !effectiveClientId) {
        setQrCodes([])
        setQrProgress(null)
        setQrError('')
        return
      }

      try {
        setLoadingQr(true)
        setQrError('')
        const [codes, progress] = await Promise.all([
          getQRCodesByBusiness(business.id, true),
          getUserQRProgress(effectiveClientId, business.id)
        ])
        setQrCodes(codes)
        setQrProgress(progress)
      } catch (e) {
        console.error('❌ [CheckoutContent] Error loading QR data:', e)
        setQrCodes([])
        setQrProgress(null)
        setQrError('No se pudieron cargar tus tarjetas')
      } finally {
        setLoadingQr(false)
      }
    }

    loadQrData()
  }, [business?.id, clientFound?.celular, user?.celular])

  const handleRedeemQrPrize = async (code: any) => {
    if (!code.prize) return
    setRedeemingQrId(code.id)

    // Simular delay y agregar al carrito
    setTimeout(() => {
      // Verificar si ya existe en el carrito actual para evitar duplicados
      const exists = cartItems.some((i: any) => i.qrCodeId === code.id)
      if (exists) {
        setRedeemingQrId(null)
        return
      }

      const newItem = {
        id: `qr-${code.id}`,
        name: code.prize,
        price: 0,
        quantity: 1,
        image: code.image || business?.image,
        esPremio: true,
        qrCodeId: code.id
      }

      if (onAddItem) {
        onAddItem(newItem)
      } else {
        // Actualizar estado local
        const newItems = [...cartItems, newItem]
        setCartItems(newItems)

        // Persistir en localStorage
        if (business?.id) {
          try {
            const savedCarts = localStorage.getItem('carts')
            const parsedCarts = savedCarts ? JSON.parse(savedCarts) : {}
            parsedCarts[business.id] = newItems
            localStorage.setItem('carts', JSON.stringify(parsedCarts))
            window.dispatchEvent(new Event('storage'))
          } catch (e) {
            console.error('Error updating cart with prize:', e)
          }
        }
      }

      setRedeemingQrId(null)
    }, 500)
  }

  useEffect(() => {
    // Cargar datos del negocio y carrito desde localStorage
    if (isEmbedded) return

    const businessIdFromQuery = searchParams.get('businessId')

    // Si no hay businessId en la query, redirigir
    if (!businessIdFromQuery) {
      router.push('/')
      return
    }

    // Verificar que existe carrito para este negocio
    const cartsData = typeof window !== 'undefined' ? localStorage.getItem('carts') : null
    let hasCartForBusiness = false

    if (cartsData) {
      try {
        const allCarts = JSON.parse(cartsData)
        hasCartForBusiness = allCarts[businessIdFromQuery] && allCarts[businessIdFromQuery].length > 0
      } catch (e) {
        console.error('Error parsing carts from localStorage', e)
      }
    }

    // Si no hay carrito para este negocio, redirigir
    if (!hasCartForBusiness) {
      router.push('/')
      return
    }

    loadBusinessData(businessIdFromQuery)
  }, [searchParams, router, user, isEmbedded])

  // Client-only guard: render nothing until mounted on client
  if (!isClient) return null;


  const subtotal = cartItems.reduce((sum: number, item: any) => sum + (item.price * item.quantity), 0)
  const deliveryCost = getDeliveryCost()
  const total = subtotal + deliveryCost

  // Calcular fecha mínima para programación
  const getMinScheduledDate = () => {
    const now = new Date();

    // Si la tienda está cerrada manualmente, la programación inicia desde mañana
    if (business?.manualStoreStatus === 'closed') {
      now.setDate(now.getDate() + 1);
    }

    // Formato YYYY-MM-DD usando hora local
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  const getDateLabel = () => {
    if (!timingData.scheduledDate) return 'Fecha'

    const now = new Date()
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const todayStr = `${year}-${month}-${day}`;

    const tomorrow = new Date(now)
    tomorrow.setDate(tomorrow.getDate() + 1)
    const tYear = tomorrow.getFullYear();
    const tMonth = String(tomorrow.getMonth() + 1).padStart(2, '0');
    const tDay = String(tomorrow.getDate()).padStart(2, '0');
    const tomorrowStr = `${tYear}-${tMonth}-${tDay}`;

    if (timingData.scheduledDate === todayStr) return 'Hoy'
    if (timingData.scheduledDate === tomorrowStr) return 'Mañana'
    return 'Fecha'
  }

  const qrPrizeIdsInCart = cartItems.filter((i: any) => i.qrCodeId).map((i: any) => i.qrCodeId)
  const visibleQrCards = qrCodes.filter(code => {
    if (!code.prize || code.prize.trim() === '') return false

    // IMPORTANTE: Solo mostrar tarjetas que el usuario ha escaneado
    const isScanned = (qrProgress?.scannedCodes || []).includes(code.id)
    if (!isScanned) return false

    // No mostrar tarjetas que ya fueron completadas en órdenes anteriores
    const isCompleted = (qrProgress?.completedRedemptions || []).includes(code.id)
    if (isCompleted) return false

    const isRedeemed = (qrProgress?.redeemedPrizeCodes || []).includes(code.id)
    const isInCart = qrPrizeIdsInCart.includes(code.id)

    // Mostrar si NO está canjeada O SI está en el carrito (o proceso de canje)
    return !isRedeemed || isInCart
  })

  console.log('🎯 [CheckoutContent] Tarjetas visibles calculadas:', {
    totalQrCodes: qrCodes.length,
    scannedCodes: qrProgress?.scannedCodes || [],
    completedRedemptions: qrProgress?.completedRedemptions || [],
    visibleQrCards: visibleQrCards.length,
    visibleQrCardsIds: visibleQrCards.map(c => c.id)
  })

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
      // Validar confirmación de teléfono para nuevos clientes
      if (showNameField && !clientFound) {
        if (!phoneConfirmation.trim()) {
          newErrors.phoneConfirmation = 'Por favor confirma tu número de celular'
        } else if (phoneConfirmation !== customerData.phone) {
          newErrors.phoneConfirmation = 'Los números no coinciden'
        }
      }
    }

    if (step === 2) {
      if (!deliveryData.type) {
        newErrors.deliveryType = 'Selecciona un tipo de entrega'
      } else if (deliveryData.type === 'delivery') {
        if (!deliveryData.address.trim()) {
          newErrors.address = 'La dirección es requerida para delivery'
        }
      }
    }

    if (step === 4) {
      if (!paymentData.method) {
        newErrors.paymentMethod = 'Selecciona un método de pago'
      } else if (paymentData.method === 'transfer') {
        if (!paymentData.selectedBank) {
          newErrors.selectedBank = 'Selecciona un banco para la transferencia'
        }
        if (!paymentData.receiptImageUrl) {
          newErrors.receiptImage = 'Sube el comprobante de transferencia para continuar'
        }
      }
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  // Función para calcular el máximo paso que se puede mostrar basado en los datos completados
  function getMaxVisibleStep() {
    let maxStep = 1;

    // Paso 1: Validar datos del cliente
    if (customerData.phone.trim()) {
      const normalizedPhone = normalizeEcuadorianPhone(customerData.phone);
      if (validateEcuadorianPhone(normalizedPhone)) {
        if (user) {
          maxStep = 2;
        }
      }
    }

    // Paso 2: Validar datos de entrega
    if (maxStep >= 2 && deliveryData.type) {
      if (deliveryData.type === 'pickup' || (deliveryData.type === 'delivery' && (deliveryData.address.trim() || selectedLocation))) {
        maxStep = 3;
      }
    }

    // Paso 3: Validar timing (requiere selección explícita)
    if (maxStep >= 3 && timingData.type) {
      if (timingData.type === 'immediate') {
        maxStep = 4;
      } else if (timingData.type === 'scheduled' && timingData.scheduledDate && timingData.scheduledTime) {
        if (isSpecificTimeOpen(business, timingData.scheduledDate, timingData.scheduledTime)) {
          maxStep = 4;
        }
      }
    }

    // Paso 4: Validar pago (ahora el paso final es 4, se removió el paso de confirmación)
    if (maxStep >= 4 && paymentData.method) {
      if (paymentData.method === 'cash' ||
        (paymentData.method === 'transfer' && paymentData.selectedBank)) {
        maxStep = 4;
      }
    }

    return maxStep;
  }

  // Step completion flags (puros, sin efectos secundarios)
  const step1Complete = (() => {
    const phone = customerData.phone?.trim();
    if (!phone) return false;
    const normalizedPhone = normalizeEcuadorianPhone(customerData.phone);
    if (!validateEcuadorianPhone(normalizedPhone)) return false;
    if (showNameField && !customerData.name.trim()) return false;
    if (!user) return false;
    return true;
  })();

  const step2Complete = (() => {
    if (!deliveryData.type) return false;
    if (deliveryData.type === 'pickup') return true;
    if (deliveryData.type === 'delivery') {
      return Boolean(selectedLocation || deliveryData.address.trim());
    }
    return false;
  })();

  const step3Complete = (() => {
    if (!timingData.type) return false;
    if (timingData.type === 'immediate') return true;
    if (timingData.type === 'scheduled') {
      return Boolean(timingData.scheduledDate && timingData.scheduledTime && isSpecificTimeOpen(business, timingData.scheduledDate, timingData.scheduledTime));
    }
    return false;
  })();

  const step4Complete = (() => {
    if (!paymentData.method) return false;
    if (paymentData.method === 'cash') return true;
    if (paymentData.method === 'transfer') return Boolean(paymentData.selectedBank && paymentData.receiptImageUrl);
    if (paymentData.method === 'mixed') return true;
    return false;
  })();

  // Computed readiness for final confirmation (pure check — no side effects)
  const readyToConfirm = (() => {
    // Paso 1: cliente
    const phone = customerData.phone?.trim();
    if (!phone) return false;
    const normalizedPhone = normalizeEcuadorianPhone(customerData.phone);
    if (!validateEcuadorianPhone(normalizedPhone)) return false;
    if (showNameField && !customerData.name.trim()) return false;
    // Validar confirmación de teléfono para nuevos clientes
    if (showNameField && !clientFound) {
      if (!phoneConfirmation.trim() || phoneConfirmation !== customerData.phone) return false;
    }
    if (!user) return false;

    // Paso 2: entrega
    if (!deliveryData.type) return false;
    if (deliveryData.type === 'delivery') {
      if (!deliveryData.address.trim() && !selectedLocation) return false;
      // Si la ubicación seleccionada está fuera de cobertura, no permitir confirmar
      if (!calculatingTariff && selectedLocation && (selectedLocation.tarifa == null || Number(selectedLocation.tarifa) <= 0)) return false;
    }

    // Paso 3: timing
    if (!timingData.type) return false; // requiere seleccionar inmediato o programado
    if (timingData.type === 'scheduled') {
      if (!timingData.scheduledDate || !timingData.scheduledTime) return false;
      if (!isSpecificTimeOpen(business, timingData.scheduledDate, timingData.scheduledTime)) return false;
    }

    // Paso 4: pago
    if (!paymentData.method) return false;
    if (paymentData.method === 'transfer') {
      if (!paymentData.selectedBank || !paymentData.receiptImageUrl) return false;
    }

    return true;
  })()

  const handleNext = () => {
    if (validateStep(currentStep)) {
      if (currentStep < 4) {
        setCurrentStep(currentStep + 1)
      }
    }
  }

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1)
    }
  }

  // Función para desplazamiento suave a un paso específico
  const scrollToStep = (stepNumber: number) => {
    const element = document.getElementById(`step-${stepNumber}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  };

  const handleSubmit = async () => {
    if (!validateStep(currentStep)) return

    setLoading(true)
    setIsProcessingOrder(true) // Activar estado de procesamiento
    try {
      // Validación final antes de crear la orden
      if (!deliveryData.type) {
        alert('Por favor selecciona un tipo de entrega')
        setLoading(false)
        setIsProcessingOrder(false)
        return
      }

      if (deliveryData.type !== 'delivery' && deliveryData.type !== 'pickup') {
        alert('Tipo de entrega inválido')
        setLoading(false)
        setIsProcessingOrder(false)
        return
      }

      // VALIDACIÓN CRÍTICA: Si el método de pago es transferencia, debe existir comprobante
      if (paymentData.method === 'transfer') {
        if (!paymentData.selectedBank) {
          alert('Por favor selecciona un banco para la transferencia')
          setLoading(false)
          setIsProcessingOrder(false)
          return
        }
        if (!paymentData.receiptImageUrl) {
          alert('Por favor sube el comprobante de transferencia antes de confirmar el pedido')
          setLoading(false)
          setIsProcessingOrder(false)
          return
        }
      }

      // Crear cliente si no está creado y es necesario
      if (showNameField && customerData.name.trim()) {
        await handleCreateClient()
      }

      // Validar que la hora programada sea al menos 30 minutos en el futuro
      if (timingData.type === 'scheduled') {
        const now = new Date();
        const scheduledDateTime = new Date(`${timingData.scheduledDate}T${timingData.scheduledTime}`);
        const minScheduledTime = new Date(now.getTime() + 29 * 60 * 1000); // 29 minutos para dar un pequeño margen

        if (scheduledDateTime < minScheduledTime) {
          alert('La hora programada debe ser al menos 30 minutos después de la hora actual');
          setLoading(false);
          setIsProcessingOrder(false);
          return;
        }
      }

      // Calcular tiempo de entrega
      let scheduledTime, scheduledDate;

      if (timingData.type === 'immediate') {
        // Para inmediato: fecha y hora actuales + tiempo de entrega definido por la tienda (o 30 min por defecto)
        const baseDeliveryTime = business?.deliveryTime || 30;
        const now = new Date();
        const deliveryTime = new Date(now.getTime() + (baseDeliveryTime + 1) * 60 * 1000); // Se añade 1 min extra de margen como estaba originalmente (30+1)

        // Asegurarse de que la hora esté en formato de 24h con ceros a la izquierda
        const hours = String(deliveryTime.getHours()).padStart(2, '0');
        const minutes = String(deliveryTime.getMinutes()).padStart(2, '0');

        scheduledDate = Timestamp.fromDate(deliveryTime);
        scheduledTime = `${hours}:${minutes}`; // Formato HH:MM
      } else {
        // Para programado: combinar fecha y hora en la zona horaria local
        const [year, month, day] = timingData.scheduledDate.split('-').map(Number);
        const [hours, minutes] = timingData.scheduledTime.split(':').map(Number);

        // Crear fecha en la zona horaria local
        const localDate = new Date(year, month - 1, day, hours, minutes);

        // Convertir a Timestamp (Firestore usa UTC internamente)
        scheduledDate = Timestamp.fromDate(localDate);
        scheduledTime = timingData.scheduledTime;
      }

      // Calcular todos los valores necesarios primero
      const subtotal = cartItems.reduce((sum: number, item: any) => sum + (item.price * item.quantity), 0);
      const deliveryCost = selectedLocation?.tarifa ? parseFloat(selectedLocation.tarifa) : 0;
      const total = subtotal + deliveryCost;
      const businessId = (isEmbedded ? embeddedBusinessId : (searchParams.get('businessId') || ''))

      // El delivery se asignará automáticamente cuando la tienda confirme el pedido en el dashboard
      const assignedDeliveryId = undefined;

      // Luego crear el objeto orderData
      const orderData = {
        businessId: businessId,
        items: cartItems.map((item: any) => ({
          productId: item.id.split('-')[0],
          name: item.productName || item.name,
          price: item.price,
          quantity: item.quantity,
          variant: item.variantName || '',
          image: item.image
        })),
        customer: {
          name: customerData.name,
          phone: customerData.phone
        },
        delivery: {
          type: deliveryData.type as 'delivery' | 'pickup',
          references: deliveryData.type === 'delivery' ? (deliveryData.address || '') : '',
          latlong: selectedLocation?.latlong || '',
          photo: selectedLocation?.photo || '', // ADDED: Photo de la ubicación
          deliveryCost: deliveryData.type === 'delivery' ? deliveryCost : 0,
          assignedDelivery: assignedDeliveryId
        },
        timing: {
          type: (timingData.type || 'immediate') as 'immediate' | 'scheduled',
          scheduledDate,
          scheduledTime
        },
        payment: {
          method: (paymentData.method || 'cash') as 'cash' | 'transfer' | 'mixed',
          selectedBank: paymentData.method === 'transfer' ? paymentData.selectedBank : '',
          paymentStatus: (paymentData.method === 'transfer' ? 'pending' : undefined) as 'pending' | 'validating' | 'paid' | undefined,
          receiptImageUrl: paymentData.receiptImageUrl || ''
        },
        // NUEVO: Agregar código de referido si existe
        referralCode: typeof window !== 'undefined' ? localStorage.getItem('pendingReferral') || undefined : undefined,
        total,
        subtotal,
        status: 'pending' as const,
        statusHistory: {
          pendingAt: Timestamp.now()
        },
        createdByAdmin: false,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Log para debugging ANTES de crear la orden
      console.log('[Checkout] Order data being created:', {
        hasDelivery: !!orderData.delivery,
        deliveryType: orderData.delivery?.type,
        deliveryPhoto: orderData.delivery?.photo,
        selectedLocationPhoto: selectedLocation?.photo,
        fullDeliveryObject: orderData.delivery
      });

      const orderId = await createOrder(orderData);

      // === LIMPIAR checkout progress INMEDIATAMENTE después de crear la orden ===
      // Esto debe hacerse ANTES de navegar/redirigir, porque el useEffect de limpieza
      // no se ejecuta si el componente se desmonta por la navegación.
      try {
        const clientIdToClean = user?.id || clientFound?.id
        if (clientIdToClean && businessId) {
          await clearCheckoutProgress(clientIdToClean, businessId)
        }
      } catch (e) {
        console.error('Error clearing checkout progress:', e)
      }

      try {
        const orderDateStr = new Date().toISOString().split('T')[0]
        await registerOrderConsumption(
          businessId,
          cartItems.map((item: any) => ({
            productId: item.id.split('-')[0],
            variant: item.variantName || '',
            name: item.productName || item.name,
            quantity: item.quantity
          })),
          orderDateStr,
          orderId
        )
      } catch (error) {
        console.error('Error registering order consumption:', error)
        // No interrumpir el flujo si hay error en consumo
      }

      // Marcar premios QR como completados permanentemente
      try {
        const qrPrizeIds = cartItems
          .filter((item: any) => item.qrCodeId)
          .map((item: any) => item.qrCodeId)

        if (qrPrizeIds.length > 0 && user?.celular) {
          const normalizedPhone = normalizeEcuadorianPhone(user.celular)
          await completeQRRedemptions(normalizedPhone, businessId, qrPrizeIds)
        }
      } catch (error) {
        console.error('Error completing QR redemptions:', error)
        // No interrumpir el flujo si hay error
      }

      // Limpiar carrito específico de este negocio
      if (businessId) {
        try {
          const cartsData = localStorage.getItem('carts')
          if (cartsData) {
            const allCarts = JSON.parse(cartsData)
            delete allCarts[businessId] // Eliminar carrito de este negocio
            localStorage.setItem('carts', JSON.stringify(allCarts))
          }
        } catch (e) {
          console.error('Error updating carts in localStorage', e)
        }
      }

      // Limpiar código de referido pendiente después de crear la orden
      try {
        localStorage.removeItem('pendingReferral')
      } catch (e) {
        console.error('Error removing pending referral:', e)
      }

      if (isEmbedded && onOrderCreated) {
        try {
          onOrderCreated(orderId)
        } catch (e) {
          console.error('Error calling onOrderCreated:', e)
        }

        if (onClearCart) {
          try {
            onClearCart()
          } catch (e) {
            console.error('Error clearing embedded cart after order:', e)
          }
        }
      } else {
        if (onClearCart) {
          try {
            onClearCart()
          } catch (e) {
            console.error('Error clearing embedded cart after order:', e)
          }
        }

        // Redirigir a la página de estado del pedido con la ruta /o/[orderId]
        router.push(`/o/${orderId}`)
      }
    } catch (error) {
      console.error('Error creating order:', error)
      setIsProcessingOrder(false) // Resetear estado en caso de error
    } finally {
      setLoading(false)
    }
  }

  // Mostrar pantalla de procesamiento cuando se está enviando la orden
  if (isProcessingOrder) {
    return (
      <div className={isEmbedded ? 'min-h-full bg-gray-50 flex items-center justify-center' : 'min-h-screen bg-gray-50 flex items-center justify-center'}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-red-500 mx-auto"></div>
          <h1 className="text-2xl font-bold text-gray-900 mb-4 mt-6">Procesando tu pedido...</h1>
          <p className="text-gray-600">Por favor espera mientras confirmamos tu orden</p>
        </div>
      </div>
    )
  }

  // No mostrar nada si el carrito está vacío, a menos que se esté procesando una orden
  if (cartItems.length === 0 && !isProcessingOrder) {
    return (
      <div className={isEmbedded ? 'min-h-full bg-gray-50 flex items-center justify-center' : 'min-h-screen bg-gray-50 flex items-center justify-center'}>
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Tu carrito está vacío</h1>
          <p className="text-gray-600 mb-6">Agrega algunos productos antes de proceder al checkout</p>
          {isEmbedded ? (
            <button
              type="button"
              onClick={onEmbeddedBack}
              className="inline-block bg-gray-900 text-white px-6 py-3 rounded-lg hover:bg-gray-800"
            >
              Volver al carrito
            </button>
          ) : (
            <Link
              href="/"
              className="inline-block bg-red-500 text-white px-6 py-3 rounded-lg hover:bg-red-600"
            >
              Volver a inicio
            </Link>
          )}
        </div>
      </div>
    );
  }

  // Determinar si la ubicación seleccionada está fuera de cobertura (tarifa nula o 0)
  const selectedLocationOutsideCoverage = !!selectedLocation && !calculatingTariff && (selectedLocation.tarifa == null || Number(selectedLocation.tarifa) <= 0);

  return (
    <div className={isEmbedded ? 'min-h-full bg-gray-50' : 'min-h-screen bg-gray-50'}>
      {!isEmbedded && (
        <div className="px-4 sm:px-6 pt-6 pb-4 bg-white sticky top-0 z-10 border-b border-gray-100 shadow-sm mb-6">
          <div className="max-w-xl mx-auto flex items-center">
            <Link
              href={business?.username ? `/app/${business.username}` : '/'}
              className="p-2 -ml-2 text-gray-800 hover:bg-gray-100 rounded-full transition-colors flex items-center gap-2"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
              </svg>
              <span className="text-sm font-medium">Volver</span>
            </Link>
          </div>
        </div>
      )}

      <div className={isEmbedded ? 'max-w-xl mx-auto py-2 px-3 sm:px-6' : 'max-w-xl mx-auto py-2 sm:py-6 px-3 sm:px-6'}>

        <div className="grid grid-cols-1 gap-3 sm:gap-6">
          {/* Main Content */}
          <div className="py-1 w-full space-y-3">

            {/* Step 1: Customer Info */}
            <div id="step-1" className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 sm:p-5">
              <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-2">
                <span className="flex items-center justify-center w-8 h-8 rounded-full bg-gray-900 text-white text-sm">1</span>
                Tus Datos
              </h2>

              <div className="space-y-4">
                {user ? (
                  <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl border border-gray-100 relative group animate-fadeIn w-full">
                    <div className="w-12 h-12 rounded-full overflow-hidden bg-white border border-gray-200 flex-shrink-0 flex items-center justify-center shadow-sm">
                      {user.photoURL ? (
                        <img src={user.photoURL} alt={user.nombres} className="w-full h-full object-cover" />
                      ) : (
                        <i className="bi bi-person-fill text-2xl text-gray-400"></i>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-gray-900 text-base leading-tight truncate">{user.nombres}</p>
                      <p className="text-sm text-gray-500 mt-0.5 flex items-center gap-1">
                        <i className="bi bi-phone text-xs"></i>
                        {user.celular || customerData.phone}
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        logout()
                        try {
                          localStorage.removeItem('loginPhone')
                          localStorage.removeItem('clientData')
                        } catch (e) {
                          console.error('Error clearing local client data on logout:', e)
                        }
                        setClientFound(null)
                        setCustomerData({ name: '', phone: '' })
                        setShowNameField(false)
                        setSelectedLocation(null)
                        setPhoneConfirmation('') // Limpiar confirmación
                      }}
                      className="px-3 py-1.5 text-xs font-bold text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 hover:border-gray-300 rounded-lg transition-all shadow-sm flex-shrink-0"
                    >
                      Salir
                    </button>
                  </div>
                ) : (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Número de Celular</label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                          <i className="bi bi-phone"></i>
                        </span>
                        <input
                          type="tel"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={customerData.phone}
                          onChange={(e) => {
                            const phone = e.target.value;
                            setCustomerData({ ...customerData, phone });
                            handlePhoneSearch(phone);
                          }}
                          onBlur={(e) => {
                            const phone = e.target.value;
                            const normalizedPhone = normalizeEcuadorianPhone(phone);
                            if (validateEcuadorianPhone(normalizedPhone)) {
                              setCustomerData({ ...customerData, phone: normalizedPhone });
                            }
                          }}
                          className={`w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent transition-all ${errors.phone || phoneError ? 'ring-2 ring-red-100 border-red-300' : ''}`}
                          placeholder="0999999999"
                          maxLength={10}
                          disabled={clientSearching}
                        />
                      </div>
                      {clientFound && (
                        <button
                          onClick={() => {
                            setClientFound(null)
                            setCustomerData({ name: '', phone: '' })
                            setShowNameField(false)
                            setSelectedLocation(null)
                            setPhoneError('')
                            setPhoneConfirmation('') // Limpiar confirmación
                          }}
                          className="px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded-xl transition-colors"
                          title="Cambiar número"
                        >
                          Cambiar
                        </button>
                      )}
                    </div>
                    {(errors.phone || phoneError) && <p className="text-red-500 text-xs mt-2 ml-1">{errors.phone || phoneError}</p>}

                    {/* Searching indicator */}
                    {clientSearching && (
                      <div className="mt-3 flex items-center gap-2 text-blue-600 animate-fadeIn">
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                        <p className="text-sm">Buscando cliente...</p>
                      </div>
                    )}

                    {/* Cliente no encontrado - pedir nombre para registrar */}
                    {!clientSearching && !clientFound && showNameField && customerData.phone.trim() && validateEcuadorianPhone(normalizeEcuadorianPhone(customerData.phone)) && (
                      <div className="mt-4 pt-4 border-t border-gray-100 animate-fadeIn">
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
                          <p className="text-sm text-blue-800">
                            <i className="bi bi-info-circle mr-2"></i>
                            Número no registrado. Por favor ingresa tus datos para continuar.
                          </p>
                        </div>

                        {/* Campo de confirmación de teléfono */}
                        <label className="block text-sm font-medium text-gray-700 mb-2">Confirmar Celular *</label>
                        <div className="relative mb-4">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                            <i className="bi bi-phone-fill"></i>
                          </span>
                          <input
                            type="tel"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            value={phoneConfirmation}
                            onChange={(e) => setPhoneConfirmation(e.target.value)}
                            className={`w-full pl-10 pr-12 py-3 bg-gray-50 border rounded-xl focus:outline-none focus:ring-2 transition-all ${phoneConfirmation.trim() && phoneConfirmation === customerData.phone
                              ? 'border-green-300 ring-2 ring-green-100 focus:ring-green-900'
                              : phoneConfirmation.trim() && phoneConfirmation !== customerData.phone
                                ? 'border-red-300 ring-2 ring-red-100 focus:ring-red-900'
                                : 'border-gray-200 focus:ring-gray-900'
                              }`}
                            placeholder="Vuelve a escribir tu celular"
                            maxLength={10}
                          />
                          {/* Ícono de validación */}
                          {phoneConfirmation.trim() && (
                            <span className="absolute right-3 top-1/2 -translate-y-1/2">
                              {phoneConfirmation === customerData.phone ? (
                                <i className="bi bi-check-circle-fill text-green-500 text-xl"></i>
                              ) : (
                                <i className="bi bi-x-circle-fill text-red-500 text-xl"></i>
                              )}
                            </span>
                          )}
                        </div>
                        {errors.phoneConfirmation && <p className="text-red-500 text-xs mt-[-8px] mb-4 ml-1">{errors.phoneConfirmation}</p>}

                        <label className="block text-sm font-medium text-gray-700 mb-2">Nombre Completo *</label>
                        <input
                          type="text"
                          required
                          value={customerData.name}
                          onChange={(e) => setCustomerData({ ...customerData, name: e.target.value })}
                          className={`w-full px-4 py-3 bg-gray-50 border rounded-xl focus:outline-none focus:ring-2 focus:ring-gray-900 transition-all ${errors.name || nameError ? 'border-red-300 ring-red-100' : 'border-gray-200'}`}
                          placeholder="Juan Pérez"
                        />
                        {(errors.name || nameError) && <p className="text-red-500 text-sm mt-1">{errors.name || nameError}</p>}

                        <button
                          onClick={handleCreateClient}
                          disabled={!customerData.name.trim() || !phoneConfirmation.trim() || phoneConfirmation !== customerData.phone}
                          className="w-full mt-3 px-4 py-3 bg-gray-900 text-white rounded-xl hover:bg-gray-800 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed font-medium"
                        >
                          Continuar
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Step 2: Delivery */}
            {/* Step 2: Delivery */}
            <div id="step-2" className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 sm:p-5">
              <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-2">
                <span className="flex items-center justify-center w-8 h-8 rounded-full bg-gray-900 text-white text-sm">2</span>
                Entrega
              </h2>
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <button
                    type="button"
                    onClick={() => {
                      if (!user) {
                        alert('Por favor, completa tus datos en el Paso 1 para continuar con el pedido a domicilio.');
                        return;
                      }
                      setDeliveryData(prev => ({ ...prev, type: 'delivery', tarifa: '0' }));

                      // Intento de sincronización: Buscar si la ubicación seleccionada en el Sidebar (localStorage) coincide con alguna guardada
                      const storedCoordsStr = localStorage.getItem('userCoordinates');
                      if (storedCoordsStr && clientLocations.length > 0) {
                        try {
                          const stored = JSON.parse(storedCoordsStr);
                          const match = clientLocations.find(l => {
                            const [lLat, lLng] = l.latlong.split(',').map((n: string) => parseFloat(n.trim()));
                            return Math.abs(lLat - stored.lat) < 0.0001 && Math.abs(lLng - stored.lng) < 0.0001;
                          });

                          if (match) {
                            handleLocationSelect(match);
                            return;
                          }
                        } catch (e) {
                          console.error("Error syncing location from storage:", e);
                        }
                      }

                      if (selectedLocation) return;

                      if (clientLocations.length > 0) {
                        handleLocationSelect(clientLocations[0]);
                        return;
                      }

                      // Fallback: si no hay ubicaciones guardadas, abrir modal para seleccionar/crear
                      openLocationModal();
                    }}
                    className={`p-4 rounded-2xl border-2 transition-all flex flex-col items-center gap-3 group relative overflow-hidden ${!user
                      ? 'border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed opacity-60'
                      : deliveryData.type === 'delivery'
                        ? 'border-gray-900 bg-gray-900 text-white shadow-lg'
                        : 'border-gray-100 bg-gray-50 text-gray-500 hover:border-gray-300 hover:bg-gray-100'
                      }`}
                  >
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center text-xl transition-colors ${!user
                      ? 'bg-gray-200 text-gray-400'
                      : deliveryData.type === 'delivery' ? 'bg-white/20 text-white' : 'bg-white text-gray-400'
                      }`}>
                      <i className="bi bi-bicycle"></i>
                    </div>
                    <span className="font-bold">Domicilio</span>
                    <span className={`text-xs mt-1 ${deliveryData.type === 'delivery' ? 'text-white/80' : 'text-gray-500'}`}>
                      {user ? 'Envío a tu casa' : 'Inicia sesión'}
                    </span>
                    {deliveryData.type === 'delivery' && user && (
                      <div className="absolute top-2 right-2 text-white text-xs">
                        <i className="bi bi-check-circle-fill"></i>
                      </div>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      if (!business?.pickupSettings?.enabled) return;
                      setSelectedLocation(null);
                      setDeliveryData(prev => ({ ...prev, type: 'pickup', address: '', references: '', tarifa: '0' }));
                    }}
                    disabled={!business?.pickupSettings?.enabled}
                    className={`p-4 rounded-2xl border-2 transition-all flex flex-col items-center gap-3 group relative overflow-hidden ${!business?.pickupSettings?.enabled
                      ? 'border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed opacity-60'
                      : deliveryData.type === 'pickup'
                        ? 'border-gray-900 bg-gray-900 text-white shadow-lg'
                        : 'border-gray-100 bg-gray-50 text-gray-500 hover:border-gray-300 hover:bg-gray-100'
                      }`}
                  >
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center text-xl transition-colors ${!business?.pickupSettings?.enabled
                      ? 'bg-gray-200 text-gray-400'
                      : deliveryData.type === 'pickup' ? 'bg-white/20 text-white' : 'bg-white text-gray-400'
                      }`}>
                      <i className="bi bi-shop"></i>
                    </div>
                    <span className="font-bold">Retiro en Tienda</span>
                    <span className={`text-xs mt-1 ${deliveryData.type === 'pickup' ? 'text-white/80' : 'text-gray-500'}`}>
                      {business?.pickupSettings?.enabled ? 'Atención local' : 'No disponible'}
                    </span>
                    {deliveryData.type === 'pickup' && business?.pickupSettings?.enabled && (
                      <div className="absolute top-2 right-2 text-white text-xs">
                        <i className="bi bi-check-circle-fill"></i>
                      </div>
                    )}
                  </button>
                </div>

                {/* Selected Location Display */}
                {deliveryData.type === 'delivery' && (
                  <div className="animate-fadeIn">
                    {selectedLocation ? (
                      <div className="bg-gray-50 border border-gray-100 rounded-xl p-4 flex items-start gap-3 relative group">
                        <div className="flex-shrink-0 w-20 h-20 rounded-xl overflow-hidden border border-gray-100 shadow-sm">
                          {selectedLocation.latlong ? (
                            <LocationMap latlong={selectedLocation.latlong} height="100%" />
                          ) : (
                            <div className="w-full h-full bg-gray-200 flex items-center justify-center text-gray-400">
                              <i className="bi bi-geo-alt-fill text-2xl"></i>
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-900">{selectedLocation.referencia}</p>
                          <p className="text-xs text-gray-500 mt-1 truncate">
                            Tarifa: ${Number(selectedLocation.tarifa || '0').toFixed(2)}
                          </p>
                        </div>
                        <button
                          onClick={openLocationModal}
                          className="px-3 py-1 text-sm font-medium text-gray-900 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors shadow-sm"
                        >
                          Cambiar
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={openLocationModal}
                        className="w-full py-4 border-2 border-dashed border-gray-300 rounded-xl text-gray-500 hover:border-gray-900 hover:text-gray-900 hover:bg-gray-50 transition-all flex flex-col items-center justify-center gap-2"
                      >
                        <i className="bi bi-geo-alt text-2xl"></i>
                        <span className="font-medium">Seleccionar ubicación de entrega</span>
                      </button>
                    )}
                  </div>
                )}

                {/* Store Location Info for Pickup */}
                {deliveryData.type === 'pickup' && (
                  <div className="animate-fadeIn">
                    <div className="bg-gray-50 border border-gray-100 rounded-2xl overflow-hidden shadow-sm">
                      <div className="p-4 flex items-start gap-3">
                        <div
                          className={`w-20 h-20 bg-gray-200 rounded-lg flex items-center justify-center text-gray-400 flex-shrink-0 overflow-hidden ${(business?.pickupSettings?.storePhotoUrl || business?.locationImage) ? 'cursor-pointer hover:ring-2 hover:ring-red-400 transition-all' : ''}`}
                          onClick={() => (business?.pickupSettings?.storePhotoUrl || business?.locationImage) && setShowStoreImageModal(true)}
                        >
                          {business?.pickupSettings?.storePhotoUrl ? (
                            <img
                              src={business.pickupSettings.storePhotoUrl}
                              alt={business.name}
                              className="w-full h-full object-cover"
                            />
                          ) : business?.locationImage ? (
                            <img
                              src={business.locationImage}
                              alt={business.name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <i className="bi bi-shop text-2xl"></i>
                          )}
                        </div>
                        <div className="flex-1 min-w-0 text-left">
                          <p className="font-medium text-gray-900">Retirar en:</p>
                          <p className="text-lg font-bold text-gray-800">{business?.name}</p>
                          {business?.pickupSettings?.references && (
                            <p className="text-sm text-gray-700 mt-2 flex items-start gap-2 italic">
                              <i className="bi bi-geo-alt-fill text-red-500 mt-1"></i>
                              {business.pickupSettings.references}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Mostrar mapa si hay coordenadas - Ahora dentro de la misma tarjeta */}
                      {business?.pickupSettings?.latlong && (
                        <div className="h-40 w-full border-t border-gray-100">
                          <LocationMap latlong={business.pickupSettings.latlong} height="100%" />
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Step 3: Timing */}
            <div id="step-3" className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 sm:p-5">
              <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-2">
                <span className="flex items-center justify-center w-8 h-8 rounded-full bg-gray-900 text-white text-sm">3</span>
                Horario
              </h2>
              <div className="space-y-6">
                {/* Mensaje informativo cuando la tienda está cerrada */}
                {!isStoreOpen(business) && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3 animate-fadeIn">
                    <i className="bi bi-info-circle-fill text-amber-600 text-xl flex-shrink-0 mt-0.5"></i>
                    <div className="flex-1">
                      <p className="font-medium text-amber-900">Tienda actualmente cerrada</p>
                      <p className="text-sm text-amber-700 mt-1">
                        Solo puedes programar pedidos para cuando la tienda esté abierta.
                      </p>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <button
                    type="button"
                    onClick={() => setTimingData({ type: 'immediate', scheduledDate: '', scheduledTime: '' })}
                    disabled={!isStoreOpen(business)}
                    className={`p-4 rounded-2xl border-2 transition-all flex flex-col items-center gap-3 group relative overflow-hidden ${!isStoreOpen(business)
                      ? 'border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed opacity-60'
                      : timingData.type === 'immediate'
                        ? 'border-gray-900 bg-gray-900 text-white shadow-lg'
                        : 'border-gray-100 bg-gray-50 text-gray-500 hover:border-gray-300 hover:bg-gray-100'
                      }`}
                  >
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center text-xl transition-colors ${!isStoreOpen(business)
                      ? 'bg-gray-200 text-gray-400'
                      : timingData.type === 'immediate'
                        ? 'bg-white/20 text-white'
                        : 'bg-white text-gray-400'
                      }`}>
                      <i className="bi bi-lightning-charge-fill"></i>
                    </div>
                    <span className="font-bold">Lo antes posible</span>
                    <span className={`text-xs mt-1 ${timingData.type === 'immediate' ? 'text-white/80' : 'text-gray-500'}`}>
                      {isStoreOpen(business) ? `Aprox ${business?.deliveryTime || 30} minutos` : 'Tienda cerrada'}
                    </span>
                    {timingData.type === 'immediate' && isStoreOpen(business) && (
                      <div className="absolute top-2 right-2 text-white text-xs">
                        <i className="bi bi-check-circle-fill"></i>
                      </div>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      // Si ya tiene datos, solo cambiar tipo (o mantenerlos)
                      // Si no tiene datos, calcular el próximo slot disponible
                      if (timingData.scheduledDate && timingData.scheduledTime) {
                        setTimingData({ ...timingData, type: 'scheduled' })
                      } else {
                        const nextSlot = getNextAvailableSlot(business)
                        setTimingData({
                          type: 'scheduled',
                          scheduledDate: nextSlot?.date || '',
                          scheduledTime: nextSlot?.time || ''
                        })
                      }
                    }}
                    className={`p-4 rounded-2xl border-2 transition-all flex flex-col items-center gap-3 group relative overflow-hidden ${timingData.type === 'scheduled'
                      ? 'border-gray-900 bg-gray-900 text-white shadow-lg'
                      : 'border-gray-100 bg-gray-50 text-gray-500 hover:border-gray-300 hover:bg-gray-100'
                      }`}
                  >
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center text-xl transition-colors ${timingData.type === 'scheduled' ? 'bg-white/20 text-white' : 'bg-white text-gray-400'}`}>
                      <i className="bi bi-clock-fill"></i>
                    </div>
                    <span className="font-bold">Programar</span>
                    {timingData.type === 'scheduled' && (
                      <div className="absolute top-2 right-2 text-white text-xs">
                        <i className="bi bi-check-circle-fill"></i>
                      </div>
                    )}
                  </button>
                </div>

                {timingData.type === 'scheduled' && (
                  <div className="grid grid-cols-2 gap-4 animate-fadeIn">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">{getDateLabel()}</label>
                      <input
                        type="date"
                        min={getMinScheduledDate()}
                        value={timingData.scheduledDate}
                        onChange={(e) => setTimingData({ ...timingData, scheduledDate: e.target.value })}
                        className={`w-full px-4 py-3 bg-gray-50 border rounded-xl focus:outline-none focus:ring-2 focus:ring-gray-900 ${timingData.scheduledDate && timingData.scheduledTime && !isSpecificTimeOpen(business, timingData.scheduledDate, timingData.scheduledTime)
                          ? 'border-red-300'
                          : 'border-gray-200'
                          }`}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Hora</label>
                      <input
                        type="time"
                        value={timingData.scheduledTime}
                        onChange={(e) => setTimingData({ ...timingData, scheduledTime: e.target.value })}
                        className={`w-full px-4 py-3 bg-gray-50 border rounded-xl focus:outline-none focus:ring-2 focus:ring-gray-900 ${timingData.scheduledDate && timingData.scheduledTime && !isSpecificTimeOpen(business, timingData.scheduledDate, timingData.scheduledTime)
                          ? 'border-red-300'
                          : 'border-gray-200'
                          }`}
                      />
                    </div>

                    {timingData.scheduledDate && timingData.scheduledTime && !isSpecificTimeOpen(business, timingData.scheduledDate, timingData.scheduledTime) && (
                      <div className="col-span-2 mt-2 p-3 bg-red-50 border border-red-100 rounded-xl flex items-start gap-2 animate-fadeIn">
                        <i className="bi bi-exclamation-circle-fill text-red-500 mt-0.5"></i>
                        <div className="text-sm text-red-700">
                          <p className="font-bold">Fuera de horario</p>
                          <p>La tienda no recibe pedidos en el horario seleccionado.</p>
                          {(() => {
                            const info = getStoreScheduleForDate(business, timingData.scheduledDate);
                            if (info?.schedule && info.schedule.isOpen) {
                              return (
                                <p className="mt-1 font-medium">
                                  El {info.dayName} atendemos de {info.schedule.open} a {info.schedule.close}.
                                </p>
                              );
                            } else if (info) {
                              return <p className="mt-1 font-medium text-red-800">El {info.dayName} la tienda permanece cerrada.</p>;
                            }
                            return null;
                          })()}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

          </div>

          {/* Sidebar - Responsive Order Summary */}
          <div className="space-y-3 h-fit">
            {/* Order Summary */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-6 flex items-center justify-between">
                Resumen del Pedido
                <span className="text-xs font-medium px-2.5 py-1 bg-gray-100 text-gray-600 rounded-full">
                  {cartItems.length} {cartItems.length === 1 ? 'ítem' : 'ítems'}
                </span>
              </h3>

              <div className="flex flex-col mb-6">
                {[...cartItems]
                  .sort((a, b) => {
                    if (a.esPremio && !b.esPremio) return 1;
                    if (!a.esPremio && b.esPremio) return -1;
                    return 0;
                  })
                  .map((item: any, index: number) => {
                    const isTarjeta = !!item.qrCodeId;
                    const isRegalo = item.esPremio && !isTarjeta;
                    const displayName = isRegalo || isTarjeta
                      ? item.name
                      : (item.variantName ? item.variantName : (item.productName || item.name));

                    return (
                      <div
                        key={index}
                        className="flex gap-3 py-3 border-b border-gray-100 last:border-0 transition-all group"
                      >
                        {/* Item Image Preview */}
                        <div className="w-12 h-12 rounded-lg bg-white border border-gray-200 flex-shrink-0 flex items-center justify-center overflow-hidden shadow-sm">
                          <img
                            src={item.image || embeddedBusiness?.image}
                            alt={displayName}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              const target = e.target as HTMLImageElement
                              if (target.src !== embeddedBusiness?.image) target.src = embeddedBusiness?.image || ''
                            }}
                          />
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between items-start gap-1">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center flex-wrap gap-x-2 gap-y-1">
                                <p className={`text-sm font-bold truncate leading-tight ${isTarjeta ? 'text-blue-900' : isRegalo ? 'text-amber-900' : 'text-gray-900'}`}>
                                  {displayName}
                                </p>
                                {isTarjeta ? (
                                  <span className="text-[9px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-black uppercase tracking-wider border border-blue-200">
                                    Tarjeta
                                  </span>
                                ) : isRegalo ? (
                                  <span className="text-[9px] bg-amber-200 text-amber-800 px-1.5 py-0.5 rounded font-black uppercase tracking-wider">
                                    Regalo
                                  </span>
                                ) : null}
                              </div>
                            </div>

                            <div className="flex items-center gap-3">
                              <p className={`text-sm font-medium whitespace-nowrap ${isTarjeta ? 'text-blue-700' : isRegalo ? 'text-amber-700' : 'text-gray-600'}`}>
                                {item.price > 0 ? `$${(item.price * item.quantity).toFixed(2)}` : '¡Gratis!'}
                              </p>
                              <button
                                onClick={() => handleRemoveItem(index)}
                                className="text-gray-400 hover:text-red-500 transition-colors p-1 rounded-full hover:bg-gray-100"
                                title="Quitar ítem"
                              >
                                <i className="bi bi-trash"></i>
                              </button>
                            </div>
                          </div>

                          <div className="flex items-center justify-between mt-1">
                            <p className="text-xs text-gray-500">
                              <span className="font-medium bg-gray-200/50 text-gray-500 px-1.5 py-0.5 rounded text-[10px]">x{item.quantity}</span>
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>



              <div className="space-y-3 pt-6 border-t border-gray-100">
                {/* Subtotal */}
                <div className="flex justify-between items-center text-sm">
                  <div className="flex items-center gap-2 text-gray-500">
                    <i className="bi bi-tag"></i>
                    <span>Subtotal</span>
                  </div>
                  <span className="font-bold text-gray-900">${subtotal.toFixed(2)}</span>
                </div>

                {/* Tarifa de envío */}
                <div className="flex justify-between items-center text-sm">
                  <div className="flex items-center gap-2 text-gray-500">
                    <i className="bi bi-truck"></i>
                    <span>Envío</span>
                  </div>
                  <span className={`font-bold ${deliveryCost > 0 ? 'text-gray-900' : 'text-amber-600'}`}>
                    {deliveryData.type === 'delivery' && deliveryCost === 0
                      ? 'Por calcular'
                      : (deliveryData.type === 'pickup' ? '$0' : (deliveryCost > 0 ? `$${deliveryCost.toFixed(2)}` : 'Por calcular'))}
                  </span>
                </div>

                {/* Total final */}
                <div className="flex justify-between items-center pt-4 border-t border-gray-200 mt-2">
                  <div className="flex items-center gap-2 text-gray-900">
                    <i className="bi bi-wallet2 text-lg"></i>
                    <span className="text-base font-bold">Total a pagar</span>
                  </div>
                  <p className="text-2xl font-black text-red-600 tracking-tight">${total.toFixed(2)}</p>
                </div>
              </div>
            </div>

            {/* Scanned Cards Section - Now Independent */}
            {visibleQrCards.length > 0 && (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-lg font-bold text-gray-900">Tarjetas escaneadas</h4>
                  {loadingQr && (
                    <span className="text-xs text-gray-400 font-bold">Cargando...</span>
                  )}
                </div>

                {qrError && (
                  <div className="mb-3 text-xs text-red-600 font-bold">
                    {qrError}
                  </div>
                )}

                <div className="overflow-x-auto scrollbar-hide -mx-6 px-6">
                  <div className="flex gap-4 pb-2 snap-x snap-mandatory">
                    {visibleQrCards.map((code) => {
                      const redeemed = (qrProgress?.redeemedPrizeCodes || []).includes(code.id)
                      const hasPrize = !!code.prize?.trim()
                      const isBeingRedeemedInThisOrder = qrPrizeIdsInCart.includes(code.id)
                      const canRedeem = hasPrize && !redeemed && !isBeingRedeemedInThisOrder
                      const dark = isDarkColor(code.color)
                      const cardBg = isBeingRedeemedInThisOrder ? '#E5E7EB' : (code.color || '#F3F4F6')
                      const cardTextDark = isBeingRedeemedInThisOrder ? false : dark

                      return (
                        <div
                          key={code.id}
                          className="min-w-[260px] max-w-[260px] snap-start rounded-2xl p-4 shadow-sm border border-black/5"
                          style={{ backgroundColor: cardBg }}
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-12 h-12 rounded-xl overflow-hidden bg-white/80 border border-white/40 flex-shrink-0">
                              <img
                                src={code.image || business?.image || 'https://via.placeholder.com/80?text=QR'}
                                alt={code.prize || code.name}
                                className="w-full h-full object-cover"
                                loading="lazy"
                                decoding="async"
                                onError={(e) => {
                                  const target = e.target as HTMLImageElement
                                  target.src = business?.image || 'https://via.placeholder.com/80?text=QR'
                                }}
                              />
                            </div>

                            <div className="min-w-0 flex-1">
                              <p className={`text-sm font-black truncate ${cardTextDark ? 'text-white' : 'text-gray-900'}`}>🎫 {code.name}</p>
                              {hasPrize ? (
                                <p className={`text-xs truncate ${cardTextDark ? 'text-white/90' : 'text-gray-700'}`}>Premio: {code.prize}</p>
                              ) : (
                                <p className={`text-xs truncate ${cardTextDark ? 'text-white/70' : 'text-gray-500'}`}>Sin premio configurado</p>
                              )}
                              {isBeingRedeemedInThisOrder ? (
                                <p className="text-[10px] font-black uppercase tracking-widest mt-1 text-gray-500">En canje</p>
                              ) : redeemed ? (
                                <p className={`text-[10px] font-black uppercase tracking-widest mt-1 ${cardTextDark ? 'text-white/70' : 'text-gray-500'}`}>Canjeado</p>
                              ) : null}
                            </div>
                          </div>

                          <div className="mt-4">
                            <button
                              onClick={() => handleRedeemQrPrize(code)}
                              disabled={!canRedeem || redeemingQrId === code.id || isBeingRedeemedInThisOrder}
                              className={`w-full px-3 py-2 rounded-xl text-[10px] font-black uppercase transition-colors disabled:cursor-not-allowed ${dark
                                ? 'bg-white text-gray-900 hover:bg-white/90 disabled:bg-white/50'
                                : 'bg-gray-900 text-white hover:bg-black disabled:bg-gray-300'
                                }`}
                            >
                              {isBeingRedeemedInThisOrder
                                ? 'En carrito'
                                : (redeemingQrId === code.id ? 'Canjeando...' : (hasPrize ? 'Canjear' : 'No disponible'))}
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Step 4: Payment */}
            <div id="step-4" className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 sm:p-5">
              <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-2">
                <span className="flex items-center justify-center w-8 h-8 rounded-full bg-gray-900 text-white text-sm">4</span>
                Pago
              </h2>

              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-3">
                  {/* Efectivo */}
                  <button
                    type="button"
                    onClick={() => setPaymentData({ ...paymentData, method: 'cash' })}
                    className={`p-4 rounded-2xl border-2 transition-all flex flex-col items-center gap-3 group relative overflow-hidden ${paymentData.method === 'cash'
                      ? 'border-gray-900 bg-gray-900 text-white shadow-lg'
                      : 'border-gray-100 bg-gray-50 text-gray-500 hover:border-gray-300 hover:bg-gray-100'
                      }`}
                  >
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center text-xl transition-colors ${paymentData.method === 'cash' ? 'bg-white/20 text-white' : 'bg-white text-gray-400'}`}>
                      <i className="bi bi-cash-coin"></i>
                    </div>
                    <span className="font-bold">Efectivo</span>
                    {paymentData.method === 'cash' && (
                      <div className="absolute top-2 right-2 text-white text-xs">
                        <i className="bi bi-check-circle-fill"></i>
                      </div>
                    )}
                  </button>
                  {/* Transferencia */}
                  <button
                    type="button"
                    onClick={() => setPaymentData({ ...paymentData, method: 'transfer' })}
                    className={`p-4 rounded-2xl border-2 transition-all flex flex-col items-center gap-3 group relative overflow-hidden ${paymentData.method === 'transfer'
                      ? 'border-gray-900 bg-gray-900 text-white shadow-lg'
                      : 'border-gray-100 bg-gray-50 text-gray-500 hover:border-gray-300 hover:bg-gray-100'
                      }`}
                  >
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center text-xl transition-colors ${paymentData.method === 'transfer' ? 'bg-white/20 text-white' : 'bg-white text-gray-400'}`}>
                      <i className="bi bi-bank"></i>
                    </div>
                    <span className="font-bold">Transferencia</span>
                    {paymentData.method === 'transfer' && (
                      <div className="absolute top-2 right-2 text-white text-xs">
                        <i className="bi bi-check-circle-fill"></i>
                      </div>
                    )}
                  </button>
                </div>

                {errors.paymentMethod && (
                  <p className="text-red-500 text-sm flex items-center">
                    <i className="bi bi-exclamation-triangle mr-1"></i>
                    {errors.paymentMethod}
                  </p>
                )}

                {paymentData.method === 'transfer' && (
                  <div className="mt-6 bg-gray-50 p-4 rounded-lg animate-fadeIn">
                    {/* Solo mostrar datos bancarios si NO hay comprobante adjunto */}
                    {!paymentData.receiptImageUrl && (
                      <>
                        <h3 className="font-medium mb-4">💳 Datos para realizar la transferencia</h3>

                        {/* Selector de banco */}
                        <div className="mb-4">
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Selecciona el banco:
                          </label>
                          <div className="grid grid-cols-2 gap-3">
                            {[
                              { id: 'pichincha', label: 'Pichincha', colorClass: 'bg-yellow-100 text-yellow-600', activeClass: 'bg-yellow-400 border-yellow-500 text-gray-900' },
                              { id: 'pacifico', label: 'Pacifico', colorClass: 'bg-blue-100 text-blue-600', activeClass: 'bg-blue-600 border-blue-700 text-white' },
                              { id: 'guayaquil', label: 'Guayaquil', colorClass: 'bg-pink-100 text-pink-600', activeClass: 'bg-pink-600 border-pink-700 text-white' },
                              { id: 'produbanco', label: 'Produbanco', colorClass: 'bg-green-100 text-green-600', activeClass: 'bg-green-600 border-green-700 text-white' },
                            ].map((bank) => (
                              <button
                                key={bank.id}
                                type="button"
                                onClick={() => setPaymentData({ ...paymentData, selectedBank: bank.id })}
                                className={`w-full h-24 rounded-2xl border-2 transition-all flex flex-col items-center justify-center gap-2 ${paymentData.selectedBank === bank.id
                                  ? `${bank.activeClass} shadow-md`
                                  : 'border-gray-100 bg-white text-gray-500 hover:border-gray-300'
                                  }`}
                              >
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg ${paymentData.selectedBank === bank.id ? 'bg-white/30 text-inherit' : bank.colorClass}`}>
                                  <i className="bi bi-bank"></i>
                                </div>
                                <span className="text-xs font-bold text-center leading-tight">
                                  {bank.label}
                                </span>
                              </button>
                            ))}
                          </div>
                          {errors.selectedBank && (
                            <p className="text-red-500 text-xs mt-1 flex items-center">
                              <i className="bi bi-exclamation-triangle mr-1"></i>
                              {errors.selectedBank}
                            </p>
                          )}
                        </div>

                        {/* Mostrar datos bancarios según selección */}
                        {paymentData.selectedBank && (
                          <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm mt-4">
                            <div className="space-y-5">
                              {/* Header del Banco */}
                              <div className="pb-4 border-b border-gray-100">
                                <p className="text-xs text-gray-500 uppercase font-bold tracking-wider mb-1">Banco Destino</p>
                                <p className="font-bold text-gray-900 text-xl flex items-center gap-2">
                                  {paymentData.selectedBank === 'pichincha' && 'Banco Pichincha'}
                                  {paymentData.selectedBank === 'pacifico' && 'Banco del Pacífico'}
                                  {paymentData.selectedBank === 'guayaquil' && 'Banco Guayaquil'}
                                  {paymentData.selectedBank === 'produbanco' && 'Banco Produbanco'}
                                </p>
                              </div>

                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                                <div>
                                  <p className="text-xs text-gray-500 uppercase font-bold tracking-wider mb-1">Cuenta de Ahorros</p>
                                  <div className="flex items-center gap-2">
                                    <p className="font-mono text-xl font-bold text-gray-900 bg-gray-50 px-2 py-1 rounded-lg border border-gray-100 inline-block">
                                      {paymentData.selectedBank === 'pichincha' && '2203257517'}
                                      {paymentData.selectedBank === 'pacifico' && '1063889358'}
                                      {paymentData.selectedBank === 'guayaquil' && '0030697477'}
                                      {paymentData.selectedBank === 'produbanco' && '20059842774'}
                                    </p>
                                  </div>
                                </div>
                                <div>
                                  <p className="text-xs text-gray-500 uppercase font-bold tracking-wider mb-1">Cédula / RUC</p>
                                  <p className="font-medium text-gray-900 text-lg">
                                    {paymentData.selectedBank === 'produbanco' ? '0929057636' : '0929057636'}
                                  </p>
                                </div>
                              </div>

                              <div>
                                <p className="text-xs text-gray-500 uppercase font-bold tracking-wider mb-1">Titular de la Cuenta</p>
                                <p className="font-medium text-gray-900 text-lg border-b border-gray-100 pb-1 inline-block">
                                  {paymentData.selectedBank === 'produbanco' ? 'Pedro Sánchez León' : 'Pedro Sánchez León'}
                                </p>
                              </div>
                            </div>



                            {/* Bloque informativo condicional */}
                            <div className={`mt-6 p-4 rounded-xl flex gap-3 items-start ${!deliveryData.type
                              ? 'bg-amber-50 border border-amber-200'
                              : 'bg-gray-900 text-white shadow-lg'
                              }`}>
                              <i className={`text-xl flex-shrink-0 mt-0.5 ${!deliveryData.type
                                ? 'bi bi-info-circle-fill text-amber-600'
                                : 'bi bi-cash-stack text-white'
                                }`}></i>
                              <div className="flex-1">
                                {!deliveryData.type ? (
                                  <>
                                    <p className="font-medium text-amber-900">Estimado: ${subtotal.toFixed(2)}</p>
                                    <p className="text-sm text-amber-700 mt-1">
                                      Completa el paso 2 para poder subir tu comprobante de transferencia.
                                    </p>
                                  </>
                                ) : (
                                  <>
                                    <p className="font-bold text-lg mb-1">Total a transferir: ${total.toFixed(2)}</p>
                                    <p className="text-sm text-gray-300 leading-snug">
                                      Transfiere el monto exacto y sube tu comprobante a continuación para confirmar tu pedido.
                                    </p>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </>
                    )}


                    {/* Componente para subir comprobante - Solo visible si completó paso 2 */}
                    {paymentData.selectedBank && clientFound && deliveryData.type && (
                      <TransferReceiptUploader
                        onReceiptUpload={handleReceiptUpload}
                        uploadedImageUrl={paymentData.receiptImageUrl || null}
                        isUploading={uploadingReceipt}
                        clientId={clientFound.id}
                      />
                    )}

                    {/* Error del comprobante */}
                    {errors.receiptImage && (
                      <p className="text-red-500 text-xs mt-2 flex items-center">
                        <i className="bi bi-exclamation-triangle mr-1"></i>
                        {errors.receiptImage}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>

          </div>
        </div>

        {/* Navigation buttons removed: users change steps using the progress indicators above */}

        {/* Confirmación final (no flotante) */}
        <div className="max-w-xl mx-auto mt-6 px-4">
          <div className="bg-white rounded-lg shadow-md p-4 flex justify-center">
            <div className="w-full sm:w-auto text-center">
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!readyToConfirm || loading || (deliveryData.type === 'delivery' && selectedLocationOutsideCoverage)}
                className={`w-full sm:w-auto px-6 py-3 rounded-lg text-white font-medium ${!readyToConfirm || loading || (deliveryData.type === 'delivery' && selectedLocationOutsideCoverage)
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-green-500 hover:bg-green-600'
                  }`}
              >
                {loading ? 'Procesando...' : (readyToConfirm ? 'Confirmar pedido' : 'Completa los pasos')}
              </button>
              {deliveryData.type === 'delivery' && selectedLocationOutsideCoverage && (
                <p className="text-sm text-yellow-800 mt-2">No es posible confirmar el pedido porque la ubicación seleccionada está fuera de la zona de cobertura.</p>
              )}
            </div>
          </div>
        </div>

        {/* Modal externo reutilizable */}
        <LocationSelectionModal
          isOpen={isLocationModalOpen}
          onClose={closeLocationModal}
          clientLocations={clientLocations}
          onSelect={handleLocationSelect}
          onLocationCreated={(newLocation) => {
            setClientLocations(prev => [...prev, newLocation]);
            handleLocationSelect(newLocation);
          }}
          clientId={effectiveClientId}
          businessId={business?.id}
          initialAddingState={isAddingNewLocation}
          selectedLocationId={selectedLocation?.id}
        />

        {/* Modal para ver la foto del local a pantalla completa */}
        {showStoreImageModal && business?.locationImage && (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/90 animate-fadeIn"
            onClick={() => setShowStoreImageModal(false)}
          >
            <div className="relative max-w-4xl w-full">
              <button
                className="absolute -top-12 right-0 text-white text-3xl hover:text-gray-300 transition-colors"
                onClick={() => setShowStoreImageModal(false)}
              >
                <i className="bi bi-x-lg"></i>
              </button>
              <img
                src={business.locationImage}
                alt="Foto del local"
                className="w-full h-auto max-h-[80vh] object-contain rounded-xl shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              />
              <div className="mt-4 text-center">
                <p className="text-white font-bold text-lg">{business.name}</p>
                <p className="text-gray-300 text-sm">{business.address}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div >
  )
}

