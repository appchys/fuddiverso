"use client"

import React, { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { getOrder, getBusiness, getDelivery } from '@/lib/database'

type Props = {
  orderId: string
}

export default function OrderPublicClient({ orderId }: Props) {
  const [order, setOrder] = useState<any | null>(null)
  const [business, setBusiness] = useState<any | null>(null)
  const [deliveryPerson, setDeliveryPerson] = useState<any | null>(null)
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

          // Cargar información del repartidor si existe
          if (data.delivery?.assignedDelivery) {
            try {
              const deliveryData = await getDelivery(data.delivery.assignedDelivery)
              if (mounted) {
                setDeliveryPerson(deliveryData)
              }
            } catch (deliveryError) {
              console.error('Error loading delivery person:', deliveryError)
              // No establecer error para el repartidor, solo continuar sin él
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

  const getMinutesUntilDelivery = () => {
    console.log('Full order object:', JSON.stringify(order, null, 2))
    console.log('order.timing object:', order.timing)
    console.log('order.timing keys:', order.timing ? Object.keys(order.timing) : 'null')

    // Si tiene hora programada específica, calcular tiempo real hasta esa hora
    if (order.timing?.scheduledTime) {
      console.log('Has scheduled time, calculating real time remaining')

      try {
        const now = new Date()
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        const [hours, minutes] = order.timing.scheduledTime.split(':')
        const scheduledDateTime = new Date(today)
        scheduledDateTime.setHours(parseInt(hours), parseInt(minutes), 0, 0)

        // Si la hora ya pasó hoy, asumir para mañana
        if (scheduledDateTime < now) {
          scheduledDateTime.setDate(scheduledDateTime.getDate() + 1)
        }

        const diffMs = scheduledDateTime.getTime() - now.getTime()
        console.log('Time calculation (today):', {
          now: now.toISOString(),
          scheduled: scheduledDateTime.toISOString(),
          diffMs,
          diffMinutes: Math.floor(diffMs / (1000 * 60))
        })

        if (diffMs < 0) {
          console.log('Scheduled time is in the past')
          return null
        }

        const minutesToday = Math.floor(diffMs / (1000 * 60))
        console.log('Minutes until delivery (today):', minutesToday)
        return minutesToday
      } catch (error) {
        console.error('Error calculating minutes for today:', error)
        return null
      }
    }

    // Si es entrega inmediata SIN hora específica, devolver tiempo estimado
    if (order.timing?.type === 'immediate') {
      console.log('Immediate delivery type without scheduled time')
      // Para entrega inmediata, asumir tiempo estimado (ej: 30-45 minutos)
      return 35 // minutos estimados para entrega inmediata
    }

    // Si tiene fecha específica, usar esa
    const possibleDateFields = ['scheduledDate', 'date', 'deliveryDate', 'fechaEntrega', 'fecha_entrega', 'fechaProgramada']
    let scheduledDate = null

    if (order.timing) {
      for (const field of possibleDateFields) {
        if (order.timing[field]) {
          scheduledDate = order.timing[field]
          console.log(`Found scheduled date in field: ${field} = ${scheduledDate}`)
          break
        }
      }
    }

    if (!scheduledDate) {
      console.log('No scheduled date found in any field')
      return null
    }

    try {
      const now = new Date()
      let scheduledDateTime

      // Manejar diferentes formatos de fecha
      if (typeof scheduledDate === 'string') {
        scheduledDateTime = new Date(scheduledDate)
      } else if (scheduledDate && typeof scheduledDate === 'object') {
        // Si es un Timestamp de Firestore
        if (scheduledDate.seconds) {
          scheduledDateTime = new Date(scheduledDate.seconds * 1000)
        } else if (scheduledDate.toDate && typeof scheduledDate.toDate === 'function') {
          scheduledDateTime = scheduledDate.toDate()
        } else {
          scheduledDateTime = new Date(scheduledDate)
        }
      } else {
        scheduledDateTime = new Date(scheduledDate)
      }

      // Si también hay hora programada, incluirla
      if (order.timing.scheduledTime || order.timing.time || order.timing.hora) {
        const timeField = order.timing.scheduledTime || order.timing.time || order.timing.hora
        if (timeField) {
          const [hours, minutes] = timeField.split(':')
          scheduledDateTime.setHours(parseInt(hours), parseInt(minutes), 0, 0)
        }
      }

      const diffMs = scheduledDateTime.getTime() - now.getTime()
      console.log('Time calculation:', {
        now: now.toISOString(),
        scheduled: scheduledDateTime.toISOString(),
        diffMs,
        diffMinutes: Math.floor(diffMs / (1000 * 60))
      })

      if (diffMs < 0) {
        console.log('Delivery time is in the past')
        return null // Entrega programada para el pasado
      }

      const minutesSpecific = Math.floor(diffMs / (1000 * 60))
      console.log('Minutes until delivery:', minutesSpecific)
      return minutesSpecific // Solo minutos
    } catch (error) {
      console.error('Error calculating minutes until delivery:', error)
      return null
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-4">
      {/* Título fuera del contenedor */}
      <h1 className="text-lg font-bold mb-2 text-gray-900">Detalles de la Orden</h1>

      <div className="bg-white shadow rounded-lg p-4 border border-gray-200 relative">
        {/* Estado y tiempo en esquina superior derecha */}
        <div className="absolute top-4 right-4 flex flex-col items-end space-y-1">
          <div className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(order.status)}`}>
            {getStatusTranslation(order.status)}
          </div>
          {(() => {
            const minutes = getMinutesUntilDelivery()
            return minutes !== null ? (
              <div className="text-xs text-gray-500">
                <span className="text-orange-600 font-bold">{minutes}</span> minutos restantes
              </div>
            ) : null
          })()}
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

        <div className="text-sm text-gray-600 mb-4">Creada: {formatDate(order.createdAt)}</div>
        {order.timing?.scheduledTime && (
          <div className="text-sm text-gray-600 mb-4">
            {order.timing?.scheduledDate ?
              `Programada para: ${formatDate(order.timing.scheduledDate)}${order.timing.scheduledTime ? ` a las ${order.timing.scheduledTime}` : ''}` :
              `Hora programada: ${order.timing.scheduledTime}`
            }
          </div>
        )}

        {/* Información cuando no hay horario programado */}
        {(() => {
          const possibleTimeFields = ['scheduledDate', 'date', 'deliveryDate', 'fechaEntrega', 'fecha_entrega', 'fechaProgramada', 'scheduledTime', 'time', 'hora']
          const hasAnyTimeInfo = possibleTimeFields.some(field => order.timing?.[field])
          return !hasAnyTimeInfo ? (
            <div className="text-sm text-gray-500 mb-4 italic">
              💡 Esta orden no tiene horario de entrega programado
            </div>
          ) : null
        })()}

        <div className="mb-3">
          <div className="text-xs text-gray-500">Cliente</div>
          <div className="font-medium">{order.customer?.name || '—'}</div>
          <div className="text-sm text-gray-600">{order.customer?.phone || ''}</div>
        </div>

        <div className="mb-3">
          <div className="text-xs text-gray-500">Entrega</div>
          <div className="text-sm text-gray-900">{order.delivery?.type === 'delivery' ? 'Delivery' : 'Retiro'}</div>
          {order.delivery?.assignedDelivery && deliveryPerson ? (
            <div className="text-sm text-gray-600">
              Repartidor: {deliveryPerson.nombres} - {deliveryPerson.celular}
            </div>
          ) : order.delivery?.assignedDelivery ? (
            <div className="text-sm text-gray-600">
              Repartidor: Cargando...
            </div>
          ) : null}
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

        {order.delivery?.deliveryCost && order.delivery?.deliveryCost > 0 && (
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm text-gray-500">Envío</div>
            <div className="text-sm font-medium text-gray-700">${order.delivery.deliveryCost.toFixed(2)}</div>
          </div>
        )}

        <div className="flex items-center justify-between mt-4">
          <div className="text-sm text-gray-500">Total</div>
          <div className="text-lg font-bold text-emerald-600">${(order.total || 0).toFixed(2)}</div>
        </div>

        <div className="mt-4 text-xs text-gray-500">Si crees que hay un error, contacta al comercio.</div>
      </div>
    </div>
  )
}
