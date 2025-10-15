"use client"

import React, { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { getOrder, getBusiness, getDelivery } from '@/lib/database'
import Image from 'next/image'

// Componente para el mapa estático
const StaticMap = ({ lat, lng }: { lat: number; lng: number }) => {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  const zoom = 15
  const size = '600x300'
  const mapUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=${zoom}&size=${size}&markers=color:red%7C${lat},${lng}&key=${apiKey}`
  const mapsUrl = `https://www.google.com/maps?q=${lat},${lng}`

  return (
    <a 
      href={mapsUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="block group"
      aria-label="Ver ubicación en Google Maps"
    >
      <div className="mt-6 rounded-lg overflow-hidden border border-gray-200 shadow-sm transition-all duration-200 group-hover:shadow-md group-hover:border-blue-300">
        <div className="relative w-full h-48 md:h-64">
          <Image
            src={mapUrl}
            alt="Ubicación de entrega"
            fill
            className="object-cover transition-transform duration-200 group-hover:scale-105"
            unoptimized
          />
          <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-5 transition-all duration-200" />
        </div>
        <div className="p-3 bg-gray-50 border-t border-gray-100 flex items-center justify-center">
          <span className="text-sm text-blue-600 font-medium flex items-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Ver en Google Maps
          </span>
        </div>
      </div>
    </a>
  )
}

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

  const formatDate = (d: any, timeOnly: boolean = false) => {
    try {
      // Handle Firestore Timestamp objects
      if (d && typeof d === 'object' && 'seconds' in d) {
        const timestamp = d.seconds * 1000 + (d.nanoseconds || 0) / 1000000;
        const date = new Date(timestamp);
        
        if (timeOnly) {
          return date.toLocaleTimeString('es-EC', { 
            hour: '2-digit', 
            minute: '2-digit', 
            hour12: true 
          });
        }
        
        return date.toLocaleString('es-EC', { 
          day: '2-digit', 
          month: '2-digit', 
          year: 'numeric', 
          hour: '2-digit', 
          minute: '2-digit' 
        });
      }
      
      // Handle regular dates
      const date = d instanceof Date ? d : new Date(d);
      
      if (timeOnly) {
        return date.toLocaleTimeString('es-EC', { 
          hour: '2-digit', 
          minute: '2-digit', 
          hour12: true 
        });
      }
      
      return date.toLocaleString('es-EC', { 
        day: '2-digit', 
        month: '2-digit', 
        year: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit' 
      });
    } catch (e) {
      console.error('Error formatting date:', e, 'Input:', d);
      return '';
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
    const colors: { [key: string]: { bg: string; text: string; border: string } } = {
      'pending': { bg: 'bg-yellow-50', text: 'text-yellow-800', border: 'border-yellow-300' },
      'confirmed': { bg: 'bg-blue-50', text: 'text-blue-800', border: 'border-blue-300' },
      'preparing': { bg: 'bg-orange-50', text: 'text-orange-800', border: 'border-orange-300' },
      'ready': { bg: 'bg-green-50', text: 'text-green-800', border: 'border-green-300' },
      'delivered': { bg: 'bg-emerald-50', text: 'text-emerald-800', border: 'border-emerald-300' },
      'cancelled': { bg: 'bg-red-50', text: 'text-red-800', border: 'border-red-300' }
    }
    return colors[status] || { bg: 'bg-gray-50', text: 'text-gray-800', border: 'border-gray-300' }
  }

  const getStatusIcon = (status: string) => {
    const icons: { [key: string]: { icon: string, class?: string } } = {
      'pending': { icon: 'clock-history', class: 'text-white' },
      'confirmed': { icon: 'check-circle', class: 'text-white' },
      'preparing': { icon: 'egg-fried', class: 'text-white' },
      'ready': { icon: 'check2-circle', class: 'text-white' },
      'delivered': { icon: 'bicycle', class: 'text-white' },
      'cancelled': { icon: 'x-circle', class: 'text-white' }
    }
    
    const iconData = icons[status] || { icon: 'circle', class: 'text-white' }
    return (
      <i className={`bi bi-${iconData.icon} ${iconData.class || ''}`}></i>
    )
  }

  const getStatusLabel = (status: string) => {
    const labels: { [key: string]: string } = {
      'pending': 'Pendiente',
      'confirmed': 'Confirmado',
      'preparing': 'En preparación',
      'ready': 'Listo para entrega',
      'delivered': 'Entregado',
      'cancelled': 'Cancelado'
    }
    return labels[status] || status
  }

  const renderTimeline = () => {
    if (!order?.statusHistory) return null;

    // Definir los estados a mostrar, excluyendo 'cancelled'
    const statusOrder = ['pending', 'confirmed', 'preparing', 'ready', 'delivered'];
    const currentStatus = order.status === 'cancelled' ? 'delivered' : order.status;
    const currentStatusIndex = statusOrder.indexOf(currentStatus);
    
    // Crear un array con los estados a mostrar
    const allStatuses = statusOrder.map(status => ({
      status,
      completed: statusOrder.indexOf(status) <= currentStatusIndex,
      timestamp: order.statusHistory[`${status}At`],
      isCurrent: status === currentStatus
    }));

    return (
      <div className="mt-8">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Seguimiento de tu pedido</h3>
        <div className="flow-root">
          <ul className="-mb-8">
            {allStatuses.map((item, index) => {
              const colors = getStatusColor(item.status);
              const isCompleted = item.completed && item.timestamp;
              const isCurrent = item.isCurrent;
              const isLast = index === allStatuses.length - 1;

              return (
                <li key={item.status} className="relative pb-8">
                  {!isLast && (
                    <span 
                      className={`absolute left-4 top-4 -ml-px h-full w-0.5 ${isCompleted ? 'bg-emerald-500' : 'bg-gray-200'}`} 
                      aria-hidden="true"
                    />
                  )}
                  <div className="relative flex items-start group">
                    <span className={`h-8 w-8 rounded-full flex items-center justify-center ring-8 ring-white ${isCompleted ? 'bg-emerald-500' : 'bg-gray-200'}`}>
                      {isCompleted ? (
                        <span className="text-white text-lg">{getStatusIcon(item.status)}</span>
                      ) : (
                        <span className="text-gray-500">•</span>
                      )}
                    </span>
                    <div className="ml-4 flex-1">
                      <div className="flex items-center">
                        <h4 className={`text-sm font-medium ${isCurrent ? 'text-emerald-600' : 'text-gray-500'}`}>
                          {getStatusLabel(item.status)}
                        </h4>
                        {isCurrent && (
                          <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
                            Actual
                          </span>
                        )}
                      </div>
                      {item.timestamp && (
                        <p className="mt-1 text-sm text-gray-500">
                          {formatDate(item.timestamp, true)}
                        </p>
                      )}
                      {isCurrent && !item.timestamp && (
                        <p className="mt-1 text-sm text-gray-500">
                          En progreso...
                        </p>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    );
  };

  const getMinutesUntilDelivery = () => {
    // Si el pedido ya fue entregado, no mostrar contador
    if (order.status === 'delivered' || order.status === 'cancelled') {
      console.log('Pedido ya entregado o cancelado, no mostrar contador')
      return null
    }

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
      {/* Logo del negocio */}
      {business?.image && (
        <div className="mb-6 flex justify-center">
          <img
            src={business.image}
            alt={`Logo de ${business.name}`}
            className="w-20 h-20 rounded-full object-cover border-2 border-gray-200"
          />
        </div>
      )}

      {/* Título y datos del cliente */}
      <div className="mb-6">
        <h1 className="text-lg font-bold mb-2 text-gray-900">Detalles de la Orden</h1>
        {order.customer && (
          <div className="flex flex-col gap-1 text-sm text-gray-700">
            <div className="font-semibold">{order.customer.name || 'No especificado'}</div>
            <div>{order.customer.phone || 'No especificado'}</div>
          </div>
        )}
      </div>

      {/* Tarjeta de información general */}
      <div className="bg-white shadow rounded-lg p-4 mb-6 border border-gray-200 relative">
        {/* Estado y tiempo en esquina superior derecha */}
        <div className="absolute top-4 right-4 flex flex-col items-end space-y-1">
          <div className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(order.status).bg} ${getStatusColor(order.status).text} border ${getStatusColor(order.status).border}`}>
            {getStatusTranslation(order.status)}
          </div>
          {(() => {
            const timeInfo = getMinutesUntilDelivery()
            if (timeInfo !== null) {
              return (
                <div className="text-xs text-gray-500">
                  <span className={`font-bold ${timeInfo.isLate ? 'text-red-600' : 'text-orange-600'}`}>
                    {timeInfo.minutes}
                  </span> {timeInfo.isLate ? 'minutos de atraso' : 'minutos restantes'}
                </div>
              )
            }
            return null
          })()}
        </div>

        <div className="text-sm text-gray-600 mb-2">Creada: {formatDate(order.createdAt)}</div>
        {order.timing?.scheduledTime && (
          <div className="text-sm text-gray-600 mb-4">
            {order.timing?.scheduledDate
              ? `Programada para: ${formatDate(order.timing.scheduledDate)}${order.timing.scheduledTime ? ` a las ${order.timing.scheduledTime}` : ''}`
              : `Hora programada: ${order.timing.scheduledTime}`
            }
          </div>
        )}

        {/* Información cuando no hay horario programado */}
        {(() => {
          const possibleTimeFields = ['scheduledDate', 'date', 'deliveryDate', 'fechaEntrega', 'fecha_entrega', 'fechaProgramada', 'scheduledTime', 'time', 'hora']
          const hasAnyTimeInfo = possibleTimeFields.some(field => order.timing?.[field])
          return !hasAnyTimeInfo ? (
            <div className="text-sm text-gray-500 mb-2 italic">
              💡 Esta orden no tiene horario de entrega programado
            </div>
          ) : null
        })()}
      </div>

      {/* Tarjeta de detalles del pedido */}
      <div className="bg-white rounded-lg shadow-md p-6 mb-6">
        <h2 className="text-xl font-bold mb-4">Detalles del Pedido</h2>

        {/* Información de Envío/Retiro */}
        <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
          <h3 className="font-medium text-gray-900 mb-2">
            {order.delivery?.type === 'delivery' ? 'Información de Envío' : 'Información de Retiro'}
          </h3>
          
          {order.delivery?.type === 'delivery' ? (
            <>
              {order.delivery?.references && (
                <p className="text-sm text-gray-700 mb-2">
                  <span className="font-medium">Dirección:</span> {order.delivery.references}
                </p>
              )}
              {order.delivery?.latlong && (() => {
                try {
                  // Intentar parsear las coordenadas del formato "lat, lng"
                  const [lat, lng] = order.delivery.latlong
                    .split(',')
                    .map((coord: string) => parseFloat(coord.trim()));
                  if (!isNaN(lat) && !isNaN(lng)) {
                    return (
                      <div className="mb-3">
                        <StaticMap lat={lat} lng={lng} />
                      </div>
                    );
                  }
                } catch (e) {
                  console.error('Error al parsear coordenadas:', e);
                }
                return null;
              })()}
              {order.delivery?.deliveryCost !== undefined && (
                <p className="text-sm text-gray-700">
                  <span className="font-medium">Costo de envío:</span> ${parseFloat(order.delivery.deliveryCost).toFixed(2)}
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-gray-700">
              <span className="font-medium">Tipo:</span> Retiro en tienda
            </p>
          )}
        </div>
        
        <div className="divide-y">
          {order.items?.map((item: any, index: number) => (
            <div key={index} className="py-3 flex justify-between">
              <div>
                <p className="font-medium">{item.name}</p>
                {item.variant && <p className="text-sm text-gray-500">{item.variant}</p>}
              </div>
              <div className="text-right">
                <p>{item.quantity} x ${item.price?.toFixed(2)}</p>
                <p className="font-medium">${(item.quantity * item.price)?.toFixed(2)}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 pt-4 border-t">
          <div className="flex justify-between py-1">
            <span>Subtotal:</span>
            <span>${order.subtotal?.toFixed(2)}</span>
          </div>
          {order.delivery?.deliveryCost > 0 && (
            <div className="flex justify-between py-1">
              <span>Envío:</span>
              <span>${order.delivery?.deliveryCost?.toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between py-1 font-bold text-lg">
            <span>Total:</span>
            <span>${order.total?.toFixed(2)}</span>
          </div>
        </div>
      </div>

      {/* Línea de tiempo de estados */}
      {renderTimeline()}
    </div>
  )
}
