"use client"

import React, { useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { getOrder, getBusiness, getDelivery, saveBusinessRating, hasOrderBeenRated, updateOrderStatus, createRatingNotification } from '@/lib/database'
import { GOOGLE_MAPS_API_KEY } from '@/components/GoogleMap'
import { sendOrderToStore } from '@/components/WhatsAppUtils'

type Props = {
  orderId: string
}

export default function OrderPublicClient({ orderId }: Props) {
  const router = useRouter()
  const [order, setOrder] = useState<any | null>(null)
  const [business, setBusiness] = useState<any | null>(null)
  const [deliveryPerson, setDeliveryPerson] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState('status')
  const [timeInfo, setTimeInfo] = useState<any>(null) // Nuevo state para timeInfo dinámico
  const [showReceiptModal, setShowReceiptModal] = useState(false) // Estado para modal de comprobante
  const [showReceivedConfirm, setShowReceivedConfirm] = useState(false) // Estado para modal de confirmación de recibido

  // Estados para la calificación
  const [rating, setRating] = useState(0)
  const [hover, setHover] = useState(0)
  const [review, setReview] = useState('')
  const [clientName, setClientName] = useState('')
  const [clientEmail, setClientEmail] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [reviewSubmitted, setReviewSubmitted] = useState(false)
  const [orderRated, setOrderRated] = useState(false)


  // Verificar si la orden ya fue calificada
  useEffect(() => {
    const checkOrderRating = async () => {
      try {
        const rated = await hasOrderBeenRated(orderId);
        setOrderRated(rated);
      } catch (error) {
        console.error('Error verificando si la orden fue calificada:', error);
      }
    };

    if (orderId) {
      checkOrderRating();
    }
  }, [orderId]);

  // Manejar el envío de la calificación
  const handleRatingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (rating === 0 || !order?.businessId) return;

    setIsSubmitting(true);
    try {
      // Usar el nombre del cliente de la orden (customer.name) si existe, o el proporcionado en el formulario
      const clientNameToUse = clientName.trim() || order.customer?.name || 'Cliente';
      // Usar el teléfono del cliente de la orden (customer.phone) si existe
      const clientPhone = order.customer?.phone || '';

      await saveBusinessRating(
        order.businessId,
        orderId,
        rating,
        review,
        {
          name: clientNameToUse,
          phone: clientPhone,
          email: clientEmail.trim() || undefined
        }
      );

      // Crear notificación para el negocio
      await createRatingNotification(
        order.businessId,
        orderId,
        rating,
        review,
        clientNameToUse,
        clientPhone
      );

      setReviewSubmitted(true);
      setOrderRated(true);
    } catch (error) {
      console.error('Error al enviar la calificación:', error);
      alert('Ocurrió un error al enviar tu calificación. Por favor, inténtalo de nuevo.');
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await getOrder(orderId);
        if (!mounted) return;
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

  // Nuevo useEffect para actualizaciones en tiempo real del contador
  useEffect(() => {
    if (!order || !order.timing || ['delivered', 'cancelled'].includes(order.status)) {
      setTimeInfo(null);
      return;
    }

    // Calcular inicial
    const updateTimeInfo = () => {
      const info = getMinutesUntilDelivery();
      setTimeInfo(info);
    };

    updateTimeInfo();

    // Intervalo cada 30 segundos
    const interval = setInterval(updateTimeInfo, 30000);

    return () => clearInterval(interval);
  }, [order]);

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

  // Función para formatear el tiempo en horas y minutos
  const formatTimeDisplay = (totalMinutes: number) => {
    if (totalMinutes >= 60) {
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      if (minutes === 0) {
        return `${hours} hora${hours > 1 ? 's' : ''}`;
      }
      return `${hours} hora${hours > 1 ? 's' : ''} y ${minutes} minuto${minutes > 1 ? 's' : ''}`;
    } else {
      return `${totalMinutes} minuto${totalMinutes > 1 ? 's' : ''}`;
    }
  };

  // Función mejorada: getMinutesUntilDelivery
  const getMinutesUntilDelivery = () => {
    // Si el pedido ya fue entregado o cancelado, no mostrar contador
    if (order.status === 'delivered' || order.status === 'cancelled') {
      return null;
    }

    if (!order.timing) {
      console.warn('No hay timing en la orden');
      return null;
    }

    const { scheduledDate, scheduledTime, type } = order.timing;

    // Validación para scheduledTime (formato HH:MM)
    if (scheduledTime && !/^\d{1,2}:\d{2}$/.test(scheduledTime)) {
      console.error('Formato inválido en scheduledTime:', scheduledTime);
      return null;
    }

    try {
      const now = new Date();
      let deliveryTime: Date;

      if (scheduledDate && typeof scheduledDate === 'object' && 'seconds' in scheduledDate) {
        // Usar timestamp de Firestore para la fecha base
        const timestampMs = scheduledDate.seconds * 1000 + (scheduledDate.nanoseconds || 0) / 1000000;
        deliveryTime = new Date(timestampMs);

        // Si hay scheduledTime, sobrescribir la hora/minutos/segundos
        if (scheduledTime) {
          const [hours, minutes] = scheduledTime.split(':').map(Number);
          deliveryTime.setHours(hours, minutes, 0, 0); // Resetear segundos y ms
        }
      } else if (scheduledTime) {
        // Fallback: fecha actual + hora programada
        deliveryTime = new Date();
        const [hours, minutes] = scheduledTime.split(':').map(Number);
        deliveryTime.setHours(hours, minutes, 0, 0);

        // Si ya pasó hoy, asumir mañana (para type "immediate" o similar)
        if (deliveryTime < now) {
          deliveryTime.setDate(deliveryTime.getDate() + 1);
        }
      } else {
        // No hay ni fecha ni hora: null
        return null;
      }

      const diffMs = deliveryTime.getTime() - now.getTime();
      const diffMinutes = Math.floor(diffMs / (1000 * 60));
      const absMinutes = Math.abs(diffMinutes); // Para mostrar siempre positivo

      // Si type es "immediate", quizás ajustar con un ETA fijo (ej: +30 min), pero por ahora usa lo programado

      return {
        totalMinutes: absMinutes,
        timeDisplay: formatTimeDisplay(absMinutes),
        isLate: diffMs < 0,
        deliveryTime: deliveryTime.toLocaleTimeString('es-EC', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        }),
        fullDate: deliveryTime.toLocaleDateString('es-EC', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric'
        }),
        isToday: deliveryTime.toLocaleDateString('es-EC', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric'
        }) === now.toLocaleDateString('es-EC', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric'
        })
      };
    } catch (error) {
      console.error('Error al calcular tiempo de entrega:', error);
      return null;
    }
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
                  {item.variant && <p className="font-medium text-gray-900">{item.variant}</p>}
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
            <div className="pt-2 text-sm text-gray-600">
              <div
                className={`flex justify-between items-center ${order.payment?.method === 'transfer' && order.payment?.receiptImageUrl
                  ? 'cursor-pointer hover:bg-gray-50 p-2 rounded-lg transition-colors'
                  : ''
                  }`}
                onClick={() => {
                  if (order.payment?.method === 'transfer' && order.payment?.receiptImageUrl) {
                    setShowReceiptModal(true);
                  }
                }}
                title={order.payment?.method === 'transfer' && order.payment?.receiptImageUrl ? 'Click para ver comprobante' : ''}
              >
                <span>Método de pago:</span>
                <span className="font-medium flex items-center gap-1">
                  {order.payment?.method === 'cash' ? '💵 Efectivo' : '🏦 Transferencia'}
                  {order.payment?.method === 'transfer' && order.payment?.receiptImageUrl && (
                    <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </span>
              </div>
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
                <div className="mt-1">
                  <p className="text-lg font-bold text-gray-900">${order.total?.toFixed(2)}</p>
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className={`px-3 py-1 rounded-full text-sm font-medium ${statusColors.bg} ${statusColors.text} border ${statusColors.border} mb-1`}>
                {getStatusTranslation(order.status)}
              </div>
              <div
                className={`text-xs text-gray-500 ${order.payment?.method === 'transfer' && order.payment?.receiptImageUrl
                  ? 'cursor-pointer hover:text-blue-600 transition-colors flex items-center gap-1'
                  : ''
                  }`}
                onClick={() => {
                  if (order.payment?.method === 'transfer' && order.payment?.receiptImageUrl) {
                    setShowReceiptModal(true);
                  }
                }}
                title={order.payment?.method === 'transfer' && order.payment?.receiptImageUrl ? 'Click para ver comprobante' : ''}
              >
                {order.payment?.method === 'cash' ? '💵 Efectivo' : '🏦 Transferencia'}
                {order.payment?.method === 'transfer' && order.payment?.receiptImageUrl && (
                  <svg className="w-3 h-3 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Contador de tiempo mejorado (si aplica) */}
      {timeInfo !== null && (
        <div className="max-w-md mx-auto px-4 py-3">
          <div className={`rounded-xl p-4 text-center ${timeInfo.isLate
            ? 'bg-red-50 border border-red-200'
            : 'bg-orange-50 border border-orange-200'
            }`}>
            <p className={`text-sm font-medium mb-1 flex items-center justify-center ${timeInfo.isLate ? 'text-red-600' : 'text-orange-600'
              }`}>
              {timeInfo.isLate ? (
                <>
                  <span className="mr-1">⚠️</span> Tu pedido está atrasado
                </>
              ) : (
                <>
                  <span className="mr-1">⏱️</span> Tiempo estimado de entrega
                </>
              )}
            </p>
            <p className={`text-2xl font-bold ${timeInfo.isLate ? 'text-red-600' : 'text-orange-600'
              }`}>
              {timeInfo.timeDisplay}
            </p>
            {timeInfo.deliveryTime && (
              <p className="text-sm text-gray-600 mt-1">
                Hora estimada: {timeInfo.deliveryTime} {timeInfo.isToday ? '' : `(${timeInfo.fullDate})`}
              </p>
            )}
          </div>
        </div>
      )}

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
            <div className="flex justify-end mt-3">
              <button
                onClick={() => {
                  // Obtener el número de teléfono y nombre del cliente si existen
                  const phoneNumber = order.customer?.phone;
                  const customerName = order.customer?.name;

                  // Disparar un evento personalizado con el número de teléfono y nombre
                  window.dispatchEvent(new CustomEvent('openLoginModal', {
                    detail: {
                      phone: phoneNumber,
                      name: customerName
                    }
                  }));
                }}
                className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800 hover:bg-blue-50 font-medium py-1.5 px-3 rounded-md transition-colors duration-200"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" className="bi bi-person-plus" viewBox="0 0 16 16">
                  <path d="M6 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm2-3a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm4 8c0 1-1 1-1 1H1s-1 0-1-1 1-4 6-4 6 3 6 4zm-1-.004c-.001-.246-.154-.986-.832-1.664C9.516 10.68 8.289 10 6 10c-2.29 0-3.516.68-4.168 1.332-.678.678-.83 1.418-.832 1.664h10z" />
                  <path fillRule="evenodd" d="M13.5 5a.5.5 0 0 1 .5.5V7h1.5a.5.5 0 0 1 0 1H14v1.5a.5.5 0 0 1-1 0V8h-1.5a.5.5 0 0 1 0-1H13V5.5a.5.5 0 0 1 .5-.5z" />
                </svg>
                <span>Crea tu cuenta</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tabs de navegación */}
      <div className="bg-white rounded-2xl shadow-sm p-1 mb-4 border border-gray-200">
        <div className="flex">
          <button
            onClick={() => setActiveTab('status')}
            className={`flex-1 py-3 px-4 text-center rounded-xl font-medium transition-colors ${activeTab === 'status'
              ? 'bg-blue-500 text-white'
              : 'text-gray-600 hover:text-gray-900'
              }`}
          >
            Estado
          </button>
          <button
            onClick={() => setActiveTab('details')}
            className={`flex-1 py-3 px-4 text-center rounded-xl font-medium transition-colors ${activeTab === 'details'
              ? 'bg-blue-500 text-white'
              : 'text-gray-600 hover:text-gray-900'
              }`}
          >
            Detalles
          </button>
        </div>
      </div>

      <div className="max-w-md mx-auto px-4 py-4">
        {/* Contenido de las tabs */}
        <div className="bg-white rounded-2xl shadow-sm p-5 border border-gray-200 mb-4">
          {activeTab === 'status' ? renderStatusTimeline() : renderOrderDetails()}
        </div>

        {/* Información del repartidor (si aplica) */}
        {order.delivery?.type === 'delivery' && ['ready', 'delivered'].includes(order.status) && (
          <div className="bg-white rounded-2xl shadow-sm p-5 border border-gray-200">
            <h3 className="font-bold text-gray-900 mb-3 flex items-center">
              <span className="mr-2">🚴</span>
              Tu repartidor
            </h3>
            {deliveryPerson ? (
              <div className="flex items-center">
                {deliveryPerson.fotoUrl && (
                  <img
                    src={deliveryPerson.fotoUrl}
                    alt={`Foto de ${deliveryPerson.nombres}`}
                    className="w-12 h-12 rounded-full object-cover border-2 border-gray-200 mr-3"
                    onError={(e) => {
                      const target = e.target as HTMLImageElement;
                      target.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiMjMDA3QkZGOyIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Ik0yMCAyMXYtMmE0IDQgMCAwIDAtNC00SDhhNCA0IDAgMDAtNCA0djIiPjwvcGF0aD48Y2lyY2xlIGN4PSIxMiIgY3k9IjciIHI9IjQiPjwvY2lyY2xlPjwvc3ZnPg==';
                      target.alt = 'Avatar por defecto';
                    }}
                  />
                )}
                <div className="flex-1 flex items-center">
                  <div>
                    <p className="font-medium text-gray-900">{deliveryPerson.nombres || 'Repartidor'}</p>
                    <p className="text-sm text-gray-500">
                      {order.status === 'delivered' ? 'Pedido entregado' : 'En camino con tu pedido'}
                    </p>
                  </div>
                  {deliveryPerson.celular && (
                    <a
                      href={`https://wa.me/593${deliveryPerson.celular.replace(/[^0-9]/g, '').replace(/^593/, '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="bg-green-100 hover:bg-green-200 p-2 rounded-full ml-4"
                      title="Enviar mensaje por WhatsApp"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-green-600" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.964-.941 1.162-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.095 3.2 5.076 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.346z" />
                      </svg>
                    </a>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <span className="text-2xl">🔍</span>
                </div>
                <p className="text-gray-500 text-lg font-medium">Estamos buscando un repartidor</p>
                <p className="text-sm text-gray-400 mt-1">Pronto te asignaremos uno para entregar tu pedido</p>
              </div>
            )}
          </div>
        )}

        {/* Sección de Calificación */}
        {!reviewSubmitted && (
          <div className="mt-8 p-6 bg-white rounded-lg shadow-md">
            <h3 className="text-lg font-semibold mb-4">Califica tu experiencia</h3>
            <p className="text-gray-600 mb-4">¿Cómo calificarías tu pedido en {business?.name}?</p>

            <form onSubmit={handleRatingSubmit} className="space-y-4">
              <div className="flex items-center">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    className={`text-3xl ${star <= (hover || rating) ? 'text-yellow-400' : 'text-gray-300'}`}
                    onClick={() => setRating(star)}
                    onMouseEnter={() => setHover(star)}
                    onMouseLeave={() => setHover(rating)}
                  >
                    ★
                  </button>
                ))}
              </div>

              <div>
                <label htmlFor="review" className="block text-sm font-medium text-gray-700 mb-1">
                  Comentario (opcional)
                </label>
                <textarea
                  id="review"
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500"
                  placeholder="¿Qué te pareció el servicio?"
                  value={review}
                  onChange={(e) => setReview(e.target.value)}
                />
              </div>

              <button
                type="submit"
                disabled={isSubmitting || rating === 0}
                className={`px-4 py-2 rounded-md text-white font-medium ${rating === 0 ? 'bg-gray-400 cursor-not-allowed' : 'bg-red-500 hover:bg-red-600'
                  }`}
              >
                {isSubmitting ? 'Enviando...' : 'Enviar calificación'}
              </button>
            </form>
          </div>
        )}

        {/* Sección de Calificación */}
        {!reviewSubmitted && !orderRated && order?.status === 'completed' && (
          <div className="mt-8 bg-white rounded-lg shadow-md p-6">
            <h3 className="text-xl font-semibold mb-4">Califica tu experiencia</h3>
            <p className="text-gray-600 mb-6">¿Cómo calificarías tu pedido en {business?.name}?</p>

            <form onSubmit={handleRatingSubmit} className="space-y-6">
              <div className="flex items-center justify-center space-x-2">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    className={`text-4xl ${star <= (hover || rating) ? 'text-yellow-400' : 'text-gray-300'}`}
                    onClick={() => setRating(star)}
                    onMouseEnter={() => setHover(star)}
                    onMouseLeave={() => setHover(rating)}
                    aria-label={`Calificar con ${star} ${star === 1 ? 'estrella' : 'estrellas'}`}
                  >
                    ★
                  </button>
                ))}
              </div>

              <div className="space-y-4">
                <div>
                  <label htmlFor="clientName" className="block text-sm font-medium text-gray-700 mb-1">
                    Tu nombre (opcional)
                  </label>
                  <input
                    type="text"
                    id="clientName"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500"
                    placeholder="¿Cómo te llamas?"
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                  />
                </div>

                <div>
                  <label htmlFor="clientEmail" className="block text-sm font-medium text-gray-700 mb-1">
                    Tu correo (opcional)
                  </label>
                  <input
                    type="email"
                    id="clientEmail"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500"
                    placeholder="tu@correo.com"
                    value={clientEmail}
                    onChange={(e) => setClientEmail(e.target.value)}
                  />
                </div>

                <div>
                  <label htmlFor="review" className="block text-sm font-medium text-gray-700 mb-1">
                    Comentario (opcional)
                  </label>
                  <textarea
                    id="review"
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500"
                    placeholder="¿Qué te pareció el servicio?"
                    value={review}
                    onChange={(e) => setReview(e.target.value)}
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting || rating === 0}
                className={`w-full py-3 px-4 rounded-md font-medium text-white ${rating === 0 ? 'bg-gray-400 cursor-not-allowed' : 'bg-red-500 hover:bg-red-600'} transition-colors`}
              >
                {isSubmitting ? 'Enviando...' : 'Enviar calificación'}
              </button>
            </form>
          </div>
        )}

        {reviewSubmitted && (
          <div className="mt-8 p-6 bg-green-50 text-green-800 rounded-lg">
            <div className="flex items-center">
              <svg className="h-6 w-6 text-green-500 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <p className="font-medium">¡Gracias por tu calificación!</p>
            </div>
            <p className="mt-1">Tu opinión es muy importante para nosotros.</p>
          </div>
        )}

        {orderRated && !reviewSubmitted && (
          <div className="mt-8 p-6 bg-blue-50 text-blue-800 rounded-lg">
            <div className="flex items-center">
              <svg className="h-6 w-6 text-blue-500 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="font-medium">¡Gracias por calificar este pedido!</p>
            </div>
            <p className="mt-1">Tu opinión ayuda a mejorar nuestro servicio.</p>
          </div>
        )}

        {/* Botón de WhatsApp para comprobante */}
        <div className="mt-6">
          <button
            onClick={() => business && sendOrderToStore(order, business)}
            className="w-full bg-green-500 hover:bg-green-600 text-white font-bold py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition-colors shadow-sm"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
              <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.964-.941 1.162-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.095 3.2 5.076 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.346z" />
            </svg>
            Obtener comprobante por whatsapp
          </button>
        </div>

        {/* Botón de Recibido */}
        {order.status !== 'delivered' && order.status !== 'cancelled' && (
          <div className="mt-4">
            <button
              onClick={() => setShowReceivedConfirm(true)}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition-colors shadow-sm"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Recibido
            </button>
          </div>
        )}
      </div>

      {/* Modal de confirmación de recibido */}
      {showReceivedConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
          <div className="bg-white rounded-xl shadow-lg max-w-sm w-full p-6 animate-fade-in-up">
            <div className="text-center mb-6">
              <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-blue-100 mb-4">
                <svg className="h-6 w-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-gray-900">Confirmar recepción</h3>
              <p className="text-sm text-gray-500 mt-2">
                ¿Deseas indicar que recibiste el pedido?
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowReceivedConfirm(false)}
                className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium transition-colors"
                disabled={loading}
              >
                Cancelar
              </button>
              <button
                onClick={async () => {
                  try {
                    setLoading(true);
                    await updateOrderStatus(orderId, 'delivered');
                    // Recargar la orden para reflejar el cambio
                    const updatedOrder = await getOrder(orderId);
                    if (updatedOrder) {
                      setOrder(updatedOrder);
                    }
                    setShowReceivedConfirm(false);
                  } catch (error) {
                    console.error('Error updating order status:', error);
                    alert('Hubo un error al actualizar el estado. Por favor intenta de nuevo.');
                  } finally {
                    setLoading(false);
                  }
                }}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition-colors flex justify-center items-center"
                disabled={loading}
              >
                {loading ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                ) : (
                  'Confirmar'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal para mostrar comprobante de transferencia */}
      {showReceiptModal && order.payment?.receiptImageUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75 p-4"
          onClick={() => setShowReceiptModal(false)}
        >
          <div className="relative max-w-4xl w-full max-h-[90vh] bg-white rounded-lg overflow-hidden">
            {/* Header del modal */}
            <div className="sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Comprobante de Transferencia</h3>
              <button
                onClick={() => setShowReceiptModal(false)}
                className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                title="Cerrar"
              >
                <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Imagen del comprobante */}
            <div className="p-4 overflow-auto max-h-[calc(90vh-60px)]">
              <img
                src={order.payment.receiptImageUrl}
                alt="Comprobante de pago"
                className="w-full h-auto rounded-lg"
                onClick={(e) => e.stopPropagation()}
              />
            </div>

            {/* Footer con botón para abrir en nueva pestaña */}
            <div className="sticky bottom-0 bg-white border-t border-gray-200 px-4 py-3 flex justify-end gap-2">
              <button
                onClick={() => window.open(order.payment.receiptImageUrl, '_blank')}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors flex items-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
                Abrir en nueva pestaña
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}