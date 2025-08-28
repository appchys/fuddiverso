export interface Business {
  id: string
  name: string
  username: string // Campo para URL amigable (ej: "munchys")
  description: string
  address: string
  phone: string // Formato ecuatoriano: 09XXXXXXXX (10 dígitos)
  email: string
  ownerId?: string // UID del usuario propietario en Firebase Auth
  image?: string
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

export interface ClientLocation {
  id: string
  id_cliente: string
  referencia: string
  sector: string
  tarifa: string
  ubicacion: string
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
  mapLocation?: {
    lat: number
    lng: number
  }
  photo?: string
}

export interface OrderTiming {
  type: 'immediate' | 'scheduled'
  scheduledDate?: Date
  scheduledTime?: string
}

export interface PaymentInfo {
  method: 'cash' | 'transfer'
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
  status: 'pending' | 'confirmed' | 'preparing' | 'ready' | 'delivered' | 'cancelled'
  createdAt: Date
  updatedAt: Date
}
