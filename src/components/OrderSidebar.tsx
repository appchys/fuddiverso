'use client'

import { useEffect, useState } from 'react'
import { db } from '@/lib/firebase'
import { doc, onSnapshot, updateDoc, collection, query, where, getDocs, addDoc } from 'firebase/firestore'
import {
  getBusiness,
  getDelivery,
  saveBusinessRating,
  getOrderRating,
  createRatingNotification,
  createProductRatingNotification,
  ProductRating,
  BusinessRating,
  updateBusinessRatingStats
} from '@/lib/database'
import { useAuth } from '@/contexts/AuthContext'
import { formatPrice } from '@/lib/price-utils'
import { calculateETASimple } from '@/lib/eta-utils'
import { GOOGLE_MAPS_API_KEY } from '@/components/GoogleMap'

interface OrderSidebarProps {
  isOpen: boolean
  onClose: () => void
  orderId: string | null
}

const STATUS_STEPS = [
  { status: 'pending', label: 'Recibido', desc: 'Tu pedido fue recibido y está en espera.', icon: 'bi-clipboard-check' },
  { status: 'confirmed', label: 'Confirmado', desc: '¡El negocio confirmó tu pedido!', icon: 'bi-check-circle' },
  { status: 'preparing', label: 'Preparando', desc: 'Estamos preparando tus productos.', icon: 'bi-fire' },
  { status: 'ready', label: 'Listo', desc: 'Tu pedido está listo.', icon: 'bi-box-seam' },
  { status: 'on_way', label: 'En Camino', desc: 'Tu pedido va rumbo a tu dirección.', icon: 'bi-bicycle' },
  { status: 'delivered', label: 'Entregado', desc: '¡Pedido entregado con éxito!', icon: 'bi-house-heart' },
  { status: 'cancelled', label: 'Cancelado', desc: 'El pedido fue cancelado.', icon: 'bi-x-circle' }
]

