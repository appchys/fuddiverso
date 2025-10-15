import React from 'react'
import { Metadata } from 'next'
import OrderPublicClient from './OrderPublicClient'
import { getOrder, getBusiness } from '@/lib/database'

type Props = {
  params: Promise<{ orderId: string }>
}

// Función para generar metadatos dinámicamente
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { orderId } = await params

  try {
    // Obtener información de la orden
    const order = await getOrder(orderId)

    if (!order?.businessId) {
      return {
        title: 'Detalles de la Orden',
        description: 'Consulta el estado de tu orden',
      }
    }

    // Obtener información del negocio
    const business = await getBusiness(order.businessId)

    return {
      title: `Orden - ${business?.name || 'Tienda'}`,
      description: `Consulta el estado de tu orden en ${business?.name || 'nuestra tienda'}`,
      openGraph: {
        title: `Orden - ${business?.name || 'Tienda'}`,
        description: `Consulta el estado de tu orden en ${business?.name || 'nuestra tienda'}`,
        images: business?.image ? [
          {
            url: business.image,
            width: 1200,
            height: 630,
            alt: `Logo de ${business.name}`,
          },
        ] : [],
      },
      twitter: {
        card: 'summary_large_image',
        title: `Orden - ${business?.name || 'Tienda'}`,
        description: `Consulta el estado de tu orden en ${business?.name || 'nuestra tienda'}`,
        images: business?.image ? [business.image] : [],
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
  return (
    <main className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4">
        <OrderPublicClient orderId={orderId} />
      </div>
    </main>
  )
}
