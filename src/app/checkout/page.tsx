'use client'

import { useState, useEffect, Suspense, useRef, useCallback, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { validateEcuadorianPhone, normalizeEcuadorianPhone, validateAndNormalizePhone } from '@/lib/validation'
import { createOrder, getBusiness, searchClientByPhone, createClient, updateClient, setClientPin, FirestoreClient, getClientLocations, ClientLocation, getDeliveryFeeForLocation, createClientLocation, registerOrderConsumption, clearClientPin, registerClientForgotPin } from '@/lib/database'
import { Business } from '@/types'
import LocationMap from '@/components/LocationMap'
import LocationSelectionModal from '@/components/LocationSelectionModal'
import { useAuth } from '@/contexts/AuthContext'
import { storage } from '@/lib/firebase'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { Timestamp } from 'firebase/firestore'
import { isStoreOpen } from '@/lib/store-utils'


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
      // Crear preview local
      const previewUrl = URL.createObjectURL(file)
      setPreviewImage(previewUrl)

      // Subir a Firebase Storage siguiendo la estructura: comprobantes/{clientId}/{timestamp}_{filename}
      const timestamp = Date.now()
      const fileName = `comprobantes/${clientId}/${timestamp}_${file.name}`
      const storageRef = ref(storage, fileName)

      await uploadBytes(storageRef, file)
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

export default function CheckoutPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-red-500 mx-auto"></div>
            <p className="mt-4 text-gray-600">Cargando checkout...</p>
          </div>
        </div>
      }
    >
      <CheckoutContent />
    </Suspense>
  )
}