export default function OrderSidebar({ isOpen, onClose, orderId }: OrderSidebarProps) {
  const { user: clientUser } = useAuth()
  
  // Estados principales de datos
  const [order, setOrder] = useState<any | null>(null)
  const [business, setBusiness] = useState<any | null>(null)
  const [deliveryPerson, setDeliveryPerson] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  // Estados de UI
  const [activeTab, setActiveTab] = useState<'tracking' | 'rate'>('tracking')
  const [deliveryLocation, setDeliveryLocation] = useState<{ lat: number; lng: number } | null>(null)
  const [estimatedArrival, setEstimatedArrival] = useState<number | null>(null)
  const [showReceiptModal, setShowReceiptModal] = useState(false)
  
  // Estados de Calificaciones
  const [existingRating, setExistingRating] = useState<BusinessRating | null>(null)
  const [generalRating, setGeneralRating] = useState<number>(0)
  const [generalHover, setGeneralHover] = useState<number>(0)
  const [generalComment, setGeneralComment] = useState<string>('')
  const [productRatings, setProductRatings] = useState<{ [productId: string]: { rating: number; hover: number; comment: string } }>({})
  const [isSubmittingStoreRating, setIsSubmittingStoreRating] = useState(false)
  const [submittingProducts, setSubmittingProducts] = useState<{ [productId: string]: boolean }>({})

  // Obtener los minutos estimados restantes hasta la entrega programada
  const getMinutesUntilDelivery = () => {
    if (!order || ['delivered', 'cancelled'].includes(order.status)) {
      return null;
    }
    if (!order.timing) {
      return null;
    }
    const { scheduledDate, scheduledTime } = order.timing;
    if (scheduledTime && !/^\d{1,2}:\d{2}$/.test(scheduledTime)) {
      return null;
    }
    try {
      const now = new Date();
      let deliveryTime: Date;

      if (scheduledDate && typeof scheduledDate === 'object' && 'seconds' in scheduledDate) {
        const timestampMs = scheduledDate.seconds * 1000 + (scheduledDate.nanoseconds || 0) / 1000000;
        deliveryTime = new Date(timestampMs);

        if (scheduledTime) {
          const [hours, minutes] = scheduledTime.split(':').map(Number);
          deliveryTime.setHours(hours, minutes, 0, 0);
        }
      } else if (scheduledTime) {
        deliveryTime = new Date();
        const [hours, minutes] = scheduledTime.split(':').map(Number);
        deliveryTime.setHours(hours, minutes, 0, 0);

        if (deliveryTime < now) {
          deliveryTime.setDate(deliveryTime.getDate() + 1);
        }
      } else {
        return null;
      }

      const diffMs = deliveryTime.getTime() - now.getTime();
      const diffMinutes = Math.floor(diffMs / (1000 * 60));
      const absMinutes = Math.abs(diffMinutes);

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

      return {
        totalMinutes: absMinutes,
        timeDisplay: formatTimeDisplay(absMinutes),
        isLate: diffMs < 0,
        deliveryTime: deliveryTime.toLocaleTimeString('es-EC', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        })
      };
    } catch (error) {
      console.error('Error al calcular tiempo de entrega:', error);
      return null;
    }
  };

  // Obtener solo los pasos de la línea de tiempo por los que realmente pasó la orden
  const getDynamicTimelineSteps = () => {
    if (!order) return []

    const activeSteps: any[] = []

    STATUS_STEPS.forEach(step => {
      const timestamp = order.statusHistory?.[`${step.status}At`]
      const isCurrent = order.status === step.status

      if (timestamp || isCurrent) {
        let timeMs = Date.now() // fallback para estado actual si no hay timestamp en DB todavía
        if (timestamp) {
          if (typeof timestamp === 'object' && 'seconds' in timestamp) {
            timeMs = timestamp.seconds * 1000 + (timestamp.nanoseconds || 0) / 1000000
          } else {
            timeMs = new Date(timestamp).getTime()
          }
        }

        activeSteps.push({
          ...step,
          timestamp,
          timeMs,
          isCurrent
        })
      }
    })

    // Ordenar de más antiguo a más reciente (menor a mayor ms)
    activeSteps.sort((a, b) => a.timeMs - b.timeMs)

    // Marcar cuál es el estado actual basándonos en el último elemento
    if (activeSteps.length > 0) {
      activeSteps.forEach((step, index) => {
        step.isCurrent = index === activeSteps.length - 1
        step.isDone = true
      })

      // CASO ESPECIAL: Si el pedido está "pending" (Recibido), mostramos Confirmado inactivo abajo
      const lastStep = activeSteps[activeSteps.length - 1]
      if (lastStep.status === 'pending') {
        activeSteps.push({
          status: 'confirmed',
          label: 'Confirmado',
          desc: 'Esperando que el negocio confirme tu pedido...',
          icon: 'bi-check-circle',
          isCurrent: false,
          isDone: false,
          timestamp: null
        })
        
        lastStep.isCurrent = true
        lastStep.isDone = true
      }
    }

    return activeSteps
  }

  // Formatear hora de cada paso del timeline
  const formatStepTime = (timestamp: any) => {
    if (!timestamp) return ''
    try {
      let date: Date
      if (typeof timestamp === 'object' && 'seconds' in timestamp) {
        date = new Date(timestamp.seconds * 1000)
      } else {
        date = new Date(timestamp)
      }
      return date.toLocaleTimeString('es-EC', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      })
    } catch (e) {
      return ''
    }
  }

  // Bloquear el scroll del body al abrir el sidebar
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  // Listener para la Orden en tiempo real
  useEffect(() => {
    if (!orderId || !isOpen) return

    let unsubscribe: (() => void) | null = null

    const setupOrderListener = async () => {
      setLoading(true)
      setError(null)
      try {
        const orderRef = doc(db, 'orders', orderId)
        unsubscribe = onSnapshot(
          orderRef,
          async (snapshot) => {
            if (!snapshot.exists()) {
              setError('Pedido no encontrado')
              setLoading(false)
              return
            }

            const orderData = { id: snapshot.id, ...snapshot.data() } as any
            setOrder(orderData)

            // Cargar información del negocio si no está cargada
            if (orderData.businessId) {
              try {
                const businessData = await getBusiness(orderData.businessId)
                setBusiness(businessData)

                // Buscar si la orden ya tiene calificación
                const ratingData = await getOrderRating(orderData.businessId, orderId)
                if (ratingData) {
                  setExistingRating(ratingData)
                  // Si ya fue calificada, iniciar en la pestaña de calificar
                  setActiveTab('rate')
                } else if (orderData.status === 'delivered') {
                  // Si no está calificada y ya se entregó, sugerir calificar
                  setActiveTab('rate')
                }
              } catch (e) {
                console.error('Error cargando datos del negocio:', e)
              }
            }

            // Cargar datos de repartidor
            if (orderData.delivery?.assignedDelivery) {
              try {
                const deliveryData = await getDelivery(orderData.delivery.assignedDelivery)
                setDeliveryPerson(deliveryData)
              } catch (e) {
                console.error('Error cargando repartidor:', e)
              }
            } else {
              setDeliveryPerson(null)
            }

            setLoading(false)
          },
          (err) => {
            console.error('Error en snapshot del pedido:', err)
            setError('Error al conectar con la base de datos')
            setLoading(false)
          }
        )
      } catch (e) {
        console.error('Error setting up order snapshot:', e)
        setError('Error al iniciar el seguimiento')
        setLoading(false)
      }
    }

    setupOrderListener()

    return () => {
      if (unsubscribe) unsubscribe()
    }
  }, [orderId, isOpen])

  // Listener para la ubicación del delivery en tiempo real (si está en camino)
  useEffect(() => {
    if (!order?.delivery?.assignedDelivery || order.status !== 'on_way' || !isOpen) {
      setDeliveryLocation(null)
      setEstimatedArrival(null)
      return
    }

    let unsubscribe: (() => void) | null = null

    const setupDeliveryListener = async () => {
      try {
        const deliveryRef = doc(db, 'deliveries', order.delivery.assignedDelivery)
        unsubscribe = onSnapshot(deliveryRef, (snapshot) => {
          if (!snapshot.exists()) return
          const data = snapshot.data()
          if (data.currentLocation) {
            setDeliveryLocation(data.currentLocation)

            if (order.delivery?.latlong) {
              const eta = calculateETASimple(data.currentLocation, order.delivery.latlong)
              setEstimatedArrival(eta)
            }
          }
        })
      } catch (e) {
        console.error('Error en snapshot de ubicación de delivery:', e)
      }
    }

    setupDeliveryListener()

    return () => {
      if (unsubscribe) unsubscribe()
    }
  }, [order?.delivery?.assignedDelivery, order?.status, order?.delivery?.latlong, isOpen])

  // Iniciar estados para las calificaciones de los productos cuando se cargue la orden
  useEffect(() => {
    if (order?.items) {
      const initialProductRatings: typeof productRatings = {}
      order.items.forEach((item: any) => {
        const pId = item.productId || item.id
        if (pId) {
          initialProductRatings[pId] = { rating: 0, hover: 0, comment: '' }
        }
      })
      setProductRatings(initialProductRatings)
    }
  }, [order?.items])

  if (!isOpen) return null

  // Copiar link de la orden para compartir
  const handleCopyLink = async () => {
    const orderUrl = `${window.location.origin}/o/${orderId}`
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(orderUrl)
        alert('Enlace copiado al portapapeles 📋')
      } else {
        const textArea = document.createElement('textarea')
        textArea.value = orderUrl
        textArea.style.position = 'fixed'
        textArea.style.opacity = '0'
        document.body.appendChild(textArea)
        textArea.focus()
        textArea.select()
        document.execCommand('copy')
        document.body.removeChild(textArea)
        alert('Enlace copiado al portapapeles 📋')
      }
    } catch (e) {
      console.error('Error al copiar enlace:', e)
    }
  }

  // Manejar cambio de estrellas de productos individuales
  const handleProductRatingChange = (productId: string, ratingValue: number) => {
    setProductRatings(prev => ({
      ...prev,
      [productId]: {
        ...prev[productId],
        rating: ratingValue
      }
    }))
  }

  // Manejar hover de estrellas de productos
  const handleProductRatingHover = (productId: string, hoverValue: number) => {
    setProductRatings(prev => ({
      ...prev,
      [productId]: {
        ...prev[productId],
        hover: hoverValue
      }
    }))
  }

  // Manejar comentario de producto
  const handleProductCommentChange = (productId: string, text: string) => {
    setProductRatings(prev => ({
      ...prev,
      [productId]: {
        ...prev[productId],
        comment: text
      }
    }))
  }

  // Enviar calificaciones (General y de Productos)
  // Guardar calificación de la tienda de forma independiente
  const handleSaveStoreRating = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!order || !business?.id || generalRating === 0) return

    setIsSubmittingStoreRating(true)
    try {
      const clientInfo = {
        name: order.customer?.name || 'Cliente',
        phone: order.customer?.phone || '',
        email: order.customer?.email || ''
      }

      if (existingRating?.id) {
        // Si ya existe un documento de rating en Firestore, lo actualizamos
        const docRef = doc(db, 'businesses', business.id, 'ratings', existingRating.id)
        await updateDoc(docRef, {
          rating: generalRating,
          comment: generalComment,
          storeRated: true,
          updatedAt: new Date()
        })

        setExistingRating(prev => {
          if (!prev) return null
          return {
            ...prev,
            rating: generalRating,
            comment: generalComment,
            storeRated: true,
            updatedAt: new Date()
          }
        })
      } else {
        // Si no existe, creamos el documento inicial con storeRated: true
        const ratingsRef = await saveBusinessRating(
          business.id,
          orderId!,
          generalRating,
          generalComment,
          clientInfo,
          []
        )

        // Marcar que este documento en Firestore también lleva el flag storeRated
        const docRef = doc(db, 'businesses', business.id, 'ratings', ratingsRef)
        await updateDoc(docRef, {
          storeRated: true
        })

        setExistingRating({
          id: ratingsRef,
          businessId: business.id,
          orderId: orderId!,
          rating: generalRating,
          comment: generalComment,
          storeRated: true,
          clientName: clientInfo.name,
          clientPhone: clientInfo.phone,
          productRatings: [],
          createdAt: new Date(),
          updatedAt: new Date()
        })
      }

      // Crear notificación para el negocio
      await createRatingNotification(
        business.id,
        orderId!,
        generalRating,
        generalComment,
        clientInfo.name,
        clientInfo.phone
      )

      alert('¡Calificación de la tienda guardada! ⭐')
    } catch (e) {
      console.error('Error al calificar la tienda:', e)
      alert('Hubo un error al guardar tu calificación. Inténtalo de nuevo.')
    } finally {
      setIsSubmittingStoreRating(false)
    }
  }

  // Guardar calificación de un producto de forma independiente
  const handleSaveProductRating = async (productId: string, item: any) => {
    if (!order || !business?.id) return
    const itemRating = productRatings[productId]
    if (!itemRating || itemRating.rating === 0) return

    setSubmittingProducts(prev => ({ ...prev, [productId]: true }))
    try {
      const clientInfo = {
        name: order.customer?.name || 'Cliente',
        phone: order.customer?.phone || '',
        email: order.customer?.email || ''
      }

      const newProductRating: ProductRating = {
        productId,
        productName: item.variant || item.name || 'Producto',
        productImage: item.image || item.product?.image || '',
        rating: itemRating.rating,
        comment: itemRating.comment
      }

      const targetBusinessId = item.originalBusinessId || business.id
      let targetRatingId = null
      let targetProductRatings: ProductRating[] = []

      if (targetBusinessId === business.id) {
        targetRatingId = existingRating?.id || null
        targetProductRatings = existingRating?.productRatings || []
      } else {
        const ratingsRef = collection(db, 'businesses', targetBusinessId, 'ratings')
        const q = query(ratingsRef, where('orderId', '==', orderId!))
        const querySnapshot = await getDocs(q)
        if (!querySnapshot.empty) {
          const docDoc = querySnapshot.docs[0]
          targetRatingId = docDoc.id
          targetProductRatings = docDoc.data().productRatings || []
        }
      }

      const updatedProductRatings = [
        ...targetProductRatings.filter(pr => pr.productId !== productId),
        newProductRating
      ]

      if (targetRatingId) {
        const docRef = doc(db, 'businesses', targetBusinessId, 'ratings', targetRatingId)
        await updateDoc(docRef, {
          productRatings: updatedProductRatings,
          updatedAt: new Date()
        })
      } else {
        const ratingsRef = collection(db, 'businesses', targetBusinessId, 'ratings')
        const newDoc = await addDoc(ratingsRef, {
          businessId: targetBusinessId,
          orderId: orderId!,
          rating: 5,
          comment: '',
          storeRated: false,
          clientName: clientInfo.name,
          clientPhone: clientInfo.phone,
          clientEmail: clientInfo.email,
          productRatings: updatedProductRatings,
          createdAt: new Date(),
          updatedAt: new Date()
        })
        targetRatingId = newDoc.id
      }

      if (targetBusinessId === business.id) {
        setExistingRating(prev => {
          if (!prev) return {
            id: targetRatingId!,
            businessId: business.id,
            orderId: orderId!,
            rating: 5,
            comment: '',
            storeRated: false,
            clientName: clientInfo.name,
            clientPhone: clientInfo.phone,
            productRatings: updatedProductRatings,
            createdAt: new Date(),
            updatedAt: new Date()
          }
          return {
            ...prev,
            productRatings: updatedProductRatings,
            updatedAt: new Date()
          }
        })
      }

      // Actualizar estadísticas de calificación del negocio destino
      await updateBusinessRatingStats(targetBusinessId)

      // Crear notificación de calificación de producto para el negocio correspondiente
      await createProductRatingNotification(
        targetBusinessId,
        orderId!,
        item.variant || item.name || 'Producto',
        itemRating.rating,
        itemRating.comment,
        clientInfo.name,
        clientInfo.phone
      )

      alert('¡Calificación de producto guardada! 👍')
    } catch (e) {
      console.error('Error al calificar el producto:', e)
      alert('Hubo un error al guardar tu calificación. Inténtalo de nuevo.')
    } finally {
      setSubmittingProducts(prev => ({ ...prev, [productId]: false }))
    }
  }

  // Helper para traducir e indicar color del badge de estado
  const getStatusBadge = (status: string) => {
    const configs: { [key: string]: { label: string; bg: string; text: string } } = {
      pending: { label: 'Recibido', bg: 'bg-amber-50 border-amber-100', text: 'text-amber-700' },
      confirmed: { label: 'Confirmado', bg: 'bg-blue-50 border-blue-100', text: 'text-blue-700' },
      preparing: { label: 'En Cocina', bg: 'bg-orange-50 border-orange-100', text: 'text-orange-700' },
      ready: { label: '¡Listo!', bg: 'bg-emerald-50 border-emerald-100', text: 'text-emerald-700' },
      on_way: { label: 'En Camino', bg: 'bg-cyan-50 border-cyan-100', text: 'text-cyan-700' },
      delivered: { label: 'Entregado', bg: 'bg-zinc-50 border-zinc-200', text: 'text-zinc-700' },
      cancelled: { label: 'Cancelado', bg: 'bg-red-50 border-red-100', text: 'text-red-700' }
    }
    return configs[status] || { label: status, bg: 'bg-gray-50 border-gray-100', text: 'text-gray-700' }
  }

  return (
    <div className="fixed inset-0 z-[120] overflow-hidden">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300"
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className={`fixed right-0 top-0 h-full w-full sm:w-[480px] bg-slate-50 shadow-2xl transform transition-transform duration-300 ease-in-out z-[130] flex flex-col`}
      >
        {/* Header Glassmorphism */}
        <div className="bg-white/80 backdrop-blur-md border-b border-gray-100 sticky top-0 z-50 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="w-10 h-10 rounded-full flex items-center justify-center text-slate-700 hover:bg-slate-100 transition-colors"
              aria-label="Cerrar"
            >
              <i className="bi bi-chevron-left text-lg"></i>
            </button>
            {business && (
              <div className="flex items-center gap-2.5">
                {business.image ? (
                  <img
                    src={business.image}
                    alt={business.name}
                    className="w-8 h-8 rounded-full object-cover border border-gray-100"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center">
                    <i className="bi bi-shop text-xs text-slate-500"></i>
                  </div>
                )}
                <div>
                  <h3 className="font-extrabold text-sm sm:text-base text-slate-900 leading-none">
                    {business.name}
                  </h3>
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                    Detalle de Pedido
                  </span>
                </div>
              </div>
            )}
          </div>

          <button
            onClick={handleCopyLink}
            className="w-10 h-10 rounded-full flex items-center justify-center text-slate-700 hover:bg-slate-100 transition-colors"
            title="Copiar enlace del pedido"
          >
            <i className="bi bi-share text-base"></i>
          </button>
        </div>

        {/* Carga o Error */}
        {loading ? (
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
            <div className="w-10 h-10 border-4 border-slate-900 border-t-transparent rounded-full animate-spin mb-3"></div>
            <p className="text-slate-500 text-sm">Cargando detalles de tu pedido...</p>
          </div>
        ) : error || !order ? (
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
            <div className="w-12 h-12 bg-red-50 text-red-500 rounded-full flex items-center justify-center text-xl mb-3">
              <i className="bi bi-exclamation-triangle"></i>
            </div>
            <h4 className="font-bold text-slate-800 mb-1">¡Ups! Algo salió mal</h4>
            <p className="text-slate-500 text-sm mb-4">{error || 'No pudimos encontrar la orden'}</p>
            <button
              onClick={onClose}
              className="px-6 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-bold hover:bg-slate-800 transition-colors"
            >
              Cerrar
            </button>
          </div>
        ) : (
          <>
            {/* Tabs Navigation (Pestañas premium) */}
            <div className="bg-white px-4 border-b border-gray-100 flex">
              <button
                onClick={() => setActiveTab('tracking')}
                className={`flex-1 py-3 text-xs sm:text-sm font-black uppercase tracking-widest border-b-2 text-center transition-all ${
                  activeTab === 'tracking'
                    ? 'border-slate-900 text-slate-900'
                    : 'border-transparent text-slate-400 hover:text-slate-600'
                }`}
              >
                Seguimiento 📦
              </button>
              <button
                onClick={() => setActiveTab('rate')}
                className={`flex-1 py-3 text-xs sm:text-sm font-black uppercase tracking-widest border-b-2 text-center transition-all flex items-center justify-center gap-1.5 ${
                  activeTab === 'rate'
                    ? 'border-slate-900 text-slate-900'
                    : 'border-transparent text-slate-400 hover:text-slate-600'
                }`}
              >
                Calificar ⭐️
                {!existingRating && order.status === 'delivered' && (
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-ping"></span>
                )}
              </button>
            </div>

            {/* Contenido con scroll independiente */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              
              {/* TAB 1: SEGUIMIENTO */}
              {activeTab === 'tracking' && (
                <div className="space-y-4">
                  {/* Banner de Estado */}
                  <div className="bg-white rounded-[24px] p-5 border border-gray-100 shadow-sm flex items-center justify-between">
                    <div>
                      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Estado Actual</p>
                      <h4 className="text-xl font-extrabold text-slate-950 mt-0.5">
                        {order.status === 'cancelled'
                          ? 'Pedido Cancelado'
                          : STATUS_STEPS.find(s => s.status === order.status)?.label || order.status}
                      </h4>
                      {order.timing?.scheduledTime && !['delivered', 'cancelled'].includes(order.status) && (
                        <p className="text-xs text-slate-500 font-medium mt-1">
                          Entrega programada: <strong className="text-slate-700">{order.timing.scheduledTime}</strong>
                        </p>
                      )}
                    </div>
                    <span className={`px-3 py-1.5 rounded-full border text-xs font-black uppercase tracking-wider ${getStatusBadge(order.status).bg} ${getStatusBadge(order.status).text}`}>
                      {getStatusBadge(order.status).label}
                    </span>
                  </div>

                  {/* Tarjeta de Tiempo Estimado de Entrega */}
                  {!['delivered', 'cancelled'].includes(order.status) && (
                    <div className="bg-gradient-to-br from-slate-900 to-slate-800 text-white rounded-[24px] p-5 shadow-lg border border-slate-800">
                      <div className="flex items-center justify-between">
                        <div className="space-y-1">
                          <span className="text-[10px] text-slate-400 font-extrabold uppercase tracking-widest block">
                            Tiempo Estimado de Entrega
                          </span>
                          <h4 className="text-2xl font-black tracking-tight">
                            {order.status === 'on_way' && estimatedArrival !== null ? (
                              `Llega en ${estimatedArrival} min`
                            ) : getMinutesUntilDelivery() ? (
                              getMinutesUntilDelivery()?.isLate ? (
                                `Demorado (${getMinutesUntilDelivery()?.timeDisplay})`
                              ) : (
                                `En ${getMinutesUntilDelivery()?.timeDisplay}`
                              )
                            ) : (
                              '30 a 45 minutos'
                            )}
                          </h4>
                          <p className="text-xs text-slate-400 font-medium">
                            {order.status === 'on_way' && estimatedArrival !== null ? (
                              'El repartidor se encuentra en camino a tu ubicación.'
                            ) : getMinutesUntilDelivery() ? (
                              `Entrega programada para las ${getMinutesUntilDelivery()?.deliveryTime}`
                            ) : (
                              'El negocio está preparando tu pedido para entregarlo lo antes posible.'
                            )}
                          </p>
                        </div>
                        <div className="w-12 h-12 rounded-2xl bg-white/10 border border-white/10 flex items-center justify-center text-2xl shadow-inner flex-shrink-0">
                          {order.status === 'on_way' ? '🚴' : '⏰'}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Tarjeta dedicada de Notificaciones de Telegram */}
                  {!order.customer?.telegramChatId && !['delivered', 'cancelled'].includes(order.status) && (
                    <div className="bg-gradient-to-r from-[#229ED9]/10 to-[#229ED9]/5 border border-[#229ED9]/20 rounded-[24px] p-5 shadow-sm space-y-3.5">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-[#229ED9]/20 text-[#229ED9] flex items-center justify-center text-xl flex-shrink-0">
                          <i className="bi bi-telegram"></i>
                        </div>
                        <div>
                          <h6 className="font-extrabold text-slate-900 text-sm leading-none">
                            Alertas por Telegram
                          </h6>
                          <p className="text-[10px] text-slate-500 font-medium mt-1">
                            Recibe notificaciones en tiempo real del estado de tu pedido.
                          </p>
                        </div>
                      </div>
                      <a
                        href={`https://t.me/pedidosfuddi_bot?start=order_${orderId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center gap-2 w-full py-3 bg-[#229ED9] hover:bg-[#1d8fc4] text-white rounded-2xl text-xs font-bold transition-all shadow-md active:scale-95"
                      >
                        <i className="bi bi-telegram text-base"></i>
                        ACTIVAR NOTIFICACIONES
                      </a>
                    </div>
                  )}

                  {/* Timeline vertical dinámico (solo muestra estados reales por los que pasó el pedido) */}
                  {getDynamicTimelineSteps().length > 0 && (
                    <div className="bg-white rounded-[24px] p-5 border border-gray-100 shadow-sm">
                      <h5 className="text-xs text-slate-400 font-black uppercase tracking-wider mb-5">Línea de Tiempo</h5>
                      <div className="relative pl-6 space-y-6">
                        {/* Linea vertical central */}
                        <div className="absolute left-[9px] top-1.5 bottom-1.5 w-0.5 bg-slate-100"></div>

                        {getDynamicTimelineSteps().map((step) => {
                          return (
                            <div key={step.status} className="relative flex gap-4 items-start">
                              {/* Punto marcador */}
                              <div
                                className={`absolute left-[-23px] top-0.5 w-5 h-5 rounded-full border-4 transition-all flex items-center justify-center z-10 ${
                                  step.isCurrent
                                    ? 'bg-slate-900 border-white ring-4 ring-slate-100'
                                    : step.isDone
                                    ? 'bg-slate-900 border-white'
                                    : 'bg-white border-slate-100'
                                }`}
                              >
                                {step.isCurrent && (
                                  <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping"></span>
                                )}
                              </div>

                              <div className="flex-1">
                                <div className="flex justify-between items-start gap-1">
                                  <h6
                                    className={`text-xs font-extrabold uppercase tracking-wide ${
                                      step.isCurrent
                                        ? 'text-slate-950 font-black text-sm'
                                        : step.isDone
                                        ? 'text-slate-800'
                                        : 'text-slate-400'
                                    }`}
                                  >
                                    {step.label}
                                  </h6>
                                  {step.timestamp && (
                                    <span className="text-[10px] text-slate-400 font-bold bg-slate-50 border border-slate-100/50 px-1.5 py-0.5 rounded-md">
                                      {formatStepTime(step.timestamp)}
                                    </span>
                                  )}
                                </div>
                                <p className={`text-xs mt-0.5 leading-snug ${step.isCurrent ? 'text-slate-600 font-medium' : 'text-slate-400'}`}>
                                  {step.desc}
                                </p>
                              </div>
                              <i className={`bi ${step.icon} text-sm ${step.isCurrent ? 'text-slate-950 font-bold' : step.isDone ? 'text-slate-600' : 'text-slate-300'}`}></i>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* Tarjeta de Repartidor */}
                  {deliveryPerson && (
                    <div className="bg-white rounded-[24px] p-5 border border-gray-100 shadow-sm space-y-4">
                      <h5 className="text-xs text-slate-400 font-black uppercase tracking-wider">Tu Repartidor</h5>
                      <div className="flex items-center gap-4">
                        {deliveryPerson.fotoUrl ? (
                          <img
                            src={deliveryPerson.fotoUrl}
                            alt={deliveryPerson.nombres}
                            className="w-14 h-14 rounded-full object-cover border border-gray-100"
                          />
                        ) : (
                          <div className="w-14 h-14 rounded-full bg-slate-50 border border-gray-100 flex items-center justify-center text-slate-400 text-2xl">
                            <i className="bi bi-person"></i>
                          </div>
                        )}
                        <div className="flex-1">
                          <h6 className="font-extrabold text-slate-900 text-base leading-tight">
                            {deliveryPerson.nombres}
                          </h6>
                        </div>
                      </div>

                      {/* Mapa Estático si va en camino y tenemos coordenadas */}
                      {order.status === 'on_way' && order.delivery?.latlong && (
                        <div className="rounded-[18px] overflow-hidden border border-slate-100 relative h-32 w-full mt-2">
                          <img
                            src={`https://maps.googleapis.com/maps/api/staticmap?center=${
                              deliveryLocation
                                ? `${deliveryLocation.lat},${deliveryLocation.lng}`
                                : order.delivery.latlong
                            }&zoom=15&size=500x200&maptype=roadmap&markers=color:red%7C${
                              order.delivery.latlong
                            }${
                              deliveryLocation
                                ? `&markers=color:blue%7Clabel:D%7C${deliveryLocation.lat},${deliveryLocation.lng}`
                                : ''
                            }&key=${GOOGLE_MAPS_API_KEY}`}
                            alt="Ubicación de entrega y repartidor"
                            className="w-full h-full object-cover opacity-90"
                            onError={(e) => {
                              const target = e.target as HTMLImageElement
                              target.src =
                                'data:image/svg+xml;charset=UTF-8,%3Csvg%20width%3D%22500%22%20height%3D%22200%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Crect%20width%3D%22500%22%20height%3D%22200%22%20fill%3D%22%23f8fafc%22%2F%3E%3Ctext%20x%3D%22250%22%20y%3D%22100%22%20font-family%3D%22sans-serif%22%20font-size%3D%2212%22%20fill%3D%22%2394a3b8%22%20text-anchor%3D%22middle%22%20dominant-baseline%3D%22middle%22%3EMapa%20de%20seguimiento%20no%20disponible%3C%2Ftext%3E%3C%2Fsvg%3E'
                            }}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Resumen de Entrega y Pago */}
                  <div className="bg-white rounded-[24px] p-5 border border-gray-100 shadow-sm space-y-4">
                    <h5 className="text-xs text-slate-400 font-black uppercase tracking-wider">Detalles del Envío</h5>

                    <div className="space-y-3.5">
                      <div className="flex gap-3 items-start">
                        <div className="w-8 h-8 rounded-lg bg-slate-50 flex items-center justify-center text-slate-500 flex-shrink-0 border border-slate-100">
                          <i className="bi bi-geo-alt"></i>
                        </div>
                        <div>
                          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Dirección de Entrega</p>
                          <p className="text-xs text-slate-800 font-medium leading-normal mt-0.5">
                            {order.delivery?.type === 'pickup'
                              ? 'Retiro en Tienda'
                              : order.delivery?.references || 'No especificada'}
                          </p>
                        </div>
                      </div>

                      <div className="flex gap-3 items-start justify-between">
                        <div className="flex gap-3 items-start">
                          <div className="w-8 h-8 rounded-lg bg-slate-50 flex items-center justify-center text-slate-500 flex-shrink-0 border border-slate-100">
                            <i className="bi bi-wallet2"></i>
                          </div>
                          <div>
                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Método de Pago</p>
                            <p className="text-xs text-slate-800 font-bold uppercase mt-0.5">
                              {order.payment?.method === 'cash' ? '💵 Efectivo' : '🏦 Transferencia'}
                            </p>
                          </div>
                        </div>
                        {order.payment?.method === 'transfer' && order.payment?.receiptImageUrl && (
                          <button
                            type="button"
                            onClick={() => setShowReceiptModal(true)}
                            className="mt-1 flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-600 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-blue-100 transition-colors border border-blue-100 shadow-sm"
                          >
                            Ver Comprobante
                            <i className="bi bi-image"></i>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Desglose de Valores y Total Destacado */}
                  <div className="bg-white rounded-[24px] p-5 border border-gray-100 shadow-sm space-y-3">
                    <div className="flex justify-between text-xs text-slate-400 font-bold uppercase tracking-wide">
                      <span>Subtotal</span>
                      <span className="text-slate-700">{formatPrice(order.subtotal)}</span>
                    </div>

                    {order.delivery?.deliveryCost > 0 && (
                      <div className="flex justify-between text-xs text-slate-400 font-bold uppercase tracking-wide">
                        <span>Costo de Envío</span>
                        <span className="text-slate-700">{formatPrice(order.delivery.deliveryCost)}</span>
                      </div>
                    )}

                    <div className="pt-3 border-t border-dashed border-slate-100 flex justify-between items-center">
                      <span className="text-xs font-black text-slate-900 uppercase tracking-widest">Total del Pedido</span>
                      <span className="text-2xl font-black text-red-500 tracking-tight">
                        {formatPrice(order.total)}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: CALIFICAR PRODUCTOS */}
              {activeTab === 'rate' && (
                <div className="space-y-4">
                  {/* Banner de Calificación */}
                  <div className="bg-white rounded-[24px] p-5 border border-gray-100 shadow-sm text-center space-y-1">
                    <h4 className="text-base font-black text-slate-900">
                      {existingRating?.storeRated && order.items?.every((i: any) => existingRating.productRatings?.some((pr: any) => pr.productId === (i.productId || i.id)))
                        ? '¡Pedido calificado por completo! ❤️'
                        : 'Califica tu experiencia ⭐'}
                    </h4>
                    <p className="text-xs text-slate-400">
                      {existingRating?.storeRated && order.items?.every((i: any) => existingRating.productRatings?.some((pr: any) => pr.productId === (i.productId || i.id)))
                        ? 'Tus valoraciones nos ayudan a mantener la máxima calidad.'
                        : 'Puedes calificar la tienda y tus productos de forma independiente.'}
                    </p>
                  </div>

                  {/* 1. SECCIÓN: CALIFICACIÓN DE LA TIENDA */}
                  {existingRating?.storeRated ? (
                    /* Caso Tienda: Ya calificada */
                    <div className="bg-white rounded-[24px] p-5 border border-gray-100 shadow-sm text-center relative overflow-hidden">
                      <div className="absolute top-3 right-3 bg-emerald-50 text-emerald-600 text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border border-emerald-100">
                        Tienda Calificada ✓
                      </div>
                      <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Opinión del servicio</span>
                      <div className="flex justify-center gap-1 my-2">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <i
                            key={star}
                            className={`bi bi-star-fill text-xl ${
                              star <= existingRating.rating ? 'text-amber-400' : 'text-slate-200'
                            }`}
                          ></i>
                        ))}
                      </div>
                      {existingRating.comment && (
                        <p className="text-xs text-slate-600 italic bg-slate-50/50 p-3 rounded-xl border border-slate-100 mt-2">
                          "{existingRating.comment}"
                        </p>
                      )}
                    </div>
                  ) : (
                    /* Caso Tienda: Formulario para calificar */
                    <div className="bg-white rounded-[24px] p-5 border border-gray-100 shadow-sm text-center space-y-3">
                      <span className="text-[10px] text-slate-400 font-black uppercase tracking-wider block">Calificación de la tienda</span>
                      
                      <div className="flex justify-center gap-2">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <button
                            key={star}
                            type="button"
                            onClick={() => setGeneralRating(star)}
                            onMouseEnter={() => setGeneralHover(star)}
                            onMouseLeave={() => setGeneralHover(0)}
                            className="text-3xl focus:outline-none transition-transform duration-100 transform active:scale-95"
                          >
                            <i
                              className={`bi bi-star-fill ${
                                star <= (generalHover || generalRating)
                                  ? 'text-amber-400 scale-110'
                                  : 'text-slate-200'
                              }`}
                            ></i>
                          </button>
                        ))}
                      </div>

                      {/* Texto descriptivo de la estrella seleccionada */}
                      {generalRating > 0 && (
                        <p className="text-xs font-bold text-slate-800 uppercase tracking-widest animate-pulse">
                          {generalRating === 1 && '💔 Muy malo'}
                          {generalRating === 2 && '👎 Regular'}
                          {generalRating === 3 && '⭐ Bueno'}
                          {generalRating === 4 && '✨ Muy Bueno'}
                          {generalRating === 5 && '🔥 ¡Excelente servicio!'}
                        </p>
                      )}

                      <textarea
                        placeholder="Déjanos un comentario sobre el servicio en general... (opcional)"
                        value={generalComment}
                        onChange={(e) => setGeneralComment(e.target.value)}
                        className="w-full text-xs p-3.5 bg-slate-50 border border-slate-100 rounded-xl focus:border-slate-300 focus:bg-white focus:outline-none transition-colors duration-250 resize-none h-18"
                      />

                      {generalRating > 0 && (
                        <button
                          type="button"
                          onClick={handleSaveStoreRating}
                          disabled={isSubmittingStoreRating}
                          className="w-full bg-[#0F172A] text-white py-3 px-4 rounded-xl flex items-center justify-center font-bold text-xs gap-1.5 hover:bg-slate-800 transition-all shadow-md active:scale-[0.98] disabled:bg-slate-200 disabled:text-slate-400"
                        >
                          {isSubmittingStoreRating ? (
                            <>
                              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                              <span>Guardando Calificación...</span>
                            </>
                          ) : (
                            <>
                              <i className="bi bi-star text-sm"></i>
                              <span>GUARDAR CALIFICACIÓN DE TIENDA</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  )}

                  {/* 2. SECCIÓN: CALIFICACIÓN DE PRODUCTOS */}
                  <div className="space-y-3.5">
                    <h5 className="text-xs text-slate-400 font-black uppercase tracking-wider px-1">Califica tus Productos</h5>
                    
                    {order.items?.map((item: any, index: number) => {
                      const pId = item.productId || item.id
                      // Comprobar si este producto ya fue calificado en Firestore
                      const existingProductRating = existingRating?.productRatings?.find((pr: any) => pr.productId === pId)
                      const itemState = productRatings[pId] || { rating: 0, hover: 0, comment: '' }

                      return (
                        <div
                          key={index}
                          className="bg-white p-4 rounded-[24px] border border-gray-100 shadow-sm space-y-3.5 relative overflow-hidden"
                        >
                          {existingProductRating ? (
                            /* Caso Producto: Ya calificado */
                            <div className="space-y-3">
                              <div className="absolute top-3 right-3 bg-emerald-50 text-emerald-600 text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border border-emerald-100">
                                Calificado ✓
                              </div>
                              <div className="flex items-center gap-3.5">
                                <div className="w-12 h-12 rounded-xl overflow-hidden bg-slate-50 border border-slate-100 flex-shrink-0">
                                  <img
                                    src={item.image || item.product?.image || business?.image || ''}
                                    alt={item.variant || item.name}
                                    className="w-full h-full object-cover"
                                    onError={(e) => {
                                      const target = e.target as HTMLImageElement
                                      target.src = business?.image || ''
                                    }}
                                  />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <h6 className="font-extrabold text-sm text-slate-900 leading-tight truncate">
                                    {item.variant || item.name}
                                  </h6>
                                  {/* Estrellas del Producto (Modo Lectura) */}
                                  <div className="flex gap-0.5 my-1">
                                    {[1, 2, 3, 4, 5].map((star) => (
                                      <i
                                        key={star}
                                        className={`bi bi-star-fill text-xs ${
                                          star <= existingProductRating.rating
                                            ? 'text-amber-400'
                                            : 'text-slate-100'
                                        }`}
                                      ></i>
                                    ))}
                                  </div>
                                </div>
                              </div>
                              {existingProductRating.comment && (
                                <p className="text-xs text-slate-500 italic bg-slate-50/50 p-2 rounded-lg border border-slate-100/50 mt-1">
                                  "{existingProductRating.comment}"
                                </p>
                              )}
                            </div>
                          ) : (
                            /* Caso Producto: Formulario para calificar */
                            <>
                              <div className="flex items-center gap-3.5">
                                <div className="w-14 h-14 rounded-xl overflow-hidden bg-slate-50 border border-slate-100 flex-shrink-0">
                                  <img
                                    src={item.image || item.product?.image || business?.image || ''}
                                    alt={item.variant || item.name}
                                    className="w-full h-full object-cover"
                                    onError={(e) => {
                                      const target = e.target as HTMLImageElement
                                      target.src = business?.image || ''
                                    }}
                                  />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <h6 className="font-extrabold text-sm text-slate-900 leading-tight">
                                    {item.variant || item.name}
                                  </h6>
                                  <p className="text-[10px] text-slate-400 font-medium mt-0.5">
                                    {formatPrice(item.price)} c/u
                                  </p>
                                </div>
                                <span className="text-[10px] text-slate-400 font-black bg-slate-50 border border-slate-100 px-2 py-1 rounded-lg flex-shrink-0">
                                  x{item.quantity}
                                </span>
                              </div>

                              {/* Sección de Selección de Estrellas del Producto */}
                              <div className="pt-2 border-t border-slate-50 flex items-center justify-between">
                                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                                  Calificar Producto
                                </span>
                                
                                <div className="flex gap-1.5">
                                  {[1, 2, 3, 4, 5].map((star) => (
                                    <button
                                      key={star}
                                      type="button"
                                      onClick={() => handleProductRatingChange(pId, star)}
                                      onMouseEnter={() => handleProductRatingHover(pId, star)}
                                      onMouseLeave={() => handleProductRatingHover(pId, 0)}
                                      className="focus:outline-none transition-transform active:scale-90"
                                    >
                                      <i
                                        className={`bi bi-star-fill text-lg transition-colors ${
                                          star <= (itemState.hover || itemState.rating)
                                            ? 'text-amber-400'
                                            : 'text-slate-200'
                                        }`}
                                      ></i>
                                    </button>
                                  ))}
                                </div>
                              </div>

                              {/* Input de Comentario y Botón de Guardado */}
                              {itemState.rating > 0 && (
                                <div className="animate-fadeIn mt-2.5 space-y-2">
                                  <textarea
                                    placeholder={`¿Qué tal estuvo este ${item.variant || item.name}? (opcional)`}
                                    value={itemState.comment}
                                    onChange={(e) => handleProductCommentChange(pId, e.target.value)}
                                    className="w-full text-xs p-3 bg-slate-50 border border-slate-100 rounded-xl focus:border-slate-300 focus:bg-white focus:outline-none transition-colors duration-200 resize-none h-14"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => handleSaveProductRating(pId, item)}
                                    disabled={submittingProducts[pId]}
                                    className="w-full bg-[#0F172A] text-white py-2 px-3 rounded-xl flex items-center justify-center font-bold text-xs gap-1 hover:bg-slate-800 transition-all shadow active:scale-[0.98] disabled:bg-slate-200 disabled:text-slate-400"
                                  >
                                    {submittingProducts[pId] ? (
                                      <>
                                        <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                        <span>Guardando...</span>
                                      </>
                                    ) : (
                                      <>
                                        <i className="bi bi-check2"></i>
                                        <span>GUARDAR RESEÑA PRODUCTO</span>
                                      </>
                                    )}
                                  </button>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Modal de Comprobante de Pago */}
      {showReceiptModal && order?.payment?.receiptImageUrl && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center p-4">
          {/* Backdrop propio */}
          <div
            className="absolute inset-0 bg-black/80 backdrop-blur-sm transition-opacity duration-300"
            onClick={() => setShowReceiptModal(false)}
          />
          {/* Contenido del modal */}
          <div className="bg-white rounded-[28px] overflow-hidden shadow-2xl relative z-10 max-w-md w-full max-h-[85vh] flex flex-col p-4 animate-scaleUp">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h4 className="font-extrabold text-slate-900 text-sm sm:text-base">
                Comprobante de Transferencia
              </h4>
              <button
                type="button"
                onClick={() => setShowReceiptModal(false)}
                className="w-8 h-8 rounded-full bg-slate-50 text-slate-600 flex items-center justify-center hover:bg-slate-100 transition-colors"
              >
                <i className="bi bi-x-lg"></i>
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto flex items-center justify-center py-4 bg-slate-50 rounded-2xl border border-slate-100/50 mt-3">
              <img
                src={order.payment.receiptImageUrl}
                alt="Comprobante de Pago"
                className="max-w-full max-h-[60vh] object-contain rounded-xl shadow-sm"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
