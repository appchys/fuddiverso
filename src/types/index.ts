import { Timestamp } from 'firebase/firestore'

export interface Business {
  id: string
  name: string
  username: string // Campo para URL amigable (ej: "munchys")
  description: string
  address: string
  phone: string // Formato ecuatoriano: 09XXXXXXXX (10 dígitos)
  email: string
  ownerId?: string // UID del usuario propietario en Firebase Auth
  administrators?: BusinessAdministrator[] // Lista de administradores
  image?: string // Imagen de perfil/logo de la tienda
  coverImage?: string // Imagen de portada de la tienda
  locationImage?: string // Foto del local/establecimiento
  categories?: string[] // Categorías personalizadas del negocio
  mapLocation: {
    lat: number
    lng: number
  }
  references: string
  bankAccount?: {
    bankName: string
    accountType: string
    accountNumber: string
    accountHolder: string
  }
  schedule: {
    [key: string]: {
      open: string
      close: string
      isOpen: boolean
    }
  }
  manualStoreStatus?: 'open' | 'closed' | null // Control manual: open/closed override, null = usar horario
  isActive: boolean
  createdAt: Date
  updatedAt: Date
  lastLoginAt?: any
  lastRegistrationAt?: any
  loginSource?: string
  ratingAverage?: number // Calificación promedio
  ratingCount?: number // Cantidad de calificaciones
  rewardSettings?: {
    enabled: boolean
    name: string
    description: string
    image?: string
    ingredients?: Ingredient[]
  }
}

export interface BusinessAdministrator {
  uid: string // UID del usuario en Firebase Auth
  email: string
  name?: string
  role: 'owner' | 'admin' | 'manager' // Niveles de permisos
  addedAt: Date
  addedBy: string // UID de quien lo agregó
  permissions: {
    manageProducts: boolean
    manageOrders: boolean
    manageAdmins: boolean
    viewReports: boolean
    editBusiness: boolean
  }
}

export interface ClientLocation {
  id: string
  id_cliente: string
  referencia: string
  sector: string
  tarifa: string
  latlong: string
  photo?: string
}

export interface CoverageZone {
  id: string
  name: string
  businessId?: string // Si es específico de un negocio, sino es zona global
  polygon: {
    lat: number
    lng: number
  }[]
  deliveryFee: number
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

export interface Ingredient {
  id?: string
  name: string
  quantity: number
  unitCost: number
  unit?: string
}

export interface ProductVariant {
  id: string
  name: string
  description?: string
  price: number
  isAvailable: boolean
  ingredients?: Ingredient[]
}

export interface Product {
  id: string
  businessId: string
  name: string
  description: string
  price: number // Precio base del producto
  category: string
  image?: string
  variants?: ProductVariant[] // Variantes opcionales del producto
  isAvailable: boolean
  businessName?: string
  businessImage?: string
  ingredients?: Ingredient[]
  createdAt: Date
  updatedAt: Date
}

export interface CartItem {
  product: Product
  quantity: number
  subtotal: number
}

export interface Customer {
  name: string
  phone: string // Formato ecuatoriano: 09XXXXXXXX (10 dígitos)
}

export interface DeliveryInfo {
  type: 'delivery' | 'pickup'
  references?: string
  latlong?: string // Coordenadas en formato "lat, lng" desde tabla ubicaciones
  mapLocation?: {
    lat: number
    lng: number
  }
  photo?: string
  assignedDelivery?: string // ID del delivery asignado
  deliveryCost?: number // Costo de envío desde tabla ubicaciones
}

export interface OrderTiming {
  type: 'immediate' | 'scheduled'
  scheduledDate?: Date | Timestamp
  scheduledTime?: string
}

export interface PaymentInfo {
  method: 'cash' | 'transfer' | 'mixed'
  selectedBank?: string
  receiptImageUrl?: string
  paymentStatus?: 'pending' | 'validating' | 'paid' | 'rejected'
  // Campos para pago mixto
  cashAmount?: number
  transferAmount?: number
  bankAccount?: {
    bankName: string
    accountType: string
    accountNumber: string
    accountHolder: string
  }
}

export interface Order {
  id: string
  businessId: string
  customer: Customer
  items: CartItem[]
  delivery: DeliveryInfo
  timing: OrderTiming
  payment: PaymentInfo
  total: number
  subtotal?: number
  status: 'pending' | 'confirmed' | 'preparing' | 'ready' | 'delivered' | 'cancelled'
  createdAt: Date
  updatedAt: Date
  deliveredAt?: Date | Timestamp // Fecha y hora cuando se marcó como entregado
  createdByAdmin?: boolean
  // Timestamps para cada cambio de estado
  statusHistory?: {
    pendingAt?: Date | Timestamp
    confirmedAt?: Date | Timestamp
    preparingAt?: Date | Timestamp
    readyAt?: Date | Timestamp
    deliveredAt?: Date | Timestamp
    cancelledAt?: Date | Timestamp
  }
  waSentToDelivery?: boolean
}

export interface Delivery {
  id: string
  nombres: string
  celular: string
  email: string
  fotoUrl?: string
  estado: 'activo' | 'inactivo'
  fechaRegistro: string
  uid?: string // UID de Firebase Auth para autenticación
}

export interface QRCode {
  id: string
  name: string
  points: number
  prize?: string
  image?: string
  color?: string // Color de fondo personalizable en formato hexadecimal
  isActive: boolean
  businessId: string
  createdAt: Date
  updatedAt?: Date
}

export interface UserQRProgress {
  userId: string
  scannedCodes: string[] // Array de IDs de códigos escaneados
  completed: boolean
  lastScanned?: Date | Timestamp
  rewardClaimed: boolean
  redeemedPrizeCodes?: string[] // Premios en carrito actual (temporal, se puede revertir)
  completedRedemptions?: string[] // Premios canjeados en órdenes completadas (permanente)
  businessId: string
  createdAt: Date
  updatedAt?: Date
}

