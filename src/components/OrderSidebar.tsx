'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { db, auth } from '@/lib/firebase'
import { onAuthStateChanged } from 'firebase/auth'
import { doc, onSnapshot, updateDoc, collection, query, where, getDocs, addDoc, serverTimestamp } from 'firebase/firestore'
import {
  getBusiness,
  getDelivery,
  saveBusinessRating,
  getOrderRating,
  createRatingNotification,
  createProductRatingNotification,
  ProductRating,
  BusinessRating,
  updateBusinessRatingStats,
  updateOrderStatus,
  getDeliveriesByBusiness,
  getDeliveriesByStatus
} from '@/lib/database'
import { useAuth } from '@/contexts/AuthContext'
import { formatPrice } from '@/lib/price-utils'
import { calculateETASimple } from '@/lib/eta-utils'
import { GOOGLE_MAPS_API_KEY } from '@/components/GoogleMap'
import { sendOrderToStoreFromClient } from '@/components/WhatsAppUtils'
import { DeliveryStatusModal } from '@/app/business/dashboard/DeliveryStatusModal'
import PaymentManagementModals from '@/components/PaymentManagementModals'

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
  const pathname = usePathname()
  const isOrderPage = pathname?.startsWith('/o/')
  
  // Estados principales de datos
  const [order, setOrder] = useState<any | null>(null)
  const [business, setBusiness] = useState<any | null>(null)
  const [deliveryPerson, setDeliveryPerson] = useState<any | null>(null)
  const [availableDeliveries, setAvailableDeliveries] = useState<any[]>([])
  const [isDeliveryModalOpen, setIsDeliveryModalOpen] = useState(false)
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  // Estados de UI
  const [activeTab, setActiveTab] = useState<'tracking' | 'gestion' | 'rate'>('tracking')
  const [deliveryLocation, setDeliveryLocation] = useState<{ lat: number; lng: number } | null>(null)
  const [estimatedArrival, setEstimatedArrival] = useState<number | null>(null)
  const [showReceiptModal, setShowReceiptModal] = useState(false)

  // Estado para Firebase Auth (dueños/administradores del dashboard)
  const [fbUser, setFbUser] = useState<any>(null)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setFbUser(user)
    })
    return () => unsub()
  }, [])

  // Verificación estricta si el usuario actual es Administrador de ESTE negocio específico
  const isStoreAdmin = (() => {
    if (!order || !order.businessId) return false
    const targetBusinessId = order.businessId

    // 1. Sesión activa del negocio desde el Dashboard de la tienda (localStorage)
    if (typeof window !== 'undefined') {
      const savedBusinessId = localStorage.getItem('businessId')
      const savedOwnerId = localStorage.getItem('ownerId')
      
      // La sesión activa en el navegador DEBE ser para este negocio específico
      if (savedBusinessId && savedBusinessId === targetBusinessId) {
        const currentFbUser = fbUser || auth.currentUser
        if (currentFbUser) {
          if (savedOwnerId === currentFbUser.uid) return true
          if (business?.ownerId === currentFbUser.uid) return true
          if (business?.administrators && Array.isArray(business.administrators)) {
            if (business.administrators.some((a: any) => a.uid === currentFbUser.uid || a.email === currentFbUser.email)) return true
          }
        }
        return true
      }
    }

    // 2. Autenticación de Firebase Auth contra el negocio del pedido
    const currentFbUser = fbUser || auth.currentUser
    if (currentFbUser && business && business.id === targetBusinessId) {
      if (business.ownerId && business.ownerId === currentFbUser.uid) return true
      if (business.administrators && Array.isArray(business.administrators)) {
        if (business.administrators.some((a: any) => a.uid === currentFbUser.uid || a.email === currentFbUser.email)) return true
      }
    }

    // 3. Usuario del cliente (ClientUser) asociado explícitamente a este negocio
    if (clientUser) {
      const clientBizId = (clientUser as any).businessId
      const clientBizIds = (clientUser as any).businessIds
      const isMatchingBiz = clientBizId === targetBusinessId || (Array.isArray(clientBizIds) && clientBizIds.includes(targetBusinessId))

      if (isMatchingBiz) {
        const userRole = (clientUser as any).role
        if (userRole === 'admin' || userRole === 'owner' || userRole === 'manager') return true
      }

      if (business && business.id === targetBusinessId && business.administrators && Array.isArray(business.administrators)) {
        const isListedAdmin = business.administrators.some(
          (admin: any) =>
            admin.uid === (clientUser as any).uid ||
            admin.email === clientUser.email ||
            admin.uid === clientUser.id
        )
        if (isListedAdmin) return true
      }
    }

    return false
  })()

  // Reset de pestaña de seguridad: si no es admin de esta tienda, forzar 'tracking'
  useEffect(() => {
    if (activeTab === 'gestion' && !isStoreAdmin && !loading) {
      setActiveTab('tracking')
    }
  }, [activeTab, isStoreAdmin, loading])

  // Console.log de diagnóstico para verificar el reconocimiento del negocio
  useEffect(() => {
    if (order) {
      console.log('[OrderSidebar Admin Check]', {
        orderId: order.id,
        orderBusinessId: order.businessId,
        savedBusinessId: typeof window !== 'undefined' ? localStorage.getItem('businessId') : null,
        savedOwnerId: typeof window !== 'undefined' ? localStorage.getItem('ownerId') : null,
        fbUserUid: (fbUser || auth.currentUser)?.uid,
        fbUserEmail: (fbUser || auth.currentUser)?.email,
        clientUserId: clientUser?.id,
        clientUserRole: (clientUser as any)?.role,
        businessOwnerId: business?.ownerId,
        businessAdmins: business?.administrators,
        isStoreAdminResult: isStoreAdmin
      })
    }
  }, [order, business, clientUser, fbUser, isStoreAdmin])

  const handleDeliveryAssign = async (targetOrderId: string, deliveryId: string) => {
    try {
      const orderRef = doc(db, 'orders', targetOrderId)
      await updateDoc(orderRef, {
        'delivery.assignedDelivery': deliveryId,
        'delivery.acceptanceStatus': 'pending',
        updatedAt: serverTimestamp()
      })
      if (deliveryId) {
        const dData = await getDelivery(deliveryId)
        setDeliveryPerson(dData)
      } else {
        setDeliveryPerson(null)
      }
    } catch (err) {
      console.error('Error asignando repartidor:', err)
    }
  }

  const [isPrinting, setIsPrinting] = useState(false)

  const handlePrintTicket = async () => {
    if (!order) return
    setIsPrinting(true)
    try {
      const savedPrintMode = typeof window !== 'undefined' ? localStorage.getItem('fuddi_print_mode') : 'standard'
      const printMode = savedPrintMode === 'bluetooth' ? 'bluetooth' : 'standard'

      if (printMode === 'bluetooth') {
        const { printOrderBluetooth } = await import('@/lib/bluetooth-print-utils')
        await printOrderBluetooth({
          order: order as any,
          businessName: business?.name || "Negocio",
          businessLogo: business?.image,
          groupItemsByProduct: business?.notificationSettings?.groupItemsByProduct ?? true
        })
      } else {
        const { printOrder } = await import('@/lib/print-utils')
        await printOrder({
          order: order as any,
          businessName: business?.name || "Negocio",
          businessLogo: business?.image,
          groupItemsByProduct: business?.notificationSettings?.groupItemsByProduct ?? true
        })
      }
    } catch (e: any) {
      console.error("Error al imprimir ticket:", e)
      if (e?.name !== 'NotFoundError') {
        alert("Error al imprimir: " + (e?.message || "Error desconocido"))
      }
    } finally {
      setIsPrinting(false)
    }
  }

  // Estados de Calificaciones
  const [existingRating, setExistingRating] = useState<BusinessRating | null>(null)
  const [generalRating, setGeneralRating] = useState<number>(0)
  const [generalHover, setGeneralHover] = useState<number>(0)
  const [generalComment, setGeneralComment] = useState<string>('')
  const [productRatings, setProductRatings] = useState<{ [productId: string]: { rating: number; hover: number; comment: string } }>({})
  const [isSubmittingStoreRating, setIsSubmittingStoreRating] = useState(false)
  const [submittingProducts, setSubmittingProducts] = useState<{ [productId: string]: boolean }>({})

  // Obtener la mejor imagen del producto/variante/combo con fallback a la foto principal del producto
  const getItemImage = (item: any): string => {
    if (!item) return ''
    const variantImg = item.variantImage || item.variant?.image || item.selectedVariant?.image || item.comboImage || item.combo?.image || item.selectedCombo?.image
    if (variantImg) return variantImg
    if (item.image) return item.image
    if (item.imageUrl) return item.imageUrl
    if (item.productImage) return item.productImage
    const mainProductImg = item.product?.image || item.product?.mainImage || item.product?.imageUrl || item.mainImage || item.productMainImage
    if (mainProductImg) return mainProductImg
    return ''
  }

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

                // Cargar repartidores activos (igual que el Dashboard de Tienda)
                getDeliveriesByStatus('activo')
                  .then(deliveries => {
                    if (deliveries && deliveries.length > 0) {
                      setAvailableDeliveries(deliveries)
                    } else if (orderData.businessId) {
                      getDeliveriesByBusiness(orderData.businessId).then(setAvailableDeliveries)
                    }
                  })
                  .catch(err => console.error('Error cargando repartidores:', err))

                // Buscar si la orden ya tiene calificación
                const ratingData = await getOrderRating(orderData.businessId, orderId)
                if (ratingData) {
                  setExistingRating(ratingData)
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
        productImage: getItemImage(item),
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
    <div className={`fixed inset-0 z-[120] overflow-hidden ${isOrderPage ? 'top-16' : ''}`}>
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300"
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className={`${isOrderPage ? 'absolute' : 'fixed'} right-0 top-0 h-full w-full sm:w-[480px] bg-slate-50 shadow-2xl transform transition-transform duration-300 ease-in-out z-[130] flex flex-col`}
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
                className={`flex-1 py-3 text-xs sm:text-sm font-black uppercase tracking-widest border-b-2 text-center transition-all flex items-center justify-center gap-1.5 ${
                  activeTab === 'tracking'
                    ? 'border-slate-900 text-slate-900'
                    : 'border-transparent text-slate-400 hover:text-slate-600'
                }`}
              >
                <i className="bi bi-box-seam text-sm"></i>
                <span>Seguimiento</span>
              </button>
              {isStoreAdmin && (
                <button
                  onClick={() => setActiveTab('gestion')}
                  className={`flex-1 py-3 text-xs sm:text-sm font-black uppercase tracking-widest border-b-2 text-center transition-all flex items-center justify-center gap-1.5 ${
                    activeTab === 'gestion'
                      ? 'border-blue-600 text-blue-600 font-black'
                      : 'border-transparent text-slate-400 hover:text-slate-600'
                  }`}
                >
                  <i className="bi bi-shop text-sm"></i>
                  <span>Gestión</span>
                </button>
              )}
              <button
                onClick={() => setActiveTab('rate')}
                className={`flex-1 py-3 text-xs sm:text-sm font-black uppercase tracking-widest border-b-2 text-center transition-all flex items-center justify-center gap-1.5 ${
                  activeTab === 'rate'
                    ? 'border-slate-900 text-slate-900'
                    : 'border-transparent text-slate-400 hover:text-slate-600'
                }`}
              >
                <i className="bi bi-star-fill text-yellow-500 text-xs"></i>
                <span>Calificar</span>
              </button>
            </div>

            {/* Contenido con scroll independiente */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              
              {/* TAB GESTIÓN DE TIENDA (Tarjeta desplegada completa de business/dashboard) */}
              {activeTab === 'gestion' && isStoreAdmin && (
                <div className="space-y-4">
                  {(() => {
                    const isPickup = order.delivery?.type === 'pickup'
                    const isDelivery = order.delivery?.type === 'delivery'

                    const getDashboardStatusLabel = (s: string) => {
                      switch (s) {
                        case 'pending': return 'Pendiente'
                        case 'confirmed': return 'Confirmado'
                        case 'preparing': return 'Preparando'
                        case 'ready': return 'Listo para entrega'
                        case 'on_way': return 'En camino'
                        case 'delivered': return 'Entregado'
                        case 'cancelled': return 'Descartado'
                        default: return s
                      }
                    }

                    const getDashboardStatusBadgeClass = (s: string) => {
                      switch (s) {
                        case 'pending': return 'bg-yellow-100 text-yellow-800 border-yellow-200'
                        case 'confirmed': return 'bg-blue-100 text-blue-800 border-blue-200'
                        case 'preparing': return 'bg-purple-100 text-purple-800 border-purple-200'
                        case 'ready': return 'bg-green-100 text-green-800 border-green-200'
                        case 'on_way': return 'bg-indigo-100 text-indigo-800 border-indigo-200'
                        case 'delivered': return 'bg-gray-100 text-gray-800 border-gray-200'
                        case 'cancelled': return 'bg-red-100 text-red-800 border-red-200'
                        default: return 'bg-gray-100 text-gray-800 border-gray-200'
                      }
                    }

                    const getPrimaryActionDetails = (status: string) => {
                      switch (status) {
                        case 'pending': return { next: 'confirmed', label: 'Confirmar', icon: 'bi-check2-circle', style: 'bg-green-600 text-white hover:bg-green-700' }
                        case 'confirmed': return { next: 'preparing', label: 'Preparar', icon: 'bi-fire', style: 'bg-purple-600 text-white hover:bg-purple-700' }
                        case 'preparing': return { next: 'ready', label: 'Listo', icon: 'bi-box-seam', style: 'bg-green-600 text-white hover:bg-green-700' }
                        case 'ready': return { next: isPickup ? 'delivered' : 'on_way', label: isPickup ? 'Entregado' : 'En camino', icon: isPickup ? 'bi-check-all' : 'bi-bicycle', style: 'bg-indigo-600 text-white hover:bg-indigo-700' }
                        case 'on_way': return { next: 'delivered', label: 'Entregado', icon: 'bi-check-all', style: 'bg-gray-800 text-white hover:bg-gray-900' }
                        default: return null
                      }
                    }

                    const primaryAction = getPrimaryActionDetails(order.status)
                    const fulfillmentLabel = isPickup ? 'Retiro en tienda' : (deliveryPerson ? deliveryPerson.nombres : 'Delivery asignado')
                    const fulfillmentClass = isPickup ? 'bg-blue-100 text-blue-700 border-blue-200' : 'bg-green-100 text-green-700 border-green-200'

                    const deliveryCoordinates = order.delivery?.latlong ? (() => {
                      const parts = String(order.delivery.latlong).split(',')
                      if (parts.length === 2) {
                        const lat = parseFloat(parts[0].trim())
                        const lng = parseFloat(parts[1].trim())
                        if (!isNaN(lat) && !isNaN(lng)) return { lat, lng }
                      }
                      return null
                    })() : null

                    const deliveryMapsUrl = deliveryCoordinates
                      ? `https://www.google.com/maps/search/?api=1&query=${deliveryCoordinates.lat},${deliveryCoordinates.lng}`
                      : undefined

                    const deliveryMapImageUrl = deliveryCoordinates
                      ? `https://maps.googleapis.com/maps/api/staticmap?center=${deliveryCoordinates.lat},${deliveryCoordinates.lng}&zoom=16&size=600x180&scale=2&maptype=roadmap&markers=color:red%7C${deliveryCoordinates.lat},${deliveryCoordinates.lng}&key=${GOOGLE_MAPS_API_KEY}`
                      : undefined

                    return (
                      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                        {/* Card Header: Estilo exacto OrderCard */}
                        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50 flex justify-between items-center">
                          <div className="flex items-center gap-3">
                            <div className="flex flex-col items-center shrink-0">
                              <i className="bi bi-shop text-blue-600 text-sm"></i>
                              {!order.createdByAdmin && (
                                <i className="bi bi-phone text-blue-500 text-[10px] mt-0.5" title="Pedido del cliente (Checkout)"></i>
                              )}
                            </div>

                            <div className="flex flex-col">
                              <span className="text-sm sm:text-base font-bold text-gray-900 flex items-center gap-2">
                                {order.customer?.name || "Cliente"}
                              </span>
                              <div className="flex items-center gap-2 mt-0.5">
                                <i className={`bi ${order.timing?.type === 'scheduled' ? 'bi-clock text-blue-600' : 'bi-lightning-fill text-yellow-500'}`}></i>
                                <span className="font-mono text-xs sm:text-sm font-medium text-gray-600">
                                  {getMinutesUntilDelivery()?.timeDisplay || 'Inmediato'}
                                </span>
                                <span className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${getDashboardStatusBadgeClass(order.status)}`}>
                                  {getDashboardStatusLabel(order.status)}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1">
                            {/* Botón Acción Principal */}
                            {primaryAction && (
                              <button
                                type="button"
                                onClick={async () => {
                                  try {
                                    await updateOrderStatus(order.id, primaryAction.next as any, undefined, 'app')
                                  } catch (err) {
                                    console.error('Error al actualizar estado:', err)
                                  }
                                }}
                                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg shadow-sm transition-colors ${primaryAction.style}`}
                              >
                                <span>{primaryAction.label}</span>
                                <i className={`bi ${primaryAction.icon}`}></i>
                              </button>
                            )}

                            {/* Imprimir Ticket (respetando configuración PDF/Bluetooth) */}
                            <button
                              type="button"
                              disabled={isPrinting}
                              onClick={handlePrintTicket}
                              className="p-1.5 text-lg text-gray-500 rounded-lg transition-all hover:bg-gray-200/60 hover:text-gray-800 disabled:opacity-50 flex items-center justify-center min-w-[32px] min-h-[32px]"
                              title="Imprimir ticket (PDF / Bluetooth)"
                            >
                              {isPrinting ? (
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-slate-700"></div>
                              ) : (
                                <i className="bi bi-printer"></i>
                              )}
                            </button>
                          </div>
                        </div>

                        {/* Card Body (Vista Desplegada Completa del Dashboard) */}
                        <div className="p-4 bg-white space-y-4">
                          {/* Información de Ubicación & Mapa */}
                          {isDelivery && (
                            <div className="space-y-2">
                              <div className="flex items-start gap-2 text-sm text-gray-700 font-medium">
                                <i className="bi bi-geo-alt-fill text-red-500 mt-0.5 flex-shrink-0"></i>
                                <span>{order.delivery?.references || (order.delivery as any)?.reference || "Ubicación de entrega"}</span>
                              </div>
                              {deliveryMapImageUrl && deliveryMapsUrl ? (
                                <a
                                  href={deliveryMapsUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="block rounded-xl overflow-hidden border border-gray-200 hover:opacity-95 transition-opacity"
                                  title="Abrir en Google Maps"
                                >
                                  <img
                                    src={deliveryMapImageUrl}
                                    alt="Mapa de entrega"
                                    className="h-36 w-full object-cover"
                                    loading="lazy"
                                  />
                                </a>
                              ) : null}
                            </div>
                          )}

                          {/* Notas del cliente */}
                          {order.notas && order.notas.trim() && (
                            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                              <div className="flex items-start gap-2">
                                <i className="bi bi-sticky text-amber-600 mt-0.5 flex-shrink-0"></i>
                                <div className="flex-1">
                                  <p className="text-sm font-bold text-amber-800 mb-1">Notas del cliente</p>
                                  <p className="text-sm text-amber-700 whitespace-pre-wrap">{order.notas}</p>
                                </div>
                              </div>
                            </div>
                          )}

                          {order.notaImageUrl && (
                            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                              <div className="flex items-start gap-2">
                                <i className="bi bi-image text-amber-600 mt-0.5 flex-shrink-0"></i>
                                <div className="flex-1">
                                  <p className="text-sm font-bold text-amber-800 mb-2">Imagen adjunta</p>
                                  <img src={order.notaImageUrl} alt="Imagen adjunta" className="max-h-48 w-full object-contain rounded-md border border-amber-200 bg-white" />
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Lista de Artículos */}
                          <div className="space-y-2 pt-2 border-t border-gray-100">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 block">Detalle de Productos</span>
                            {order.items?.map((item: any, idx: number) => (
                              <div key={idx} className="flex justify-between text-sm py-1 border-b border-gray-50 last:border-0">
                                <span className="text-gray-800 font-medium">
                                  <span className="font-bold text-gray-900">{item.quantity}x</span> {item.variant || item.product?.name || item.name}
                                </span>
                                <span className="text-emerald-600 font-bold">
                                  ${((item.storeReceives || item.price || 0) * item.quantity).toFixed(2)}
                                </span>
                              </div>
                            ))}
                          </div>

                          {/* Resumen de Pago & Total (Estilo idéntico a OrderCard del Dashboard) */}
                          {(() => {
                            const storeReceivesTotal = order.items?.reduce((acc: number, item: any) => {
                              const itemStorePrice = item.storeReceives || (item.price && item.commission ? item.price - item.commission : (item.product?.basePrice || item.product?.price || item.price || 0))
                              return acc + (itemStorePrice * item.quantity)
                            }, 0) || order.total || 0

                            const publicTotal = order.total || 0
                            const hasPublicPriceDiff = publicTotal > storeReceivesTotal

                            return (
                              <div className="pt-3 border-t border-dashed border-gray-200 flex justify-between items-center">
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (isStoreAdmin) {
                                        setIsPaymentModalOpen(true)
                                      }
                                    }}
                                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-sm font-medium transition-colors ${
                                      order.payment?.paymentStatus === 'paid'
                                        ? 'bg-green-100 text-green-700'
                                        : order.payment?.paymentStatus === 'validating'
                                          ? 'bg-yellow-100 text-yellow-700'
                                          : 'bg-red-100 text-red-700'
                                    } ${isStoreAdmin ? 'cursor-pointer hover:brightness-95' : 'cursor-default'}`}
                                    title={isStoreAdmin ? 'Haga clic para gestionar el pago' : ''}
                                  >
                                    <i className={`bi ${order.payment?.method === 'transfer' ? 'bi-bank' : order.payment?.method === 'mixed' ? 'bi-cash-coin' : 'bi-cash'}`}></i>
                                    <div className="flex flex-col items-start leading-tight">
                                      <span className="text-emerald-600 font-black">${storeReceivesTotal.toFixed(2)}</span>
                                      {hasPublicPriceDiff && (
                                        <span className="text-[9px] text-gray-400 font-bold uppercase tracking-tighter">Público: ${publicTotal.toFixed(2)}</span>
                                      )}
                                    </div>
                                    {isStoreAdmin && <i className="bi bi-pencil-square text-xs opacity-50 ml-1"></i>}
                                  </button>
                                </div>

                                <button
                                  type="button"
                                  onClick={() => {
                                    if (isStoreAdmin) {
                                      setIsPaymentModalOpen(true)
                                    }
                                  }}
                                  className={`text-right group ${isStoreAdmin ? 'cursor-pointer' : 'cursor-default'}`}
                                  title={isStoreAdmin ? 'Haga clic para gestionar el pago' : ''}
                                >
                                  <span className="text-[10px] text-gray-400 font-bold uppercase block group-hover:text-blue-600 transition-colors flex items-center justify-end gap-1">
                                    Total {isStoreAdmin && <i className="bi bi-pencil-square text-[9px] opacity-60"></i>}
                                  </span>
                                  <span className="text-xl font-black text-slate-900 group-hover:text-blue-600 transition-colors">${publicTotal.toFixed(2)}</span>
                                </button>
                              </div>
                            )
                          })()}

                          {/* Fulfillment Label Pill */}
                          {(isDelivery || isPickup) && (
                            <div className="pt-2 flex justify-end border-t border-gray-100">
                              <button
                                type="button"
                                onClick={() => {
                                  if (isStoreAdmin) {
                                    setIsDeliveryModalOpen(true)
                                  }
                                }}
                                className={`flex h-[20px] min-h-[20px] max-h-[20px] items-center justify-center truncate rounded-[3px] border px-2 py-0 text-[11px] font-semibold leading-none shadow-[inset_0_0_0_1px_rgba(255,255,255,0.35)] transition-colors ${fulfillmentClass} ${isStoreAdmin ? 'cursor-pointer hover:brightness-95' : 'cursor-default'}`}
                                title={isStoreAdmin ? 'Haga clic para cambiar o asignar repartidor' : fulfillmentLabel}
                              >
                                {fulfillmentLabel}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })()}

                  {/* Enlace al Dashboard Completo de la Tienda */}
                  <Link
                    href="/business/dashboard"
                    className="flex items-center justify-center gap-2.5 w-full py-3 px-4 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold text-xs sm:text-sm shadow-md transition-all group"
                  >
                    <i className="bi bi-speedometer2 text-base text-blue-400 group-hover:scale-110 transition-transform"></i>
                    <span>Ir al Dashboard Completo de la Tienda</span>
                    <i className="bi bi-arrow-right text-slate-400 group-hover:translate-x-1 transition-transform"></i>
                  </Link>
                </div>
              )}

              {/* TAB 1: SEGUIMIENTO */}
              {activeTab === 'tracking' && (
                <div className="space-y-4">

                  {/* Tarjeta de Tiempo Estimado de Entrega */}
                  {!['delivered', 'cancelled'].includes(order.status) && (
                    <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white rounded-[24px] p-5 shadow-lg border border-slate-800">
                      <div className="flex items-center justify-between">
                        <div className="space-y-1">
                          <span className="text-[10px] text-slate-400 font-extrabold uppercase tracking-widest block">
                            Tiempo Estimado de Entrega
                          </span>
                          <h4 className="text-2xl font-black tracking-tight text-emerald-400">
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
                          <p className="text-xs text-slate-300 font-medium">
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
                  {!order.customer?.telegramChatId && (
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

                    {order.creditUsed > 0 && (
                      <div className="flex justify-between text-xs font-bold uppercase tracking-wide text-emerald-600">
                        <span className="flex items-center gap-1">
                          <i className="bi bi-gift-fill text-[11px]"></i> Crédito Aplicado
                        </span>
                        <span>-{formatPrice(order.creditUsed)}</span>
                      </div>
                    )}

                    <div className="pt-3 border-t border-dashed border-slate-100 flex justify-between items-center">
                      <span className="text-xs font-black text-slate-900 uppercase tracking-widest">
                        {order.creditUsed > 0 && Math.max(0, (order.creditUsed > 0 && Math.abs((order.total ?? 0) - ((order.subtotal ?? 0) + (order.delivery?.deliveryCost ?? 0))) < 0.02 ? (order.total ?? 0) - order.creditUsed : (order.total ?? 0))) > 0 ? 'Saldo a Cobrar' : 'Total del Pedido'}
                      </span>
                      <div className="text-right">
                        {(() => {
                          const grossTotal = (order.subtotal ?? 0) + (order.delivery?.deliveryCost ?? 0)
                          const effectiveTotal = Math.max(
                            0,
                            order.creditUsed > 0 && Math.abs((order.total ?? 0) - grossTotal) < 0.02
                              ? (order.total ?? 0) - order.creditUsed
                              : (order.total ?? 0)
                          )
                          return (
                            <>
                              <span className={`text-2xl font-black tracking-tight ${effectiveTotal === 0 && order.creditUsed > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                                {formatPrice(effectiveTotal)}
                              </span>
                              {effectiveTotal === 0 && order.creditUsed > 0 && (
                                <span className="block text-[10px] font-bold text-emerald-600 uppercase">
                                  ¡Cubierto 100% con créditos! 🎉
                                </span>
                              )}
                            </>
                          )
                        })()}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: CALIFICAR PRODUCTOS */}
              {activeTab === 'rate' && (() => {
                const ratableItems = order.items?.filter((i: any) => {
                  const price = i.price ?? i.product?.price ?? 0
                  return price > 0
                }) || []

                const isFullyRated = existingRating?.storeRated && (
                  ratableItems.length === 0 ||
                  ratableItems.every((i: any) => existingRating.productRatings?.some((pr: any) => pr.productId === (i.productId || i.id)))
                )

                return (
                  <div className="space-y-4">
                    {/* Banner de Calificación */}
                    <div className="bg-white rounded-[24px] p-5 border border-gray-100 shadow-sm text-center space-y-1">
                      <h4 className="text-base font-black text-slate-900">
                        {isFullyRated
                          ? '¡Pedido calificado por completo! ❤️'
                          : 'Califica tu experiencia ⭐'}
                      </h4>
                      <p className="text-xs text-slate-400">
                        {isFullyRated
                          ? 'Tus valoraciones nos ayudan a mantener la máxima calidad.'
                          : 'Puedes calificar la tienda y tus productos de forma independiente.'}
                      </p>
                    </div>

                    {/* 1. SECCIÓN: CALIFICACIÓN DE LA TIENDA */}
                    {existingRating?.storeRated ? (
                      /* Caso Tienda: Ya calificada */
                      <div className="bg-white rounded-[24px] p-5 border border-gray-100 shadow-sm text-center space-y-3 relative overflow-hidden">
                        <div className="absolute top-3 right-3 bg-emerald-50 text-emerald-600 text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border border-emerald-100">
                          Tienda Calificada ✓
                        </div>
                        
                        <div className="flex flex-col items-center justify-center space-y-2 pt-1">
                          <div className="w-16 h-16 rounded-full overflow-hidden bg-slate-50 border-2 border-slate-100 flex-shrink-0 flex items-center justify-center shadow-md">
                            {business?.image ? (
                              <img
                                src={business.image}
                                alt={business.name || 'Tienda'}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <i className="bi bi-shop text-slate-400 text-2xl"></i>
                            )}
                          </div>
                          <div>
                            <h6 className="font-extrabold text-base text-slate-900 leading-tight">
                              {business?.name || 'Tienda'}
                            </h6>
                            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mt-0.5">Opinión del servicio</span>
                          </div>

                          <div className="flex justify-center gap-1 pt-1">
                            {[1, 2, 3, 4, 5].map((star) => (
                              <i
                                key={star}
                                className={`bi bi-star-fill text-lg ${
                                  star <= existingRating.rating ? 'text-amber-400' : 'text-slate-200'
                                }`}
                              ></i>
                            ))}
                          </div>
                        </div>

                        {existingRating.comment && (
                          <p className="text-xs text-slate-600 italic bg-slate-50/50 p-3 rounded-xl border border-slate-100 mt-2">
                            "{existingRating.comment}"
                          </p>
                        )}
                      </div>
                    ) : (
                      /* Caso Tienda: Formulario para calificar */
                      <div className="bg-white rounded-[24px] p-5 border border-gray-100 shadow-sm text-center space-y-4">
                        <div className="flex flex-col items-center justify-center space-y-2">
                          <div className="w-16 h-16 rounded-full overflow-hidden bg-slate-50 border-2 border-slate-100 flex-shrink-0 flex items-center justify-center shadow-md">
                            {business?.image ? (
                              <img
                                src={business.image}
                                alt={business.name || 'Tienda'}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <i className="bi bi-shop text-slate-400 text-2xl"></i>
                            )}
                          </div>
                          <div>
                            <h5 className="font-black text-base text-slate-900 leading-tight">
                              {business?.name || 'Tienda'}
                            </h5>
                            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mt-0.5">
                              Calificación de la tienda
                            </span>
                          </div>
                        </div>
                        
                        <div className="text-center space-y-3 pt-2 border-t border-slate-50">
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
                      </div>
                    )}

                    {/* 2. SECCIÓN: CALIFICACIÓN DE PRODUCTOS (Omitiendo precio 0) */}
                    {ratableItems.length > 0 && (
                      <div className="space-y-3.5">
                        <h5 className="text-xs text-slate-400 font-black uppercase tracking-wider px-1">Califica tus Productos</h5>
                        
                        {ratableItems.map((item: any, index: number) => {
                          const pId = item.productId || item.id
                          // Comprobar si este producto ya fue calificado en Firestore
                          const existingProductRating = existingRating?.productRatings?.find((pr: any) => pr.productId === pId)
                          const itemState = productRatings[pId] || { rating: 0, hover: 0, comment: '' }
                          const pImg = getItemImage(item)
                          const fallbackMainImg = item.product?.image || item.product?.mainImage || item.productImage || ''

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
                                    <div className="w-12 h-12 rounded-xl overflow-hidden bg-slate-50 border border-slate-100 flex-shrink-0 flex items-center justify-center">
                                      {pImg ? (
                                        <img
                                          src={pImg}
                                          alt={item.variant || item.name}
                                          className="w-full h-full object-cover"
                                          onError={(e) => {
                                            const target = e.target as HTMLImageElement
                                            if (fallbackMainImg && target.src !== fallbackMainImg) {
                                              target.src = fallbackMainImg
                                            } else {
                                              target.style.display = 'none'
                                              if (target.parentElement) {
                                                target.parentElement.innerHTML = '<i class="bi bi-box-seam text-slate-400 text-lg"></i>'
                                              }
                                            }
                                          }}
                                        />
                                      ) : (
                                        <i className="bi bi-box-seam text-slate-400 text-lg"></i>
                                      )}
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
                                    <div className="w-14 h-14 rounded-xl overflow-hidden bg-slate-50 border border-slate-100 flex-shrink-0 flex items-center justify-center">
                                      {pImg ? (
                                        <img
                                          src={pImg}
                                          alt={item.variant || item.name}
                                          className="w-full h-full object-cover"
                                          onError={(e) => {
                                            const target = e.target as HTMLImageElement
                                            if (fallbackMainImg && target.src !== fallbackMainImg) {
                                              target.src = fallbackMainImg
                                            } else {
                                              target.style.display = 'none'
                                              if (target.parentElement) {
                                                target.parentElement.innerHTML = '<i class="bi bi-box-seam text-slate-400 text-xl"></i>'
                                              }
                                            }
                                          }}
                                        />
                                      ) : (
                                        <i className="bi bi-box-seam text-slate-400 text-xl"></i>
                                      )}
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
                    )}
                  </div>
                )
              })()}
            </div>

            {/* Footer flotante solo en pestaña de seguimiento */}
            {activeTab === 'tracking' && business && !['delivered', 'cancelled'].includes(order?.status) && (
              <div className="p-4 bg-white/95 backdrop-blur-md border-t border-slate-100 shadow-[0_-4px_20px_rgba(0,0,0,0.05)] sticky bottom-0 z-20">
                <button
                  type="button"
                  onClick={() => sendOrderToStoreFromClient(order, business)}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-black uppercase tracking-widest text-xs py-3.5 px-4 rounded-[20px] flex items-center justify-center gap-2.5 transition-all shadow-md shadow-emerald-900/10 active:scale-95"
                >
                  <i className="bi bi-whatsapp text-lg"></i>
                  Obtener comprobante por whatsapp
                </button>
              </div>
            )}
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

      {/* Modal Selector de Estado del Delivery */}
      <DeliveryStatusModal
        isOpen={isDeliveryModalOpen}
        onClose={() => setIsDeliveryModalOpen(false)}
        order={order}
        deliveryAgent={deliveryPerson || undefined}
        availableDeliveries={availableDeliveries}
        canChangeDelivery={true}
        onDeliveryAssign={handleDeliveryAssign}
        onWhatsApp={() => {}}
      />
      {/* Modal de Gestión de Pago */}
      <PaymentManagementModals
        isOpen={isPaymentModalOpen}
        onClose={() => setIsPaymentModalOpen(false)}
        order={order}
        onOrderUpdated={(updatedOrder) => {
          setOrder(updatedOrder)
        }}
      />
    </div>
  )
}
