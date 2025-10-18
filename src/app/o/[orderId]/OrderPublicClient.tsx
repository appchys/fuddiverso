"use client"

import React, { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { getOrder, getBusiness, getDelivery } from '@/lib/database'
import { GOOGLE_MAPS_API_KEY } from '@/components/GoogleMap'

type Props = {
  orderId: string
}

export default function OrderPublicClient({ orderId }: Props) {
  const [order, setOrder] = useState<any | null>(null)
  const [business, setBusiness] = useState<any | null>(null)
  const [deliveryPerson, setDeliveryPerson] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState('status')

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
      'pending': { bg: 'bg-yellow-100', text: 'text-yellow-800', border: 'border-yellow-300' },
      'confirmed': { bg: 'bg-blue-100', text: 'text-blue-800', border: 'border-blue-300' },
      'preparing': { bg: 'bg-orange-100', text: 'text-orange-800', border: 'border-orange-300' },
      'ready': { bg: 'bg-green-100', text: 'text-green-800', border: 'border-green-300' },
      'delivered': { bg: 'bg-emerald-100', text: 'text-emerald-800', border: 'border-emerald-300' },
      'cancelled': { bg: 'bg-red-100', text: 'text-red-800', border: 'border-red-300' }
    }
    return colors[status] || { bg: 'bg-gray-100', text: 'text-gray-800', border: 'border-gray-300' }
  }

  const getStatusIcon = (status: string) => {
    const icons: { [key: string]: string } = {
      'pending': '⏳',
      'confirmed': '✅',
      'preparing': '👨‍🍳',
      'ready': '📦',
      'delivered': '🚴',
      'cancelled': '❌'
    }
    return icons[status] || '📋'
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

  const getMinutesUntilDelivery = () => {
    // Si el pedido ya fue entregado, no mostrar contador
    if (order.status === 'delivered' || order.status === 'cancelled') {
      return null;
    }

    if (!order.timing) {
      return null;
    }

    // Función para formatear la hora
    const formatTime = (date: Date) => {
      return date.toLocaleTimeString('es-EC', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
    };

    // Si hay una hora programada
    if (order.timing?.scheduledTime) {
      try {
        const now = new Date();
        const scheduledTime = order.timing.scheduledTime;
        const [hours, minutes] = scheduledTime.split(':');
        
        // Crear objeto de fecha con la hora programada para hoy
        const deliveryTime = new Date();
        deliveryTime.setHours(parseInt(hours), parseInt(minutes), 0, 0);
        
        // Si la hora ya pasó hoy, asumir que es para mañana
        if (deliveryTime < now) {
          deliveryTime.setDate(deliveryTime.getDate() + 1);
        }

        const diffMs = deliveryTime.getTime() - now.getTime();
        const diffMinutes = Math.floor(diffMs / (1000 * 60));
        
        return {
          minutes: diffMinutes,
          isLate: diffMs < 0,
          deliveryTime: formatTime(deliveryTime)
        };
      } catch (error) {
        console.error('Error al calcular la hora de entrega:', error);
        return null;
      }
    }

    // Si no hay hora programada, devolver null
    return null;
  };

  const renderStatusTimeline = () => {
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
      <div className="mt-6">
        <div className="flow-root">
          <ul className="space-y-4">
            {allStatuses.map((item, index) => {
              const colors = getStatusColor(item.status);
              const isCompleted = item.completed && item.timestamp;
              const isCurrent = item.isCurrent;

              return (
                <li key={item.status} className="relative">
                  <div className="flex items-start">
                    <div className={`flex-shrink-0 h-10 w-10 rounded-full flex items-center justify-center ${isCompleted ? colors.bg : 'bg-gray-200'}`}>
                      <span className={`text-lg ${isCompleted ? colors.text : 'text-gray-500'}`}>
                        {getStatusIcon(item.status)}
                      </span>
                    </div>
                    <div className="ml-4 flex-1">
                      <div className="flex items-center">
                        <h4 className={`text-base font-medium ${isCurrent ? 'text-emerald-600' : isCompleted ? 'text-gray-900' : 'text-gray-500'}`}>
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
                  {index < allStatuses.length - 1 && (
                    <div className={`absolute left-5 top-10 -ml-px h-6 w-0.5 ${isCompleted ? 'bg-emerald-500' : 'bg-gray-200'}`} aria-hidden="true" />
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    );
  };

  const renderOrderDetails = () => {
    return (
      <div className="space-y-4">
        {/* Información de Envío/Retiro */}
        <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
          <h3 className="font-medium text-gray-900 mb-2 flex items-center">
            <span className="mr-2">📍</span>
            {order.delivery?.type === 'delivery' ? 'Información de Envío' : 'Información de Retiro'}
          </h3>
          
          {order.delivery?.type === 'delivery' ? (
            <>
              {order.delivery?.references && (
                <p className="text-sm text-gray-700 mb-2">
                  <span className="font-medium">Dirección:</span> {order.delivery.references}
                </p>
              )}
              {order.delivery?.latlong && (
                <div className="mb-3">
                  <div className="mt-2 rounded-lg overflow-hidden border border-gray-200">
                    <img 
                      src={`https://maps.googleapis.com/maps/api/staticmap?center=${order.delivery.latlong}&zoom=16&size=600x200&maptype=roadmap&markers=color:red%7C${order.delivery.latlong}&key=${GOOGLE_MAPS_API_KEY}`}
                      alt="Ubicación de entrega"
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        // En caso de error al cargar el mapa, mostramos un mensaje
                        const target = e.target as HTMLImageElement;
                        target.src = 'data:image/svg+xml;charset=UTF-8,%3Csvg%20width%3D%22600%22%20height%3D%22200%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Crect%20width%3D%22600%22%20height%3D%22200%22%20fill%3D%22%23f3f4f6%22%2F%3E%3Ctext%20x%3D%22300%22%20y%3D%22100%22%20font-family%3D%22Arial%22%20font-size%3D%2214%22%20text-anchor%3D%22middle%22%20dominant-baseline%3D%22middle%22%3EMapa%20no%20disponible%3C%2Ftext%3E%3C%2Fsvg%3E';
                        target.alt = 'Mapa no disponible';
                      }}
                    />
                  </div>
                  <p className="text-xs text-gray-500 mt-1 text-center">
                    Ubicación aproximada del destino
                  </p>
                </div>
              )}
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
        
        {/* Productos */}
        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-200">
          <h3 className="font-medium text-gray-900 mb-3 flex items-center">
            <span className="mr-2">🛒</span>
            Productos
          </h3>
          <div className="space-y-3">
            {order.items?.map((item: any, index: number) => (
              <div key={index} className="flex justify-between items-start py-2 border-b border-gray-100 last:border-0">
                <div className="flex-1">
                  <p className="font-medium text-gray-900">{item.name}</p>
                  {item.variant && <p className="text-sm text-gray-500 mt-1">{item.variant}</p>}
                  <p className="text-sm text-gray-500 mt-1">Cantidad: {item.quantity}</p>
                </div>
                <div className="text-right">
                  <p className="font-medium text-gray-900">${(item.quantity * item.price)?.toFixed(2)}</p>
                  <p className="text-sm text-gray-500">${item.price?.toFixed(2)} c/u</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Resumen de pago */}
        <div className="bg-white rounded-xl shadow-sm p-4 border border-gray-200">
          <h3 className="font-medium text-gray-900 mb-3 flex items-center">
            <span className="mr-2">💰</span>
            Resumen de pago
          </h3>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-gray-600">Subtotal:</span>
              <span>${order.subtotal?.toFixed(2)}</span>
            </div>
            {order.delivery?.deliveryCost > 0 && (
              <div className="flex justify-between">
                <span className="text-gray-600">Envío:</span>
                <span>${order.delivery?.deliveryCost?.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between pt-2 border-t border-gray-200 font-bold text-lg">
              <span>Total:</span>
              <span>${order.total?.toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (loading) return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white flex items-center justify-center p-4">
      <div className="text-center">
        <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
        <p className="text-gray-600">Cargando información de tu pedido...</p>
      </div>
    </div>
  )
  
  if (error) return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white flex items-center justify-center p-4">
      <div className="text-center max-w-md">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <span className="text-2xl">❌</span>
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Ha ocurrido un error</h2>
        <p className="text-gray-600">{error}</p>
      </div>
    </div>
  )
  
  if (!order) return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white flex items-center justify-center p-4">
      <div className="text-center max-w-md">
        <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <span className="text-2xl">🔍</span>
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Orden no encontrada</h2>
        <p className="text-gray-600">La orden que buscas no existe o ha sido eliminada.</p>
      </div>
    </div>
  )

  const timeInfo = getMinutesUntilDelivery()
  const statusColors = getStatusColor(order.status)

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white pb-20">
      {/* Header con información del negocio */}
      <div className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-md mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              {business?.image && (
                <img
                  src={business.image}
                  alt={`Logo de ${business.name}`}
                  className="w-12 h-12 rounded-full object-cover border-2 border-gray-200 mr-3"
                />
              )}
              <div>
                <h1 className="font-bold text-gray-900">{business?.name || 'Negocio'}</h1>
              </div>
            </div>
            <div className={`px-3 py-1 rounded-full text-sm font-medium ${statusColors.bg} ${statusColors.text} border ${statusColors.border}`}>
              {getStatusTranslation(order.status)}
            </div>
          </div>
        </div>
      </div>

      {/* Contador de tiempo (si aplica) */}
      {timeInfo !== null && (
        <div className="max-w-md mx-auto px-4 py-3">
          <div className={`rounded-xl p-4 text-center ${timeInfo.isLate ? 'bg-red-50 border border-red-200' : 'bg-orange-50 border border-orange-200'}`}>
            <p className="text-sm font-medium mb-1">
              {timeInfo.isLate ? 'Tu pedido está atrasado' : 'Tiempo estimado de entrega'}
            </p>
            <p className={`text-2xl font-bold ${timeInfo.isLate ? 'text-red-600' : 'text-orange-600'}`}>
              {timeInfo.minutes} min
            </p>
            {timeInfo.deliveryTime && (
              <p className="text-sm text-gray-600 mt-1">
                Hora estimada: {timeInfo.deliveryTime}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Información del pedido */}
      <div className="max-w-md mx-auto px-4 py-4">
        <div className="bg-white rounded-2xl shadow-sm p-5 mb-4 border border-gray-200">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-sm text-gray-500">Creada: {formatDate(order.createdAt)}</p>
            </div>
            <div className="text-right">
              <p className="text-lg font-bold text-gray-900">${order.total?.toFixed(2)}</p>
              <p className="text-sm text-gray-500">{order.items?.length || 0} producto(s)</p>
            </div>
          </div>

          {/* Información cuando no hay horario programado */}
          {(() => {
            const possibleTimeFields = ['scheduledDate', 'date', 'deliveryDate', 'fechaEntrega', 'fecha_entrega', 'fechaProgramada', 'scheduledTime', 'time', 'hora']
            const hasAnyTimeInfo = possibleTimeFields.some(field => order.timing?.[field])
            return !hasAnyTimeInfo ? (
              <div className="bg-gray-50 rounded-lg p-3 border border-gray-200 mt-3">
                <p className="text-sm text-gray-600 italic flex items-center">
                  <span className="mr-2">💡</span>
                  Esta orden no tiene horario de entrega programado
                </p>
              </div>
            ) : null
          })()}
        </div>

        {/* Información del cliente */}
        {order.customer && (
          <div className="bg-white rounded-2xl shadow-sm p-5 mb-4 border border-gray-200">
            <h3 className="font-bold text-gray-900 mb-3 flex items-center">
              <span className="mr-2">👤</span>
              Información del cliente
            </h3>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-600">Nombre:</span>
                <span className="font-medium">{order.customer.name || 'No especificado'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Teléfono:</span>
                <span className="font-medium">{order.customer.phone || 'No especificado'}</span>
              </div>
            </div>
          </div>
        )}

        {/* Tabs de navegación */}
        <div className="bg-white rounded-2xl shadow-sm p-1 mb-4 border border-gray-200">
          <div className="flex">
            <button
              onClick={() => setActiveTab('status')}
              className={`flex-1 py-3 px-4 text-center rounded-xl font-medium transition-colors ${
                activeTab === 'status' 
                  ? 'bg-blue-500 text-white' 
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Estado
            </button>
            <button
              onClick={() => setActiveTab('details')}
              className={`flex-1 py-3 px-4 text-center rounded-xl font-medium transition-colors ${
                activeTab === 'details' 
                  ? 'bg-blue-500 text-white' 
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Detalles
            </button>
          </div>
        </div>

        {/* Contenido de las tabs */}
        <div className="bg-white rounded-2xl shadow-sm p-5 border border-gray-200">
          {activeTab === 'status' ? renderStatusTimeline() : renderOrderDetails()}
        </div>

        {/* Información del repartidor (si existe) */}
        {deliveryPerson && (
          <div className="bg-white rounded-2xl shadow-sm p-5 mt-4 border border-gray-200">
            <h3 className="font-bold text-gray-900 mb-3 flex items-center">
              <span className="mr-2">🚴</span>
              Tu repartidor
            </h3>
            <div className="flex items-center">
              {deliveryPerson.photoURL && (
                <img
                  src={deliveryPerson.photoURL}
                  alt={`Foto de ${deliveryPerson.displayName}`}
                  className="w-12 h-12 rounded-full object-cover border-2 border-gray-200 mr-3"
                />
              )}
              <div>
                <p className="font-medium text-gray-900">{deliveryPerson.displayName || 'Repartidor'}</p>
                <p className="text-sm text-gray-500">En camino con tu pedido</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}