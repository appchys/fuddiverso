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
      'on_way': 'En camino',
      'delivered': 'Entregado',
      'cancelled': 'Cancelado'
    }
    return translations[status] || status
  }

  const getStatusColor = (status: string) => {
    const colors: { [key: string]: { bg: string; text: string; border: string; dot: string } } = {
      'pending': { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-100', dot: 'bg-orange-400' },
      'confirmed': { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-100', dot: 'bg-blue-400' },
      'preparing': { bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-100', dot: 'bg-indigo-400' },
      'ready': { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-100', dot: 'bg-emerald-400' },
      'on_way': { bg: 'bg-cyan-50', text: 'text-cyan-700', border: 'border-cyan-100', dot: 'bg-cyan-400' },
      'delivered': { bg: 'bg-slate-50', text: 'text-slate-700', border: 'border-slate-200', dot: 'bg-slate-400' },
      'cancelled': { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-100', dot: 'bg-red-400' }
    }
    return colors[status] || { bg: 'bg-gray-50', text: 'text-gray-700', border: 'border-gray-100', dot: 'bg-gray-400' }
  }

  const getStatusIcon = (status: string) => {
    const icons: { [key: string]: string } = {
      'pending': 'bi-clock-history',
      'confirmed': 'bi-check2-circle',
      'preparing': 'bi-fire',
      'ready': 'bi-box-seam',
      'on_way': 'bi-bicycle',
      'delivered': 'bi-house-check',
      'cancelled': 'bi-x-circle'
    }
    return icons[status] || 'bi-info-circle'
  }

  const getStatusLabel = (status: string) => {
    const labels: { [key: string]: string } = {
      'pending': 'Pedido pendiente',
      'confirmed': 'Pedido confirmado',
      'preparing': 'En preparación',
      'ready': '¡Listo para entrega!',
      'on_way': 'Tu pedido va en camino',
      'delivered': 'Entregado con éxito',
      'cancelled': 'Pedido cancelado'
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
      return `${hours}h ${minutes}min`;
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
      return null;
    }

    const { scheduledDate, scheduledTime } = order.timing;

    // Validación para scheduledTime (formato HH:MM)
    if (scheduledTime && !/^\d{1,2}:\d{2}$/.test(scheduledTime)) {
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

        // Si ya pasó hoy, asumir mañana
        if (deliveryTime < now) {
          deliveryTime.setDate(deliveryTime.getDate() + 1);
        }
      } else {
        return null;
      }

      const diffMs = deliveryTime.getTime() - now.getTime();
      const diffMinutes = Math.floor(diffMs / (1000 * 60));
      const absMinutes = Math.abs(diffMinutes);

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
    const statusOrder = ['pending', 'confirmed', 'preparing', 'ready', 'on_way', 'delivered'];
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
      <div className="py-2">
        <div className="relative">
          {/* Línea de progreso vertical */}
          <div className="absolute left-[19px] top-4 bottom-4 w-0.5 bg-gray-100"></div>

          <div className="space-y-8">
            {allStatuses.map((item, index) => {
              const colors = getStatusColor(item.status);
              const isCompleted = item.completed && (item.timestamp || item.isCurrent);
              const isCurrent = item.isCurrent;

              return (
                <div key={item.status} className="relative flex items-start group">
                  {/* Punto / Icono */}
                  <div className={`relative z-10 flex items-center justify-center w-10 h-10 rounded-full border-4 transition-all duration-300 ${isCompleted
                    ? `${colors.bg} ${colors.border}`
                    : 'bg-white border-gray-100'
                    }`}>
                    <i className={`bi ${getStatusIcon(item.status)} ${isCompleted ? colors.text : 'text-gray-300'
                      } ${isCurrent ? 'animate-pulse' : ''} text-lg`}></i>
                  </div>

                  {/* Texto */}
                  <div className="ml-4 pt-1">
                    <h4 className={`text-sm font-bold uppercase tracking-wider ${isCurrent ? colors.text : isCompleted ? 'text-gray-900' : 'text-gray-400'
                      }`}>
                      {getStatusLabel(item.status)}
                    </h4>
                    {item.timestamp ? (
                      <p className="text-xs text-gray-500 font-medium mt-0.5">
                        {formatDate(item.timestamp, true)}
                      </p>
                    ) : isCurrent ? (
                      <p className="text-xs text-blue-500 font-medium mt-0.5 flex items-center gap-1">
                        <span className="w-1 h-1 rounded-full bg-blue-500 animate-ping"></span>
                        En progreso
                      </p>
                    ) : null}
                  </div>

                  {/* Línea de conexión activa (parcial) */}
                  {index < allStatuses.length - 1 && item.completed && (
                    <div className={`absolute left-[19px] top-10 w-0.5 bg-gradient-to-b ${colors.bg.replace('bg-', 'from-').replace('-50', '-500')} to-gray-200 h-8`}></div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  const renderOrderDetails = () => {
    return (
      <div className="space-y-6">
        {/* Información de Envío/Retiro */}
        <div>
          <h3 className="font-black text-gray-900 uppercase tracking-widest text-[10px] mb-3">Entrega</h3>
          <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100">
            {order.delivery?.type === 'delivery' ? (
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-xl bg-white border border-gray-100 flex items-center justify-center text-red-500 shadow-sm">
                    <i className="bi bi-geo-alt"></i>
                  </div>
                  <div className="flex-1">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">Dirección de entrega</p>
                    <p className="text-sm font-bold text-gray-900 leading-snug">{order.delivery.references || 'No especificada'}</p>
                  </div>
                </div>

                {order.delivery?.latlong && (
                  <div className="relative group">
                    <div className="rounded-xl overflow-hidden border border-gray-200">
                      <img
                        src={`https://maps.googleapis.com/maps/api/staticmap?center=${order.delivery.latlong}&zoom=16&size=600x200&maptype=roadmap&markers=color:red%7C${order.delivery.latlong}&key=${GOOGLE_MAPS_API_KEY}`}
                        alt="Ubicación"
                        className="w-full h-24 object-cover grayscale opacity-80 group-hover:grayscale-0 group-hover:opacity-100 transition-all duration-500"
                        onError={(e) => {
                          const target = e.target as HTMLImageElement;
                          target.src = 'data:image/svg+xml;charset=UTF-8,%3Csvg%20width%3D%22600%22%20height%3D%22200%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Crect%20width%3D%22600%22%20height%3D%22200%22%20fill%3D%22%23f3f4f6%22%2F%3E%3Ctext%20x%3D%22300%22%20y%3D%22100%22%20font-family%3D%22Arial%22%20font-size%3D%2214%22%20text-anchor%3D%22middle%22%20dominant-baseline%3D%22middle%22%3EMapa%20no%20disponible%3C%2Ftext%3E%3C%2Fsvg%3E';
                        }}
                      />
                    </div>
                    <div className="absolute inset-0 bg-gradient-to-t from-gray-900/10 to-transparent pointer-events-none"></div>
                  </div>
                )}

                {order.delivery?.deliveryCost !== undefined && (
                  <div className="flex justify-between items-center pt-2 border-t border-gray-200/50">
                    <span className="text-xs font-bold text-gray-400 uppercase tracking-tighter">Costo de envío</span>
                    <span className="text-sm font-black text-gray-900">${parseFloat(order.delivery.deliveryCost).toFixed(2)}</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-2xl overflow-hidden border border-gray-100 shadow-sm">
                  {business?.locationImage ? (
                    <img src={business.locationImage} alt={business.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-gray-100 flex items-center justify-center text-gray-400 text-xl">
                      <i className="bi bi-shop"></i>
                    </div>
                  )}
                </div>
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">Punto de retiro</p>
                  <p className="text-sm font-bold text-gray-900 leading-tight">{business?.name}</p>
                  <p className="text-[10px] text-red-500 font-black uppercase tracking-widest mt-0.5">Retiro en tienda</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Productos */}
        <div>
          <h3 className="font-black text-gray-900 uppercase tracking-widest text-[10px] mb-3">Tu Compra</h3>
          <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-50 overflow-hidden shadow-sm">
            {order.items?.map((item: any, index: number) => (
              <div key={index} className="px-4 py-3 flex justify-between items-center group hover:bg-gray-50/50 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center font-black text-xs text-gray-400 border border-gray-100">
                    {item.quantity}x
                  </div>
                  <div>
                    <p className="text-sm font-bold text-gray-900 leading-tight">{item.variant || 'Producto'}</p>
                    <p className="text-[10px] font-medium text-gray-400 mt-0.5">${item.price?.toFixed(2)} c/u</p>
                  </div>
                </div>
                <p className="text-sm font-black text-gray-900">${(item.quantity * item.price)?.toFixed(2)}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Resumen de pago */}
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-xs font-bold text-gray-400 uppercase tracking-tighter">Subtotal</span>
            <span className="text-sm font-bold text-gray-900">${order.subtotal?.toFixed(2)}</span>
          </div>
          {order.delivery?.deliveryCost > 0 && (
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold text-gray-400 uppercase tracking-tighter">Envío</span>
              <span className="text-sm font-bold text-gray-900">${order.delivery?.deliveryCost?.toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between items-center pt-3 border-t-2 border-dashed border-gray-100">
            <span className="text-xs font-black text-gray-900 uppercase tracking-widest">Total</span>
            <span className="text-xl font-black text-red-600">${order.total?.toFixed(2)}</span>
          </div>

          {/* Método de Pago Styling */}
          <div className="mt-4 p-3 rounded-2xl bg-slate-50 border border-gray-100 flex items-center justify-between group">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-white flex items-center justify-center text-lg shadow-sm border border-gray-100">
                {order.payment?.method === 'cash' ? '💵' : '🏦'}
              </div>
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">Método de pago</p>
                <p className="text-[11px] font-black text-gray-900 uppercase tracking-tight">
                  {order.payment?.method === 'cash' ? 'Efectivo' : 'Transferencia'}
                </p>
              </div>
            </div>
            {order.payment?.method === 'transfer' && order.payment?.receiptImageUrl && (
              <button
                onClick={() => setShowReceiptModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-blue-600 transition-colors shadow-sm"
              >
                Ver Comprobante
                <i className="bi bi-eye-fill"></i>
              </button>
            )}
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
    <div className="min-h-screen bg-slate-50 pb-24">
      {/* Header Premium */}
      <div className="bg-white/80 backdrop-blur-md sticky top-0 z-30 border-b border-gray-100 shadow-sm">
        <div className="max-w-md mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {business?.image ? (
                <div className="relative">
                  <img
                    src={business.image}
                    alt={business.name}
                    className="w-12 h-12 rounded-2xl object-cover border border-gray-100 shadow-sm"
                  />
                  <div className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-white ${statusColors.dot}`}></div>
                </div>
              ) : (
                <div className="w-12 h-12 rounded-2xl bg-gray-100 flex items-center justify-center border border-gray-100">
                  <i className="bi bi-shop text-xl text-gray-400"></i>
                </div>
              )}
              <div>
                <h1 className="font-bold text-gray-900 text-sm leading-tight line-clamp-1">{business?.name || 'Negocio'}</h1>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${statusColors.bg} ${statusColors.text} border ${statusColors.border}`}>
                    {getStatusTranslation(order.status)}
                  </span>
                </div>
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-400 font-medium">Total pedido</p>
              <p className="text-lg font-black text-gray-900 leading-none mt-0.5">${order.total?.toFixed(2)}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-md mx-auto px-4 pt-6 space-y-4">
        {/* Contador de tiempo Premium */}
        {timeInfo !== null && (
          <div className={`relative overflow-hidden rounded-3xl p-5 border shadow-sm transition-all duration-500 ${timeInfo.isLate
            ? 'bg-red-50 border-red-100'
            : 'bg-white border-gray-100'
            }`}>
            <div className="relative z-10 flex items-center justify-between">
              <div>
                <p className={`text-[10px] font-bold uppercase tracking-widest mb-1 ${timeInfo.isLate ? 'text-red-500' : 'text-gray-400'
                  }`}>
                  {timeInfo.isLate ? '⚠️ Pedido con retraso' : '⏱️ Tiempo estimado'}
                </p>
                <p className={`text-3xl font-black tracking-tight ${timeInfo.isLate ? 'text-red-600' : 'text-gray-900'
                  }`}>
                  {timeInfo.timeDisplay}
                </p>
                {timeInfo.deliveryTime && (
                  <p className="text-xs text-gray-500 font-medium mt-1">
                    Llegada: <span className="text-gray-900">{timeInfo.deliveryTime}</span> {timeInfo.isToday ? '' : `(${timeInfo.fullDate})`}
                  </p>
                )}
              </div>
              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-2xl ${timeInfo.isLate ? 'bg-red-100 text-red-600' : 'bg-orange-50 text-orange-500'
                }`}>
                <i className={`bi ${timeInfo.isLate ? 'bi-exclamation-triangle' : 'bi-clock-history'}`}></i>
              </div>
            </div>
            {/* Decoración de fondo */}
            <div className={`absolute -right-4 -bottom-4 w-24 h-24 rounded-full opacity-10 ${timeInfo.isLate ? 'bg-red-500' : 'bg-orange-500'
              }`}></div>
          </div>
        )}

        {/* Información rápida del cliente (Card flotante) */}
        {order.customer && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center text-lg">
                <i className="bi bi-person"></i>
              </div>
              <div>
                <p className="text-xs text-gray-400 font-medium">Cliente</p>
                <p className="text-sm font-bold text-gray-900">{order.customer.name || 'No especificado'}</p>
              </div>
            </div>
            <button
              onClick={() => {
                const phoneNumber = order.customer?.phone;
                const customerName = order.customer?.name;
                window.dispatchEvent(new CustomEvent('openLoginModal', {
                  detail: { phone: phoneNumber, name: customerName }
                }));
              }}
              className="text-xs font-bold text-red-500 bg-red-50 px-3 py-2 rounded-xl hover:bg-red-100 transition-colors"
            >
              Crea tu cuenta
            </button>
          </div>
        )}

        {/* Tabs de navegación modernizadas */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-1.5 flex gap-1.5">
          <button
            onClick={() => setActiveTab('status')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-bold transition-all duration-300 ${activeTab === 'status'
              ? 'bg-red-500 text-white shadow-md shadow-red-200'
              : 'text-gray-500 hover:bg-gray-50'
              }`}
          >
            <i className={`bi bi-activity ${activeTab === 'status' ? 'text-white' : 'text-gray-400'}`}></i>
            Seguimiento
          </button>
          <button
            onClick={() => setActiveTab('details')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-bold transition-all duration-300 ${activeTab === 'details'
              ? 'bg-red-500 text-white shadow-md shadow-red-200'
              : 'text-gray-500 hover:bg-gray-50'
              }`}
          >
            <i className={`bi bi-receipt ${activeTab === 'details' ? 'text-white' : 'text-gray-400'}`}></i>
            Detalles
          </button>
        </div>

        {/* Contenido de las pestañas */}
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-6 min-h-[300px]">
          {activeTab === 'status' ? (
            <div>
              <div className="flex items-center justify-between mb-8">
                <h3 className="font-black text-gray-900 uppercase tracking-widest text-xs">Estado del pedido</h3>
                <span className="text-[10px] font-bold text-gray-400 py-1 px-2 bg-gray-50 rounded-lg">ID: {orderId.slice(-6).toUpperCase()}</span>
              </div>
              {renderStatusTimeline()}
            </div>
          ) : (
            renderOrderDetails()
          )}
        </div>

        {/* Información del repartidor Premium */}
        {order.delivery?.type === 'delivery' && ['ready', 'preparing', 'confirmed', 'delivered'].includes(order.status) && (
          <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-6">
            <h3 className="font-black text-gray-900 uppercase tracking-widest text-[10px] mb-4">Repartidor asignado</h3>
            {deliveryPerson ? (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="relative">
                    {deliveryPerson.fotoUrl ? (
                      <img
                        src={deliveryPerson.fotoUrl}
                        alt={deliveryPerson.nombres}
                        className="w-14 h-14 rounded-2xl object-cover border border-gray-100 shadow-sm"
                      />
                    ) : (
                      <div className="w-14 h-14 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center text-2xl">
                        <i className="bi bi-person-badge"></i>
                      </div>
                    )}
                    <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-green-500 rounded-full border-2 border-white flex items-center justify-center">
                      <i className="bi bi-bicycle text-[10px] text-white"></i>
                    </div>
                  </div>
                  <div>
                    <p className="text-sm font-black text-gray-900 leading-tight">{deliveryPerson.nombres || 'Repartidor'}</p>
                    <p className="text-[11px] font-bold text-gray-400 mt-0.5">
                      {order.status === 'delivered' ? '¡Ya entregó tu pedido!' : 'En camino a tu ubicación'}
                    </p>
                  </div>
                </div>
                {deliveryPerson.celular && (
                  <a
                    href={`https://wa.me/593${deliveryPerson.celular.replace(/[^0-9]/g, '').replace(/^593/, '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-12 h-12 rounded-2xl bg-green-500 text-white flex items-center justify-center text-xl shadow-lg shadow-green-200 hover:bg-green-600 transition-all hover:scale-105"
                    title="Contactar repartidor"
                  >
                    <i className="bi bi-whatsapp"></i>
                  </a>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center py-6">
                <div className="w-16 h-16 bg-slate-50 rounded-3xl flex items-center justify-center mb-4 relative overflow-hidden group">
                  <i className="bi bi-search text-gray-300 text-2xl animate-pulse"></i>
                  <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/50 to-transparent animate-shimmer"></div>
                </div>
                <p className="text-sm font-black text-gray-900 leading-tight">Buscando repartidor</p>
                <p className="text-xs text-gray-400 mt-1 text-center font-medium max-w-[180px]">Estamos conectando con los repartidores cercanos</p>
              </div>
            )}
          </div>
        )}

        {/* Sección de Calificación Premium */}
        {order?.status === 'delivered' && !orderRated && !reviewSubmitted && (
          <div className="bg-white rounded-3xl shadow-lg border border-gray-100 p-8 text-center">
            <h3 className="text-xl font-black text-gray-900 mb-2">¿Qué tal estuvo todo?</h3>
            <p className="text-sm text-gray-400 font-medium mb-8">Tu opinión ayuda mucho a {business?.name}</p>

            <form onSubmit={handleRatingSubmit} className="space-y-8">
              <div className="flex items-center justify-center gap-2">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    className={`text-4xl transition-all duration-300 transform ${star <= (hover || rating) ? 'text-yellow-400 scale-110' : 'text-gray-200'
                      } hover:scale-125`}
                    onClick={() => setRating(star)}
                    onMouseEnter={() => setHover(star)}
                    onMouseLeave={() => setHover(rating)}
                  >
                    <i className={`bi ${star <= (hover || rating) ? 'bi-star-fill' : 'bi-star'}`}></i>
                  </button>
                ))}
              </div>

              <div className="space-y-4 text-left">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Tu nombre</label>
                    <input
                      type="text"
                      className="w-full px-4 py-3 bg-slate-50 border border-gray-100 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-red-500/20 focus:border-red-500 outline-none transition-all placeholder:text-gray-300"
                      placeholder="Ej: Juan P."
                      value={clientName}
                      onChange={(e) => setClientName(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Tu correo</label>
                    <input
                      type="email"
                      className="w-full px-4 py-3 bg-slate-50 border border-gray-100 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-red-500/20 focus:border-red-500 outline-none transition-all placeholder:text-gray-300"
                      placeholder="opcional"
                      value={clientEmail}
                      onChange={(e) => setClientEmail(e.target.value)}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Comentario</label>
                  <textarea
                    rows={3}
                    className="w-full px-4 py-3 bg-slate-50 border border-gray-100 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-red-500/20 focus:border-red-500 outline-none transition-all placeholder:text-gray-300 resize-none"
                    placeholder="¿Qué tal estuvo la comida y el servicio?"
                    value={review}
                    onChange={(e) => setReview(e.target.value)}
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting || rating === 0}
                className={`w-full py-4 rounded-2xl font-black uppercase tracking-widest text-xs transition-all duration-300 shadow-xl ${rating === 0
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-red-500 text-white shadow-red-200 hover:bg-red-600 hover:scale-[1.02] active:scale-95'
                  }`}
              >
                {isSubmitting ? 'Enviando...' : 'Enviar calificación'}
              </button>
            </form>
          </div>
        )}

        {/* Mensajes de éxito de calificación */}
        {(reviewSubmitted || orderRated) && (
          <div className="bg-emerald-50 border border-emerald-100 rounded-3xl p-6 text-center">
            <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto mb-4 text-2xl">
              <i className="bi bi-patch-check-fill"></i>
            </div>
            <h3 className="font-black text-emerald-900 mb-1">¡Gracias por calificar!</h3>
            <p className="text-xs text-emerald-700 font-medium">Tu opinión ayuda mucho a mejorar nuestro servicio.</p>
          </div>
        )}

        {/* Botones de acción fijos al fondo o al final */}
        <div className="space-y-3 pt-4">
          <button
            onClick={() => business && sendOrderToStore(order, business)}
            className="w-full bg-white border-2 border-green-500 text-green-600 font-black uppercase tracking-widest text-xs py-4 rounded-2xl flex items-center justify-center gap-3 transition-all hover:bg-green-50 active:scale-95"
          >
            <i className="bi bi-whatsapp text-lg"></i>
            Pedir asistencia por WhatsApp
          </button>

          {order.status !== 'delivered' && order.status !== 'cancelled' && (
            <button
              onClick={() => setShowReceivedConfirm(true)}
              className="w-full bg-blue-600 text-white font-black uppercase tracking-widest text-xs py-4 rounded-2xl flex items-center justify-center gap-3 transition-all hover:bg-blue-700 shadow-lg shadow-blue-200 active:scale-95"
            >
              <i className="bi bi-check-lg text-lg"></i>
              Ya recibí mi pedido
            </button>
          )}
        </div>
      </div>

      {/* Modal de confirmación Premium */}
      {showReceivedConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-gray-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-300">
          <div className="bg-white rounded-[32px] shadow-2xl max-w-sm w-full p-8 text-center animate-in zoom-in-95 duration-300">
            <div className="mx-auto w-20 h-20 rounded-3xl bg-blue-50 text-blue-600 flex items-center justify-center text-4xl mb-6">
              <i className="bi bi-box-seam"></i>
            </div>
            <h3 className="text-xl font-black text-gray-900 mb-2">¿Recibiste tu pedido?</h3>
            <p className="text-sm text-gray-500 font-medium mb-8">
              Confirma si ya tienes todo en tus manos para completar el proceso.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowReceivedConfirm(false)}
                className="flex-1 py-4 bg-slate-50 text-slate-500 rounded-2xl font-black uppercase tracking-widest text-[10px] hover:bg-slate-100 transition-colors"
                disabled={loading}
              >
                No aún
              </button>
              <button
                onClick={async () => {
                  try {
                    setLoading(true);
                    await updateOrderStatus(orderId, 'delivered');
                    const updatedOrder = await getOrder(orderId);
                    if (updatedOrder) setOrder(updatedOrder);
                    setShowReceivedConfirm(false);
                  } catch (error) {
                    alert('Hubo un error. Intenta de nuevo.');
                  } finally {
                    setLoading(false);
                  }
                }}
                className="flex-1 py-4 bg-blue-600 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all flex items-center justify-center"
                disabled={loading}
              >
                {loading ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Comprobante Premium */}
      {showReceiptModal && order.payment?.receiptImageUrl && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-gray-900/90 backdrop-blur-md p-4 animate-in fade-in duration-300"
          onClick={() => setShowReceiptModal(false)}
        >
          <div className="relative max-w-2xl w-full bg-white rounded-[32px] overflow-hidden shadow-2xl animate-in zoom-in-95 duration-300" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-black text-gray-900 uppercase tracking-widest text-xs">Comprobante de pago</h3>
              <button onClick={() => setShowReceiptModal(false)} className="w-10 h-10 rounded-xl bg-gray-50 text-gray-400 flex items-center justify-center hover:bg-gray-100 transition-colors">
                <i className="bi bi-x-lg"></i>
              </button>
            </div>
            <div className="p-4 max-h-[70vh] overflow-auto">
              <img src={order.payment.receiptImageUrl} alt="Comprobante" className="w-full h-auto rounded-2xl shadow-inner border border-gray-50" />
            </div>
            <div className="p-6 bg-gray-50 flex gap-3">
              <button
                onClick={() => window.open(order.payment.receiptImageUrl, '_blank')}
                className="flex-1 py-4 bg-blue-600 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] flex items-center justify-center gap-2 shadow-lg shadow-blue-200 hover:scale-[1.02] active:scale-95 transition-all"
              >
                <i className="bi bi-box-arrow-up-right"></i>
                Expandir imagen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}