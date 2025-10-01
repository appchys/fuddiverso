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
  isActive: boolean
  createdAt: Date
  updatedAt: Date
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

export interface ProductVariant {
  id: string
  name: string
  description?: string
  price: number
  isAvailable: boolean
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
  paymentStatus?: 'pending' | 'validating' | 'paid'
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
  createdByAdmin?: boolean
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
