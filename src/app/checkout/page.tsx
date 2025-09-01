'use client'

import { useState, useEffect, Suspense, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { validateEcuadorianPhone, normalizeEcuadorianPhone, validateAndNormalizePhone } from '@/lib/validation'
import { createOrder, getBusiness, searchClientByPhone, createClient, FirestoreClient, getClientLocations, ClientLocation } from '@/lib/database'
import { Business } from '@/types'
import { GoogleMap } from '@/components/GoogleMap'
import { useAuth } from '@/contexts/AuthContext'
import { storage } from '@/lib/firebase'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'

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
            dragActive 
              ? 'border-red-500 bg-red-50' 
              : 'border-gray-300 hover:border-gray-400'
          }`}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
        >
          <div className="space-y-2">
            <i className="bi bi-cloud-upload text-3xl text-gray-400"></i>
            <div>
              <p className="text-sm text-gray-600">
                Arrastra tu comprobante aquí o{' '}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-red-500 hover:text-red-600 font-medium"
                  disabled={isUploading}
                >
                  selecciona un archivo
                </button>
              </p>
              <p className="text-xs text-gray-500 mt-1">
                JPG, PNG o WEBP hasta 5MB
              </p>
            </div>
          </div>
          
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/jpg,image/png,image/webp"
            onChange={handleFileSelect}
            className="hidden"
            disabled={isUploading}
          />
        </div>
      ) : (
        <div className="relative">
          <div className="border rounded-lg p-4 bg-gray-50">
            <div className="flex items-start space-x-4">
              <div className="flex-shrink-0">
                <img
                  src={previewImage}
                  alt="Comprobante de transferencia"
                  className="w-20 h-20 object-cover rounded-lg border"
                />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900">
                  Comprobante subido correctamente
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  La imagen se ha guardado y está lista para enviar
                </p>
                <button
                  type="button"
                  onClick={removeImage}
                  className="text-red-500 hover:text-red-600 text-xs font-medium mt-2"
                  disabled={isUploading}
                >
                  <i className="bi bi-trash mr-1"></i>
                  Eliminar y subir otra
                </button>
              </div>
            </div>
          </div>
          
          {/* Preview expandido */}
          <div className="mt-3">
            <button
              type="button"
              onClick={() => window.open(previewImage, '_blank')}
              className="text-xs text-blue-600 hover:text-blue-800 flex items-center"
            >
              <i className="bi bi-eye mr-1"></i>
              Ver imagen completa
            </button>
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
  const { user, login, isAuthenticated } = useAuth();

  // client-only guard state
  const [isClient, setIsClient] = useState(false);

  // Page state hooks
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [business, setBusiness] = useState<Business | null>(null);

  const [customerData, setCustomerData] = useState({
    name: user?.nombres || '',
    phone: user?.celular || ''
  });
  const [clientSearching, setClientSearching] = useState(false);
  const [clientFound, setClientFound] = useState<FirestoreClient | null>(user || null);
  const [showNameField, setShowNameField] = useState(!user);
  const [clientLocations, setClientLocations] = useState<ClientLocation[]>([]);
  const [loadingLocations, setLoadingLocations] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<ClientLocation | null>(null);
  const [deliveryData, setDeliveryData] = useState({
    type: '' as '' | 'delivery' | 'pickup',
    address: '',
    references: ''
  });
  const [timingData, setTimingData] = useState({
    type: 'immediate' as 'immediate' | 'scheduled',
    scheduledDate: '',
    scheduledTime: ''
  });
  const [paymentData, setPaymentData] = useState({
    method: 'cash' as 'cash' | 'transfer',
    selectedBank: '' as string,
    receiptImageUrl: '' as string,
    paymentStatus: 'pending' as 'pending' | 'validating' | 'paid'
  });
  const [uploadingReceipt, setUploadingReceipt] = useState(false);

  const [errors, setErrors] = useState<Record<string, string>>({});

  // Estado para manejar el modal
  const [isLocationModalOpen, setIsLocationModalOpen] = useState(false)
  const [isAddingNewLocation, setIsAddingNewLocation] = useState(false)
  const [newLocationData, setNewLocationData] = useState({
    latlong: '',
    referencia: '',
    tarifa: '1'
  })

  // Effects (also must be declared consistently)
  useEffect(() => { setIsClient(true); }, []);

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

  // Función para manejar cambio de ubicación en el mapa
  const handleLocationChange = (lat: number, lng: number) => {
    setNewLocationData(prev => ({
      ...prev,
      latlong: `${lat}, ${lng}`
    }));
  }

  // Función para guardar nueva ubicación
  const handleSaveNewLocation = async () => {
    if (!clientFound || !newLocationData.latlong || !newLocationData.referencia) {
      alert('Por favor completa todos los campos requeridos');
      return;
    }

    try {
      // Aquí iría la lógica para guardar la ubicación en Firebase
      // Por ahora simulamos la creación
      const newLocation: ClientLocation = {
        id: `temp-${Date.now()}`,
        id_cliente: clientFound.id,
        latlong: newLocationData.latlong,
        referencia: newLocationData.referencia,
        sector: 'Nuevo', // Se podría obtener automáticamente
        tarifa: newLocationData.tarifa
      };

      setClientLocations(prev => [...prev, newLocation]);
      handleSelectLocation(newLocation);
      closeLocationModal();
    } catch (error) {
      console.error('Error saving location:', error);
      alert('Error al guardar la ubicación');
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
        // Auto-login del cliente
        login(client);
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
      references: `${location.sector} - ${location.latlong}`
    }));
  }

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
            handleSelectLocation(locations[0]);
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
      // Validación final antes de crear la orden
      if (!deliveryData.type) {
        alert('Por favor selecciona un tipo de entrega')
        setLoading(false)
        return
      }

      if (deliveryData.type !== 'delivery' && deliveryData.type !== 'pickup') {
        alert('Tipo de entrega inválido')
        setLoading(false)
        return
      }

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
          type: deliveryData.type as 'delivery' | 'pickup',
          references: deliveryData.type === 'delivery' ? deliveryData.address : undefined
        },
        timing: {
          type: timingData.type,
          scheduledTime: deliveryTime
        },
        payment: {
          method: paymentData.method,
          selectedBank: paymentData.method === 'transfer' ? paymentData.selectedBank : undefined,
          receiptImageUrl: paymentData.method === 'transfer' ? paymentData.receiptImageUrl : undefined,
          paymentStatus: paymentData.method === 'transfer' ? paymentData.paymentStatus : 'paid'
        },
        total,
        status: 'pending' as 'pending',
        updatedAt: new Date()
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
                  className={`w-8 h-8 sm:w-10 sm:h-10 min-w-[2rem] min-h-[2rem] sm:min-w-[2.5rem] sm:min-h-[2.5rem] rounded-full flex items-center justify-center transition-all hover:scale-110 ${
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
                  className={`w-8 h-8 sm:w-10 sm:h-10 min-w-[2rem] min-h-[2rem] sm:min-w-[2.5rem] sm:min-h-[2.5rem] rounded-full flex items-center justify-center transition-all ${
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
                  {deliveryData.type === 'pickup' ? 'Retiro' : deliveryData.type === 'delivery' ? 'Delivery' : 'Entrega'}
                </span>
              </div>

              <div className="flex-1 h-px bg-gray-300 mx-2"></div>

              {/* Step 3 - Horario */}
              <div className="flex flex-col items-center flex-1">
                <button
                  onClick={() => currentStep >= 3 && setCurrentStep(3)}
                  disabled={currentStep < 3}
                  className={`w-8 h-8 sm:w-10 sm:h-10 min-w-[2rem] min-h-[2rem] sm:min-w-[2.5rem] sm:min-h-[2.5rem] rounded-full flex items-center justify-center transition-all ${
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
                  className={`w-8 h-8 sm:w-10 sm:h-10 min-w-[2rem] min-h-[2rem] sm:min-w-[2.5rem] sm:min-h-[2.5rem] rounded-full flex items-center justify-center transition-all ${
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
                  className={`w-8 h-8 sm:w-10 sm:h-10 min-w-[2rem] min-h-[2rem] sm:min-w-[2.5rem] sm:min-h-[2.5rem] rounded-full flex items-center justify-center transition-all ${
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

                  {errors.deliveryType && (
                    <p className="text-red-500 text-sm mb-4">{errors.deliveryType}</p>
                  )}

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
                              {selectedLocation ? (
                                <div className="border border-gray-300 rounded-lg bg-gray-50 p-3">
                                  {/* Layout horizontal: Mapa a la izquierda, información a la derecha */}
                                  <div className="flex gap-3 items-center">
                                    {/* Mapa de la ubicación - Cuadrado a la izquierda */}
                                    <div className="flex-shrink-0 w-20">
                                      <LocationMap latlong={selectedLocation.latlong} height="80px" />
                                    </div>
                                    
                                    {/* Información de la ubicación - A la derecha */}
                                    <div className="flex-1 min-w-0">
                                      <div className="font-medium text-sm mb-1">
                                        {selectedLocation.referencia}
                                      </div>
                                      <div className="text-xs text-gray-500">
                                        � Tarifa: ${selectedLocation.tarifa}
                                      </div>
                                    </div>
                                    
                                    {/* Botón para cambiar ubicación */}
                                    <button
                                      type="button"
                                      onClick={openLocationModal}
                                      className="px-3 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 flex items-center flex-shrink-0"
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
                              ) : (
                                <div className="flex items-center space-x-2">
                                  <div className="flex-1 p-3 border border-gray-300 rounded-lg bg-gray-50">
                                    <div className="font-medium text-sm mb-1">
                                      Ninguna ubicación seleccionada
                                    </div>
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
                              )}
                            </div>
                          )}
                        </div>
                      )}
                      
                      {/* Solo mostrar el formulario manual si no hay ubicación seleccionada */}
                      {!selectedLocation && (
                        <div className="space-y-4">
                          <div className="text-sm text-gray-600 mb-3">
                            O ingresa una nueva dirección:
                          </div>
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
                        onChange={(e) => {
                          const now = new Date();
                          const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000); // Añadir 1 hora
                          
                          setTimingData({
                            ...timingData, 
                            type: e.target.value as 'scheduled',
                            scheduledDate: now.toISOString().split('T')[0], // Fecha actual
                            scheduledTime: oneHourLater.toTimeString().split(' ')[0].substring(0, 5) // Hora actual + 1 hora (formato HH:MM)
                          });
                        }}
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

                      {/* Estado del pago */}
                      {paymentData.method === 'transfer' && (
                        <div className="mt-4">
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Estado del Pago
                          </label>
                          <div className="flex items-center space-x-4">
                            <label className="flex items-center">
                              <input
                                type="radio"
                                name="paymentStatus"
                                value="pending"
                                checked={paymentData.paymentStatus === 'pending'}
                                onChange={(e) => setPaymentData(prev => ({
                                  ...prev,
                                  paymentStatus: e.target.value as 'pending' | 'validating' | 'paid'
                                }))}
                                className="mr-2"
                              />
                              <span className="text-sm text-red-600">
                                <i className="bi bi-clock mr-1"></i>
                                Por cobrar
                              </span>
                            </label>
                            <label className="flex items-center">
                              <input
                                type="radio"
                                name="paymentStatus"
                                value="validating"
                                checked={paymentData.paymentStatus === 'validating'}
                                onChange={(e) => setPaymentData(prev => ({
                                  ...prev,
                                  paymentStatus: e.target.value as 'pending' | 'validating' | 'paid'
                                }))}
                                className="mr-2"
                              />
                              <span className="text-sm text-yellow-600">
                                <i className="bi bi-search mr-1"></i>
                                Validando pago
                              </span>
                            </label>
                            <label className="flex items-center">
                              <input
                                type="radio"
                                name="paymentStatus"
                                value="paid"
                                checked={paymentData.paymentStatus === 'paid'}
                                onChange={(e) => setPaymentData(prev => ({
                                  ...prev,
                                  paymentStatus: e.target.value as 'pending' | 'validating' | 'paid'
                                }))}
                                className="mr-2"
                              />
                              <span className="text-sm text-green-600">
                                <i className="bi bi-check-circle mr-1"></i>
                                Pagado
                              </span>
                            </label>
                          </div>
                        </div>
                      )}
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
                        <p className="text-sm"><strong>Tipo:</strong> {
                          deliveryData.type === 'delivery' ? 'Delivery' : 
                          deliveryData.type === 'pickup' ? 'Retiro en tienda' :
                          'No seleccionado'
                        }</p>
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
                          handleSelectLocation(location);
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
                            <div className="text-xs text-gray-500 mb-2">
                              💰 Tarifa: ${location.tarifa}
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
                      {newLocationData.latlong && (
                        <div className="border rounded-lg overflow-hidden">
                          <GoogleMap
                            latitude={parseFloat(newLocationData.latlong.split(',')[0])}
                            longitude={parseFloat(newLocationData.latlong.split(',')[1])}
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
                        onChange={(e) => setNewLocationData(prev => ({ ...prev, referencia: e.target.value }))}
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
                      </label>
                      <select
                        value={newLocationData.tarifa}
                        onChange={(e) => setNewLocationData(prev => ({ ...prev, tarifa: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
                      >
                        <option value="1">$1.00</option>
                        <option value="1.5">$1.50</option>
                        <option value="2">$2.00</option>
                        <option value="2.5">$2.50</option>
                        <option value="3">$3.00</option>
                      </select>
                    </div>

                    {/* Coordenadas (solo lectura) */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Coordenadas
                      </label>
                      <input
                        type="text"
                        value={newLocationData.latlong}
                        readOnly
                        className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-sm"
                      />
                    </div>
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
