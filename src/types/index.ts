import { Timestamp } from 'firebase/firestore'

export interface Business {
  id: string
  name: string
  username: string // Campo para URL amigable (ej: "munchys")
  description: string
  address?: string
  phone: string // Formato ecuatoriano: 09XXXXXXXX (10 dígitos)
  email: string
  ownerId?: string // UID del usuario propietario en Firebase Auth
  administrators?: BusinessAdministrator[] // Lista de administradores
  adminEmails?: string[] // Array de emails de administradores para queries optimizadas
  image?: string // Imagen de perfil/logo de la tienda
  coverImage?: string // Imagen de portada de la tienda
  locationImage?: string // Foto del local/establecimiento
  categories?: string[] // Categorías personalizadas del negocio
  mapLocation: {
    lat: number
    lng: number
  }
  references?: string
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
  isHidden?: boolean // Ocultar la tienda del público
  category?: string // Categoría del negocio (restaurante, cafetería, etc.)
  businessType?: 'food_store' | 'distributor' // Tipo de negocio
  isOpen?: boolean // Estado actual de apertura
  isActive: boolean
  deliveryTime?: number // Tiempo de entrega estimado en minutos
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
  pickupSettings?: {
    enabled: boolean
    references: string
    latlong: string
    storePhotoUrl: string
  }
  notificationSettings?: {
    emailOrderClient: boolean // Notificaciones de pedidios hechos por cliente
    emailOrderManual: boolean // Notificaciones de pedidos manuales
    emailCheckoutProgress: boolean // Notificaciones cuando un cliente inicia checkout
    telegramOrderManual?: boolean // Notificaciones de pedidos manuales por Telegram
  }
  telegramChatIds?: string[] // IDs de chat de Telegram para notificaciones a la tienda
  telegramChatId?: string // ID antiguo (para migración)
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
  // Soporte para múltiples deliveries con Round Robin
  assignedDeliveryId?: string // DEPRECATED: Mantener para compatibilidad
  assignedDeliveryIds?: string[] // Array de IDs de deliveries asignados a esta zona
  deliveryAssignmentStrategy?: 'single' | 'round-robin' // Estrategia de asignación
  lastAssignedIndex?: number // Índice del último delivery asignado (para Round Robin)
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

export interface ProductSchedule {
  id: string
  days: string[] // ['Monday', 'Tuesday', ...] o abreviados: ['Mon', 'Tue', ...]
  startTime: string // Formato HH:mm (00:00 - 23:59)
  endTime: string // Formato HH:mm (00:00 - 23:59)
}

export interface ProductScheduleAvailability {
  enabled: boolean // Si está activado el sistema de horarios
  schedules: ProductSchedule[] // Array de horarios cuando está disponible
}

export interface Product {
  id: string
  businessId: string
  name: string
  description: string
  price: number // Precio base del producto
  category: string
  image?: string
  slug?: string // Slug amigable (ej: "munRJd")
  variants?: ProductVariant[] // Variantes opcionales del producto
  isAvailable: boolean
  order?: number // Orden de visualización
  businessName?: string
  businessImage?: string
  ingredients?: Ingredient[]
  scheduleAvailability?: ProductScheduleAvailability // Disponibilidad por horarios/días
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
  acceptanceStatus?: 'pending' | 'accepted' | 'rejected' // Estado de aceptación por parte del delivery
  rejectedBy?: string[] // Lista de IDs de repartidores que han rechazado este pedido
  rejectionReason?: string // Motivo del rechazo
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
  status: 'pending' | 'confirmed' | 'preparing' | 'ready' | 'on_way' | 'delivered' | 'cancelled' | 'borrador'
  createdAt: Date
  updatedAt: Date
  deliveredAt?: Date | Timestamp // Fecha y hora cuando se marcó como entregado
  createdByAdmin?: boolean
  referralCode?: string // Código de referido si la orden vino de un link de recomendación
  // Timestamps para cada cambio de estado
  statusHistory?: {
    pendingAt?: Date | Timestamp
    confirmedAt?: Date | Timestamp
    preparingAt?: Date | Timestamp
    readyAt?: Date | Timestamp
    on_wayAt?: Date | Timestamp
    deliveredAt?: Date | Timestamp
    cancelledAt?: Date | Timestamp
  }
  waSentToDelivery?: boolean
  paymentCollector?: 'fuddi' | 'store' // Quién cobró el dinero
  settlementStatus?: 'pending' | 'settled' // Estado de liquidación
  settlementId?: string // ID de la liquidación si ya fue procesada
  telegramBusinessMessages?: { chatId: string, messageId: number }[] // Rastreo de mensajes enviados a la tienda
}

export interface Settlement {
  id: string
  businessId: string
  startDate: Date
  endDate: Date
  totalOrders: number
  totalSales: number // Suma de total de órdenes
  totalCommission: number // Suma de comisiones retenidas
  totalDelivery: number // Suma de costos de envío (si aplica)
  netAmount: number // (Ventas cobradas por Fuddi) - (Comisiones) + (Delivery)
  status: 'pending' | 'completed'
  createdAt: Date
  createdBy: string
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
  telegramChatId?: string // ID de chat de Telegram para notificaciones
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

// Sistema de Referidos
export interface ReferralLink {
  id: string
  code: string // Código único del referido (ej: "REF-ABC123")
  productId: string
  businessId: string
  createdBy?: string // Teléfono del usuario que creó el link (opcional, puede ser anónimo)
  createdAt: Date
  clicks: number // Contador de clicks en el link
  conversions: number // Contador de ventas completadas
  lastUsedAt?: Date
}

export interface ReferralRecord {
  orderId: string
  referralCode: string
  creditAmount: number // Normalmente 1
  status: 'pending' | 'completed' | 'cancelled'
  createdAt: Date
  completedAt?: Date
}

export interface UserCredits {
  id?: string
  userId: string // Teléfono del usuario
  businessId: string
  totalCredits: number // Total de créditos acumulados
  availableCredits: number // Créditos disponibles para usar
  usedCredits: number // Créditos ya utilizados
  referrals: ReferralRecord[] // Historial de referidos
  createdAt: Date
  updatedAt: Date
}

