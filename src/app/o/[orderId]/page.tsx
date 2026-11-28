import React, { cache } from 'react'
import { Metadata } from 'next'
import OrderSidebarPageClient from './OrderSidebarPageClient'
import { getOrder, getBusiness } from '@/lib/database'

type Props = {
  params: Promise<{ orderId: string }>
}

const getCachedOrder = cache(async (orderId: string) => {
  return getOrder(orderId)
})

function serializeForClient(value: any): any {
  if (value === null || value === undefined) return value
  if (typeof value !== 'object') return value
  if (value instanceof Date) {
    return { seconds: Math.floor(value.getTime() / 1000), nanoseconds: 0 }
  }
  if (typeof value.toDate === 'function') {
    const d = value.toDate()
    return { seconds: Math.floor(d.getTime() / 1000), nanoseconds: value.nanoseconds || 0 }
  }
  if (typeof value.seconds === 'number' && typeof value.nanoseconds === 'number') {
    return { seconds: value.seconds, nanoseconds: value.nanoseconds }
  }
  if (Array.isArray(value)) {
    return value.map(serializeForClient)
  }
  const out: Record<string, any> = {}
  for (const [k, v] of Object.entries(value)) {
    if (v !== undefined && typeof v !== 'function') {
      out[k] = serializeForClient(v)
    }
  }
  return out
}

// Función para generar metadatos dinámicamente
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { orderId } = await params

  try {
    const order: any = await getCachedOrder(orderId)

    if (!order?.businessId) {
      return {
        title: 'Detalles de la Orden',
        description: 'Consulta el estado de tu orden',
      }
    }

    // Usar businessSnapshot embebido en la orden para evitar lectura extra a Firestore
    const snap = order.businessSnapshot
    let businessName = snap?.name || ''
    let businessImage = snap?.logo || snap?.image || ''

    if (!businessName) {
      const business = await getBusiness(order.businessId)
      businessName = business?.name || 'Tienda'
      businessImage = businessImage || business?.image || ''
    }

    return {
      title: `Orden - ${businessName || 'Tienda'}`,
      description: `Consulta el estado de tu orden en ${businessName || 'nuestra tienda'}`,
      openGraph: {
        title: `Orden - ${businessName || 'Tienda'}`,
        description: `Consulta el estado de tu orden en ${businessName || 'nuestra tienda'}`,
        images: businessImage ? [
          {
            url: businessImage,
            width: 1200,
            height: 630,
            alt: `Logo de ${businessName}`,
          },
        ] : [],
      },
      twitter: {
        card: 'summary_large_image',
        title: `Orden - ${businessName || 'Tienda'}`,
        description: `Consulta el estado de tu orden en ${businessName || 'nuestra tienda'}`,
        images: businessImage ? [businessImage] : [],
      },
    }
  } catch (error) {
    console.error('Error generando metadatos:', error)
    return {
      title: 'Detalles de la Orden',
      description: 'Consulta el estado de tu orden',
    }
  }
}

export default async function Page({ params }: Props) {
  const { orderId } = await params
  let initialOrder: any = null
  try {
    const order = await getCachedOrder(orderId)
    if (order) {
      initialOrder = serializeForClient(order)
    }
  } catch {
    // Fallback al listener del cliente si falla la precarga SSR
  }

  return (
    <OrderSidebarPageClient orderId={orderId} initialOrder={initialOrder} />
  )
}
