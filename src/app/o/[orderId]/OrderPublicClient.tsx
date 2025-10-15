"use client"

import React, { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { getOrder, getBusiness } from '@/lib/database'

type Props = {
  orderId: string
}

export default function OrderPublicClient({ orderId }: Props) {
  const [order, setOrder] = useState<any | null>(null)
  const [business, setBusiness] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const data = await getOrder(orderId)
        if (!mounted) return
        if (!data) {
          setError('Orden no encontrada')
        } else {
          setOrder(data)

          // Cargar información del negocio
          if (data.businessId) {
            try {
              const businessData = await getBusiness(data.businessId)
              if (mounted) {
                setBusiness(businessData)
              }
            } catch (businessError) {
              console.error('Error loading business:', businessError)
              // No establecer error para el negocio, solo continuar sin él
            }
          }
        }
      } catch (e: any) {
        setError('Error al cargar la orden')
      } finally {
        if (mounted) setLoading(false)
      }
    }
    load()
    return () => { mounted = false }
  }, [orderId])

  if (loading) return <div className="p-6">Cargando orden...</div>
  if (error) return <div className="p-6 text-red-600">{error}</div>
  if (!order) return <div className="p-6">Orden no encontrada</div>

  const formatDate = (d: any) => {
    try {
      const date = new Date(d)
      return date.toLocaleString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    } catch {
      return String(d)
    }
  }

  const getStatusTranslation = (status: string) => {
    const translations: { [key: string]: string } = {
      'pending': 'Pendiente',
      'confirmed': 'Confirmado',
      'preparing': 'Preparando',
      'ready': 'Listo',
      'delivered': 'Entregado',
      'cancelled': 'Cancelado'
    }
    return translations[status] || status
  }

  const getStatusColor = (status: string) => {
    const colors: { [key: string]: string } = {
      'pending': 'bg-yellow-100 text-yellow-800',
      'confirmed': 'bg-blue-100 text-blue-800',
      'preparing': 'bg-orange-100 text-orange-800',
      'ready': 'bg-green-100 text-green-800',
      'delivered': 'bg-emerald-100 text-emerald-800',
      'cancelled': 'bg-red-100 text-red-800'
    }
    return colors[status] || 'bg-gray-100 text-gray-800'
  }

  const calculateDeliveryTime = () => {
    if (!order.timing?.scheduledDate) return null

    try {
      const now = new Date()
      const scheduledDateTime = new Date(order.timing.scheduledDate)

      // Si también hay hora programada, incluirla
      if (order.timing.scheduledTime) {
        const [hours, minutes] = order.timing.scheduledTime.split(':')
        scheduledDateTime.setHours(parseInt(hours), parseInt(minutes), 0, 0)
      }

      const diffMs = scheduledDateTime.getTime() - now.getTime()

      if (diffMs < 0) {
        return 'Entrega programada para el pasado'
      }

      const diffMinutes = Math.floor(diffMs / (1000 * 60))
      const diffHours = Math.floor(diffMinutes / 60)
      const remainingMinutes = diffMinutes % 60

      if (diffHours > 24) {
        const diffDays = Math.floor(diffHours / 24)
        const remainingHours = diffHours % 24
        return `Falta ${diffDays} día${diffDays > 1 ? 's' : ''} y ${remainingHours} hora${remainingHours !== 1 ? 's' : ''}`
      } else if (diffHours > 0) {
        return `Falta ${diffHours} hora${diffHours > 1 ? 's' : ''} y ${remainingMinutes} minuto${remainingMinutes !== 1 ? 's' : ''}`
      } else {
        return `Falta ${remainingMinutes} minuto${remainingMinutes !== 1 ? 's' : ''}`
      }
    } catch (error) {
      console.error('Error calculating delivery time:', error)
      return null
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-4">
      <div className="bg-white shadow rounded-lg p-4 border border-gray-200 relative">
        {/* Estado en esquina superior derecha */}
        <div className={`absolute top-4 right-4 px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(order.status)}`}>
          {getStatusTranslation(order.status)}
        </div>

        {business?.image && (
          <div className="mb-4 flex justify-center">
            <img
              src={business.image}
              alt={`Logo de ${business.name}`}
              className="w-16 h-16 rounded-full object-cover border-2 border-gray-200"
            />
          </div>
        )}

        <h1 className="text-lg font-semibold mb-2">Detalles de la Orden</h1>
        <div className="text-sm text-gray-600 mb-4">Creada: {formatDate(order.createdAt)}</div>
        {order.timing?.scheduledTime && (
          <div className="text-sm text-gray-600 mb-4">
            {order.timing?.scheduledDate ?
              `Programada para: ${formatDate(order.timing.scheduledDate)}${order.timing.scheduledTime ? ` a las ${order.timing.scheduledTime}` : ''}` :
              `Hora programada: ${order.timing.scheduledTime}`
            }
          </div>
        )}
        {calculateDeliveryTime() && (
          <div className="text-sm font-medium text-blue-600 mb-4">
            ⏰ {calculateDeliveryTime()}
          </div>
        )}

        <div className="mb-3">
          <div className="text-xs text-gray-500">Cliente</div>
          <div className="font-medium">{order.customer?.name || '—'}</div>
          <div className="text-sm text-gray-600">{order.customer?.phone || ''}</div>
        </div>

        <div className="mb-3">
          <div className="text-xs text-gray-500">Entrega</div>
          <div className="text-sm text-gray-900">{order.delivery?.type === 'delivery' ? 'Delivery' : 'Retiro'}</div>
          {order.delivery?.references && (
            <div className="text-sm text-gray-600">{order.delivery.references}</div>
          )}
        </div>

        <div className="mb-3">
          <div className="text-xs text-gray-500">Productos</div>
          <ul className="mt-2 space-y-2">
            {order.items && order.items.length > 0 ? (
              order.items.map((it: any, idx: number) => (
                <li key={idx} className="flex justify-between">
                  <div className="text-sm">{it.quantity}x {it.variant || it.name || (it.product && it.product.name) || 'Producto'}</div>
                  <div className="text-sm font-medium">${(it.price || 0).toFixed(2)}</div>
                </li>
              ))
            ) : (
              <li className="text-sm text-gray-500">Sin productos</li>
            )}
          </ul>
        </div>

        <div className="flex items-center justify-between mt-4">
          <div className="text-sm text-gray-500">Total</div>
          <div className="text-lg font-bold text-emerald-600">${(order.total || 0).toFixed(2)}</div>
        </div>

        <div className="mt-4 text-xs text-gray-500">Si crees que hay un error, contacta al comercio.</div>
      </div>
    </div>
  )
}
