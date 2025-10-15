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
    console.log('=== DEBUG: getMinutesUntilDelivery ===')
    console.log('Full order object:', JSON.stringify(order, null, 2))
    console.log('order.timing object:', order.timing)
    console.log('order.timing keys:', order.timing ? Object.keys(order.timing) : 'null')

    if (!order.timing) {
      console.log('No timing data found')
      return null
    }

    // Si solo hay hora programada (sin fecha específica)
    if (order.timing?.scheduledTime && !order.timing?.scheduledDate) {
      console.log('🔄 Branch 1: Only scheduled time, no date')

      try {
        const now = new Date()
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        const [hours, minutes] = order.timing.scheduledTime.split(':')
        const scheduledDateTime = new Date(today)
        scheduledDateTime.setHours(parseInt(hours), parseInt(minutes), 0, 0)

        console.log('Today:', today.toISOString())
        console.log('Scheduled time:', order.timing.scheduledTime)
        console.log('Order type:', order.timing.type)
        console.log('Calculated scheduledDateTime:', scheduledDateTime.toISOString())

        // Si la hora ya pasó hoy, asumir para mañana - PERO NO para órdenes inmediatas
        if (scheduledDateTime < now && order.timing.type !== 'immediate') {
          console.log('⏰ Time has passed today, moving to tomorrow')
          scheduledDateTime.setDate(scheduledDateTime.getDate() + 1)
          console.log('Updated scheduledDateTime:', scheduledDateTime.toISOString())
        } else if (scheduledDateTime < now && order.timing.type === 'immediate') {
          console.log('⏰ Immediate order time has passed today, keeping same day for calculation')
        }

        const diffMs = scheduledDateTime.getTime() - now.getTime()
        const diffMinutes = Math.floor(diffMs / (1000 * 60))

        console.log('Final calculation:', {
          now: now.toISOString(),
          scheduled: scheduledDateTime.toISOString(),
          diffMs,
          diffMinutes,
          diffHours: diffMinutes / 60
        })

        console.log('Order timing type:', order.timing.type)
        console.log('Is immediate?', order.timing.type === 'immediate')

        // Verificación especial para órdenes con type "immediate"
        if (order.timing.type === 'immediate') {
          const createdAt = new Date(order.createdAt)
          const hoursSinceCreated = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60)
          console.log('🚨 IMMEDIATE ORDER DETECTED')
          console.log('Order created at:', createdAt.toISOString())
          console.log('Current time:', now.toISOString())
          console.log('Hours since created:', hoursSinceCreated)
          console.log('Minutes since created:', hoursSinceCreated * 60)

          // Para órdenes inmediatas, calcular atraso desde la hora programada, no desde creación
          if (hoursSinceCreated > 0.5) { // Si han pasado más de 30 minutos desde creación
            // Usar la diferencia ya calculada (diffMinutes) que es negativa para horas pasadas
            const minutesLateFromScheduled = Math.abs(diffMinutes)
            console.log('🚨 Immediate order late from scheduled time:', minutesLateFromScheduled, 'minutes')
            return { minutes: minutesLateFromScheduled, isLate: true }
          }
        }

        // SOLUCIÓN DIRECTA: Si es orden inmediata y está muy atrasada, marcar como atrasada
        if (order.timing.type === 'immediate' && diffMinutes > 60) {
          console.log('🚨 FORZANDO: Orden inmediata muy atrasada, marcando como atrasada')
          return { minutes: Math.abs(diffMinutes), isLate: true }
        }

        // Verificación adicional: si la diferencia es muy grande (más de 12 horas), asumir atraso
        const isVeryLate = diffMinutes < -720 // Más de 12 horas de atraso

        if (diffMs < 0 || isVeryLate) {
          const minutesLate = Math.abs(diffMinutes)
          console.log('❌ LATE: Delivery is late by', minutesLate, 'minutes (isVeryLate:', isVeryLate, ')')
          return { minutes: minutesLate, isLate: true }
        }

        console.log('⏳ FUTURE: Minutes remaining:', diffMinutes)
        return { minutes: diffMinutes, isLate: false }
      } catch (error) {
        console.error('❌ ERROR in branch 1:', error)
        return null
      }
    }

    // Buscar fecha programada en diferentes campos posibles
    console.log('🔄 Branch 2: Looking for scheduled date')
    const possibleDateFields = ['scheduledDate', 'date', 'deliveryDate', 'fechaEntrega', 'fecha_entrega', 'fechaProgramada']
    let scheduledDate = null

    for (const field of possibleDateFields) {
      if (order.timing[field]) {
        scheduledDate = order.timing[field]
        console.log(`📅 Found scheduled date in field: ${field} = ${scheduledDate} (type: ${typeof scheduledDate})`)
        break
      }
    }

    if (!scheduledDate) {
      console.log('❌ No scheduled date found in any field')
      return null
    }

    try {
      const now = new Date()
      let scheduledDateTime

      console.log('🔧 Processing scheduled date:', scheduledDate)

      // Manejar diferentes formatos de fecha
      if (typeof scheduledDate === 'string') {
        console.log('📝 String format detected')
        scheduledDateTime = new Date(scheduledDate)
      } else if (scheduledDate && typeof scheduledDate === 'object') {
        console.log('📋 Object format detected')
        // Si es un Timestamp de Firestore
        if (scheduledDate.seconds) {
          console.log('🔥 Firestore timestamp detected')
          scheduledDateTime = new Date(scheduledDate.seconds * 1000)
        } else if (scheduledDate.toDate && typeof scheduledDate.toDate === 'function') {
          console.log('📅 Date object with toDate method detected')
          scheduledDateTime = scheduledDate.toDate()
        } else {
          console.log('📅 Regular date object detected')
          scheduledDateTime = new Date(scheduledDate)
        }
      } else {
        console.log('📅 Converting to Date')
        scheduledDateTime = new Date(scheduledDate)
      }

      console.log('📅 Parsed scheduledDateTime:', scheduledDateTime.toISOString())

      // Si también hay hora programada, incluirla
      if (order.timing.scheduledTime || order.timing.time || order.timing.hora) {
        const timeField = order.timing.scheduledTime || order.timing.time || order.timing.hora
        if (timeField) {
          console.log('⏰ Adding time to date:', timeField)
          const [hours, minutes] = timeField.split(':')
          scheduledDateTime.setHours(parseInt(hours), parseInt(minutes), 0, 0)
          console.log('⏰ Updated scheduledDateTime with time:', scheduledDateTime.toISOString())
        }
      }

      const diffMs = scheduledDateTime.getTime() - now.getTime()
      const diffMinutes = Math.floor(diffMs / (1000 * 60))

      console.log('🧮 Final calculation:', {
        now: now.toISOString(),
        scheduled: scheduledDateTime.toISOString(),
        diffMs,
        diffMinutes,
        diffHours: diffMinutes / 60,
        isLate: diffMs < 0
      })

      // Verificación adicional: si la diferencia es muy grande (más de 12 horas), asumir atraso
      const isVeryLate = diffMinutes < -720 // Más de 12 horas de atraso

      // Siempre devolver un objeto con minutes e isLate
      if (diffMs < 0 || isVeryLate) {
        const minutesLate = Math.abs(diffMinutes)
        console.log('❌ LATE: Delivery is late by', minutesLate, 'minutes (isVeryLate:', isVeryLate, ')')
        return { minutes: minutesLate, isLate: true }
      }

      console.log('⏳ FUTURE: Minutes remaining:', diffMinutes)
      return { minutes: diffMinutes, isLate: false }
    } catch (error) {
      console.error('❌ ERROR in branch 2:', error)
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
            const timeInfo = getMinutesUntilDelivery()
            console.log('⏱️ TimeInfo result:', timeInfo)

            if (timeInfo !== null) {
              console.log(`⏱️ Showing: ${timeInfo.minutes} ${timeInfo.isLate ? 'minutos de atraso' : 'minutos restantes'} (${timeInfo.isLate ? 'red' : 'orange'})`)

              return (
                <div className="text-xs text-gray-500">
                  <span className={`font-bold ${timeInfo.isLate ? 'text-red-600' : 'text-orange-600'}`}>
                    {timeInfo.minutes}
                  </span> {timeInfo.isLate ? 'minutos de atraso' : 'minutos restantes'}
                </div>
              )
            } else {
              console.log('⏱️ No time info to display')
              return null
            }
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
