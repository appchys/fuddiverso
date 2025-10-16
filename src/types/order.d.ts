// Extender los tipos existentes para la funcionalidad de impresión
import { Order as BaseOrder } from '@/types'

export interface PrintableOrder extends BaseOrder {
  // Asegurarse que las propiedades necesarias para imprimir estén presentes
  items: Array<{
    quantity: number
    variant?: string
    name?: string
    price: number
    productId: string
    product?: {
      name: string
    }
  }>
  delivery: {
    type: 'delivery' | 'pickup'
    deliveryCost?: number
    references?: string
  }
  timing?: {
    type: 'immediate' | 'scheduled'
    scheduledDate?: any
    scheduledTime?: string
  }
  customer?: {
    name: string
    phone: string
  }
  payment?: {
    method: 'cash' | 'transfer' | 'mixed'
    paymentStatus: string
  }
  total: number
}

export type { BaseOrder as Order }