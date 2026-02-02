"use client"

import React, { useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { getOrder, getBusiness, getDelivery, saveBusinessRating, hasOrderBeenRated, updateOrderStatus, createRatingNotification, generateReferralLink, trackReferralClick, generateProductSlug, getAllBusinesses } from '@/lib/database'
import { GOOGLE_MAPS_API_KEY } from '@/components/GoogleMap'
import { sendOrderToStore } from '@/components/WhatsAppUtils'
import { useAuth } from '@/contexts/AuthContext'

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
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [reviewSubmitted, setReviewSubmitted] = useState(false)
  const [orderRated, setOrderRated] = useState(false)

  // Estados para tracking del delivery
  const [deliveryLocation, setDeliveryLocation] = useState<{ lat: number; lng: number } | null>(null)
  const [estimatedArrival, setEstimatedArrival] = useState<number | null>(null) // minutos

  // Estados para recomendaciones
  const { user: clientUser } = useAuth()
  const [referralModalOpen, setReferralModalOpen] = useState(false)
  const [selectedProductForReferral, setSelectedProductForReferral] = useState<any>(null)
  const [generatedReferralLink, setGeneratedReferralLink] = useState<string>('')
  const [otherBusinesses, setOtherBusinesses] = useState<any[]>([])


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
      // Usar el nombre del cliente de la orden (customer.name)
      const clientNameToUse = order.customer?.name || 'Cliente';
      // Usar el teléfono del cliente de la orden (customer.phone)
      const clientPhone = order.customer?.phone || '';

      await saveBusinessRating(
        order.businessId,
        orderId,
        rating,
        review,
        {
          name: clientNameToUse,
          phone: clientPhone
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
    if (!orderId) return

    let unsubscribe: (() => void) | null = null

    const setupListener = async () => {
      setLoading(true)
      setError(null)

      try {
        const { db } = await import('@/lib/firebase')
        const { doc, onSnapshot } = await import('firebase/firestore')

        const orderRef = doc(db, 'orders', orderId)

        unsubscribe = onSnapshot(
          orderRef,
          async (snapshot) => {
            if (!snapshot.exists()) {
              setError('Orden no encontrada')
              setLoading(false)
              return
            }

            const data = { id: snapshot.id, ...snapshot.data() } as any
            setOrder(data)

            // Cargar información del negocio si no está cargada
            if (data.businessId && !business) {
              try {
                const businessData = await getBusiness(data.businessId)
                setBusiness(businessData)
              } catch (businessError) {
                console.error('Error loading business:', businessError)
              }
            }

            // Cargar información del repartidor si existe
            if (data.delivery?.assignedDelivery) {
              try {
                const deliveryData = await getDelivery(data.delivery.assignedDelivery)
                setDeliveryPerson(deliveryData)
              } catch (deliveryError) {
                console.error('Error loading delivery person:', deliveryError)
              }
            } else {
              setDeliveryPerson(null)
            }

            setLoading(false)
          },
          (error) => {
            console.error('Error en listener de orden:', error)
            setError('Error al cargar la orden')
            setLoading(false)
          }
        )
      } catch (e: any) {
        console.error('Error setting up listener:', e)
        setError('Error al cargar la orden')
        setLoading(false)
      }
    }

    setupListener()

    return () => {
      if (unsubscribe) unsubscribe()
    }
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

  // Listener para la ubicación del delivery y cálculo de ETA
  useEffect(() => {
    if (!order?.delivery?.assignedDelivery || order.status !== 'on_way') {
      setEstimatedArrival(null)
      setDeliveryLocation(null)
      return
    }

    let unsubscribe: (() => void) | null = null

    const startTracking = async () => {
      try {
        const { db } = await import('@/lib/firebase')
        const { doc, onSnapshot } = await import('firebase/firestore')
        const { calculateETASimple } = await import('@/lib/eta-utils')

        const deliveryRef = doc(db, 'deliveries', order.delivery.assignedDelivery)

        unsubscribe = onSnapshot(deliveryRef, async (snapshot) => {
          if (!snapshot.exists()) return

          const data = snapshot.data()
          if (data.currentLocation) {
            setDeliveryLocation(data.currentLocation)

            // Calcular ETA si tenemos el destino
            if (order.delivery?.latlong) {
              const eta = calculateETASimple(
                data.currentLocation,
                order.delivery.latlong
              )
              setEstimatedArrival(eta)
            }
          }
        })
      } catch (error) {
        console.error('Error setting up delivery tracking:', error)
      }
    }

    startTracking()

    return () => {
      if (unsubscribe) unsubscribe()
    }
  }, [order?.delivery?.assignedDelivery, order?.status, order?.delivery?.latlong])

  // Cargar otras tiendas para descubrimiento
  useEffect(() => {
    const loadOtherBusinesses = async () => {
      try {
        const all = await getAllBusinesses();
        const filtered = all
          .filter(b => b.id !== order?.businessId && !b.isHidden)
          .sort(() => 0.5 - Math.random())
          .slice(0, 4);
        setOtherBusinesses(filtered);
      } catch (error) {
        console.error('Error loading other businesses:', error);
      }
    };

    if (order?.businessId) {
      loadOtherBusinesses();
    }
  }, [order?.businessId]);

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

  // Función para obtener el mensaje de estado con emoji
  const getStatusMessage = (status: string) => {
    const businessName = business?.name || 'El negocio'
    const messages: { [key: string]: { text: string; emoji: string } } = {
      'pending': { text: `${businessName} ha recibido tu pedido`, emoji: '📋' },
      'confirmed': { text: `¡${businessName} confirmó tu pedido!`, emoji: '✅' },
      'preparing': { text: `${businessName} está preparando tu pedido`, emoji: '👨‍🍳' },
      'ready': { text: '¡Tu pedido está listo!', emoji: '🎉' },
      'on_way': { text: 'Tu pedido va en camino', emoji: '🚴' },
      'delivered': { text: '¡Pedido entregado!', emoji: '🎊' },
      'cancelled': { text: 'Pedido cancelado', emoji: '❌' }
    }
    return messages[status] || { text: 'Estado del pedido', emoji: '📦' }
  }

  const statusMessage = getStatusMessage(order.status)

  const handleGenerateReferral = async (item: any) => {
    if (!business?.id) return

    try {
      const productData = {
        id: item.productId || item.id,
        name: item.product?.name || item.name,
        image: item.product?.image || item.image || business.image,
        slug: item.product?.slug || item.slug || generateProductSlug(business.username, item.productId || item.id)
      }

      const code = await generateReferralLink(
        productData.id,
        business.id,
        clientUser?.id || undefined,
        productData.name,
        productData.image,
        business.name,
        business.username,
        productData.slug
      )

      const referralUrl = `${window.location.origin}/${business.username}/${productData.slug}?ref=${code}`

      // Guardar estados para el modal de incentivo
      setGeneratedReferralLink(referralUrl)
      setSelectedProductForReferral(productData)

      // Enviar directamente a WhatsApp
      const text = `¡Mira este producto de ${business.name}! ${productData.name} - ${referralUrl}`
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank')

      // Abrir modal de incentivo
      setReferralModalOpen(true)
    } catch (error) {
      console.error('Error generating referral:', error)
      alert('Error al generar link de referido')
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white pb-8">
      {/* Referral/Incentive Modal */}
      <ReferralModal
        isOpen={referralModalOpen}
        onClose={() => setReferralModalOpen(false)}
        product={selectedProductForReferral}
        referralLink={generatedReferralLink}
        businessName={business?.name || ''}
      />
      {/* Header Principal con Estado Dinámico */}
      <div className={`relative overflow-hidden ${order.status === 'delivered' ? 'bg-gradient-to-br from-emerald-500 to-green-600' :
        order.status === 'on_way' ? 'bg-gradient-to-br from-blue-500 to-cyan-600' :
          order.status === 'preparing' ? 'bg-gradient-to-br from-orange-500 to-amber-600' :
            order.status === 'cancelled' ? 'bg-gradient-to-br from-red-500 to-rose-600' :
              'bg-gradient-to-br from-red-500 to-rose-600'
        }`}>
        {/* Decoraciones de fondo */}
        <div className="absolute top-0 right-0 w-40 h-40 bg-white/10 rounded-full -translate-y-1/2 translate-x-1/2"></div>
        <div className="absolute bottom-0 left-0 w-32 h-32 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/2"></div>

        <div className="max-w-md mx-auto px-4 py-6 relative z-10">
          {/* Foto del negocio + Estado */}
          <div className="flex items-center gap-4">
            {/* Foto redonda del negocio */}
            {business?.image ? (
              <img
                src={business.image}
                alt={business.name}
                className="w-16 h-16 rounded-full object-cover border-4 border-white/30 shadow-xl flex-shrink-0"
              />
            ) : (
              <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center border-4 border-white/30 flex-shrink-0">
                <i className="bi bi-shop text-2xl text-white"></i>
              </div>
            )}

            {/* Estado del pedido */}
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-3xl">{statusMessage.emoji}</span>
              </div>
              <h1 className="text-xl font-black text-white leading-tight">
                {statusMessage.text}
              </h1>
            </div>
          </div>

          {/* Total del pedido - con lógica de pago */}
          <div className="mt-5 bg-white/20 backdrop-blur-sm rounded-2xl px-5 py-4">
            {order.payment?.method === 'transfer' ? (
              // Transferencia: mostrar "Pagado"
              <div className="flex items-center justify-center gap-3">
                <div className="w-10 h-10 bg-white/30 rounded-full flex items-center justify-center">
                  <i className="bi bi-check-lg text-white text-xl"></i>
                </div>
                <div>
                  <p className="text-white/70 text-xs font-bold uppercase tracking-wider">Estado del pago</p>
                  <p className="text-xl font-black text-white">Pagado ✓</p>
                </div>
              </div>
            ) : order.payment?.method === 'mixed' ? (
              // Mixto: mostrar el restante
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-white/70 text-xs font-bold uppercase tracking-wider mb-1">Restante a pagar</p>
                  <p className="text-2xl font-black text-white">
                    ${(order.total - (order.payment?.transferAmount || 0)).toFixed(2)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-white/60 text-[10px] font-medium">Transferido</p>
                  <p className="text-white/80 text-sm font-bold">${order.payment?.transferAmount?.toFixed(2) || '0.00'}</p>
                </div>
              </div>
            ) : (
              // Efectivo: mostrar total normal
              <div className="text-center">
                <p className="text-white/70 text-xs font-bold uppercase tracking-wider mb-1">Total a pagar</p>
                <p className="text-3xl font-black text-white">${order.total?.toFixed(2)}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-md mx-auto px-4 -mt-4 space-y-4 relative z-20">
        {/* Contador de tiempo */}
        {timeInfo !== null && (
          <div className={`relative overflow-hidden rounded-3xl p-5 border shadow-lg transition-all duration-500 ${timeInfo.isLate
            ? 'bg-red-50 border-red-100'
            : 'bg-white border-gray-100'
            }`}>
            <div className={`relative z-10 flex items-center justify-between`}>
              <div>
                {order.status === 'on_way' && estimatedArrival ? (
                  <>
                    <p className="text-[10px] font-bold uppercase tracking-widest mb-1 text-blue-500">
                      🚴 Tu delivery está en camino
                    </p>
                    <p className="text-3xl font-black tracking-tight text-blue-600">
                      {estimatedArrival} min
                    </p>
                    <p className="text-xs text-gray-500 font-medium mt-1">
                      Tiempo estimado de llegada
                    </p>
                  </>
                ) : (
                  <>
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
                  </>
                )}
              </div>
              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-2xl ${timeInfo.isLate ? 'bg-red-100 text-red-600' :
                (order.status === 'on_way' && estimatedArrival ? 'bg-blue-100 text-blue-600' : 'bg-orange-50 text-orange-500')
                }`}>
                <i className={`bi ${timeInfo.isLate ? 'bi-exclamation-triangle' :
                  (order.status === 'on_way' && estimatedArrival ? 'bi-bicycle' : 'bi-clock-history')
                  }`}></i>
              </div>
            </div>
          </div>
        )}

        {/* Información del Delivery */}
        {order.delivery && order.delivery.type !== 'pickup' && (
          <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-5">
            <h3 className="font-black text-gray-900 uppercase tracking-widest text-[10px] mb-4 flex items-center gap-2">
              <i className="bi bi-truck text-red-500"></i>
              Información del repartidor
            </h3>

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
              // Solo mostrar "Buscando repartidor" si el pedido no está entregado ni cancelado
              !['delivered', 'cancelled'].includes(order.status) ? (
                <div className="flex items-center gap-4 py-2">
                  <div className="w-14 h-14 bg-slate-50 rounded-2xl flex items-center justify-center relative overflow-hidden text-blue-500">
                    <i className="bi bi-search text-xl animate-pulse"></i>
                  </div>
                  <div>
                    <p className="text-sm font-black text-gray-900 leading-tight">Buscando repartidor</p>
                    <p className="text-xs text-gray-400 font-medium mt-0.5">Conectando con repartidores cercanos...</p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-4 py-2">
                  <div className="w-14 h-14 bg-gray-50 rounded-2xl flex items-center justify-center text-gray-300">
                    <i className="bi bi-person-x text-xl"></i>
                  </div>
                  <div>
                    <p className="text-sm font-black text-gray-400 leading-tight">Sin repartidor asignado</p>
                  </div>
                </div>
              )
            )}

            {/* Dirección de entrega */}
            {order.delivery?.references && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-xl bg-red-50 flex items-center justify-center text-red-500 flex-shrink-0">
                    <i className="bi bi-geo-alt"></i>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">Dirección</p>
                    <p className="text-sm font-bold text-gray-900 leading-snug">{order.delivery.references}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Productos Comprados */}
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-5">
          <h3 className="font-black text-gray-900 uppercase tracking-widest text-[10px] mb-4 flex items-center gap-2">
            <i className="bi bi-bag-check text-red-500"></i>
            Tu pedido
          </h3>

          <div className="space-y-3">
            {order.items?.map((item: any, index: number) => (
              <div key={index} className="flex items-center gap-3 p-3 bg-gray-50 rounded-2xl">
                {/* Imagen del producto */}
                <div className="w-16 h-16 rounded-xl overflow-hidden bg-gray-200 flex-shrink-0">
                  {(item.product?.image || item.image || business?.image) ? (
                    <img
                      src={item.product?.image || item.image || business?.image}
                      alt={item.variant || item.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-400">
                      <i className="bi bi-box text-xl"></i>
                    </div>
                  )}
                </div>

                {/* Info del producto */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-900 leading-tight truncate">
                    {item.variant || item.product?.name || item.name || 'Producto'}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {item.quantity}x ${item.price?.toFixed(2)}
                  </p>
                </div>

                {/* Subtotal */}
                <div className="flex flex-col items-end gap-2">
                  <p className="text-sm font-black text-gray-900 leading-none">${(item.quantity * item.price)?.toFixed(2)}</p>

                  {/* Solo mostrar botón de recomendar si no es un regalo (precio > 0) */}
                  {item.price > 0 && (
                    <button
                      onClick={() => handleGenerateReferral(item)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-600 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-emerald-100 transition-all active:scale-95 whitespace-nowrap"
                    >
                      <i className="bi bi-whatsapp"></i>
                      Recomendar
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Resumen */}
          <div className="mt-4 pt-4 border-t border-gray-100 space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-xs text-gray-500">Subtotal</span>
              <span className="text-sm font-bold text-gray-700">${order.subtotal?.toFixed(2)}</span>
            </div>
            {order.delivery?.deliveryCost > 0 && (
              <div className="flex justify-between items-center">
                <span className="text-xs text-gray-500">Envío</span>
                <span className="text-sm font-bold text-gray-700">${order.delivery?.deliveryCost?.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between items-center pt-2 border-t border-dashed border-gray-200">
              <span className="text-sm font-black text-gray-900">Total</span>
              <span className="text-lg font-black text-red-600">${order.total?.toFixed(2)}</span>
            </div>
          </div>
        </div>


        {/* Sección de Calificación */}
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

        {/* Mensaje de calificación enviada */}
        {(reviewSubmitted || orderRated) && (
          <div className="bg-emerald-50 border border-emerald-100 rounded-3xl p-6 text-center">
            <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto mb-4 text-2xl">
              <i className="bi bi-patch-check-fill"></i>
            </div>
            <h3 className="font-black text-emerald-900 mb-1">¡Gracias por calificar!</h3>
            <p className="text-xs text-emerald-700 font-medium">Tu opinión ayuda mucho a mejorar nuestro servicio.</p>
          </div>
        )}

        {/* Botones de Acción */}
        <div className="space-y-3 pt-2">
          {(order.status === 'pending' || order.status === 'confirmed') && (
            <button
              onClick={() => business && sendOrderToStore(order, business)}
              className="w-full bg-white border-2 border-green-500 text-green-600 font-black uppercase tracking-widest text-xs py-4 rounded-2xl flex items-center justify-center gap-3 transition-all hover:bg-green-50 active:scale-95 shadow-sm"
            >
              <i className="bi bi-whatsapp text-lg"></i>
              Obtener comprobante
            </button>
          )}

          {order.status !== 'delivered' && order.status !== 'cancelled' && (
            <button
              onClick={() => setShowReceivedConfirm(true)}
              className="w-full bg-blue-600 text-white font-black uppercase tracking-widest text-xs py-4 rounded-2xl flex items-center justify-center gap-3 transition-all hover:bg-blue-700 shadow-lg shadow-blue-200 active:scale-95"
            >
              <i className="bi bi-check-lg text-lg"></i>
              Ya recibí mi pedido
            </button>
          )}

          {/* Link para visitar la tienda */}
          {business?.username && (
            <a
              href={`/${business.username}`}
              className="w-full bg-gray-100 text-gray-700 font-bold text-sm py-4 rounded-2xl flex items-center justify-center gap-2 transition-all hover:bg-gray-200 active:scale-95"
            >
              <i className="bi bi-shop"></i>
              Visitar {business.name}
            </a>
          )}

          {/* Sección Descubre otras tiendas */}
          {otherBusinesses.length > 0 && (
            <div className="pt-8 pb-4">
              <div className="flex items-center gap-2 mb-6 ml-2">
                <div className="w-8 h-8 rounded-xl bg-red-50 text-red-500 flex items-center justify-center">
                  <i className="bi bi-compass"></i>
                </div>
                <div>
                  <h3 className="text-sm font-black text-gray-900 uppercase tracking-widest">Descubre otras tiendas</h3>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">Seleccionadas para ti</p>
                </div>
              </div>

              <div className="flex gap-4 overflow-x-auto pb-6 scrollbar-hide -mx-4 px-4">
                {otherBusinesses.map((biz) => (
                  <a
                    key={biz.id}
                    href={`/${biz.username}`}
                    className="flex-shrink-0 w-32 group bg-white rounded-[32px] p-4 border border-gray-100 shadow-sm hover:border-red-500 hover:shadow-md transition-all active:scale-95 text-center"
                  >
                    <div className="w-16 h-16 rounded-full overflow-hidden mx-auto mb-3 bg-gray-50 border border-gray-50 group-hover:border-red-100 transition-colors shadow-inner">
                      {biz.image ? (
                        <img src={biz.image} alt={biz.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-300">
                          <i className="bi bi-shop text-2xl"></i>
                        </div>
                      )}
                    </div>
                    <h4 className="text-[11px] font-black text-gray-900 line-clamp-2 uppercase tracking-tight mb-2 min-h-[2.5rem] flex items-center justify-center leading-tight">
                      {biz.name}
                    </h4>
                    {biz.ratingAverage > 0 && (
                      <div className="flex items-center justify-center gap-1 text-[9px] font-black text-yellow-500 bg-yellow-50 w-fit mx-auto px-2 py-0.5 rounded-full uppercase tracking-widest">
                        <i className="bi bi-star-fill"></i>
                        {biz.ratingAverage.toFixed(1)}
                      </div>
                    )}
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modal de confirmación */}
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

      {/* Modal Comprobante */}
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

function ReferralModal({
  isOpen,
  onClose,
  product,
  referralLink,
  businessName
}: {
  isOpen: boolean
  onClose: () => void
  product: any
  referralLink: string
  businessName: string
}) {
  const [copied, setCopied] = useState(false)
  if (!isOpen || !product) return null
  const handleCopy = async () => {
    try {
      if (navigator.clipboard) await navigator.clipboard.writeText(referralLink)
      else {
        const textArea = document.createElement('textarea')
        textArea.value = referralLink
        document.body.appendChild(textArea)
        textArea.select()
        document.execCommand('copy')
        document.body.removeChild(textArea)
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) { console.error('Error copying:', err) }
  }
  const shareOnWhatsApp = () => {
    const text = `¡Mira este producto de ${businessName}! ${product.name} - ${referralLink}`
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank')
  }
  return (
    <div className="fixed inset-0 z-[200] overflow-hidden">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="flex items-center justify-center min-h-screen p-4">
        <div className="relative w-full max-w-md bg-white rounded-[40px] shadow-2xl p-8 animate-in fade-in zoom-in duration-300 border border-emerald-100 border-t-8 border-t-emerald-500 max-h-[90vh] overflow-y-auto custom-scrollbar">
          <button onClick={onClose} className="absolute top-6 right-6 w-10 h-10 bg-gray-50 text-gray-400 flex items-center justify-center rounded-full hover:bg-gray-100 transition-all z-10">
            <i className="bi bi-x-lg"></i>
          </button>
          <div className="text-center mb-8">
            <div className="w-20 h-20 bg-emerald-100 rounded-3xl flex items-center justify-center mx-auto mb-6 transform -rotate-6">
              <i className="bi bi-whatsapp text-emerald-600 text-4xl"></i>
            </div>
            <h3 className="text-3xl font-black text-gray-900 mb-3 leading-tight">¡WhatsApp <br /> Enviado!</h3>
            <p className="text-gray-500 text-sm font-medium">
              Asegúrate de enviarlo a tus grupos. <br /> Ganarás <span className="text-emerald-600 font-bold">$1 de crédito</span> si compran
            </p>
          </div>
          <div className="bg-slate-50 rounded-3xl p-5 mb-8 border border-slate-100">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-16 h-16 rounded-2xl overflow-hidden shadow-sm border-2 border-white flex-shrink-0">
                <img src={product.image || '/placeholder.png'} alt={product.name} className="w-full h-full object-cover" />
              </div>
              <div className="flex-1 min-w-0 text-left">
                <h4 className="font-black text-gray-900 text-sm truncate uppercase tracking-tight">{product.name}</h4>
                <p className="text-emerald-600 text-[10px] font-black uppercase tracking-widest mt-0.5">Producto Recomendado</p>
              </div>
            </div>
            <div className="bg-white rounded-2xl p-4 border border-slate-200/50 shadow-inner">
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1 ml-1 text-center">Tu link mágico</p>
              <p className="text-[11px] text-gray-400 break-all font-mono leading-tight text-center">{referralLink}</p>
            </div>
          </div>
          <button onClick={handleCopy} className="w-full py-5 bg-emerald-600 text-white font-black uppercase tracking-widest text-xs rounded-2xl hover:bg-emerald-700 transition-all mb-4 flex items-center justify-center gap-3 shadow-xl active:scale-95 shadow-emerald-200">
            <i className={`bi ${copied ? 'bi-check-lg' : 'bi-clipboard-check'} text-lg`}></i>
            {copied ? '¡ENLACE COPIADO!' : 'COPIAR ENLACE OTRA VEZ'}
          </button>

          <div className="space-y-3">
            <button onClick={shareOnWhatsApp} className="w-full py-4 bg-white text-emerald-600 border-2 border-emerald-600 font-black uppercase tracking-widest text-[10px] rounded-2xl hover:bg-emerald-50 transition-all flex items-center justify-center gap-2 active:scale-95 font-bold">
              <i className="bi bi-whatsapp"></i> REINTENTAR WHATSAPP
            </button>

            <button
              onClick={() => window.location.href = '/profile?tab=recommendations'}
              className="w-full py-4 bg-slate-100 text-slate-600 font-black uppercase tracking-widest text-[10px] rounded-2xl hover:bg-slate-200 transition-all flex items-center justify-center gap-2 active:scale-95"
            >
              <i className="bi bi-gift-fill"></i> VER MIS RECOMENDACIONES
            </button>
          </div>

          <p className="text-center text-gray-400 text-[9px] font-bold uppercase tracking-widest mt-6">Comparte y ayuda a este negocio</p>
        </div>
      </div>
    </div>
  )
}