function CheckoutContent() {
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

  // Estado y hooks necesarios para el componente
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, login, logout } = useAuth()

  const [isClient, setIsClient] = useState(false)
  const [currentStep, setCurrentStep] = useState<number>(1)
  const [loading, setLoading] = useState(false)
  const [isProcessingOrder, setIsProcessingOrder] = useState(false)

  const [business, setBusiness] = useState<Business | null>(null)

  const [clientFound, setClientFound] = useState<any | null>(null)
  const [clientSearching, setClientSearching] = useState(false)
  const [showNameField, setShowNameField] = useState(false)
  const [registerPin, setRegisterPin] = useState('')
  const [registerPinConfirm, setRegisterPinConfirm] = useState('')
  const [registerError, setRegisterError] = useState('')
  const [registerLoading, setRegisterLoading] = useState(false)
  const [loginPin, setLoginPin] = useState('')
  const [loginPinError, setLoginPinError] = useState('')
  const [loginPinLoading, setLoginPinLoading] = useState(false)
  const [pinAttempted, setPinAttempted] = useState(false)

  const [customerData, setCustomerData] = useState<CustomerData>({ name: '', phone: '' })

  const [clientLocations, setClientLocations] = useState<ClientLocation[]>([])
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
    if (!clientFound) {
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
      return;
    }

    // Normalizar el número de teléfono antes de validar y buscar
    const normalizedPhone = normalizeEcuadorianPhone(phone);
    setPinAttempted(false);

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
        // Prefill nombre si existe; mostrar casillero de nombre solo cuando el cliente NO tiene nombres y NO tiene PIN
        setCustomerData(prev => ({
          ...prev,
          name: client.pinHash ? (client.nombres || '') : '',
          phone: normalizedPhone // Actualizar con el número normalizado
        }));
        setShowNameField(!client.pinHash);
        setClientLocations([]);
        setSelectedLocation(null);
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
      if (clientFound && clientFound.id) {
        // Actualizar cliente existente con el nombre proporcionado
        try {
          await updateClient(clientFound.id, { nombres: customerData.name.trim() })
        } catch (e) {
          console.warn('No se pudo actualizar el nombre del cliente existente:', e)
        }

        // Refrescar estado local del cliente encontrado
        setClientFound((prev: any) => prev ? { ...prev, nombres: customerData.name.trim() } : prev)
        setShowNameField(false)
        // Ensure phone is normalized in customerData
        setCustomerData(prev => ({ ...prev, phone: normalizedPhone }))
        return
      }

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
      console.error('Error creating/updating client:', error);
      // Aquí podrías agregar manejo de errores para mostrar al usuario
    }
  }

  // Función para hashear el PIN de manera consistente (misma lógica que ClientLoginModal)
  async function hashPin(pin: string): Promise<string> {
    // Implementación de hash simple pero consistente
    const simpleHash = (str: string): string => {
      let hash = 0
      for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i)
        hash = ((hash << 5) - hash) + char
        hash = hash & hash // Convierte a 32bit entero
      }
      return Math.abs(hash).toString(16).padStart(8, '0')
    }

    // Para compatibilidad con hashes existentes, intentar usar SHA-256
    try {
      if (typeof window !== 'undefined' && window.crypto?.subtle?.digest) {
        // Si el hash existente del cliente tiene 64 caracteres, asumimos SHA-256
        if (clientFound?.pinHash?.length === 64) {
          const encoder = new TextEncoder()
          const data = encoder.encode(pin)
          const hashBuffer = await window.crypto.subtle.digest('SHA-256', data)
          const hashArray = Array.from(new Uint8Array(hashBuffer))
          return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
        }
      }
    } catch (e) {
      console.warn('Error usando Web Crypto API, usando hash simple', e)
    }

    // Por defecto, usar el hash simple
    return simpleHash(pin)
  }

  // Handle registering or setting PIN from checkout
  const handleCheckoutRegisterOrSetPin = async () => {
    setRegisterError('')
    // Requerir nombre cuando el cliente no existe o existe pero no tiene PIN (queremos que escriba su nombre)
    const requireName = !clientFound || (clientFound && !clientFound.pinHash)
    if (requireName && (!customerData.name || !customerData.name.trim())) {
      setRegisterError('Ingresa tu nombre')
      return
    }
    if (!/^[0-9]{4,6}$/.test(registerPin)) {
      setRegisterError('El PIN debe contener entre 4 y 6 dígitos')
      return
    }
    if (registerPin !== registerPinConfirm) {
      setRegisterError('Los PIN no coinciden')
      return
    }

    setRegisterLoading(true)
    try {
      const pinHash = await hashPin(registerPin)
      const normalizedPhone = normalizeEcuadorianPhone(customerData.phone)

      let registeredClientId = clientFound?.id;

      if (clientFound && clientFound.id) {
        // Update name only if user provided one (to avoid wiping existing nombres)
        try {
          if (customerData.name && customerData.name.trim()) {
            await updateClient(clientFound.id, { nombres: customerData.name.trim() })
          }
        } catch (e) {
          console.warn('Could not update client name before setting PIN', e)
        }
        // Set PIN
        await setClientPin(clientFound.id, pinHash)
        const updated = await searchClientByPhone(normalizedPhone)
        if (updated) {
          login(updated as any)
          setClientFound(updated)
          setShowNameField(false)
          registeredClientId = updated.id
        }
      } else {
        const newClient = await createClient({ celular: normalizedPhone, nombres: customerData.name, pinHash })
        login(newClient as any)
        setClientFound(newClient as any)
        setShowNameField(false)
        registeredClientId = newClient.id
      }

      // Cargar las ubicaciones del cliente después de registrarse/crear PIN
      if (registeredClientId) {
        setLoadingLocations(true);
        try {
          const locations = await getClientLocations(registeredClientId);
          setClientLocations(locations);
        } catch (error) {
          console.error('Error loading client locations after registration:', error);
          setClientLocations([]);
        } finally {
          setLoadingLocations(false);
        }
      }
      // clear pins
      setRegisterPin('')
      setRegisterPinConfirm('')
    } catch (error) {
      console.error('Error registering/setting PIN in checkout:', error)
      setRegisterError('Error al procesar registro. Intenta nuevamente.')
    } finally {
      setRegisterLoading(false)
    }
  }

  const handleCheckoutLoginWithPin = async () => {
    setLoginPinError('')
    setPinAttempted(true)
    if (!clientFound) return
    if (!/^[0-9]{4,6}$/.test(loginPin)) {
      setLoginPinError('PIN inválido')
      return
    }
    setLoginPinLoading(true)
    try {
      const pinHash = await hashPin(loginPin)
      if (pinHash === clientFound.pinHash) {
        login(clientFound as any)
        // Ensure checkout form reflects logged-in client
        setCustomerData(prev => ({ ...prev, name: clientFound.nombres || '', phone: normalizeEcuadorianPhone(prev.phone) }))
        setShowNameField(false)
        setLoginPin('')

        // Cargar las ubicaciones del cliente después de ingresar el PIN
        if (clientFound?.id) {
          setLoadingLocations(true);
          try {
            const locations = await getClientLocations(clientFound.id);
            setClientLocations(locations);
          } catch (error) {
            console.error('Error loading client locations after PIN login:', error);
            setClientLocations([]);
          } finally {
            setLoadingLocations(false);
          }
        }
      } else {
        setLoginPinError('PIN incorrecto')
      }
    } catch (error) {
      console.error('Error validating PIN in checkout:', error)
      setLoginPinError('Error al verificar PIN')
    } finally {
      setLoginPinLoading(false)
    }
  }

  const handleCheckoutResetPin = async () => {
    if (!clientFound?.id) return;
    try {
      setLoginPinLoading(true)
      await registerClientForgotPin(clientFound.id)
      await clearClientPin(clientFound.id)
      // Refrescar UI para mostrar flujo de crear PIN
      setClientFound((prev: any | null) => (prev ? { ...prev, pinHash: null } : prev))
      setLoginPin('')
      setLoginPinError('')
      setShowNameField(true) // Mostrar campo de nombre para que pueda actualizarlo si desea
    } catch (e) {
      console.error('Error al limpiar PIN:', e)
      setLoginPinError('No se pudo restablecer el PIN. Intenta nuevamente.')
    } finally {
      setLoginPinLoading(false)
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

  // Función duplicada removida

  useEffect(() => {
    // Cargar datos del negocio y carrito desde localStorage
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

    // Si el usuario está autenticado, cargar automáticamente su información
    if (user) {
      setCustomerData(prev => ({
        ...prev,
        name: user.nombres || '',
        phone: user.celular || ''
      }));
      setShowNameField(false);

      // Cargar las ubicaciones del usuario
      const loadUserLocations = async () => {
        setLoadingLocations(true);
        try {
          const locations = await getClientLocations(user.id);
          setClientLocations(locations);
          // Seleccionar automáticamente la primera ubicación si existe
          if (locations.length > 0) {
            handleLocationSelect(locations[0]);
          }
        } catch (error) {
          console.error('Error loading user locations:', error);
          setClientLocations([]);
        } finally {
          setLoadingLocations(false);
        }
      };

      loadUserLocations();
    }
  }, [searchParams, router, user])

  // Client-only guard: render nothing until mounted on client
  if (!isClient) return null;

  // Cargar datos del carrito específico de este negocio desde localStorage
  const getCartItems = () => {
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

  const cartItems = getCartItems()
  const subtotal = cartItems.reduce((sum: number, item: any) => sum + (item.price * item.quantity), 0)
  const deliveryCost = getDeliveryCost()
  const total = subtotal + deliveryCost

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
        maxStep = 4;
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
      return Boolean(timingData.scheduledDate && timingData.scheduledTime);
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
      // Ajuste de offset para el header fijo si existiera, o simplemente un margen superior
      const yOffset = -100;
      const y = element.getBoundingClientRect().top + window.pageYOffset + yOffset;
      window.scrollTo({ top: y, behavior: 'smooth' });
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
        // Para inmediato: fecha y hora actuales + 31 minutos
        const now = new Date();
        const deliveryTime = new Date(now.getTime() + 31 * 60 * 1000);

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
      const businessId = searchParams.get('businessId') || ''

      // Luego crear el objeto orderData
      const orderData = {
        businessId: businessId,
        items: cartItems.map((item: any) => ({
          productId: item.id.split('-')[0],
          name: item.variantName || item.productName || item.name,
          price: item.price,
          quantity: item.quantity,
          variant: item.variantName || item.name
        })),
        customer: {
          name: customerData.name,
          phone: customerData.phone
        },
        delivery: {
          type: deliveryData.type as 'delivery' | 'pickup',
          references: deliveryData.type === 'delivery' ? (deliveryData.address || '') : '',
          latlong: selectedLocation?.latlong || '',
          deliveryCost: deliveryData.type === 'delivery' ? deliveryCost : 0
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

      const orderId = await createOrder(orderData);

      // Registrar consumo de ingredientes automáticamente
      try {
        const orderDateStr = new Date().toISOString().split('T')[0]
        await registerOrderConsumption(
          businessId,
          cartItems.map((item: any) => ({
            productId: item.id.split('-')[0],
            variant: item.variantName || item.name,
            name: item.variantName || item.productName || item.name,
            quantity: item.quantity
          })),
          orderDateStr,
          orderId
        )
      } catch (error) {
        console.error('Error registering order consumption:', error)
        // No interrumpir el flujo si hay error en consumo
      }

      // Limpiar carrito específico de este negocio
      if (businessId) {
        const cartsData = localStorage.getItem('carts')
        if (cartsData) {
          try {
            const allCarts = JSON.parse(cartsData)
            delete allCarts[businessId] // Eliminar carrito de este negocio
            localStorage.setItem('carts', JSON.stringify(allCarts))
          } catch (e) {
            console.error('Error updating carts in localStorage', e)
          }
        }
      }

      // Redirigir a la página de estado del pedido con la ruta /o/[orderId]
      router.push(`/o/${orderId}`)
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
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
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
    );
  }
  // Determinar si la ubicación seleccionada está fuera de cobertura (tarifa nula o 0)
  const selectedLocationOutsideCoverage = !!selectedLocation && !calculatingTariff && (selectedLocation.tarifa == null || Number(selectedLocation.tarifa) <= 0);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Sticky Header - Simplified with only back arrow */}
      <div className="px-4 sm:px-6 pt-6 pb-4 bg-white sticky top-0 z-10 border-b border-gray-100 shadow-sm mb-6">
        <div className="max-w-4xl mx-auto flex items-center">
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

      <div className="max-w-4xl mx-auto py-4 sm:py-8 px-4 sm:px-6">

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
          {/* Main Content */}
          <div className="lg:col-span-2 py-2 max-w-4xl mx-auto space-y-6">

            {/* Step 1: Customer Info */}
            <div id="step-1" className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
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
                        setClientFound(null)
                        setCustomerData({ name: '', phone: '' })
                        setShowNameField(true)
                        setSelectedLocation(null)
                        setPinAttempted(false)
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
                          className={`w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent transition-all ${errors.phone ? 'ring-2 ring-red-100 border-red-300' : ''}`}
                          placeholder="0999999999"
                          maxLength={10}
                          disabled={!!clientFound}
                        />
                      </div>
                      {clientFound && (
                        <button
                          onClick={() => {
                            setClientFound(null)
                            setCustomerData({ name: '', phone: '' })
                            setShowNameField(true)
                            setSelectedLocation(null)
                            setPinAttempted(false)
                          }}
                          className="px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded-xl transition-colors"
                          title="Cambiar número"
                        >
                          Cambiar
                        </button>
                      )}
                    </div>
                    {errors.phone && <p className="text-red-500 text-xs mt-2 ml-1">{errors.phone}</p>}
                  </div>
                )}

                {/* Lógica solicitada:
                        - Si el número está vacío: no mostrar nada más.
                        - Si hay sesión (`user`): ya se muestra la tarjeta de usuario arriba.
                        - Si no hay sesión y se ingresó teléfono: según `clientFound` mostrar:
                          * cliente con pinHash -> pedir PIN para iniciar sesión
                          * cliente sin pinHash -> formulario de registro (pero si existe `nombres` no pedir nombre, solo crear PIN)
                          * cliente no encontrado -> formulario de registro (pedir nombre + crear PIN)
                    */}

                {customerData.phone.trim() && !user && (
                  <div>
                    {/* clientSearching ya se muestra junto al input; evitemos duplicarlo */}
                    {clientSearching && (
                      <p className="text-blue-500 text-sm mt-1">Buscando cliente...</p>
                    )}

                    {!clientSearching && clientFound && clientFound.pinHash && (
                      // Cliente existente con PIN -> mostrar saludo y pedir PIN para iniciar sesión
                      <div className="mt-4">
                        <p className="text-sm text-gray-700 mb-2">Hola <strong>{clientFound.nombres || clientFound.celular}</strong></p>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Ingresa tu PIN</label>
                        <input
                          type="password"
                          value={loginPin}
                          onChange={(e) => setLoginPin(e.target.value)}
                          maxLength={6}
                          className="w-full px-3 py-2 border rounded-xl"
                          onKeyPress={(e) => e.key === 'Enter' && handleCheckoutLoginWithPin()}
                        />
                        {pinAttempted && (
                          <div className="text-right mt-1">
                            <button
                              type="button"
                              onClick={handleCheckoutResetPin}
                              className="text-xs text-gray-500 hover:text-red-500 transition-colors"
                            >
                              ¿Olvidaste tu PIN?
                            </button>
                          </div>
                        )}
                        {loginPinError && <p className="text-red-500 text-sm mt-1">{loginPinError}</p>}
                        <div className="mt-3">
                          <button onClick={handleCheckoutLoginWithPin} disabled={loginPinLoading} className="w-full px-4 py-2 bg-red-500 text-white rounded-xl">{loginPinLoading ? 'Verificando...' : 'Iniciar sesión'}</button>
                        </div>
                      </div>
                    )}

                    {!clientSearching && clientFound && !clientFound.pinHash && (
                      // Cliente existente sin PIN -> formulario de registro
                      <div className="mt-4">
                        {/* Mostrar siempre input Nombre (prellenado si clientFound.nombres existe) para permitir actualizar el nombre y luego crear PIN */}
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Nombre Completo *</label>
                          <input
                            type="text"
                            required
                            value={customerData.name}
                            onChange={(e) => setCustomerData({ ...customerData, name: e.target.value })}
                            className={`w-full px-3 py-2 border rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500 ${errors.name ? 'border-red-500' : 'border-gray-300'}`}
                            placeholder="Juan Pérez"
                          />
                          {errors.name && <p className="text-red-500 text-sm mt-1">{errors.name}</p>}
                        </div>

                        <div className="mt-3">
                          <label className="block text-sm font-medium text-gray-700 mb-2">Crea un PIN (4-6 dígitos)</label>
                          <input type="password" value={registerPin} onChange={(e) => setRegisterPin(e.target.value)} maxLength={6} className="w-full px-3 py-2 border rounded-xl" />
                          <label className="block text-sm font-medium text-gray-700 mb-2 mt-2">Confirmar PIN</label>
                          <input type="password" value={registerPinConfirm} onChange={(e) => setRegisterPinConfirm(e.target.value)} maxLength={6} className="w-full px-3 py-2 border rounded-xl" />
                          {registerError && <p className="text-red-500 text-sm mt-1">{registerError}</p>}
                          <div className="mt-3">
                            <button onClick={handleCheckoutRegisterOrSetPin} disabled={registerLoading} className="w-full px-4 py-2 bg-red-500 text-white rounded-xl">{registerLoading ? 'Procesando...' : 'Registrarse'}</button>
                          </div>
                        </div>
                      </div>
                    )}

                    {!clientSearching && !clientFound && customerData.phone.trim() && (
                      // Teléfono no encontrado -> formulario de registro (pedir nombre + crear PIN)
                      <div className="mt-4 pt-4 border-t border-gray-100 animate-fadeIn">
                        <label className="block text-sm font-medium text-gray-700 mb-2">Nombre Completo *</label>
                        <input
                          type="text"
                          required
                          value={customerData.name}
                          onChange={(e) => setCustomerData({ ...customerData, name: e.target.value })}
                          className={`w-full px-4 py-3 bg-gray-50 border rounded-xl focus:outline-none focus:ring-2 focus:ring-gray-900 transition-all ${errors.name ? 'border-red-300 ring-red-100' : 'border-gray-200'}`}
                          placeholder="Juan Pérez"
                        />
                        {errors.name && <p className="text-red-500 text-sm mt-1">{errors.name}</p>}

                        <div className="mt-3">
                          <label className="block text-sm font-medium text-gray-700 mb-2">Crea un PIN (4-6 dígitos)</label>
                          <input type="password" value={registerPin} onChange={(e) => setRegisterPin(e.target.value)} maxLength={6} className="w-full px-3 py-2 border rounded-xl" />
                          <label className="block text-sm font-medium text-gray-700 mb-2 mt-2">Confirmar PIN</label>
                          <input type="password" value={registerPinConfirm} onChange={(e) => setRegisterPinConfirm(e.target.value)} maxLength={6} className="w-full px-3 py-2 border rounded-xl" />
                          {registerError && <p className="text-red-500 text-sm mt-1">{registerError}</p>}
                          <div className="mt-3">
                            <button onClick={handleCheckoutRegisterOrSetPin} disabled={registerLoading} className="w-full px-4 py-2 bg-red-500 text-white rounded-xl">{registerLoading ? 'Procesando...' : 'Registrarse'}</button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Step 2: Delivery */}
            {/* Step 2: Delivery */}
            <div id="step-2" className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
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
                        alert('Por favor, inicia sesión con tu PIN para continuar con el pedido a domicilio.');
                        return;
                      }
                      setDeliveryData(prev => ({ ...prev, type: 'delivery', tarifa: '0' }));
                      if (!selectedLocation) openLocationModal();
                    }}
                    className={`p-4 rounded-2xl border-2 transition-all flex flex-col items-center gap-3 group relative overflow-hidden ${deliveryData.type === 'delivery'
                      ? 'border-gray-900 bg-gray-900 text-white shadow-lg'
                      : !user
                        ? 'border-gray-100 bg-gray-50 text-gray-400 opacity-60'
                        : 'border-gray-100 bg-gray-50 text-gray-500 hover:border-gray-300 hover:bg-gray-100'
                      }`}
                  >
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center text-xl transition-colors ${deliveryData.type === 'delivery' ? 'bg-white/20 text-white' : 'bg-white text-gray-400'}`}>
                      <i className="bi bi-bicycle"></i>
                    </div>
                    <span className="font-bold">Domicilio</span>
                    {deliveryData.type === 'delivery' && (
                      <div className="absolute top-2 right-2 text-white text-xs">
                        <i className="bi bi-check-circle-fill"></i>
                      </div>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setSelectedLocation(null);
                      setDeliveryData(prev => ({ ...prev, type: 'pickup', address: '', references: '', tarifa: '0' }));
                    }}
                    className={`p-4 rounded-2xl border-2 transition-all flex flex-col items-center gap-3 group relative overflow-hidden ${deliveryData.type === 'pickup'
                      ? 'border-gray-900 bg-gray-900 text-white shadow-lg'
                      : 'border-gray-100 bg-gray-50 text-gray-500 hover:border-gray-300 hover:bg-gray-100'
                      }`}
                  >
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center text-xl transition-colors ${deliveryData.type === 'pickup' ? 'bg-white/20 text-white' : 'bg-white text-gray-400'}`}>
                      <i className="bi bi-shop"></i>
                    </div>
                    <span className="font-bold">Retiro en Tienda</span>
                    {deliveryData.type === 'pickup' && (
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
                        <div className="flex-shrink-0">
                          {selectedLocation.latlong ? (
                            <LocationMap latlong={selectedLocation.latlong} height="80px" />
                          ) : (
                            <div className="w-20 h-20 bg-gray-200 rounded-lg flex items-center justify-center text-gray-400">
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
                    <div className="bg-gray-50 border border-gray-100 rounded-xl p-4 flex items-start gap-3">
                      <div className="w-20 h-20 bg-gray-200 rounded-lg flex items-center justify-center text-gray-400 flex-shrink-0">
                        <i className="bi bi-shop text-2xl"></i>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900">Retirar en:</p>
                        <p className="text-lg font-bold text-gray-800">{business?.name}</p>
                        <p className="text-sm text-gray-600 mt-1">
                          <i className="bi bi-geo-alt mr-1"></i>
                          {business?.address || 'Dirección no disponible'}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Step 3: Timing */}
            <div id="step-3" className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
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
                    {!isStoreOpen(business) && (
                      <span className="text-xs text-gray-500 mt-1">Tienda cerrada</span>
                    )}
                    {timingData.type === 'immediate' && isStoreOpen(business) && (
                      <div className="absolute top-2 right-2 text-white text-xs">
                        <i className="bi bi-check-circle-fill"></i>
                      </div>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setTimingData({ ...timingData, type: 'scheduled' })}
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
                      <label className="block text-sm font-medium text-gray-700 mb-2">Fecha</label>
                      <input
                        type="date"
                        min={new Date().toISOString().split('T')[0]}
                        value={timingData.scheduledDate}
                        onChange={(e) => setTimingData({ ...timingData, scheduledDate: e.target.value })}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-gray-900"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Hora</label>
                      <input
                        type="time"
                        value={timingData.scheduledTime}
                        onChange={(e) => setTimingData({ ...timingData, scheduledTime: e.target.value })}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-gray-900"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Step 4: Payment */}
            <div id="step-4" className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
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
                                      {paymentData.selectedBank === 'produbanco' && '20000175331'}
                                    </p>
                                  </div>
                                </div>
                                <div>
                                  <p className="text-xs text-gray-500 uppercase font-bold tracking-wider mb-1">Cédula / RUC</p>
                                  <p className="font-medium text-gray-900 text-lg">
                                    {paymentData.selectedBank === 'produbanco' ? '0940482169' : '0929057636'}
                                  </p>
                                </div>
                              </div>

                              <div>
                                <p className="text-xs text-gray-500 uppercase font-bold tracking-wider mb-1">Titular de la Cuenta</p>
                                <p className="font-medium text-gray-900 text-lg border-b border-gray-100 pb-1 inline-block">
                                  {paymentData.selectedBank === 'produbanco' ? 'Liliana Ravelo Coloma' : 'Pedro Sánchez León'}
                                </p>
                              </div>
                            </div>

                            <div className="mt-6 p-4 bg-gray-900 text-white rounded-xl shadow-lg flex gap-3 items-start">
                              <i className="bi bi-cash-stack text-xl"></i>
                              <div>
                                <p className="font-bold text-lg mb-1">Total a transferir: ${total.toFixed(2)}</p>
                                <p className="text-sm text-gray-300 leading-snug">
                                  Realiza la transferencia exacta y sube tu comprobante a continuación para confirmar tu pedido.
                                </p>
                              </div>
                            </div>
                          </div>
                        )}
                      </>
                    )}

                    {/* Componente para subir comprobante - SIEMPRE VISIBLE */}
                    {paymentData.selectedBank && clientFound && (
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

          {/* Sidebar - Responsive Order Summary */}
          <div className="lg:space-y-6 space-y-4">
            {/* Order Summary */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sticky top-28">
              <h3 className="text-lg font-bold text-gray-900 mb-6 flex items-center justify-between">
                Resumen del Pedido
                <span className="text-xs font-medium px-2.5 py-1 bg-gray-100 text-gray-600 rounded-full">
                  {cartItems.length} {cartItems.length === 1 ? 'ítem' : 'ítems'}
                </span>
              </h3>

              <div className="space-y-4 mb-6">
                {cartItems.map((item: any, index: number) => (
                  <div
                    key={index}
                    className={`flex gap-3 p-3 rounded-xl transition-all ${item.esPremio
                      ? 'bg-gradient-to-br from-amber-50 to-yellow-50 border border-amber-200 shadow-sm'
                      : 'bg-gray-50 border border-gray-50 hover:border-gray-200'
                      }`}
                  >
                    {/* Item Image Preview if available, else icon */}
                    <div className="w-12 h-12 rounded-lg bg-white border border-gray-200 flex-shrink-0 flex items-center justify-center overflow-hidden shadow-sm">
                      {item.image ? (
                        <img src={item.image} alt={item.productName || item.name} className="w-full h-full object-cover" />
                      ) : (
                        <i className={`bi bi-box2-fill text-xl ${item.esPremio ? 'text-amber-400' : 'text-gray-300'}`}></i>
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start gap-1">
                        <div className="flex-1 min-w-0">
                          {item.variantName ? (
                            <>
                              <p className={`text-sm font-bold truncate ${item.esPremio ? 'text-amber-900' : 'text-gray-900'}`}>
                                {item.variantName}
                              </p>
                              <p className="text-[11px] text-gray-500 uppercase font-bold tracking-wider">{item.productName}</p>
                            </>
                          ) : (
                            <p className={`text-sm font-bold truncate ${item.esPremio ? 'text-amber-900' : 'text-gray-900'}`}>
                              {item.productName || item.name}
                            </p>
                          )}
                        </div>
                        <p className={`text-sm font-bold whitespace-nowrap ${item.esPremio ? 'text-amber-700' : 'text-gray-900'}`}>
                          {item.price > 0 ? `$${(item.price * item.quantity).toFixed(2)}` : '¡Gratis!'}
                        </p>
                      </div>

                      <div className="flex items-center justify-between mt-1">
                        <p className="text-xs text-gray-500 flex items-center gap-1">
                          <span className="font-medium bg-gray-200/50 text-gray-600 px-1.5 py-0.5 rounded text-[10px]">x{item.quantity}</span>
                        </p>
                        {item.esPremio && (
                          <span className="text-[10px] bg-amber-500 text-white px-1.5 py-0.5 rounded font-bold uppercase tracking-tighter">
                            PREMIO
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
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
          </div>
        </div>

        {/* Navigation buttons removed: users change steps using the progress indicators above */}

        {/* Confirmación final (no flotante) */}
        <div className="max-w-4xl mx-auto mt-6 px-4">
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
          clientId={clientFound?.id || ''}
          businessId={business?.id}
          initialAddingState={isAddingNewLocation}
          selectedLocationId={selectedLocation?.id}
        />
      </div>
    </div >
  )
}