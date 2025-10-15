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

  return (
    <div className="max-w-2xl mx-auto p-4">
      <div className="bg-white shadow rounded-lg p-4 border border-gray-200">
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
          <div className="text-sm text-gray-600 mb-4">Hora programada: {order.timing.scheduledTime}</div>
        )}

        <div className="mb-3">
          <div className="text-xs text-gray-500">Estado</div>
          <div className="font-medium">{order.status}</div>
        </div>

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
