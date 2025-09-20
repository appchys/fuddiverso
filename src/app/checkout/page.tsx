'use client'

import { useState, useEffect, Suspense, useRef, useCallback, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { validateEcuadorianPhone, normalizeEcuadorianPhone, validateAndNormalizePhone } from '@/lib/validation'
import { createOrder, getBusiness, searchClientByPhone, createClient, updateClient, setClientPin, FirestoreClient, getClientLocations, ClientLocation, getDeliveryFeeForLocation, createClientLocation } from '@/lib/database'
import { Business } from '@/types'
import { GoogleMap } from '@/components/GoogleMap'
import { useAuth } from '@/contexts/AuthContext'
import { storage } from '@/lib/firebase'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { Timestamp } from 'firebase/firestore'

// Componente para mostrar mapa pequeño de ubicación
function LocationMap({ latlong, height = "96px" }: { latlong: string; height?: string }) {
  // Parsear las coordenadas del formato "-1.874907, -79.979742"
  const parseCoordinates = (coordString: string) => {
    try {
      const [lat, lng] = coordString.split(',').map(coord => parseFloat(coord.trim()));
      if (isNaN(lat) || isNaN(lng)) {
        return null;
      }
      return { lat, lng };
    } catch (error) {
      console.error('Error parsing coordinates:', error);
      return null;
    }
  };

  const coordinates = parseCoordinates(latlong);

  if (!coordinates) {
    return (
      <div className={`w-full bg-gray-100 rounded-lg flex items-center justify-center`} style={{ height }}>
        <span className="text-gray-500 text-xs">📍 Coordenadas inválidas</span>
      </div>
    );
  }

  // Usar Google Static Maps API para evitar cargas múltiples de la API de Maps
  const staticMapUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${coordinates.lat},${coordinates.lng}&zoom=16&size=200x200&maptype=roadmap&markers=color:red%7C${coordinates.lat},${coordinates.lng}&key=AIzaSyAgOiLYPpzxlUHkX3lCmp5KK4UF7wx7zMs`;

  return (
    <div className={`w-full rounded-lg overflow-hidden border border-gray-200 shadow-sm relative`} style={{ height, width: height }}>
      <img 
        src={staticMapUrl}
        alt={`Mapa de ubicación ${coordinates.lat}, ${coordinates.lng}`}
        className="w-full h-full object-cover"
        style={{ height, width: height }}
      />
    </div>
  );
}

// Componente para subir comprobante de transferencia
function TransferReceiptUploader({ 
  onReceiptUpload, 
  uploadedImageUrl, 
  isUploading 
}: { 
  onReceiptUpload: (imageUrl: string) => void;
  uploadedImageUrl: string | null;
  isUploading: boolean;
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

      // Subir a Firebase Storage
      const timestamp = Date.now()
      const fileName = `comprobantes/${timestamp}_${file.name}`
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
      
      {!previewImage ? (
        <div
          className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
            dragActive ? 'border-red-500 bg-red-50' : 'border-gray-300 hover:border-gray-400'
          }`}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
        >
          <p className="text-sm text-gray-600">Arrastra aquí tu comprobante o haz clic para seleccionar un archivo</p>
          <div className="mt-4">
            <button type="button" onClick={() => fileInputRef.current?.click()} className="px-4 py-2 bg-red-500 text-white rounded-lg">Seleccionar Archivo</button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <p className="text-sm text-gray-700">Comprobante cargado</p>
          </div>
          <button type="button" onClick={() => window.open(previewImage, '_blank')} className="text-xs text-blue-600 hover:text-blue-800 flex items-center">
            <i className="bi bi-eye mr-1"></i>
            Ver imagen completa
          </button>
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

  type NewLocationData = {
    latlong: string
    referencia: string
    tarifa: string
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

  const [customerData, setCustomerData] = useState<CustomerData>({ name: '', phone: '' })

  const [clientLocations, setClientLocations] = useState<ClientLocation[]>([])
  const [selectedLocation, setSelectedLocation] = useState<ClientLocation | null>(null)

  const [newLocationData, setNewLocationData] = useState<NewLocationData>({ latlong: '', referencia: '', tarifa: '1' })
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

  // Effect para calcular tarifa automáticamente cuando se ingresan nuevas coordenadas
  useEffect(() => {
    const calculateTariffForNewLocation = async () => {
      if (newLocationData.latlong && business?.id) {
        try {
          const [lat, lng] = newLocationData.latlong.split(',').map(coord => parseFloat(coord.trim()))
          if (!isNaN(lat) && !isNaN(lng)) {
            const calculatedFee = await calculateDeliveryFee({ lat, lng })
            setNewLocationData(prev => ({ ...prev, tarifa: calculatedFee.toFixed(2) }))
          }
        } catch (error) {
          console.error('Error calculating tariff for new location:', error)
        }
      }
    }

    const timeoutId = setTimeout(calculateTariffForNewLocation, 1000) // Debounce por 1 segundo
    return () => clearTimeout(timeoutId)
  }, [newLocationData.latlong, business?.id])

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
        const updated = { ...selectedLocation, tarifa: fee.toString() }
        setSelectedLocation(updated)
        setDeliveryData(prev => ({ ...prev, tarifa: fee.toString() }))
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
    setIsLocationModalOpen(true);
  };

  // Función para cerrar el modal
  const closeLocationModal = () => {
    setIsLocationModalOpen(false);
    setIsAddingNewLocation(false);
    setNewLocationData({ latlong: '', referencia: '', tarifa: '1' });
  }

  // Función para obtener ubicación actual
  const getCurrentLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          setNewLocationData(prev => ({
            ...prev,
            latlong: `${latitude}, ${longitude}`
          }));
        },
        (error) => {
          console.error('Error getting location:', error);
          // Coordenadas por defecto (Guayaquil, Ecuador)
          setNewLocationData(prev => ({
            ...prev,
            latlong: '-2.1894, -79.8890'
          }));
        }
      );
    } else {
      // Coordenadas por defecto si no hay geolocalización
      setNewLocationData(prev => ({
        ...prev,
        latlong: '-2.1894, -79.8890'
      }));
    }
  }

  // Función para manejar cambio de ubicación en el mapa - optimizada para evitar re-renderizados
  const handleLocationChange = useCallback((lat: number, lng: number) => {
    setNewLocationData(prev => ({
      ...prev,
      latlong: `${lat}, ${lng}`
    }));
  }, []);

  // Memorizar las coordenadas del mapa para evitar parpadeo
  const mapCoordinates = useMemo(() => {
    if (!newLocationData.latlong) return null;
    try {
      const [lat, lng] = newLocationData.latlong.split(',').map(coord => parseFloat(coord.trim()));
      if (isNaN(lat) || isNaN(lng)) return null;
      return { lat, lng };
    } catch {
      return null;
    }
  }, [newLocationData.latlong]);

  // Handlers optimizados para evitar re-renderizados
  const handleReferenciaChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setNewLocationData(prev => ({ ...prev, referencia: e.target.value }));
  }, []);

  // Función para guardar nueva ubicación
  const handleSaveNewLocation = async () => {
    if (!clientFound || !newLocationData.latlong || !newLocationData.referencia) {
      alert('Por favor completa todos los campos requeridos');
      return;
    }

    try {
      console.log('💾 Guardando nueva ubicación:', newLocationData);
      
      // Guardar en Firebase usando la nueva función
      const locationId = await createClientLocation({
        id_cliente: clientFound.id,
        latlong: newLocationData.latlong,
        referencia: newLocationData.referencia,
        tarifa: newLocationData.tarifa,
        sector: 'Sin especificar' // Se puede mejorar para obtener automáticamente
      });

      console.log('✅ Ubicación guardada con ID:', locationId);

      // Crear la ubicación con el ID real de Firebase
      const newLocation: ClientLocation = {
        id: locationId,
        id_cliente: clientFound.id,
        latlong: newLocationData.latlong,
        referencia: newLocationData.referencia,
        sector: 'Sin especificar',
        tarifa: newLocationData.tarifa
      };

      // Actualizar el estado local
      setClientLocations(prev => [...prev, newLocation]);
      handleLocationSelect(newLocation);
      closeLocationModal();
      
      // Mostrar mensaje de éxito
      alert('🎉 Ubicación guardada exitosamente');
    } catch (error) {
      console.error('❌ Error saving location:', error);
      alert('Error al guardar la ubicación. Por favor intenta de nuevo.');
    }
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
        // If client has no PIN, force the name input to be empty so user types a new name;
        // if client has PIN, we can prefill the name for greeting purposes.
        setCustomerData(prev => ({
          ...prev,
          name: client.pinHash ? (client.nombres || '') : '',
          phone: normalizedPhone // Actualizar con el número normalizado
        }));
        setShowNameField(!client.pinHash);
        
        // Cargar las ubicaciones del cliente
        setLoadingLocations(true);
        try {
          const locations = await getClientLocations(client.id);
          setClientLocations(locations);
          // Seleccionar automáticamente la primera ubicación si existe
          if (locations.length > 0) {
        // No seleccionar automáticamente la primera ubicación para que el usuario elija explícitamente
        // handleLocationSelect(locations[0]);
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

  // Hash PIN using Web Crypto (shared fallback like Header)
  async function hashPin(pin: string) {
    try {
      if (typeof window !== 'undefined' && window.crypto?.subtle?.digest && typeof window.crypto.subtle.digest === 'function') {
        const encoder = new TextEncoder()
        const data = encoder.encode(pin)
        const hashBuffer = await window.crypto.subtle.digest('SHA-256', data)
        const hashArray = Array.from(new Uint8Array(hashBuffer))
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
      }
    } catch (e) {
      console.warn('Web Crypto not available, using fallback hash:', e)
    }

    let h = 5381
    for (let i = 0; i < pin.length; i++) {
      h = ((h << 5) + h) + pin.charCodeAt(i)
      h = h & 0xffffffff
    }
    const hex = (h >>> 0).toString(16)
    return hex.padStart(64, '0')
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
        }
      } else {
        const newClient = await createClient({ celular: normalizedPhone, nombres: customerData.name, pinHash })
        login(newClient as any)
        setClientFound(newClient as any)
        setShowNameField(false)
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

  // Función unificada para seleccionar una ubicación del cliente
  const handleLocationSelect = async (location: ClientLocation) => {
    // Marcar cálculo antes de setear la selección para evitar render con tarifa vacía
    if (location.latlong) {
      setCalculatingTariff(true)
    }
    setSelectedLocation(location)
    
    // Si la ubicación tiene coordenadas, calcular tarifa automáticamente
    if (location.latlong) {
      try {
        const [lat, lng] = location.latlong.split(',').map(coord => parseFloat(coord.trim()))
        if (!isNaN(lat) && !isNaN(lng)) {
          const calculatedFee = await calculateDeliveryFee({ lat, lng })
          
          // Actualizar la tarifa en la ubicación seleccionada
          const updatedLocation = { ...location, tarifa: calculatedFee.toString() }
          setSelectedLocation(updatedLocation)
          
          // Actualizar datos de entrega
          setDeliveryData(prev => ({
            ...prev,
            address: location.referencia,
            references: `${location.sector} - ${location.latlong}`,
            tarifa: calculatedFee.toString()
          }));
          
          closeLocationModal()
          return
        }
      } catch (error) {
        console.error('Error calculating automatic delivery fee:', error)
      } finally {
        setCalculatingTariff(false)
      }
    }
    
    // Si no se pudo calcular automáticamente, usar tarifa existente
    setDeliveryData(prev => ({
      ...prev,
      address: location.referencia,
      references: `${location.sector} - ${location.latlong}`,
      tarifa: location.tarifa
    }));
    
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
        if (!paymentData.receiptImageUrl && paymentData.paymentStatus !== 'pending') {
          newErrors.receiptImage = 'Sube el comprobante de transferencia o marca como "Por cobrar"'
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
        if (!showNameField || customerData.name.trim()) {
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
    if (paymentData.method === 'transfer') return Boolean(paymentData.selectedBank);
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
      if (!paymentData.selectedBank) return false;
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

      // Calcular tiempo de entrega
      let scheduledTime, scheduledDate;
      
      if (timingData.type === 'immediate') {
        // Para inmediato: fecha y hora actuales + 30 minutos
        const deliveryTime = new Date(Date.now() + 30 * 60 * 1000);
        scheduledDate = Timestamp.fromDate(deliveryTime); // Convertir a Timestamp de Firebase
        scheduledTime = deliveryTime.toTimeString().slice(0, 5); // HH:MM
      } else {
        // Para programado: convertir string a Date y luego a Timestamp
        const programmedDate = new Date(timingData.scheduledDate);
        scheduledDate = Timestamp.fromDate(programmedDate);
        scheduledTime = timingData.scheduledTime;
      }

      // Calcular subtotal (sin envío)
      const subtotal = cartItems.reduce((sum: number, item: any) => sum + (item.price * item.quantity), 0);
      const deliveryCost = selectedLocation?.tarifa ? parseFloat(selectedLocation.tarifa) : 0;

      const orderData = {
        businessId: searchParams.get('businessId') || '',
        items: cartItems.map((item: any) => ({
          productId: item.id.split('-')[0], // Remover sufijo, solo el ID del producto
          name: item.variantName || item.productName || item.name, // Solo el nombre de la variante
          price: item.price,
          quantity: item.quantity,
          variant: item.variantName || item.name // Usar variant si existe, sino el nombre
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
          method: paymentData.method as 'cash' | 'transfer' | 'mixed',
          selectedBank: paymentData.method === 'transfer' ? paymentData.selectedBank : '',
          paymentStatus: paymentData.method === 'transfer' ? paymentData.paymentStatus : 'pending'
        } as any,
        total,
        subtotal,
        status: 'pending' as 'pending' | 'confirmed' | 'preparing' | 'ready' | 'delivered' | 'cancelled',
        createdByAdmin: false, // Indicar que viene del checkout
        createdAt: new Date(),
        updatedAt: new Date()
      }

      // Asegurar método válido antes de crear la orden
      if (!orderData.payment.method) {
        orderData.payment.method = 'cash'
      }

      const orderId = await createOrder(orderData)
      
      // Limpiar carrito específico de este negocio
      const businessId = searchParams.get('businessId')
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
      
      // Redirigir a página de confirmación con el ID real
      router.push(`/order-confirmation?orderId=${orderId}`)
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
                  className={`w-8 h-8 sm:w-10 sm:h-10 min-w-[2rem] min-h-[2rem] sm:min-w-[2.5rem] sm:min-h-[2.5rem] rounded-full flex items-center justify-center transition-all hover:scale-110 ${
                      step1Complete ? 'bg-red-500 text-white' : 'bg-gray-300 text-gray-600 hover:bg-gray-400'
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
                  className={`w-8 h-8 sm:w-10 sm:h-10 min-w-[2rem] min-h-[2rem] sm:min-w-[2.5rem] sm:min-h-[2.5rem] rounded-full flex items-center justify-center transition-all ${
                    step2Complete ? 'bg-red-500 text-white hover:scale-110 cursor-pointer' : 'bg-gray-300 text-gray-600 cursor-not-allowed'
                  }`}
                >
                  {deliveryData.type === 'pickup' ? (
                    /* Store icon when pickup */
                    <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M4 4a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2H4zm3 6V7h6v3H7z" clipRule="evenodd" />
                    </svg>
                  ) : (
                    /* Scooter / moto icon by default */
                    <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M3 10h2l1-2h7l2 4h-3a3 3 0 11-2.83-4H8l-1 2H3v0zM6 15a2 2 0 100-4 2 2 0 000 4zm8 0a2 2 0 100-4 2 2 0 000 4z" />
                    </svg>
                  )}
                </button>
                <span className="text-xs sm:text-sm mt-1 text-center font-medium">
                  {deliveryData.type === 'pickup' ? 'Retiro' : deliveryData.type === 'delivery' ? 'Delivery' : 'Entrega'}
                </span>
              </div>

              <div className="flex-1 h-px bg-gray-300 mx-2"></div>

              {/* Step 3 - Hora (replacing Horario) */}
              <div className="flex flex-col items-center flex-1">
                <button
                  onClick={() => currentStep >= 3 && setCurrentStep(3)}
                  disabled={currentStep < 3}
                  className={`w-8 h-8 sm:w-10 sm:h-10 min-w-[2rem] min-h-[2rem] sm:min-w-[2.5rem] sm:min-h-[2.5rem] rounded-full flex items-center justify-center transition-all ${
                    step3Complete ? 'bg-red-500 text-white hover:scale-110 cursor-pointer' : 'bg-gray-300 text-gray-600 cursor-not-allowed'
                  }`}
                >
                  {/* Clock icon: lightning for immediate, clock for scheduled */}
                  {timingData.type === 'immediate' ? (
                    <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M13 2L3 14h7l-1 6 10-12h-7l1-6z" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.5-11.5V10l3 1.5-.5 1-3.5-1.75V6.5h1z" clipRule="evenodd" />
                    </svg>
                  )}
                </button>
                <span className="text-xs sm:text-sm mt-1 text-center font-medium">
                  {timingData.type === 'immediate' ? 'Inmediato' : timingData.type === 'scheduled' ? 'Programado' : 'Hora'}
                </span>
              </div>

              <div className="flex-1 h-px bg-gray-300 mx-2"></div>

              {/* Step 4 - Pago (renamed) */}
              <div className="flex flex-col items-center flex-1">
                <button
                  onClick={() => currentStep >= 4 && setCurrentStep(4)}
                  disabled={currentStep < 4}
                  className={`w-8 h-8 sm:w-10 sm:h-10 min-w-[2rem] min-h-[2rem] sm:min-w-[2.5rem] sm:min-h-[2.5rem] rounded-full flex items-center justify-center transition-all ${
                    step4Complete ? 'bg-red-500 text-white hover:scale-110 cursor-pointer' : 'bg-gray-300 text-gray-600 cursor-not-allowed'
                  }`}
                >
                  {/* Payment icon: cash, transfer, or mixed */}
                  {paymentData.method === 'transfer' ? (
                    <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M3 10h14v2H3v-2zM5 6h10v2H5V6z" />
                    </svg>
                  ) : paymentData.method === 'cash' ? (
                    <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M2 6h16v8H2zM6 10a2 2 0 104 0 2 2 0 00-4 0z" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M4 4h12v12H4z" />
                    </svg>
                  )}
                </button>
                <span className="text-xs sm:text-sm mt-1 text-center font-medium">
                  {paymentData.method === 'cash' ? 'Efectivo' : paymentData.method === 'transfer' ? 'Transferencia' : paymentData.method === 'mixed' ? 'Mixto' : 'Pago'}
                </span>
              </div>

            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
          {/* Main Content */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-lg shadow-md p-4 sm:p-6">

              {/* Step 1: Customer Data */}
              {currentStep >= 1 && (
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 mb-6">Datos del Cliente</h2>
                  
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Número de Celular *
                      </label>
                      {user ? (
                        <div className="mt-2 p-3 bg-white border border-gray-200 rounded-lg flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium text-gray-900">{user.nombres}</p>
                            <p className="text-sm text-gray-600">{user.celular}</p>
                          </div>
                          <div>
                            <button
                              type="button"
                              onClick={() => {
                                // cerrar sesión global y limpiar estado de checkout relacionado
                                logout()
                                setClientFound(null)
                                setCustomerData({ name: '', phone: '' })
                                setShowNameField(true)
                                setSelectedLocation(null)
                              }}
                              className="text-gray-500 hover:text-gray-700 rounded-full p-2"
                              aria-label="Cerrar sesión"
                            >
                              <i className="bi bi-x-lg"></i>
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
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
                          {errors.phone && <p className="text-red-500 text-sm mt-1">{errors.phone}</p>}
                          {clientSearching && (
                            <p className="text-blue-500 text-sm mt-1">Buscando cliente...</p>
                          )}
                        </>
                      )}
                    </div>

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

                        {!clientSearching && clientFound && clientFound.pinHash && (
                          // Cliente existente con PIN -> mostrar saludo y pedir PIN para iniciar sesión
                          <div className="mt-4">
                            <p className="text-sm text-gray-700 mb-2">Hola <strong>{clientFound.nombres || clientFound.celular}</strong></p>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Ingresa tu PIN</label>
                            <input type="password" value={loginPin} onChange={(e) => setLoginPin(e.target.value)} maxLength={6} className="w-full px-3 py-2 border rounded-md" />
                            {loginPinError && <p className="text-red-500 text-sm mt-1">{loginPinError}</p>}
                            <div className="mt-3">
                              <button onClick={handleCheckoutLoginWithPin} disabled={loginPinLoading} className="w-full px-4 py-2 bg-red-500 text-white rounded-lg">{loginPinLoading ? 'Verificando...' : 'Iniciar sesión'}</button>
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
                                onChange={(e) => setCustomerData({...customerData, name: e.target.value})}
                                className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-red-500 ${errors.name ? 'border-red-500' : 'border-gray-300'}`}
                                placeholder="Juan Pérez"
                              />
                              {errors.name && <p className="text-red-500 text-sm mt-1">{errors.name}</p>}
                            </div>

                            <div className="mt-3">
                              <label className="block text-sm font-medium text-gray-700 mb-2">Crea un PIN (4-6 dígitos)</label>
                              <input type="password" value={registerPin} onChange={(e) => setRegisterPin(e.target.value)} maxLength={6} className="w-full px-3 py-2 border rounded-md" />
                              <label className="block text-sm font-medium text-gray-700 mb-2 mt-2">Confirmar PIN</label>
                              <input type="password" value={registerPinConfirm} onChange={(e) => setRegisterPinConfirm(e.target.value)} maxLength={6} className="w-full px-3 py-2 border rounded-md" />
                              {registerError && <p className="text-red-500 text-sm mt-1">{registerError}</p>}
                              <div className="mt-3">
                                <button onClick={handleCheckoutRegisterOrSetPin} disabled={registerLoading} className="w-full px-4 py-2 bg-red-500 text-white rounded-lg">{registerLoading ? 'Procesando...' : 'Registrarse'}</button>
                              </div>
                            </div>
                          </div>
                        )}

                        {!clientSearching && !clientFound && (
                          // Teléfono no encontrado -> formulario de registro (pedir nombre + crear PIN)
                          <div className="mt-4">
                            <label className="block text-sm font-medium text-gray-700 mb-2">Nombre Completo *</label>
                            <input
                              type="text"
                              required
                              value={customerData.name}
                              onChange={(e) => setCustomerData({...customerData, name: e.target.value})}
                              className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-red-500 ${errors.name ? 'border-red-500' : 'border-gray-300'}`}
                              placeholder="Juan Pérez"
                            />
                            {errors.name && <p className="text-red-500 text-sm mt-1">{errors.name}</p>}

                            <div className="mt-3">
                              <label className="block text-sm font-medium text-gray-700 mb-2">Crea un PIN (4-6 dígitos)</label>
                              <input type="password" value={registerPin} onChange={(e) => setRegisterPin(e.target.value)} maxLength={6} className="w-full px-3 py-2 border rounded-md" />
                              <label className="block text-sm font-medium text-gray-700 mb-2 mt-2">Confirmar PIN</label>
                              <input type="password" value={registerPinConfirm} onChange={(e) => setRegisterPinConfirm(e.target.value)} maxLength={6} className="w-full px-3 py-2 border rounded-md" />
                              {registerError && <p className="text-red-500 text-sm mt-1">{registerError}</p>}
                              <div className="mt-3">
                                <button onClick={handleCheckoutRegisterOrSetPin} disabled={registerLoading} className="w-full px-4 py-2 bg-red-500 text-white rounded-lg">{registerLoading ? 'Procesando...' : 'Registrarse'}</button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Step 2: Delivery */}
              {currentStep >= 2 && (
                <div>
                  {/* Mostrar selección solo si hay sesión iniciada */}
                  {user && (
                    <>
                      <h2 className="text-2xl font-bold text-gray-900 mb-6">¿Cómo deseas recibir tu pedido?</h2>
                      <div className="space-y-4 mb-6">
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => setDeliveryData(prev => ({ ...prev, type: 'pickup' }))}
                            className={`p-3 rounded-lg border-2 transition-all flex flex-col items-center space-y-1 ${
                              deliveryData.type === 'pickup'
                                ? 'border-blue-500 bg-blue-50 text-blue-700'
                                : 'border-gray-300 hover:border-gray-400'
                            }`}
                          >
                            <i className="bi bi-shop text-lg"></i>
                            <span className="text-xs font-medium">Recoger en tienda</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => setDeliveryData(prev => ({ ...prev, type: 'delivery' }))}
                            className={`p-3 rounded-lg border-2 transition-all flex flex-col items-center space-y-1 ${
                              deliveryData.type === 'delivery'
                                ? 'border-blue-500 bg-blue-50 text-blue-700'
                                : 'border-gray-300 hover:border-gray-400'
                            }`}
                          >
                            <i className="bi bi-scooter text-lg"></i>
                            <span className="text-xs font-medium">Delivery</span>
                          </button>
                        </div>
                      </div>

                      {errors.deliveryType && (
                        <p className="text-red-500 text-sm mb-4">{errors.deliveryType}</p>
                      )}

                      {deliveryData.type === 'delivery' && (
                        <div className="space-y-4">
                          {/* Mostrar ubicación seleccionada y botón para abrir modal */}
                          {clientFound && clientLocations.length > 0 ? (
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">Ubicación Seleccionada</label>
                              {loadingLocations ? (
                                <div className="text-sm text-gray-500">Cargando ubicaciones...</div>
                              ) : (
                                <div className="mb-4">
                                  {selectedLocation ? (
                                    <div className="border border-gray-300 rounded-lg bg-gray-50 p-3">
                                      <div className="flex gap-3 items-center">
                                        <div className="flex-shrink-0 w-20">
                                          <LocationMap latlong={selectedLocation.latlong} height="80px" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                                <div className="font-medium text-sm mb-1">{selectedLocation.referencia}</div>
                                                <div className="text-xs text-gray-500">Tarifa: ${selectedLocation.tarifa}</div>
                                                {selectedLocationOutsideCoverage && (
                                                  <div className="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-800">
                                                    <i className="bi bi-exclamation-triangle mr-2"></i>
                                                    Esta ubicación está fuera de las zonas de cobertura y no será posible realizar delivery a esta dirección.
                                                  </div>
                                                )}
                                        </div>
                                        <button type="button" onClick={openLocationModal} className="px-3 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 flex items-center flex-shrink-0">
                                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                          </svg>
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="flex items-center space-x-2">
                                      <div className="flex-1 p-3 border border-gray-300 rounded-lg bg-gray-50">
                                        <div className="font-medium text-sm mb-1">Ninguna ubicación seleccionada</div>
                                      </div>
                                      <button type="button" onClick={openLocationModal} className="px-3 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 flex items-center">
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                        </svg>
                                      </button>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          ) : (
                            // Usuario loggeado pero sin ubicaciones: mostrar CTA para agregar nueva ubicación
                            <div className="p-3 border border-dashed rounded-lg bg-gray-50">
                              <p className="text-sm text-gray-700 mb-3">No tienes ubicaciones guardadas.</p>
                              <button type="button" onClick={() => { setIsAddingNewLocation(true); getCurrentLocation(); openLocationModal(); }} className="px-4 py-2 bg-red-500 text-white rounded-lg">Agregar nueva ubicación</button>
                            </div>
                          )}

                          {/* Removed manual address form - not needed */}
                        </div>
                      )}

                      {deliveryData.type === 'pickup' && (
                        <div className="bg-gray-50 p-4 rounded-lg">
                          <h3 className="font-medium mb-2">Información del Negocio</h3>
                          <p className="text-sm text-gray-600 mb-2"><strong>Dirección:</strong> {business?.address}</p>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Step 3: Timing */}
              {currentStep >= 3 && (
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 mb-6">¿Cuándo deseas recibir tu pedido?</h2>

                  <div className="space-y-4 mb-6">
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setTimingData(prev => ({ ...prev, type: 'immediate' }))
                          // avanzar fluidamente al paso de pago
                          setCurrentStep(4)
                        }}
                        className={`p-3 rounded-lg border-2 transition-all flex flex-col items-center space-y-1 ${
                          timingData.type === 'immediate'
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
                          const now = new Date();
                          const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);
                          setTimingData(prev => ({
                            ...prev,
                            type: 'scheduled',
                            scheduledDate: now.toISOString().split('T')[0],
                            scheduledTime: oneHourLater.toTimeString().split(' ')[0].substring(0, 5)
                          }))
                          // avanzar al paso de pago para que la sección aparezca sin más acciones
                          setCurrentStep(4)
                        }}
                        className={`p-3 rounded-lg border-2 transition-all flex flex-col items-center space-y-1 ${
                          timingData.type === 'scheduled'
                            ? 'border-orange-500 bg-orange-50 text-orange-700'
                            : 'border-gray-300 hover:border-gray-400'
                        }`}
                      >
                        <i className="bi bi-calendar2-event text-lg"></i>
                        <span className="text-xs font-medium">Programado</span>
                      </button>
                    </div>
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
              {currentStep >= 4 && (
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 mb-6">Método de Pago</h2>

                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setPaymentData(prev => ({ ...prev, method: 'cash', cashAmount: 0, transferAmount: 0 }))}
                        className={`p-3 rounded-lg border-2 transition-all flex flex-col items-center space-y-1 ${
                          paymentData.method === 'cash'
                            ? 'border-green-500 bg-green-50 text-green-700'
                            : 'border-gray-300 hover:border-gray-400'
                        }`}
                      >
                        <i className="bi bi-cash text-lg"></i>
                        <span className="text-xs font-medium">Efectivo</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setPaymentData(prev => ({ ...prev, method: 'transfer', cashAmount: 0, transferAmount: 0 }))}
                        className={`p-3 rounded-lg border-2 transition-all flex flex-col items-center space-y-1 ${
                          paymentData.method === 'transfer'
                            ? 'border-blue-500 bg-blue-50 text-blue-700'
                            : 'border-gray-300 hover:border-gray-400'
                        }`}
                      >
                        <i className="bi bi-bank text-lg"></i>
                        <span className="text-xs font-medium">Transferencia</span>
                      </button>

                      {/* Mixto oculto por ahora - no renderizamos la opción */}
                    </div>

                    {/* Configuración de Pago Mixto */}
                    {/* Mixto deshabilitado - fin */}
                  </div>

                  {errors.paymentMethod && (
                    <p className="text-red-500 text-sm mt-2 flex items-center">
                      <i className="bi bi-exclamation-triangle mr-1"></i>
                      {errors.paymentMethod}
                    </p>
                  )}

                  {paymentData.method === 'transfer' && (
                    <div className="mt-6 bg-gray-50 p-4 rounded-lg">
                      <h3 className="font-medium mb-4">💳 Datos para realizar la transferencia</h3>
                      
                      {/* Selector de banco */}
                      <div className="mb-4">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Selecciona el banco:
                        </label>
                        <select
                          value={paymentData.selectedBank}
                          onChange={(e) => setPaymentData({...paymentData, selectedBank: e.target.value})}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                        >
                          <option value="">Selecciona un banco</option>
                          <option value="pichincha">🟡 Banco Pichincha</option>
                          <option value="pacifico">🔵 Banco Pacifico</option>
                          <option value="guayaquil">🩷 Banco Guayaquil</option>
                          <option value="produbanco">🟢 Banco Produbanco</option>
                        </select>
                        {errors.selectedBank && (
                          <p className="text-red-500 text-xs mt-1 flex items-center">
                            <i className="bi bi-exclamation-triangle mr-1"></i>
                            {errors.selectedBank}
                          </p>
                        )}
                      </div>

                      {/* Mostrar datos bancarios según selección */}
                      {paymentData.selectedBank && (
                        <div className="bg-white p-4 rounded-lg border">
                          <h4 className="font-semibold mb-3">Datos de la cuenta:</h4>
                          
                          {paymentData.selectedBank === 'pichincha' && (
                            <div className="text-sm space-y-2">
                              <p><strong>🟡 Banco Pichincha</strong></p>
                              <p><strong>Cuenta de ahorros:</strong> 2203257517</p>
                              <p><strong>A nombre de:</strong> Pedro Sánchez León</p>
                              <p><strong>Cédula:</strong> 0929057636</p>
                            </div>
                          )}
                          
                          {paymentData.selectedBank === 'pacifico' && (
                            <div className="text-sm space-y-2">
                              <p><strong>🔵 Banco Pacifico</strong></p>
                              <p><strong>Cuenta de ahorros:</strong> 1063889358</p>
                              <p><strong>A nombre de:</strong> Pedro Sánchez León</p>
                              <p><strong>Cédula:</strong> 0929057636</p>
                            </div>
                          )}
                          
                          {paymentData.selectedBank === 'guayaquil' && (
                            <div className="text-sm space-y-2">
                              <p><strong>🩷 Banco Guayaquil</strong></p>
                              <p><strong>Cuenta de ahorros:</strong> 0030697477</p>
                              <p><strong>A nombre de:</strong> Pedro Sánchez León</p>
                              <p><strong>Cédula:</strong> 0929057636</p>
                            </div>
                          )}
                          
                          {paymentData.selectedBank === 'produbanco' && (
                            <div className="text-sm space-y-2">
                              <p><strong>🟢 Banco Produbanco</strong></p>
                              <p><strong>Cuenta de ahorros:</strong> 20000175331</p>
                              <p><strong>A nombre de:</strong> Liliana Ravelo Coloma</p>
                              <p><strong>Cédula:</strong> 0940482169</p>
                            </div>
                          )}
                          
                          <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded">
                            <p className="text-sm text-yellow-800">
                              <strong>Importante:</strong> Realiza la transferencia por el monto exacto de ${total.toFixed(2)} y sube el comprobante aquí.
                            </p>
                          </div>
                        </div>
                      )}

                      {/* Componente para subir comprobante */}
                      {paymentData.selectedBank && (
                        <TransferReceiptUploader
                          onReceiptUpload={handleReceiptUpload}
                          uploadedImageUrl={paymentData.receiptImageUrl || null}
                          isUploading={uploadingReceipt}
                        />
                      )}

                      {/* Error del comprobante */}
                      {errors.receiptImage && (
                        <p className="text-red-500 text-xs mt-2 flex items-center">
                          <i className="bi bi-exclamation-triangle mr-1"></i>
                          {errors.receiptImage}
                        </p>
                      )}

                      {/* Estado del pago - Solo mostrar, no editable para el cliente */}
                      {paymentData.method === 'transfer' && (
                        <div className="mt-4">
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Estado del Pago
                          </label>
                          <div className="bg-gray-50 p-3 rounded-lg border">
                            <div className="flex items-center">
                              {paymentData.paymentStatus === 'pending' && (
                                <span className="text-sm text-red-600">
                                  <i className="bi bi-clock mr-1"></i>
                                  Por cobrar
                                </span>
                              )}
                              {paymentData.paymentStatus === 'validating' && (
                                <span className="text-sm text-yellow-600">
                                  <i className="bi bi-search mr-1"></i>
                                  Validando pago
                                </span>
                              )}
                              {paymentData.paymentStatus === 'paid' && (
                                <span className="text-sm text-green-600">
                                  <i className="bi bi-check-circle mr-1"></i>
                                  Pagado
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Step 5 removed - Confirmar step was removed per request */}
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
                      {item.variantName ? (
                        <>
                          <p className="text-sm font-medium truncate">{item.variantName}</p>
                          <p className="text-xs text-gray-500">{item.productName}</p>
                        </>
                      ) : (
                        <p className="text-sm font-medium truncate">{item.productName || item.name}</p>
                      )}
                      <p className="text-xs text-gray-500">Cantidad: {item.quantity}</p>
                    </div>
                    <p className="text-sm font-medium shrink-0">${(item.price * item.quantity).toFixed(2)}</p>
                  </div>
                ))}
              </div>

              <div className="border-t pt-3 mt-3 space-y-2">
                {/* Subtotal */}
                <div className="flex justify-between items-center">
                  <p className="text-sm text-gray-600">Subtotal</p>
                  <p className="text-sm text-gray-600">${subtotal.toFixed(2)}</p>
                </div>
                
                {/* Tarifa de envío - siempre mostrar */}
                <div className="flex justify-between items-center">
                  <p className="text-sm text-gray-600">Envío</p>
                  <p className="text-sm text-gray-600">${deliveryCost.toFixed(2)}</p>
                </div>
                
                {/* Total final */}
                <div className="flex justify-between items-center pt-2 border-t">
                  <p className="text-base sm:text-lg font-bold">Total</p>
                  <p className="text-base sm:text-lg font-bold text-red-500">${total.toFixed(2)}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Navigation buttons removed: users change steps using the progress indicators above */}

        {/* Confirmación final (no flotante) */}
        <div className="max-w-4xl mx-auto mt-6 px-4">
          <div className="bg-white rounded-lg shadow-md p-4 flex flex-col sm:flex-row items-center justify-between">
            <div className="mb-3 sm:mb-0">
              <p className="text-sm text-gray-600">Total</p>
              <p className="text-lg font-semibold text-red-600">${total.toFixed(2)}</p>
            </div>
            <div className="w-full sm:w-auto">
              <div className="w-full sm:w-auto">
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!readyToConfirm || loading || (deliveryData.type === 'delivery' && selectedLocationOutsideCoverage)}
                  className={`w-full sm:w-auto px-6 py-3 rounded-lg text-white font-medium ${
                    !readyToConfirm || loading || (deliveryData.type === 'delivery' && selectedLocationOutsideCoverage)
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
        </div>

        {/* Modal para mostrar ubicaciones registradas - Mobile Optimized */}
        {isLocationModalOpen && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center z-50 p-4">
            <div className="bg-white rounded-t-lg sm:rounded-lg shadow-lg w-full max-w-md mx-auto p-4 sm:p-6 max-h-[90vh] sm:max-h-[80vh] flex flex-col">
              <div className="flex justify-between items-center mb-4 pb-3 border-b sm:border-b-0 sm:pb-0">
                <h2 className="text-lg font-bold">
                  {isAddingNewLocation ? 'Agregar Nueva Ubicación' : 'Selecciona una ubicación'}
                </h2>
                <button
                  onClick={closeLocationModal}
                  className="text-gray-400 hover:text-gray-600 p-1"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {!isAddingNewLocation ? (
                <>
                  <div className="space-y-4 overflow-y-auto flex-1 -mx-2 px-2">
                    {clientLocations.map((location) => (
                      <div
                        key={location.id}
                        className={`border rounded-lg cursor-pointer transition-all duration-200 hover:shadow-md ${
                          selectedLocation?.id === location.id
                            ? 'border-red-500 bg-red-50 shadow-md'
                            : 'border-gray-300 hover:bg-gray-50 active:bg-gray-100'
                        }`}
                        onClick={() => {
                          handleLocationSelect(location);
                          closeLocationModal();
                        }}
                      >
                        {/* Layout horizontal: Mapa a la izquierda, información a la derecha */}
                        <div className="flex gap-3 p-3">
                          {/* Mapa de la ubicación - Cuadrado a la izquierda */}
                          <div className="flex-shrink-0">
                            <LocationMap latlong={location.latlong} height="80px" />
                          </div>
                          
                          {/* Información de la ubicación - A la derecha */}
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm mb-1 text-gray-900">
                              {location.referencia}
                            </div>
                            <div className="text-xs text-gray-500 mb-2 flex items-center gap-2">
                              <span>💰 Tarifa: ${location.tarifa}</span>
                              {(location.tarifa == null || Number(location.tarifa) <= 0) && (
                                <span className="text-xs text-yellow-800 bg-yellow-100 px-2 py-1 rounded-full">Fuera de cobertura</span>
                              )}
                            </div>
                            {selectedLocation?.id === location.id && (
                              <div className="text-xs text-red-600 font-medium bg-red-100 px-2 py-1 rounded-full inline-block">
                                ✓ Seleccionada
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 pt-3 border-t sm:border-t-0 sm:pt-4 space-y-2">
                    <button
                      className="w-full bg-red-500 text-white py-3 rounded-lg hover:bg-red-600 transition-colors touch-manipulation"
                      onClick={() => {
                        setIsAddingNewLocation(true);
                        getCurrentLocation();
                      }}
                    >
                      + Agregar Nueva Ubicación
                    </button>
                    <button
                      className="w-full bg-gray-200 text-gray-700 py-3 rounded-lg hover:bg-gray-300 active:bg-gray-400 transition-colors touch-manipulation"
                      onClick={closeLocationModal}
                    >
                      Cancelar
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {/* Formulario para agregar nueva ubicación */}
                  <div className="space-y-4 overflow-y-auto flex-1">
                    {/* Mapa interactivo */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Ubicación en el mapa (mueve el pin para ajustar)
                      </label>
                      {mapCoordinates && (
                        <div className="border rounded-lg overflow-hidden">
                          <GoogleMap
                            latitude={mapCoordinates.lat}
                            longitude={mapCoordinates.lng}
                            height="200px"
                            width="100%"
                            zoom={16}
                            marker={true}
                            draggable={true}
                            onLocationChange={handleLocationChange}
                          />
                        </div>
                      )}
                    </div>

                    {/* Campo de referencias */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Referencias de la ubicación *
                      </label>
                      <textarea
                        value={newLocationData.referencia}
                        onChange={handleReferenciaChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                        placeholder="Ej: Casa blanca, portón negro, diagonal al supermercado..."
                        rows={3}
                        required
                      />
                    </div>

                    {/* Campo de tarifa */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Tarifa de envío
                        {newLocationData.latlong && (
                          <span className="text-xs text-green-600 ml-2">
                            (Calculada automáticamente)
                          </span>
                        )}
                      </label>
                      <div className="relative">
                        <input
                          type="text"
                          value={`$${newLocationData.tarifa}`}
                          readOnly
                          disabled
                          className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-gray-600 cursor-not-allowed"
                          placeholder="$0.00"
                        />
                      </div>
                      {newLocationData.latlong && (
                        <p className="text-xs text-gray-500 mt-1">
                          💡 La tarifa se calcula automáticamente según las zonas de cobertura configuradas
                        </p>
                      )}
                      {/* Aviso fuera de cobertura para nueva ubicación */}
                      {(newLocationData.tarifa == null || Number(newLocationData.tarifa) <= 0) && newLocationData.latlong && (
                        <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-800">
                          <i className="bi bi-exclamation-triangle mr-2"></i>
                          Esta ubicación está fuera de las zonas de cobertura. Podrás guardarla, pero no estará disponible para delivery.
                        </div>
                      )}
                    </div>

                    {/* Campo de coordenadas eliminado para simplificar la interfaz */}
                  </div>

                  <div className="mt-4 pt-3 border-t sm:border-t-0 sm:pt-4 space-y-2">
                    <button
                      className="w-full bg-red-500 text-white py-3 rounded-lg hover:bg-red-600 transition-colors touch-manipulation"
                      onClick={handleSaveNewLocation}
                    >
                      Guardar Ubicación
                    </button>
                    <button
                      className="w-full bg-gray-200 text-gray-700 py-3 rounded-lg hover:bg-gray-300 active:bg-gray-400 transition-colors touch-manipulation"
                      onClick={() => setIsAddingNewLocation(false)}
                    >
                      Volver
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
